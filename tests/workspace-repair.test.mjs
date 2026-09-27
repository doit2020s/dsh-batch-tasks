import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rehomeStoredSession, retireOriginalSession } from '../src/workspace-repair.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-rehome-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const workDir = join(directory, 'batch-1', 'task-00001');
  await mkdir(workDir, { recursive: true });
  const cwd = await realpath(directory), sourceWorkDir = await realpath(workDir);
  const events = [
    { seq: 0, time: 1, type: 'user/message', surfaceOp: 'append', data: { id: 'message-one', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] } },
    { seq: 1, time: 2, type: 'session/title', data: { title: '你好', messageSeqs: [0], source: { kind: 'fallback' } } },
    { seq: 2, time: 3, type: 'turn/start', data: { turn: 1 } },
    { seq: 3, time: 4, type: 'session/end-seed', data: {} },
    { seq: 4, time: 5, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ];
  const source = { header: { version: 3, id: 'source', createdAt: 1, cwd: sourceWorkDir, agentPreset: 'minimal', isSeeded: false }, events, inheritedEventCount: 0, durable: true };
  const records = new Map([['source', structuredClone(source)]]), calls = [], attached = [];
  const faults = {};
  const missing = id => Object.assign(new Error(`session ${id} not found`), { name: 'SessionPersistenceNotFoundError' });
  const persistence = {
    async open(id, access) {
      calls.push(['open', id, access]);
      const record = records.get(id);
      if (!record) throw missing(id);
      return {
        header: structuredClone(record.header), inheritedEventCount: record.inheritedEventCount,
        async read() { calls.push(['read', id]); return { eventState: 'detached', events: structuredClone(record.events) }; },
        async close() { calls.push(['close', id, access]); },
      };
    },
    async create(header, options) {
      calls.push(['create', header.id, structuredClone(header), options]);
      assert.ok(!records.has(header.id), 'repair must never overwrite an existing session');
      const record = { header: structuredClone(header), events: [], inheritedEventCount: options.inheritedEventCount, durable: false };
      records.set(header.id, record);
      return {
        async append(batch) { calls.push(['append', header.id]); record.events = structuredClone(batch); },
        async flush() { calls.push(['flush', header.id]); if (faults.flush) throw new Error('flush failed'); record.durable = true; },
        async close() { calls.push(['close', header.id, 'write']); if (faults.close) throw new Error('close failed'); },
      };
    },
  };
  const registry = {
    async create(path) {
      calls.push(['workspace', path]);
      return { id: 'root-workspace', path, sessionIds: attached,
        async attachSession(id) {
          calls.push(['attach', id]);
          if (faults.attach) { faults.attach = false; throw new Error('registry failed'); }
          const record = records.get(id);
          assert.equal(record.durable, true, 'attachment must follow the durability barrier');
          assert.ok(projections.has(id), 'attachment must follow durable title projection publication');
          assert.equal(record.header.cwd, path);
          if (!attached.includes(id)) attached.push(id);
        },
      };
    },
    async archiveSession() { throw new Error('repair must preserve source visibility until caller has recorded success'); },
    async delete() { throw new Error('repair must not delete workspace registrations'); },
  };
  const projections = new Map();
  const sessionProjectionCache = {
    cachedSnapshot(header, cut) { assert.equal(cut, 0); return projections.get(header.id); },
  };
  const sessionProjections = { checkpoint(session) {
    const log = session.snapshotEvents();
    return {
      title: { ver: 1, seq: session.seq - 1, val: log.findLast(event => event.type === 'session/title')?.data.title ?? null },
      sessionListMetadata: { ver: 1, seq: session.seq - 1, val: { blank: !log.some(event => event.type === 'turn/start'), lastPromptAt: log.findLast(event => event.type === 'user/message' && event.data.source.kind === 'user')?.time ?? null } },
      unrelated: { ver: 1, seq: session.seq - 1, val: null },
    };
  } };
  const storageDomain = { get(name) {
    assert.equal(name, 'session_projcache');
    return { table(tableName) {
      assert.equal(tableName, 'sessions');
      return { async put(id, record) {
        calls.push(['projection', id, record.identity.inheritedEventCount]);
        assert.equal(record.identity.isSeeded, false);
        assert.deepEqual(Object.keys(record.rows), ['title', 'sessionListMetadata']);
        if (faults.projection) throw new Error('projection failed');
        if (faults.projectionDelay) await new Promise(resolve => setTimeout(resolve, 40));
        projections.set(id, { asOfSeq: record.rows.title.seq, values: { title: record.rows.title.val, sessionListMetadata: record.rows.sessionListMetadata.val } });
      } };
    } };
  } };
  const ctx = { sessionPersistence: persistence, workspaceRegistry: registry, sessionProjectionCache, sessionProjections, storageDomain };
  const input = { sourceId: 'source', targetId: 'repaired', cwd, sourceWorkDir, title: '批量任务' };
  return { ctx, input, calls, records, source, attached, faults, projections };
}

