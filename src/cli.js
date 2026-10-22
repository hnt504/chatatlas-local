// The command line: `chatatlas-local <command>`. Every command works on the archive file on this
// computer; none of them talk to the network.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from './args.js';
import { defaultDbPath, openArchive, searchWords } from './db.js';
import { readExport, toChatAtlasBackup } from './importers.js';
import { bestMessage, chatLine, chatMarkdown, clampInt, dayLabel, fileNameFor, parseDate, platformName, plural, snippet, speaker } from './format.js';
import { recentTopics } from './tools.js';
import { serveStdio } from './stdio.js';
import { MCP_SERVER } from './protocol.js';
import { SERVER_NAME, claudeCodeCommand, clients, installSkill, isNpxCopy, serverEntry, shellLine, skillsDir, snippetFor, writeClient } from './setup.js';
import { openInBrowser, startViewer } from './viewer.js';
import { watchInbox } from './inbox.js';

const FLAGS = ['help', 'version', 'json', 'md', 'yes', 'write', 'remove', 'browser', 'readOnly', 'all'];

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = paint('1');
const dim = paint('2');
const green = paint('32');
const red = paint('31');
const yellow = paint('33');

class Problem extends Error {}

const HELP = `${bold('ChatAtlas Local')} ${dim(`v${MCP_SERVER.version}`)}
Your ChatGPT and Claude chats, searchable on your own computer. Nothing leaves it.

${bold('Bring chats in')}
  import <file...>        A ChatGPT or Claude data export (the .zip, its conversations.json,
                          or the folder you unzipped), or a ChatAtlas backup (.json).
                          Run it again with a newer export: new chats come in, changed ones update.

${bold('Find and read')}
  search <words...>       Chats holding every word, title matches first.
  list                    Chats, newest first.
  show <id>               Read one chat (--md for Markdown, --json for the data).
  topics                  What you talked about lately, week by week (--days 30).
  stats                   What the archive holds.
  open                    Browse and search everything in your browser (served from this
                          computer only; --port, --no-browser, --read-only).

${bold('Connect an assistant')}
  setup                   How to connect Claude Desktop, Claude Code, Cursor, VS Code,
                          Windsurf, Gemini CLI and Codex.
  setup <client> --write  Write it into that app's settings for you (a copy of the old
                          file is kept). Add --inbox <folder> and the app also brings in
                          exports you save there. Clients: ${clients()
                            .map((c) => c.id)
                            .join(', ')}.
  skill                   Install the Claude Code skill (so Claude knows to look here).
  mcp                     The MCP server itself. Assistants start this; you don't need to.
                          (--inbox <folder> also brings in exports dropped there.)

${bold('Look after it')}
  tag <id> <tag...>       Tag a chat (--remove to take tags off).
  forget <id...>          Take chats out of the archive (--yes to skip the question).
  export <folder>         Every chat as a Markdown file (--format md), or one ChatAtlas
                          backup file (--format chatatlas) that ChatAtlas Pro imports.
  watch <folder>          Bring in every export in a folder (your Downloads, say), then keep
                          watching it for new ones until you press Ctrl+C.
  doctor                  Check that everything's in order.
  where                   Where the archive file is.

${bold('Filters')} (search, list, export, topics)
  --platform chatgpt|claude|…   --tag <tag>   --since 2025-03   --until 2026   --title <words>
  --limit <n>   --offset <n>   --json

${bold('Everywhere')}
  --db <file>             Use another archive file (or set CHATATLAS_LOCAL_DB).
                          This one: ${defaultDbPath()}
`;

