import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname as pathDirname } from 'node:path';
import { BatchQueue } from './queue.js';
import { Store } from './store.js';
import { locateRuntime, prepareProfile } from './runtime.js';
import { createSdkWorker } from './worker.js';
import { createBatchLog } from './log.js';
import { readAgentPresetRoster } from './agent-roster.js';

const errorMessage = error => error?.message || String(error);
function safeLogger(logger) {
  const result = { ...logger };
  for (const method of ['info', 'warn', 'error', 'raw']) if (typeof logger[method] === 'function') {
    result[method] = (...args) => { try { return logger[method](...args); } catch { /* Logging must not terminate the Host or bypass RPC error handling. */ } };
  }
  if (logger.task) result.task = (...args) => safeLogger(logger.task(...args));
  return result;
}

export function listAgentPresets(home, runtime) {
  return readAgentPresetRoster({ ...(runtime || locateRuntime()), home });
}

export async function createBatchCore(config = {}, integration = {}) {
  const runtime = locateRuntime(config);
  const readRoster = async () => integration.listAgentPresets
    ? await integration.listAgentPresets()
    : readAgentPresetRoster(runtime);
  const store = new Store(join(runtime.home, 'batch-tasks'));
  const log = safeLogger(createBatchLog(runtime.home));
  let pluginVersion = '';
  try { pluginVersion = JSON.parse(readFileSync(join(pathDirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version; } catch {}
  log.info('batch core', { pluginVersion, dshBin: runtime.dshBin, nodePath: runtime.nodePath, home: runtime.home, harnessVersion: runtime.version, integrated: Boolean(integration.attachSession) });
  const attachments = new Set();
  const queue = new BatchQueue(store, (task, settings, update) => createSdkWorker(runtime, task, settings, event => {
    if (event?.sessionCreated) {
      const cwd = event.cwd || task.workspaceRoot || settings.cwd;
      if (integration.attachSession) {
        const attached = Promise.resolve().then(() => integration.attachSession({ cwd, sessionId: event.sessionId, title: basename(cwd || '') })).then(() => {
          log.info('workspace attached', { sessionId: event.sessionId, cwd });
        }, e => {
          log.warn('workspace attach failed', { sessionId: event.sessionId, message: errorMessage(e) });
          update({ activity: `会话列表接入失败：${errorMessage(e)}` });
        }).finally(() => attachments.delete(attached));
        attachments.add(attached);
      }
    }
    update(event);
  }, { log: log.task(task.id) }), async settings => {
    log.info('preflight', { cwd: settings.cwd, profile: settings.profile, agentPreset: settings.agentPreset, provider: settings.provider, model: settings.model });
    await prepareProfile(runtime, settings, log);
    const preset = (await readRoster()).presets.find(row => row.id === settings.agentPreset);
    if (!preset) throw new Error(`找不到 Agent 预设 ${settings.agentPreset}`);
    if (preset.broken) throw new Error(`Agent 预设不可用：${preset.broken}`);
    log.info('preflight ok', { agentPreset: settings.agentPreset });
  });
  let startupError = '', initialized = false;
  try { await queue.init(); initialized = true; }
  catch (e) {
    log.error('queue init failed', { message: errorMessage(e), stack: e?.stack });
    startupError = errorMessage(e);
  }
  async function handle(method, payload = {}) {
    if (startupError && method !== 'defaults') {
      return { ok: false, error: { code: 'batch/runtime', message: startupError, details: {} } };
    }
    try {
      let value;
      switch (method) {
        case 'snapshot': value = queue.snapshot(); break;
        case 'defaults': {
          const roster = await readRoster();
          value = {
            cwd: queue.state.batchRoot || '',
            concurrency: queue.state.concurrency || 1,
            provider: queue.state.config?.provider || 'deepseek-official',
            model: queue.state.config?.model || 'deepseek-flash',
            profile: 'batch-sdk',
            harnessVersion: runtime.version,
            home: runtime.home,
            presets: roster.presets,
            defaultAgentPreset: roster.defaultAgentPreset,
            logDir: log.dir,
            logFile: log.file,
            pluginVersion,
          };
          break;
        }
        case 'start': value = await queue.create(payload); break;
        case 'pause': value = await queue.pause(); break;
        case 'resume': value = await queue.resume(); break;
        case 'concurrency': value = await queue.setConcurrency(payload?.value); break;
        case 'clear': value = await queue.clear(); break;
        case 'repairWorkspace': value = await queue.repairWorkspace(integration.rehomeSession, integration.retireOriginalSession); break;
        case 'ackInbox': value = await queue.ackInbox(); break;
        case 'setAffix': value = await queue.setAffix(payload); break;
        case 'setPrefs': value = await queue.setPrefs(payload); break;
        case 'stopAll': value = await queue.stopAll(false); break;
        case 'forceAll': value = await queue.stopAll(true); break;
        case 'stopOne': value = await queue.stopOne(payload?.id, false); break;
        case 'forceOne': value = await queue.stopOne(payload?.id, true); break;
        default: throw new Error('未知的批量任务操作');
      }
      return { ok: true, value };
    } catch (e) {
      log.error('rpc failed', { method, message: errorMessage(e), stack: e?.stack });
      return { ok: false, error: { code: 'batch/operation-failed', message: errorMessage(e), details: {} } };
    }
  }
  return { runtime, queue, log, handle, dispose: async () => {
    if (initialized) await queue.dispose();
    await Promise.allSettled([...attachments]);
  } };
}

export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}
