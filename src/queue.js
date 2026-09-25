import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ACTIVE, TERMINAL, validateInput, integer, LIMITS } from './validation.js';
import { writePresetPatch } from './preset-patch.js';

const fresh = () => ({ schema: 1, id: null, mode: 'idle', config: null, tasks: [], createdAt: null, error: null });

export class BatchQueue {
  constructor(store, driver, preflight = async () => {}) {
    this.store = store; this.driver = driver; this.preflight = preflight;
    this.state = fresh(); this.live = new Map(); this.closed = false; this.pumping = false;
    this.operation = Promise.resolve(); this.revision = 0; this.stopEpoch = 0;
  }
  async init() {
    await this.store.acquire();
    try {
      this.state = await this.store.load() ?? fresh();
      for (const task of this.state.tasks) if (ACTIVE.has(task.status)) {
        task.status = 'interrupted'; task.endedAt = Date.now(); task.error = '服务曾退出，执行结果未确认；不会自动重发。';
      }
      if (this.state.tasks.some(t => t.status === 'pending')) this.state.mode = 'paused';
      else if (this.state.id && this.state.mode !== 'stopped') this.state.mode = 'finished';
      await this.save();
    } catch (e) { await this.store.close(); throw e; }
  }
  snapshot() {
    const counts = {};
    for (const t of this.state.tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
    return structuredClone({ ...this.state, counts, liveCount: this.live.size, revision: this.revision });
  }
  async save() {
    this.revision++;
    try { await this.store.save(this.state); }
    catch (e) { this.state.mode = 'paused'; this.state.error = `无法保存队列，已停止派发：${e.message}`; throw e; }
  }
  serial(fn) {
    const result = this.operation.then(() => { if (this.closed) throw new Error('插件正在关闭'); return fn(); });
    this.operation = result.catch(() => {}); return result;
  }
  create(input) { const epoch = this.stopEpoch; return this.serial(async () => {
    if (this.live.size || this.state.tasks.some(t => !TERMINAL.has(t.status))) throw new Error('请先完成或停止当前批次');
    const { rows, ...config } = validateInput(input);
    await this.preflight(config);
    if (epoch !== this.stopEpoch || this.closed) throw new Error('启动准备期间已收到停止或清空指令，批次未投递');
    await this.store.archive(this.state);
    if (epoch !== this.stopEpoch || this.closed) throw new Error('启动准备期间已收到停止或清空指令，批次未投递');
    const id = `batch-${randomUUID()}`;
    this.state = { ...fresh(), id, mode: 'running', config, createdAt: Date.now(), tasks: rows.map((r, i) => ({ ...r, id: `${id}-${i + 1}`, workDir: join(config.cwd, id, `task-${String(i + 1).padStart(5, '0')}`), agentPreset: config.agentPreset, sessionId: `session-${randomUUID()}`, status: 'pending', result: '', error: null, startedAt: null, endedAt: null, pid: null, stopRequested: false })) };
    await this.save();
    if (epoch !== this.stopEpoch || this.closed) {
      await this.stopAll(false);
      throw new Error('启动准备期间已收到停止或清空指令，批次未投递');
    }
    this.kick(); return this.snapshot();
  }); }
  pause() { return this.serial(async () => { if (this.state.mode === 'running') this.state.mode = 'paused'; await this.save(); return this.snapshot(); }); }
  resume() { return this.serial(async () => {
    if (this.state.mode !== 'paused' || this.closed) throw new Error('当前批次不能继续');
    if (!this.state.config?.agentPreset || this.state.tasks.some(t => t.status === 'pending' && t.agentPreset !== this.state.config.agentPreset)) throw new Error('旧批次未绑定 Agent 预设，不能继续投递；请停止当前批次并新建批次');
    const epoch = this.stopEpoch;
    await this.preflight(this.state.config);
    if (epoch !== this.stopEpoch || this.closed) throw new Error('已收到停止指令，不再继续投递');
    this.state.error = null; this.state.mode = 'running'; await this.save(); this.kick(); return this.snapshot();
  }); }
  setConcurrency(value) { return this.serial(async () => {
    if (!this.state.config) throw new Error('还没有批次');
    this.state.config.concurrency = integer(value, 1, LIMITS.concurrency, '并发数');
    await this.save(); this.kick(); return this.snapshot();
  }); }
  clear() { this.stopEpoch++; return this.serial(async () => {
    if (this.state.mode === 'running' || this.state.mode === 'paused' || this.live.size || this.state.tasks.some(t => !TERMINAL.has(t.status))) {
      throw new Error('请先停止或完成当前批次，确认没有正在执行或待投递任务后再清空列表');
    }
    if (!this.state.id && !this.state.tasks.length && this.state.mode === 'idle') return this.snapshot();
    const previous = this.state;
    this.state = fresh();
    try { await this.save(); }
    catch (e) { this.state = previous; throw e; }
    return this.snapshot();
  }); }
  /** Flag synchronously, before persistence or spawn awaits: stop wins admission races. */
  stopAll(force = false) {
    this.stopEpoch++;
    if (!this.state.id && !this.state.tasks.length) return Promise.resolve(this.snapshot());
    this.state.mode = 'stopped';
    for (const task of this.state.tasks) {
      if (task.status === 'pending') { task.status = 'cancelled'; task.endedAt = Date.now(); }
      else if (ACTIVE.has(task.status)) { task.stopRequested = true; task.status = 'stopping'; }
    }
    for (const handle of this.live.values()) handle.stop(force);
    return this.save().then(() => this.snapshot());
  }
  stopOne(id, force = false) {
    const task = this.state.tasks.find(t => t.id === id);
    if (!task) return Promise.reject(new Error('任务不存在'));
    if (task.status === 'pending') { task.status = 'cancelled'; task.endedAt = Date.now(); }
    else if (ACTIVE.has(task.status)) { task.stopRequested = true; task.status = 'stopping'; this.live.get(id)?.stop(force); }
    return this.save().then(() => this.snapshot());
  }
  kick() { if (!this.pumping && !this.closed) void this.pump().catch(e => { this.state.mode = 'paused'; this.state.error = e.message; }); }
  async pump() {
    if (this.pumping) return; this.pumping = true;
    try {
      while (!this.closed && this.state.mode === 'running' && this.live.size < this.state.config.concurrency) {
        const task = this.state.tasks.find(t => t.status === 'pending');
        if (!task) break;
        if (!task.agentPreset || task.agentPreset !== this.state.config.agentPreset) {
          this.state.mode = 'paused';
          this.state.error = '待投递任务未绑定当前 Agent 预设，已暂停投递';
          await this.save(); break;
        }
        task.status = 'starting'; task.startedAt = Date.now();
        await this.save();
        if (task.stopRequested || this.state.mode !== 'running' || this.closed) {
          task.status = task.stopRequested || this.closed ? 'cancelled' : 'pending';
          if (task.status === 'cancelled') task.endedAt = Date.now();
          await this.save(); break;
        }
        try {
          // Each accepted task gets its own cwd before DSH can create files.
          // Historic queued tasks without workDir retain their original cwd.
          if (task.workDir) {
            await mkdir(task.workDir, { recursive: true });
            if (task.agentPreset) await writePresetPatch(task.workDir, task.agentPreset);
          }
          if (task.stopRequested || this.state.mode !== 'running' || this.closed) {
            task.status = task.stopRequested || this.closed ? 'cancelled' : 'pending';
            if (task.status === 'cancelled') task.endedAt = Date.now();
            await this.save(); break;
          }
          const handle = this.driver(task, this.state.config, update => {
            // A worker never gets authority to overwrite queue status or identity.
            if (typeof update.result === 'string') task.result = update.result.slice(-100000);
            if (typeof update.activity === 'string') task.activity = update.activity.slice(0, 500);
            if (update.ready && task.status === 'starting') task.status = 'running';
            this.revision++;
          });
          this.live.set(task.id, handle); task.pid = handle.pid ?? null;
          void handle.done.then(result => this.settle(task, result), error => this.settle(task, { status: 'failed', error: error.message })).catch(e => { this.state.error = e.message; this.state.mode = 'paused'; });
        } catch (e) { task.status = 'failed'; task.error = e.message; task.endedAt = Date.now(); await this.save(); }
      }
      if (this.state.mode !== 'stopped' && !this.live.size && this.state.tasks.length && this.state.tasks.every(t => TERMINAL.has(t.status))) { this.state.mode = 'finished'; await this.save(); }
    } finally { this.pumping = false; }
    // A synchronous/mock worker can finish while the pump is awaiting persistence.
    if (!this.closed && this.state.mode === 'running' && this.live.size < this.state.config.concurrency && this.state.tasks.some(t => t.status === 'pending')) this.kick();
  }
  async settle(task, result) {
    if (result.status === 'unconfirmed') {
      task.status = 'unconfirmed'; task.error = result.error; this.state.mode = 'paused';
      await this.save(); return; // Keep its slot occupied: the process might still be running.
    }
    this.live.delete(task.id);
    task.status = task.stopRequested && result.status !== 'killed' ? 'cancelled' : result.status;
    task.error = result.error ?? null; task.result = result.result ?? task.result;
    task.endedAt = Date.now(); task.pid = null;
    task.activity = '';
    if (result.fatal && this.state.mode === 'running') {
      this.state.mode = 'paused';
      this.state.error = `任务启动失败，已暂停剩余投递：${task.error}`;
    }
    await this.save(); this.kick();
  }
  async dispose() {
    this.closed = true;
    await this.stopAll(false).catch(() => {});
    await Promise.allSettled([...this.live.values()].map(h => h.done));
    await this.operation;
    await this.store.close();
  }
}
