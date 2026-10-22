// What each MCP tool does, given the archive. The answers are plain text written for the assistant
// to read. Everything here only reads: an assistant can't change, tag or delete a chat.

import { searchWords } from './db.js';
import { bestMessage, chatLine, chatPage, chatRef, clampInt, dayLabel, parseDate, platformName, plural, snippet, speaker, squash, weekOf } from './format.js';

/** @typedef {{ content: { type: 'text', text: string }[], isError?: boolean }} ToolResult */

export const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

const dateProblem = (field, value) => text(`I couldn't read ${field} "${value}" as a date. Use a form like 2026-08-15, 2026-08 or 2026.`, true);

/** The filters every tool shares, read from its arguments, or a tool error. */
function filters(args) {
  const since = parseDate(args.since);
  if (since === null) return { error: dateProblem('since', args.since) };
  const until = parseDate(args.until, true);
  if (until === null) return { error: dateProblem('until', args.until) };
  const platform = typeof args.platform === 'string' && args.platform.trim() ? args.platform.trim().toLowerCase() : null;
  const tag = typeof args.tag === 'string' && args.tag.trim() ? args.tag.trim() : null;
  const where = [platform && platformName(platform), tag && `tagged ${tag}`, args.since && `from ${args.since}`, args.until && `through ${args.until}`]
    .filter(Boolean)
    .join(', ');
  return { since, until, platform, tag, where };
}

/** search_chats */
export function searchChats(archive, args) {
  const query = squash(args.query);
  const words = searchWords(query);
  if (words.length === 0) return text('Give search_chats a word or two to look for.', true);
  const f = filters(args);
  if (f.error) return f.error;
  const limit = clampInt(args.limit, 1, 25, 10);
  const { rows, total } = archive.search(query, { ...f, limit });
  if (rows.length === 0) {
    return text(
      `No saved chats hold every word of “${query}”${f.where ? ` (${f.where})` : ''}. Try fewer or different words; each word also finds longer words it starts.`,
    );
  }
  const lines = rows.map((r) => {
    const best = bestMessage(r.messages, words);
    const quote = best
      ? `\n  message ${best.index + 1} (${speaker(best.role, r.platform)}): ${snippet(best.content, words)}`
      : '\n  (the words are in the title)';
    return `${chatLine(r)}${quote}`;
  });
  const more =
    total > rows.length
      ? `\n\n${total} chats match; showing the first ${rows.length}. Narrow it with platform, tag, since or until, or raise limit (up to 25).`
      : '';
  return text(
    `${plural(rows.length, 'chat')} for “${query}”${f.where ? ` (${f.where})` : ''}, title matches first, then newest:\n\n${lines.join('\n\n')}${more}`,
  );
}

/** list_chats */
export function listChats(archive, args) {
  const f = filters(args);
  if (f.error) return f.error;
  const limit = clampInt(args.limit, 1, 100, 25);
  const offset = clampInt(args.offset, 0, 10_000_000, 0);
  const title = typeof args.title === 'string' && squash(args.title) ? squash(args.title) : null;
  const { rows, total } = archive.list({ ...f, title, limit, offset });
  if (rows.length === 0) return text(offset ? 'No more chats.' : 'No saved chats match that.');
  const tail = offset + rows.length < total ? `\n\n${total} chats match. Next page: offset ${offset + limit}.` : '';
  return text(`Chats ${offset + 1}–${offset + rows.length} of ${total}, newest first:\n\n${rows.map(chatLine).join('\n')}${tail}`);
}

/** read_chat */
export function readChat(archive, args) {
  const ref = chatRef(args.chat);
  if (!ref) return text('Give read_chat a chat id from search_chats or list_chats.', true);
  const { chat: c, ambiguous } = archive.getChat(ref);
  if (ambiguous) return text(`More than one chat's id starts with ${ref}. Give more of the id.`, true);
  if (!c) return text(`There's no saved chat with the id ${ref}. Find it with search_chats or list_chats.`, true);
  const from = clampInt(args.from_message, 1, 1_000_000, 1);
  const part = clampInt(args.part, 1, 10_000, 1);
  const page = chatPage(c.messages, from, part, c.platform);
  const head = `“${squash(c.title) || 'Untitled'}” · ${platformName(c.platform)} · ${dayLabel(c.date)} · ${plural(page.total, 'message')}${c.tags.length ? ` · tags: ${c.tags.join(', ')}` : ''}\n[chat ${c.id}]`;
  const at = page.total ? `Messages ${page.shown[0]}–${page.shown[1]} of ${page.total}.` : '';
  const next = page.next
    ? ` Read on with from_message ${page.next.from_message}${page.next.part ? ` and part ${page.next.part}` : ''}.`
    : page.total
      ? ' That is the end of the chat.'
      : '';
  return text(`${head}\n\n${page.body}\n\n${at}${next}`);
}

