import { spawn, execFile } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { promisify } from 'node:util';
import { presetPatchPath } from './preset-patch.js';
const execFileAsync = promisify(execFile);

const PROFILE_ROOT_RACE = /failed to validate config file[\s\S]*cordis\.yml|config file must be a top-level array/i;

/** Only address a still-owned child. Never kill all node.exe/dsh processes. */
export async function killTree(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    try { await execFileAsync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000, encoding: 'buffer' }); }
    catch (e) { if (child.exitCode === null && child.signalCode === null) throw new Error('无法确认任务进程已终止'); }
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (e) { if (e.code !== 'ESRCH') throw e; }
  }
}

let bootTail = Promise.resolve();
function takeBootLock() {
  let release = () => {};
  const held = new Promise(resolve => { release = resolve; });
  const turn = bootTail;
  bootTail = turn.then(() => held, () => held);
  return turn.then(() => release);
}

/** Official SDK JSON-RPC transport, one process and one durable root session per task. */
export function createSdkWorker(runtime, task, config, notify, options = {}) {
  const log = options.log;
  const workDir = task.workDir || config.cwd;
  const args = [runtime.dshBin, '--profile', config.profile];
  if (task.agentPreset) args.push('--patch', options.patch || presetPatchPath(workDir));
  else if (options.patch) args.push('--patch', options.patch);
  const maxAttempts = options.profileBootAttempts ?? 6;
  let child = null;
  let attempts = 0;
  let releaseBoot = () => {};
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  let buffer = '', stderr = '', result = '', completedReason = null, error = null;
  let accepted = false, sawTurn = false, stopping = false, killed = false, closed = false, stoppingTimer, completionTimer;
  let rootIdle = false;
  const liveChildren = new Set();
  const toolChild = new Map();
  const decoder = new StringDecoder('utf8');
  const graceMs = options.graceMs ?? 10000;
  const send = (id, method, params) => {
    if (!child || closed || child.stdin.destroyed || !child.stdin.writable) return;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }) + '\n');
  };
  const force = () => {
    if (closed && !child) return;
    killed = true; stopping = true; clearTimeout(stoppingTimer);
    if (!child) { finishWithoutChild(); return; }
    void killTree(child).catch(e => { error = e.message; notify({ activity: error }); });
  };
  const shutdown = () => {
    if (closed && !child) return;
    if (!child) { stopping = true; finishWithoutChild(); return; }
    if (!stopping) { stopping = true; send(99, 'shutdown'); stoppingTimer = setTimeout(force, graceMs); }
  };
  const fail = message => { error = message; log?.error('sdk fail', { taskId: task.id, message, stderr: stderr.slice(-4000) }); notify({ activity: message }); shutdown(); };
  const resetCompletionTimer = () => { clearTimeout(completionTimer); completionTimer = undefined; };
  let startupTimer;
  const timeoutMs = Math.max(1, Number(config.timeoutMinutes) || 30) * 60000;
  const hardMs = 12 * 60 * 60000;
  const startedAt = Date.now();
  let taskTimer;
  const armIdleTimeout = () => {
    clearTimeout(taskTimer);
    taskTimer = setTimeout(() => {
      if (Date.now() - startedAt >= hardMs) return fail('任务超过 12 小时，已中断');
      fail(`任务超过 ${config.timeoutMinutes} 分钟无进展，已中断`);
    }, timeoutMs);
  };
  const bump = () => armIdleTimeout();
  const hardTimer = setTimeout(() => fail('任务超过 12 小时，已中断'), hardMs);

  function finishWithoutChild() {
    closed = true;
    for (const timer of [startupTimer, taskTimer, hardTimer, stoppingTimer, completionTimer]) clearTimeout(timer);
    resolveDone({ status: task.stopRequested ? 'cancelled' : killed ? 'killed' : 'failed', result, error, fatal: !task.stopRequested && !!error });
  }

  function frame(message) {
    if (message.id === 1) {
      if (stopping) return;
      if (message.error) {
        log?.error('initialize error', { taskId: task.id, error: message.error, result: message.result });
        return fail(`SDK 初始化失败：${message.error.message}`);
      }
      bump();
      releaseBoot();
      log?.info('initialize ok', { taskId: task.id, agentPreset: message.result?.agentPreset, server: message.result?.serverInfo?.name });
      if (message.result?.serverInfo?.name !== 'deepseek-harness-sdk-runtime') return fail('执行 Profile 未返回官方 SDK 握手');
      if (task.agentPreset && message.result?.agentPreset !== task.agentPreset) return fail('执行 Profile 未确认所选 Agent 预设，任务未投递');
      if (task.agentPreset && message.result?.taskWorkDir !== workDir) return fail('执行 Profile 未确认任务子目录，任务未投递');
      if (task.agentPreset) send(3, 'session/create', { sessionId: task.sessionId, title: task.title || task.source || task.prompt });
      else send(2, 'session/prompt', { sessionId: task.sessionId, contentBlocks: [{ type: 'text', text: task.prompt }] });
      return;
    }
    if (message.id === 3) {
      if (stopping) return;
      if (message.error) {
        log?.error('session/create error', { taskId: task.id, error: message.error });
        return fail(`Agent 预设挂载失败：${message.error.message}`);
      }
      if (message.result?.sessionId !== task.sessionId || message.result?.agentPreset !== task.agentPreset) return fail('会话未确认所选 Agent 预设，任务未投递');
      bump();
      notify({ sessionCreated: true, sessionId: task.sessionId, cwd: task.workspaceRoot || config.cwd, workDir, title: task.title || task.source || '' });
      send(2, 'session/prompt', { sessionId: task.sessionId, contentBlocks: [{ type: 'text', text: task.prompt }] });
      return;
    }
    if (message.id === 2) {
      if (message.error) return fail(`任务投递失败：${message.error.message}`);
      accepted = true; clearTimeout(startupTimer); bump(); notify({ ready: true, activity: '任务已进入会话' });
      return;
    }
    const p = message.params || {};
    const maybeFinish = () => {
      if (stopping || closed || !sawTurn || !completedReason) return;
      if (liveChildren.size > 0) {
        resetCompletionTimer();
        log?.info('wait subagents', { taskId: task.id, live: [...liveChildren] });
        notify({ activity: `等待 ${liveChildren.size} 个子 agent 结束` });
        return;
      }
      if (!rootIdle && completedReason?.kind !== 'error') {
        if (!completionTimer) completionTimer = setTimeout(() => { rootIdle = true; maybeFinish(); }, 1000);
        return;
      }
      shutdown();
    };
    if (message.method === 'subagent.started') {
      const parent = p.parentSessionId;
      if (parent === task.sessionId || liveChildren.has(parent)) {
        liveChildren.add(p.childSessionId);
        resetCompletionTimer();
        bump();
        log?.info('subagent started', { taskId: task.id, child: p.childSessionId, parent, live: liveChildren.size });
        notify({ activity: `子 agent 运行中（${liveChildren.size}）` });
      }
      return;
    }
    if (message.method === 'subagent.finished') {
      liveChildren.delete(p.childSessionId);
      bump();
      log?.info('subagent finished', { taskId: task.id, child: p.childSessionId, status: p.status, live: liveChildren.size });
      maybeFinish();
      return;
    }
    if (message.method === 'session.status') {
      if (p.sessionId === task.sessionId) {
        rootIdle = p.status === 'idle';
        if (p.status === 'running') { rootIdle = false; bump(); }
        if (rootIdle && sawTurn && completedReason) maybeFinish();
      }
      return;
    }
    if (message.method !== 'session.event') return;
    const event = p.event;
    if (p.sessionId !== task.sessionId) {
      bump();
      if (event?.type === 'tool/start' || event?.type === 'tool/call') notify({ activity: `子 agent 工具：${event.data?.name || '处理中'}` });
      return;
    }
    bump();
    if (event?.type === 'turn/start') {
      sawTurn = true; completedReason = null; rootIdle = false;
      notify({ sessionStarted: true, sessionId: task.sessionId, cwd: task.workspaceRoot || config.cwd });
    }
    if (event?.type === 'assistant/message') {
      const text = event.data?.message?.content?.filter(x => x.type === 'text').map(x => x.text).join('') || '';
      if (text) { result = text.slice(-100000); notify({ result, activity: '正在执行' }); }
    }
    if (event?.type === 'tool/start' || event?.type === 'tool/call') {
      const name = String(event.data?.name || '');
      notify({ activity: `工具执行：${name || '处理中'}` });
      if (/^subagent/.test(name)) {
        const id = String(event.data?.id || event.data?.toolCallId || event.data?.callId || `${name}:${Date.now()}`);
        const cid = `tool:${id}`;
        liveChildren.add(cid);
        toolChild.set(id, cid);
        resetCompletionTimer();
        log?.info('subagent tool start', { taskId: task.id, name, id, live: liveChildren.size });
        notify({ activity: `子 agent 运行中（${liveChildren.size}）` });
      }
    }
    if (event?.type === 'tool/end' || event?.type === 'tool/result') {
      const id = String(event.data?.id || event.data?.toolCallId || event.data?.callId || event.data?.message?.callId || '');
      if (event.data?.message?.isError) {
        const detail = event.data.message.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') || '工具返回错误';
        log?.warn('tool error', { taskId: task.id, callId: id, detail: detail.slice(-4000) });
        notify({ activity: `工具调用失败：${detail.slice(0, 300)}` });
      }
      const cid = toolChild.get(id);
      if (cid) {
        liveChildren.delete(cid);
        toolChild.delete(id);
        log?.info('subagent tool end', { taskId: task.id, id, live: liveChildren.size });
        maybeFinish();
      }
    }
    if (event?.type === 'turn/end' && sawTurn) {
      completedReason = event.data?.reason;
      if (completedReason?.kind === 'error') error = completedReason.error?.message || '模型或工具执行失败';
      resetCompletionTimer();
      if (liveChildren.size === 0) completionTimer = setTimeout(() => { rootIdle = true; maybeFinish(); }, 1000);
      else maybeFinish();
    }
  }

  function bindChild(next) {
    child = next;
    child.stdin.on('error', e => { if (!closed && !stopping) fail(`SDK 输入管道失败：${e.message}`); });
    child.stderr.on('data', d => {
      const text = d.toString();
      stderr = (stderr + text).slice(-8000);
      log?.raw?.('stderr', text);
    });
    child.stdout.on('data', chunk => {
      buffer += decoder.write(chunk);
      if (buffer.length > 16_000_000) return fail('SDK 单帧超过 16MB');
      let cut;
      while ((cut = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, cut).trim(); buffer = buffer.slice(cut + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); }
        catch { fail('SDK 输出不是合法 JSON-RPC，请检查执行配置中的插件'); continue; }
        try { frame(message); }
        catch (e) { fail(`SDK 会话事件处理失败：${e.message}`); }
      }
    });
    // Header cwd groups the session under the batch workspace. The isolated
    // SDK server separately binds and confirms the task directory for tools.
    child.once('spawn', () => send(1, 'initialize', { cwd: task.workspaceRoot || config.cwd, taskWorkDir: workDir, provider: config.provider, model: config.model, ...(task.agentPreset ? { agentPreset: task.agentPreset } : {}) }));
    child.once('error', e => { error = `无法启动 DSH：${e.message}`; });
    child.once('close', (code, signal) => {
      releaseBoot();
      const raced = !accepted && !killed && PROFILE_ROOT_RACE.test(`${error || ''}\n${stderr}`);
      if (raced && attempts < maxAttempts && !task.stopRequested) {
        log?.warn('profile root race, retry spawn', { taskId: task.id, attempt: attempts, code });
        notify({ activity: `配置文件冲突，正在重试启动（${attempts}/${maxAttempts}）` });
        error = null; stderr = ''; buffer = ''; closed = false;
        void queueBoot();
        return;
      }
      closed = true;
      for (const t of [startupTimer, taskTimer, hardTimer, stoppingTimer, completionTimer]) clearTimeout(t);
      let status = 'failed';
      if (killed) status = 'killed';
      else if (accepted && completedReason?.kind === 'completed' && !error && code === 0) status = 'succeeded';
      else if (task.stopRequested) status = 'cancelled';
      if (status === 'failed' && !error) error = `执行未正常完成 (${completedReason?.kind || `exit=${code}, signal=${signal}`})。${stderr.slice(-2000)}`;
      log?.info('sdk exit', { taskId: task.id, status, code, signal, error, accepted, attempts });
      resolveDone({ status, result, error, fatal: !accepted && !!error });
    });
  }

  function spawnOnce() {
    attempts += 1;
    startupTimer ??= setTimeout(() => fail('SDK 初始化或任务投递超过 60 秒'), options.startupMs ?? 60000);
    armIdleTimeout();
    log?.info('spawn', { taskId: task.id, nodePath: runtime.nodePath, args, cwd: workDir, agentPreset: task.agentPreset, sessionId: task.sessionId, attempt: attempts });
    bindChild(spawn(runtime.nodePath, args, {
      cwd: workDir, shell: false, windowsHide: true, detached: process.platform !== 'win32',
      env: { ...process.env, DSH_HOME: runtime.home, DSH_BATCH_DSH_BIN: runtime.dshBin, ELECTRON_RUN_AS_NODE: '1', DSH_MAX_TOKENS_AS_SUCCESS: 'false', ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    }));
  }

  async function queueBoot() {
    if (stopping || killed || task.stopRequested) {
      finishWithoutChild();
      return;
    }
    const release = await takeBootLock();
    if (stopping || killed || task.stopRequested) {
      release();
      finishWithoutChild();
      return;
    }
    releaseBoot = release;
    spawnOnce();
  }

  void queueBoot();
  return { get pid() { return child?.pid; }, done, stop: immediately => immediately ? force() : shutdown() };
}
