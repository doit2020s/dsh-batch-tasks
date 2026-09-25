import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { locateRuntime, prepareProfile } from '../src/runtime.js';
import { createSdkWorker } from '../src/worker.js';
import { writePresetPatch } from '../src/preset-patch.js';

const root = await mkdtemp(join(tmpdir(), 'dsh-batch-integration-'));
const runtime = { ...locateRuntime(), home: join(root, '.dsh') }; await mkdir(runtime.home);
let calls = 0;
const server = createServer((req, res) => {
  let body = ''; req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const value = JSON.parse(body); calls++;
    assert.ok(value.messages.length > 0);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"role":"assistant","content":"批量集成测试完成"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":3}}\n\n');
    res.end('data: [DONE]\n\n');
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const config = { profile: 'batch-test-sdk', cwd: root, provider: 'deepseek-official', model: 'deepseek-v4-pro', agentPreset: 'standard', timeoutMinutes: 1 };
try {
  await prepareProfile(runtime, config);
  const workDir = join(root, 'batch-test', 'task-00001');
  await mkdir(workDir, { recursive: true });
  await writePresetPatch(workDir, config.agentPreset);
  const task = { sessionId: `session-${randomUUID()}`, workDir, agentPreset: config.agentPreset, prompt: '只回复完成', stopRequested: false };
  const worker = createSdkWorker(runtime, task, config, () => {}, { env: { DEEPSEEK_BASE_URL: `http://127.0.0.1:${server.address().port}`, DEEPSEEK_API_KEY: 'local-test-only', DSH_TELEMETRY_DISABLED: '1' } });
  const result = await worker.done;
  assert.equal(result.status, 'succeeded', JSON.stringify(result));
  assert.match(result.result, /批量集成测试完成/); assert.equal(calls, 1);
  const files = await readdir(join(runtime.home, 'sessions'), { recursive: true });
  assert.ok(files.some(x => x.includes(task.sessionId)), `Missing durable session ${task.sessionId}`);
  assert.ok(files.some(x => x.includes('task-00001') && x.includes(task.sessionId)), 'Durable session was not associated with the task working directory');
  // A stale/missing patch must never deliver the prompt under the default Agent.
  const missingPatch = join(root, 'without-preset.patch.yml');
  await writeFile(missingPatch, '[]\n');
  const rejectedTask = { ...task, sessionId: `session-${randomUUID()}`, prompt: '不得投递' };
  const rejected = await createSdkWorker(runtime, rejectedTask, config, () => {}, { patch: missingPatch, env: { DEEPSEEK_BASE_URL: `http://127.0.0.1:${server.address().port}`, DEEPSEEK_API_KEY: 'local-test-only', DSH_TELEMETRY_DISABLED: '1' } }).done;
  assert.equal(rejected.status, 'failed');
  assert.match(rejected.error, /未确认所选 Agent 预设/);
  assert.equal(calls, 1, 'Prompt escaped to a server without the selected Agent');
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/integration.json', JSON.stringify({ runtimeVersion: runtime.version, result, calls, sessionId: task.sessionId, testHome: runtime.home }, null, 2));
  console.log(JSON.stringify({ runtimeVersion: runtime.version, status: result.status, calls, durableSession: task.sessionId, testHome: runtime.home }));
} finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
