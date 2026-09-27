import { createBatchCore } from './core.js';
import { attachWithHost } from './desktop-bridge.js';
import { rehomeStoredSession, retireOriginalSession } from './workspace-repair.js';

export const name = 'batch-tasks';
export const inject = ['connection', 'workspaceRegistry', 'sessionPersistence', 'sessionProjections', 'sessionProjectionCache', 'storageDomain', 'agentDefaultModel', 'agentPresets'];
export const METHODS = ['snapshot', 'defaults', 'start', 'pause', 'resume', 'concurrency', 'clear', 'ackInbox', 'setAffix', 'setPrefs', 'stopAll', 'forceAll', 'stopOne', 'forceOne', 'repairWorkspace'];

function registerRpc(ctx, handler) {
  for (const method of METHODS) {
    ctx.connection.fetch.register({
      path: `/api/batch-tasks/${method}`, methods: ['POST'], requestBody: 'buffered',
      fetch: async request => {
        let envelope;
        try {
          const text = await request.text();
          if (text.length > 5_000_000) return new Response('Request too large', { status: 413 });
          envelope = JSON.parse(text);
          if (envelope.type !== 'client-request' || typeof envelope.rpcId !== 'string' || envelope.method !== `batch-tasks/${method}`) throw new Error('Invalid RPC envelope');
        } catch { return new Response('Invalid request', { status: 400 }); }
        let result;
        try { result = await handler(method, envelope.payload); }
        catch (e) { result = { ok: false, error: { code: 'batch/operation-failed', message: e?.message || String(e), details: {} } }; }
        try { return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result }); }
        catch (e) { return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result: { ok: false, error: { code: 'batch/invalid-response', message: e?.message || String(e), details: {} } } }); }
      },
    });
  }
}

/** Host services own workspace updates; the task workers own execution. */
export async function apply(ctx, config = {}) {
  let core;
  try {
    core = await createBatchCore(config, {
      attachSession: payload => attachWithHost(ctx, payload),
      rehomeSession: payload => rehomeStoredSession(ctx, payload),
      retireOriginalSession: payload => retireOriginalSession(ctx, payload),
      listAgentPresets: async () => ({ ...await ctx.agentPresets.remoteExportList(), defaultAgentPreset: ctx.agentPresets.defaultId }),
    });
  } catch (e) {
    registerRpc(ctx, async () => ({ ok: false, error: { code: 'batch/runtime', message: e.message, details: {} } }));
    return;
  }
  ctx.effect(() => () => core.dispose(), 'batch-tasks: owned queue and isolated workers');
  registerRpc(ctx, async (method, payload) => {
    const reply = await core.handle(method, payload);
    if (method === 'defaults' && reply.ok) {
      try { Object.assign(reply.value, ctx.agentDefaultModel.currentSelection()); }
      catch (e) {
        core.log.warn('model defaults unavailable', { message: e?.message || String(e) });
        return { ok: false, error: { code: 'batch/model-defaults', message: `读取 DSH 模型设置失败：${e?.message || String(e)}`, details: {} } };
      }
    }
    return reply;
  });
}
