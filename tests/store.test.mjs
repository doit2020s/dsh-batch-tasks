import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';

test('live queue ownership never expires after two minutes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-store-'));
  try {
    await writeFile(join(directory, 'owner.lock'), JSON.stringify({ pid: process.pid, started: Date.now() - 3600000 }));
    await assert.rejects(new Store(directory).acquire(), /另一 DSH/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('incomplete newly created owner is not stolen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-store-'));
  try {
    await writeFile(join(directory, 'owner.lock'), '');
    await assert.rejects(new Store(directory).acquire(), /另一 DSH/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a second store cannot take active ownership', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-store-'));
  const first = new Store(directory);
  try {
    await first.acquire();
    await assert.rejects(new Store(directory).acquire(), /另一 DSH/);
  } finally { await first.close(); await rm(directory, { recursive: true, force: true }); }
});

test('close preserves a lock belonging to another owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-store-'));
  const first = new Store(directory);
  try {
    await first.acquire();
    const replacement = JSON.stringify({ pid: process.pid, token: 'replacement' });
    await writeFile(join(directory, 'owner.lock'), replacement);
    await first.close();
    assert.equal(await readFile(join(directory, 'owner.lock'), 'utf8'), replacement);
  } finally { await first.close(); await rm(directory, { recursive: true, force: true }); }
});
