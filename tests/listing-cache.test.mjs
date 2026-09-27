import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { warmListingCache } from '../src/listing-cache.js';
import { locateRuntime } from '../src/runtime.js';

const resolve = createRequire(locateRuntime().dshBin).resolve;
const { Session } = await import(pathToFileURL(resolve('@deepseek-ai/dsh-session')).href);
const { titleProjectionDefinition } = await import(pathToFileURL(resolve('@deepseek-ai/dsh-session-title')).href);
const { checkpointIdentity, projectionCacheDomainSpec } = await import(pathToFileURL(resolve('@deepseek-ai/dsh-session-projection-cache')).href);
const runtime = { Session, titleDefinition: titleProjectionDefinition, identitySchema: checkpointIdentity, domainSpec: projectionCacheDomainSpec };

function fixture() {
  const header = { version: 3, id: 'session-listing-test', cwd: process.cwd(), createdAt: 1, agentPreset: 'minimal', isSeeded: false };
  const events = [
    { seq: 0, time: 1, type: 'user/message', surfaceOp: 'append', data: { id: 'human', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] } },
    { seq: 1, time: 2, type: 'session/title', data: { title: '你好', messageSeqs: [0], source: { kind: 'fallback' } } },
    { seq: 2, time: 3, type: 'turn/start', data: { turn: 1 } },
    { seq: 3, time: 4, type: 'user/message', surfaceOp: 'append', data: { id: 'notice', role: 'user', source: { kind: 'plugin', plugin: 'batch-tasks' }, content: [{ type: 'text', text: '工作目录' }] } },
    { seq: 4, time: 5, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ];
  const writes = [], observed = [], faults = {};
  const ctx = {
    sessionProjections: { checkpoint(session) {
      observed.push(session);
      const restoredEvents = session.snapshotEvents();
      let title = titleProjectionDefinition.init(session.header, session.inheritedEventCount);
      for (const event of restoredEvents) title = titleProjectionDefinition.apply(title, event);
      const metadata = { blank: !restoredEvents.some(event => event.type === 'turn/start'),
        lastPromptAt: restoredEvents.findLast(event => event.type === 'user/message' && event.data.source.kind === 'user')?.time ?? null };
      return {
        title: { ver: titleProjectionDefinition.stateVersion, seq: session.seq - 1, val: faults.title ? 'changed' : title },
        sessionListMetadata: { ver: faults.version ? 2 : 1, seq: session.seq - 1, val: faults.metadata ? { blank: false, lastPromptAt: 999 } : metadata },
        unrelatedGoal: { ver: 1, seq: session.seq - 1, val: { goal: null } },
      };
    } },
    storageDomain: {
      get(name) {
        assert.equal(name, projectionCacheDomainSpec.name);
        if (faults.missing) return undefined;
        return { table(table) {
          assert.equal(table, 'sessions');
          return { async put(id, record) {
            if (faults.write) throw new Error('domain write failed');
            if (faults.wait) await faults.wait;
            writes.push([id, structuredClone(record)]);
          } };
        } };
      },
      open() { throw new Error('must not reopen the Host domain'); },
    },
    sessions: {
      enter() { throw new Error('must never publish a temporary Session'); },
      flush() { throw new Error('must never write a session log'); },
    },
    sessionProjectionCache: {
      coldSnapshot() { throw new Error('must not evaluate unrelated wire views'); },
      put() { throw new Error('must not call private cache methods'); },
    },
  };
  return { header, events, ctx, writes, observed, faults };
}

test('public domain writes contain only listing units at the real durable watermark', async () => {
  const f = fixture();
  const original = structuredClone([f.header, f.events]);
  const result = await warmListingCache(f.ctx, f.header, 0, f.events, { runtime });
  const restored = f.observed[0];
  assert.equal(restored.snapshotEvents().at(-1).type, 'session/end-seed', 'Expected official constructor-only boundary');
  assert.equal(restored.seq, f.events.length + 1);
  assert.equal(result.asOfSeq, f.events.length - 1);
  assert.equal(result.values.title, '你好');
  assert.deepEqual(result.values.sessionListMetadata, { blank: false, lastPromptAt: 1 });
  assert.deepEqual([f.header, f.events], original, 'Read-only preparation must not freeze or append to the durable inputs');
  assert.equal(f.writes.length, 1);
  const record = f.writes[0][1];
  assert.deepEqual(Object.keys(record.rows), ['title', 'sessionListMetadata']);
  assert.equal(record.rows.title.seq, 4);
  assert.equal(record.rows.sessionListMetadata.seq, 4);
  assert.equal(record.identity.inheritedEventCount, 0);
  assert.equal(record.identity.isSeeded, false);
  assert.equal(record.rows.unrelatedGoal, undefined);
});

test('selected state changes or unsupported unit versions are refused before any write', async () => {
  for (const field of ['metadata', 'title', 'version']) {
    const f = fixture(); f.faults[field] = true;
    await assert.rejects(warmListingCache(f.ctx, f.header, 0, f.events, { runtime }), /状态契约不兼容/);
    assert.deepEqual(f.writes, []);
  }
});

test('missing opened domain and storage faults fail without borrowing its ownership', async () => {
  const f = fixture(); f.faults.missing = true;
  await assert.rejects(warmListingCache(f.ctx, f.header, 0, f.events, { runtime }), /缓存域未打开/);
  assert.deepEqual(f.observed, []);
  f.faults.missing = false; f.faults.write = true;
  await assert.rejects(warmListingCache(f.ctx, f.header, 0, f.events, { runtime }), /domain write failed/);
  assert.deepEqual(f.writes, []);
});

test('publishing waits for the official table durability barrier', async () => {
  const f = fixture();
  let release, finished = false;
  f.faults.wait = new Promise(resolve => { release = resolve; });
  const operation = warmListingCache(f.ctx, f.header, 0, f.events, { runtime }).then(() => { finished = true; });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(finished, false);
  assert.equal(f.writes.length, 0);
  release(); await operation;
  assert.equal(finished, true);
  assert.equal(f.writes.length, 1);
});

test('an empty durable log retains an honest -1 watermark despite the virtual boundary', async () => {
  const f = fixture();
  const result = await warmListingCache(f.ctx, f.header, 0, [], { runtime });
  assert.equal(result.asOfSeq, -1);
  assert.equal(result.values.title, null);
  assert.deepEqual(result.values.sessionListMetadata, { blank: true, lastPromptAt: null });
  assert.equal(f.writes[0][1].rows.title.seq, -1);
});
