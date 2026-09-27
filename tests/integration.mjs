import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readdir, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { locateRuntime, prepareProfile } from '../src/runtime.js';
import { createSdkWorker } from '../src/worker.js';
import { writePresetPatch } from '../src/preset-patch.js';
import { quotePwshPath, quoteBashPath } from '../src/task-workdir.js';

const root = await mkdtemp(join(tmpdir(), 'dsh-batch-integration-'));
const runtime = { ...locateRuntime(), home: join(root, '.dsh') }; await mkdir(runtime.home);
let calls = 0;
let toolResults = 0;
const server = createServer((req, res) => {
  let body = ''; req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const value = JSON.parse(body); calls++;
    assert.ok(value.messages.length > 0);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const toolResult = value.messages.findLast(message => message.role === 'tool');
    if (!toolResult) {
      const toolName = process.platform === 'win32' ? 'pwsh' : 'bash';
      const tool = value.tools.find(tool => tool.function?.name === toolName);
      assert.ok(tool, `Missing ${toolName} tool in minimal preset`);
      const taskDirectory = value.messages.map(message => message.content).join('\n').match(/Batch task execution directory: ([^\r\n]+)/)?.[1];
      assert.ok(taskDirectory, `Official system prompt omitted the separate task execution directory: ${JSON.stringify(value.messages.filter(message => message.role === 'system'))}`);
      const command = process.platform === 'win32'
        ? "(2 + 3) | Set-Content -LiteralPath 'answer.txt'; Get-Content -LiteralPath 'answer.txt'"
        : `printf '%s\\n' "$((2 + 3))" > answer.txt; cat answer.txt`;
      const hasWorkdir = Object.hasOwn(tool.function.parameters?.properties ?? {}, 'workdir');
      const arguments_ = hasWorkdir ? { command, workdir: taskDirectory }
        : { command: `${toolName === 'pwsh' ? `Set-Location -LiteralPath ${quotePwshPath(taskDirectory)} -ErrorAction Stop; ` : `cd -- ${quoteBashPath(taskDirectory)} && `}${command}` };
      if (Object.hasOwn(tool.function.parameters?.properties ?? {}, 'description')) arguments_.description = '计算并读回结果 5';
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'arithmetic-test', type: 'function', function: { name: toolName, arguments: JSON.stringify(arguments_) } }] } }] })}\n\n`);
      res.write('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":5,"completion_tokens":3}}\n\n');
      res.end('data: [DONE]\n\n');
      return;
    }
    assert.match(JSON.stringify(toolResult), /5/, `Arithmetic tool did not return 5: ${JSON.stringify(toolResult)}`);
    assert.doesNotMatch(JSON.stringify(toolResult), /MODULE_NOT_FOUND|ERR_DLOPEN_FAILED|NODE_MODULE_VERSION|requires an owning agent|tool.*not found/i);
    toolResults++;
    res.write('data: {"choices":[{"delta":{"role":"assistant","content":"批量集成测试完成"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":3}}\n\n');
    res.end('data: [DONE]\n\n');
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const config = { profile: 'batch-test-sdk', cwd: root, provider: 'deepseek-official', model: 'deepseek-v4-pro', agentPreset: 'minimal', timeoutMinutes: 1 };
try {
  await prepareProfile(runtime, config);
  const workDir = join(root, 'batch-test', 'task-00001');
  await mkdir(workDir, { recursive: true });
  await writePresetPatch(workDir, config.agentPreset);
  const task = { sessionId: `session-${randomUUID()}`, workDir, agentPreset: config.agentPreset, prompt: '计算 2 + 3，把结果写入当前任务目录的 answer.txt，再读取并回复结果。', stopRequested: false };
  const notifications = [];
  const worker = createSdkWorker(runtime, task, config, event => notifications.push(event), { env: { DEEPSEEK_BASE_URL: `http://127.0.0.1:${server.address().port}`, DEEPSEEK_API_KEY: 'local-test-only', DSH_TELEMETRY_DISABLED: '1' } });
  const result = await worker.done;
  assert.equal(result.status, 'succeeded', JSON.stringify(result));
  assert.match(result.result, /批量集成测试完成/); assert.equal(calls, 2); assert.equal(toolResults, 1);
  assert.equal((await readFile(join(workDir, 'answer.txt'), 'utf8')).trim(), '5');
  assert.equal(existsSync(join(root, 'answer.txt')), false, 'Tool wrote into shared batch root');
  assert.ok(notifications.some(event => event.sessionCreated && event.cwd === root && event.workDir === workDir), 'Session root workspace or task execution directory was wrong');
  assert.ok(notifications.some(event => event.activity?.startsWith('工具执行：')), 'Durable tool/call event was not handled');
  const files = await readdir(join(runtime.home, 'sessions'), { recursive: true });
  assert.ok(files.some(x => x.includes(task.sessionId)), `Missing durable session ${task.sessionId}`);
  const firstSessionFile = files.find(x => x.includes(task.sessionId) && /\.jsonl(?:\.zstd)?$/.test(x));
  assert.ok(firstSessionFile, 'Session log is missing');
  assert.ok(!firstSessionFile.includes('task-00001'), 'Session history was grouped beneath the task directory instead of the batch workspace');
  const project = firstSessionFile.split(/[\\/]/)[0];
  // Exercise the actual persistent-shell backend concurrently, with distinct
  // durable sessions and relative writes in each task's own working directory.
  const concurrent = await Promise.all([2, 3, 4].map(async index => {
    const ownDir = join(root, 'batch-test', `task-${String(index).padStart(5, '0')}`);
    await mkdir(ownDir, { recursive: true });
    await writePresetPatch(ownDir, config.agentPreset);
    const ownTask = { ...task, workDir: ownDir, sessionId: `session-${randomUUID()}` };
    const outcome = await createSdkWorker(runtime, ownTask, config, () => {}, { env: { DEEPSEEK_BASE_URL: `http://127.0.0.1:${server.address().port}`, DEEPSEEK_API_KEY: 'local-test-only', DSH_TELEMETRY_DISABLED: '1' } }).done;
    assert.equal(outcome.status, 'succeeded', JSON.stringify(outcome));
    assert.equal((await readFile(join(ownDir, 'answer.txt'), 'utf8')).trim(), '5');
    return ownTask.sessionId;
  }));
  assert.equal(new Set(concurrent).size, 3);
  assert.equal(calls, 8); assert.equal(toolResults, 4);
  const allFiles = await readdir(join(runtime.home, 'sessions'), { recursive: true });
  for (const sessionId of concurrent) {
    const ownFile = allFiles.find(x => x.includes(sessionId) && /\.jsonl(?:\.zstd)?$/.test(x));
    assert.ok(ownFile, `Missing concurrent session log ${sessionId}`);
    assert.equal(ownFile.split(/[\\/]/)[0], project, 'Concurrent task sessions were separated into child workspaces');
  }
  assert.equal(realpathSync.native(root), realpathSync.native(config.cwd));
  // A stale/missing patch must never deliver the prompt under the default Agent.
  const missingPatch = join(root, 'without-preset.patch.yml');
  await writeFile(missingPatch, '[]\n');
  const rejectedTask = { ...task, sessionId: `session-${randomUUID()}`, prompt: '不得投递' };
  const rejected = await createSdkWorker(runtime, rejectedTask, config, () => {}, { patch: missingPatch, env: { DEEPSEEK_BASE_URL: `http://127.0.0.1:${server.address().port}`, DEEPSEEK_API_KEY: 'local-test-only', DSH_TELEMETRY_DISABLED: '1' } }).done;
  assert.equal(rejected.status, 'failed');
  assert.match(rejected.error, /未确认所选 Agent 预设/);
  assert.equal(calls, 8, 'Prompt escaped to a server without the selected Agent');
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/integration.json', JSON.stringify({ runtimeVersion: runtime.version, result, calls, sessionId: task.sessionId, testHome: runtime.home }, null, 2));
  console.log(JSON.stringify({ runtimeVersion: runtime.version, status: result.status, calls, durableSession: task.sessionId, testHome: runtime.home }));
} finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
