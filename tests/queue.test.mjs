import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { BatchQueue } from '../src/queue.js';
import { Store } from '../src/store.js';
import { parseTasks, validateInput, composePrompt } from '../src/validation.js';

const workRoot = await realpath(await mkdtemp(join(tmpdir(), 'dsh-batch-work-')));
const input = (n = 5) => ({ text: Array.from({ length: n }, (_, i) => `任务 ${i + 1}`).join('\n'), concurrency: 2, serialDispatch: false, cwd: workRoot, provider: 'test', model: 'test', agentPreset: 'standard', timeoutMinutes: 1 });
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
  const wrapped = validateInput({ ...input(2), taskPrefix: '前：', taskSuffix: '：后' });
  assert.equal(composePrompt('前：', '任务 1', '：后'), '前：任务 1：后');
  assert.deepEqual(wrapped.rows.map(r => [r.source, r.prompt]), [['任务 1', '前：任务 1：后'], ['任务 2', '前：任务 2：后']]);
  assert.equal(wrapped.taskPrefix, '前：');
  assert.equal(wrapped.taskSuffix, '：后');
});
test('batch root and concurrency persist across clear', async () => {
  const { queue, workers } = await harness();
  await queue.setPrefs({ batchRoot: workRoot, concurrency: 4 });
  const created = await queue.create({ ...input(2), concurrency: 4, cwd: workRoot });
  await until(() => workers.length >= 1);
  assert.equal(created.batchRoot, workRoot);
  assert.equal(created.concurrency, 4);
  await queue.stopAll();
  await until(() => queue.live.size === 0 && queue.state.tasks.every(task => task.status === 'cancelled'));
  const cleared = await queue.clear();
  assert.equal(cleared.batchRoot, workRoot);
  assert.equal(cleared.concurrency, 4);
  await queue.dispose();
});
test('workspace publication persists independently of task completion and cannot resurrect a cleared task', async () => {
  const { queue, workers, directory } = await harness();
  try {
    await queue.create(input(1));
    await until(() => workers.length === 1);
    const task = workers[0].task;
    await queue.updateWorkspaceListing(task.id, { error: 'listing storage unavailable' });
    workers[0].finish({ status: 'succeeded', result: '5' });
    await until(() => task.status === 'succeeded' && queue.state.mode === 'finished');
    assert.equal(task.workspaceAttachError, 'listing storage unavailable');
    assert.equal(task.activity, '');
    let releaseOperation;
    queue.markWorkspaceListingPending(task.id, true);
    const blocked = new Promise(resolve => { releaseOperation = resolve; });
    queue.operation = queue.operation.then(() => blocked);
    const publication = queue.updateWorkspaceListing(task.id, { workspaceId: 'root-workspace', listingReady: true }, () => false);
    await tick();
    assert.equal(task.workspaceListingPending, true, 'Blocked publication cleared pending before its revision');
    assert.equal(task.workspaceListingRevision, undefined);
    releaseOperation(); await publication;
    assert.equal(task.workspaceListingPending, false);
    const saved = JSON.parse(await readFile(join(directory, 'queue.json'), 'utf8'));
    assert.equal(saved.tasks[0].status, 'succeeded');
    assert.equal(saved.tasks[0].result, '5');
    assert.equal(saved.tasks[0].workspaceId, 'root-workspace');
    assert.equal(saved.tasks[0].workspaceListingReady, true);
    assert.equal(saved.tasks[0].workspaceListingRevision, 1);
    assert.equal(saved.tasks[0].workspaceAttachError, undefined);
    await queue.clear();
    assert.equal(await queue.updateWorkspaceListing(task.id, { workspaceId: 'root-workspace', listingReady: true }), false);
    assert.deepEqual(queue.state.tasks, []);
  } finally { await queue.dispose(); }
});
test('prefix and suffix persist across start, clear and reopen', async () => {
  const { queue, workers, store, directory } = await harness();
  await queue.setAffix({ taskPrefix: '对站点 ', taskSuffix: ' 做独立站测试' });
  const created = await queue.create({ ...input(2), taskPrefix: '对站点 ', taskSuffix: ' 做独立站测试' });
  await until(() => workers.length === 2);
  assert.equal(created.tasks[0].source, '任务 1');
  assert.equal(created.tasks[0].prompt, '对站点 任务 1 做独立站测试');
  assert.equal(created.taskPrefix, '对站点 ');
  workers[0].finish({ status: 'succeeded' });
  workers[1].finish({ status: 'succeeded' });
  await until(() => queue.state.mode === 'finished');
  const cleared = await queue.clear();
  assert.equal(cleared.taskPrefix, '对站点 ');
  assert.equal(cleared.taskSuffix, ' 做独立站测试');
  assert.equal((await store.load()).taskPrefix, '对站点 ');
  await queue.dispose();
  const reopened = new BatchQueue(new Store(directory), () => { throw new Error('must not replay'); });
  await reopened.init();
  assert.equal(reopened.state.taskPrefix, '对站点 ');
  assert.equal(reopened.state.taskSuffix, ' 做独立站测试');
  await reopened.dispose();
});
test('restart returns original lines to inbox without wrapping twice', async () => {
  const { queue, workers, store, directory } = await harness();
  await queue.create({ ...input(3), serialDispatch: false, concurrency: 2, taskPrefix: 'P:', taskSuffix: ':S' });
  await until(() => workers.length === 2);
  const saved = structuredClone(queue.state);
  await queue.stopAll(); await queue.dispose();
  await store.save(saved);
  const q2 = new BatchQueue(new Store(directory), () => { throw new Error('must not replay'); });
  await q2.init();
  assert.equal(q2.snapshot().counts.pending, 1);
  assert.equal(q2.state.mode, 'paused');
  assert.match(q2.state.composeText, /任务 3/);
  assert.doesNotMatch(q2.state.composeText, /P:任务 3:S/);
  assert.equal(q2.state.taskPrefix, 'P:');
  await q2.dispose();
});
test('each dispatched line has a durable, separate working directory', async () => {
  const { queue, workers, store } = await harness();
  const state = await queue.create(input(3));
  await until(() => workers.length === 2);
  const expected = ['任务 1', '任务 2', '任务 3'].map(name => join(workRoot, name));
  assert.deepEqual(state.tasks.map(t => t.workDir), expected);
  assert.deepEqual(state.tasks.map(t => t.agentPreset), ['standard', 'standard', 'standard']);
  assert.equal(new Set(expected).size, 3);
  assert.equal(workers[0].config.cwd, workRoot);
  assert.equal(state.tasks[0].title, '任务 1');
  assert.equal(state.batchRoot, workRoot);
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
test('setPrefs without applyLive does not rewrite a running batch concurrency', async () => {
  const { queue, workers } = await harness();
  await queue.create({ ...input(4), concurrency: 4, serialDispatch: false });
  await until(() => workers.length === 4);
  assert.equal(queue.state.config.concurrency, 4);
  await queue.setPrefs({ concurrency: 1 });
  assert.equal(queue.state.config.concurrency, 4);
  assert.equal(queue.state.config.serialDispatch, false);
  assert.equal(queue.state.concurrency, 1);
  assert.equal(queue.live.size, 4);
  await queue.setConcurrency(2);
  assert.equal(queue.state.config.concurrency, 2);
  await queue.stopAll(); await queue.dispose();
});
test('raising concurrency mid-batch starts more workers', async () => {
  const { queue, workers } = await harness();
  await queue.create({ ...input(4), concurrency: 1, serialDispatch: true });
  await until(() => workers.length === 1);
  await queue.setConcurrency(3);
  await until(() => workers.length === 3);
  assert.equal(queue.live.size, 3);
  assert.equal(queue.state.config.serialDispatch, false);
  await queue.stopAll(); await queue.dispose();
});
test('serial dispatch default keeps one live worker until it finishes', async () => {
  const { queue, workers } = await harness();
  const { serialDispatch: _ignored, ...rest } = input(4);
  await queue.create({ ...rest, concurrency: 4 });
  await until(() => workers.length === 1);
  await tick();
  assert.equal(queue.state.config.serialDispatch, true);
  assert.equal(workers.length, 1);
  assert.equal(queue.live.size, 1);
  workers[0].finish({ status: 'succeeded' });
  await until(() => workers.length === 2);
  await tick();
  assert.equal(workers.length, 2);
  assert.equal(queue.live.size, 1);
  await queue.stopAll(); await queue.dispose();
});
test('inbox draft stays after reopen until a new batch starts', async () => {
  const { queue, workers, store, directory } = await harness();
  await queue.create(input(3)); await until(() => workers.length === 2);
  const saved = structuredClone(queue.state);
  await queue.stopAll(); await queue.dispose();
  await store.save(saved);
  const q2 = new BatchQueue(new Store(directory), () => { throw new Error('must not replay'); });
  await q2.init();
  assert.equal(q2.snapshot().counts.pending, 1);
  assert.equal(q2.state.mode, 'paused');
  assert.match(q2.state.composeText, /任务 3/);
  const draft = q2.state.composeText;
  await q2.dispose();
  const q3 = new BatchQueue(new Store(directory), () => { throw new Error('must not replay'); });
  await q3.init();
  assert.equal(q3.state.composeText, draft);
  await q3.dispose();
});
test('restart marks active tasks interrupted and does not replay pending jobs', async () => {
  const { queue, workers, store, directory } = await harness(); await queue.create(input()); await until(() => workers.length === 2);
  const saved = structuredClone(queue.state);
  delete saved.config.agentPreset;
  for (const task of saved.tasks) delete task.agentPreset;
  await queue.stopAll(); await queue.dispose();
  await store.save(saved);
  const q2 = new BatchQueue(new Store(directory), () => { throw new Error('must not replay'); }); await q2.init();
  assert.equal(q2.state.mode, 'paused');
  assert.equal(q2.snapshot().counts.interrupted, 2);
  assert.equal(q2.snapshot().counts.pending, 3);
  await assert.rejects(q2.resume(), /Agent 预设/);
  await q2.dispose();
});
test('one process owns queue; corrupt storage is not silently reset', async () => {
  const { queue, directory } = await harness(); const other = new Store(directory);
  await assert.rejects(other.acquire(), /另一 DSH/); await queue.dispose();
  await writeFile(join(directory, 'queue.json'), '{broken');
  const q2 = new BatchQueue(new Store(directory), () => {}); await assert.rejects(q2.init());
  assert.equal(await readFile(join(directory, 'queue.json'), 'utf8'), '{broken');
});

test('failed load releases ownership and dispose preserves corrupt bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-batch-load-failure-'));
  const file = join(directory, 'queue.json');
  await writeFile(file, '{broken');
  const queue = new BatchQueue(new Store(directory), () => { throw new Error('must not run'); });
  await assert.rejects(queue.init());
  await queue.dispose();
  assert.equal(await readFile(file, 'utf8'), '{broken');
  const replacement = new Store(directory);
  await replacement.acquire();
  await replacement.close();
});

