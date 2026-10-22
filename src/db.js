// The archive: one SQLite file on the person's own computer. Node's built-in SQLite (node:sqlite,
// Node 22.13 or newer), so there's nothing to compile or download. Chats are kept whole (their
// messages as JSON) beside a full-text index (FTS5) of their titles and words.

import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** @typedef {import('./importers.js').Chat} Chat */
/**
 * @typedef {object} Row
 * @property {number} n
 * @property {string} id
 * @property {string} platform
 * @property {string} title
 * @property {string} date
 * @property {string | null} updated
 * @property {string[]} tags
 * @property {number} message_count
 * @property {number} words
 * @property {string} imported_at
 */

export const SCHEMA_VERSION = 1;

/** Where the archive lives: --db, else CHATATLAS_LOCAL_DB, else ~/.chatatlas-local/chatatlas.db. */
export function defaultDbPath(env = process.env) {
  // A Claude Desktop extension left unset can pass its placeholder through as written.
  if (env.CHATATLAS_LOCAL_DB && !env.CHATATLAS_LOCAL_DB.includes('${')) return resolve(env.CHATATLAS_LOCAL_DB.replace(/^~(?=$|[\\/])/, homedir()));
  return join(homedir(), '.chatatlas-local', 'chatatlas.db');
}

const SCHEMA = `
  create table if not exists chats (
    n             integer primary key,
    id            text not null unique,
    platform      text not null,
    title         text not null,
    date          text not null,
    updated       text,
    tags          text not null default '[]',
    message_count integer not null,
    words         integer not null default 0,
    messages      text not null,
    hash          text not null,
    imported_at   text not null
  );
  create index if not exists chats_date on chats (date desc);
  create index if not exists chats_platform on chats (platform, date desc);
  create virtual table if not exists chats_fts using fts5(
    title, body,
    content = '',
    contentless_delete = 1,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  create table if not exists imports (
    n         integer primary key,
    at        text not null,
    file      text not null,
    kind      text not null,
    added     integer not null,
    updated   integer not null,
    unchanged integer not null
  );
  create table if not exists seen_files (
    path   text primary key,
    size   integer not null,
    mtime  real not null,
    result text not null,
    at     text not null
  );
`;