/** recent_topics */
export function recentTopics(archive, args, now = new Date()) {
  const days = clampInt(args.days, 1, 3650, 30);
  const platform = typeof args.platform === 'string' && args.platform.trim() ? args.platform.trim().toLowerCase() : null;
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const { rows, total } = archive.list({ platform, since, limit: 500 });
  if (rows.length === 0) {
    const s = archive.stats();
    const last = s.last ? ` The newest saved chat is from ${dayLabel(s.last)}; the archive only knows what was in the exports imported into it.` : '';
    return text(`No saved chats from the last ${days} days.${last}`);
  }
  const perPlatform = new Map();
  const perTag = new Map();
  for (const r of rows) {
    perPlatform.set(r.platform, (perPlatform.get(r.platform) ?? 0) + 1);
    for (const t of r.tags) perTag.set(t, (perTag.get(t) ?? 0) + 1);
  }
  const platforms = [...perPlatform]
    .sort((a, b) => b[1] - a[1])
    .map(([p, n]) => `${platformName(p)} ${n}`)
    .join(', ');
  const tags = [...perTag]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 15)
    .map(([t, n]) => `${t} (${n})`)
    .join(', ');
  const SHOWN = 80;
  const weeks = new Map();
  for (const r of rows.slice(0, SHOWN)) {
    const w = weekOf(r.date);
    if (!weeks.has(w)) weeks.set(w, []);
    weeks.get(w).push(`- ${squash(r.title) || 'Untitled'} (${platformName(r.platform)}) [chat ${r.id}]`);
  }
  const body = [...weeks].map(([w, list]) => `Week of ${w}:\n${list.join('\n')}`).join('\n\n');
  const cut = total > SHOWN ? `\n\n(The newest ${SHOWN} titles are shown; list_chats pages through the rest.)` : '';
  return text(
    `The last ${days} days: ${plural(total, 'chat')}. By platform: ${platforms}.${tags ? `\nTags that come up most: ${tags}.` : ''}\n\n${body}${cut}`,
  );
}

/** "Aug 1, 2025 to Oct 1, 2026", or one date when they're the same day. */
const span = (first, last, lead = '') =>
  dayLabel(first) === dayLabel(last) ? `${lead ? 'on ' : ''}${dayLabel(first)}` : `${lead}${dayLabel(first)} to ${dayLabel(last)}`;

/** archive_overview */
export function archiveOverview(archive) {
  const s = archive.stats();
  if (s.chats === 0) {
    return text(
      "The archive is empty. The user brings chats in by saving their ChatGPT or Claude data export (.zip) in the exports folder set in ChatAtlas Local's settings, or with `chatatlas-local import <the export .zip>` in a terminal.",
    );
  }
  const per = s.platforms
    .map((p) => `- ${platformName(p.platform)}: ${plural(p.chats, 'chat')}, ${plural(p.words, 'word')}, ${span(p.first, p.last)}`)
    .join('\n');
  const tags = s.tags.length
    ? `\nTags: ${s.tags
        .slice(0, 20)
        .map((t) => `${t.tag} (${t.chats})`)
        .join(', ')}.`
    : '';
  const last = archive.imports(1)[0];
  const imported = last ? `\nLast import: ${dayLabel(last.at)} (${last.kind}). Chats newer than the last export the user imported aren't here.` : '';
  return text(
    `${plural(s.chats, 'chat')}, ${plural(s.messages, 'message')}, ${plural(s.words, 'word')}, ${span(s.first, s.last, 'from ')}.\n\n${per}${tags}${imported}`,
  );
}

/** Runs a tool by name. */
export function runTool(archive, name, args = {}) {
  switch (name) {
    case 'search_chats':
      return searchChats(archive, args);
    case 'list_chats':
      return listChats(archive, args);
    case 'read_chat':
      return readChat(archive, args);
    case 'recent_topics':
      return recentTopics(archive, args);
    case 'archive_overview':
      return archiveOverview(archive);
    default:
      return text(`There's no tool called ${name}.`, true);
  }
}
