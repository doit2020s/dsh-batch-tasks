import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import css from './panel.css';
import { parseTasks } from './validation.js';

const labels = { pending: '待投递', starting: '启动中', running: '执行中', stopping: '正在停止', succeeded: '已完成', failed: '失败', cancelled: '已取消', killed: '已强制中断', interrupted: '服务中断', unconfirmed: '终止未确认' };
const modeLabels = { idle: '准备就绪', running: '调度进行中', paused: '暂停投递', stopped: '已停止投递', finished: '本批次已结束' };
const busyStatuses = ['starting', 'running', 'stopping', 'unconfirmed'];

export function Panel({ call, onClose, onOpenSession, initialCwd = '' }) {
  const [state, setState] = useState(null), [text, setText] = useState(''), [filter, setFilter] = useState('all');
  const [form, setForm] = useState({ concurrency: 3, timeoutMinutes: 30, cwd: '', provider: '', model: '', agentPreset: '', profile: 'batch-sdk' });
  const [defaults, setDefaults] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [startingBatch, setStartingBatch] = useState(false), [stopBusy, setStopBusy] = useState(false), [openingSession, setOpeningSession] = useState(false);
  const [dismissedStateError, setDismissedStateError] = useState(null);
  const [selected, setSelected] = useState(null), [confirmation, setConfirmation] = useState(null), [copiedPath, setCopiedPath] = useState('');
  const mounted = useRef(true), fileRef = useRef();
  const rootRef = useRef();
  useEffect(() => {
    mounted.current = true;
    let timer, controller = new AbortController();
    void call('defaults', {}, controller.signal).then(v => {
      if (!mounted.current) return;
      const defaultPreset = Array.isArray(v.presets) && v.presets.some(p => p.id === v.defaultAgentPreset && !p.broken) ? v.defaultAgentPreset : '';
      setDefaults(v);
      setForm(f => ({ ...f, cwd: initialCwd, provider: v.provider ?? f.provider, model: v.model ?? f.model, profile: v.profile ?? f.profile, agentPreset: defaultPreset }));
    }).catch(e => { if (mounted.current) setError(e.message); });
    async function poll() {
      try { const value = await call('snapshot', {}, controller.signal); if (mounted.current) setState(value); }
      catch (e) { if (mounted.current) setError(e.message); }
      if (mounted.current) timer = setTimeout(poll, 1200);
    }
    void poll();
    return () => { mounted.current = false; clearTimeout(timer); controller.abort(); };
  }, [call]);
  useEffect(() => { if (onClose) rootRef.current?.focus(); }, [onClose]);
  function handleDialogKeyDown(event) {
    if (!onClose) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (confirmation) setConfirmation(null);
      else onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusRoot = confirmation ? rootRef.current.querySelector('.dbt-confirm') : rootRef.current;
    const focusable = [...focusRoot.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')]
      .filter(el => el.getClientRects().length && !el.closest('[hidden]'));
    if (!focusable.length) { event.preventDefault(); rootRef.current.focus(); return; }
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === rootRef.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  async function action(method, payload = {}) {
    const isStop = /^(stop|force)/.test(method);
    const setLock = isStop ? setStopBusy : setBusy;
    if (method === 'start') setStartingBatch(true);
    setLock(true); setError('');
    try {
      const s = await call(method, payload);
      if (mounted.current) {
        setState(s);
        if (method === 'clear') { setSelected(null); setFilter('all'); setDismissedStateError(null); }
      }
    }
    catch (e) { if (mounted.current) setError(e.message); }
    finally { if (mounted.current) { setLock(false); if (method === 'start') setStartingBatch(false); } }
  }
  function confirmStopAll() {
    setConfirmation({ method: 'stopAll', title: '停止本批次任务？', text: '立即停止投递并取消待投递任务，同时请求关闭本批次正在执行的会话。10 秒内无法正常退出的任务将自动强制中断。已生成文件和会话记录保留。' });
  }
  function confirmClear() {
    setConfirmation({ method: 'clear', title: '清空所有投递记录？', text: `将从插件面板和持久化队列中删除本批次的全部 ${tasks.length} 条投递记录，此操作无法在插件中撤销。已创建的 DSH 会话、任务工作目录及文件都会保留。`, confirmLabel: '确认清空' });
  }
  function download() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${state?.id || 'batch'}-results.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function readFile(event) {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      if (file.size > 16_000_000) throw new Error('文件不能超过 16MB');
      const value = await file.text(); parseTasks(value); setText(value); setError('');
    } catch (e) { setError(e.message); }
    event.target.value = '';
  }
  async function copyTaskDirectory(path) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('此环境不支持一键复制');
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
    } catch (e) { setError(`${e.message}，请在详情中手动复制路径。`); }
  }
  async function openSession(id) {
    if (!onOpenSession) return;
    setOpeningSession(true); setError('');
    try { await onOpenSession(id); onClose?.(); }
    catch (e) { setError(`无法打开会话：${e.message}`); }
    finally { if (mounted.current) setOpeningSession(false); }
  }
  let totalInput = 0;
  try { totalInput = parseTasks(text).length; } catch {}
  const tasks = state?.tasks ?? [], counts = state?.counts ?? {};
  const canStart = !!state && !tasks.some(t => !['succeeded', 'failed', 'cancelled', 'killed', 'interrupted'].includes(t.status));
  const canStop = startingBatch || state?.mode === 'running' || state?.mode === 'paused' || Number(state?.liveCount) > 0 || Number(counts.pending) > 0;
  const canClear = tasks.length > 0 && !['running', 'paused'].includes(state?.mode) && Number(state?.liveCount) === 0 && Number(counts.pending || 0) === 0 && tasks.every(t => ['succeeded', 'failed', 'cancelled', 'killed', 'interrupted'].includes(t.status));
  const visibleError = error || (state?.error !== dismissedStateError ? state?.error : '') || '';
  const shown = tasks.filter(t => filter === 'all' || (filter === 'active' ? busyStatuses.includes(t.status) : filter === 'failed' ? ['failed', 'killed', 'interrupted'].includes(t.status) : t.status === filter));
  const detail = tasks.find(t => t.id === selected);
  const detailWorkDir = detail?.workDir || state?.config?.cwd || '';
  const presets = Array.isArray(defaults?.presets) ? defaults.presets : [];
  const selectedPreset = presets.find(p => p.id === form.agentPreset && !p.broken);
  const brokenPresets = presets.filter(p => p.broken);
  const detailAgentPreset = detail?.agentPreset || state?.config?.agentPreset || '';
  const presetLabel = id => {
    const preset = presets.find(p => p.id === id);
    return preset?.name && preset.name !== id ? `${preset.name} (${id})` : id;
  };
  const finished = tasks.filter(t => ['succeeded', 'failed', 'cancelled', 'killed', 'interrupted'].includes(t.status)).length;
  const field = (name, value) => setForm(f => ({ ...f, [name]: value }));
  return <div className="dbt" ref={rootRef} tabIndex={-1} role={onClose ? 'dialog' : undefined} aria-modal={onClose ? 'true' : undefined} aria-label="批量任务面板" onKeyDown={handleDialogKeyDown}>
    <style>{css}</style>
    <header className="dbt-header"><div><div className="dbt-eyebrow">HARNESS · BATCH TASKS</div><h1>批量任务工作台</h1><p>一行一个任务，独立会话执行，空闲名额自动补位。</p></div><div className="dbt-header-right"><span className={`dbt-live ${state?.mode === 'running' ? 'on' : ''}`}>{modeLabels[state?.mode] || '连接中'}</span>{onClose && <button type="button" className="dbt-close" onClick={event => { event.preventDefault(); event.stopPropagation(); onClose(); }} aria-label="关闭批量任务面板">关闭面板 <span aria-hidden="true">×</span></button>}</div></header>
    {visibleError && <div className="dbt-error dbt-error-banner" role="alert"><button type="button" onClick={() => { setError(''); setDismissedStateError(state?.error ?? null); }} aria-label="收起错误">×</button><div className="dbt-error-message">{visibleError.length > 180 ? `${visibleError.slice(0, 180)}…` : visibleError}</div>{visibleError.length > 180 && <details><summary>查看完整错误</summary><pre>{visibleError}</pre></details>}</div>}
    <div className="dbt-stats">{[['任务总数', tasks.length], ['正在执行', state?.liveCount || 0], ['等待投递', counts.pending || 0], ['正常完成', counts.succeeded || 0], ['异常 / 中断', (counts.failed || 0) + (counts.killed || 0) + (counts.interrupted || 0)]].map(([name, n]) => <div key={name}><span>{name}</span><strong>{n.toString().padStart(2, '0')}</strong></div>)}</div>
    <div className="dbt-columns"><section className="dbt-card dbt-compose"><div className="dbt-card-title"><h2>任务输入</h2><button onClick={() => fileRef.current?.click()} disabled={!canStart}>导入 TXT</button><input ref={fileRef} type="file" accept=".txt,text/plain" onChange={readFile} hidden /></div>
      <label htmlFor="dbt-tasks">每行一条 · 忽略空行 · 保留重复任务</label>
      <textarea id="dbt-tasks" disabled={!canStart} value={text} onChange={e => setText(e.target.value)} placeholder={'为产品 A 编写一份介绍，保存为 result.md\n为产品 B 编写一份介绍，保存为 result.md\n为产品 C 编写一份介绍，保存为 result.md'} />
      <div className="dbt-input-count">已识别 <b>{totalInput}</b> 条任务<span>UTF-8 文本</span></div>
      <div className="dbt-form-row"><label>并发会话数<input type="number" min="1" max="16" value={form.concurrency} onChange={e => field('concurrency', Number(e.target.value))} /></label><label>单任务超时（分钟）<input type="number" disabled={!canStart} min="1" max="1440" value={form.timeoutMinutes} onChange={e => field('timeoutMinutes', Number(e.target.value))} /></label></div>
      {!canStart && <button disabled={busy} onClick={() => action('concurrency', { value: form.concurrency })}>调整当前并发上限</button>}
      <label>批次工作根目录（绝对路径）<input disabled={!canStart} value={form.cwd} onChange={e => field('cwd', e.target.value)} placeholder="例如 D:\\tasks；每条任务在其中建立专属子目录" /></label>
      <p className="dbt-hint">{initialCwd && form.cwd === initialCwd ? '已带入当前会话的目录，可以自行修改。每行任务会在该目录下建立独立子目录。' : form.cwd.trim() ? '每行任务会在此根目录下建立独立子目录，相对路径生成的文件保存在各自目录中。' : '请填写工作根目录；每行任务会在其中建立独立子目录。'}</p>
      <label htmlFor="dbt-agent-preset">执行 Agent 预设
        <select id="dbt-agent-preset" disabled={!canStart || !presets.length} value={form.agentPreset} onChange={e => field('agentPreset', e.target.value)}>
          <option value="">请选择 Agent 预设</option>
          {presets.map(p => <option key={p.id} value={p.id} disabled={!!p.broken}>{presetLabel(p.id)}{p.isDefault ? ' · 当前默认' : ''}{p.broken ? ' · 不可用' : ''}</option>)}
        </select>
      </label>
      <p className="dbt-hint">{selectedPreset ? `${selectedPreset.description || '使用此预设的实际 Agent 配置。'} 预设会决定会话的工具和提示词。` : presets.length ? '请选择可用的 Agent 预设；未指定时不会投递任务。预设会决定会话的工具和提示词。' : '正在读取 DSH 的 Agent 预设；读取失败时不会投递任务。'}</p>
      {brokenPresets.length > 0 && <div className="dbt-preset-unavailable">不可用的预设：{brokenPresets.map(p => <div key={p.id}>{p.id}：{p.broken}</div>)}</div>}
      <div className="dbt-form-row"><label>模型提供方<input disabled={!canStart} value={form.provider} onChange={e => field('provider', e.target.value)} /></label><label>模型名称<input disabled={!canStart} value={form.model} onChange={e => field('model', e.target.value)} /></label></div>
      <details><summary>执行配置说明</summary><label>独立 SDK Profile<input disabled={!canStart} value={form.profile} onChange={e => field('profile', e.target.value)} /></label><p>首次运行会从官方 SDK 模板创建此配置。它共用 DSH 凭据和设置；工具插件需安装到此 Profile。需要交互确认的任务可能等待至超时。当前运行时：{defaults?.harnessVersion || '读取中'}。</p></details>
      <div className={`dbt-submit-actions${canStop ? ' can-stop' : ''}`}>
        <button className="dbt-primary" disabled={busy || !canStart || !totalInput || !form.cwd.trim() || !selectedPreset} onClick={() => action('start', { ...form, text })}>{busy ? '正在处理…' : `开始执行${totalInput ? ` ${totalInput} 条任务` : ''}`}</button>
        {canStop && <button type="button" className="dbt-danger dbt-stop-dispatch" disabled={stopBusy} onClick={confirmStopAll}>{stopBusy ? '正在停止…' : '停止投递并关闭会话'}</button>}
      </div>
      <p className="dbt-hint">每条任务有独立会话和工作子目录，可以使用相同的相对文件名。关闭面板不会停止任务。</p>
    </section><section className="dbt-card dbt-queue"><div className="dbt-card-title"><h2>执行队列 <small>{finished} / {tasks.length}</small></h2><div className="dbt-queue-actions"><button disabled={!tasks.length} onClick={download}>导出结果</button><button type="button" className="dbt-danger dbt-clear-list" disabled={busy || startingBatch || stopBusy || !canClear} onClick={confirmClear}>清空列表</button></div></div>
      {state?.config?.cwd && <p className="dbt-batch-root">本批次根目录：<code>{state.config.cwd}</code></p>}
      {state?.id && <p className="dbt-batch-preset">本批次 Agent 预设：<code>{state?.config?.agentPreset ? presetLabel(state.config.agentPreset) : '未指定（旧批次）'}</code></p>}
      {state?.mode === 'paused' && !state?.config?.agentPreset && <p className="dbt-hint">旧批次没有绑定 Agent 预设。请停止剩余任务，再选择预设创建新批次。</p>}
      <div className="dbt-progress" role="progressbar" aria-label="任务进度" aria-valuenow={finished} aria-valuemin={0} aria-valuemax={tasks.length || 1}><div style={{ width: `${tasks.length ? finished / tasks.length * 100 : 0}%` }} /></div>
      <div className="dbt-toolbar"><div>{state?.mode === 'paused' ? <button disabled={busy || !state?.config?.agentPreset} onClick={() => action('resume')}>继续投递</button> : <button disabled={busy || state?.mode !== 'running'} onClick={() => action('pause')}>暂停投递</button>}<button disabled={stopBusy || !canStop} onClick={confirmStopAll}>停止全部</button></div><button className="dbt-danger" disabled={stopBusy || !state?.liveCount} onClick={() => setConfirmation({ method: 'forceAll', title: '立即强制中断全部？', text: '立即结束本批次的任务进程及其普通子进程；未落盘输出可能不完整。不会结束其他 DSH 会话。' })}>强制中断全部</button></div>
      {tasks.length > 0 && !canClear && <p className="dbt-clear-hint">清空列表前，请先停止投递并等待正在执行的会话结束。</p>}
      <div className="dbt-filters">{[['all', '全部'], ['active', '运行中'], ['pending', '待投递'], ['succeeded', '已完成'], ['failed', '异常']].map(([key, label]) => <button key={key} className={filter === key ? 'selected' : ''} onClick={() => setFilter(key)}>{label}</button>)}</div>
      <div className="dbt-list">{shown.length ? shown.map(t => <div key={t.id} className={`dbt-task ${selected === t.id ? 'chosen' : ''}`}><button className="dbt-task-main" onClick={() => setSelected(selected === t.id ? null : t.id)}><span className="dbt-line">{String(t.line).padStart(3, '0')}</span><span className="dbt-task-text">{t.prompt}<small className={t.error ? 'dbt-task-error' : undefined}>{t.error || t.activity || (t.status === 'pending' ? '等待空闲会话' : t.sessionId)}</small>{(t.workDir || state?.config?.cwd) && <small className="dbt-task-directory" title={t.workDir || state.config.cwd}>{t.workDir ? '任务目录' : '旧批次目录'}：{t.workDir || state.config.cwd}</small>}</span><span className={`dbt-badge ${t.status}`}>{labels[t.status]}</span></button>{busyStatuses.includes(t.status) && <button className="dbt-stop-one" aria-label={`停止第 ${t.line} 行`} disabled={stopBusy} onClick={() => action('stopOne', { id: t.id })}>停止</button>}</div>) : <div className="dbt-empty"><div>☷</div><h3>{tasks.length ? '此分类没有任务' : '队列准备就绪'}</h3><p>{tasks.length ? '可切换其他分类查看。' : '导入文本或粘贴任务，设置并发数量后开始。'}</p></div>}</div>
      {detail && <aside className="dbt-detail"><div className="dbt-card-title"><h3>第 {detail.line} 行 · {labels[detail.status]}</h3><button onClick={() => setSelected(null)}>收起</button></div><div className="dbt-session-id">会话 ID：<code>{detail.sessionId}</code>{onOpenSession && ['succeeded', 'failed'].includes(detail.status) && <button type="button" disabled={openingSession} onClick={() => void openSession(detail.sessionId)}>{openingSession ? '打开中…' : '打开会话'}</button>}</div><div className="dbt-agent-detail">Agent 预设：<code>{detailAgentPreset ? presetLabel(detailAgentPreset) : '未指定（旧批次）'}</code></div>{detailWorkDir && <div className="dbt-directory-detail"><span>{detail.workDir ? '任务工作目录' : '旧批次共用工作目录'}</span><code title={detailWorkDir}>{detailWorkDir}</code><button type="button" onClick={() => void copyTaskDirectory(detailWorkDir)}>{copiedPath === detailWorkDir ? '已复制' : '复制路径'}</button></div>}<p>{detail.prompt}</p>{detail.error && <p className="dbt-error">{detail.error}</p>}<pre>{detail.result || '尚无文本结果。会话完整记录由 DSH 保存。'}</pre>{busyStatuses.includes(detail.status) && <button className="dbt-danger" onClick={() => setConfirmation({ method: 'forceOne', payload: { id: detail.id }, title: '强制中断这条任务？', text: '仅结束该任务的执行进程，保留已有记录。' })}>强制中断此任务</button>}</aside>}
    </section></div>
    <footer>完成状态表示 DSH 正常结束本轮；任务内容是否达标请查看结果。关闭会话保留日志，不撤销已经完成的文件操作。</footer>
    {confirmation && <div className="dbt-confirm-backdrop"><div className="dbt-confirm" role="alertdialog" aria-modal="true" aria-label={confirmation.title}><h2>{confirmation.title}</h2><p>{confirmation.text}</p><div><button autoFocus onClick={() => setConfirmation(null)}>返回</button><button className="dbt-danger" onClick={() => { const c = confirmation; setConfirmation(null); void action(c.method, c.payload); }}>{confirmation.confirmLabel || '确认中断'}</button></div></div></div>}
  </div>;
}