/** Runs the command line. Answers the exit code. */
export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv, { flags: FLAGS, short: { h: 'help', v: 'version', y: 'yes' } });
  const [cmd, ...rest] = args._;
  if (args.version) return (say(MCP_SERVER.version), 0);
  if (!cmd || args.help || cmd === 'help') return (say(HELP), 0);
  const dbPath = args.db ? resolve(String(args.db)) : defaultDbPath();
  try {
    switch (cmd) {
      case 'import':
        return cmdImport(dbPath, rest, args);
      case 'search':
        return cmdSearch(dbPath, rest, args);
      case 'list':
      case 'ls':
        return cmdList(dbPath, args);
      case 'show':
      case 'read':
        return cmdShow(dbPath, rest, args);
      case 'topics':
        return cmdTopics(dbPath, args);
      case 'stats':
        return cmdStats(dbPath, args);
      case 'tag':
        return cmdTag(dbPath, rest, args);
      case 'forget':
        return await cmdForget(dbPath, rest, args);
      case 'export':
        return cmdExport(dbPath, rest, args);
      case 'open':
      case 'ui':
        return await cmdOpen(dbPath, args);
      case 'mcp':
      case 'serve':
        return await cmdMcp(dbPath, args);
      case 'watch':
        return await cmdWatch(dbPath, rest);
      case 'setup':
        return cmdSetup(dbPath, rest, args);
      case 'skill':
        return cmdSkill();
      case 'doctor':
        return cmdDoctor(dbPath);
      case 'where':
        say(dbPath);
        return 0;
      default:
        throw new Problem(`There's no command called "${cmd}". chatatlas-local --help lists them.`);
    }
  } catch (err) {
    if (err instanceof Problem) {
      process.stderr.write(`${red('✗')} ${err.message}\n`);
      return 1;
    }
    throw err;
  }
}

function say(s = '') {
  process.stdout.write(`${s}\n`);
}

/** Opens the archive; for commands that only read, says so plainly when there's nothing yet. */
function archiveAt(dbPath, { mustExist = false } = {}) {
  if (mustExist && dbPath !== ':memory:' && !existsSync(dbPath)) {
    throw new Problem(`There's no archive yet at ${dbPath}. Bring chats in first: chatatlas-local import <your export .zip>`);
  }
  return openArchive(dbPath);
}

/** The filters as the archive takes them, from --platform, --tag, --since, --until. */
function filtersFrom(args) {
  const since = parseDate(args.since);
  if (since === null) throw new Problem(`--since "${args.since}" isn't a date. Use 2026-08-15, 2026-08 or 2026.`);
  const until = parseDate(args.until, true);
  if (until === null) throw new Problem(`--until "${args.until}" isn't a date. Use 2026-08-31, 2026-08 or 2026.`);
  return {
    platform: typeof args.platform === 'string' ? args.platform.toLowerCase() : null,
    tag: typeof args.tag === 'string' ? args.tag : null,
    since: since ?? null,
    until: until ?? null,
  };
}

function cmdImport(dbPath, files, args) {
  if (files.length === 0) {
    throw new Problem(
      'Which export? chatatlas-local import ~/Downloads/<your export>.zip\n  ChatGPT: Settings → Data controls → Export data.  Claude: Settings → Privacy → Export data.\n  Both email you a link to a .zip.',
    );
  }
  const archive = archiveAt(dbPath);
  let failed = 0;
  const totals = { added: 0, updated: 0, unchanged: 0 };
  try {
    for (const file of files) {
      let result;
      try {
        result = readExport(file);
      } catch (err) {
        process.stderr.write(`${red('✗')} ${err.message}\n`);
        failed += 1;
        continue;
      }
      const counts = archive.upsert(result.chats);
      archive.logImport(resolve(file), result.kind, counts);
      for (const k of Object.keys(totals)) totals[k] += counts[k];
      const parts = [
        counts.added && `${counts.added.toLocaleString('en-US')} new`,
        counts.updated && `${counts.updated.toLocaleString('en-US')} updated`,
        counts.unchanged && `${counts.unchanged.toLocaleString('en-US')} already here`,
      ].filter(Boolean);
      const skipped = result.skipped ? dim(` (${plural(result.skipped, 'empty chat')} left out)`) : '';
      say(`${green('✓')} ${basename(file)}: ${result.kind}, ${plural(result.chats.length, 'chat')}${parts.length ? ` (${parts.join(', ')})` : ''}${skipped}`);
    }
    if (args.json) say(JSON.stringify({ ...totals, failed }));
    if (files.length > 1 || failed)
      say(
        dim(
          `In all: ${totals.added} new, ${totals.updated} updated, ${totals.unchanged} already here${failed ? `, ${failed} file${failed === 1 ? '' : 's'} not read` : ''}.`,
        ),
      );
    if (totals.added + totals.updated > 0) {
      const s = archive.stats();
      say(dim(`The archive holds ${plural(s.chats, 'chat')} now. Try: chatatlas-local search <words>, or chatatlas-local open`));
    }
  } finally {
    archive.close();
  }
  return failed ? 1 : 0;
}

