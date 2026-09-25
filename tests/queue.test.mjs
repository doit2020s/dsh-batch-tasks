import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BatchQueue } from '../src/queue.js';
import { Store } from '../src/store.js';
import { parseTasks, validateInput } from '../src/validation.js';

const workRoot = await mkdtemp(join(tmpdir(), 'dsh-batch-work-'));
const input = (n = 5) => ({ text: Array.from({ length: n }, (_, i) => `任务 ${i + 1}`).join('\n'), concurrency: 2, cwd: workRoot, provider: 'test', model: 'test', agentPreset: 'standard', timeoutMinutes: 1 });
const tick = () => new Promise(r => setTimeout(r, 5));
async function until(fn) { for (let i = 0; i < 400; i++) { if (fn()) return; await tick(); } throw new Error('condition timeout'); }
async function harness(preflight) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-batch-unit-'));
  const workers = [], store = new Store(directory);
  const queue = new BatchQueue(store, (task, config) => {
    let finish; const done = new Promise(r => { finish = r; });
    const worker = { task, config, done, finish, stop: force => { worker.stops.push(force); finish({ status: force ? 'killed' : 'cancelled' }); }, stops: [] };
    workers.push(worker); return worker;
  }, preflight);
  await queue.init(); return { queue, workers, store, directory };
}
test('UTF-8 BOM, CRLF, empty lines, duplicates, original line numbers', () => {
  assert.deepEqual(parseTasks('\uFEFF甲\r\n\r\n甲\r乙'), [{ prompt: '甲', line: 1 }, { prompt: '甲', line: 3 }, { prompt: '乙', line: 4 }]);
  for (const n of [0, 17, 2.5, NaN]) assert.throws(() => validateInput({ ...input(), concurrency: n }));
  assert.throws(() => validateInput({ ...input(), profile: '../web' }));
  assert.throws(() => validateInput({ ...input(), agentPreset: '' }));
  assert.throws(() => parseTasks(' \n '));
});
test('each dispatched line has a durable, separate working directory', async () => {
  const { queue, workers, store } = await harness();
  const state = await queue.create(input(3));
  await until(() => workers.length === 2);
  const expected = state.tasks.map((task, i) => join(workRoot, state.id, `task-${String(i + 1).padStart(5, '0')}`));
  assert.deepEqual(state.tasks.map(t => t.workDir), expected);
  assert.deepEqual(state.tasks.map(t => t.agentPreset), ['standard', 'standard', 'standard']);
  assert.equal(new Set(expected).size, 3);
  assert.equal(workers[0].config.cwd, workRoot);
  assert.ok((await stat(expected[0])).isDirectory());
  assert.ok((await stat(expected[1])).isDirectory());
  assert.match(await readFile(join(expected[0], '.dsh-batch-preset.patch.yml'), 'utf8'), /default: "standard"/);
  await assert.rejects(stat(expected[2]), { code: 'ENOENT' });
  await writeFile(join(expected[0], 'same-name.txt'), '任务一');
  await writeFile(join(expected[1], 'same-name.txt'), '任务二');
  assert.equal(await readFile(join(expected[0], 'same-name.txt'), 'utf8'), '任务一');
  assert.equal(await readFile(join(expected[1], 'same-name.txt'), 'utf8'), '任务二');
  assert.deepEqual((await store.load()).tasks.map(t => t.workDir), expected);
  workers[0].finish({ status: 'succeeded' });
  await until(() => workers.length === 3);
  assert.ok((await stat(expected[2])).isDirectory());
  await queue.stopAll(); await queue.dispose();
});
test('100 jobs, concurrency bound, fresh identities and auto refill', async () => {
  const { queue, workers } = await harness();
  await queue.create(input(100)); await until(() => workers.length === 2); let index = 0, max = 0;
  while (index < 100) {
    await until(() => workers[index]); max = Math.max(max, queue.live.size);
    assert.ok(queue.live.size <= 2);
    workers[index++].finish({ status: 'succeeded', result: '完成' });
  }
  await until(() => queue.state.mode === 'finished');
  assert.equal(max, 2); assert.equal(queue.snapshot().counts.succeeded, 100);
  assert.equal(new Set(workers.map(w => w.task.sessionId)).size, 100);
  await queue.dispose();
});
test('pause drains active work without dispatch, resume refills', async () => {
  const { queue, workers } = await harness(); await queue.create(input()); await until(() => workers.length === 2);
  await queue.pause(); workers[0].finish({ status: 'succeeded' }); workers[1].finish({ status: 'failed' });
  await until(() => queue.live.size === 0); assert.equal(workers.length, 2);
  await queue.resume(); await until(() => workers.length === 4); await queue.stopAll(); await queue.dispose();
});
test('preset startup failure keeps its full diagnostic, and stop cancels the remaining queue', async () => {
  const { queue, workers, store, directory } = await harness();
  await queue.create(input(20)); await until(() => workers.length === 2);
  const reason = 'Agent 预设挂载失败：failed to import loader entry: Cannot find package @example/missing-plugin';
  workers[0].finish({ status: 'failed', error: reason, fatal: true });
  await until(() => queue.state.mode === 'paused');
  assert.equal(workers.length, 2);
  assert.equal(queue.snapshot().counts.pending, 18);
  assert.equal(queue.state.error, `任务启动失败，已暂停剩余投递：${reason}`);
  await store.chain;
  const saved = await store.load();
  assert.equal(saved.tasks[0].error, reason);
  assert.equal(saved.error, queue.state.error);
  await queue.stopAll();
  await until(() => queue.live.size === 0);
  assert.equal(queue.state.mode, 'stopped');
  assert.equal(queue.snapshot().counts.pending ?? 0, 0);
  assert.equal(queue.snapshot().counts.cancelled, 19);
  assert.equal(workers.length, 2);
  await queue.dispose();
  const reopened = new BatchQueue(new Store(directory), () => { throw new Error('must not replay'); });
  await reopened.init();
  assert.equal(reopened.state.mode, 'stopped');
  assert.equal(reopened.snapshot().counts.pending ?? 0, 0);
  await reopened.dispose();
});
test('stop all racing worker completion never dispatches remaining jobs', async () => {
  const { queue, workers } = await harness(); await queue.create(input(100)); await until(() => workers.length === 2);
  workers[0].finish({ status: 'succeeded' }); await queue.stopAll(true);
  await until(() => queue.live.size === 0); await tick();
  assert.equal(workers.length, 2); assert.equal(queue.state.tasks.filter(t => t.status === 'pending').length, 0);
  assert.ok(workers[1].stops.includes(true)); await queue.dispose();
});
test('clear removes only the finished current list and persists an empty queue', async () => {
  const { queue, workers, store, directory } = await harness();
  const batch = await queue.create(input(2)); await until(() => workers.length === 2);
  const output = join(batch.tasks[0].workDir, 'keep.txt');
  await writeFile(output, '保留任务文件');
  workers[0].finish({ status: 'succeeded' }); workers[1].finish({ status: 'failed', error: 'test' });
  await until(() => queue.state.mode === 'finished' && queue.live.size === 0);
  const cleared = await queue.clear();
  assert.equal(cleared.mode, 'idle'); assert.equal(cleared.id, null);
  assert.deepEqual(cleared.tasks, []); assert.deepEqual(cleared.counts, {});
  assert.equal(await readFile(output, 'utf8'), '保留任务文件');
  assert.deepEqual((await store.load()).tasks, []);
  await assert.rejects(stat(join(directory, `${batch.id}.json`)), { code: 'ENOENT' });
  await queue.dispose();
  const reopened = new BatchQueue(new Store(directory), () => { throw new Error('must not replay'); });
  await reopened.init();
  assert.equal(reopened.state.mode, 'idle'); assert.deepEqual(reopened.state.tasks, []);
  await reopened.dispose();
});
test('clear rejects running or pending work, then succeeds after stop settles', async () => {
  const { queue, workers, store } = await harness();
  await queue.create(input(3)); await until(() => workers.length === 2);
  await assert.rejects(queue.clear(), /请先停止或完成当前批次/);
  assert.equal((await store.load()).tasks.length, 3);
  await queue.pause();
  await assert.rejects(queue.clear(), /请先停止或完成当前批次/);
  await queue.stopAll(); await until(() => queue.live.size === 0);
  assert.equal(workers.length, 2);
  const cleared = await queue.clear();
  assert.equal(cleared.mode, 'idle'); assert.deepEqual(cleared.tasks, []);
  await queue.dispose();
});
test('clear storage failure keeps the original list visible', async () => {
  const { queue, workers, store } = await harness();
  const batch = await queue.create(input(1)); await until(() => workers.length === 1);
  workers[0].finish({ status: 'succeeded' }); await until(() => queue.state.mode === 'finished');
  const originalSave = store.save.bind(store);
  store.save = async () => { throw new Error('disk full'); };
  await assert.rejects(queue.clear(), /disk full/);
  assert.equal(queue.snapshot().id, batch.id);
  assert.equal(queue.snapshot().tasks.length, 1);
  store.save = originalSave;
  await queue.dispose();
});
test('clear during start preflight prevents late dispatch and leaves no archived list', async () => {
  let notify, release, calls = 0;
  const waiting = new Promise(resolve => { notify = resolve; });
  const { queue, workers, store, directory } = await harness(async () => {
    if (++calls === 2) { notify(); await new Promise(resolve => { release = resolve; }); }
  });
  const first = await queue.create(input(1)); await until(() => workers.length === 1);
  workers[0].finish({ status: 'succeeded' }); await until(() => queue.state.mode === 'finished');
  const starting = queue.create(input(1)); await waiting;
  const clearing = queue.clear(); release();
  await assert.rejects(starting, /清空指令/);
  assert.deepEqual((await clearing).tasks, []);
  assert.deepEqual((await store.load()).tasks, []);
  assert.equal(workers.length, 1);
  await assert.rejects(stat(join(directory, `${first.id}.json`)), { code: 'ENOENT' });
  await queue.dispose();
});
test('clear during start persistence cancels the new batch before any worker launches', async () => {
  const { queue, workers, store } = await harness();
  let notify, release;
  const waiting = new Promise(resolve => { notify = resolve; });
  const originalSave = store.save.bind(store);
  store.save = async state => {
    if (state.mode === 'running') { notify(); await new Promise(resolve => { release = resolve; }); }
    return originalSave(state);
  };
  const starting = queue.create(input(2)); await waiting;
  const clearing = queue.clear(); release();
  await assert.rejects(starting, /清空指令/);
  assert.deepEqual((await clearing).tasks, []);
  assert.deepEqual((await store.load()).tasks, []);
  assert.equal(workers.length, 0);
  store.save = originalSave;
  await queue.dispose();
});
test('stop during async startup preparation prevents late launch', async () => {
  let ready, release;
  const started = new Promise(r => { ready = r; });
  const { queue, workers } = await harness(async () => { ready(); await new Promise(r => { release = r; }); });
  const created = queue.create(input()); await started; await queue.stopAll(); release();
  await assert.rejects(created, /停止/); assert.equal(workers.length, 0); await queue.dispose();
});
test('reduce concurrency does not kill running jobs or exceed new ceiling', async () => {
  const { queue, workers } = await harness(); await queue.create(input()); await until(() => workers.length === 2);
  await queue.setConcurrency(1); workers[0].finish({ status: 'succeeded' }); await until(() => queue.live.size === 1); await tick();
  assert.equal(workers.length, 2); workers[1].finish({ status: 'succeeded' }); await until(() => workers.length === 3);
  assert.equal(queue.live.size, 1); await queue.stopAll(); await queue.dispose();
});
test('restart marks active tasks interrupted and does not replay pending jobs', async () => {
  const { queue, workers, store, directory } = await harness(); await queue.create(input()); await until(() => workers.length === 2);
  const saved = structuredClone(queue.state);
  delete saved.config.agentPreset;
  for (const task of saved.tasks) delete task.agentPreset;
  await queue.stopAll(); await queue.dispose();
  await store.save(saved);
  const q2 = new BatchQueue(new Store(directory), () => { throw new Error('must not replay'); }); await q2.init();
  assert.equal(q2.state.mode, 'paused'); assert.equal(q2.snapshot().counts.interrupted, 2); assert.equal(q2.snapshot().counts.pending, 3);
  await assert.rejects(q2.resume(), /旧批次未绑定 Agent 预设/);
  await q2.dispose();
});
test('one process owns queue; corrupt storage is not silently reset', async () => {
  const { queue, directory } = await harness(); const other = new Store(directory);
  await assert.rejects(other.acquire(), /另一 DSH/); await queue.dispose();
  await writeFile(join(directory, 'queue.json'), '{broken');
  const q2 = new BatchQueue(new Store(directory), () => {}); await assert.rejects(q2.init());
  assert.equal(await readFile(join(directory, 'queue.json'), 'utf8'), '{broken');
});
