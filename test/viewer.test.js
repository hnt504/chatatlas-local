import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { openArchive } from '../src/db.js';
import { fromChatgpt, fromClaude } from '../src/importers.js';
import { isLocalHost, startViewer } from '../src/viewer.js';
import { chatgptExport, claudeExport } from './fixtures.js';

function raw(port, path, headers = {}, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.end(JSON.stringify(body));
    else req.end();
  });
}

async function viewer(t, opts = {}) {
  const archive = openArchive(':memory:');
  archive.upsert([...fromChatgpt(chatgptExport), ...fromClaude(claudeExport)]);
  const v = await startViewer(archive, opts);
  t.after(() => v.server.close());
  const api = (path, body) =>
    raw(
      v.port,
      path,
      { host: `127.0.0.1:${v.port}`, 'x-chatatlas-key': v.key, ...(body ? { 'content-type': 'application/json' } : {}) },
      body ? 'POST' : 'GET',
      body,
    ).then((r) => ({ ...r, json: JSON.parse(r.body) }));
  return { ...v, archive, api };
}

test('isLocalHost', () => {
  assert.ok(isLocalHost('127.0.0.1:5000', 5000));
  assert.ok(isLocalHost('localhost:5000', 5000));
  assert.ok(!isLocalHost('evil.example:5000', 5000));
  assert.ok(!isLocalHost('127.0.0.1:5001', 5000));
});

test('the page loads; the API needs the key, this host, and this page', async (t) => {
  const v = await viewer(t);
  assert.match(v.url, /^http:\/\/127\.0\.0\.1:\d+\/#key=[\w-]{20,}$/);
  const page = await raw(v.port, '/', { host: `127.0.0.1:${v.port}` });
  assert.equal(page.status, 200);
  assert.match(page.headers['content-security-policy'], /connect-src 'self'/);
  assert.match(page.body, /ChatAtlas <small>Local<\/small>/);
  assert.equal((await raw(v.port, '/api/overview', { host: `127.0.0.1:${v.port}` })).status, 403, 'no key');
  assert.equal((await raw(v.port, '/api/overview', { host: `127.0.0.1:${v.port}`, 'x-chatatlas-key': 'wrong' })).status, 403);
  assert.equal((await raw(v.port, '/', { host: `rebind.example:${v.port}` })).status, 421, 'a look-alike host is refused');
  assert.equal((await raw(v.port, '/api/overview', { host: `127.0.0.1:${v.port}`, 'x-chatatlas-key': v.key, origin: 'https://evil.example' })).status, 403);
  assert.equal((await v.api('/api/overview')).json.chats, 4);
});

test('search, list, read, tag and forget through the API', async (t) => {
  const v = await viewer(t);
  const s = (await v.api('/api/chats?q=sandy')).json;
  assert.equal(s.total, 1);
  assert.equal(s.chats[0].hit.index, 2);
  assert.match(s.chats[0].hit.text, /sandy/);
  assert.equal(s.chats[0].messages, undefined, 'the list does not carry whole chats');
  assert.equal((await v.api('/api/chats?platform=claude')).json.total, 2);
  assert.equal((await v.api('/api/chats?since=soon')).status, 400);
  const c = (await v.api('/api/chat?id=chatgpt:c-cafe')).json;
  assert.equal(c.fileName, '2026-01-01 Café names.md');
  assert.match(c.markdown, /^# Café names/);
  assert.equal((await v.api('/api/chat?id=nope-nope')).status, 404);
  assert.deepEqual((await v.api('/api/tags', { id: 'chatgpt:c-cafe', tags: ['ideas'] })).json.chat.tags, ['ideas']);
  assert.equal((await v.api('/api/tags', { id: 'chatgpt:c-cafe', tags: 'ideas' })).status, 400);
  assert.equal((await v.api('/api/forget', { id: 'chatgpt:c-cafe' })).json.forgotten, 1);
  assert.equal((await v.api('/api/overview')).json.chats, 3);
});

test('read-only: looking is fine, changing is refused', async (t) => {
  const v = await viewer(t, { readOnly: true });
  assert.equal((await v.api('/api/overview')).json.readOnly, true);
  assert.equal((await v.api('/api/forget', { id: 'chatgpt:c-cafe' })).status, 403);
  assert.equal((await v.api('/api/tags', { id: 'chatgpt:c-cafe', tags: [] })).status, 403);
});
