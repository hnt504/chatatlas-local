import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { openArchive } from '../src/db.js';
import { MCP_PATH, normalizeOrigin, parseAllowedOrigins, startHttpServer } from '../src/http.js';
import { BIN, cli, workspace } from './helpers.js';

const PAGE = 'http://localhost:8081';

/** Sends one raw request (raw so the Host header can be anything) and answers status, headers and body. */
function send(port, { method = 'POST', path = MCP_PATH, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (text += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
const JSON_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

async function server(t, { allowedOrigins = [PAGE] } = {}) {
  const w = workspace();
  assert.equal(cli(['import', w.chatgpt, w.claude, '--db', w.db]).code, 0);
  let opened = 0;
  const s = await startHttpServer({ getArchive: () => (opened++, openArchive(w.db)), port: 0, allowedOrigins });
  t.after(() => new Promise((r) => s.server.close(r)));
  return { ...s, opened: () => opened };
}

test('mcp over http: handshake, tools and reading, on 127.0.0.1 only', async (t) => {
  const s = await server(t);
  assert.equal(s.server.address().address, '127.0.0.1');
  assert.equal(s.url, `http://127.0.0.1:${s.port}/mcp`);

  const init = await send(s.port, {
    headers: JSON_HEADERS,
    body: rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }),
  });
  assert.equal(init.status, 200);
  assert.match(init.headers['content-type'], /application\/json/);
  assert.equal(init.json().result.protocolVersion, '2025-06-18');
  assert.equal(init.json().result.serverInfo.name, 'chatatlas-local');
  assert.equal(s.opened(), 0, 'the handshake never opens the archive');

  const list = await send(s.port, { headers: JSON_HEADERS, body: rpc(2, 'tools/list') });
  assert.deepEqual(
    list.json().result.tools.map((x) => x.name),
    ['chatatlas_search_chats', 'chatatlas_list_chats', 'chatatlas_read_chat', 'chatatlas_recent_topics', 'chatatlas_archive_overview'],
  );
  const found = await send(s.port, {
    headers: JSON_HEADERS,
    body: rpc(3, 'tools/call', { name: 'chatatlas_search_chats', arguments: { query: 'sourdough' } }),
  });
  assert.match(found.json().result.content[0].text, /\[chat claude:3f1b2c4d-0000-4000-8000-000000000001\]/);
  assert.equal(s.opened(), 1);

  const batch = await send(s.port, {
    headers: JSON_HEADERS,
    body: [rpc(4, 'ping'), { jsonrpc: '2.0', method: 'notifications/x' }, rpc(5, 'tools/call', { name: 'chatatlas_archive_overview' })],
  });
  assert.deepEqual(
    batch.json().map((a) => a.id),
    [4, 5],
  );

  const note = await send(s.port, { headers: JSON_HEADERS, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  assert.equal(note.status, 202);
  assert.equal(note.text, '');
});

test('mcp over http: only the allowed browser page gets in, and a refused page runs no tool', async (t) => {
  const s = await server(t);
  const pre = await send(s.port, {
    method: 'OPTIONS',
    headers: { origin: PAGE, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type, mcp-protocol-version' },
  });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers['access-control-allow-origin'], PAGE);
  assert.match(pre.headers['access-control-allow-headers'], /mcp-protocol-version/);
  assert.match(pre.headers['access-control-allow-methods'], /POST/);

  assert.equal(s.opened(), 0);
  const ok = await send(s.port, { headers: { ...JSON_HEADERS, origin: PAGE }, body: rpc(1, 'tools/call', { name: 'chatatlas_archive_overview' }) });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['access-control-allow-origin'], PAGE);

  for (const origin of ['http://evil.example', 'http://localhost:9999', 'https://localhost:8081', 'null', 'http://localhost:8081.evil.example']) {
    const refusedPre = await send(s.port, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST' } });
    assert.equal(refusedPre.status, 403, origin);
    assert.equal(refusedPre.headers['access-control-allow-origin'], undefined, origin);
    const refused = await send(s.port, {
      headers: { ...JSON_HEADERS, origin },
      body: rpc(2, 'tools/call', { name: 'chatatlas_search_chats', arguments: { query: 'sourdough' } }),
    });
    assert.equal(refused.status, 403, origin);
    assert.ok(!/sourdough/.test(refused.text), origin);
  }
  // A page posting text/plain (which a browser sends without asking first) is refused as well.
  const simple = await send(s.port, {
    headers: { 'content-type': 'text/plain', origin: 'http://evil.example' },
    body: rpc(3, 'tools/call', { name: 'chatatlas_archive_overview' }),
  });
  assert.equal(simple.status, 403);
  assert.equal(s.opened(), 1, 'only the allowed page opened the archive');
});

test('mcp over http: no browser page at all unless one is allowed', async (t) => {
  const s = await server(t, { allowedOrigins: [] });
  assert.equal((await send(s.port, { headers: { ...JSON_HEADERS, origin: PAGE }, body: rpc(1, 'ping') })).status, 403);
  assert.equal((await send(s.port, { headers: JSON_HEADERS, body: rpc(2, 'ping') })).status, 200, 'a program (no Origin) still gets in');
});

test('mcp over http: requests addressed to any other host are refused (DNS rebinding)', async (t) => {
  const s = await server(t);
  for (const host of [
    'attacker.example',
    `attacker.example:${s.port}`,
    `localhost.attacker.example:${s.port}`,
    `127.0.0.1:${s.port + 1}`,
    `192.168.1.5:${s.port}`,
  ]) {
    const r = await send(s.port, {
      headers: { ...JSON_HEADERS, host },
      body: rpc(1, 'tools/call', { name: 'chatatlas_search_chats', arguments: { query: 'sourdough' } }),
    });
    assert.equal(r.status, 421, host);
    assert.ok(!/sourdough/.test(r.text), host);
  }
  for (const host of [`localhost:${s.port}`, `127.0.0.1:${s.port}`]) {
    assert.equal((await send(s.port, { headers: { ...JSON_HEADERS, host }, body: rpc(1, 'ping') })).status, 200, host);
  }
  // No Host header at all, sent as raw bytes so nothing fills one in.
  const raw = await new Promise((resolve, reject) => {
    const body = JSON.stringify(rpc(1, 'tools/call', { name: 'chatatlas_search_chats', arguments: { query: 'sourdough' } }));
    const sock = connect(s.port, '127.0.0.1', () =>
      sock.end(`POST /mcp HTTP/1.1

content-type: application/json

content-length: ${Buffer.byteLength(body)}

connection: close



${body}`),
    );
    let text = '';
    sock.setEncoding('utf8');
    sock.on('data', (d) => (text += d));
    sock.on('end', () => resolve(text));
    sock.on('error', reject);
  });
  assert.match(raw, /^HTTP\/1\.1 4\d\d /);
  assert.ok(!/sourdough/.test(raw));
  assert.equal(s.opened(), 0);
});

test('mcp over http: wrong path, method, type, version, size and JSON', async (t) => {
  const s = await server(t);
  assert.equal((await send(s.port, { path: '/', headers: JSON_HEADERS, body: rpc(1, 'ping') })).status, 404);
  assert.equal((await send(s.port, { path: '/mcp/../db', headers: JSON_HEADERS, body: rpc(1, 'ping') })).status, 404);
  for (const method of ['GET', 'DELETE', 'PUT']) {
    const r = await send(s.port, { method, headers: { accept: 'text/event-stream' } });
    assert.equal(r.status, 405, method);
    assert.match(r.headers.allow, /POST/);
  }
  assert.equal((await send(s.port, { headers: { 'content-type': 'text/plain' }, body: rpc(1, 'ping') })).status, 415);
  assert.equal((await send(s.port, { headers: { ...JSON_HEADERS, 'mcp-protocol-version': '1999-01-01' }, body: rpc(1, 'ping') })).status, 400);
  assert.equal((await send(s.port, { headers: { ...JSON_HEADERS, 'mcp-protocol-version': '2025-06-18' }, body: rpc(1, 'ping') })).status, 200);
  assert.equal((await send(s.port, { headers: JSON_HEADERS, body: 'x'.repeat(1024 * 1024 + 1) })).status, 413);
  const bad = await send(s.port, { headers: JSON_HEADERS, body: '{nope' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json().error.code, -32700);
  assert.equal((await send(s.port, { headers: JSON_HEADERS, body: { hello: 1 } })).json().error.code, -32600);
});

test('mcp over http: a client that accepts only an event stream gets one', async (t) => {
  const s = await server(t);
  const r = await send(s.port, { headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: rpc(7, 'ping') });
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/event-stream/);
  assert.equal(r.text, `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 7, result: {} })}\n\n`);
});

test('allowed origins are exact page addresses', () => {
  assert.deepEqual(parseAllowedOrigins('http://LOCALHOST:8081/, http://127.0.0.1:8081,http://localhost:8081'), [
    'http://localhost:8081',
    'http://127.0.0.1:8081',
  ]);
  assert.deepEqual(parseAllowedOrigins(undefined), []);
  assert.equal(normalizeOrigin('http://localhost:80'), 'http://localhost');
  for (const bad of [
    '*',
    'http://*.example',
    'http://localhost:8081/chat',
    'ftp://localhost',
    'localhost:8081',
    'http://u:p@localhost:8081',
    'http://localhost:8081?x=1',
  ]) {
    assert.throws(() => parseAllowedOrigins(bad), /page address/, bad);
  }
  assert.throws(() => parseAllowedOrigins(true), /needs an address/);
});

test('the command line: mcp --http serves, says where, and refuses bad settings', async (t) => {
  const w = workspace();
  assert.equal(cli(['import', w.chatgpt, '--db', w.db]).code, 0);
  assert.equal(cli(['mcp', '--http', '--allow-origin', '*', '--db', w.db]).code, 1);
  assert.match(cli(['mcp', '--http', '--port', 'abc', '--db', w.db]).err, /--port needs a number/);

  const child = spawn(process.execPath, [BIN, 'mcp', '--http', '--port', '0', '--allow-origin', PAGE, '--db', w.db], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const url = await new Promise((resolve, reject) => {
    let err = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => {
      err += d;
      const m = /MCP over HTTP at (http:\/\/127\.0\.0\.1:(\d+)\/mcp)/.exec(err);
      if (m && /Browser pages allowed: http:\/\/localhost:8081/.test(err)) resolve(m);
    });
    child.on('exit', () => reject(new Error(`exited early: ${err}`)));
  });
  const r = await send(Number(url[2]), { headers: { ...JSON_HEADERS, origin: PAGE }, body: rpc(1, 'tools/list') });
  assert.equal(r.status, 200);
  assert.equal(r.json().result.tools.length, 5);
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  assert.equal(out, '', 'nothing on stdout');
});

test('mcp over http: tools carry the chatatlas_ prefix so built-in tools in a browser assistant cannot shadow them', async (t) => {
  const s = await server(t);
  const init = await send(s.port, {
    headers: JSON_HEADERS,
    body: rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }),
  });
  const instructions = init.json().result.instructions;
  assert.match(instructions, /chatatlas_search_chats/);
  const PLAIN = /search_chats|list_chats|read_chat|recent_topics|archive_overview/;
  const withoutPrefixed = (text) => text.replace(/chatatlas_[a-z_]+/g, '');
  assert.ok(!PLAIN.test(withoutPrefixed(instructions)), 'no plain name left in the instructions');
  const tools = (await send(s.port, { headers: JSON_HEADERS, body: rpc(2, 'tools/list') })).json().result.tools;
  for (const tool of tools) {
    assert.ok(tool.name.startsWith('chatatlas_'), tool.name);
    assert.ok(!PLAIN.test(withoutPrefixed(tool.description)), `${tool.name} description uses the prefixed names`);
  }
  // The plain name is not a tool here: a client that calls it gets told so, and nothing runs.
  const plain = await send(s.port, { headers: JSON_HEADERS, body: rpc(3, 'tools/call', { name: 'search_chats', arguments: { query: 'sourdough' } }) });
  assert.equal(plain.json().error.code, -32602);
  assert.equal(s.opened(), 0);
  // Errors name the tools as they are called here.
  const err = (await send(s.port, { headers: JSON_HEADERS, body: rpc(4, 'tools/call', { name: 'chatatlas_read_chat', arguments: { chat: '' } }) })).json()
    .result;
  assert.equal(err.isError, true);
  assert.match(err.content[0].text, /chatatlas_read_chat/);
});

test('mcp over http: chat text in results is never rewritten', async (t) => {
  const s = await server(t);
  const found = await send(s.port, {
    headers: JSON_HEADERS,
    body: rpc(1, 'tools/call', { name: 'chatatlas_read_chat', arguments: { chat: 'claude:3f1b2c4d-0000-4000-8000-000000000001' } }),
  });
  const text = found.json().result.content[0].text;
  assert.match(text, /\[2\] Claude:\nLead with the sourdough program/);
  assert.ok(!/chatatlas_/.test(text), 'a successful result is passed through untouched');
});

test('mcp over http: --verbose logs the kind of request, never search words or chat text', async (t) => {
  const w = workspace();
  assert.equal(cli(['import', w.chatgpt, w.claude, '--db', w.db]).code, 0);
  const lines = [];
  const s = await startHttpServer({ getArchive: () => openArchive(w.db), port: 0, allowedOrigins: [PAGE], log: (m) => lines.push(m) });
  t.after(() => new Promise((r) => s.server.close(r)));
  const r = await send(s.port, {
    headers: { ...JSON_HEADERS, origin: PAGE },
    body: rpc(1, 'tools/call', { name: 'chatatlas_search_chats', arguments: { query: 'sourdough' } }),
  });
  assert.match(r.text, /sourdough/i);
  await new Promise((done) => setImmediate(done));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^POST \/mcp origin=http:\/\/localhost:8081 .* -> 200 tools\/call chatatlas_search_chats$/);
  assert.ok(!/sourdough/i.test(lines.join('\n')), 'no search words or chat text in the log');
});
