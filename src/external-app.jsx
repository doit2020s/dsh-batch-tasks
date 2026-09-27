import React from 'react';
import { createRoot } from 'react-dom/client';
import { Panel } from './client.jsx';

async function call(method, payload = {}, signal) {
  const response = await fetch(`/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload || {}),
    signal,
  });
  const body = await response.json();
  if (!body?.ok) throw new Error(body?.error?.message || '请求失败');
  return body.value;
}

createRoot(document.getElementById('root')).render(<Panel call={call} />);