test('completed history is durably copied and officially attached to root, with original Agent and log preserved', async t => {
  const f = await fixture(t);
  const result = await rehomeStoredSession(f.ctx, f.input);
  assert.equal(result.workspaceId, 'root-workspace');
  assert.equal(result.sourceId, 'source');
  assert.equal(result.sessionId, 'repaired');
  assert.equal(result.copied, true);
  const target = f.records.get('repaired');
  assert.deepEqual(target.events, f.source.events);
  assert.equal(target.header.cwd, f.input.cwd);
  assert.equal(target.header.parentSession, 'source');
  assert.equal(target.header.isSeeded, false);
  assert.equal(target.header.agentPreset, 'minimal');
  assert.equal(target.inheritedEventCount, 0);
  assert.equal(f.projections.get('repaired').values.title, '你好');
  assert.deepEqual(f.records.get('source'), f.source);
  const writeClose = f.calls.findIndex(x => x[0] === 'close' && x[1] === 'repaired' && x[2] === 'write');
  const attach = f.calls.findIndex(x => x[0] === 'attach');
  assert.ok(writeClose < attach);
  assert.ok(f.calls.filter(x => x[0] === 'open').every(x => x[2] === 'read'));
});

test('failed registration can retry idempotently without creating or appending another copy', async t => {
  const f = await fixture(t);
  f.faults.attach = true;
  await assert.rejects(rehomeStoredSession(f.ctx, f.input), /registry failed/);
  const result = await rehomeStoredSession(f.ctx, f.input);
  assert.equal(result.copied, false);
  assert.deepEqual(f.attached, ['repaired']);
  assert.equal(f.calls.filter(x => x[0] === 'create').length, 1);
  assert.equal(f.calls.filter(x => x[0] === 'append').length, 1);
  assert.deepEqual(f.records.get('source'), f.source);
});

test('retry preserves subsequent user messages on an existing valid copy', async t => {
  const f = await fixture(t);
  await rehomeStoredSession(f.ctx, f.input);
  const added = { seq: 5, time: 6, type: 'user/message', surfaceOp: 'append', data: { id: 'message-two', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '继续' }] } };
  f.records.get('repaired').events.push(added);
  await rehomeStoredSession(f.ctx, f.input);
  assert.deepEqual(f.records.get('repaired').events.at(-1), added);
  assert.equal(f.calls.filter(x => x[0] === 'create').length, 1);
});

test('durability or writer close failure never registers or hides the original session', async t => {
  for (const fault of ['flush', 'close']) {
    const f = await fixture(t);
    f.faults[fault] = true;
    await assert.rejects(rehomeStoredSession(f.ctx, f.input), new RegExp(`${fault} failed`));
    assert.deepEqual(f.attached, []);
    assert.deepEqual(f.records.get('source'), f.source);
    assert.ok(f.calls.some(x => x[0] === 'close' && x[2] === 'write'));
  }
});

test('open or failed turns are refused before creating any new session', async t => {
  for (const last of [
    { seq: 4, type: 'turn/start', data: { turn: 'turn-2' } },
    { seq: 4, type: 'turn/end', data: { reason: { kind: 'failed' } } },
  ]) {
    const f = await fixture(t);
    f.records.get('source').events[4] = last;
    await assert.rejects(rehomeStoredSession(f.ctx, f.input), /已经完成/);
    assert.equal(f.records.size, 1);
    assert.deepEqual(f.attached, []);
  }
});

test('source cwd mismatch and occupied target identities fail closed without rewriting either log', async t => {
  const f = await fixture(t);
  await assert.rejects(rehomeStoredSession(f.ctx, { ...f.input, sourceWorkDir: f.input.cwd }), /不属于该批量任务/);
  assert.equal(f.records.size, 1);
  await rehomeStoredSession(f.ctx, f.input);
  f.records.get('repaired').header.parentSession = 'some-other-session';
  await assert.rejects(rehomeStoredSession(f.ctx, f.input), /不属于此次批量历史恢复/);
  f.records.get('repaired').header.parentSession = 'source';
  f.records.get('repaired').events[0].data.content = 'changed';
  await assert.rejects(rehomeStoredSession(f.ctx, f.input), /历史与源会话不一致/);
  assert.equal(f.calls.filter(x => x[0] === 'create').length, 1);
  assert.deepEqual(f.records.get('source'), f.source);
});

test('concurrent retries of the same target serialize to one complete copy', async t => {
  const f = await fixture(t);
  const results = await Promise.all([rehomeStoredSession(f.ctx, f.input), rehomeStoredSession(f.ctx, f.input)]);
  assert.deepEqual(results.map(x => x.copied), [true, false]);
  assert.equal(f.calls.filter(x => x[0] === 'create').length, 1);
  assert.deepEqual(f.attached, ['repaired']);
});

