import test from 'node:test';
import assert from 'node:assert/strict';
import { absoluteTaskPath, bindTaskWorkDir, quoteBashPath, quotePwshPath, taskWorkDirReason } from '../src/task-workdir.js';

const directory = "D:\\Desktop\\dsh st\\task's directory";
const agent = {};
const exec = (name, arguments_) => ({ name, arguments: arguments_, agent, signal: new AbortController().signal });
const freshShell = { parameters: { properties: { command: {}, workdir: {} } } };
const persistentShell = { parameters: { properties: { command: {} } } };

test('task directory guard requests explicit paths without changing the execution', () => {
  for (const name of ['read', 'write', 'edit', 'read_image']) {
    const execution = exec(name, Object.freeze({ file_path: 'answer.txt', content: '5' }));
    const previous = { ...execution };
    assert.match(taskWorkDirReason(execution, directory), /absolute file_path/);
    assert.deepEqual(execution, previous);
    assert.equal(taskWorkDirReason(exec(name, { file_path: 'D:\\Other\\file.txt' }), directory), undefined);
  }
  assert.match(taskWorkDirReason(exec('glob', { pattern: '*' }), directory), /absolute path/);
  assert.match(taskWorkDirReason(exec('grep', { pattern: '5', path: '.' }), directory), /absolute path/);
  assert.equal(taskWorkDirReason(exec('grep', { pattern: '5', path: directory }), directory), undefined);
});

test('fresh shell schemas use explicit workdir and retain unrelated arguments', () => {
  for (const name of ['pwsh', 'bash']) {
    const execution = exec(name, Object.freeze({ command: 'echo 5', timeoutMs: 1000 }));
    assert.match(taskWorkDirReason(execution, directory, freshShell), /absolute workdir/);
    assert.deepEqual(execution.arguments, { command: 'echo 5', timeoutMs: 1000 });
    assert.equal(taskWorkDirReason(exec(name, { command: 'echo 5', workdir: directory }), directory, freshShell), undefined);
    assert.equal(taskWorkDirReason(exec(name, { command: 'echo 5', workdir: 'D:\\Explicit' }), directory, freshShell), undefined);
    assert.match(taskWorkDirReason(exec(name, { command: 'echo 5', workdir: '.' }), directory, freshShell), /absolute workdir/);
  }
});

test('persistent PowerShell requires an explicit initial directory while preserving state', () => {
  assert.equal(quotePwshPath(directory), "'D:\\Desktop\\dsh st\\task''s directory'");
  const prefix = `Set-Location -LiteralPath ${quotePwshPath(directory)} -ErrorAction Stop; `;
  assert.equal(taskWorkDirReason(exec('pwsh', { command: `${prefix}$result = 2 + 3; $result` }), directory, persistentShell), undefined);
  assert.equal(taskWorkDirReason(exec('pwsh', { command: "Set-Location -LiteralPath 'D:\\Other'; Get-Location" }), directory, persistentShell), undefined);
  assert.match(taskWorkDirReason(exec('pwsh', { command: '$result = 2 + 3' }), directory, persistentShell), /Set-Location -LiteralPath/);
  assert.match(taskWorkDirReason(exec('pwsh', { command: "Set-Location -LiteralPath '.'; Get-Location" }), directory, persistentShell), /Set-Location -LiteralPath/);
});

test('persistent bash supports safely quoted directory prefixes', () => {
  const bashDirectory = "/tmp/task's files";
  assert.equal(quoteBashPath(bashDirectory), "'/tmp/task'\\''s files'");
  assert.equal(taskWorkDirReason(exec('bash', { command: `cd -- ${quoteBashPath(bashDirectory)} && echo 5` }), bashDirectory, persistentShell), undefined);
  assert.match(taskWorkDirReason(exec('bash', { command: 'echo 5' }), bashDirectory, persistentShell), /cd --/);
});

test('guard leaves third-party tools, non-agent calls, and explicit absolute capabilities alone', () => {
  assert.equal(taskWorkDirReason(exec('third_party_tool', { path: 'relative' }), directory), undefined);
  assert.equal(taskWorkDirReason({ name: 'read', arguments: { file_path: 'relative' } }, directory), undefined);
  assert.equal(taskWorkDirReason(exec('read', 'invalid'), directory), undefined);
  assert.equal(absoluteTaskPath('D:relative'), false);
  assert.equal(absoluteTaskPath('\\relative'), false);
  assert.equal(absoluteTaskPath('\\\\server\\share\\task'), true);
});

test('binding uses the official prompt and monotonic guard APIs globally within one SDK worker', () => {
  let prompt;
  let guard;
  let notice;
  let removals = 0;
  const ctx = {
    systemPrompt: { context(value) { prompt = value; return () => { removals++; }; } },
    tools: { get() { return persistentShell; }, guard(value) { guard = value; return () => { removals++; }; } },
    on(name, value) { assert.equal(name, 'agent/pre-step'); notice = value; return () => { removals++; }; },
  };
  const dispose = bindTaskWorkDir(ctx, directory);
  assert.equal(prompt.name, 'batch:task-workdir');
  assert.match(prompt.text, /Delegated agents/);
  assert.equal(typeof notice, 'function');
  assert.match(guard(exec('read', { file_path: 'relative' })), /absolute file_path/);
  assert.match(guard({ ...exec('read', { file_path: 'relative' }), agent: { parentAgent: agent } }), /absolute file_path/);
  dispose();
  assert.equal(removals, 3);
});

test('binding fails before delivery if official APIs are missing and rolls back partial setup', () => {
  assert.throws(() => bindTaskWorkDir({}, directory), /no task was delivered/);
  assert.throws(() => bindTaskWorkDir({}, 'relative'), /absolute directory/);
  let promptRemoved = false;
  assert.throws(() => bindTaskWorkDir({
    systemPrompt: { context() { return () => { promptRemoved = true; }; } },
    tools: { get() {}, guard() { throw new Error('guard failed'); } },
    on() {},
  }, directory), /guard failed/);
  assert.equal(promptRemoved, true);
});

test('complete-prompt Agents receive one separate plugin notice without altering their input or policy decisions', async () => {
  let admit;
  bindTaskWorkDir({
    systemPrompt: { context() {} }, tools: { get() {}, guard() {} },
    on(_name, listener) { admit = listener; },
  }, directory);
  const original = Object.freeze({ id: 'user-greeting', role: 'user', content: Object.freeze([{ type: 'text', text: '你好' }]) });
  const signal = new AbortController().signal;
  const firstAgent = {};
  const entered = { kind: 'enter', messages: [original] };
  const result = await admit({ agent: firstAgent, signal }, async () => entered);
  assert.equal(result.messages[0], original);
  assert.equal(result.messages[0].content[0].text, '你好');
  assert.deepEqual(result.messages[1].source, { kind: 'plugin', plugin: 'batch-tasks' });
  assert.match(result.messages[1].content[0].text, /Batch task execution directory:/);
  assert.ok(Object.isFrozen(result.messages[1]));
  assert.equal(await admit({ agent: firstAgent, signal }, async () => entered), entered);
  assert.equal((await admit({ agent: {}, signal }, async () => entered)).messages.length, 2, 'Subagent did not receive its own notice');
  const rejected = { kind: 'reject', reason: 'existing Agent policy' };
  assert.equal(await admit({ agent: {}, signal }, async () => rejected), rejected);
  const contextual = { kind: 'enter', messages: [original, result.messages[1]] };
  assert.equal(await admit({ agent: {}, signal }, async () => contextual), contextual, 'Official context was duplicated');
});