function cmdSearch(dbPath, words, args) {
  const query = words.join(' ').trim();
  if (searchWords(query).length === 0) throw new Problem('Search for what? chatatlas-local search <words>');
  const archive = archiveAt(dbPath, { mustExist: true });
  try {
    const limit = clampInt(args.limit, 1, 1000, 20);
    const offset = clampInt(args.offset, 0, 10_000_000, 0);
    const { rows, total } = archive.search(query, { ...filtersFrom(args), limit, offset });
    const terms = searchWords(query);
    if (args.json) {
      say(JSON.stringify({ total, chats: rows.map(({ messages, ...r }) => ({ ...r, hit: hitOf(messages, terms, r.platform) })) }, null, 2));
      return 0;
    }
    if (rows.length === 0) {
      say(`No chats hold every word of “${query}”.`);
      return 0;
    }
    for (const r of rows) {
      say(`${bold(r.title || 'Untitled')}  ${dim(`${platformName(r.platform)} · ${dayLabel(r.date)} · ${r.id}`)}`);
      const hit = hitOf(r.messages, terms, r.platform);
      if (hit) say(`  ${dim(`${hit.message}. ${hit.who}:`)} ${highlight(hit.text, terms)}`);
      say();
    }
    const more = offset + rows.length < total ? ` (--offset ${offset + rows.length} for more)` : '';
    say(dim(`${plural(total, 'chat')} with “${query}”, showing ${offset + 1}–${offset + rows.length}${more}. Read one: chatatlas-local show <id>`));
    return 0;
  } finally {
    archive.close();
  }
}

const hitOf = (messages, terms, platform) => {
  const best = bestMessage(messages, terms);
  return best ? { message: best.index + 1, who: speaker(best.role, platform), role: best.role, text: snippet(best.content, terms, 220) } : null;
};

function highlight(s, terms) {
  if (!tty || !terms.length) return s;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return s.replace(re, (m) => yellow(m));
}

function cmdList(dbPath, args) {
  const archive = archiveAt(dbPath, { mustExist: true });
  try {
    const limit = clampInt(args.limit, 1, 10_000, 25);
    const offset = clampInt(args.offset, 0, 10_000_000, 0);
    const title = typeof args.title === 'string' ? args.title : null;
    const { rows, total } = archive.list({ ...filtersFrom(args), title, limit, offset });
    if (args.json) return (say(JSON.stringify({ total, chats: rows }, null, 2)), 0);
    if (rows.length === 0) return (say(offset ? 'No more chats.' : 'No chats match.'), 0);
    for (const r of rows)
      say(
        `${dim(String(r.date).slice(0, 10))}  ${dim(platformName(r.platform).padEnd(8))}  ${r.title || 'Untitled'}  ${dim(r.id)}${r.tags.length ? `  ${yellow(r.tags.join(', '))}` : ''}`,
      );
    const more = offset + rows.length < total ? ` (--offset ${offset + rows.length} for more)` : '';
    say(dim(`\n${offset + 1}–${offset + rows.length} of ${plural(total, 'chat')}${more}.`));
    return 0;
  } finally {
    archive.close();
  }
}

function findChat(archive, ref) {
  if (!ref) throw new Problem('Which chat? Give its id (from search or list); the start of it is enough.');
  const { chat, ambiguous } = archive.getChat(ref);
  if (ambiguous) throw new Problem(`More than one chat's id starts with ${ref}. Give more of it.`);
  if (!chat) throw new Problem(`There's no chat with the id ${ref}.`);
  return chat;
}

