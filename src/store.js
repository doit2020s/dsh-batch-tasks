import { mkdir, readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
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
      const owner = JSON.parse(await readFile(this.lock, 'utf8'));
      let alive = true;
      try { process.kill(owner.pid, 0); } catch (err) { if (err.code === 'ESRCH') alive = false; }
      if (alive) throw new Error('批量面板已由另一 DSH 进程运行，请勿同时打开两个共享此数据目录的面板');
      await unlink(this.lock);
      this.lockHandle = await open(this.lock, 'wx');
    }
    await this.lockHandle.writeFile(JSON.stringify({ pid: process.pid, started: Date.now() }));
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
    if (this.lockHandle) { await this.lockHandle.close(); await unlink(this.lock).catch(() => {}); this.lockHandle = null; }
  }
}
