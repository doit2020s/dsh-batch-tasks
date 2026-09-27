import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { locateRuntime } from './runtime.js';

let runtimeModules;
async function listingRuntime() {
  runtimeModules ??= (async () => {
    const resolve = createRequire(locateRuntime().dshBin).resolve;
    const [sessions, titles, cache] = await Promise.all([
      import(pathToFileURL(resolve('@deepseek-ai/dsh-session')).href),
      import(pathToFileURL(resolve('@deepseek-ai/dsh-session-title')).href),
      import(pathToFileURL(resolve('@deepseek-ai/dsh-session-projection-cache')).href),
    ]);
    if (typeof sessions.Session?.fromRestore !== 'function' || !titles.titleProjectionDefinition
      || typeof cache.checkpointIdentity?.parse !== 'function' || !cache.projectionCacheDomainSpec) {
      throw new Error('Harness 未提供官方会话列表缓存契约，无法安全发布任务标题');
    }
    return { Session: sessions.Session, titleDefinition: titles.titleProjectionDefinition,
      identitySchema: cache.checkpointIdentity, domainSpec: cache.projectionCacheDomainSpec };
  })();
  return runtimeModules;
}

function listMetadata(events) {
  // ApiSessionList's stateVersion 1 fold: these are the only two durable
  // triggers. A constructor-only session/end-seed cannot change either field.
  let blank = true, lastPromptAt = null;
  for (const event of events) {
    if (event.type === 'turn/start') blank = false;
    if (event.type === 'user/message' && event.data.source.kind === 'user') lastPromptAt = event.time;
  }
  return { blank, lastPromptAt };
}

/** Publish only official title/list metadata rows, without Agents or log writes. */
export async function warmListingCache(ctx, header, inheritedEventCount, events, options = {}) {
  if (!header?.id || !Array.isArray(events) || !Number.isSafeInteger(inheritedEventCount) || inheritedEventCount < 0) {
    throw new Error('会话列表缓存的历史标识无效');
  }
  if (typeof ctx.sessionProjections?.checkpoint !== 'function' || typeof ctx.storageDomain?.get !== 'function') {
    throw new Error('DSH 官方会话投影或存储域服务未就绪');
  }
  const runtime = options.runtime ?? await listingRuntime();
  const domain = ctx.storageDomain.get(runtime.domainSpec.name);
  if (!domain || typeof domain.table !== 'function') throw new Error('DSH 官方会话列表缓存域未打开');
  const table = domain.table('sessions');
  if (typeof table?.put !== 'function') throw new Error('DSH 官方会话列表缓存表不可写');

  // This temporary official Session is never entered into ctx.sessions and
  // never flushed. Clone the log because fromRestore owns its supplied values.
  // checkpoint folds raw states without evaluating unrelated wire schemas.
  const session = runtime.Session.fromRestore(header.id, structuredClone(events), structuredClone(header), inheritedEventCount, 'detached');
  const checkpoint = ctx.sessionProjections.checkpoint(session);
  const titleDef = runtime.titleDefinition;
  let title = titleDef.init(header, inheritedEventCount);
  for (const event of events) title = titleDef.apply(title, event);
  const expected = { title, sessionListMetadata: listMetadata(events) };
  const cut = events.at(-1)?.seq ?? -1;
  const rows = {};
  for (const [key, value] of Object.entries(expected)) {
    const row = checkpoint[key];
    const version = key === 'title' ? titleDef.stateVersion : 1;
    // Prove the temporary constructor's added end-seed did not change these
    // states, then bind their checkpoint to the ACTUAL durable log watermark.
    if (!row || row.ver !== version || JSON.stringify(row.val) !== JSON.stringify(value)) {
      throw new Error(`Harness 会话列表投影 ${key} 的状态契约不兼容，原会话保留`);
    }
    rows[key] = { ver: row.ver, seq: cut, val: structuredClone(value) };
  }
  const identity = runtime.identitySchema.parse({ formatVersion: header.version, createdAt: header.createdAt,
    ...(header.cwd === undefined ? {} : { cwd: header.cwd }), isSeeded: header.isSeeded, inheritedEventCount });
  // Borrow the Host's already-open public domain. Never reopen or close it,
  // access private cache methods, or write storage files behind its owner.
  await table.put(header.id, { identity, rows });
  return { asOfSeq: cut, values: { title: titleDef.wire.viewSchema.parse(titleDef.wire.view(title)), sessionListMetadata: expected.sessionListMetadata } };
}