test('failed acquisition and uninitialized disposal cannot rewrite another queue', async () => {
  const { queue: owner, store, directory } = await harness();
  await owner.setPrefs({ composeText: 'owner draft' });
  const before = await readFile(store.file, 'utf8');
  const rejected = new BatchQueue(new Store(directory), () => {});
  await assert.rejects(rejected.init(), /另一 DSH/);
  await rejected.dispose();
  const uninitialized = new BatchQueue(new Store(directory), () => {});
  await uninitialized.dispose();
  assert.equal(await readFile(store.file, 'utf8'), before);
  await assert.rejects(new Store(directory).acquire(), /另一 DSH/);
  await owner.dispose();
});

test('partial acquisition failure closes its handle without saving', async () => {
  let closes = 0;
  const store = {
    acquire: async () => { throw new Error('owner sync failed'); },
    close: async () => { closes++; },
    save: async () => { throw new Error('must not save'); },
  };
  const queue = new BatchQueue(store, () => {});
  await assert.rejects(queue.init(), /owner sync failed/);
  await queue.dispose();
  assert.equal(closes, 1);
});

test('a disposed queue cannot stop or save over a later owner', async () => {
  const { queue, directory } = await harness();
  await queue.dispose();
  const next = new BatchQueue(new Store(directory), () => {});
  await next.init();
  try {
    await next.setPrefs({ composeText: 'new owner' });
    const before = await readFile(join(directory, 'queue.json'), 'utf8');
    await assert.rejects(queue.stopAll(), /关闭/);
    await assert.rejects(queue.stopOne('old-task'), /关闭/);
    await queue.dispose();
    assert.equal(await readFile(join(directory, 'queue.json'), 'utf8'), before);
  } finally { await next.dispose(); }
});

