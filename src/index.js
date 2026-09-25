import { join } from 'node:path';
import { BatchQueue } from './queue.js';
import { Store } from './store.js';
import { locateRuntime, prepareProfile } from './runtime.js';
import { createSdkWorker } from './worker.js';

export const name = 'batch-tasks';
export const inject = ['connection', 'agentDefaultModel', 'agentPresets'];

// Exact Connection routes inherit the same authentication and Host/Origin fence
// as DSH's own /api endpoints, including desktop transport adapters.
function registerRpc(ctx, handler) {
  for (const method of ['snapshot', 'defaults', 'start', 'pause', 'resume', 'concurrency', 'clear', 'stopAll', 'forceAll', 'stopOne', 'forceOne']) {
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
        return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result: await handler(method, envelope.payload) });
      },
    });
  }
}

/** Cordis lifecycle owns the route, queue lock, timers and every child process. */
export async function apply(ctx, config = {}) {
  let runtime, startupError;
  try { runtime = locateRuntime(config); } catch (e) { startupError = e.message; }
  if (!runtime) {
    registerRpc(ctx, async () => ({ ok: false, error: { code: 'batch/runtime', message: startupError, details: {} } }));
    return;
  }
  const store = new Store(join(runtime.home, 'batch-tasks'));
  const queue = new BatchQueue(store, (task, settings, update) => createSdkWorker(runtime, task, settings, update), async settings => {
    await prepareProfile(runtime, settings);
    await ctx.agentPresets.resolveMountable(settings.agentPreset);
  });
  await queue.init();
  ctx.effect(() => () => queue.dispose(), 'batch-tasks: queue and isolated SDK workers');
  registerRpc(ctx, async (method, payload) => {
    try {
      let value;
      switch (method) {
        case 'snapshot': value = queue.snapshot(); break;
        case 'defaults': {
          const roster = await ctx.agentPresets.remoteExportList();
          value = { cwd: '', ...ctx.agentDefaultModel.currentSelection(), profile: 'batch-sdk', harnessVersion: runtime.version, home: runtime.home, presets: roster.presets, defaultAgentPreset: ctx.agentPresets.defaultId };
          break;
        }
        case 'start': value = await queue.create(payload); break;
        case 'pause': value = await queue.pause(); break;
        case 'resume': value = await queue.resume(); break;
        case 'concurrency': value = await queue.setConcurrency(payload?.value); break;
        case 'clear': value = await queue.clear(); break;
        case 'stopAll': value = await queue.stopAll(false); break;
        case 'forceAll': value = await queue.stopAll(true); break;
        case 'stopOne': value = await queue.stopOne(payload?.id, false); break;
        case 'forceOne': value = await queue.stopOne(payload?.id, true); break;
        default: throw new Error('未知的批量任务操作');
      }
      return { ok: true, value };
    } catch (e) { return { ok: false, error: { code: 'batch/operation-failed', message: e.message, details: {} } }; }
  });
}
