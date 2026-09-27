import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, dirname, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

/** `bin.js` is node_modules/@deepseek-ai/dsh/lib/bin.js → parent node_modules is three levels above `lib`. */
function resolveWorkerNode(explicit) {
  if (explicit && isAbsolute(explicit) && existsSync(explicit)) return explicit;
  const exe = String(process.execPath || '').toLowerCase();
  const isDesktop = exe.endsWith('dsh desktop.exe') || exe.includes('\\dsh desktop.exe') || exe.includes('/dsh desktop.exe');
  if (isDesktop) {
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:\\Program Files', 'D:\\Program Files'].filter(Boolean);
    for (const root of roots) {
      const candidate = join(root, 'nodejs', 'node.exe');
      if (existsSync(candidate)) return candidate;
    }
  }
  return process.execPath;
}

export function harnessNodeModules(dshBin) {
  return join(dirname(dshBin), '..', '..', '..');
}

export function locateRuntime(config = {}) {
  const candidates = [config.dshBin, process.env.DSH_BATCH_DSH_BIN];
  if (process.argv[1]?.replaceAll('\\', '/').endsWith('/lib/bin.js')) candidates.push(process.argv[1]);
  // Desktop bundles its own pinned Harness; use that runtime before a global dsh.
  if (process.resourcesPath) candidates.push(join(process.resourcesPath, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'));
  const exe = (process.execPath || '').toLowerCase();
  if (exe.endsWith('dsh desktop.exe') || exe.endsWith('deepseek.exe') || exe.includes('dsh desktop')) {
    candidates.push(join(dirname(process.execPath), 'resources', 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'));
  }
  for (const root of ['D:\\Programs\\DSH Desktop', join(process.env.LOCALAPPDATA || '', 'Programs', 'DSH Desktop'), 'C:\\Program Files\\DSH Desktop']) {
    candidates.push(join(root, 'resources', 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'));
  }
  for (const base of [import.meta.url, process.argv[1]].filter(Boolean)) {
    try { candidates.push(join(dirname(createRequire(base).resolve('@deepseek-ai/dsh/package.json')), 'lib', 'bin.js')); } catch {}
  }
  if (process.env.APPDATA) candidates.push(join(process.env.APPDATA, 'npm/node_modules/@deepseek-ai/dsh/lib/bin.js'));
  candidates.push('/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js', '/usr/lib/node_modules/@deepseek-ai/dsh/lib/bin.js');
  const dshBin = candidates.find(p => p && isAbsolute(p) && existsSync(p));
  if (!dshBin) throw new Error('未找到官方 dsh CLI。请在插件配置中设置 dshBin（@deepseek-ai/dsh/lib/bin.js 的绝对路径）');
  const manifest = JSON.parse(readFileSync(join(dirname(dshBin), '..', 'package.json'), 'utf8'));
  if (manifest.name !== '@deepseek-ai/dsh') throw new Error('dshBin 必须指向官方 @deepseek-ai/dsh 包');
  const nodePath = resolveWorkerNode(config.nodePath || process.env.DSH_BATCH_NODE);
  const home = config.dshHome || process.env.DSH_HOME || join(homedir(), '.dsh');
  return { dshBin, nodePath, home, version: manifest.version };
}

export function runCli(runtime, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(runtime.nodePath, [runtime.dshBin, ...args], {
      cwd: options.cwd || runtime.home, windowsHide: true, shell: false,
      env: { ...process.env, DSH_HOME: runtime.home, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '', stdout = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('DSH 配置初始化超时')); }, 60000);
    child.stdout.on('data', d => { stdout = (stdout + d).slice(-65536); });
    child.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });
    child.once('error', e => { clearTimeout(timeout); reject(e); });
    child.once('close', code => { clearTimeout(timeout); code === 0 ? resolve(stdout) : reject(new Error(`DSH 启动检查失败 (${code})：${stderr}`)); });
  });
}

const PROFILE_ROOT_CONFIG = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`;

export function ensureProfileRootConfig(home, profile) {
  const file = join(home, 'profiles', profile, 'cordis.yml');
  mkdirSync(dirname(file), { recursive: true });
  // A caller's profile is authoritative; create a missing entry point only.
  try { writeFileSync(file, PROFILE_ROOT_CONFIG, { flag: 'wx' }); }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
}

export async function prepareProfile(runtime, config, log) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(config.profile || '') || ['web', 'desktop', 'default', 'headless'].includes(config.profile)) {
    throw new Error('批量任务只能使用独立的 SDK Profile');
  }
  if (!isAbsolute(config.cwd) || !(await stat(config.cwd)).isDirectory()) throw new Error('工作目录必须是本机存在的绝对目录');
  const args = ['--profile', config.profile];
  const created = !existsSync(join(runtime.home, 'profiles', config.profile, 'package.json'));
  if (created) args.push('--from-default-profile', 'sdk');
  log?.info('prepareProfile', { args, cwd: config.cwd, created, dshBin: runtime.dshBin, version: runtime.version, execPath: process.execPath });
  const output = await runCli(runtime, [...args, '--dump-config'], { cwd: config.cwd });
  log?.info('dump-config ok', { hasSdk: output.includes('@deepseek-ai/dsh-sdk-jsonrpc-server'), bytes: output.length });
  if (!output.includes('@deepseek-ai/dsh-sdk-jsonrpc-server')) throw new Error('执行 Profile 未启用官方 SDK JSON-RPC 服务');
  try { ensureProfileRootConfig(runtime.home, config.profile); }
  catch (e) { log?.warn('ensure profile root after dump failed', { profile: config.profile, error: e.message }); }
}
