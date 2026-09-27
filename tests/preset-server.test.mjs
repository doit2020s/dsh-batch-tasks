import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('unsupported official SDK API fails clearly before composing an Agent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-batch-incompatible-'));
  const cli = join(root, 'fake-cli.mjs');
  await writeFile(cli, 'export {};\n');
  for (const [name, source] of [
    ['dsh-sdk-jsonrpc-server', 'export class HarnessSdkJsonRpcServer {}'],
    ['dsh-sdk-protocol', 'export class JsonRpcLineTransport {}'],
  ]) {
    const packageDir = join(root, 'node_modules', '@deepseek-ai', name);
    await mkdir(packageDir, { recursive: true });
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: `@deepseek-ai/${name}`, type: 'module', main: 'index.js' }));
    await writeFile(join(packageDir, 'index.js'), source);
  }
  const dshDir = join(root, 'node_modules', '@deepseek-ai', 'dsh');
  await mkdir(dshDir, { recursive: true });
  await writeFile(join(dshDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '9.9.9-test' }));
  const child = spawn(process.execPath, ['--input-type=module', '-e', 'await import(process.env.BATCH_TEST_SERVER_URL)'], {
    windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DSH_BATCH_DSH_BIN: cli, BATCH_TEST_SERVER_URL: new URL('../src/preset-server.js', import.meta.url).href },
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.equal(code, 1);
  assert.match(stderr, /Harness 9\.9\.9-test is incompatible with the batch SDK bridge/);
  assert.match(stderr, /no task was delivered/);
});