function cmdShow(dbPath, rest, args) {
  const [ref] = rest;
  const archive = archiveAt(dbPath, { mustExist: true });
  try {
    const c = findChat(archive, ref);
    if (args.json) return (say(JSON.stringify(c, null, 2)), 0);
    if (args.md) return (process.stdout.write(chatMarkdown(c)), 0);
    say(
      `${bold(c.title || 'Untitled')}\n${dim(`${platformName(c.platform)} · ${dayLabel(c.date)} · ${plural(c.message_count, 'message')} · ${plural(c.words, 'word')} · ${c.id}`)}${c.tags.length ? `\n${yellow(c.tags.join(', '))}` : ''}\n`,
    );
    const from = clampInt(args.from, 1, 1_000_000, 1);
    c.messages.forEach((m, i) => {
      if (i + 1 < from) return;
      say(`${bold(`[${i + 1}] ${speaker(m.role, c.platform)}`)}\n${m.content}\n`);
    });
    return 0;
  } finally {
    archive.close();
  }
}

function cmdTopics(dbPath, args) {
  const archive = archiveAt(dbPath, { mustExist: true });
  try {
    say(recentTopics(archive, { days: args.days, platform: args.platform }).content[0].text);
    return 0;
  } finally {
    archive.close();
  }
}

function cmdStats(dbPath, args) {
  const archive = archiveAt(dbPath, { mustExist: true });
  try {
    const s = archive.stats();
    if (args.json) return (say(JSON.stringify({ ...s, imports: archive.imports(20) }, null, 2)), 0);
    if (s.chats === 0) return (say('The archive is empty. chatatlas-local import <your export .zip> brings chats in.'), 0);
    say(`${bold(plural(s.chats, 'chat'))}, ${plural(s.messages, 'message')}, ${plural(s.words, 'word')}`);
    say(dim(`${dayLabel(s.first)} to ${dayLabel(s.last)}\n`));
    for (const p of s.platforms)
      say(
        `  ${platformName(p.platform).padEnd(12)} ${String(p.chats.toLocaleString('en-US')).padStart(7)} chats  ${dim(`${dayLabel(p.first)} to ${dayLabel(p.last)}`)}`,
      );
    // Chats a month, as a little bar chart (the last 18 months that have any).
    const months = s.months.slice(-18);
    if (months.length > 1) {
      const max = Math.max(...months.map((m) => m.chats));
      say(`\n${bold('Chats a month')}`);
      for (const m of months) say(`  ${m.month}  ${'█'.repeat(Math.max(1, Math.round((m.chats / max) * 32)))} ${dim(String(m.chats))}`);
    }
    if (s.tags.length)
      say(
        `\n${bold('Tags')}  ${s.tags
          .slice(0, 20)
          .map((t) => `${t.tag} ${dim(`(${t.chats})`)}`)
          .join(', ')}`,
      );
    const last = archive.imports(1)[0];
    if (last) say(dim(`\nLast import: ${dayLabel(last.at)}, ${last.kind} (${basename(last.file)})`));
    return 0;
  } finally {
    archive.close();
  }
}

function cmdTag(dbPath, rest, args) {
  const [ref, ...tags] = rest;
  if (!ref || tags.length === 0) throw new Problem('chatatlas-local tag <id> <tag...>   (--remove to take them off)');
  const archive = archiveAt(dbPath, { mustExist: true });
  try {
    const c = findChat(archive, ref);
    const lower = tags.map((t) => t.toLowerCase());
    const next = args.remove ? c.tags.filter((t) => !lower.includes(t.toLowerCase())) : [...c.tags, ...tags];
    archive.setTags(c.id, next);
    const now = archive.getChat(c.id).chat;
    say(`${green('✓')} “${c.title}”: ${now.tags.length ? now.tags.join(', ') : 'no tags'}`);
    return 0;
  } finally {
    archive.close();
  }
}

