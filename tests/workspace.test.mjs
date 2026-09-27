import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DESKTOP_WORKSPACE_ARGUMENT,
  desktopLaunchCommand,
  desktopWorkspaceArg,
  locateDesktopExe,
  openDesktopWorkspace,
  resetDesktopWorkspaceGate,
} from '../src/desktop-workspace.js';
import { attachMany, attachSessionToWorkspace } from '../src/workspace-attach.js';
import { attachWithHost, DESKTOP_BRIDGE_PATH, registerDesktopBridge, warmWorkerSession } from '../src/desktop-bridge.js';

test('workspace launch argument stays attached so paths with spaces survive', () => {
  const path = 'D:\\Desktop\\dsh st';
  assert.equal(desktopWorkspaceArg(path), `${DESKTOP_WORKSPACE_ARGUMENT}=${path}`);
  assert.throws(() => desktopWorkspaceArg('relative'));
  assert.throws(() => desktopWorkspaceArg(''));
});

test('locateDesktopExe walks from bundled dsh bin.js to the Desktop folder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-exe-'));
  const bin = join(root, 'resources', 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  await mkdir(join(root, 'resources', 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib'), { recursive: true });
  await writeFile(bin, '');
  await writeFile(join(root, 'DSH Desktop.exe'), '');
  assert.equal(locateDesktopExe({ dshBin: bin }), join(root, 'DSH Desktop.exe'));
});

test('openDesktopWorkspace spawns Desktop with the official flag once', async () => {
  resetDesktopWorkspaceGate();
  const root = await mkdtemp(join(tmpdir(), 'dsh-ws-open-'));
  const calls = [];
  const spawned = { unref() {} };
  const ok = openDesktopWorkspace(
    { desktopExe: process.execPath },
    root,
    { info() {}, warn() {} },
    (exe, args, options) => {
      calls.push({ exe, args, options });
      return spawned;
    },
  );
  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  const expected = desktopLaunchCommand(process.execPath, desktopWorkspaceArg(realpathSync(root)));
  assert.equal(calls[0].exe, expected.file);
  assert.deepEqual(calls[0].args, expected.args);
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.shell, false);
  openDesktopWorkspace({ desktopExe: process.execPath }, root, { info() {}, warn() {} }, () => {
    throw new Error('must not spawn twice');
  });
});

