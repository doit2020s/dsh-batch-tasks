import { mkdir, readFile, writeFile, rename, open, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Single-writer persistent queue. Corruption fails closed; never silently discards jobs. */
export class Store {
  constructor(directory) { this.directory = directory; this.file = join(directory, 'queue.json'); this.chain = Promise.resolve(); }
  async acquire() {
    await mkdir(this.directory, { recursive: true });
    this.lock = join(this.directory, 'owner.lock');
    try { this.lockHandle = await open(this.lock, 'wx'); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const raw = await readFile(this.lock, 'utf8');
      let owner = null;
      try { owner = JSON.parse(raw); } catch { owner = null; }
      let alive = false;
      if (Number.isInteger(owner?.pid)) {
        if (owner.pid === process.pid) alive = true;
        else {
          try { process.kill(owner.pid, 0); alive = true; } catch (err) { if (err.code !== 'ESRCH') throw err; }
        }
      }
      const incomplete = !Number.isInteger(owner?.pid) || owner.pid <= 0;
      const age = Date.now() - (await stat(this.lock)).mtimeMs;
      if (alive || (incomplete && age < 120000)) {
        throw new Error('批量面板已由另一 DSH 进程运行，请勿同时打开两个共享此数据目录的面板');
      }
      if (await readFile(this.lock, 'utf8') !== raw) throw new Error('批量队列所有者正在变化，请稍后重试');
      await unlink(this.lock);
      this.lockHandle = await open(this.lock, 'wx');
    }
    this.owner = JSON.stringify({ pid: process.pid, started: Date.now(), token: randomUUID() });
    await this.lockHandle.writeFile(this.owner);
    await this.lockHandle.sync();
  }
  async load() {
    try {
      const state = JSON.parse(await readFile(this.file, 'utf8'));
      if (state.schema !== 1 || !Array.isArray(state.tasks)) throw new Error('批量队列格式不兼容');
      return state;
    } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  save(state) {
    const content = JSON.stringify(state, null, 2);
    const pending = this.chain.then(async () => {
      const temp = `${this.file}.${randomUUID()}.tmp`;
      const f = await open(temp, 'wx');
      try { await f.writeFile(content); await f.sync(); } finally { await f.close(); }
      try { await rename(temp, this.file); } catch (e) { await unlink(temp).catch(() => {}); throw e; }
    });
    this.chain = pending.catch(() => {});
    return pending;
  }
  async archive(state) {
    if (!state.id) return;
    await writeFile(join(this.directory, `${state.id}.json`), JSON.stringify(state, null, 2), { flag: 'wx' }).catch(e => { if (e.code !== 'EEXIST') throw e; });
  }
  async close() {
    await this.chain;
    if (this.lockHandle) {
      await this.lockHandle.close();
      if (await readFile(this.lock, 'utf8').catch(() => null) === this.owner) await unlink(this.lock).catch(() => {});
      this.lockHandle = null;
    }
  }
}
