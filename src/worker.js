import { spawn, execFile } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { promisify } from 'node:util';
import { presetPatchPath } from './preset-patch.js';
const execFileAsync = promisify(execFile);

/** Only address a still-owned child. Never kill all node.exe/dsh processes. */
export async function killTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    try { await execFileAsync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }); }
    catch (e) { if (child.exitCode === null && child.signalCode === null) throw new Error(`无法确认任务进程已终止：${e.message}`); }
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (e) { if (e.code !== 'ESRCH') throw e; }
  }
}

/** Official SDK JSON-RPC transport, one process and one durable root session per task. */
export function createSdkWorker(runtime, task, config, notify, options = {}) {
  const workDir = task.workDir || config.cwd;
  const args = [runtime.dshBin, '--profile', config.profile];
  if (task.agentPreset) args.push('--patch', options.patch || presetPatchPath(workDir));
  else if (options.patch) args.push('--patch', options.patch);
  const child = spawn(runtime.nodePath, args, {
    cwd: workDir, shell: false, windowsHide: true, detached: process.platform !== 'win32',
    env: { ...process.env, DSH_HOME: runtime.home, DSH_BATCH_DSH_BIN: runtime.dshBin, ELECTRON_RUN_AS_NODE: '1', DSH_MAX_TOKENS_AS_SUCCESS: 'false', ...options.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  let buffer = '', stderr = '', result = '', completedReason = null, error = null;
  let accepted = false, sawTurn = false, stopping = false, killed = false, closed = false, stoppingTimer, completionTimer;
  const decoder = new StringDecoder('utf8');
  const graceMs = options.graceMs ?? 10000;
  const send = (id, method, params) => {
    if (!closed && !child.stdin.destroyed && child.stdin.writable) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }) + '\n');
  };
  const force = () => {
    if (closed) return;
    killed = true; stopping = true; clearTimeout(stoppingTimer);
    void killTree(child).catch(e => { error = e.message; notify({ activity: error }); });
  };
  const shutdown = () => {
    if (closed) return;
    if (!stopping) { stopping = true; send(99, 'shutdown'); stoppingTimer = setTimeout(force, graceMs); }
  };
  const fail = message => { error = message; notify({ activity: message }); shutdown(); };
  const startupTimer = setTimeout(() => fail('SDK 初始化或任务投递超过 60 秒'), options.startupMs ?? 60000);
  const taskTimer = setTimeout(() => fail(`任务超过 ${config.timeoutMinutes} 分钟，已中断`), config.timeoutMinutes * 60000);
  child.stdin.on('error', e => { if (!closed && !stopping) fail(`SDK 输入管道失败：${e.message}`); });
  child.stderr.on('data', d => { stderr = (stderr + d.toString()).slice(-8000); });

  function frame(message) {
    if (message.id === 1) {
      if (stopping) return;
      if (message.error) return fail(`SDK 初始化失败：${message.error.message}`);
      if (message.result?.serverInfo?.name !== 'deepseek-harness-sdk-runtime') return fail('执行 Profile 未返回官方 SDK 握手');
      if (task.agentPreset && message.result?.agentPreset !== task.agentPreset) return fail('执行 Profile 未确认所选 Agent 预设，任务未投递');
      if (task.agentPreset) send(3, 'session/create', { sessionId: task.sessionId });
      else send(2, 'session/prompt', { sessionId: task.sessionId, contentBlocks: [{ type: 'text', text: task.prompt }] });
      return;
    }
    if (message.id === 3) {
      if (stopping) return;
      if (message.error) return fail(`Agent 预设挂载失败：${message.error.message}`);
      if (message.result?.sessionId !== task.sessionId || message.result?.agentPreset !== task.agentPreset) return fail('会话未确认所选 Agent 预设，任务未投递');
      send(2, 'session/prompt', { sessionId: task.sessionId, contentBlocks: [{ type: 'text', text: task.prompt }] });
      return;
    }
    if (message.id === 2) {
      if (message.error) return fail(`任务投递失败：${message.error.message}`);
      accepted = true; clearTimeout(startupTimer); notify({ ready: true, activity: '任务已进入会话' });
      return;
    }
    const p = message.params;
    if (!p || p.sessionId !== task.sessionId) return;
    if (message.method === 'session.event') {
      const event = p.event;
      if (event?.type === 'turn/start') { sawTurn = true; completedReason = null; }
      if (event?.type === 'assistant/message') {
        const text = event.data?.message?.content?.filter(x => x.type === 'text').map(x => x.text).join('') || '';
        if (text) { result = text.slice(-100000); notify({ result, activity: '正在执行' }); }
      }
      if (event?.type === 'tool/start') notify({ activity: `工具执行：${event.data?.name || '处理中'}` });
      if (event?.type === 'turn/end' && sawTurn) {
        completedReason = event.data?.reason;
        if (completedReason?.kind === 'error') error = completedReason.error?.message || '模型或工具执行失败';
        // Idle normally follows. Also bound a malformed/missing idle notification.
        clearTimeout(completionTimer); completionTimer = setTimeout(shutdown, 1000);
      }
    }
    if (message.method === 'session.status' && p.status === 'idle' && sawTurn && completedReason) shutdown();
  }
  child.stdout.on('data', chunk => {
    buffer += decoder.write(chunk);
    if (buffer.length > 16_000_000) return fail('SDK 单帧超过 16MB');
    let cut;
    while ((cut = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, cut).trim(); buffer = buffer.slice(cut + 1);
      if (!line) continue;
      try { frame(JSON.parse(line)); } catch { fail('SDK 输出不是合法 JSON-RPC，请检查执行配置中的插件'); }
    }
  });
  child.once('spawn', () => send(1, 'initialize', { cwd: workDir, provider: config.provider, model: config.model, ...(task.agentPreset ? { agentPreset: task.agentPreset } : {}) }));
  child.once('error', e => { error = `无法启动 DSH：${e.message}`; });
  child.once('close', (code, signal) => {
    closed = true;
    for (const t of [startupTimer, taskTimer, stoppingTimer, completionTimer]) clearTimeout(t);
    let status = 'failed';
    if (killed) status = 'killed';
    else if (accepted && completedReason?.kind === 'completed' && !error && code === 0) status = 'succeeded';
    else if (task.stopRequested) status = 'cancelled';
    if (status === 'failed' && !error) error = `执行未正常完成 (${completedReason?.kind || `exit=${code}, signal=${signal}`})。${stderr.slice(-2000)}`;
    resolveDone({ status, result, error, fatal: !accepted && !!error });
  });
  return { pid: child.pid, done, stop: immediately => immediately ? force() : shutdown() };
}
