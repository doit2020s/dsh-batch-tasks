import { existsSync, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, dirname, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

export function locateRuntime(config = {}) {
  const candidates = [config.dshBin, process.env.DSH_BATCH_DSH_BIN];
  if (process.argv[1]?.replaceAll('\\', '/').endsWith('/lib/bin.js')) candidates.push(process.argv[1]);
  // Desktop bundles its own pinned Harness; use that runtime before a global dsh.
  if (process.resourcesPath) candidates.push(join(process.resourcesPath, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'));
  if (process.execPath.toLowerCase().endsWith('dsh desktop.exe')) candidates.push(join(dirname(process.execPath), 'resources', 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'));
  for (const base of [import.meta.url, process.argv[1]].filter(Boolean)) {
    try { candidates.push(join(dirname(createRequire(base).resolve('@deepseek-ai/dsh/package.json')), 'lib', 'bin.js')); } catch {}
  }
  if (process.env.APPDATA) candidates.push(join(process.env.APPDATA, 'npm/node_modules/@deepseek-ai/dsh/lib/bin.js'));
  candidates.push('/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js', '/usr/lib/node_modules/@deepseek-ai/dsh/lib/bin.js');
  const dshBin = candidates.find(p => p && isAbsolute(p) && existsSync(p));
  if (!dshBin) throw new Error('未找到官方 dsh CLI。请在插件配置中设置 dshBin（@deepseek-ai/dsh/lib/bin.js 的绝对路径）');
  const manifest = JSON.parse(readFileSync(join(dirname(dshBin), '..', 'package.json'), 'utf8'));
  if (manifest.name !== '@deepseek-ai/dsh') throw new Error('dshBin 必须指向官方 @deepseek-ai/dsh 包');
  const nodePath = config.nodePath || process.env.DSH_BATCH_NODE || process.execPath;
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

export async function prepareProfile(runtime, config) {
  if (!isAbsolute(config.cwd) || !(await stat(config.cwd)).isDirectory()) throw new Error('工作目录必须是本机存在的绝对目录');
  const args = ['--profile', config.profile];
  if (!existsSync(join(runtime.home, 'profiles', config.profile, 'package.json'))) args.push('--from-default-profile', 'sdk');
  const output = await runCli(runtime, [...args, '--dump-config'], { cwd: config.cwd });
  if (!output.includes('@deepseek-ai/dsh-sdk-jsonrpc-server')) throw new Error('执行 Profile 未启用官方 SDK JSON-RPC 服务');
}
