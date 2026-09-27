import { chromium } from 'playwright';
import { existsSync, realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { locateRuntime } from '../src/runtime.js';
import { killTree } from '../src/worker.js';

// Continue only a prior isolated UI smoke. Never load the user's real home.
const home = resolve(process.env.DSH_BATCH_TEST_HOME || 'missing');
assert.ok(realpathSync.native(home).toLowerCase().startsWith(realpathSync.native(tmpdir()).toLowerCase() + '\\') && /dsh-batch-ui-/.test(home), 'Requires an isolated native UI test home');
const runtime = { ...locateRuntime(), home };
const child = spawn(runtime.nodePath, [runtime.dshBin, 'web', '--no-open', '--port', '0'], {
  cwd: dirname(home), windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1', DEEPSEEK_API_KEY: 'local-sidebar-test-only', DEEPSEEK_BASE_URL: 'http://127.0.0.1:1', DSH_TELEMETRY_DISABLED: '1' },
});
let stdout = '', stderr = '', browser, page;
const pageErrors = [];
child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
async function until(fn, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 100)); }
  throw new Error(`Sidebar check timed out: ${stderr.slice(-2000)}`);
}
try {
  const url = await until(() => stdout.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)?.[0]);
  const executablePath = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(x => x && existsSync(x));
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(url);
  const preview = page.getByRole('button', { name: '继续', exact: true });
  if (await preview.isVisible()) await preview.click();
  const row = page.getByRole('treeitem').filter({ hasText: '任务一' }).first();
  await row.waitFor({ state: 'visible' });
  if (await row.getAttribute('aria-expanded') !== 'true') await row.locator('[class*="_projectText"]').click();
  await until(async () => await row.getAttribute('aria-expanded') === 'true');
  const session = page.locator('[class*="_sessionRow"]').filter({ hasText: '任务一' }).first();
  await session.waitFor({ state: 'visible' });
  await page.screenshot({ path: 'artifacts/sidebar-sessions-visible.png', fullPage: true });
  await session.locator('[class*="_title"]').click();
  await until(async () => (await page.locator('body').innerText()).includes('已完成独立任务'));
  assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
  assert.equal(child.exitCode, null);
  await writeFile('artifacts/sidebar-after-close.txt', await page.locator('body').innerText());
  await page.screenshot({ path: 'artifacts/sidebar-after-close.png', fullPage: true });
  await writeFile('artifacts/sidebar-result.json', JSON.stringify({ home, hostPid: child.pid, sessionVisible: true, storedTranscriptOpened: true, pageErrors }, null, 2));
  console.log('Native sidebar: persisted batch session row visible and transcript opened; Host alive.');
} catch (e) {
  if (page) { await writeFile('artifacts/sidebar-error.html', await page.locator('body').innerHTML()); await page.screenshot({ path: 'artifacts/sidebar-error.png', fullPage: true }); }
  throw e;
} finally { await browser?.close(); await killTree(child); }
