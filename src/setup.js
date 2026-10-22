// Connecting the archive to the assistants people use: where each one keeps its list of MCP
// servers, and the entry that starts this one. `chatatlas-local setup` shows it all; with a client's
// name it writes that client's settings (keeping a copy of the old file first).

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_NAME = 'chatatlas';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'chatatlas-local.js');

/** True when this copy is running out of npx's cache, which npm may clear any time. */
export const isNpxCopy = (path = BIN) => /[\\/](_npx|\.npm[\\/]_npx|npm-cache[\\/]_npx)[\\/]/.test(path);

/**
 * How an assistant starts this server. A lasting install is started by its own path, with this
 * Node (apps opened from the desktop often don't see the PATH a terminal has); a copy run through
 * npx is started through npx again.
 */
export function serverEntry({ db = null, inbox = null, bin = BIN, node = process.execPath } = {}) {
  const extra = [...(db ? ['--db', resolve(db)] : []), ...(inbox ? ['--inbox', resolve(inbox)] : [])];
  if (isNpxCopy(bin)) return { command: 'npx', args: ['-y', 'chatatlas-local', 'mcp', ...extra] };
  return { command: node, args: [bin, 'mcp', ...extra] };
}

/**
 * Every assistant this knows how to connect, with where its settings live on this computer.
 * `kind` json = a JSON file with the servers under `key`; toml = Codex's TOML; command = a
 * command the client's own CLI runs.
 */
export function clients({ platform = process.platform, env = process.env, home = homedir() } = {}) {
  const appData = env.APPDATA || join(home, 'AppData', 'Roaming');
  const appSupport =
    platform === 'darwin' ? join(home, 'Library', 'Application Support') : platform === 'win32' ? appData : env.XDG_CONFIG_HOME || join(home, '.config');
  return [
    {
      id: 'claude-desktop',
      name: 'Claude Desktop',
      kind: 'json',
      key: 'mcpServers',
      file: join(appSupport, 'Claude', 'claude_desktop_config.json'),
      after: 'Quit Claude Desktop completely and open it again.',
    },
    { id: 'claude-code', name: 'Claude Code', kind: 'command', after: 'Start a new Claude Code session; /mcp lists the servers it sees.' },
    {
      id: 'cursor',
      name: 'Cursor',
      kind: 'json',
      key: 'mcpServers',
      file: join(home, '.cursor', 'mcp.json'),
      after: 'Cursor picks it up in Settings → MCP (turn it on there if it is off).',
    },
    {
      id: 'vscode',
      name: 'VS Code',
      kind: 'json',
      key: 'servers',
      file: join(appSupport, 'Code', 'User', 'mcp.json'),
      stdioType: true,
      after: 'In VS Code, run "MCP: List Servers" and start chatatlas.',
    },
    {
      id: 'windsurf',
      name: 'Windsurf',
      kind: 'json',
      key: 'mcpServers',
      file: join(home, '.codeium', 'windsurf', 'mcp_config.json'),
      after: 'Refresh the MCP servers in Windsurf (Cascade → the hammer icon).',
    },
    {
      id: 'gemini-cli',
      name: 'Gemini CLI',
      kind: 'json',
      key: 'mcpServers',
      file: join(home, '.gemini', 'settings.json'),
      after: 'Start gemini again; /mcp lists the servers it sees.',
    },
    { id: 'codex', name: 'Codex CLI', kind: 'toml', file: join(env.CODEX_HOME || join(home, '.codex'), 'config.toml'), after: 'Start codex again.' },
  ];
}

/** The entry as a client stores it (VS Code wants the transport named). */
export const entryFor = (client, entry) => (client.stdioType ? { type: 'stdio', ...entry } : { ...entry });

/** The Claude Code command that adds the server for every project. */
export const claudeCodeCommand = (entry) => ['claude', 'mcp', 'add', '--scope', 'user', SERVER_NAME, '--', entry.command, ...entry.args];