export const inject = ['slots', 'connection', 'sessions'];
export function apply(ctx) {
  let openPanels = 0;
  let latestSnapshot = null;
  let lastSessionRefreshAt = 0;
  let lastSessionRefreshSignature = '';
  let sessionRefreshInFlight = false;
  let deferredRefreshTimer = null;
  let backgroundTimer = null;
  let backgroundPollInFlight = false;
  function sessionSignature(snapshot) {
    if (!Array.isArray(snapshot?.tasks)) return '';
    return snapshot.tasks
      .filter(task => task.sessionId && ['running', 'stopping', 'succeeded', 'failed', 'cancelled', 'killed', 'interrupted', 'unconfirmed'].includes(task.status))
      .map(task => `${task.sessionId}:${task.status}`).join('|');
  }
  async function refreshSessionListWhenChanged() {
    if (sessionRefreshInFlight) return;
    const signature = sessionSignature(latestSnapshot);
    if (!signature || signature === lastSessionRefreshSignature) return;
    const remaining = 3000 - (Date.now() - lastSessionRefreshAt);
    if (remaining > 0) {
      if (!deferredRefreshTimer) deferredRefreshTimer = setTimeout(() => { deferredRefreshTimer = null; void refreshSessionListWhenChanged(); }, remaining);
      return;
    }
    lastSessionRefreshAt = Date.now();
    lastSessionRefreshSignature = signature;
    sessionRefreshInFlight = true;
    try { await ctx.sessions.refresh(); }
    catch { lastSessionRefreshSignature = ''; }
    finally { sessionRefreshInFlight = false; }
    if (sessionSignature(latestSnapshot) !== lastSessionRefreshSignature) void refreshSessionListWhenChanged();
  }
  function noteSnapshot(snapshot) {
    latestSnapshot = snapshot;
    void refreshSessionListWhenChanged();
    const active = snapshot?.mode === 'running' || Number(snapshot?.liveCount) > 0;
    if (active && !backgroundTimer) {
      backgroundTimer = setInterval(async () => {
        if (openPanels || backgroundPollInFlight) return;
        backgroundPollInFlight = true;
        try { await call('snapshot'); } catch {}
        finally { backgroundPollInFlight = false; }
      }, 3000);
    } else if (!active && backgroundTimer) {
      clearInterval(backgroundTimer);
      backgroundTimer = null;
    }
  }
  const call = async (endpoint, payload = {}, signal) => {
    const reply = await ctx.connection.rpc.call('/api', `batch-tasks/${endpoint}`, payload, signal);
    if (!reply.ok) throw new Error(reply.error?.message || '请求失败');
    if (reply.value && Array.isArray(reply.value.tasks)) noteSnapshot(reply.value);
    return reply.value;
  };
  function currentCwd() {
    const list = ctx.sessions.list.getSnapshot();
    const cwd = list?.current == null ? undefined : list.byId?.[list.current]?.cwd;
    return typeof cwd === 'string' ? cwd : '';
  }
  function Overlay({ onClose, fromSession = false }) {
    const [initialCwd] = useState(() => fromSession ? currentCwd() : '');
    useEffect(() => {
      openPanels++;
      return () => {
        openPanels = Math.max(0, openPanels - 1);
        queueMicrotask(() => { if (!openPanels) void refreshSessionListWhenChanged(); });
      };
    }, []);
    return <div className="dbt-overlay" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()}><style>{css}</style><Panel call={call} initialCwd={initialCwd} onClose={onClose} onOpenSession={async id => { await ctx.sessions.refresh(); ctx.sessions.open(id); }} /></div>;
  }
  function SettingsPanel() {
    const [open, setOpen] = useState(false);
    return <><div style={{ padding: 20, lineHeight: 1.8 }}><h2>批量任务</h2><p>导入每行一条的任务文本，选择执行 Agent 预设、并发会话数量和工作根目录。每条任务使用独立会话及工作子目录，自动补位并统一管理执行进程。</p><button type="button" onClick={() => setOpen(true)} style={{ marginTop: 18, padding: '10px 18px', borderRadius: 8, background: '#79dfbe', color: '#142e26' }}>打开批量任务工作台</button></div>{open && createPortal(<Overlay onClose={() => setOpen(false)} />, document.body)}</>;
  }
  function HeaderAction() {
    const [open, setOpen] = useState(false);
    return <><button type="button" title="打开批量任务工作台" onClick={() => setOpen(true)} style={{ padding: '4px 10px', fontSize: 12, border: '1px solid currentColor', borderRadius: 6 }}>批量任务</button>{open && createPortal(<Overlay fromSession onClose={() => setOpen(false)} />, document.body)}</>;
  }
  ctx.effect(() => () => { clearInterval(backgroundTimer); clearTimeout(deferredRefreshTimer); }, 'batch-tasks: session list refresh');
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'batch-tasks', order: 70, label: () => '批量任务' }, SettingsPanel));
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({ name: 'conversation.session.header.actions', id: 'batch-tasks', order: 35 }, HeaderAction));
}
