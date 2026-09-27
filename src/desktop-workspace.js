import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

/** Official Desktop launcher flag. Must stay attached with `=` so a path with spaces survives Chromium's second-instance rebuild. */
export const DESKTOP_WORKSPACE_ARGUMENT = '--dsh-desktop-workspace';

const OPEN_DEDUP_MS = 8000;
let lastOpen = { path: '', at: 0 };

export function resetDesktopWorkspaceGate() {
  lastOpen = { path: '', at: 0 };
}

/** One argv element: `--dsh-desktop-workspace=<abs>`. */
export function desktopWorkspaceArg(path) {
  if (typeof path !== 'string' || !path || !isAbsolute(path)) throw new Error('工作区路径必须是本机绝对目录');
  return `${DESKTOP_WORKSPACE_ARGUMENT}=${path}`;
}

function quoteWin(value) {
  return `"${String(value).replaceAll('"', '')}"`;
}

/** Independent GUI launch so Desktop is not a child of the batch Node process. */
export function desktopLaunchCommand(exe, arg) {
  if (process.platform === 'win32') {
    return {
      file: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/c', `start "" ${quoteWin(exe)} ${quoteWin(arg)}`],
      options: { detached: true, stdio: 'ignore', windowsHide: true, shell: false },
    };
  }
  return {
    file: exe,
    args: [arg],
    options: { detached: true, stdio: 'ignore', windowsHide: false, shell: false },
  };
}

/**
 * `bin.js` lives at resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js.
 * Seven parents from that file is the Desktop install folder.
 */
export function locateDesktopExe(runtime = {}) {
  const names = ['DSH Desktop.exe', 'DeepSeek.exe'];
  const dirs = [];
  if (runtime.desktopExe && existsSync(runtime.desktopExe)) return runtime.desktopExe;
  if (runtime.dshBin) dirs.push(join(runtime.dshBin, '..', '..', '..', '..', '..', '..', '..'));
  dirs.push(
    'D:\\Programs\\DSH Desktop',
    join(process.env.LOCALAPPDATA || '', 'Programs', 'DSH Desktop'),
    'C:\\Program Files\\DSH Desktop',
    dirname(process.execPath || ''),
  );
  for (const dir of dirs) {
    if (!dir) continue;
    for (const name of names) {
      const exe = join(dir, name);
      if (existsSync(exe)) return exe;
    }
  }
  return '';
}

/**
 * Ask a running (or just-starting) DSH Desktop to register and select this folder.
 * Second instance forwards to `workspace/create` + `openWorkspace`.
 */
export function openDesktopWorkspace(runtime, path, log, spawnFn = spawn) {
  if (!path) return false;
  let canonical;
  try { canonical = realpathSync(path); }
  catch { log?.warn('desktop workspace path missing', { path }); return false; }
  const now = Date.now();
  if (lastOpen.path === canonical && now - lastOpen.at < OPEN_DEDUP_MS) return true;
  const exe = locateDesktopExe(runtime);
  if (!exe) {
    log?.warn('desktop exe missing', { dshBin: runtime?.dshBin });
    return false;
  }
  const arg = desktopWorkspaceArg(canonical);
  const launch = desktopLaunchCommand(exe, arg);
  try {
    const child = spawnFn(launch.file, launch.args, launch.options);
    child.unref?.();
    lastOpen = { path: canonical, at: now };
    log?.info('desktop workspace open', { exe, arg, file: launch.file });
    return true;
  } catch (e) {
    log?.warn('desktop workspace open failed', { exe, arg, message: e.message });
    return false;
  }
}

// Live session registration uses the authenticated Host bridge.
// Opening a workspace never restarts Desktop or terminates its processes.