async function cmdForget(dbPath, refs, args) {
  if (refs.length === 0) throw new Problem('chatatlas-local forget <id...>');
  const archive = archiveAt(dbPath, { mustExist: true });
  try {
    const chats = refs.map((r) => findChat(archive, r));
    for (const c of chats) say(`  ${c.title || 'Untitled'} ${dim(`(${platformName(c.platform)}, ${dayLabel(c.date)})`)}`);
    if (!args.yes) {
      if (!process.stdin.isTTY) throw new Problem('Add --yes to forget them without being asked.');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const a = await rl.question(
        `Take ${chats.length === 1 ? 'this chat' : `these ${chats.length} chats`} out of the archive? Your ChatGPT and Claude accounts aren't touched. [y/N] `,
      );
      rl.close();
      if (!/^y(es)?$/i.test(a.trim())) return (say('Left as they were.'), 0);
    }
    const n = archive.forget(chats.map((c) => c.id));
    say(`${green('✓')} Forgot ${plural(n, 'chat')}. Importing the same export again would bring ${n === 1 ? 'it' : 'them'} back.`);
    return 0;
  } finally {
    archive.close();
  }
}

function cmdExport(dbPath, rest, args) {
  const [folder] = rest;
  if (!folder) throw new Problem('Export where? chatatlas-local export <folder>  (--format md or chatatlas)');
  const format = String(args.format ?? 'md').toLowerCase();
  if (!['md', 'markdown', 'chatatlas', 'json'].includes(format)) throw new Problem('--format is md (a Markdown file per chat) or chatatlas (one backup file).');
  const archive = archiveAt(dbPath, { mustExist: true });
  try {
    const f = filtersFrom(args);
    const keep = (c) => (!f.since || c.date >= f.since) && (!f.until || c.date < f.until);
    const out = resolve(folder);
    mkdirSync(out, { recursive: true });
    if (format === 'chatatlas' || format === 'json') {
      const chats = [...archive.all(f)].filter(keep);
      const file = join(out, `chatatlas-backup-${new Date().toISOString().slice(0, 10)}.json`);
      writeFileSync(file, JSON.stringify(toChatAtlasBackup(chats, { platformFilter: f.platform ?? 'all' })));
      say(`${green('✓')} ${plural(chats.length, 'chat')} → ${file}`);
      say(dim('ChatAtlas (chatatlas.pro) imports this under Settings → Import / Export, and chatatlas-local import reads it back.'));
      return 0;
    }
    const used = new Set();
    let n = 0;
    for (const c of archive.all(f)) {
      if (!keep(c)) continue;
      let name = fileNameFor(c);
      for (let i = 2; used.has(name.toLowerCase()); i += 1) name = fileNameFor(c).replace(/\.md$/, ` (${i}).md`);
      used.add(name.toLowerCase());
      writeFileSync(join(out, name), chatMarkdown(c));
      n += 1;
    }
    say(`${green('✓')} ${plural(n, 'chat')} as Markdown → ${out}`);
    return 0;
  } finally {
    archive.close();
  }
}