/** A command as one line someone can paste into a terminal. */
export const shellLine = (argv, platform = process.platform) =>
  argv.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : platform === 'win32' ? `"${a.replace(/"/g, '\\"')}"` : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ');

/**
 * A JSON settings file's text with the server added under `key` (other servers and settings left
 * as they were). Throws if the file isn't JSON, rather than lose what's in it.
 */
export function withJsonEntry(existing, key, entry, name = SERVER_NAME) {
  let data = {};
  if (existing && existing.trim()) {
    try {
      data = JSON.parse(existing);
    } catch (err) {
      throw new Error(`it isn't valid JSON (${err.message}), so it was left alone`);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error("it doesn't hold a JSON object, so it was left alone");
  }
  const servers = data[key] && typeof data[key] === 'object' && !Array.isArray(data[key]) ? data[key] : {};
  return `${JSON.stringify({ ...data, [key]: { ...servers, [name]: entry } }, null, 2)}\n`;
}

/** Codex's TOML with the server's section put in (or put in again, replacing the old one). */
export function withTomlEntry(existing, entry, name = SERVER_NAME) {
  const q = (s) => JSON.stringify(String(s));
  const section = `[mcp_servers.${name}]\ncommand = ${q(entry.command)}\nargs = [${entry.args.map(q).join(', ')}]\n`;
  const text = existing ?? '';
  const header = new RegExp(`^\\[mcp_servers\\.${name}\\]\\s*$`, 'm');
  const m = header.exec(text);
  if (!m) return `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text.trim() ? '\n' : ''}${section}`;
  // Replace from the header to the next table header (or the end).
  const rest = text.slice(m.index + m[0].length);
  const next = rest.search(/^\[/m);
  const end = next === -1 ? text.length : m.index + m[0].length + next;
  return `${text.slice(0, m.index)}${section}${next === -1 ? '' : '\n'}${text.slice(end)}`;
}

/** The settings a client needs, as text to show. */
export function snippetFor(client, entry) {
  if (client.kind === 'command') return shellLine(claudeCodeCommand(entry));
  if (client.kind === 'toml') return withTomlEntry('', entry).trim();
  return JSON.stringify({ [client.key]: { [SERVER_NAME]: entryFor(client, entry) } }, null, 2);
}

/**
 * Writes the server into a client's settings file, keeping the old file as `<file>.bak` first.
 * Answers what it did, in words.
 */
export function writeClient(client, entry, { now = new Date() } = {}) {
  if (client.kind === 'command') throw new Error('Claude Code is set up with its own command');
  const had = existsSync(client.file) ? readFileSync(client.file, 'utf8') : null;
  const next = client.kind === 'toml' ? withTomlEntry(had, entry) : withJsonEntry(had, client.key, entryFor(client, entry));
  if (had === next) return { file: client.file, changed: false, backup: null };
  mkdirSync(dirname(client.file), { recursive: true });
  let backup = null;
  if (had !== null) {
    backup = `${client.file}.bak-${now.toISOString().replace(/[:.]/g, '-')}`;
    copyFileSync(client.file, backup);
  }
  writeFileSync(client.file, next);
  return { file: client.file, changed: true, backup };
}

/** Where Claude Code looks for personal skills. */
export const skillsDir = (home = homedir()) => join(home, '.claude', 'skills');

const SKILL_SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'skill', 'chatatlas-local', 'SKILL.md');

/** Copies the skill into Claude Code's skills folder. */
export function installSkill({ home = homedir(), source = SKILL_SOURCE } = {}) {
  const dir = join(skillsDir(home), 'chatatlas-local');
  mkdirSync(dir, { recursive: true });
  const target = join(dir, 'SKILL.md');
  const had = existsSync(target) ? readFileSync(target, 'utf8') : null;
  const next = readFileSync(source, 'utf8');
  if (had === next) return { file: target, changed: false };
  writeFileSync(target, next);
  return { file: target, changed: true };
}
