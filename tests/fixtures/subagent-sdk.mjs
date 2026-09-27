import readline from 'node:readline';
import { writeFileSync } from 'node:fs';

const delayMs = Number(process.env.BATCH_TEST_CHILD_MS || 1500);
if (process.env.BATCH_TEST_START_FILE) writeFileSync(process.env.BATCH_TEST_START_FILE, String(process.pid));
const lines = readline.createInterface({ input: process.stdin });
const frame = x => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...x }) + '\n');
const notify = (method, params) => frame({ method, params });
let childDone = false;

lines.on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    setTimeout(() => frame({ id: message.id, result: { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: 'test' }, agentPreset: message.params?.agentPreset, taskWorkDir: message.params?.taskWorkDir } }), Number(process.env.BATCH_TEST_INITIALIZE_MS || 0));
    return;
  }
  if (message.method === 'session/create') {
    frame({ id: message.id, result: { sessionId: message.params.sessionId, agentPreset: message.params.agentPreset } });
    return;
  }
  if (message.method === 'session/prompt') {
    const sessionId = message.params.sessionId;
    frame({ id: message.id, result: { messageId: 'test' } });
    setImmediate(() => {
      notify('session.event', { sessionId, event: { type: 'turn/start' } });
      notify('session.event', { sessionId, event: { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '已派子任务' }] } } } });
      notify('subagent.started', { parentSessionId: sessionId, childSessionId: 'child-1' });
      notify('session.event', { sessionId, event: { type: 'turn/end', data: { reason: { kind: 'completed' } } } });
      notify('session.status', { sessionId, status: 'idle' });
    });
    setTimeout(() => {
      childDone = true;
      notify('subagent.finished', { childSessionId: 'child-1', status: 'ok' });
    }, delayMs);
    return;
  }
  if (message.method === 'shutdown') {
    process.exit(childDone ? 0 : 2);
  }
});
