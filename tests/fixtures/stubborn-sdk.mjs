import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import readline from 'node:readline';
const grandchild = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
writeFileSync(process.env.BATCH_TEST_PID_FILE, String(grandchild.pid));
const lines = readline.createInterface({ input: process.stdin });
const frame = x => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...x }) + '\n');
lines.on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') frame({ id: message.id, result: { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: 'test' } } });
  if (message.method === 'session/prompt') frame({ id: message.id, result: { messageId: 'test' } });
  // Deliberately ignores shutdown: verify the OS process-tree fallback.
});
setInterval(() => {}, 1000);
