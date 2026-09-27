import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBatchCore } from '../src/core.js';
import { apply } from '../src/index.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-batch-core-test-'));
  const packageRoot = join(root, 'runtime');
  await mkdir(join(packageRoot, 'lib'), { recursive: true });
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: 'test' }));
  const dshBin = join(packageRoot, 'lib', 'bin.js');
  await writeFile(dshBin, 'throw new Error("must not execute a task in RPC lifecycle tests");\n');
  return { dshBin, dshHome: join(root, 'home') };
}

test('defaults service failure returns a typed error and Host remains usable', async () => {
  const core = await createBatchCore(await fixture(), { listAgentPresets: async () => { throw null; } });
  try {
    const reply = await core.handle('defaults');
    assert.equal(reply.ok, false);
    assert.equal(reply.error.message, 'null');
    assert.equal((await core.handle('snapshot')).ok, true);
  } finally { await core.dispose(); }
});

test('diagnostic write failure cannot escape RPC error handling', async () => {
  const core = await createBatchCore(await fixture(), { listAgentPresets: async () => { throw new Error('roster unavailable'); } });
  try {
    await unlink(core.log.file);
    await mkdir(core.log.file);
    const reply = await core.handle('defaults');
    assert.equal(reply.ok, false);
    assert.equal(reply.error.message, 'roster unavailable');
    assert.equal((await core.handle('snapshot')).ok, true);
  } finally { await core.dispose(); }
});
test('startup republishes an existing SDK listing without dispatching or changing its result', async () => {
  const config = await fixture();
  await mkdir(join(config.dshHome, 'batch-tasks'), { recursive: true });
  const task = { id: 'task-existing', sessionId: 'session-existing', status: 'succeeded', prompt: '你好',
    result: '你好', groupingVersion: 2, startedAt: 123, workspaceRoot: 'batch-root', workspaceListingPending: true };
  await writeFile(join(config.dshHome, 'batch-tasks', 'queue.json'), JSON.stringify({ schema: 1, id: 'batch-existing', mode: 'finished', tasks: [task], config: { cwd: 'batch-root' } }));
  const calls = [];
  const core = await createBatchCore(config, {
    async attachSession(payload) { calls.push(payload); return { workspaceId: 'root-workspace', listingReady: true }; },
  });
  try {
    for (let attempt = 0; attempt < 100 && !core.queue.state.tasks[0].workspaceListingRevision; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { cwd: 'batch-root', sessionId: 'session-existing', title: 'batch-root', requireStarted: false });
    const existing = core.queue.snapshot().tasks[0];
    assert.equal(existing.sessionId, task.sessionId);
    assert.equal(existing.status, task.status);
    assert.equal(existing.result, task.result);
    assert.equal(existing.workspaceListingReady, true);
    assert.equal(existing.workspaceListingRevision, 1);
    assert.equal(existing.workspaceListingPending, false);
    assert.equal(core.queue.live.size, 0, 'Restoring a list must never start SDK execution');
  } finally { await core.dispose(); }
});

test('Host model defaults exception stays inside the RPC response envelope', async () => {
  const routes = new Map();
  const releases = [];
  const ctx = {
    connection: { fetch: { register: route => { routes.set(route.path, route); } } },
    agentPresets: { remoteExportList: async () => ({ presets: [{ id: 'minimal', name: 'Minimal' }] }), defaultId: 'minimal' },
    agentDefaultModel: { currentSelection: () => { throw new Error('model settings unavailable'); } },
    effect: fn => { releases.push(fn()); },
  };
  await apply(ctx, await fixture());
  try {
    const request = method => new Request(`http://127.0.0.1/api/batch-tasks/${method}`, { method: 'POST', body: JSON.stringify({ type: 'client-request', rpcId: 'test-rpc', method: `batch-tasks/${method}`, payload: {} }) });
    const failed = await routes.get('/api/batch-tasks/defaults').fetch(request('defaults'));
    assert.equal(failed.status, 200);
    const envelope = await failed.json();
    assert.equal(envelope.rpcId, 'test-rpc');
    assert.equal(envelope.result.ok, false);
    assert.equal(envelope.result.error.code, 'batch/model-defaults');
    assert.match(envelope.result.error.message, /model settings unavailable/);
    const snapshot = await routes.get('/api/batch-tasks/snapshot').fetch(request('snapshot'));
    assert.equal((await snapshot.json()).result.ok, true);
  } finally { await Promise.all(releases.map(release => release())); }
});
