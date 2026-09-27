import { attachSessionToWorkspace } from './workspace-attach.js';
import { warmListingCache } from './listing-cache.js';

export const DESKTOP_BRIDGE_PATH = '/api/batch-tasks-desktop/attach';

/** Populate the Host's official listing cache without adopting a worker Agent. */
export async function warmWorkerSession(ctx, sessionId, options = {}) {
  const persistence = ctx.sessionPersistence;
  const cache = ctx.sessionProjectionCache;
  if (!persistence && !cache) return;
  if (typeof persistence?.open !== 'function' || !cache) {
    throw new Error('DSH 外部会话读取或投影缓存接口不可用');
  }
  const handle = await persistence.open(sessionId, 'read');
  let snapshot;
  let header;
  let inheritedEventCount;
  try {
    header = handle.header;
    inheritedEventCount = handle.inheritedEventCount;
    if (header?.id !== sessionId || !Number.isSafeInteger(inheritedEventCount) || inheritedEventCount < 0) {
      throw new Error('DSH 会话读取返回了不匹配的历史标识');
    }
    const read = await handle.read(0);
    if (!Array.isArray(read?.events)) throw new Error('DSH 会话读取返回了无效的历史记录');
    if (options.requireStarted && !read.events.some(event => event.type === 'turn/start')) {
      const error = new Error('DSH 任务开始事件尚未落盘，暂不能发布非空会话');
      error.name = 'SessionListingNotPublishedError';
      throw error;
    }
    snapshot = await (options.warmListingCache ?? warmListingCache)(ctx, header, inheritedEventCount, read.events);
  } finally {
    await handle.close();
  }
  // Publish workspace membership only after the Host's zero-I/O listing can
  // see the same title from the shared public storage-domain write chain.
  if (typeof cache.cachedSnapshot === 'function' && snapshot?.values && Object.hasOwn(snapshot.values, 'title')) {
    const attempts = options.cacheAttempts ?? 50;
    const keys = ['title', ...(Object.hasOwn(snapshot.values, 'sessionListMetadata') ? ['sessionListMetadata'] : [])];
    for (let attempt = 1; ; attempt++) {
      const listed = cache.cachedSnapshot(header, inheritedEventCount, keys);
      if (listed?.values && keys.every(key => JSON.stringify(listed.values[key]) === JSON.stringify(snapshot.values[key]))) break;
      if (attempt >= attempts) throw new Error('DSH 会话列表投影未及时发布到宿主缓存');
      await new Promise(resolve => setTimeout(resolve, options.delayMs ?? 100));
    }
  }
  return snapshot;
}

/** Register the worker's persisted session through the current Host owner. */
export async function attachWithHost(ctx, payload = {}, options = {}) {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new Error('会话登记请求无效');
  if (payload.requireStarted !== undefined && typeof payload.requireStarted !== 'boolean') throw new Error('会话开始状态无效');
  // The SDK creation acknowledgement may arrive just before another process
  // can list the newly created header. Only that definite absence is retried;
  // path conflicts and storage faults remain visible to the queue.
  const attempts = options.attempts ?? 50;
  for (let attempt = 1; ; attempt++) {
    try {
      const snapshot = await warmWorkerSession(ctx, payload.sessionId, { ...options, requireStarted: payload.requireStarted || options.requireStarted });
      const attached = await attachSessionToWorkspace(ctx.workspaceRegistry, payload.cwd, payload.sessionId, payload.title);
      return { ...attached, listingReady: snapshot?.values?.sessionListMetadata?.blank === false, asOfSeq: snapshot?.asOfSeq ?? null };
    }
    catch (e) {
      if (attempt >= attempts || !(e.name === 'SessionPersistenceNotFoundError' || e.name === 'SessionListingNotPublishedError' || /session persistence holds no such session/.test(e.message))) throw e;
      await new Promise(resolve => setTimeout(resolve, options.delayMs ?? 100));
    }
  }
}

/**
 * Optional bridge for an external batch launcher. Connection owns the same
 * authentication and Host/Origin fence as the official DSH Remote endpoints.
 * Native plugin dispatch can call attachWithHost directly instead.
 */
export function registerDesktopBridge(ctx, options = {}) {
  return ctx.connection.fetch.register({
    path: DESKTOP_BRIDGE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async request => {
      let payload;
      try {
        const text = await request.text();
        if (text.length > 16384) return new Response('Request too large', { status: 413 });
        payload = JSON.parse(text);
      } catch { return new Response('Invalid request', { status: 400 }); }
      try {
        const value = await attachWithHost(ctx, payload);
        await options.onAttached?.(value);
        return Response.json({ ok: true, value });
      } catch (e) {
        return Response.json({ ok: false, error: { code: 'batch/workspace-attach', message: e.message, details: {} } });
      }
    },
  });
}
