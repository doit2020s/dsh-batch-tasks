import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureProfileRootConfig, prepareProfile } from '../src/runtime.js';

test('profile entry point is created once and an existing composition is never overwritten', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-profile-root-'));
  try {
    ensureProfileRootConfig(home, 'batch-sdk');
    const file = join(home, 'profiles', 'batch-sdk', 'cordis.yml');
    assert.match(await readFile(file, 'utf8'), /\[\]/);
    const custom = '- name: a-user-profile-plugin\n';
    await writeFile(file, custom);
    ensureProfileRootConfig(home, 'batch-sdk');
    assert.equal(await readFile(file, 'utf8'), custom);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('new SDK profile is created by the CLI before creating an entry point', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-profile-new-'));
  try {
    const bin = join(root, 'fake-cli.mjs');
    await writeFile(bin, `import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const name = process.argv[process.argv.indexOf('--profile') + 1];
const dir = join(process.env.DSH_HOME, 'profiles', name);
if (existsSync(dir)) throw Error('profile directory already exists');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-preset-sdk'] } } }));
console.log("- name: '@deepseek-ai/dsh-sdk-jsonrpc-server'");
`);
    const runtime = { home: root, dshBin: bin, nodePath: process.execPath };
    await prepareProfile(runtime, { cwd: root, profile: 'batch-sdk' });
    const dir = join(root, 'profiles', 'batch-sdk');
    assert.deepEqual((await readdir(dir)).sort(), ['cordis.yml', 'package.json']);
    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    assert.deepEqual(manifest, { dsh: { profile: { bundles: ['@deepseek-ai/dsh-preset-sdk'] } } });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('profile preparation preserves user config and does not seed custom dependencies or mutate runtime packages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-profile-existing-'));
  try {
    const dir = join(root, 'profiles', 'batch-sdk');
    await mkdir(dir, { recursive: true });
    const manifest = '{"dependencies":{"existing-plugin":"1.0.0"}}\n';
    const composition = '- name: existing-plugin\n';
    await writeFile(join(dir, 'package.json'), manifest);
    await writeFile(join(dir, 'cordis.yml'), composition);
    const bin = join(root, 'fake-cli.mjs');
    await writeFile(bin, 'console.log("- name: @deepseek-ai/dsh-sdk-jsonrpc-server");');
    const runtime = { home: root, dshBin: bin, nodePath: process.execPath };
    await prepareProfile(runtime, { cwd: root, profile: 'batch-sdk' });
    assert.equal(await readFile(join(dir, 'package.json'), 'utf8'), manifest);
    assert.equal(await readFile(join(dir, 'cordis.yml'), 'utf8'), composition);
    assert.deepEqual((await readdir(dir)).sort(), ['cordis.yml', 'package.json']);
    await assert.rejects(prepareProfile(runtime, { cwd: root, profile: 'desktop' }), /独立/);
    await assert.rejects(prepareProfile(runtime, { cwd: root, profile: '../desktop' }), /独立/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