test('workspace visibility never restarts or kills Desktop', () => {
  const src = readFileSync(new URL('../src/desktop-workspace.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /Stop-Process|taskkill|reloadTimer|Invoke-CimMethod/);
  const attach = readFileSync(new URL('../src/workspace-attach.js', import.meta.url), 'utf8');
  assert.doesNotMatch(attach, /writeFile|JSON\.parse|node:fs/);
});

function hostFixture() {
  const records = new Map(), headers = new Map(), changes = [];
  const registry = {
    async create(path, title) {
      if (records.has(path)) return records.get(path);
      const entity = { id: `ws-${records.size + 1}`, path, title, sessionIds: [], async attachSession(id) {
        const header = headers.get(id);
        if (!header) throw new Error('unknown persisted session');
        if (header.cwd !== path) throw new Error('session cwd mismatch');
        if (!this.sessionIds.includes(id)) { this.sessionIds.unshift(id); changes.push({ id, path }); }
      } };
      records.set(path, entity);
      return entity;
    },
  };
  return { registry, records, headers, changes };
}

test('Host registration uses each task cwd and preserves other registrations', async () => {
  const host = hostFixture();
  host.headers.set('first', { cwd: 'task-1' });
  host.headers.set('second', { cwd: 'task-2' });
  const values = await Promise.all([
    attachSessionToWorkspace(host.registry, 'task-1', 'first', '第一条'),
    attachWithHost({ workspaceRegistry: host.registry }, { cwd: 'task-2', sessionId: 'second', title: '第二条' }),
  ]);
  assert.equal(host.records.size, 2);
  assert.deepEqual(values.map(v => [v.path, v.sessionIds]), [['task-1', ['first']], ['task-2', ['second']]]);
  await attachMany(host.registry, 'task-1', ['first', 'first']);
  assert.equal(host.changes.length, 2, 'duplicate registration must preserve manual order');
});

test('Host registry rejects mismatched durable cwd instead of making an invisible list entry', async () => {
  const host = hostFixture();
  host.headers.set('first', { cwd: 'task-1' });
  await assert.rejects(attachSessionToWorkspace(host.registry, 'batch-root', 'first'), /cwd mismatch/);
  assert.deepEqual(host.records.get('batch-root').sessionIds, []);
  await assert.rejects(attachSessionToWorkspace('old-home-string', 'task-1', 'first'), /工作区服务/);
  await assert.rejects(attachWithHost({ workspaceRegistry: host.registry }, { cwd: '', sessionId: 'first' }), /工作目录/);
});

test('optional bridge registers on authenticated Connection and returns attachment failures', async () => {
  const host = hostFixture();
  host.headers.set('first', { cwd: 'task-1' });
  let route, attached;
  const ctx = { workspaceRegistry: host.registry, connection: { fetch: { register(value) { route = value; return 'registered'; } } } };
  assert.equal(registerDesktopBridge(ctx, { onAttached: value => { attached = value; } }), 'registered');
  assert.equal(route.path, DESKTOP_BRIDGE_PATH);
  assert.deepEqual(route.methods, ['POST']);
  const call = payload => route.fetch(new Request(`http://127.0.0.1${route.path}`, { method: 'POST', body: typeof payload === 'string' ? payload : JSON.stringify(payload) }));
  const success = await (await call({ cwd: 'task-1', sessionId: 'first' })).json();
  assert.equal(success.ok, true);
  assert.equal(attached.sessionId, 'first');
  assert.equal((await call('invalid json')).status, 400);
  assert.equal((await call('x'.repeat(16385))).status, 413);
  const failure = await (await call({ cwd: 'task-2', sessionId: 'first' })).json();
  assert.equal(failure.ok, false);
  assert.equal(failure.error.code, 'batch/workspace-attach');
});

test('Host bridge retries only an unpublished persistence header', async () => {
  let calls = 0;
  const entity = { id: 'ws', path: 'task-1', sessionIds: [], async attachSession(id) {
    if (++calls === 1) throw new Error(`cannot validate session '${id}': session persistence holds no such session`);
    this.sessionIds.push(id);
  } };
  const ctx = { workspaceRegistry: { async create() { return entity; } } };
  assert.equal((await attachWithHost(ctx, { cwd: 'task-1', sessionId: 'first' }, { delayMs: 0 })).sessionId, 'first');
  assert.equal(calls, 2);
  entity.attachSession = async () => { calls++; throw new Error('storage disk failure'); };
  await assert.rejects(attachWithHost(ctx, { cwd: 'task-1', sessionId: 'second' }, { delayMs: 0 }), /storage disk failure/);
  assert.equal(calls, 3);
});

test('Host warms worker title projections through read-only persistence before publishing membership', async () => {
  const host = hostFixture();
  host.headers.set('greeting', { cwd: 'batch-root' });
  const header = { id: 'greeting', cwd: 'batch-root', createdAt: 123 };
  const events = [{ seq: 0, type: 'session/title', data: { title: '你好' } }];
  const order = [];
  let cached;
  let cacheReads = 0;
  const ctx = {
    workspaceRegistry: {
      async create(...args) {
        order.push('publish');
        assert.equal(cached.values.title, '你好');
        return host.registry.create(...args);
      },
    },
    sessionPersistence: {
      async open(id, access) {
        assert.equal(id, 'greeting');
        assert.equal(access, 'read', 'Bridge must not acquire the worker writer lease');
        order.push('open');
        return { header, inheritedEventCount: 0, async read(offset) { assert.equal(offset, 0); return { events }; }, async close() { order.push('close'); } };
      },
    },
    sessionProjectionCache: {
      cachedSnapshot(meta, inherited, keys) {
        assert.equal(meta, header); assert.equal(inherited, 0); assert.deepEqual(keys, ['title']);
        if (++cacheReads > 1) cached = { asOfSeq: 0, values: { title: '你好' } };
        return cached;
      },
    },
  };
  const attached = await attachWithHost(ctx, { cwd: 'batch-root', sessionId: 'greeting', title: 'batch-root' }, {
    delayMs: 0,
    async warmListingCache(actualCtx, meta, inherited, actualEvents) {
      assert.equal(actualCtx, ctx); assert.equal(meta, header); assert.equal(inherited, 0); assert.equal(actualEvents, events);
      order.push('warm');
      return { asOfSeq: 0, values: { title: '你好' } };
    },
  });
  assert.equal(attached.sessionId, 'greeting');
  assert.deepEqual(order, ['open', 'warm', 'close', 'publish']);
  assert.equal(cacheReads, 2);
});

test('started publication rereads durable history and closes each handle before publishing a nonblank session', async () => {
  const host = hostFixture(); host.headers.set('greeting', { cwd: 'batch-root' });
  const header = { id: 'greeting', cwd: 'batch-root', createdAt: 123 };
  const titleOnly = [{ seq: 0, type: 'session/title', data: { title: '你好' } }];
  const started = [...titleOnly, { seq: 1, time: 124, type: 'turn/start', data: { turn: 1 } }];
  let opens = 0, warmed = 0;
  const closed = [];
  let cached = { asOfSeq: 0, values: { title: '你好', sessionListMetadata: { blank: true, lastPromptAt: null } } };
  const ctx = {
    workspaceRegistry: { async create(...args) {
      assert.equal(cached.values.sessionListMetadata.blank, false, 'Registry membership was published from the create-only blank cache');
      assert.deepEqual(closed, [1, 2, 3], 'Every old read snapshot must be closed before publication');
      return host.registry.create(...args);
    } },
    sessionPersistence: { async open(id, access) {
      assert.equal(id, 'greeting'); assert.equal(access, 'read');
      const attempt = ++opens;
      const events = attempt < 3 ? titleOnly : started;
      return { header, inheritedEventCount: 0,
        async read(offset) { assert.equal(offset, 0); return { events }; },
        async close() { closed.push(attempt); },
      };
    } },
    sessionProjectionCache: { cachedSnapshot(meta, inherited, keys) {
      assert.equal(meta, header); assert.equal(inherited, 0);
      assert.deepEqual(keys, ['title', 'sessionListMetadata']);
      return cached;
    } },
  };
  const attached = await attachWithHost(ctx, { cwd: 'batch-root', sessionId: 'greeting', requireStarted: true }, {
    delayMs: 0, attempts: 3,
    async warmListingCache(_ctx, _header, _inherited, events) {
      warmed++;
      assert.equal(events, started, 'Uncommitted turn/start must not create a misleading published checkpoint');
      cached = { asOfSeq: 1, values: { title: '你好', sessionListMetadata: { blank: false, lastPromptAt: null } } };
      return cached;
    },
  });
  assert.equal(opens, 3); assert.equal(warmed, 1);
  assert.deepEqual(closed, [1, 2, 3]);
  assert.equal(attached.listingReady, true); assert.equal(attached.asOfSeq, 1);
  assert.deepEqual(host.records.get('batch-root').sessionIds, ['greeting']);
  assert.equal(host.changes.length, 1);
});

test('unchanged title cannot publish until the delayed nonblank metadata column reaches the Host cache', async () => {
  const host = hostFixture(); host.headers.set('greeting', { cwd: 'batch-root' });
  const header = { id: 'greeting', cwd: 'batch-root', createdAt: 123 };
  const events = [{ seq: 0, type: 'session/title', data: { title: '你好' } }, { seq: 1, type: 'turn/start', data: { turn: 1 } }];
  const oldCache = { asOfSeq: 0, values: { title: '你好', sessionListMetadata: { blank: true, lastPromptAt: null } } };
  const newCache = { asOfSeq: 1, values: { title: '你好', sessionListMetadata: { blank: false, lastPromptAt: null } } };
  let cached = oldCache, cacheReads = 0, closes = 0;
  const ctx = {
    workspaceRegistry: { async create(...args) {
      assert.equal(cached.values.title, oldCache.values.title, 'The scenario must keep the same title');
      assert.equal(cached.values.sessionListMetadata.blank, false, 'Matching title alone cannot establish sidebar visibility');
      assert.equal(closes, 1);
      return host.registry.create(...args);
    } },
    sessionPersistence: { async open(_id, access) {
      assert.equal(access, 'read');
      return { header, inheritedEventCount: 0, async read() { return { events }; }, async close() { closes++; } };
    } },
    sessionProjectionCache: { cachedSnapshot(_header, _inherited, keys) {
      assert.deepEqual(keys, ['title', 'sessionListMetadata']);
      if (++cacheReads === 2) cached = newCache;
      return cached;
    } },
  };
  const attached = await attachWithHost(ctx, { cwd: 'batch-root', sessionId: 'greeting', requireStarted: true }, {
    delayMs: 0, cacheAttempts: 2,
    async warmListingCache() { return newCache; },
  });
  assert.equal(cacheReads, 2, 'Publication skipped waiting for the metadata column');
  assert.equal(attached.listingReady, true);
  assert.equal(attached.asOfSeq, 1);
  assert.deepEqual(host.records.get('batch-root').sessionIds, ['greeting']);
});

test('missing durable turn/start exhausts bounded retries without registering or disguising a blank session', async () => {
  const host = hostFixture(); host.headers.set('greeting', { cwd: 'batch-root' });
  let opens = 0, closes = 0, warmed = 0;
  const ctx = {
    workspaceRegistry: host.registry,
    sessionPersistence: { async open(_id, access) {
      assert.equal(access, 'read'); opens++;
      return { header: { id: 'greeting' }, inheritedEventCount: 0,
        async read() { return { events: [{ seq: 0, type: 'session/title', data: { title: '你好' } }] }; },
        async close() { closes++; },
      };
    } },
    sessionProjectionCache: { cachedSnapshot() { assert.fail('A create-only snapshot cannot be published as started'); } },
  };
  await assert.rejects(attachWithHost(ctx, { cwd: 'batch-root', sessionId: 'greeting', requireStarted: true }, {
    delayMs: 0, attempts: 3, async warmListingCache() { warmed++; return { values: {} }; },
  }), error => error.name === 'SessionListingNotPublishedError' && /开始事件尚未落盘/.test(error.message));
  assert.equal(opens, 3); assert.equal(closes, 3); assert.equal(warmed, 0);
  assert.equal(host.records.size, 0);
  assert.deepEqual(host.changes, []);
});

test('projection warming closes read handles on errors without hiding storage faults', async () => {
  let closed = false;
  const ctx = {
    sessionPersistence: { async open(_id, access) {
      assert.equal(access, 'read');
      return { header: { id: 'greeting' }, inheritedEventCount: 0, async read() { throw new Error('storage read failed'); }, async close() { closed = true; } };
    } },
    sessionProjectionCache: {},
  };
  await assert.rejects(warmWorkerSession(ctx, 'greeting'), /storage read failed/);
  assert.equal(closed, true);
  assert.equal(await warmWorkerSession({}, 'greeting'), undefined);
  await assert.rejects(warmWorkerSession({ sessionPersistence: ctx.sessionPersistence }, 'greeting'), /接口不可用/);
});

test('bridge retries not-found read publication but never takes a writer or mounts an Agent', async () => {
  const host = hostFixture(); host.headers.set('greeting', { cwd: 'batch-root' });
  let opens = 0;
  const ctx = {
    workspaceRegistry: host.registry,
    sessionPersistence: { async open(_id, access) {
      assert.equal(access, 'read');
      if (++opens === 1) { const error = new Error('not published'); error.name = 'SessionPersistenceNotFoundError'; throw error; }
      return { header: { id: 'greeting' }, inheritedEventCount: 0, async read() { return { events: [] }; }, async close() {} };
    } },
    sessionProjectionCache: {},
  };
  assert.equal((await attachWithHost(ctx, { cwd: 'batch-root', sessionId: 'greeting' }, { delayMs: 0, async warmListingCache() { return { asOfSeq: -1, values: {} }; } })).sessionId, 'greeting');
  assert.equal(opens, 2);
});
