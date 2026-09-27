import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanAgentPresetRoots, selectedAgentPreset } from '../src/agent-roster.js';
import { createBatchCore } from '../src/core.js';

test('default selection uses the specific modern or legacy registry key', () => {
  assert.equal(selectedAgentPreset({ unrelated: { default: 'wrong' }, 'agent-presets': { default: 'minimal' } }), 'minimal');
  assert.equal(selectedAgentPreset({ 'agent-presets': { default: 'standard' }, 'agent-preset-registry': { selectedDefault: 'minimal' } }), 'minimal');
  assert.equal(selectedAgentPreset({}), 'standard');
});

test('system presets survive without any user root and custom metadata cannot shadow shipped IDs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-roster-'));
  try {
    const shipped = join(root, 'shipped'), user = join(root, 'user');
    await mkdir(join(shipped, 'standard'), { recursive: true });
    await mkdir(join(shipped, 'minimal'), { recursive: true });
    await writeFile(join(shipped, 'standard', 'agent.cordis.yml'), 'not read by roster');
    await writeFile(join(shipped, 'minimal', 'agent.cordis.yml'), 'not read by roster');
    const reads = [];
    const metadata = path => {
      reads.push(path);
      if (path === join(shipped, 'minimal', 'preset.yml')) return { name: '极简模式', order: 1 };
      return {};
    };
    const roots = [{ path: shipped, trust: 'system' }, { path: user, trust: 'user' }];
    assert.deepEqual(scanAgentPresetRoots(roots, metadata, 'minimal').map(row => row.id), ['minimal', 'standard']);
    await mkdir(join(user, 'minimal'), { recursive: true });
    await mkdir(join(user, 'custom'), { recursive: true });
    await writeFile(join(user, 'minimal', 'agent.cordis.yml'), 'local composition is not inspected');
    await writeFile(join(user, 'custom', 'agent.cordis.yml'), 'private composition is not inspected');
    const rows = scanAgentPresetRoots(roots, metadata, 'minimal');
    assert.equal(rows.find(row => row.id === 'minimal').trust, 'system');
    assert.equal(rows.find(row => row.id === 'minimal').isDefault, true);
    assert.equal(rows.find(row => row.id === 'custom').trust, 'user');
    assert.equal(reads.some(path => path.includes('agent.cordis.yml')), false);
    assert.equal(reads.includes(join(user, 'minimal', 'preset.yml')), false);
    assert.equal(await readFile(join(user, 'custom', 'agent.cordis.yml'), 'utf8'), 'private composition is not inspected');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('metadata alone cannot make an absent composition appear runnable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-roster-broken-'));
  try {
    await mkdir(join(root, 'minimal'));
    const row = scanAgentPresetRoots([{ path: root, trust: 'system' }], () => ({ name: '极简模式' }), 'minimal')[0];
    assert.equal(row.broken, '缺少 agent.cordis.yml');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('native integration takes the active Host roster instead of inspecting user files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-host-roster-'));
  let core;
  try {
    const lib = join(root, 'dsh', 'lib');
    await mkdir(lib, { recursive: true });
    const bin = join(lib, 'bin.js');
    await writeFile(bin, '');
    await writeFile(join(lib, '..', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.7-test' }));
    // No runtime Agent package or user preset directory exists in this fixture.
    let calls = 0;
    core = await createBatchCore({ dshHome: root, dshBin: bin, nodePath: process.execPath }, {
      listAgentPresets: async () => {
        calls++;
        return { presets: [{ id: 'minimal', name: 'Host 极简模式', trust: 'system' }], defaultAgentPreset: 'minimal' };
      },
    });
    const result = await core.handle('defaults');
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.value.defaultAgentPreset, 'minimal');
    assert.equal(result.value.presets[0].name, 'Host 极简模式');
    assert.equal(calls, 1);
  } finally {
    await core?.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