async function cmdOpen(dbPath, args) {
  const archive = archiveAt(dbPath);
  const port = clampInt(args.port, 0, 65535, 0);
  const { url, server } = await startViewer(archive, { port, readOnly: !!args.readOnly });
  say(`${bold('ChatAtlas Local')} is open at ${url}`);
  say(dim('It answers on this computer only. Press Ctrl+C to stop it.'));
  if (args.browser !== false && !openInBrowser(url)) say(dim('Open that address in your browser.'));
  await new Promise((done) => {
    const stop = () => {
      server.close();
      archive.close();
      done(undefined);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return 0;
}

async function cmdMcp(dbPath, args) {
  const fromEnv = process.env.CHATATLAS_LOCAL_INBOX;
  const inbox = typeof args.inbox === 'string' && args.inbox ? args.inbox : fromEnv && !fromEnv.includes('${') ? fromEnv : null;
  let archive = null;
  const getArchive = () => (archive ??= openArchive(dbPath));
  /** @type {(() => void) | null} */
  let stop = null;
  let timer = null;
  if (inbox) {
    const log = (m) => process.stderr.write(`[chatatlas-local] inbox: ${m}\n`);
    if (!existsSync(inbox)) log(`${inbox} isn't there, so nothing is watched.`);
    // After the handshake has had its moment: reading a big export takes a few seconds.
    else timer = setTimeout(() => (stop = watchInbox(getArchive(), inbox, { log })), 1500);
  }
  await serveStdio({ getArchive });
  clearTimeout(timer);
  stop?.();
  return 0;
}

async function cmdWatch(dbPath, rest) {
  const [folder] = rest;
  if (!folder) throw new Problem('Watch which folder? chatatlas-local watch ~/Downloads');
  if (!existsSync(folder)) throw new Problem(`There's no folder at ${folder}.`);
  const archive = archiveAt(dbPath);
  say(`${bold('Watching')} ${resolve(folder)} ${dim('for ChatGPT and Claude exports. Press Ctrl+C to stop.')}`);
  const stop = watchInbox(archive, folder, { log: (m) => say(`${green('✓')} ${m}`) });
  say(dim(`The archive holds ${plural(archive.stats().chats, 'chat')}.`));
  await new Promise((done) => {
    const end = () => {
      stop();
      archive.close();
      done(undefined);
    };
    process.once('SIGINT', end);
    process.once('SIGTERM', end);
  });
  return 0;
}

function cmdSetup(dbPath, rest, args) {
  const [which] = rest;
  const db = args.db ? dbPath : null;
  const inbox = typeof args.inbox === 'string' ? args.inbox : null;
  if (inbox && !existsSync(inbox)) throw new Problem(`There's no folder at ${inbox}.`);
  const entry = serverEntry({ db, inbox });
  const all = clients();
  if (!which || which === 'all') {
    if (args.write)
      throw new Problem(
        `Name the app to write: chatatlas-local setup <${all
          .filter((c) => c.kind !== 'command')
          .map((c) => c.id)
          .join('|')}> --write`,
      );
    say(`${bold('Connect an assistant to your archive')}  ${dim(`(it starts: ${shellLine([entry.command, ...entry.args])})`)}\n`);
    if (isNpxCopy())
      say(yellow('This copy runs from npx. Install it for good (npm install -g chatatlas-local) and run setup again, so the apps start the installed copy.\n'));
    for (const c of all) {
      const here = c.file ? (existsSync(c.file) && readFileSync(c.file, 'utf8').includes(`"${SERVER_NAME}"`) ? green(' (connected)') : '') : '';
      say(`${bold(c.name)}${here}${c.file ? dim(`  ${c.file}`) : ''}`);
      say(indent(snippetFor(c, entry)));
      say(
        dim(
          `  ${c.kind === 'command' ? 'Run that, or: chatatlas-local setup claude-code --write' : `Or let this write it: chatatlas-local setup ${c.id} --write`}\n`,
        ),
      );
    }
    say(
      `${bold('ChatGPT')}  ${dim("connects only to servers on the internet, so it can't reach a file on your computer. ChatAtlas Pro (chatatlas.pro) is the online version it can use.")}`,
    );
    say(`\n${bold('Claude Code skill')}  ${dim('chatatlas-local skill  (teaches Claude Code to check your archive when you mention an old chat)')}`);
    return 0;
  }
  const c = all.find((x) => x.id === which.toLowerCase() || x.name.toLowerCase() === which.toLowerCase());
  if (!c) throw new Problem(`There's no app called "${which}" here. These are: ${all.map((x) => x.id).join(', ')}.`);
  if (!args.write) {
    say(`${bold(c.name)}${c.file ? dim(`  ${c.file}`) : ''}\n${indent(snippetFor(c, entry))}\n`);
    say(dim(c.kind === 'command' ? 'Run that command, or add --write to have this run it.' : `Add --write to put it in ${c.file} for you.`));
    return 0;
  }
  if (c.kind === 'command') {
    const argv = claudeCodeCommand(entry);
    // Re-adding replaces the old entry (claude refuses a name it already has).
    spawnSync('claude', ['mcp', 'remove', '--scope', 'user', SERVER_NAME], { stdio: 'ignore', shell: process.platform === 'win32' });
    const r = spawnSync(argv[0], argv.slice(1), { stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.error || r.status !== 0)
      throw new Problem(
        `Claude Code's own command didn't work${r.error ? ` (${r.error.message})` : ''}. Is the claude command installed? Run it yourself:\n  ${shellLine(argv)}`,
      );
    say(`${green('✓')} Added to Claude Code for every project. ${c.after}`);
    return 0;
  }
  let res;
  try {
    res = writeClient(c, entry);
  } catch (err) {
    throw new Problem(`${c.file}: ${err.message}. Add this yourself:\n${indent(snippetFor(c, entry))}`);
  }
  if (!res.changed) say(`${green('✓')} ${c.name} already has it.`);
  else say(`${green('✓')} Added to ${res.file}${res.backup ? dim(`\n  (the old file is kept as ${res.backup})`) : ''}`);
  say(dim(c.after));
  return 0;
}

const indent = (s) =>
  s
    .split('\n')
    .map((l) => `  ${l}`)
    .join('\n');

function cmdSkill() {
  const r = installSkill();
  say(`${green('✓')} ${r.changed ? 'Installed' : 'Already installed:'} ${r.file}`);
  say(dim('Claude Code now knows to look in your archive when you mention an earlier chat. Start a new session to pick it up.'));
  return 0;
}

function cmdDoctor(dbPath) {
  let bad = 0;
  const ok = (m) => say(`${green('✓')} ${m}`);
  const warn = (m) => say(`${yellow('!')} ${m}`);
  const fail = (m) => (say(`${red('✗')} ${m}`), (bad += 1));
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major > 22 || (major === 22 && minor >= 13)) ok(`Node ${process.versions.node}`);
  else fail(`Node ${process.versions.node}: ChatAtlas Local needs Node 22.13 or newer (nodejs.org).`);
  if (!existsSync(dbPath)) warn(`No archive yet at ${dbPath}. chatatlas-local import <export .zip> makes it.`);
  else {
    const archive = openArchive(dbPath);
    try {
      const check = /** @type {any} */ (archive.db.prepare('pragma quick_check').get());
      const fine = Object.values(check)[0] === 'ok';
      const s = archive.stats();
      if (fine) ok(`Archive ${dbPath}: ${plural(s.chats, 'chat')}${s.last ? `, newest from ${dayLabel(s.last)}` : ''}`);
      else fail(`The archive file reports a problem: ${Object.values(check)[0]}. Import your exports into a fresh one (--db <new file>).`);
      const indexed = Number(/** @type {any} */ (archive.db.prepare('select count(*) c from chats_fts').get()).c);
      if (indexed === s.chats) ok('Search index matches the chats');
      else fail(`The search index has ${indexed} chats and the archive ${s.chats}. Re-import your exports to rebuild it.`);
      const last = archive.imports(1)[0];
      if (last) {
        const days = Math.floor((Date.now() - Date.parse(last.at)) / 86_400_000);
        if (days > 45) warn(`Last import was ${days} days ago. A fresh export brings your newer chats in.`);
      }
    } finally {
      archive.close();
    }
  }
  for (const c of clients()) {
    if (c.kind === 'command') continue;
    if (!existsSync(c.file)) continue;
    let text = '';
    try {
      text = readFileSync(c.file, 'utf8');
      const data = c.kind === 'json' ? JSON.parse(text) : null;
      const entry = data ? data[c.key]?.[SERVER_NAME] : text.includes(`[mcp_servers.${SERVER_NAME}]`) ? {} : null;
      if (!entry) continue;
      if (entry.command && entry.command !== 'npx' && !existsSync(entry.command))
        fail(`${c.name} starts ${entry.command}, which isn't there any more. Run: chatatlas-local setup ${c.id} --write`);
      else if (entry.args && entry.args[0] && entry.command !== 'npx' && !existsSync(entry.args[0]))
        fail(`${c.name} starts ${entry.args[0]}, which isn't there any more. Run: chatatlas-local setup ${c.id} --write`);
      else ok(`${c.name} is connected`);
    } catch (err) {
      warn(`${c.name}'s settings (${c.file}) couldn't be read: ${err.message}`);
    }
  }
  if (existsSync(join(skillsDir(), 'chatatlas-local', 'SKILL.md'))) ok('Claude Code skill installed');
  say(bad ? red(`\n${plural(bad, 'problem')} to look at.`) : green('\nAll good.'));
  return bad ? 1 : 0;
}
