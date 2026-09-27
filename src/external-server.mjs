import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { createBatchCore } from './core.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>DSH 批量任务</title>
<style>
html,body,#root{height:100%;margin:0;background:#101719;color:#e8efed}
.dbt{min-height:100vh!important;border-radius:0!important;padding:28px 32px 40px!important}
.dbt-close{display:none!important}
</style>
</head>
<body><div id="root"></div><script src="/app.js"></script></body>
</html>`;

const core = await createBatchCore();
const appJs = existsSync(join(root, 'lib', 'external.js')) ? readFileSync(join(root, 'lib', 'external.js')) : Buffer.from('document.getElementById("root").textContent="缺少 lib/external.js，请先 npm run build";');

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/app.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(appJs);
      return;
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      const method = url.pathname.slice(5);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString('utf8');
      const payload = raw ? JSON.parse(raw) : {};
      const result = await core.handle(method, payload);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: { message: e.message } }));
  }
});

const port = Number(process.env.DSH_BATCH_PORT || 17897);
await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', resolve).on('error', reject));
const href = `http://127.0.0.1:${port}/`;
console.log(`DSH batch UI ${href}`);
if (!process.env.DSH_BATCH_NO_BROWSER) {
  if (process.platform === 'win32') exec(`start "" "${href}"`);
  else if (process.platform === 'darwin') exec(`open "${href}"`);
  else exec(`xdg-open "${href}"`);
}

async function shutdown() {
  try { await core.dispose(); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
