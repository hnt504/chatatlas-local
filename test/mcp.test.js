import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answer, MCP_TOOLS, negotiate, readMessage } from '../src/protocol.js';
import { cli, mcp, workspace } from './helpers.js';

test('protocol: negotiate, readMessage, unknown methods and tools', async () => {
  assert.equal(negotiate('2025-06-18'), '2025-06-18');
  assert.equal(negotiate('1999-01-01'), '2025-11-25');
  assert.equal(readMessage({ jsonrpc: '2.0', method: 'x', id: {} }), null);
  assert.equal(await answer({ jsonrpc: '2.0', method: 'notifications/initialized' }, null), null);
  assert.equal((await answer({ jsonrpc: '2.0', id: 1, method: 'sampling/x' }, null)).error.code, -32601);
  assert.equal((await answer({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'nope' } }, null)).error.code, -32602);
  const thrown = await answer({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_chats', arguments: {} } }, () => {
    throw new Error('disk on fire');
  });
  assert.equal(thrown.result.isError, true);
  for (const t of MCP_TOOLS) {
    assert.equal(t.annotations.readOnlyHint, true, `${t.name} only reads`);
    assert.ok(!/—/.test(t.description), `${t.name}'s description has no em dash`);
  }
});

test('the MCP server over stdio: handshake, tools, reading, a batch, bad input', async (t) => {
  const w = workspace();
  assert.equal(cli(['import', w.chatgpt, w.claude, '--db', w.db]).code, 0);
  const s = mcp(w.db);
  t.after(() => s.close());

  const init = await s.ask({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
  });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'chatatlas-local');
  assert.match(init.result.instructions, /read-only/);
  s.send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  const list = await s.ask({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(
    list.result.tools.map((x) => x.name),
    ['search_chats', 'list_chats', 'read_chat', 'recent_topics', 'archive_overview'],
  );

  const found = await s.ask({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_chats', arguments: { query: 'sourdough' } } });
  assert.match(found.result.content[0].text, /\[chat claude:3f1b2c4d-0000-4000-8000-000000000001\]/);
  const read = await s.ask({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'read_chat', arguments: { chat: 'claude:3f1b2c4d-0000-4000-8000-000000000001' } },
  });
  assert.match(read.result.content[0].text, /\[2\] Claude:\nLead with the sourdough program/);

  const batch = await s.ask([
    { jsonrpc: '2.0', id: 5, method: 'ping' },
    { jsonrpc: '2.0', method: 'notifications/x' },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'archive_overview' } },
  ]);
  assert.equal(batch.length, 2);
  assert.match(batch[1].result.content[0].text, /^4 chats/);

  const bad = await s.ask('{not json');
  assert.equal(bad.error.code, -32700);
  const odd = await s.ask({ hello: 'there' });
  assert.equal(odd.error.code, -32600);
  assert.equal(
    s.lines.every((l) => l.startsWith('{') || l.startsWith('[')),
    true,
    'nothing but JSON on stdout',
  );
  assert.ok(!/ExperimentalWarning/.test(s.stderr()), 'the SQLite warning is kept quiet');
});

test('the MCP server answers before any archive exists, and says it is empty', async (t) => {
  const w = workspace();
  const s = mcp(w.db);
  t.after(() => s.close());
  const r = await s.ask({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'archive_overview', arguments: {} } });
  assert.match(r.result.content[0].text, /The archive is empty/);
});
