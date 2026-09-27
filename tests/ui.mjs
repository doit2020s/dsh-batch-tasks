import { chromium } from 'playwright';
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { locateRuntime, runCli } from '../src/runtime.js';
import { killTree } from '../src/worker.js';
import { quotePwshPath, quoteBashPath } from '../src/task-workdir.js';

const root = await mkdtemp(join(tmpdir(), 'dsh-batch-ui-'));
const runtime = { ...locateRuntime(), home: join(root, '.dsh') }; await mkdir(runtime.home);
await mkdir('artifacts', { recursive: true });
const model = createServer((req, res) => {
  let body = ''; req.on('data', d => { body += d; }); req.on('end', () => {
    if (body.includes('HANG_TEST')) return;
    const value = JSON.parse(body);
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const taskDirectory = value.messages.map(message => message.content).join('\n').match(/Batch task execution directory: ([^\r\n]+)/)?.[1];
      const toolResult = value.messages.findLast(message => message.role === 'tool');
      if (taskDirectory && !toolResult) {
        const toolName = process.platform === 'win32' ? 'pwsh' : 'bash';
        const tool = value.tools?.find(tool => tool.function?.name === toolName);
        assert.ok(tool, `Missing ${toolName} tool for harmless UI task`);
        const command = toolName === 'pwsh'
          ? "(2 + 3) | Set-Content -LiteralPath 'answer.txt'; Get-Content -LiteralPath 'answer.txt'"
          : `printf '%s\\n' "$((2 + 3))" > answer.txt; cat answer.txt`;
        const hasWorkdir = Object.hasOwn(tool.function.parameters?.properties ?? {}, 'workdir');
        const arguments_ = hasWorkdir ? { command, workdir: taskDirectory }
          : { command: `${toolName === 'pwsh' ? `Set-Location -LiteralPath ${quotePwshPath(taskDirectory)} -ErrorAction Stop; ` : `cd -- ${quoteBashPath(taskDirectory)} && `}${command}` };
        if (Object.hasOwn(tool.function.parameters?.properties ?? {}, 'description')) arguments_.description = '计算并读回结果 5';
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'ui-arithmetic-test', type: 'function', function: { name: toolName, arguments: JSON.stringify(arguments_) } }] } }] })}\n\n`);
        res.end('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":5,"completion_tokens":3}}\n\ndata: [DONE]\n\n');
        return;
      }
      if (taskDirectory && toolResult) {
        assert.match(JSON.stringify(toolResult), /5/, 'UI task arithmetic tool did not return 5');
        assert.doesNotMatch(JSON.stringify(toolResult), /Batch task.*Retry|Error:|tool.*not found|MODULE_NOT_FOUND/i);
      }
      res.write('data: {"choices":[{"delta":{"role":"assistant","content":"已完成独立任务"}}]}\n\n');
      res.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":3}}\n\ndata: [DONE]\n\n');
    }, 2500);
  });
});
await new Promise(r => model.listen(0, '127.0.0.1', r));
await runCli(runtime, ['--profile', 'web', '--dump-config']);
await runCli(runtime, ['plugin', '--profile', 'web', 'add', resolve(process.env.DSH_BATCH_TEST_PACKAGE || '.')]);
const child = spawn(runtime.nodePath, [runtime.dshBin, 'web', '--no-open', '--port', '0'], {
  cwd: root, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, DSH_HOME: runtime.home, ELECTRON_RUN_AS_NODE: '1', DEEPSEEK_API_KEY: 'local-ui-test-only', DEEPSEEK_BASE_URL: `http://127.0.0.1:${model.address().port}`, DSH_TELEMETRY_DISABLED: '1' },
});
let stdout = '', stderr = '', browser, page;
const pageErrors = [];
const hostPid = child.pid;
function assertHostAlive() {
  assert.equal(child.pid, hostPid, 'batch dispatch replaced the native Host process');
  assert.equal(child.exitCode, null, `native Host exited unexpectedly: ${stderr.slice(-2000)}`);
  assert.equal(child.signalCode, null, 'native Host was terminated');
}
child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
async function until(fn, timeout = 60000) { const start = Date.now(); while (Date.now() - start < timeout) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 200)); } throw new Error(`Timed out. ${stderr.slice(-4000)}`); }
try {
  const url = await until(() => stdout.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)?.[0]);
  const executablePath = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(x => x && existsSync(x));
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if(m.type() === 'error') pageErrors.push(m.text()); });
  await page.goto(url); await page.waitForTimeout(3000);
  const preview = page.getByRole('button', { name: '继续', exact: true });
  if (await preview.isVisible()) await preview.click();
  await writeFile('artifacts/native-page.txt', await page.locator('body').innerText());
  // Native settings contribution, not a standalone mock page.
  const settings = page.getByRole('button', { name: /^(Settings|设置)$/ });
  await settings.first().click({ timeout: 20000 });
  await writeFile('artifacts/settings-page.txt', await page.locator('body').innerText());
  await page.getByRole('button', { name: '批量任务', exact: true }).first().click();
  await page.getByRole('button', { name: '打开批量任务工作台', exact: true }).click();
  await page.getByRole('heading', { name: '批量任务工作台' }).waitFor();
  await page.locator('#dbt-tasks').fill('任务一\n任务二\n任务三\n任务四\n任务五\n任务六');
  await page.getByLabel('并发会话数', { exact: true }).fill('2');
  await page.getByLabel('DSH 工作区（绝对路径）', { exact: true }).fill(root);
  assert.equal(await page.locator('#dbt-agent-preset').inputValue(), 'standard');
  await page.locator('#dbt-agent-preset').selectOption('minimal');
  await page.screenshot({ path: 'artifacts/panel-ready.png', fullPage: true });
  await page.getByRole('button', { name: '开始执行 6 条任务', exact: true }).click();
  const rpc = (method, payload = {}) => page.evaluate(async ({ method, payload }) => {
    const r = await fetch(`/api/batch-tasks/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: `batch-tasks/${method}`, payload }) }); return (await r.json()).result;
  }, { method, payload });
  const sessionList = () => page.evaluate(async () => {
    const response = await fetch('/api/session/list', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'session/list', payload: { args: { _request: {} } } }) });
    return (await response.json()).result;
  });
  const workspaceRecords = async () => {
    try { return Object.values(JSON.parse(await readFile(join(runtime.home, 'storages', 'workspace.json'), 'utf8')).tables.workspaces); }
    catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  };
  await until(async () => (await rpc('snapshot')).value?.liveCount === 2);
  assertHostAlive();
  // Assert the running Host registers external-worker sessions while the
  // model is still answering. Merely finding a session file misses this bug.
  await until(async () => {
    const snapshot = (await rpc('snapshot')).value;
    const started = snapshot.tasks.filter(t => t.status === 'running');
    if (!started.length) return false;
    const records = await workspaceRecords();
    const list = await sessionList();
    assert.equal(list.ok, true, JSON.stringify(list));
    return started.some(task => records.some(w => w.path === realpathSync.native(root) && w.sessionIds.includes(task.sessionId)) && list.value.items.some(s => s.sessionId === task.sessionId && s.blank === false));
  });
  assert.equal(await page.getByRole('button', { name: '清空列表', exact: true }).isDisabled(), true);
  await page.waitForTimeout(1500); await page.screenshot({ path: 'artifacts/panel-running.png', fullPage: true });
  await until(async () => (await rpc('snapshot')).value?.mode === 'finished');
  const result = await rpc('snapshot'); assert.equal(result.value.counts.succeeded, 6, JSON.stringify(result));
  const firstBatch = result.value;
  assertHostAlive();
  assert.equal(firstBatch.config.agentPreset, 'minimal');
  assert.ok(firstBatch.tasks.every(t => t.agentPreset === 'minimal'));
  assert.equal(new Set(firstBatch.tasks.map(t => t.workDir)).size, 6);
  for (const [index, task] of firstBatch.tasks.entries()) {
    assert.equal(realpathSync.native(task.workDir), realpathSync.native(join(root, ['任务一', '任务二', '任务三', '任务四', '任务五', '任务六'][index])));
    assert.ok((await stat(task.workDir)).isDirectory());
    assert.equal((await readFile(join(task.workDir, 'answer.txt'), 'utf8')).trim(), '5');
    assert.equal(realpathSync.native(task.workspaceRoot), realpathSync.native(root));
  }
  assert.equal(existsSync(join(root, 'answer.txt')), false, 'UI tasks wrote files into the shared workspace root');
  const sessionFiles = await readdir(join(runtime.home, 'sessions'), { recursive: true });
  for (const task of firstBatch.tasks) assert.ok(sessionFiles.some(file => file.includes(task.sessionId)), `Missing session ${task.sessionId}`);
  await until(async () => {
    const records = await workspaceRecords();
    const list = await sessionList();
    assert.equal(list.ok, true, JSON.stringify(list));
    await writeFile('artifacts/ui-final-visibility-debug.json', JSON.stringify({ tasks: firstBatch.tasks, records, list }, null, 2));
    return records.length === 1 && firstBatch.tasks.every(task => records.some(w => w.path === realpathSync.native(root) && w.sessionIds.includes(task.sessionId)) && list.value.items.some(s => s.sessionId === task.sessionId && s.blank === false && realpathSync.native(s.cwd) === realpathSync.native(root)));
  });
  const registered = await workspaceRecords();
  assert.equal(registered.length, 1, 'Task subdirectories became extra workspaces');
  assert.equal(registered[0].title, basename(root));
  assert.deepEqual(new Set(registered[0].sessionIds), new Set(firstBatch.tasks.map(task => task.sessionId)));
  await page.waitForTimeout(1500); await page.screenshot({ path: 'artifacts/panel-completed.png', fullPage: true });
  const clearButton = page.getByRole('button', { name: '清空列表', exact: true });
  assert.equal(await clearButton.isEnabled(), true);
  await clearButton.click();
  assert.match(await page.getByRole('alertdialog', { name: '清空所有投递记录？' }).innerText(), /DSH 会话、任务工作目录及文件都会保留/);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  assert.equal((await rpc('snapshot')).value.tasks.length, 6);
  await clearButton.click();
  await page.getByRole('button', { name: '确认清空', exact: true }).click();
  await until(async () => (await rpc('snapshot')).value?.tasks.length === 0);
  assert.equal(await clearButton.isDisabled(), true);
  assert.equal((await rpc('snapshot')).value.mode, 'idle');
  // A polling snapshot observes the state while the click's RPC is awaiting
  // its atomic save; wait for that UI operation's durable result as well.
  await until(async () => JSON.parse(await readFile(join(runtime.home, 'batch-tasks', 'queue.json'), 'utf8')).tasks.length === 0);
  for (const task of firstBatch.tasks) assert.ok((await stat(task.workDir)).isDirectory());
  const retainedSessionFiles = await readdir(join(runtime.home, 'sessions'), { recursive: true });
  for (const task of firstBatch.tasks) assert.ok(retainedSessionFiles.some(file => file.includes(task.sessionId)), `Cleared session ${task.sessionId}`);
  await page.locator('#dbt-tasks').fill('HANG_TEST one\nHANG_TEST two\nHANG_TEST three');
  await page.getByRole('button', { name: '开始执行 3 条任务', exact: true }).click();
  await until(async () => (await rpc('snapshot')).value?.tasks.filter(t => t.status === 'running').length === 2);
  await page.getByRole('button', { name: '强制中断全部', exact: true }).click();
  await page.getByRole('button', { name: '确认中断', exact: true }).click();
  await until(async () => (await rpc('snapshot')).value?.liveCount === 0);
  const stopped = (await rpc('snapshot')).value;
  assertHostAlive();
  assert.equal(stopped.counts.cancelled, 1); assert.equal(stopped.counts.killed, 2);
  await page.locator('#dbt-tasks').fill('HANG_TEST stop one\nHANG_TEST stop two\nHANG_TEST pending');
  await page.getByRole('button', { name: '开始执行 3 条任务', exact: true }).click();
  await until(async () => (await rpc('snapshot')).value?.tasks.filter(t => t.status === 'running').length === 2);
  await page.getByRole('button', { name: '暂停投递', exact: true }).click();
  await until(async () => (await rpc('snapshot')).value?.mode === 'paused');
  const paused = (await rpc('snapshot')).value;
  for (const task of paused.tasks.filter(t => ['starting', 'running'].includes(t.status))) await rpc('forceOne', { id: task.id });
  await until(async () => { const s = (await rpc('snapshot')).value; return s?.mode === 'paused' && s.liveCount === 0 && s.counts.pending === 1; });
  const composeStop = page.getByRole('button', { name: '停止投递并关闭会话', exact: true });
  assert.equal(await composeStop.isVisible(), true);
  assert.equal(await composeStop.isEnabled(), true);
  await composeStop.click();
  await page.getByRole('button', { name: '确认中断', exact: true }).click();
  await until(async () => { const s = (await rpc('snapshot')).value; return s?.counts.cancelled === 1 && s.liveCount === 0; });
  const stoppedFromCompose = (await rpc('snapshot')).value;
  assert.equal(stoppedFromCompose.counts.pending ?? 0, 0);
  assert.equal(stoppedFromCompose.counts.cancelled, 1);
  assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
  await page.setViewportSize({ width: 800, height: 1100 }); await page.screenshot({ path: 'artifacts/panel-narrow.png', fullPage: true });
  assert.equal(await page.locator('#dbt-tasks').isVisible(), true);
  await page.getByRole('button', { name: '关闭批量任务面板' }).click();
  await page.locator('#dbt-tasks').waitFor({ state: 'detached' });
  await page.waitForTimeout(1000);
  await writeFile('artifacts/after-close.txt', await page.locator('body').innerText());
  await page.screenshot({ path: 'artifacts/after-close.png', fullPage: true });
  assert.equal(await page.getByRole('button', { name: '打开批量任务工作台' }).isVisible(), true);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForTimeout(1500);
  assertHostAlive();
  await page.setViewportSize({ width: 1440, height: 1100 });
  // The official workspace feed must update the real sidebar without a Host
  // restart. Expand the single batch workspace and inspect its task session.
  const firstWorkspaceRow = page.getByRole('treeitem').filter({ hasText: basename(root) }).first();
  await firstWorkspaceRow.waitFor({ state: 'visible', timeout: 20000 });
  await writeFile('artifacts/sidebar-before-expand.html', await page.locator('body').innerHTML());
  if (await firstWorkspaceRow.getAttribute('aria-expanded') !== 'true') await firstWorkspaceRow.locator('[class*="_projectText"]').click();
  await until(async () => await firstWorkspaceRow.getAttribute('aria-expanded') === 'true', 5000);
  const remainingSessions = page.getByRole('button', { name: /^展开其余 \d+ 个会话$/ }).first();
  if (await remainingSessions.isVisible()) await remainingSessions.click();
  await writeFile('artifacts/sidebar-debug.html', await page.locator('body').innerHTML());
  const firstSessionRow = page.locator('[class*="_sessionRow"]').filter({ hasText: '任务一' }).first();
  await firstSessionRow.waitFor({ state: 'visible', timeout: 20000 });
  await firstSessionRow.click();
  await until(async () => {
    const text = await page.locator('body').innerText();
    return text.includes('任务一') && text.includes('已完成独立任务');
  });
  assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
  assertHostAlive();
  await writeFile('artifacts/sidebar-after-close.txt', await page.locator('body').innerText());
  await page.screenshot({ path: 'artifacts/sidebar-after-close.png', fullPage: true });
  const denied = await fetch(new URL('/api/batch-tasks/snapshot', url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); assert.equal(denied.status, 401);
  await writeFile('artifacts/ui-result.json', JSON.stringify({ runtimeVersion: runtime.version, normal: result.value.counts, stopped: stopped.counts, stoppedFromCompose: stoppedFromCompose.counts, pageErrors, hostPid, hostStayedAlive: child.exitCode === null && child.signalCode === null, unauthenticatedStatus: denied.status, home: runtime.home }, null, 2));
  console.log('Native DSH UI: 6 task sessions share one root workspace in Host registry, list API and sidebar; actual arithmetic files remain in independent task directories; stop controls work; unauthorized requests denied.');
} catch (e) { if(page) { await writeFile('artifacts/failed-page.txt', await page.locator('body').innerText()); await page.screenshot({path:'artifacts/ui-failed.png',fullPage:true}); } await writeFile('artifacts/ui-error.txt', `${e.stack}\n${stderr}\n${pageErrors.join('\n')}\nHome: ${runtime.home}`); throw e; }
finally { await browser?.close(); await killTree(child); model.closeAllConnections(); await new Promise(r => model.close(r)); }
