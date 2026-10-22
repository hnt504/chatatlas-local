// Small, pure helpers for showing chats as text: dates, snippets, pages of a conversation. Shared
// by the MCP tools, the command line and the browser view.

import { fold } from './db.js';

export const PLATFORM_NAMES = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
  grok: 'Grok',
  perplexity: 'Perplexity',
  deepseek: 'DeepSeek',
  meta: 'Meta AI',
  copilot: 'Copilot',
  mistral: 'Mistral',
};
export const platformName = (p) => PLATFORM_NAMES[p] ?? (p ? String(p) : 'Unknown');

/** How many characters of a chat one page holds. */
export const PAGE_CHARS = 12_000;
/** How long a quoted snippet is, about. */
export const SNIPPET_CHARS = 280;

export const squash = (s) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();

export const clampInt = (v, lo, hi, dflt) => {
  const n = typeof v === 'number' ? Math.trunc(v) : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

/**
 * A date the person gave ("2026", "2026-08", "2026-08-15", or anything Date can read) as an ISO
 * instant. With `end`, the instant just after it (so "until 2026-08" includes all of August).
 * Null when it isn't a date; undefined when nothing was given.
 */
export function parseDate(value, end = false) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') return null;
  const s = value.trim();
  let m;
  if ((m = s.match(/^(\d{4})$/))) {
    const y = Number(m[1]);
    return new Date(Date.UTC(end ? y + 1 : y, 0, 1)).toISOString();
  }
  if ((m = s.match(/^(\d{4})-(\d{1,2})$/))) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    if (mo < 0 || mo > 11) return null;
    return new Date(Date.UTC(y, end ? mo + 1 : mo, 1)).toISOString();
  }
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + (end ? 1 : 0)));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** A date as "Aug 12, 2026". */
export function dayLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'an unknown date';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Lowercased with accents off, keeping every character's place (so a match found in it is at the
 * same place in the original). Characters that fold to more than one are left as they are.
 */
export function foldInPlace(s) {
  const lower = String(s ?? '').toLowerCase();
  if (lower.length !== String(s ?? '').length) return String(s ?? '');
  return lower.replace(/[À-ɏḀ-ỿ]/g, (c) => {
    const f = fold(c);
    return f.length === 1 ? f : c;
  });
}

/** How many of `words` a piece of text holds. */
export function wordsIn(content, words) {
  const t = foldInPlace(content);
  let n = 0;
  for (const w of words) if (t.includes(w)) n += 1;
  return n;
}

/** The message holding the most of the search's words (the first of them, on a tie), or null. */
export function bestMessage(messages, words) {
  let best = null;
  let score = 0;
  messages.forEach((m, i) => {
    const s = wordsIn(m.content, words);
    if (s > score) {
      best = { index: i, role: m.role, content: m.content };
      score = s;
    }
  });
  return best;
}

