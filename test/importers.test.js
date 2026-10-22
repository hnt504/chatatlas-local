import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import {
  titleFor,
  chatgptMessages,
  fromChatAtlas,
  fromChatgpt,
  fromClaude,
  fromJson,
  isConversationsFile,
  readExport,
  toChatAtlasBackup,
} from '../src/importers.js';
import { chatatlasBackup, chatgptExport, claudeExport } from './fixtures.js';

test('ChatGPT: follows the branch the person ended on, skips hidden, system and tool messages', () => {
  const chats = fromChatgpt(chatgptExport);
  assert.equal(chats.length, 2, 'the empty chat is left out');
  const garden = chats.find((c) => c.id === 'chatgpt:c-garden');
  assert.deepEqual(
    garden.messages.map((m) => m.role),
    ['user', 'assistant', 'user', 'assistant'],
  );
  assert.ok(!garden.messages.some((m) => m.content.includes('OLD answer')), 'the regenerated answer is not shown');
  assert.equal(garden.messages[2].content, 'Here is a photo of the bed. Is the soil too sandy?', 'a picture leaves its words');
  assert.equal(garden.date, '2025-08-01T00:00:00.000Z');
  assert.equal(garden.platform, 'chatgpt');
});

test('ChatGPT: an answer streamed in parts reads as one message', () => {
  const cafe = fromChatgpt(chatgptExport).find((c) => c.id === 'chatgpt:c-cafe');
  assert.equal(cafe.messages.length, 2);
  assert.match(cafe.messages[1].content, /The Lamp Room,\n\nKeeper’s Brew/);
});

test('ChatGPT: without current_node, walks down from the root taking the newest branch', () => {
  const m = structuredClone(chatgptExport[0].mapping);
  const msgs = chatgptMessages(m, null);
  assert.ok(msgs.length >= 2);
  assert.equal(msgs[0].role, 'user');
});

test('ChatGPT: a loop in the parents does not hang', () => {
  const mapping = {
    a: { id: 'a', parent: 'b', children: [], message: { author: { role: 'user' }, content: { parts: ['hi'] } } },
    b: { id: 'b', parent: 'a', children: [], message: { author: { role: 'assistant' }, content: { parts: ['yo'] } } },
  };
  assert.equal(chatgptMessages(mapping, 'a').length, 2);
});

test('Claude: text blocks only (no thinking or tool calls), untitled chats get a title', () => {
  const chats = fromClaude(claudeExport);
  assert.equal(chats.length, 2);
  const resume = chats[0];
  assert.equal(resume.id, 'claude:3f1b2c4d-0000-4000-8000-000000000001');
  assert.equal(resume.messages[1].content, 'Lead with the sourdough program you started.\n\nThen the 20% waste cut.');
  assert.ok(!resume.messages[1].content.includes('secret'));
  assert.equal(chats[1].title, 'What rhymes with orange?', 'an untitled chat is named by its first question');
  assert.equal(chats[1].messages[0].content, 'What rhymes with orange?', 'text works when there are no content blocks');
});

test('ChatAtlas backups keep platform and tags, and our own ids come back as they were', () => {
  const [c] = fromChatAtlas(chatatlasBackup);
  assert.equal(c.id, 'chatatlas:gem-77');
  assert.equal(c.platform, 'gemini');
  assert.deepEqual(c.tags, ['travel']);
  const back = toChatAtlasBackup([...fromChatgpt(chatgptExport), c]);
  assert.equal(back.source, 'ChatAtlas');
  assert.equal(back.count, 3);
  assert.equal(back.conversations.find((x) => x.platform === 'gemini').id, 'gem-77');
  const again = fromChatAtlas(back);
  assert.deepEqual(again.map((x) => x.id).sort(), ['chatatlas:gem-77', 'chatgpt:c-cafe', 'chatgpt:c-garden']);
});

test('fromJson tells the kinds apart, and refuses other JSON', () => {
  assert.equal(fromJson(chatgptExport).kind, 'ChatGPT');
  assert.equal(fromJson(claudeExport).kind, 'Claude');
  assert.equal(fromJson(chatatlasBackup).kind, 'ChatAtlas backup');
  assert.equal(fromJson({ hello: 1 }), null);
  assert.equal(fromJson([1, 2]), null);
});

test('isConversationsFile', () => {
  assert.ok(isConversationsFile('conversations.json'));
  assert.ok(isConversationsFile('export/conversations-002.json'));
  assert.ok(!isConversationsFile('__MACOSX/conversations.json'));
  assert.ok(!isConversationsFile('users.json'));
  assert.ok(!isConversationsFile('shared_conversations.json'));
});

test('readExport reads a zip, a json file, an unzipped folder, and says what went wrong', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cal-'));
  const zip = join(dir, 'export.zip');
  writeFileSync(zip, zipSync({ 'conversations.json': strToU8(JSON.stringify(chatgptExport)), 'user.json': strToU8('{}'), 'chat.html': strToU8('<html>') }));
  const z = readExport(zip);
  assert.equal(z.kind, 'ChatGPT');
  assert.equal(z.chats.length, 2);
  assert.equal(z.skipped, 1);

  const json = join(dir, 'conversations.json');
  writeFileSync(json, `﻿${JSON.stringify(claudeExport)}`);
  assert.equal(readExport(json).chats.length, 2, 'a byte-order mark is fine');

  const folder = join(dir, 'unzipped');
  mkdirSync(folder);
  writeFileSync(join(folder, 'conversations.json'), JSON.stringify(claudeExport));
  assert.equal(readExport(folder).kind, 'Claude');

  writeFileSync(join(dir, 'other.zip'), zipSync({ 'notes.txt': strToU8('hi') }));
  assert.throws(() => readExport(join(dir, 'other.zip')), /no conversations\.json/);
  writeFileSync(join(dir, 'bad.json'), '{nope');
  assert.throws(() => readExport(join(dir, 'bad.json')), /isn't valid JSON/);
  writeFileSync(join(dir, 'odd.json'), '{"a":1}');
  assert.throws(() => readExport(join(dir, 'odd.json')), /isn't a ChatGPT export/);
  assert.throws(() => readExport(join(dir, 'missing.zip')), /There's no file/);
  assert.throws(() => readExport(join(dir, 'empty-folder-none')), /There's no file/);
});

test('titleFor: a long first question is cut at a word', () => {
  assert.equal(titleFor('  A   title ', []), 'A title');
  assert.equal(
    titleFor('', [{ role: 'user', content: 'How do I keep basil alive on a north-facing windowsill through a Chicago winter?' }]),
    'How do I keep basil alive on a north-facing windowsill…',
  );
  assert.equal(titleFor('', []), 'Untitled');
});
