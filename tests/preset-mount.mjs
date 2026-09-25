import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { locateRuntime, prepareProfile } from '../src/runtime.js';
import { writePresetPatch } from '../src/preset-patch.js';

// Mount a real Agent preset and create a blank durable Session without sending
// any task or contacting a model. Set DSH_BATCH_TEST_PRESET_SOURCE for a local preset.
const preset = process.env.DSH_BATCH_TEST_PRESET || 'standard';
const root = await mkdtemp(join(tmpdir(), 'dsh-batch-preset-mount-'));
const home = join(root, '.dsh');
const workDir = join(root, 'task-00001');
await mkdir(home);
await mkdir(workDir);
if (process.env.DSH_BATCH_TEST_PRESET_SOURCE) {
  assert.equal(basename(process.env.DSH_BATCH_TEST_PRESET_SOURCE), preset);
  await mkdir(join(home, '.agent-presets'));
  await cp(process.env.DSH_BATCH_TEST_PRESET_SOURCE, join(home, '.agent-presets', preset), { recursive: true });
}
const runtime = { ...locateRuntime(), home };
await prepareProfile(runtime, { profile: 'batch-sdk', cwd: workDir });
if (process.env.DSH_BATCH_TEST_PRESET_PACKAGE) {
  await new Promise((resolve, reject) => {
    const install = spawn('pnpm', ['--dir', join(home, 'profiles', 'batch-sdk'), 'add', process.env.DSH_BATCH_TEST_PRESET_PACKAGE], {
      shell: process.platform === 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    install.stdout.on('data', chunk => { output += chunk.toString(); });
    install.stderr.on('data', chunk => { output += chunk.toString(); });
    install.once('error', reject);
    install.once('close', code => code === 0 ? resolve() : reject(new Error(`Preset package install failed (${code}): ${output}`)));
  });
}
const patch = await writePresetPatch(workDir, preset);
const child = spawn(runtime.nodePath, [runtime.dshBin, '--profile', 'batch-sdk', '--patch', patch], {
  cwd: workDir, shell: false, windowsHide: true,
  env: { ...process.env, DSH_HOME: home, DSH_BATCH_DSH_BIN: runtime.dshBin, ELECTRON_RUN_AS_NODE: '1', DEEPSEEK_API_KEY: 'local-test-only', DSH_TELEMETRY_DISABLED: '1' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let buffer = '', stderr = '';
const pending = new Map();
child.stdout.on('data', chunk => {
  buffer += chunk.toString();
  let cut;
  while ((cut = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, cut).trim(); buffer = buffer.slice(cut + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  }
});
child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8000); });
const exited = new Promise(resolve => child.once('close', resolve));
const request = (id, method, params) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out waiting for ${method}: ${stderr}`)); }, 30000);
  pending.set(id, message => { clearTimeout(timer); resolve(message); });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
try {
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  const initialized = await request(1, 'initialize', { cwd: workDir, provider: 'deepseek-official', model: 'deepseek-flash', agentPreset: preset });
  assert.equal(initialized.error, undefined, JSON.stringify(initialized));
  assert.equal(initialized.result?.agentPreset, preset);
  const sessionId = `session-${randomUUID()}`;
  const created = await request(2, 'session/create', { sessionId });
  assert.equal(created.error, undefined, JSON.stringify(created));
  assert.deepEqual(created.result, { sessionId, agentPreset: preset });
  const shutdown = await request(3, 'shutdown', {});
  assert.equal(shutdown.error, undefined, JSON.stringify(shutdown));
  assert.equal(await exited, 0, stderr);
  const files = await readdir(join(home, 'sessions'), { recursive: true });
  assert.ok(files.some(file => file.includes(sessionId)), `Missing durable session ${sessionId}`);
  console.log(JSON.stringify({ preset, sessionId, mounted: true, home }));
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill();
}