/** Words in a piece of text, about as a person would count them. */
export const countWords = (s) => (String(s).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;

/** The words a chat is found by: its title, and everything said in it. */
export const bodyOf = (messages) => messages.map((m) => m.content).join('\n\n');

const hashOf = (chat) =>
  createHash('sha256')
    .update(JSON.stringify([chat.platform, chat.title, chat.date, chat.updated, chat.messages]))
    .digest('hex');

/** @returns {Row} */
function toRow(r) {
  return {
    n: Number(r.n),
    id: r.id,
    platform: r.platform,
    title: r.title,
    date: r.date,
    updated: r.updated ?? null,
    tags: safeJson(r.tags, []),
    message_count: Number(r.message_count),
    words: Number(r.words ?? 0),
    imported_at: r.imported_at,
  };
}

function safeJson(s, fallback) {
  try {
    const v = JSON.parse(s);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Opens (and if need be creates) the archive. `path` ':memory:' is a throwaway one, for tests.
 * `readOnly` opens an existing archive without the right to change it (the MCP server's way).
 */
export function openArchive(path = defaultDbPath(), { readOnly = false } = {}) {
  if (path !== ':memory:' && !readOnly) mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, readOnly ? { readOnly: true } : {});
  if (!readOnly) {
    db.exec('pragma journal_mode = wal; pragma foreign_keys = on;');
    db.exec(SCHEMA);
    const { user_version } = /** @type {any} */ (db.prepare('pragma user_version').get());
    if (Number(user_version) < SCHEMA_VERSION) db.exec(`pragma user_version = ${SCHEMA_VERSION}`);
  }
  return new Archive(db, path);
}

export class Archive {
  /** @param {DatabaseSync} db */
  constructor(db, path) {
    this.db = db;
    this.path = path;
  }

  close() {
    this.db.close();
  }

  /** Runs `fn` inside one transaction: all of it, or none of it. */
  transaction(fn) {
    this.db.exec('begin');
    try {
      const out = fn();
      this.db.exec('commit');
      return out;
    } catch (err) {
      this.db.exec('rollback');
      throw err;
    }
  }

  /**
   * Adds chats, or updates the ones already here (same id) whose words changed. Tags the person
   * added here are kept; tags a backup brings are added to them.
   * @param {Chat[]} chats
   * @returns {{ added: number, updated: number, unchanged: number }}
   */
  upsert(chats, { now = new Date().toISOString() } = {}) {
    const find = this.db.prepare('select n, hash, tags from chats where id = ?');
    const insert = this.db.prepare(
      `insert into chats (id, platform, title, date, updated, tags, message_count, words, messages, hash, imported_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const update = this.db.prepare(
      `update chats set platform = ?, title = ?, date = ?, updated = ?, tags = ?, message_count = ?, words = ?, messages = ?, hash = ?, imported_at = ?
       where n = ?`,
    );
    const ftsInsert = this.db.prepare('insert into chats_fts (rowid, title, body) values (?, ?, ?)');
    const ftsDelete = this.db.prepare('delete from chats_fts where rowid = ?');
    let added = 0;
    let updated = 0;
    let unchanged = 0;
    this.transaction(() => {
      for (const chat of chats) {
        const hash = hashOf(chat);
        const body = bodyOf(chat.messages);
        const words = countWords(body);
        const was = /** @type {any} */ (find.get(chat.id));
        if (!was) {
          const r = insert.run(
            chat.id,
            chat.platform,
            chat.title,
            chat.date,
            chat.updated,
            JSON.stringify(uniq(chat.tags)),
            chat.messages.length,
            words,
            JSON.stringify(chat.messages),
            hash,
            now,
          );
          ftsInsert.run(Number(r.lastInsertRowid), chat.title, body);
          added += 1;
          continue;
        }
        const oldTags = safeJson(was.tags, []);
        const tags = uniq([...oldTags, ...chat.tags]);
        if (was.hash === hash && tags.length === oldTags.length) {
          unchanged += 1;
          continue;
        }
        update.run(
          chat.platform,
          chat.title,
          chat.date,
          chat.updated,
          JSON.stringify(tags),
          chat.messages.length,
          words,
          JSON.stringify(chat.messages),
          hash,
          now,
          was.n,
        );
        ftsDelete.run(was.n);
        ftsInsert.run(was.n, chat.title, body);
        updated += 1;
      }
    });
    return { added, updated, unchanged };
  }

  /** Notes an import in the archive's own history. */
  logImport(file, kind, counts, at = new Date().toISOString()) {
    this.db
      .prepare('insert into imports (at, file, kind, added, updated, unchanged) values (?, ?, ?, ?, ?, ?)')
      .run(at, file, kind, counts.added, counts.updated, counts.unchanged);
  }

  /** Whether the inbox has looked at this file, as it is now (same size and time). */
  seenFile(path, size, mtime) {
    const r = /** @type {any} */ (this.db.prepare('select size, mtime from seen_files where path = ?').get(path));
    return !!r && Number(r.size) === size && Number(r.mtime) === mtime;
  }

  /** Notes that the inbox looked at a file, and what came of it ('imported', 'not an export'…). */
  markSeen(path, size, mtime, result, at = new Date().toISOString()) {
    this.db
      .prepare(
        'insert into seen_files (path, size, mtime, result, at) values (?, ?, ?, ?, ?) on conflict(path) do update set size = excluded.size, mtime = excluded.mtime, result = excluded.result, at = excluded.at',
      )
      .run(path, size, mtime, result, at);
  }

  /** The archive's import history, newest first. */
  imports(limit = 20) {
    return /** @type {any[]} */ (this.db.prepare('select * from imports order by n desc limit ?').all(limit));
  }

  /**
   * A chat by its id, or by the start of it (at least 4 characters). Ids look like
   * "chatgpt:6720…" or "claude:3f1b…"; the part after the colon alone works too.
   * @returns {{ chat: (Row & { messages: import('./importers.js').Message[] }) | null, ambiguous: boolean }}
   */
  getChat(ref) {
    const s = String(ref ?? '').trim();
    if (!s) return { chat: null, ambiguous: false };
    const full = /** @type {any} */ (this.db.prepare('select * from chats where id = ?').get(s));
    if (full) return { chat: { ...toRow(full), messages: safeJson(full.messages, []) }, ambiguous: false };
    if (s.length < 4) return { chat: null, ambiguous: false };
    const like = s.replace(/[\\%_]/g, (c) => `\\${c}`);
    const rows = /** @type {any[]} */ (
      this.db.prepare(`select * from chats where id like ? escape '\\' or id like ? escape '\\' limit 2`).all(`${like}%`, `%:${like}%`)
    );
    if (rows.length !== 1) return { chat: null, ambiguous: rows.length > 1 };
    return { chat: { ...toRow(rows[0]), messages: safeJson(rows[0].messages, []) }, ambiguous: false };
  }

  /**
   * Chats newest first, with filters. `since`/`until` are ISO instants (until exclusive).
   * @returns {{ rows: Row[], total: number }}
   */
  list({ platform = null, since = null, until = null, title = null, tag = null, limit = 25, offset = 0 } = {}) {
    const where = [];
    const params = [];
    if (platform) where.push('platform = ?') && params.push(platform);
    if (since) where.push('date >= ?') && params.push(since);
    if (until) where.push('date < ?') && params.push(until);
    if (tag) where.push('exists (select 1 from json_each(chats.tags) where lower(value) = lower(?))') && params.push(tag);
    if (title) {
      for (const w of String(title).toLowerCase().split(/\s+/).filter(Boolean)) {
        where.push(`lower(title) like ? escape '\\'`);
        params.push(`%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      }
    }
    const clause = where.length ? `where ${where.join(' and ')}` : '';
    const total = Number(/** @type {any} */ (this.db.prepare(`select count(*) c from chats ${clause}`).get(...params)).c);
    const rows = /** @type {any[]} */ (
      this.db
        .prepare(
          `select n, id, platform, title, date, updated, tags, message_count, words, imported_at from chats ${clause} order by date desc, n desc limit ? offset ?`,
        )
        .all(...params, limit, offset)
    );
    return { rows: rows.map(toRow), total };
  }

  /**
   * Chats holding every word of `query` (each word also matching longer words it starts:
   * "plan" finds "planning"), title matches first, then newest. Each comes with its messages
   * so the caller can quote the best one.
   */
  search(query, { platform = null, since = null, until = null, tag = null, limit = 10, offset = 0 } = {}) {
    const match = ftsQuery(query);
    if (!match) return { rows: [], total: 0 };
    const where = ['n in (select rowid from chats_fts where chats_fts match ?)'];
    const params = [match];
    if (platform) where.push('platform = ?') && params.push(platform);
    if (since) where.push('date >= ?') && params.push(since);
    if (until) where.push('date < ?') && params.push(until);
    if (tag) where.push('exists (select 1 from json_each(chats.tags) where lower(value) = lower(?))') && params.push(tag);
    const clause = where.join(' and ');
    const total = Number(/** @type {any} */ (this.db.prepare(`select count(*) c from chats where ${clause}`).get(...params)).c);
    const rows = /** @type {any[]} */ (
      this.db
        .prepare(
          `select *, (n in (select rowid from chats_fts where chats_fts match ?)) as in_title
           from chats where ${clause}
           order by in_title desc, date desc, n desc limit ? offset ?`,
        )
        .all(`title : (${match})`, ...params, limit, offset)
    );
    return { rows: rows.map((r) => ({ ...toRow(r), in_title: !!r.in_title, messages: safeJson(r.messages, []) })), total };
  }

  /** Changes a chat's tags (here only: the export it came from never changes). */
  setTags(id, tags) {
    const r = this.db.prepare('update chats set tags = ? where id = ?').run(JSON.stringify(uniq(tags)), id);
    return Number(r.changes) > 0;
  }

  /** Takes chats out of the archive for good. Importing the export again brings them back. */
  forget(ids) {
    const find = this.db.prepare('select n from chats where id = ?');
    const del = this.db.prepare('delete from chats where n = ?');
    const ftsDelete = this.db.prepare('delete from chats_fts where rowid = ?');
    let gone = 0;
    this.transaction(() => {
      for (const id of ids) {
        const row = /** @type {any} */ (find.get(id));
        if (!row) continue;
        del.run(row.n);
        ftsDelete.run(row.n);
        gone += 1;
      }
    });
    return gone;
  }

  /** Every chat, oldest first, a few at a time (for exports). */
  *all({ platform = null, tag = null } = {}) {
    const where = [];
    const params = [];
    if (platform) where.push('platform = ?') && params.push(platform);
    if (tag) where.push('exists (select 1 from json_each(chats.tags) where lower(value) = lower(?))') && params.push(tag);
    const stmt = this.db.prepare(`select * from chats ${where.length ? `where ${where.join(' and ')}` : ''} order by date, n`);
    for (const r of /** @type {Iterable<any>} */ (/** @type {unknown} */ (stmt.iterate(...params)))) yield { ...toRow(r), messages: safeJson(r.messages, []) };
  }

  /** How big the archive is: chats, messages, words, per platform, the first and last dates, tags. */
  stats() {
    const totals = /** @type {any} */ (
      this.db
        .prepare('select count(*) chats, coalesce(sum(message_count),0) messages, coalesce(sum(words),0) words, min(date) first, max(date) last from chats')
        .get()
    );
    const platforms = /** @type {any[]} */ (
      this.db
        .prepare(
          'select platform, count(*) chats, sum(message_count) messages, sum(words) words, min(date) first, max(date) last from chats group by platform order by chats desc',
        )
        .all()
    );
    const tags = /** @type {any[]} */ (
      this.db.prepare(`select lower(value) tag, count(*) chats from chats, json_each(chats.tags) group by lower(value) order by chats desc, tag limit 50`).all()
    );
    const months = /** @type {any[]} */ (this.db.prepare(`select substr(date, 1, 7) month, count(*) chats from chats group by month order by month`).all());
    return {
      chats: Number(totals.chats),
      messages: Number(totals.messages),
      words: Number(totals.words),
      first: totals.first,
      last: totals.last,
      platforms: platforms.map((p) => ({ ...p, chats: Number(p.chats), messages: Number(p.messages), words: Number(p.words) })),
      tags: tags.map((t) => ({ tag: t.tag, chats: Number(t.chats) })),
      months: months.map((m) => ({ month: m.month, chats: Number(m.chats) })),
    };
  }
}

const uniq = (tags) => {
  const seen = new Set();
  const out = [];
  for (const t of tags ?? []) {
    const s = String(t).trim();
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
    }
  }
  return out;
};

/**
 * A person's search as an FTS5 query: every word must be there, each matching words it starts
 * ("plan" finds "planning"), split the way the index splits words. Null when there's nothing to
 * look for.
 */
export function ftsQuery(query) {
  const words = searchWords(query);
  if (words.length === 0) return null;
  return words.map((w) => `"${w.replace(/"/g, '""')}"*`).join(' AND ');
}

/** The words of a search, lowercased and without accents, the way the index reads text. */
export function searchWords(query) {
  return fold(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 32);
}

/** Lowercased, accents taken off (é → e), as the index compares words. */
export const fold = (s) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
