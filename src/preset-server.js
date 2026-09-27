import { createRequire } from 'node:module';
import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bindTaskWorkDir, absoluteTaskPath } from './task-workdir.js';

// Resolve against the CLI that booted this child. Its bundled Harness version
// owns the protocol, agent factory, and session format used by this process.
const cliPath = process.env.DSH_BATCH_DSH_BIN || process.argv[1] || import.meta.url;
const requireFromCli = createRequire(isAbsolute(cliPath) || cliPath.startsWith('file:') ? cliPath : resolve(cliPath));
let runtimeVersion = 'unknown';
try { runtimeVersion = requireFromCli('@deepseek-ai/dsh/package.json').version; } catch {}
async function loadSdkRuntime() {
  try {
    const [server, protocol] = await Promise.all([
      import(pathToFileURL(requireFromCli.resolve('@deepseek-ai/dsh-sdk-jsonrpc-server')).href),
      import(pathToFileURL(requireFromCli.resolve('@deepseek-ai/dsh-sdk-protocol')).href),
    ]);
    const Server = server.HarnessSdkJsonRpcServer;
    if (typeof Server !== 'function' || typeof protocol.JsonRpcLineTransport !== 'function'
      || ['initialize', 'getOrCreateSession', 'prompt', 'shutdown', 'handleRequest'].some(method => typeof Server.prototype[method] !== 'function')) {
      throw new Error('required SDK server/transport methods are unavailable');
    }
    return { HarnessSdkJsonRpcServer: Server, JsonRpcLineTransport: protocol.JsonRpcLineTransport };
  } catch (cause) {
    throw new Error(`Harness ${runtimeVersion} is incompatible with the batch SDK bridge: required official SDK server/transport API could not be loaded; no task was delivered`, { cause });
  }
}
const { HarnessSdkJsonRpcServer, JsonRpcLineTransport } = await loadSdkRuntime();

/** Official SDK transport with a preset composed before each agent is published. */
export class PresetSdkJsonRpcServer extends HarnessSdkJsonRpcServer {
  async initialize(params) {
    if (this.initialized) throw new Error('SDK server is already initialized');
    if (typeof this.ctx.agentPresets?.resolveMountable !== 'function' || typeof this.ctx.agentPresets?.mount !== 'function'
      || typeof this.ctx.agents?.create !== 'function' || typeof this.getOrCreateSession !== 'function') {
      throw new Error(`Harness ${runtimeVersion} does not provide the supported Agent preset and session factory API; no task was delivered`);
    }
    if (!(this.sessions instanceof Map) || !(this.sessionCreations instanceof Map)) {
      throw new Error(`Harness ${runtimeVersion} uses an unsupported SDK session lifecycle; no task was delivered`);
    }
    if (typeof this.ctx.sessionTitle?.rename !== 'function' || typeof this.ctx.sessions?.flush !== 'function') {
      throw new Error(`Harness ${runtimeVersion} cannot publish a durable batch session title; no task was delivered`);
    }
    const id = params?.agentPreset;
    if (typeof id !== 'string' || !id.trim() || id !== id.trim()) {
      throw new TypeError('initialize agentPreset must be a non-empty preset id');
    }
    const taskWorkDir = params?.taskWorkDir;
    if (!absoluteTaskPath(taskWorkDir) || /[\r\n\0]/.test(taskWorkDir) || !(await stat(taskWorkDir)).isDirectory()) {
      throw new TypeError('initialize taskWorkDir must be an existing absolute directory');
    }
    const preset = await this.ctx.agentPresets.resolveMountable(id);
    const result = await super.initialize(params);
    this.ctx.effect(() => bindTaskWorkDir(this.ctx, taskWorkDir), 'batch:task-workdir');
    this.presetId = preset.id;
    return { ...result, agentPreset: preset.id, taskWorkDir };
  }

  async createSession(sessionId) {
    if (!this.presetId) throw new Error('agent preset was not initialized');
    const presetId = this.presetId;
    const handle = await this.ctx.agents.create({
      sessionId,
      meta: { cwd: this.cwd, agentPreset: presetId },
      agentOptions: {
        provider: this.provider,
        model: this.model,
        ...(this.reasoningEffort === undefined ? {} : { reasoningEffort: this.reasoningEffort }),
        ...(this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens }),
      },
      setup: async agentCtx => { await this.ctx.agentPresets.mount(agentCtx, presetId); },
    });
    const record = { handle };
    this.sessions.set(sessionId, record);
    return record;
  }

  async handleRequest(method, params) {
    if (method !== 'session/create') return super.handleRequest(method, params);
    if (!this.initialized) throw new Error('SDK server is not initialized');
    const sessionId = params?.sessionId;
    if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId !== sessionId.trim()) {
      throw new TypeError('session/create sessionId must be a non-empty string');
    }
    const title = params?.title;
    if (typeof title !== 'string' || !title.trim()) throw new TypeError('session/create title must be a non-empty string');
    const record = await this.getOrCreateSession(sessionId);
    this.ctx.sessionTitle.rename(record.handle.agent.session, title);
    await this.ctx.sessions.flush(record.handle.agent.session);
    return { sessionId, agentPreset: this.presetId };
  }
}

export const name = 'batch-preset-jsonrpc-server';
export const inject = ['agents', 'agentPresets', 'tools', 'systemPrompt', 'sessionTitle', 'sessions'];

/** Matches the official server's stdio, loader, disposal, and shutdown contract. */
export function apply(ctx, config = {}) {
  const rootFiber = ctx.root.fiber;
  const transport = new JsonRpcLineTransport(config.input ?? process.stdin, config.output ?? process.stdout);
  const server = new PresetSdkJsonRpcServer(ctx, transport, { maxTokensAsSuccess: config.maxTokensAsSuccess ?? false });
  const exit = config.exit ?? (code => process.exit(code));
  let exitTask;
  const disposeAndExit = () => {
    exitTask ??= (async () => {
      await Promise.allSettled([Promise.resolve().then(() => transport.flush())]);
      await Promise.allSettled([Promise.resolve().then(() => rootFiber.dispose())]);
      exit(0);
    })();
    return exitTask;
  };
  transport.onRequest(async (method, params) => {
    if (method === 'initialize') await ctx.get('loader')?.await();
    const result = await server.handleRequest(method, params);
    if (method === 'shutdown') setImmediate(() => { void disposeAndExit(); });
    return result;
  });
  ctx.effect(() => {
    transport.start();
    return async () => {
      await server.shutdown();
      transport.close();
    };
  }, 'batch-preset-jsonrpc-server.serve');
}
