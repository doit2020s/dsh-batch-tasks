export const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'killed', 'interrupted']);
export const ACTIVE = new Set(['starting', 'running', 'stopping', 'unconfirmed']);
export const LIMITS = { tasks: 10000, concurrency: 16, lineChars: 64000, inputChars: 4_000_000, affixChars: 32000 };

export function parseTasks(text) {
  if (typeof text !== 'string' || text.length > LIMITS.inputChars) throw new Error('任务文本为空或超过 400 万字符');
  const rows = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/).map((prompt, i) => ({ prompt: prompt.trim(), line: i + 1 })).filter(x => x.prompt);
  if (!rows.length || rows.length > LIMITS.tasks) throw new Error('请输入 1～10000 条非空任务');
  if (rows.some(x => x.prompt.length > LIMITS.lineChars)) throw new Error('单条任务不能超过 64000 字符');
  return rows;
}

export function normalizeAffix(value, name) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') throw new Error(`${name}必须是文本`);
  if (value.includes('\0')) throw new Error(`${name}包含无效字符`);
  if (value.length > LIMITS.affixChars) throw new Error(`${name}不能超过 ${LIMITS.affixChars} 字符`);
  return value;
}

export function composePrompt(prefix, body, suffix) {
  return `${prefix ?? ''}${body}${suffix ?? ''}`;
}

export function taskFolderName(source, line) {
  const raw = String(source || '').trim() || `task-${String(line).padStart(5, '0')}`;
  const slug = raw.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[.\s]+$/g, '').slice(0, 80);
  return slug || `task-${String(line).padStart(5, '0')}`;
}

export function sessionTitleOf(source, prompt) {
  const raw = String(source || '').trim() || String(prompt || '').trim();
  return raw.replace(/\s+/g, ' ').slice(0, 80) || '批量任务';
}

export function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name}应为 ${min}～${max} 的整数`);
  return value;
}

export function validateInput(input) {
  if (!input || typeof input !== 'object') throw new Error('参数格式错误');
  const rows = parseTasks(input.text);
  const concurrency = integer(input.concurrency, 1, LIMITS.concurrency, '并发会话数');
  const timeoutMinutes = integer(input.timeoutMinutes ?? 180, 1, 1440, '任务超时（分钟）');
  for (const field of ['cwd', 'provider', 'model']) {
    if (typeof input[field] !== 'string' || !input[field].trim() || input[field].length > 4096 || input[field].includes('\0')) throw new Error(`${field} 不能为空或包含无效字符`);
  }
  const profile = input.profile ?? 'batch-sdk';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(profile) || ['web', 'desktop', 'default', 'headless'].includes(profile)) throw new Error('执行配置必须为独立的 SDK Profile，例如 batch-sdk');
  if (typeof input.agentPreset !== 'string' || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(input.agentPreset)) throw new Error('必须选择有效的 Agent 预设');
  const serialDispatch = input.serialDispatch !== false;
  const taskPrefix = normalizeAffix(input.taskPrefix ?? input.prefix, '前缀');
  const taskSuffix = normalizeAffix(input.taskSuffix ?? input.suffix, '后缀');
  const composed = rows.map(r => {
    const prompt = composePrompt(taskPrefix, r.prompt, taskSuffix);
    if (prompt.length > LIMITS.lineChars) throw new Error('拼接前缀和后缀后，单条任务不能超过 64000 字符');
    return { ...r, source: r.prompt, prompt };
  });
  return { rows: composed, concurrency, timeoutMinutes, cwd: input.cwd.trim(), provider: input.provider.trim(), model: input.model.trim(), profile, agentPreset: input.agentPreset, serialDispatch, taskPrefix, taskSuffix };
}