async function repairHarness(t, tasks) {
  let saved = {
    schema: 1, id: 'legacy-batch', mode: 'finished', config: input(1), createdAt: 1,
    tasks: tasks ?? [{ id: 'legacy-one', sessionId: 'old-session-one', workDir: join(workRoot, 'task-one'), title: '你好', prompt: '你好', status: 'succeeded', result: '你好！' }],
  };
  const writes = [];
  const store = {
    acquire: async () => {}, load: async () => structuredClone(saved), close: async () => {},
    save: async state => {
      if (store.fail?.(state)) throw new Error('repair disk full');
      saved = structuredClone(state); writes.push(saved);
    },
  };
  const queue = new BatchQueue(store, () => { throw new Error('history repair must never run a model or tool'); });
  await queue.init(); writes.length = 0;
  t.after(async () => { store.fail = undefined; await queue.dispose(); });
  return { queue, store, writes, persisted: () => structuredClone(saved) };
}

test('workspace repair commits a stable identity and root pointer before retiring source without rerunning tasks', async t => {
  const f = await repairHarness(t);
  let copied, retired;
  const result = await f.queue.repairWorkspace(async payload => {
    copied = payload;
    const saved = f.persisted().tasks[0];
    assert.equal(saved.workspaceCopyId, payload.targetId);
    assert.equal(saved.sessionId, payload.sourceId);
    assert.match(payload.targetId, /^session-[0-9a-f-]{36}$/);
    assert.equal(payload.cwd, workRoot);
    assert.equal(payload.title, basename(workRoot));
    assert.equal(payload.sourceWorkDir, join(workRoot, 'task-one'));
    return { sessionId: payload.targetId, path: payload.cwd };
  }, async payload => {
    retired = payload;
    const saved = f.persisted().tasks[0];
    assert.equal(saved.sessionId, copied.targetId);
    assert.equal(saved.originalSessionId, copied.sourceId);
    assert.equal(saved.groupingVersion, 2);
    assert.equal(saved.workspaceRetired, false);
  });
  assert.equal(result.tasks[0].workspaceRetired, true);
  assert.equal(result.tasks[0].workspaceRoot, workRoot);
  assert.equal(result.tasks[0].result, '你好！');
  assert.equal(result.tasks[0].status, 'succeeded');
  assert.deepEqual(retired, { sourceId: 'old-session-one', sourceWorkDir: join(workRoot, 'task-one'), cwd: workRoot });
  assert.equal(f.writes.length, 3);
  assert.equal(f.persisted().tasks[0].workspaceRetired, true);
});

