import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cli, workspace } from './helpers.js';

test('import, then search, list, show, stats, topics', () => {
  const w = workspace();
  const db = ['--db', w.db];
  const first = cli(['import', w.chatgpt, w.claude, w.backup, ...db]);
  assert.equal(first.code, 0, first.err);
  assert.match(first.out, /chatgpt-export\.zip: ChatGPT, 2 chats \(2 new\) \(1 empty chat left out\)/);
  assert.match(first.out, /claude-export\.zip: Claude, 2 chats \(2 new\)/);
  assert.match(first.out, /backup\.json: ChatAtlas backup, 1 chat \(1 new\)/);
  assert.match(cli(['import', w.chatgpt, ...db]).out, /2 already here/);

  const s = cli(['search', 'raised', 'beds', ...db]);
  assert.match(s.out, /Planning the vegetable garden  ChatGPT · Aug 1, 2025 · chatgpt:c-garden/);
  assert.match(s.out, /1\. You: What should I plant in raised beds/);
  const sj = JSON.parse(cli(['search', 'lisbon', '--json', ...db]).out);
  assert.equal(sj.total, 1);
  assert.equal(sj.chats[0].hit.message, 1);
  assert.match(cli(['search', 'nothinglikethis', ...db]).out, /No chats hold every word/);

  const l = cli(['list', '--platform', 'claude', ...db]);
  assert.match(l.out, /1–2 of 2 chats/);
  assert.equal(JSON.parse(cli(['list', '--json', '--limit', '1', ...db]).out).total, 5);

  const show = cli(['show', 'chatgpt:c-ca', ...db]);
  assert.match(show.out, /Café names\nChatGPT · Jan 1, 2026 · 2 messages/);
  assert.match(show.out, /\[2\] ChatGPT\nThe Lamp Room,/);
  assert.match(cli(['show', 'chatgpt:c-cafe', '--md', ...db]).out, /^# Café names\n\n- Platform: ChatGPT/);

  const st = cli(['stats', ...db]);
  assert.match(st.out, /5 chats, 12 messages/);
  assert.match(st.out, /Last import:/);
  assert.match(cli(['topics', '--days', '3650', ...db]).out, /By platform:/);
});

test('tag, forget, export as Markdown and as a ChatAtlas backup that comes back in', () => {
  const w = workspace();
  const db = ['--db', w.db];
  cli(['import', w.chatgpt, w.claude, ...db]);
  assert.match(cli(['tag', 'chatgpt:c-cafe', 'business', 'Ideas', ...db]).out, /business, Ideas/);
  assert.match(cli(['tag', 'chatgpt:c-cafe', 'ideas', '--remove', ...db]).out, /“Café names”: business$/m);
  assert.match(cli(['list', '--tag', 'business', ...db]).out, /Café names/);

  const md = join(w.dir, 'md');
  assert.match(cli(['export', md, ...db]).out, /4 chats as Markdown/);
  const files = readdirSync(md).sort();
  assert.ok(files.includes('2026-01-01 Café names.md'));
  assert.ok(files.includes('2026-10-01 What rhymes with orange.md'));

  const bk = join(w.dir, 'bk');
  assert.match(cli(['export', bk, '--format', 'chatatlas', '--platform', 'chatgpt', ...db]).out, /2 chats →/);
  const file = join(bk, readdirSync(bk)[0]);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(data.source, 'ChatAtlas');
  assert.deepEqual(data.conversations.find((c) => c.title === 'Café names').tags, ['business']);
  assert.match(cli(['import', file, ...db]).out, /2 already here/, 'our own backup updates the same chats');

  assert.equal(cli(['forget', 'chatgpt:c-cafe', ...db]).code, 1, 'asks for --yes when it cannot ask');
  assert.match(cli(['forget', 'chatgpt:c-cafe', '--yes', ...db]).out, /Forgot 1 chat/);
  assert.match(cli(['search', 'lamp', ...db]).out, /No chats hold/);
});

test('helpful failures', () => {
  const w = workspace();
  const db = ['--db', w.db];
  const r = cli(['search', 'x', ...db]);
  assert.equal(r.code, 1);
  assert.match(r.err, /There's no archive yet/);
  assert.match(cli(['import', ...db]).err, /Which export\?/);
  assert.match(cli(['import', join(w.dir, 'nope.zip'), ...db]).err, /There's no file/);
  assert.match(cli(['frobnicate']).err, /There's no command called "frobnicate"/);
  assert.match(cli(['list', '--since', 'soon', ...db]).err, /isn't a date|There's no archive/);
  cli(['import', w.claude, ...db]);
  assert.match(cli(['list', '--since', 'soon', ...db]).err, /--since "soon" isn't a date/);
  assert.match(cli(['show', 'nope-nope', ...db]).err, /There's no chat with the id/);
  assert.match(cli(['--help']).out, /Bring chats in/);
  assert.match(cli(['--version']).out, /^\d+\.\d+\.\d+/);
  assert.ok(!existsSync(join(w.dir, 'never.db')));
});

test('CHATATLAS_LOCAL_DB picks the archive, and where says which', () => {
  const w = workspace();
  assert.equal(cli(['where'], { env: { CHATATLAS_LOCAL_DB: w.db } }).out.trim(), w.db);
  cli(['import', w.claude], { env: { CHATATLAS_LOCAL_DB: w.db } });
  assert.ok(existsSync(w.db));
});

test('doctor', () => {
  const w = workspace();
  cli(['import', w.claude, '--db', w.db]);
  const d = cli(['doctor', '--db', w.db], { env: { HOME: w.home, USERPROFILE: w.home, APPDATA: join(w.home, 'AppData') } });
  assert.match(d.out, /✓ Node /);
  assert.match(d.out, /✓ Archive .*: 2 chats/);
  assert.match(d.out, /✓ Search index matches the chats/);
  assert.equal(d.code, 0, d.out);
});
