import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BYTES = 20 * 1024 * 1024;

function rotate(file) {
  try {
    if (statSync(file).size < MAX_BYTES) return;
    renameSync(file, `${file}.1`);
  } catch { /* missing or in use */ }
}

/** Append-only JSONL under ~/.dsh/batch-tasks/logs. Survives SDK crashes. */
export function createBatchLog(home) {
  const dir = join(home, 'batch-tasks', 'logs');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'current.log');
  const write = (level, msg, extra, dest = file) => {
    const rec = { t: new Date().toISOString(), level, msg };
    if (extra && typeof extra === 'object') Object.assign(rec, extra);
    else if (extra !== undefined) rec.detail = String(extra);
    rotate(dest);
    appendFileSync(dest, JSON.stringify(rec) + '\n');
  };
  return {
    dir,
    file,
    info: (msg, extra) => write('info', msg, extra),
    warn: (msg, extra) => write('warn', msg, extra),
    error: (msg, extra) => write('error', msg, extra),
    task(taskId) {
      const tf = join(dir, `${taskId}.log`);
      const tw = (level, msg, extra) => {
        write(level, msg, extra, file);
        write(level, msg, extra, tf);
      };
      return {
        file: tf,
        info: (msg, extra) => tw('info', msg, extra),
        warn: (msg, extra) => tw('warn', msg, extra),
        error: (msg, extra) => tw('error', msg, extra),
        raw(name, text) {
          if (!text) return;
          appendFileSync(join(dir, `${taskId}.${name}`), text);
        },
      };
    },
  };
}