test('workspace repair retries a failed copy using the same durable target identity', async t => {
  const f = await repairHarness(t);
  let attempts = 0, target, retires = 0;
  const rehome = async payload => {
    target ??= payload.targetId;
    assert.equal(payload.targetId, target);
    assert.equal(payload.sourceId, 'old-session-one');
    if (++attempts === 1) throw new Error('registry temporarily unavailable');
    return { sessionId: target };
  };
  const failed = await f.queue.repairWorkspace(rehome, async () => { retires++; });
  assert.match(failed.tasks[0].workspaceRepairError, /registry temporarily unavailable/);
  assert.equal(failed.tasks[0].sessionId, 'old-session-one');
  assert.equal(retires, 0);
  const repaired = await f.queue.repairWorkspace(rehome, async () => { retires++; });
  assert.equal(attempts, 2);
  assert.equal(retires, 1);
  assert.equal(repaired.tasks[0].sessionId, target);
  assert.equal(repaired.tasks[0].workspaceRepairError, undefined);
});

test('replacement pointer save failure preserves the original identity and never retires it', async t => {
  const f = await repairHarness(t);
  let copies = 0, retires = 0, target;
  const rehome = async payload => { copies++; target ??= payload.targetId; assert.equal(payload.targetId, target); return { sessionId: payload.targetId }; };
  const retire = async () => { retires++; };
  f.store.fail = state => state.tasks[0].sessionId !== 'old-session-one';
  await assert.rejects(f.queue.repairWorkspace(rehome, retire), /repair disk full/);
  assert.equal(retires, 0);
  assert.equal(f.queue.state.tasks[0].sessionId, 'old-session-one');
  assert.equal(f.queue.state.tasks[0].originalSessionId, undefined);
  assert.equal(f.queue.state.tasks[0].groupingVersion, undefined);
  assert.equal(f.persisted().tasks[0].sessionId, 'old-session-one');
  assert.equal(f.persisted().tasks[0].workspaceCopyId, target);
  f.store.fail = undefined;
  await f.queue.repairWorkspace(rehome, retire);
  assert.equal(copies, 2);
  assert.equal(retires, 1);
  assert.equal(f.persisted().tasks[0].sessionId, target);
});

