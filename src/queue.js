import { randomUUID } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { existsSync } from 'node:fs';
import { ACTIVE, TERMINAL, validateInput, integer, LIMITS, normalizeAffix, taskFolderName, sessionTitleOf } from './validation.js';
import { writePresetPatch } from './preset-patch.js';

const keepPrefs = state => ({
  inboxDraft: typeof state?.inboxDraft === 'string' ? state.inboxDraft : '',
  composeText: typeof state?.composeText === 'string' ? state.composeText : '',
  taskPrefix: typeof state?.taskPrefix === 'string' ? state.taskPrefix : '',
  taskSuffix: typeof state?.taskSuffix === 'string' ? state.taskSuffix : '',
  batchRoot: typeof state?.batchRoot === 'string' ? state.batchRoot : '',
  concurrency: Number.isSafeInteger(state?.concurrency) ? state.concurrency : 1,
});

const fresh = (prefs = {}) => ({ schema: 1, id: null, mode: 'idle', config: null, tasks: [], createdAt: null, error: null, inboxDraft: '', composeText: '', taskPrefix: '', taskSuffix: '', batchRoot: '', concurrency: 1, ...keepPrefs(prefs) });

export class BatchQueue {
  constructor(store, driver, preflight = async () => {}) {
    this.store = store; this.driver = driver; this.preflight = preflight;
    this.state = fresh(); this.live = new Map(); this.closed = false; this.pumping = false;
    this.operation = Promise.resolve(); this.revision = 0; this.stopEpoch = 0;
    this.initialized = false; this.initialization = null; this.disposal = null;
  }
  async init() {
    this.initialization ??= this.acquireAndLoad();
    return this.initialization;
  }
  async acquireAndLoad() {
    if (this.closed) throw new Error('插件正在关闭');
    try {
      await this.store.acquire();
      this.state = await this.store.load() ?? fresh();
      Object.assign(this.state, keepPrefs(this.state));
      for (const task of this.state.tasks) if (ACTIVE.has(task.status)) {
        task.status = 'interrupted'; task.endedAt = Date.now(); task.error = '服务曾退出，执行结果未确认；不会自动重发。';
      }
      const pending = this.state.tasks.filter(t => t.status === 'pending');
      const interrupted = this.state.tasks.some(t => t.status === 'interrupted');
      if (pending.length && !this.state.composeText) {
        this.state.composeText = pending.map(t => (typeof t.source === 'string' && t.source ? t.source : t.prompt)).join('\n');
      }
      if (this.state.id && this.state.mode !== 'stopped' && this.state.mode !== 'idle') {
        this.state.mode = (pending.length || interrupted) ? 'paused' : 'finished';
      }
      await this.save();
      this.initialized = true;
    } catch (e) {
      this.closed = true;
      await this.store.close();
      throw e;
    }
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
    const result = this.operation.then(() => {
      if (this.closed) throw new Error('插件正在关闭');
      if (!this.initialized) throw new Error('批量队列未初始化');
      return fn();
    });
    this.operation = result.catch(() => {}); return result;
  }
  create(input) { const epoch = this.stopEpoch; return this.serial(async () => {
    if (this.live.size || this.state.tasks.some(t => !TERMINAL.has(t.status))) throw new Error('请先完成或停止当前批次');
    const { rows, taskPrefix, taskSuffix, ...config } = validateInput(input);
    if (!existsSync(config.cwd)) throw new Error('批次目录不存在');
    config.cwd = await realpath(config.cwd);
    await this.preflight(config);
    if (epoch !== this.stopEpoch || this.closed) throw new Error('启动准备期间已收到停止或清空指令，批次未投递');
    await this.store.archive(this.state);
    if (epoch !== this.stopEpoch || this.closed) throw new Error('启动准备期间已收到停止或清空指令，批次未投递');
    const id = `batch-${randomUUID()}`;
    const used = new Set();
    const tasks = rows.map((r, i) => {
      let folder = taskFolderName(r.source, r.line);
      let n = 2;
      while (used.has(folder.toLowerCase())) {
        folder = `${taskFolderName(r.source, r.line)}_${n++}`;
      }
      used.add(folder.toLowerCase());
      return {
        ...r,
        id: `${id}-${i + 1}`,
        title: sessionTitleOf(r.source, r.prompt),
        workDir: join(config.cwd, folder),
        workspaceRoot: config.cwd,
        groupingVersion: 2,
        agentPreset: config.agentPreset,
        sessionId: `session-${randomUUID()}`,
        status: 'pending',
        result: '',
        error: null,
        startedAt: null,
        endedAt: null,
        pid: null,
        stopRequested: false,
      };
    });
    this.state = { ...fresh(this.state), id, mode: 'running', config: { ...config, taskPrefix, taskSuffix }, createdAt: Date.now(), inboxDraft: '', composeText: typeof input.text === 'string' ? input.text : this.state.composeText, taskPrefix, taskSuffix, batchRoot: config.cwd, concurrency: config.concurrency, tasks };
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
  ackInbox() { return this.serial(async () => {
    this.state.inboxDraft = '';
    await this.save();
    return this.snapshot();
  }); }
  setAffix(input = {}) { return this.serial(async () => {
    this.state.taskPrefix = normalizeAffix(input.taskPrefix ?? input.prefix, '前缀');
    this.state.taskSuffix = normalizeAffix(input.taskSuffix ?? input.suffix, '后缀');
    await this.save();
    return this.snapshot();
  }); }
  setPrefs(input = {}) { return this.serial(async () => {
    if (input.taskPrefix !== undefined || input.prefix !== undefined) this.state.taskPrefix = normalizeAffix(input.taskPrefix ?? input.prefix, '前缀');
    if (input.taskSuffix !== undefined || input.suffix !== undefined) this.state.taskSuffix = normalizeAffix(input.taskSuffix ?? input.suffix, '后缀');
    if (typeof input.batchRoot === 'string') {
      const root = input.batchRoot.trim();
      if (root.includes('\0') || root.length > 4096) throw new Error('批次目录无效');
      this.state.batchRoot = root;
    }
    if (typeof input.composeText === 'string') {
      if (input.composeText.length > LIMITS.inputChars) throw new Error('任务文本为空或超过 400 万字符');
      this.state.composeText = input.composeText;
    }
    if (input.concurrency !== undefined) {
      this.state.concurrency = integer(input.concurrency, 1, LIMITS.concurrency, '并发会话数');
      const live = this.state.mode === 'running' || this.state.mode === 'paused' || this.live.size > 0;
      if (this.state.config && (input.applyLive || !live)) {
        this.state.config.concurrency = this.state.concurrency;
        this.state.config.serialDispatch = this.state.concurrency <= 1;
      }
    }
    await this.save();
    if (this.state.mode === 'running') this.kick();
    return this.snapshot();
  }); }
  setConcurrency(value) { return this.setPrefs({ concurrency: value, applyLive: true }); }
  /** Recover old, completed sessions into the batch root without dispatching prompts. */
  repairWorkspace(rehome, retire) { return this.serial(async () => {
    if (this.live.size || this.pumping || this.state.tasks.some(task => !TERMINAL.has(task.status))) {
      throw new Error('请先停止或完成当前批次，确认没有正在执行或待投递任务后再恢复工作区');
    }
    if (typeof rehome !== 'function' || typeof retire !== 'function') throw new Error('DSH 工作区恢复服务未就绪');
    const candidates = this.state.tasks.filter(task => task.status === 'succeeded' && task.sessionId
      && (task.groupingVersion !== 2 || (task.originalSessionId && !task.workspaceRetired)));
    if (!candidates.length) return this.snapshot();
    const cwd = await realpath(this.state.config?.cwd ?? this.state.batchRoot);
    for (const task of candidates) {
      if (task.groupingVersion !== 2) {
        // Commit a stable target identity BEFORE any durable history is copied.
        // Even a retry after a storage failure must persist this field first.
        task.workspaceCopyId ||= `session-${randomUUID()}`;
        await this.save();
        const sourceId = task.sessionId;
        let copied;
        try {
          copied = await rehome({ sourceId, targetId: task.workspaceCopyId, cwd, title: basename(cwd), sourceWorkDir: task.workDir });
          if (copied?.sessionId !== task.workspaceCopyId) throw new Error('恢复服务返回的会话 ID 与预先保存的副本 ID 不一致');
        } catch (e) {
          task.workspaceRepairError = `工作区历史恢复失败：${e.message}`;
          await this.save();
          continue;
        }
        const before = structuredClone(task);
        Object.assign(task, { originalSessionId: sourceId, sessionId: copied.sessionId, workspaceRoot: cwd, groupingVersion: 2, workspaceRetired: false });
        delete task.workspaceRepairError;
        try { await this.save(); }
        catch (e) {
          // The source must remain discoverable if committing its replacement
          // pointer fails. The already flushed copy can be reused next time.
          for (const key of Object.keys(task)) if (!Object.hasOwn(before, key)) delete task[key];
          Object.assign(task, before);
          throw e;
        }
      }
      // The replacement pointer is durable. Retirement is idempotent, so a
      // failure here or saving its marker retries only archival, never a copy.
      try {
        await retire({ sourceId: task.originalSessionId, sourceWorkDir: task.workDir, cwd: task.workspaceRoot ?? cwd });
      } catch (e) {
        task.workspaceRepairError = `原工作区整理失败：${e.message}`;
        await this.save();
        continue;
      }
      const oldRetired = task.workspaceRetired;
      const oldError = task.workspaceRepairError;
      task.workspaceRetired = true;
      delete task.workspaceRepairError;
      try { await this.save(); }
      catch (e) {
        task.workspaceRetired = oldRetired;
        if (oldError !== undefined) task.workspaceRepairError = oldError;
        throw e;
      }
    }
    return this.snapshot();
  }); }
  clear() { this.stopEpoch++; return this.serial(async () => {
    if (this.state.mode === 'running' || this.state.mode === 'paused' || this.live.size || this.state.tasks.some(t => !TERMINAL.has(t.status))) {
      throw new Error('请先停止或完成当前批次，确认没有正在执行或待投递任务后再清空列表');
    }
    if (!this.state.id && !this.state.tasks.length && this.state.mode === 'idle') return this.snapshot();
    const previous = this.state;
    this.state = fresh(previous);
    try { await this.save(); }
    catch (e) { this.state = previous; throw e; }
    return this.snapshot();
  }); }
  /** Flag synchronously, before persistence or spawn awaits: stop wins admission races. */
  stopAll(force = false) {
    if (this.closed) return Promise.reject(new Error('插件正在关闭'));
    return this.stopOwned(force);
  }
  stopOwned(force = false) {
    if (!this.initialized) return Promise.reject(new Error('批量队列未初始化'));
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
    if (this.closed) return Promise.reject(new Error('插件正在关闭'));
    if (!this.initialized) return Promise.reject(new Error('批量队列未初始化'));
    const task = this.state.tasks.find(t => t.id === id);
    if (!task) return Promise.reject(new Error('任务不存在'));
    if (task.status === 'pending') { task.status = 'cancelled'; task.endedAt = Date.now(); }
    else if (ACTIVE.has(task.status)) { task.stopRequested = true; task.status = 'stopping'; this.live.get(id)?.stop(force); }
    return this.save().then(() => this.snapshot());
  }
  kick() { if (!this.pumping && !this.closed) void this.pump().catch(e => {
    if (this.state.mode === 'idle' || this.state.mode === 'stopped') return;
    this.state.mode = 'paused'; this.state.error = e.message;
  }); }
  async pump() {
    if (this.pumping) return; this.pumping = true;
    try {
      if (!this.state.config) return;
      const slots = this.dispatchSlots();
      while (!this.closed && this.state.mode === 'running' && this.live.size < slots) {
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
            // Match the official workspace registry's native path identity,
            // including Windows short paths and filesystem aliases.
            task.workDir = await realpath(task.workDir);
            if (task.agentPreset) await writePresetPatch(task.workDir, task.agentPreset);
            await this.save();
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
    if (!this.closed && this.state.mode === 'running' && this.state.config && this.live.size < this.dispatchSlots() && this.state.tasks.some(t => t.status === 'pending')) this.kick();
  }
  dispatchSlots() {
    if (!this.state.config) return 0;
    return this.state.config.serialDispatch === false ? this.state.config.concurrency : 1;
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
    this.disposal ??= this.performDispose();
    return this.disposal;
  }
  async performDispose() {
    if (this.initialization) await this.initialization.catch(() => {});
    this.closed = true;
    // A failed acquisition/load never grants authority over another owner's
    // persisted queue. init already releases any partially acquired handle.
    if (!this.initialized) return;
    await this.stopOwned(false).catch(() => {});
    await Promise.allSettled([...this.live.values()].map(h => h.done));
    await this.operation;
    await this.store.close();
  }
}
