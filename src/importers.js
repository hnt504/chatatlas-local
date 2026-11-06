// Reading chat exports into one shape. Every importer answers a list of chats:
//   { id, platform, title, date, updated, tags, messages: [{ role: 'user' | 'assistant', content }] }
// The id carries the platform's own id ("chatgpt:<id>", "claude:<uuid>"), so importing the same
// export twice, or a newer export later, updates chats instead of doubling them.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';

/** @typedef {{ role: 'user' | 'assistant', content: string }} Message */
/** @typedef {{ id: string, platform: string, title: string, date: string, updated: string | null, tags: string[], messages: Message[] }} Chat */
/** @typedef {{ kind: string, chats: Chat[], skipped: number }} ImportResult */

const iso = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const text = (v) => (typeof v === 'string' ? v : '');

/** A chat's title, or for an untitled one the start of what the person first asked. */
export function titleFor(title, messages) {
  const t = text(title).replace(/\s+/g, ' ').trim();
  if (t) return t;
  const first = (messages.find((m) => m.role === 'user') ?? messages[0])?.content.replace(/\s+/g, ' ').trim() ?? '';
  if (!first) return 'Untitled';
  if (first.length <= 60) return first;
  const cut = first.slice(0, 60);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > 30 ? cut.slice(0, sp) : cut).replace(/[\s,.;:!?-]+$/, '')}…`;
}

// ── ChatGPT ──────────────────────────────────────────────────────────────
// conversations.json: [{ id | conversation_id, title, create_time, update_time, mapping, current_node }]
// `mapping` is a tree of message nodes; the conversation the user saw is the path from
// `current_node` back to the root (other branches are regenerated answers they moved past).

function chatgptPart(p) {
  if (typeof p === 'string') return p;
  if (p && typeof p === 'object') return text(p.text) || text(p.content) || '';
  return '';
}

function chatgptText(message) {
  const c = message?.content;
  if (!c) return '';
  if (Array.isArray(c.parts)) return c.parts.map(chatgptPart).join('').trim();
  if (typeof c.text === 'string') return c.text.trim();
  return '';
}

/** The visible thread of a ChatGPT conversation, oldest first. */
export function chatgptMessages(mapping, currentNode) {
  if (!mapping || typeof mapping !== 'object') return [];
  /** @type {any[]} */
  let chain = [];
  if (currentNode && mapping[currentNode]) {
    const seen = new Set();
    let node = mapping[currentNode];
    while (node && !seen.has(node.id ?? node)) {
      seen.add(node.id ?? node);
      chain.push(node);
      node = node.parent ? mapping[node.parent] : null;
    }
    chain.reverse();
  } else {
    // Older exports: walk down from the root, first child each time.
    const root = Object.values(mapping).find((n) => n && !n.parent);
    const seen = new Set();
    let node = root;
    while (node && !seen.has(node.id)) {
      seen.add(node.id);
      chain.push(node);
      const next = Array.isArray(node.children) ? node.children[node.children.length - 1] : null;
      node = next ? mapping[next] : null;
    }
  }
  /** @type {Message[]} */
  const out = [];
  for (const node of chain) {
    const role = node?.message?.author?.role;
    if (role !== 'user' && role !== 'assistant') continue;
    // Hidden system-ish messages (tool calls, memory updates) carry this flag.
    if (node.message?.metadata?.is_visually_hidden_from_conversation) continue;
    const content = chatgptText(node.message);
    if (!content) continue;
    const last = out[out.length - 1];
    // An answer streamed in several parts reads as one message.
    if (last && last.role === role && role === 'assistant') last.content += `\n\n${content}`;
    else out.push({ role, content });
  }
  return out;
}

export const isChatgptExport = (data) => Array.isArray(data) && data.some((c) => c && typeof c === 'object' && 'mapping' in c);

/** @returns {Chat[]} */
export function fromChatgpt(data) {
  return data
    .filter((c) => c && typeof c === 'object' && c.mapping)
    .map((c) => {
      const messages = chatgptMessages(c.mapping, c.current_node);
      const sourceId = text(c.conversation_id) || text(c.id);
      return {
        id: `chatgpt:${sourceId}`,
        platform: 'chatgpt',
        title: titleFor(c.title, messages),
        date: iso(c.create_time) ?? iso(c.update_time) ?? new Date(0).toISOString(),
        updated: iso(c.update_time),
        tags: [],
        messages,
        sourceId,
      };
    })
    .filter((c) => c.sourceId && c.messages.length > 0)
    .map(({ sourceId: _s, ...chat }) => chat);
}

// ── Claude ───────────────────────────────────────────────────────────────
// conversations.json: [{ uuid, name, created_at, updated_at, chat_messages: [{ sender, text, content }] }]
// `content` is a list of blocks (text, tool use, thinking...); its text blocks are the message.
// A conversation saved from claude.ai's own API (…/chat_conversations/<uuid>?tree=True) has the
// same shape, as one object or a list, with `parent_message_uuid` on each message and
// `current_leaf_message_uuid` on the conversation: the whole tree, every retried or edited branch
// included. The site shows one branch at a time; the rest are kept here after it.

/** Opens each branch that a Retry or an edit hid on claude.ai. */
export const CLAUDE_HIDDEN_BRANCH = '[Earlier version, hidden on claude.ai by a retry or an edit. Kept by ChatAtlas.]';

function claudeText(m) {
  if (Array.isArray(m?.content)) {
    const parts = m.content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text);
    if (parts.length) return parts.join('\n\n').trim();
  }
  return text(m?.text).trim();
}

/** @returns {Message[]} */
function claudeTurns(list) {
  return list
    .filter((m) => m && (m.sender === 'human' || m.sender === 'assistant'))
    .map((m) => ({ role: m.sender === 'human' ? 'user' : 'assistant', content: claudeText(m) }))
    .filter((m) => m.content);
}

/**
 * A conversation's turns: the branch on screen first, in reading order, then each branch the
 * person retried or edited away, newest first, each opening with CLAUDE_HIDDEN_BRANCH and holding
 * only the turns no branch above already has. Without parent links (a data export), array order.
 * @returns {Message[]}
 */
export function claudeMessages(c) {
  const all = c.chat_messages.filter((m) => m && typeof m === 'object');
  const byId = new Map(all.filter((m) => text(m.uuid)).map((m) => [m.uuid, m]));
  if (!all.some((m) => text(m.parent_message_uuid) && byId.has(m.parent_message_uuid))) return claudeTurns(all);

  const pathTo = (leaf) => {
    const path = [];
    const seen = new Set();
    for (let m = leaf; m && !seen.has(m); m = byId.get(text(m.parent_message_uuid))) {
      seen.add(m);
      path.push(m);
    }
    return path.reverse();
  };
  const leaf = byId.get(text(c.current_leaf_message_uuid));
  const current = leaf ? pathTo(leaf) : [...all].sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
  const messages = claudeTurns(current);
  const saved = new Set(current);
  if (saved.size === all.length) return messages;

  const hasChild = new Set(all.map((m) => text(m.parent_message_uuid)));
  const when = (m) => Date.parse(text(m.created_at)) || Number(m.index ?? 0);
  const leaves = all.filter((m) => !hasChild.has(text(m.uuid)) && !saved.has(m)).sort((a, b) => when(b) - when(a));
  for (const end of leaves) {
    const path = pathTo(end).filter((m) => !saved.has(m));
    for (const m of path) saved.add(m);
    const turns = claudeTurns(path);
    if (turns.length === 0) continue;
    turns[0].content = `${CLAUDE_HIDDEN_BRANCH}\n\n${turns[0].content}`;
    messages.push(...turns);
  }
  return messages;
}

const isClaudeChat = (c) => !!c && typeof c === 'object' && Array.isArray(c.chat_messages);

export const isClaudeExport = (data) => isClaudeChat(data) || (Array.isArray(data) && data.some(isClaudeChat));

/** @returns {Chat[]} */
export function fromClaude(data) {
  return (Array.isArray(data) ? data : [data])
    .filter((c) => isClaudeChat(c) && text(c.uuid))
    .map((c) => {
      const messages = claudeMessages(c);
      return {
        id: `claude:${c.uuid}`,
        platform: 'claude',
        title: titleFor(c.name, messages),
        date: iso(c.created_at) ?? iso(c.updated_at) ?? new Date(0).toISOString(),
        updated: iso(c.updated_at),
        tags: [],
        messages,
      };
    })
    .filter((c) => c.messages.length > 0);
}

// ── ChatAtlas backups ────────────────────────────────────────────────────
// Settings → Import / Export → Export all: { source: "ChatAtlas", version: 1, conversations: [...] }

export const isChatAtlasBackup = (data) =>
  !!data && typeof data === 'object' && !Array.isArray(data) && Array.isArray(data.conversations) && (data.source === 'ChatAtlas' || data.version === 1);

/** @returns {Chat[]} */
export function fromChatAtlas(data) {
  return data.conversations
    .filter((c) => c && typeof c === 'object' && text(c.id) && Array.isArray(c.messages))
    .map((c) => {
      /** @type {Message[]} */
      const messages = c.messages
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
        .map((m) => ({ role: m.role, content: text(m.content).trim() }))
        .filter((m) => m.content);
      return {
        // A backup this tool wrote keeps the ids it gave ("chatgpt:…", "claude:…"), so bringing it
        // back in updates those chats instead of doubling them.
        id: /^(chatgpt|claude):/.test(c.id) ? c.id : `chatatlas:${c.id}`,
        platform: text(c.platform).toLowerCase() || 'unknown',
        title: titleFor(c.title, messages),
        date: iso(c.date) ?? iso(c.created_at) ?? new Date(0).toISOString(),
        updated: iso(c.updated_at),
        tags: Array.isArray(c.tags) ? c.tags.filter((t) => typeof t === 'string') : [],
        messages,
      };
    })
    .filter((c) => c.messages.length > 0);
}

/**
 * Chats as a ChatAtlas backup file, the shape ChatAtlas (chatatlas.pro) imports under Settings →
 * Import / Export, and this tool reads back. Chats that came from a ChatAtlas backup keep their
 * old ids.
 */
export function toChatAtlasBackup(chats, { now = new Date().toISOString(), platformFilter = 'all' } = {}) {
  const conversations = chats.map((c) => {
    const first = c.messages.find((m) => m.role === 'user')?.content ?? c.messages[0]?.content ?? '';
    return {
      id: c.id.startsWith('chatatlas:') ? c.id.slice('chatatlas:'.length) : c.id,
      platform: c.platform,
      title: c.title,
      preview: first.replace(/\s+/g, ' ').trim().slice(0, 160),
      date: c.date,
      updated_at: c.updated ?? undefined,
      tags: c.tags ?? [],
      messages: c.messages.map((m) => ({ role: m.role, content: m.content })),
    };
  });
  return { exportedAt: now, source: 'ChatAtlas', version: 1, platformFilter, count: conversations.length, conversations };
}

// ── Files ────────────────────────────────────────────────────────────────

/** Which export a parsed JSON file is, and its chats. */
export function fromJson(data) {
  if (isChatgptExport(data)) return { kind: 'ChatGPT', chats: fromChatgpt(data) };
  if (isClaudeExport(data)) return { kind: 'Claude', chats: fromClaude(data) };
  if (isChatAtlasBackup(data)) return { kind: 'ChatAtlas backup', chats: fromChatAtlas(data) };
  // A Claude project file: { uuid, name, conversations: [{ ...chat_messages }] }
  if (data && typeof data === 'object' && Array.isArray(data.conversations) && isClaudeExport(data.conversations)) {
    return { kind: 'Claude', chats: fromClaude(data.conversations) };
  }
  return null;
}

/** The conversation files inside an export zip: conversations.json, and any conversations-N.json parts. */
export const isConversationsFile = (name) => /(^|\/)conversations(-\d+)?\.json$/i.test(name) && !name.startsWith('__MACOSX');

/**
 * Reads one file: a ChatGPT or Claude export (the .zip they email, or the conversations.json inside
 * it) or a ChatAtlas backup (.json). Answers the kind of export and its chats, or throws with a
 * message the person can act on.
 * @returns {ImportResult}
 */
export function readExport(path) {
  const ext = extname(path).toLowerCase();
  // An export someone already unzipped: its conversations file(s) inside.
  let isDir = false;
  try {
    isDir = statSync(path).isDirectory();
  } catch {
    /* read below says there's no file */
  }
  if (isDir) {
    const inside = readdirSync(path).filter(isConversationsFile).sort();
    if (inside.length === 0) throw new Error(`${path} has no conversations.json in it. Point at the export's .zip, or the folder you unzipped it into.`);
    const results = inside.map((name) => readExport(join(path, name)));
    return { kind: results[0].kind, chats: results.flatMap((r) => r.chats), skipped: results.reduce((n, r) => n + r.skipped, 0) };
  }
  let buf;
  try {
    buf = readFileSync(path);
  } catch (err) {
    throw new Error(err.code === 'ENOENT' ? `There's no file at ${path}.` : `Couldn't read ${path}: ${err.message}`);
  }
  /** @type {{ name: string, data: any }[]} */
  const docs = [];
  if (ext === '.zip' || (buf[0] === 0x50 && buf[1] === 0x4b)) {
    let files;
    try {
      files = unzipSync(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), { filter: (f) => isConversationsFile(f.name) });
    } catch (err) {
      throw new Error(`${basename(path)} isn't a zip file that can be opened (${err.message}).`);
    }
    for (const [name, bytes] of Object.entries(files)) docs.push({ name, data: parseJson(strFromU8(bytes), `${basename(path)} → ${name}`) });
    if (docs.length === 0) throw new Error(`${basename(path)} has no conversations.json inside. Is it a ChatGPT or Claude data export?`);
  } else {
    docs.push({ name: basename(path), data: parseJson(buf.toString('utf8'), basename(path)) });
  }
  /** @type {Chat[]} */
  const chats = [];
  let kind = null;
  for (const doc of docs) {
    const r = fromJson(doc.data);
    if (!r) throw new Error(`${doc.name} isn't a ChatGPT export, a Claude export or a ChatAtlas backup.`);
    kind = kind ?? r.kind;
    chats.push(...r.chats);
  }
  const total = docs.reduce((n, d) => n + (Array.isArray(d.data) ? d.data.length : Array.isArray(d.data?.conversations) ? d.data.conversations.length : 0), 0);
  return { kind, chats, skipped: Math.max(0, total - chats.length) };
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw.replace(/^﻿/, ''));
  } catch (err) {
    throw new Error(`${label} isn't valid JSON (${err.message}).`);
  }
}