test('failure saving a target identity prevents copy and archival, then retries that identity', async t => {
  const f = await repairHarness(t);
  let copies = 0, retires = 0;
  f.store.fail = () => true;
  const rehome = async payload => { copies++; return { sessionId: payload.targetId }; };
  const retire = async () => { retires++; };
  await assert.rejects(f.queue.repairWorkspace(rehome, retire), /repair disk full/);
  assert.equal(copies, 0); assert.equal(retires, 0);
  const stableId = f.queue.state.tasks[0].workspaceCopyId;
  assert.equal(f.persisted().tasks[0].workspaceCopyId, undefined);
  f.store.fail = undefined;
  await f.queue.repairWorkspace(rehome, retire);
  assert.equal(f.persisted().tasks[0].sessionId, stableId);
  assert.equal(copies, 1); assert.equal(retires, 1);
});

test('retirement failure retries only retirement for a durably repaired task', async t => {
  const f = await repairHarness(t);
  let copies = 0, retires = 0;
  const rehome = async payload => { copies++; return { sessionId: payload.targetId }; };
  const retire = async () => { if (++retires === 1) throw new Error('archive unavailable'); };
  const first = await f.queue.repairWorkspace(rehome, retire);
  assert.equal(first.tasks[0].groupingVersion, 2);
  assert.equal(first.tasks[0].workspaceRetired, false);
  assert.match(first.tasks[0].workspaceRepairError, /archive unavailable/);
  await f.queue.repairWorkspace(rehome, retire);
  assert.equal(copies, 1); assert.equal(retires, 2);
  assert.equal(f.persisted().tasks[0].workspaceRetired, true);
});

test('retirement marker save failure can safely retry retirement without copying again', async t => {
  const f = await repairHarness(t);
  let copies = 0, retires = 0;
  const rehome = async payload => { copies++; return { sessionId: payload.targetId }; };
  const retire = async () => { retires++; };
  f.store.fail = state => state.tasks[0].workspaceRetired === true;
  await assert.rejects(f.queue.repairWorkspace(rehome, retire), /repair disk full/);
  assert.equal(f.queue.state.tasks[0].workspaceRetired, false);
  assert.equal(f.persisted().tasks[0].workspaceRetired, false);
  f.store.fail = undefined;
  await f.queue.repairWorkspace(rehome, retire);
  assert.equal(copies, 1); assert.equal(retires, 2);
  assert.equal(f.persisted().tasks[0].workspaceRetired, true);
});

test('unsupported history and unsuccessful tasks do not block another completed task', async t => {
  const f = await repairHarness(t, [
    { id: 'unsupported', sessionId: 'old-unsupported', status: 'succeeded', workDir: workRoot },
    { id: 'failed', sessionId: 'old-failed', status: 'failed', workDir: workRoot },
    { id: 'good', sessionId: 'old-good', status: 'succeeded', workDir: workRoot },
    { id: 'new', sessionId: 'new-native', status: 'succeeded', groupingVersion: 2, workspaceRoot: workRoot },
  ]);
  const copied = [], retired = [];
  const result = await f.queue.repairWorkspace(async payload => {
    copied.push(payload.sourceId);
    if (payload.sourceId === 'old-unsupported') throw new Error('unsupported log format');
    return { sessionId: payload.targetId };
  }, async payload => { retired.push(payload.sourceId); });
  assert.deepEqual(copied, ['old-unsupported', 'old-good']);
  assert.deepEqual(retired, ['old-good']);
  assert.equal(result.tasks[0].sessionId, 'old-unsupported');
  assert.match(result.tasks[0].workspaceRepairError, /unsupported log format/);
  assert.equal(result.tasks[2].workspaceRetired, true);
  assert.equal(result.tasks[3].sessionId, 'new-native');
});

test('workspace repair refuses active and pending work before invoking history services', async t => {
  for (const status of ['pending', 'running', 'unconfirmed']) {
    const f = await repairHarness(t);
    f.queue.state.tasks[0].status = status;
    const forbidden = () => { throw new Error('must not invoke history service while busy'); };
    await assert.rejects(f.queue.repairWorkspace(forbidden, forbidden), /停止或完成当前批次/);
  }
  const f = await repairHarness(t);
  f.queue.live.set('legacy-one', { stop() {}, done: Promise.resolve() });
  await assert.rejects(f.queue.repairWorkspace(() => {}, () => {}), /停止或完成当前批次/);
  f.queue.live.clear();
});
