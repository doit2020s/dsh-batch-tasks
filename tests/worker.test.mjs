import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSdkWorker } from '../src/worker.js';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

test('stopping a worker waiting for the boot lock does not spawn it', { timeout: 10000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-batch-boot-stop-'));
  const runtime = { nodePath: process.execPath, dshBin: fileURLToPath(new URL('./fixtures/subagent-sdk.mjs', import.meta.url)), home: directory };
  const config = { cwd: directory, profile: 'sdk', provider: 'test', model: 'test', timeoutMinutes: 1 };
  const first = createSdkWorker(runtime, { sessionId: 'first', prompt: 'test', stopRequested: false }, config, () => {},
    { env: { BATCH_TEST_INITIALIZE_MS: '350', BATCH_TEST_CHILD_MS: '10' } });
  const marker = join(directory, 'second-started');
  const task = { sessionId: 'second', prompt: 'test', stopRequested: false };
  const queued = createSdkWorker(runtime, task, config, () => {}, { startupMs: 50, env: { BATCH_TEST_START_FILE: marker } });
  await delay(100);
  task.stopRequested = true;
  queued.stop(false);
  assert.equal((await queued.done).status, 'cancelled');
  assert.equal((await first.done).status, 'succeeded');
  assert.equal(existsSync(marker), false, 'Cancelled queued worker was spawned');
});

test('startup timeout starts after acquiring the boot lock', { timeout: 10000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-batch-boot-timeout-'));
  const runtime = { nodePath: process.execPath, dshBin: fileURLToPath(new URL('./fixtures/subagent-sdk.mjs', import.meta.url)), home: directory };
  const config = { cwd: directory, profile: 'sdk', provider: 'test', model: 'test', timeoutMinutes: 1 };
  const first = createSdkWorker(runtime, { sessionId: 'first', prompt: 'test', stopRequested: false }, config, () => {},
    { env: { BATCH_TEST_INITIALIZE_MS: '350', BATCH_TEST_CHILD_MS: '10' } });
  const queued = createSdkWorker(runtime, { sessionId: 'second', prompt: 'test', stopRequested: false }, config, () => {},
    { startupMs: 300, env: { BATCH_TEST_CHILD_MS: '10' } });
  const results = await Promise.all([first.done, queued.done]);
  assert.deepEqual(results.map(result => result.status), ['succeeded', 'succeeded'], JSON.stringify(results));
});

test('root idle while a subagent is live does not finish the task', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-batch-subagent-'));
  const childMs = 1500;
  const task = { sessionId: 'session-root', prompt: 'hang-child', stopRequested: false };
  const started = Date.now();
  const worker = createSdkWorker(
    { nodePath: process.execPath, dshBin: fileURLToPath(new URL('./fixtures/subagent-sdk.mjs', import.meta.url)), home: directory },
    task,
    { cwd: directory, profile: 'sdk', provider: 'test', model: 'test', timeoutMinutes: 1 },
    () => {},
    { env: { BATCH_TEST_CHILD_MS: String(childMs) } },
  );
  const result = await worker.done;
  const elapsed = Date.now() - started;
  assert.equal(result.status, 'succeeded', JSON.stringify(result));
  assert.match(result.result, /已派子任务/);
  assert.ok(elapsed >= childMs, `finished too early (${elapsed}ms), subagent still running`);
});

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
