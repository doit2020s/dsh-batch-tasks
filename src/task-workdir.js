import { isAbsolute, posix, win32 } from 'node:path';
import { randomUUID } from 'node:crypto';

const FILE_TOOLS = new Set(['read', 'write', 'edit', 'read_image']);
const SEARCH_TOOLS = new Set(['glob', 'grep']);

export function absoluteTaskPath(value) {
  return typeof value === 'string' && (/^[a-z]:[\\/]/i.test(value)
    || /^\\\\[^\\/]+[\\/][^\\/]+/.test(value)
    || (isAbsolute(value) && !value.startsWith('\\')));
}

function pathInTask(directory, relative = '') {
  const pathApi = /^[a-z]:[\\/]/i.test(directory) || directory.startsWith('\\\\') ? win32 : posix;
  return pathApi.resolve(directory, relative);
}

export function quotePwshPath(path) {
  return `'${path.replaceAll("'", "''")}'`;
}

export function quoteBashPath(path) {
  return `'${path.replaceAll("'", "'\\''")}'`;
}

function explicitPwshDirectory(command) {
  const match = /^\s*Set-Location\s+-LiteralPath\s+'((?:[^']|'')*)'(?:\s+-ErrorAction\s+Stop)?\s*(?:;|\r?\n)/i.exec(command);
  return match && absoluteTaskPath(match[1].replaceAll("''", "'"));
}

function explicitBashDirectory(command) {
  const match = /^\s*cd\s+(?:--\s+)?('(?:[^']|'\\'')*'|"[^"$`]*"|[^\s;&|]+)\s*&&/i.exec(command);
  if (!match) return false;
  const quoted = match[1];
  const directory = quoted.startsWith("'") ? quoted.slice(1, -1).replaceAll("'\\''", "'")
    : quoted.startsWith('"') ? quoted.slice(1, -1) : quoted;
  return absoluteTaskPath(directory);
}

/** Return a monotonic denial; never rewrite call arguments, identity, or policy. */
export function taskWorkDirReason(exec, directory, definition) {
  if (!exec.agent || !exec.arguments || typeof exec.arguments !== 'object' || Array.isArray(exec.arguments)) return;
  const args = exec.arguments;
  if (FILE_TOOLS.has(exec.name) && typeof args.file_path === 'string' && !absoluteTaskPath(args.file_path)) {
    return `Batch task files use ${directory}. Retry ${exec.name} with absolute file_path ${JSON.stringify(pathInTask(directory, args.file_path))}.`;
  }
  if (SEARCH_TOOLS.has(exec.name) && (args.path === undefined || typeof args.path === 'string' && !absoluteTaskPath(args.path))) {
    return `Batch task files use ${directory}. Retry ${exec.name} with absolute path ${JSON.stringify(pathInTask(directory, args.path ?? ''))}.`;
  }
  if (!['pwsh', 'bash'].includes(exec.name) || typeof args.command !== 'string') return;
  const supportsWorkdir = Object.hasOwn(definition?.parameters?.properties ?? {}, 'workdir');
  if (supportsWorkdir) {
    if (typeof args.workdir === 'string' && absoluteTaskPath(args.workdir)) return;
    return `Batch task commands use ${directory}. Retry ${exec.name} with absolute workdir ${JSON.stringify(pathInTask(directory, typeof args.workdir === 'string' ? args.workdir : ''))}; keep the command and all other arguments unchanged.`;
  }
  if (exec.name === 'pwsh' && !explicitPwshDirectory(args.command)) {
    return `Batch task commands use ${directory}. Retry pwsh with the command beginning: Set-Location -LiteralPath ${quotePwshPath(directory)} -ErrorAction Stop; followed by your original command. This preserves the persistent shell's variables and functions.`;
  }
  if (exec.name === 'bash' && !explicitBashDirectory(args.command)) {
    return `Batch task commands use ${directory}. Retry bash with the command beginning: cd -- ${quoteBashPath(directory)} && followed by your original command.`;
  }
}

/** Bind only to this isolated SDK worker, including its delegated agents. */
export function bindTaskWorkDir(ctx, directory) {
  if (!absoluteTaskPath(directory) || /[\r\n\0]/.test(directory)) throw new TypeError('taskWorkDir must be an absolute directory without line breaks');
  if (typeof ctx.tools?.guard !== 'function' || typeof ctx.tools?.get !== 'function'
    || typeof ctx.systemPrompt?.context !== 'function' || typeof ctx.on !== 'function') {
    throw new Error('Harness cannot provide the official task-directory prompt and monotonic tool guard; no task was delivered');
  }
  const text = [
    `Batch task execution directory: ${directory}`,
    'The session workspace is the batch root for Desktop grouping. Store all files for this task in the execution directory above. This is an execution default, not a sandbox or a grant of additional permissions. Existing Agent and tool policies remain in force.',
    'For read, write, edit, read_image, glob, and grep, supply an absolute file_path or path under the task directory instead of omitting it or using a relative path.',
    'For pwsh/bash tools exposing workdir, supply the absolute task execution directory as workdir.',
    `For persistent pwsh, begin each command with Set-Location -LiteralPath ${quotePwshPath(directory)} -ErrorAction Stop; then run the original command in the same persistent shell.`,
    `For bash without workdir, begin each command with cd -- ${quoteBashPath(directory)} && then run the original command.`,
    'Delegated agents use the same task execution directory. Preserve the task content and existing preset instructions.',
  ].join('\n');
  const removePrompt = ctx.systemPrompt.context({ name: 'batch:task-workdir', order: 125, text });
  let removeGuard;
  let removeNotice;
  try {
    removeGuard = ctx.tools.guard(exec => taskWorkDirReason(exec, directory, ctx.tools.get(exec.name, exec.agent)));
    const admitted = new WeakSet();
    // Minimal deliberately suppresses runtime-context snapshots. The public
    // pre-step extension admits a separate plugin notice without touching its
    // complete persona or replacing the user's original task message.
    removeNotice = ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
      const decision = await next();
      if (decision.kind === 'reject' || signal.aborted || admitted.has(agent) || !decision.messages.length) return decision;
      const alreadyPresent = decision.messages.some(message => message.content?.some(block => block.type === 'text' && block.text.includes(`Batch task execution directory: ${directory}`)));
      admitted.add(agent);
      if (alreadyPresent) return decision;
      const notice = Object.freeze({
        id: randomUUID(),
        role: 'user',
        content: Object.freeze([Object.freeze({ type: 'text', text })]),
        source: Object.freeze({ kind: 'plugin', plugin: 'batch-tasks' }),
      });
      return { ...decision, messages: [...decision.messages, notice] };
    });
  } catch (error) {
    removeGuard?.();
    removePrompt?.();
    throw error;
  }
  return () => {
    removeNotice?.();
    removeGuard?.();
    removePrompt?.();
  };
}