/** A stretch of `content` around the first of `words` it holds, cut at word edges, with … where it was cut. */
export function snippet(content, words, size = SNIPPET_CHARS) {
  const flat = squash(content);
  if (flat.length <= size) return flat;
  const lower = foldInPlace(flat);
  let at = -1;
  for (const w of words) {
    const i = lower.indexOf(w);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  let start = at === -1 ? 0 : Math.max(0, at - Math.floor(size / 3));
  let stop = Math.min(flat.length, start + size);
  if (stop - start < size) start = Math.max(0, stop - size);
  if (start > 0) {
    const sp = flat.indexOf(' ', start);
    if (sp !== -1 && sp < start + 30) start = sp + 1;
  }
  if (stop < flat.length) {
    const sp = flat.lastIndexOf(' ', stop);
    if (sp > stop - 30) stop = sp;
  }
  return `${start > 0 ? '…' : ''}${flat.slice(start, stop)}${stop < flat.length ? '…' : ''}`;
}

/** Who said a message: the person, or the platform. */
export const speaker = (role, platform) => (role === 'user' ? 'You' : role === 'assistant' ? platformName(platform) : squash(role) || 'Unknown');

/** A chat's id as a person or assistant wrote it ("[chat abc]", quotes, spaces), or null. */
export function chatRef(value) {
  if (typeof value !== 'string') return null;
  const s = value
    .trim()
    .replace(/^\[?\s*chat\s+/i, '')
    .replace(/\]$/, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();
  if (!s || /\s/.test(s)) return null;
  return s;
}

/** One chat as a line: id, platform, date, title, size, tags. */
export function chatLine(c) {
  const count = typeof c.message_count === 'number' ? ` (${c.message_count} message${c.message_count === 1 ? '' : 's'})` : '';
  const tags = Array.isArray(c.tags) && c.tags.length ? ` · tags: ${c.tags.join(', ')}` : '';
  return `[chat ${c.id}] ${platformName(c.platform)} · ${dayLabel(c.date)} · “${squash(c.title) || 'Untitled'}”${count}${tags}`;
}

/**
 * One page of a chat from message `from` (1-based), up to `pageChars`. A message longer than a
 * page on its own comes in parts. Answers the text and where to carry on.
 */
export function chatPage(messages, from = 1, part = 1, platform, pageChars = PAGE_CHARS) {
  const list = Array.isArray(messages) ? messages : [];
  const total = list.length;
  if (total === 0) return { body: '(This chat has no messages saved.)', next: null, shown: [0, 0], total };
  const start = Math.min(Math.max(1, from), total);
  const out = [];
  let used = 0;
  let i = start;
  let next = null;
  while (i <= total) {
    const m = list[i - 1] ?? {};
    const content = String(m.content ?? '');
    const head = `[${i}] ${speaker(m.role, platform)}:`;
    if (i === start && content.length > pageChars) {
      const parts = Math.ceil(content.length / pageChars);
      const p = Math.min(Math.max(1, part), parts);
      out.push(`${head} (part ${p} of ${parts})\n${content.slice((p - 1) * pageChars, p * pageChars)}`);
      next = p < parts ? { from_message: i, part: p + 1 } : i < total ? { from_message: i + 1 } : null;
      return { body: out.join('\n\n'), next, shown: [i, i], total };
    }
    if (out.length > 0 && used + content.length > pageChars) {
      next = { from_message: i };
      break;
    }
    out.push(`${head}\n${content}`);
    used += content.length;
    i += 1;
  }
  return { body: out.join('\n\n'), next, shown: [start, i - 1], total };
}

/** Monday of the week a date falls in, as "Oct 13, 2026". */
export function weekOf(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown week';
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
  return dayLabel(monday.toISOString());
}

/** A count with its noun: "1 chat", "3 chats", "1,204 words". */
export const plural = (n, word, many = `${word}s`) => `${Number(n).toLocaleString('en-US')} ${n === 1 ? word : many}`;

/** A chat as Markdown: a heading, its details, then each message under who said it. */
export function chatMarkdown(c) {
  const lines = [
    `# ${squash(c.title) || 'Untitled'}`,
    '',
    `- Platform: ${platformName(c.platform)}`,
    `- Date: ${dayLabel(c.date)}${c.updated && dayLabel(c.updated) !== dayLabel(c.date) ? ` (last message ${dayLabel(c.updated)})` : ''}`,
    `- Id: ${c.id}`,
  ];
  if (c.tags?.length) lines.push(`- Tags: ${c.tags.join(', ')}`);
  for (const m of c.messages ?? []) lines.push('', `## ${speaker(m.role, c.platform)}`, '', String(m.content ?? '').trim());
  return `${lines.join('\n')}\n`;
}

/** A file name from a chat's date and title: "2026-08-12 Planning the garden.md". */
export function fileNameFor(c, ext = 'md') {
  const day = String(c.date ?? '').slice(0, 10) || 'undated';
  const title = squash(c.title)
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim();
  return `${day} ${title || 'Untitled'}.${ext}`;
}
