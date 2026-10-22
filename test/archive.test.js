import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ftsQuery, openArchive, searchWords } from '../src/db.js';
import { fromChatAtlas, fromChatgpt, fromClaude } from '../src/importers.js';
import { runTool } from '../src/tools.js';
import { chatatlasBackup, chatgptExport, claudeExport } from './fixtures.js';

const filled = () => {
  const a = openArchive(':memory:');
  a.upsert([...fromChatgpt(chatgptExport), ...fromClaude(claudeExport), ...fromChatAtlas(chatatlasBackup)]);
  return a;
};
const out = (r) => r.content[0].text;

test('search words are folded and turned into a prefix query', () => {
  assert.deepEqual(searchWords('Résumé, BAKERY-job!'), ['resume', 'bakery', 'job']);
  assert.equal(ftsQuery('plan "x'), '"plan"* AND "x"*');
  assert.equal(ftsQuery(' ,, '), null);
});

test('upsert adds, then knows what is already here, then updates what changed, keeping tags', () => {
  const a = openArchive(':memory:');
  const chats = fromChatgpt(chatgptExport);
  assert.deepEqual(a.upsert(chats), { added: 2, updated: 0, unchanged: 0 });
  assert.deepEqual(a.upsert(chats), { added: 0, updated: 0, unchanged: 2 });
  a.setTags('chatgpt:c-cafe', ['business']);
  const changed = structuredClone(chats);
  changed[1].messages.push({ role: 'user', content: 'Something about porpoises' });
  assert.deepEqual(a.upsert(changed), { added: 0, updated: 1, unchanged: 1 });
  const cafe = a.getChat('chatgpt:c-cafe').chat;
  assert.deepEqual(cafe.tags, ['business'], 'a tag added here survives a re-import');
  assert.equal(cafe.message_count, 3);
  assert.equal(a.search('porpoises').total, 1, 'the index follows the update');
  assert.equal(a.search('lamp').total, 1);
});

test('search: every word, prefixes, accents, title matches first, filters', () => {
  const a = filled();
  assert.equal(a.search('resume bakery').total, 1, 'accents ignored');
  assert.equal(a.search('plant raised').total, 1);
  assert.equal(a.search('plan').rows[0].id, 'chatgpt:c-garden', 'plan finds planning');
  assert.equal(a.search('cucumbers').total, 0, 'a regenerated answer is not indexed');
  assert.equal(a.search('garden kale').total, 1, 'words across title and messages');
  assert.equal(a.search('lisbon', { platform: 'gemini' }).total, 1);
  assert.equal(a.search('lisbon', { platform: 'claude' }).total, 0);
  assert.equal(a.search('lisbon', { tag: 'TRAVEL' }).total, 1, 'tags without regard to capitals');
  assert.equal(
    a.search('the', { since: '2026-01-01T00:00:00.000Z', until: '2026-04-01T00:00:00.000Z' }).rows.every((r) => r.date >= '2026-01' && r.date < '2026-04'),
    true,
  );
  // Title matches first: "brew" is only in a message; add a chat titled "Brew" that's older.
  a.upsert([
    {
      id: 'claude:t',
      platform: 'claude',
      title: 'Brew day',
      date: '2020-01-01T00:00:00.000Z',
      updated: null,
      tags: [],
      messages: [{ role: 'user', content: 'hops' }],
    },
  ]);
  assert.deepEqual(
    a.search('brew').rows.map((r) => r.id),
    ['claude:t', 'chatgpt:c-cafe'],
  );
  assert.equal(a.search('brew').rows[0].in_title, true);
  assert.equal(a.search('"').total, 0, 'nothing to look for');
});

test('getChat by id, by its start, by the part after the colon, ambiguous', () => {
  const a = filled();
  assert.equal(a.getChat('chatgpt:c-cafe').chat.title, 'Café names');
  assert.equal(a.getChat('chatgpt:c-ga').chat.id, 'chatgpt:c-garden');
  assert.equal(a.getChat('3f1b2c4d-0000-4000-8000-000000000002').chat.platform, 'claude');
  assert.equal(a.getChat('3f1b').ambiguous, true);
  assert.equal(a.getChat('abc').chat, null, 'too short to guess');
  assert.equal(a.getChat('50%_').chat, null, 'LIKE characters are literal');
});

test('list: newest first, title words, tag, paging; stats; forget', () => {
  const a = filled();
  const { rows, total } = a.list({ limit: 2 });
  assert.equal(total, 5);
  assert.equal(rows[0].date >= rows[1].date, true);
  assert.equal(a.list({ title: 'cafe' }).total, 0, 'title search is plain words');
  assert.equal(a.list({ title: 'café' }).total, 1);
  assert.equal(a.list({ offset: 4 }).rows.length, 1);
  const s = a.stats();
  assert.equal(s.chats, 5);
  assert.deepEqual(s.platforms.map((p) => p.platform).sort(), ['chatgpt', 'claude', 'gemini']);
  assert.deepEqual(s.tags, [{ tag: 'travel', chats: 1 }]);
  assert.equal(a.forget(['chatgpt:c-cafe', 'nope']), 1);
  assert.equal(a.search('lamp').total, 0, 'a forgotten chat leaves the index');
  assert.equal(a.stats().chats, 4);
});

test('tools: search quotes the best message and gives ids', () => {
  const a = filled();
  const t = out(runTool(a, 'search_chats', { query: 'sandy soil' }));
  assert.match(t, /\[chat chatgpt:c-garden\] ChatGPT · Aug 1, 2025 · “Planning the vegetable garden” \(4 messages\)/);
  assert.match(t, /message 3 \(You\): Here is a photo/);
  assert.match(out(runTool(a, 'search_chats', { query: 'zzzz' })), /No saved chats hold every word/);
  assert.equal(runTool(a, 'search_chats', { query: '  ' }).isError, true);
  assert.equal(runTool(a, 'search_chats', { query: 'x', since: 'last tuesday' }).isError, true);
});

test('tools: read_chat pages, list_chats, recent_topics, archive_overview', () => {
  const a = filled();
  const r = out(runTool(a, 'read_chat', { chat: '[chat chatgpt:c-garden]' }));
  assert.match(r, /\[1\] You:\nWhat should I plant/);
  assert.match(r, /That is the end of the chat\./);
  assert.match(out(runTool(a, 'read_chat', { chat: 'chatgpt:c-garden', from_message: 4 })), /^“Planning[\s\S]*\[4\] ChatGPT:/);
  assert.equal(runTool(a, 'read_chat', { chat: 'nope-nope' }).isError, true);
  assert.match(out(runTool(a, 'list_chats', { platform: 'claude' })), /Chats 1–2 of 2/);
  const topics = out(runTool(a, 'recent_topics', { days: 30 }, new Date('2026-10-15T00:00:00Z')));
  assert.match(topics, /No saved chats from the last 30 days|The last 30 days/);
  const ov = out(runTool(a, 'archive_overview', {}));
  assert.match(ov, /5 chats, 12 messages/);
  assert.match(ov, /Tags: travel \(1\)/);
  assert.match(out(runTool(openArchive(':memory:'), 'archive_overview', {})), /The archive is empty/);
  assert.equal(runTool(a, 'delete_everything', {}).isError, true);
});