test('invalid identities and relative directories are rejected without touching persistence', async t => {
  const f = await fixture(t);
  await assert.rejects(rehomeStoredSession(f.ctx, { ...f.input, targetId: 'source' }), /不能改写源会话/);
  await assert.rejects(rehomeStoredSession(f.ctx, { ...f.input, targetId: '../other' }), /ID 无效/);
  await assert.rejects(rehomeStoredSession(f.ctx, { ...f.input, cwd: 'relative' }), /绝对目录/);
  assert.equal(f.calls.length, 0);
});

test('first root registration waits for asynchronous title-cache write-back', async t => {
  const f = await fixture(t);
  f.faults.projectionDelay = true;
  await rehomeStoredSession(f.ctx, f.input);
  assert.equal(f.projections.get('repaired').values.title, '你好');
  assert.ok(f.calls.findIndex(call => call[0] === 'projection') < f.calls.findIndex(call => call[0] === 'attach'));
  assert.equal(f.records.get('repaired').header.isSeeded, false);
  assert.equal(f.records.get('repaired').inheritedEventCount, 0);
});

test('title-cache failure retains the original and never attaches, then can retry the complete copy', async t => {
  const f = await fixture(t);
  f.faults.projection = true;
  await assert.rejects(rehomeStoredSession(f.ctx, f.input), /projection failed/);
  assert.deepEqual(f.attached, []);
  assert.deepEqual(f.records.get('source'), f.source);
  assert.equal(f.records.get('repaired').durable, true);
  f.faults.projection = false;
  const result = await rehomeStoredSession(f.ctx, f.input);
  assert.equal(result.copied, false);
  assert.deepEqual(f.attached, ['repaired']);
  assert.equal(f.calls.filter(call => call[0] === 'create').length, 1);
});

test('missing official title cache fails before copying or modifying any history', async t => {
  const f = await fixture(t);
  delete f.ctx.storageDomain;
  await assert.rejects(rehomeStoredSession(f.ctx, f.input), /投影缓存服务未就绪/);
  assert.deepEqual(f.records.get('source'), f.source);
  assert.equal(f.records.size, 1);
  assert.equal(f.calls.length, 0);
});

test('retirement archives first then removes only the old task registration, while preserving both logs', async t => {
  const f = await fixture(t);
  await rehomeStoredSession(f.ctx, f.input);
  const before = structuredClone([...f.records]);
  const operations = [];
  f.ctx.workspaceRegistry.archiveSession = async id => { operations.push(['archive', id]); };
  f.ctx.workspaceRegistry.resolveByPath = async path => {
    operations.push(['resolve', path]);
    return { id: 'old-child', path, sessionIds: ['source'] };
  };
  f.ctx.workspaceRegistry.delete = async id => { operations.push(['delete', id]); return true; };
  const result = await retireOriginalSession(f.ctx, f.input);
  assert.deepEqual(operations, [['archive', 'source'], ['resolve', f.input.sourceWorkDir], ['delete', 'old-child']]);
  assert.equal(result.removedWorkspaceId, 'old-child');
  assert.deepEqual([...f.records], before);
});

test('retirement retains a task workspace that contains any other session', async t => {
  const f = await fixture(t);
  let archived = false, deleted = false;
  f.ctx.workspaceRegistry.archiveSession = async () => { archived = true; };
  f.ctx.workspaceRegistry.resolveByPath = async path => ({ id: 'old-child', path, sessionIds: ['source', 'manual-session'] });
  f.ctx.workspaceRegistry.delete = async () => { deleted = true; return true; };
  const result = await retireOriginalSession(f.ctx, f.input);
  assert.equal(archived, true);
  assert.equal(deleted, false);
  assert.equal(result.removedWorkspaceId, undefined);
});

test('retirement never deletes the root workspace even if it contains only the replaced identity', async t => {
  const f = await fixture(t);
  f.records.get('source').header.cwd = f.input.cwd;
  let resolved = false, deleted = false;
  f.ctx.workspaceRegistry.archiveSession = async () => {};
  f.ctx.workspaceRegistry.resolveByPath = async () => { resolved = true; return { id: 'root', path: f.input.cwd, sessionIds: ['source'] }; };
  f.ctx.workspaceRegistry.delete = async () => { deleted = true; return true; };
  const result = await retireOriginalSession(f.ctx, { ...f.input, sourceWorkDir: f.input.cwd });
  assert.equal(resolved, false);
  assert.equal(deleted, false);
  assert.equal(result.archived, true);
});

test('retirement fails closed if source validation or archival fails', async t => {
  const f = await fixture(t);
  let deleted = false;
  f.ctx.workspaceRegistry.archiveSession = async () => { throw new Error('archive failed'); };
  f.ctx.workspaceRegistry.resolveByPath = async path => ({ id: 'old-child', path, sessionIds: [] });
  f.ctx.workspaceRegistry.delete = async () => { deleted = true; return true; };
  await assert.rejects(retireOriginalSession(f.ctx, { ...f.input, sourceWorkDir: f.input.cwd }), /不属于该批量任务/);
  await assert.rejects(retireOriginalSession(f.ctx, f.input), /archive failed/);
  assert.equal(deleted, false);
});
