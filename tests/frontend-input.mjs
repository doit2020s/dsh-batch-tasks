import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// A real Panel with a fake in-memory RPC. This never boots Harness, reads a
// DSH home, mounts any Agent, sends a prompt, or contacts a model endpoint.
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const artifactDir = join(rootDir, 'artifacts');
await mkdir(artifactDir, { recursive: true });
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Panel } from './src/client.jsx';
const root = createRoot(document.getElementById('root'));
let generation = 0;
const nativeFileText = File.prototype.text;
File.prototype.text = async function() {
  // Bind this read to the fixture present when it starts. A late read must
  // not report into a later mount's RPC or file history.
  const h = window.__h, name = this.name;
  h.fileReads.push(name);
  if (h.fileHolds.has(name)) {
    h.fileHolds.delete(name);
    await new Promise(resolve => { h.filePending[name] = resolve; });
  }
  const text = await nativeFileText.call(this);
  h.fileCompleted.push(name);
  return text;
};
window.mountPanel = options => {
  const pending = {};
  const h = {
    calls: [], defaultsReads: 0, snapshotReads: 0,
    activePrefs: 0, maxActivePrefs: 0, completedPrefs: [], committedPrefs: {},
    fileReads: [], fileCompleted: [], fileHolds: new Set(), filePending: {},
    defaults: {cwd:'C:\\\\Mock\\\\saved',concurrency:2,provider:'mock-provider',model:'mock-model',profile:'batch-sdk',defaultAgentPreset:'minimal',presets:[{id:'minimal',name:'极简模式',isDefault:true}]},
    snapshot: {mode:'idle',tasks:[],counts:{},liveCount:0,concurrency:2,batchRoot:'C:\\\\Mock\\\\saved',composeText:'',taskPrefix:'',taskSuffix:'',config:null},
    release(method) { pending[method]?.(); delete pending[method]; },
    clearCalls() { h.calls.length = 0; },
    holdFile(name) { h.fileHolds.add(name); },
    releaseFile(name) { h.filePending[name]?.(); delete h.filePending[name]; },
  };
  Object.assign(h.defaults, options?.defaults);
  Object.assign(h.snapshot, options?.snapshot);
  const held = new Set(options?.hold || []);
  const call = async (method, payload = {}, signal) => {
    h.calls.push({method,payload:structuredClone(payload),at:performance.now()});
    if (method === 'defaults') h.defaultsReads++;
    if (method === 'snapshot') h.snapshotReads++;
    if (method === 'setPrefs') { h.activePrefs++; h.maxActivePrefs = Math.max(h.maxActivePrefs, h.activePrefs); }
    if (held.has(method)) {
      held.delete(method);
      await new Promise((resolve,reject) => {
        pending[method] = resolve;
        signal?.addEventListener('abort', () => reject(new DOMException('aborted','AbortError')), {once:true});
      });
    }
    if (method === 'defaults') return structuredClone(h.defaults);
    if (method === 'setPrefs') {
      Object.assign(h.committedPrefs, structuredClone(payload));
      h.completedPrefs.push(structuredClone(payload)); h.activePrefs--;
      return structuredClone(h.snapshot);
    }
    if (method === 'snapshot' || method === 'setAffix') return structuredClone(h.snapshot);
    if (method === 'start') return {...structuredClone(h.snapshot), config:structuredClone(payload)};
    throw new Error('Unsupported mock-only RPC: ' + method);
  };
  window.__h = h;
  window.__parseCalls = 0;
  root.render(<Panel key={++generation} call={call} onClose={() => root.render(null)} />);
};
`;
const bundled = await build({
  stdin: { contents: fixture, resolveDir: rootDir, sourcefile: 'frontend-input-fixture.jsx', loader: 'jsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022',
  loader: { '.css': 'text' }, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'count-panel-task-parsing', setup(api) {
    api.onResolve({ filter: /\/validation\.js$/ }, args => args.importer.endsWith('client.jsx') ? { path: args.path, namespace: 'count-task-parsing' } : undefined);
    api.onLoad({ filter: /.*/, namespace: 'count-task-parsing' }, () => ({
      contents: `import * as actual from './src/validation.js'; export * from './src/validation.js'; export function parseTasks(text) { window.__parseCalls = (window.__parseCalls || 0) + 1; return actual.parseTasks(text); }`,
      resolveDir: rootDir, loader: 'js',
    }));
  } }],
});
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Isolated Panel input regression</title></head><body style="margin:0;background:#101719"><div id="root"></div><script src="/fixture.js"></script></body></html>';
const server = createServer((req, res) => {
  if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); }
  else if (req.url === '/fixture.js') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); res.end(bundled.outputFiles[0].text); }
  else { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser, page;
const pageErrors = [];
const checks = [];
const measurements = {};
const started = Date.now();
async function until(fn, label, timeout = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return;
    await new Promise(done => setTimeout(done, 40));
  }
  throw new Error(`Timed out: ${label}`);
}
async function mount(options = {}) {
  await page.evaluate(options => window.mountPanel(options), options);
  await page.getByRole('heading', { name: '批量任务工作台', exact: true }).waitFor();
  await until(() => page.evaluate(() => window.__h.snapshotReads > 0 && window.__h.defaultsReads > 0), 'mock RPCs started');
  return page.evaluateHandle(() => window.__h);
}
async function prefs(fixtureHandle) {
  if (fixtureHandle) return fixtureHandle.evaluate(h => h.calls.filter(call => call.method === 'setPrefs').map(call => call.payload));
  return page.evaluate(() => window.__h.calls.filter(call => call.method === 'setPrefs').map(call => call.payload));
}
async function waitPolls(count = 1) {
  const prior = await page.evaluate(() => window.__h.snapshotReads);
  await until(() => page.evaluate(prior => window.__h.snapshotReads >= prior, prior + count), 'repeated polling', 6000);
}
async function close() {
  await page.getByRole('button', { name: '关闭批量任务面板', exact: true }).click();
  await page.getByRole('heading', { name: '批量任务工作台', exact: true }).waitFor({ state: 'hidden' });
}
async function checked(name, fn) { await fn(); checks.push(name); console.log(`PASS ${name}`); }
try {
  const executablePath = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(path => path && existsSync(path));
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const concurrency = page.getByLabel('并发会话数', { exact: true });
  const timeout = page.getByLabel('单任务超时（分钟）', { exact: true });
  const cwd = page.getByLabel('DSH 工作区（绝对路径）', { exact: true });
  const tasks = page.locator('#dbt-tasks');
  await checked('late defaults preserve edited fields and fresh timeout ignores a terminal batch timeout of 30', async () => {
    await mount({ hold: ['defaults'], snapshot: { mode: 'finished', config: { concurrency: 2, timeoutMinutes: 30 } } });
    await until(async () => await tasks.isEnabled(), 'terminal panel ready');
    assert.equal(await timeout.inputValue(), '180');
    await concurrency.fill('6'); await timeout.fill('240');
    await cwd.fill('C:\\Mock\\edited');
    await page.getByLabel('模型提供方', { exact: true }).fill('edited-provider');
    await page.getByLabel('模型名称', { exact: true }).fill('edited-model');
    await tasks.fill('你好\n计算 2+3');
    await page.locator('#dbt-prefix').fill('用户前缀');
    await page.locator('#dbt-suffix').fill('用户后缀');
    await page.evaluate(() => window.__h.release('defaults'));
    await until(async () => await page.locator('#dbt-agent-preset').inputValue() === 'minimal', 'defaults applied');
    await waitPolls();
    assert.equal(await concurrency.inputValue(), '6'); assert.equal(await timeout.inputValue(), '240');
    assert.equal(await cwd.inputValue(), 'C:\\Mock\\edited');
    assert.equal(await page.getByLabel('模型提供方', { exact: true }).inputValue(), 'edited-provider');
    assert.equal(await page.getByLabel('模型名称', { exact: true }).inputValue(), 'edited-model');
    assert.equal(await tasks.inputValue(), '你好\n计算 2+3');
    assert.equal(await page.locator('#dbt-prefix').inputValue(), '用户前缀');
    assert.equal(await page.locator('#dbt-suffix').inputValue(), '用户后缀');
    await page.getByRole('button', { name: '开始执行 2 条任务', exact: true }).click();
    const mockedStart = await page.evaluate(() => window.__h.calls.find(call => call.method === 'start')?.payload);
    assert.equal(mockedStart.concurrency, 6); assert.equal(mockedStart.timeoutMinutes, 240);
    assert.equal(mockedStart.text, '你好\n计算 2+3');
    assert.equal(mockedStart.taskPrefix, '用户前缀'); assert.equal(mockedStart.taskSuffix, '用户后缀');
    assert.equal(mockedStart.serialDispatch, false);
    await close();
  });

  await checked('late first snapshot preserves editable drafts and affixes', async () => {
    await mount({ hold: ['snapshot'], snapshot: { composeText: '旧文本', taskPrefix: '旧前缀', taskSuffix: '旧后缀', concurrency: 2, batchRoot: 'C:\\Mock\\stale' } });
    await concurrency.fill('6');
    await page.locator('#dbt-prefix').fill('新前缀');
    await page.locator('#dbt-suffix').fill('新后缀');
    await page.evaluate(() => window.__h.release('snapshot'));
    await until(async () => await tasks.isEnabled(), 'late snapshot loaded');
    assert.equal(await concurrency.inputValue(), '6');
    assert.equal(await page.locator('#dbt-prefix').inputValue(), '新前缀');
    assert.equal(await page.locator('#dbt-suffix').inputValue(), '新后缀');
    await close();
  });

  await checked('compositionstart alone protects an affix from a late snapshot before any input event', async () => {
    for (const [id, untouched] of [['dbt-prefix', 'dbt-suffix'], ['dbt-suffix', 'dbt-prefix']]) {
      const fixtureHandle = await mount({ hold: ['snapshot'], snapshot: { taskPrefix: '旧前缀', taskSuffix: '旧后缀' } });
      const field = page.locator(`#${id}`);
      await field.evaluate(element => {
        element.focus(); element.setSelectionRange(0, 0);
        element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      });
      await fixtureHandle.evaluate(h => h.release('snapshot'));
      await until(async () => await tasks.isEnabled(), 'snapshot arrives during initial composition');
      assert.equal(await field.inputValue(), '', 'The snapshot replaced an affix whose IME session had already started');
      assert.equal(await page.locator(`#${untouched}`).inputValue(), untouched === 'dbt-prefix' ? '旧前缀' : '旧后缀', 'The delayed snapshot was never actually hydrated');
      assert.deepEqual(await field.evaluate(element => [element.selectionStart, element.selectionEnd]), [0, 0]);
      assert.equal((await prefs(fixtureHandle)).length, 0);
      await field.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' })));
      await close(); await fixtureHandle.dispose();
    }
  });

  await checked('late file reads cannot overwrite A-to-B-to-A edits or a newer imported file', async () => {
    const fixtureHandle = await mount({ snapshot: { composeText: '用户A' } });
    await until(async () => await tasks.inputValue() === '用户A', 'base import text');
    const picker = page.locator('input[type="file"]');
    await fixtureHandle.evaluate(h => h.holdFile('slow-edit.txt'));
    await picker.setInputFiles({ name: 'slow-edit.txt', mimeType: 'text/plain', buffer: Buffer.from('过期导入\n你好') });
    await until(() => fixtureHandle.evaluate(h => h.fileReads.includes('slow-edit.txt')), 'slow File.text started');
    await tasks.fill('用户B'); await tasks.fill('用户A');
    await fixtureHandle.evaluate(h => h.releaseFile('slow-edit.txt'));
    await until(() => fixtureHandle.evaluate(h => h.fileCompleted.includes('slow-edit.txt')), 'slow File.text released');
    await until(async () => await picker.inputValue() === '', 'old import input reset');
    assert.equal(await tasks.inputValue(), '用户A', 'An older read won after the text returned to the same original string');

    await fixtureHandle.evaluate(h => h.holdFile('older.txt'));
    await picker.setInputFiles({ name: 'older.txt', mimeType: 'text/plain', buffer: Buffer.from('较早导入\n计算2+3') });
    await until(() => fixtureHandle.evaluate(h => h.fileReads.includes('older.txt')), 'older File.text started');
    await picker.setInputFiles({ name: 'newer.txt', mimeType: 'text/plain', buffer: Buffer.from('较新导入\n你好') });
    await until(async () => await tasks.inputValue() === '较新导入\n你好', 'newer import applied');
    await fixtureHandle.evaluate(h => h.releaseFile('older.txt'));
    await until(() => fixtureHandle.evaluate(h => h.fileCompleted.includes('older.txt')), 'older File.text released');
    await until(async () => await picker.inputValue() === '', 'overlapping import input reset');
    assert.equal(await tasks.inputValue(), '较新导入\n你好', 'An older file replaced the latest import');
    await close(); await fixtureHandle.dispose();
  });

  await checked('a completed import resets the file picker for reselection and immediate close saves its latest text', async () => {
    const fixtureHandle = await mount(); await until(async () => await tasks.isEnabled(), 'same-file import panel ready');
    const picker = page.locator('input[type="file"]');
    const file = { name: 'same.txt', mimeType: 'text/plain', buffer: Buffer.from('导入你好\n计算2+3') };
    await picker.setInputFiles(file);
    await until(async () => await tasks.inputValue() === '导入你好\n计算2+3' && await picker.inputValue() === '', 'first import complete');
    await tasks.fill('手动改动');
    await picker.setInputFiles(file);
    await until(async () => await tasks.inputValue() === '导入你好\n计算2+3' && await picker.inputValue() === '', 'same file selected again');
    assert.equal(await fixtureHandle.evaluate(h => h.fileReads.filter(name => name === 'same.txt').length), 2);
    await fixtureHandle.evaluate(h => h.clearCalls());
    await picker.setInputFiles({ name: 'final.txt', mimeType: 'text/plain', buffer: Buffer.from('最终导入你好') });
    await until(async () => await tasks.inputValue() === '最终导入你好', 'final import applied');
    await close();
    await until(() => fixtureHandle.evaluate(h => h.committedPrefs.composeText === '最终导入你好'), 'close flush persisted import');
    assert.ok((await prefs(fixtureHandle)).some(payload => payload.composeText === '最终导入你好'));
    await fixtureHandle.dispose();
  });

  await checked('an in-flight preference save serializes later edits and close flush so the newest payload wins', async () => {
    const fixtureHandle = await mount({ hold: ['setPrefs'] });
    await until(async () => await tasks.isEnabled(), 'serialized save panel ready');
    await tasks.fill('先保存你好');
    await until(async () => (await prefs(fixtureHandle)).length === 1, 'first save in flight');
    await tasks.fill('最后保存你好');
    await close();
    // Hold the first RPC beyond the debounce interval. Closing must enqueue
    // the newest payload behind it rather than launch a concurrent writer.
    await new Promise(done => setTimeout(done, 800));
    assert.deepEqual(await prefs(fixtureHandle), [{ composeText: '先保存你好' }]);
    assert.deepEqual(await fixtureHandle.evaluate(h => ({ active: h.activePrefs, max: h.maxActivePrefs, completed: h.completedPrefs.length })), { active: 1, max: 1, completed: 0 });
    await fixtureHandle.evaluate(h => h.release('setPrefs'));
    await until(() => fixtureHandle.evaluate(h => h.completedPrefs.length === 2), 'queued close save completed');
    assert.deepEqual(await prefs(fixtureHandle), [{ composeText: '先保存你好' }, { composeText: '最后保存你好' }]);
    assert.equal(await fixtureHandle.evaluate(h => h.committedPrefs.composeText), '最后保存你好');
    assert.equal(await fixtureHandle.evaluate(h => h.maxActivePrefs), 1);
    await fixtureHandle.dispose();
  });

  await checked('empty numeric drafts survive polling and blur restores the last valid number without saving zero', async () => {
    await mount(); await until(async () => await tasks.isEnabled(), 'empty panel ready');
    await concurrency.fill('6'); await timeout.fill('270');
    await concurrency.fill('');
    await waitPolls();
    assert.equal(await concurrency.inputValue(), '', 'Empty concurrency was coerced to zero or reset by polling');
    await page.locator('#dbt-prefix').focus();
    assert.equal(await concurrency.inputValue(), '6');
    await timeout.fill(''); await waitPolls(); assert.equal(await timeout.inputValue(), '');
    await page.locator('#dbt-prefix').focus(); assert.equal(await timeout.inputValue(), '270');
    await concurrency.fill(''); await concurrency.fill('6');
    await until(async () => (await prefs()).some(payload => payload.concurrency === 6), 'valid numeric save');
    assert.ok((await prefs()).filter(payload => Object.hasOwn(payload, 'concurrency')).every(payload => typeof payload.concurrency === 'number' && payload.concurrency >= 1 && payload.concurrency <= 16), 'A string/empty/zero concurrency escaped to setPrefs');
    await close();
  });

  await checked('an active batch retains its configured timeout', async () => {
    await mount({ snapshot: { mode: 'running', liveCount: 1, tasks: [{ id: 'mock-running', status: 'running', line: 1, prompt: '你好', sessionId: 'mock-only' }], config: { concurrency: 2, timeoutMinutes: 75 } } });
    await until(async () => await timeout.inputValue() === '75', 'active timeout');
    assert.equal(await timeout.isDisabled(), true);
    await close();
  });

  await checked('Chinese composition on prefix, tasks and suffix survives polling without saving interim text or moving the caret', async () => {
    await mount(); await until(async () => await tasks.isEnabled(), 'IME panel ready');
    for (const id of ['dbt-prefix', 'dbt-tasks', 'dbt-suffix']) {
      const field = page.locator(`#${id}`);
      await field.fill('甲乙');
      await until(async () => (await prefs()).some(payload => (id === 'dbt-prefix' ? payload.taskPrefix : id === 'dbt-suffix' ? payload.taskSuffix : payload.composeText) === '甲乙'), `${id} base saved`);
      await page.evaluate(() => window.__h.clearCalls());
      await field.evaluate(element => {
        element.focus(); element.setSelectionRange(1, 1);
        element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(element, '甲ni乙');
        element.setSelectionRange(3, 3);
        element.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: 'ni' }));
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: 'ni', isComposing: true }));
      });
      await waitPolls();
      assert.equal(await field.inputValue(), '甲ni乙');
      assert.deepEqual(await field.evaluate(element => [element.selectionStart, element.selectionEnd]), [3, 3]);
      assert.equal((await prefs()).length, 0, `${id} saved an unfinished Chinese composition`);
      await field.evaluate(element => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(element, '甲你乙');
        element.setSelectionRange(2, 2);
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: '你', isComposing: true }));
        element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你' }));
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '你', isComposing: false }));
      });
      await until(async () => (await prefs()).some(payload => (id === 'dbt-prefix' ? payload.taskPrefix : id === 'dbt-suffix' ? payload.taskSuffix : payload.composeText) === '甲你乙'), `${id} completed composition saved`);
      assert.equal(await field.inputValue(), '甲你乙');
      assert.deepEqual(await field.evaluate(element => [element.selectionStart, element.selectionEnd]), [2, 2]);
      assert.ok(!(await prefs()).some(payload => JSON.stringify(payload).includes('甲ni乙')));
    }
    await close();
  });

  await checked('10000-line typing with 1000 completed rows preserves queue DOM and repeated polls do not parse unchanged input again', async () => {
    const completedTasks = Array.from({ length: 1000 }, (_, i) => ({ id: `mock-completed-${i}`, sessionId: `mock-session-${i}`, status: 'succeeded', line: i + 1, prompt: `简单任务 ${i + 1}`, result: '5' }));
    await mount({ snapshot: { mode: 'finished', tasks: completedTasks, counts: { succeeded: 1000 } } });
    await until(async () => await tasks.isEnabled() && await page.locator('.dbt-task').count() === 1000, 'large input and completed queue ready');
    await page.evaluate(() => {
      const list = document.querySelector('.dbt-list');
      window.__queueNodes = [...list.children]; window.__queueMutations = [];
      window.__queueObserver = new MutationObserver(records => window.__queueMutations.push(...records.map(record => record.type)));
      window.__queueObserver.observe(list, { childList: true, subtree: true, characterData: true });
    });
    const largeText = Array.from({ length: 10000 }, (_, i) => `任务 ${i + 1}：计算 2+3`).join('\n');
    const latency = await tasks.evaluate(async (element, text) => {
      element.focus();
      const start = performance.now();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(element, text);
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: text }));
      const handlerMs = performance.now() - start;
      await new Promise(requestAnimationFrame);
      return { handlerMs, firstFrameMs: performance.now() - start };
    }, largeText);
    assert.equal(await tasks.inputValue(), largeText);
    await until(async () => await page.locator('.dbt-input-count b').innerText() === '10000', 'deferred task count');
    const parseCalls = await page.evaluate(() => window.__parseCalls);
    await waitPolls(2);
    assert.equal(await page.evaluate(() => window.__parseCalls), parseCalls, 'Snapshot polling reparsed 10000 unchanged tasks');
    const queueIntegrity = await page.evaluate(() => {
      const current = [...document.querySelector('.dbt-list').children];
      window.__queueObserver.disconnect();
      return { sameNodes: current.length === 1000 && current.every((node, index) => node === window.__queueNodes[index]), mutations: window.__queueMutations };
    });
    assert.equal(queueIntegrity.sameNodes, true, 'Typing reconstructed the completed queue rows');
    assert.deepEqual(queueIntegrity.mutations, [], 'Typing/polling rewrote unchanged queue content');
    measurements.largeInput = { characters: largeText.length, completedRows: 1000, ...latency, parseCalls, repeatedPollReparses: 0, queueDOMMutations: 0 };
    await page.screenshot({ path: join(artifactDir, 'frontend-input-large.png'), fullPage: true });
    await close();
  });
  assert.deepEqual(pageErrors, []);
  const report = { passed: true, checks, measurements, pageErrors, durationMs: Date.now() - started, mockOnly: true };
  await writeFile(join(artifactDir, 'frontend-input-result.json'), JSON.stringify(report, null, 2));
  console.log(`Panel input regression passed (${checks.length} checks; mock RPC only).`);
} catch (error) {
  if (page) await page.screenshot({ path: join(artifactDir, 'frontend-input-error.png'), fullPage: true });
  await writeFile(join(artifactDir, 'frontend-input-result.json'), JSON.stringify({ passed: false, checks, measurements, pageErrors, error: error.message, durationMs: Date.now() - started, mockOnly: true }, null, 2));
  throw error;
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
