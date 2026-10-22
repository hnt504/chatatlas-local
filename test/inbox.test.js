import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { openArchive } from '../src/db.js';
import { candidates, scanInbox, watchInbox } from '../src/inbox.js';
import { chatgptExport, claudeExport } from './fixtures.js';
import { workspace } from './helpers.js';

test('scanInbox brings exports in once, leaves other files alone, and looks again at a changed file', () => {
  const w = workspace();
  const inbox = join(w.dir, 'Downloads');
  mkdirSync(inbox);
  writeFileSync(join(inbox, 'a1b2-2026-10-01.zip'), zipSync({ 'conversations.json': strToU8(JSON.stringify(chatgptExport)) }));
  writeFileSync(join(inbox, 'holiday-photos.zip'), zipSync({ 'img.txt': strToU8('x') }));
  writeFileSync(join(inbox, 'package.json'), '{"name":"x"}');
  writeFileSync(join(inbox, 'notes.txt'), 'hello');
  assert.equal(candidates(inbox).length, 3);
  const a = openArchive(':memory:');
  const first = scanInbox(a, inbox);
  assert.equal(first.length, 3);
  assert.equal(first.filter((r) => r.kind).length, 1);
  assert.equal(a.stats().chats, 2);
  assert.deepEqual(scanInbox(a, inbox), [], 'nothing new the second time');
  const later = join(inbox, 'package.json');
  writeFileSync(later, JSON.stringify(claudeExport));
  utimesSync(later, new Date(), new Date(Date.now() + 5000));
  const again = scanInbox(a, inbox);
  assert.equal(again.length, 1);
  assert.equal(again[0].kind, 'Claude');
  assert.equal(a.stats().chats, 4);
});

test('watchInbox picks up an export saved while it watches', async () => {
  const w = workspace();
  const inbox = join(w.dir, 'in');
  mkdirSync(inbox);
  const a = openArchive(':memory:');
  const seen = [];
  const stop = watchInbox(a, inbox, { log: (m) => seen.push(m), settleMs: 100, pollMs: 300 });
  writeFileSync(join(inbox, 'data-2026.zip'), zipSync({ 'conversations.json': strToU8(JSON.stringify(claudeExport)) }));
  for (let i = 0; i < 100 && a.stats().chats === 0; i++) await new Promise((r) => setTimeout(r, 50));
  stop();
  assert.equal(a.stats().chats, 2);
  assert.match(seen[0], /data-2026\.zip: Claude, 2 new/);
});

test('the MCP server with --inbox brings in what is waiting', async (t) => {
  const w = workspace();
  const inbox = join(w.dir, 'in');
  mkdirSync(inbox);
  writeFileSync(join(inbox, 'export.zip'), zipSync({ 'conversations.json': strToU8(JSON.stringify(chatgptExport)) }));
  const { spawn } = await import('node:child_process');
  const { BIN } = await import('./helpers.js');
  const child = spawn(process.execPath, [BIN, 'mcp', '--db', w.db, '--inbox', inbox], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  let err = '';
  child.stderr.on('data', (d) => (err += d));
  for (let i = 0; i < 80 && !/inbox: .*export\.zip/.test(err); i++) await new Promise((r) => setTimeout(r, 50));
  assert.match(err, /export\.zip: ChatGPT, 2 new/);
  child.stdin.end();
});
