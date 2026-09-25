import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSdkWorker } from '../src/worker.js';

test('uncooperative task: grace timeout terminates owned process tree', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-batch-kill-'));
  const pidFile = join(directory, 'child.pid');
  let ready; const initialized = new Promise(r => { ready = r; });
  const task = { sessionId: 'test', prompt: 'hang', stopRequested: false };
  const worker = createSdkWorker({ nodePath: process.execPath, dshBin: fileURLToPath(new URL('./fixtures/stubborn-sdk.mjs', import.meta.url)), home: directory }, task,
    { cwd: directory, profile: 'sdk', provider: 'test', model: 'test', timeoutMinutes: 1 }, event => { if (event.ready) ready(); },
    { graceMs: 150, env: { BATCH_TEST_PID_FILE: pidFile } });
  await initialized; const childPid = Number(await readFile(pidFile, 'utf8'));
  task.stopRequested = true; worker.stop(false);
  const result = await worker.done;
  assert.equal(result.status, 'killed');
  assert.throws(() => process.kill(worker.pid, 0));
  // Process-tree kill, not merely the JSON-RPC parent's exit.
  assert.throws(() => process.kill(childPid, 0));
});
