import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  claudeCodeCommand,
  clients,
  installSkill,
  isNpxCopy,
  serverEntry,
  shellLine,
  snippetFor,
  withJsonEntry,
  withTomlEntry,
  writeClient,
} from '../src/setup.js';
import { cli, workspace } from './helpers.js';

const entry = { command: '/usr/bin/node', args: ['/opt/cal/bin/chatatlas-local.js', 'mcp'] };

test('serverEntry: a lasting install by its path, an npx copy through npx, --db passed on', () => {
  assert.deepEqual(serverEntry({ bin: '/opt/cal/bin/chatatlas-local.js', node: '/usr/bin/node' }), entry);
  assert.ok(isNpxCopy('/home/me/.npm/_npx/123/node_modules/chatatlas-local/bin/chatatlas-local.js'));
  assert.ok(isNpxCopy('C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\123\\node_modules\\x.js'));
  assert.deepEqual(serverEntry({ bin: '/home/me/.npm/_npx/1/node_modules/chatatlas-local/bin/chatatlas-local.js', db: '/data/a.db' }).args, [
    '-y',
    'chatatlas-local',
    'mcp',
    '--db',
    '/data/a.db',
  ]);
});

const slash = (p) => p.replace(/\\/g, '/');

test('clients: where each app keeps its settings, per system', () => {
  const mac = clients({ platform: 'darwin', env: {}, home: '/Users/h' });
  assert.equal(slash(mac.find((c) => c.id === 'claude-desktop').file), '/Users/h/Library/Application Support/Claude/claude_desktop_config.json');
  assert.equal(slash(mac.find((c) => c.id === 'vscode').file), '/Users/h/Library/Application Support/Code/User/mcp.json');
  const win = clients({ platform: 'win32', env: { APPDATA: 'C:\\Users\\h\\AppData\\Roaming' }, home: 'C:\\Users\\h' });
  assert.match(win.find((c) => c.id === 'claude-desktop').file, /AppData.Roaming.Claude.claude_desktop_config\.json$/);
  const linux = clients({ platform: 'linux', env: {}, home: '/home/h' });
  assert.equal(slash(linux.find((c) => c.id === 'claude-desktop').file), '/home/h/.config/Claude/claude_desktop_config.json');
  assert.equal(slash(linux.find((c) => c.id === 'codex').file), '/home/h/.codex/config.toml');
});

test('withJsonEntry keeps everything else, and refuses a file it cannot read', () => {
  const had = JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x' } } });
  const next = JSON.parse(withJsonEntry(had, 'mcpServers', entry));
  assert.equal(next.theme, 'dark');
  assert.deepEqual(Object.keys(next.mcpServers), ['other', 'chatatlas']);
  assert.deepEqual(JSON.parse(withJsonEntry('', 'servers', entry)), { servers: { chatatlas: entry } });
  assert.throws(() => withJsonEntry('{oops', 'mcpServers', entry), /isn't valid JSON/);
  assert.throws(() => withJsonEntry('[1]', 'mcpServers', entry), /JSON object/);
});

test('withTomlEntry adds the section, or replaces the old one, leaving the rest', () => {
  const fresh = withTomlEntry('', entry);
  assert.equal(fresh, '[mcp_servers.chatatlas]\ncommand = "/usr/bin/node"\nargs = ["/opt/cal/bin/chatatlas-local.js", "mcp"]\n');
  const had = 'model = "o4"\n\n[mcp_servers.chatatlas]\ncommand = "old"\nargs = []\n\n[mcp_servers.other]\ncommand = "y"\n';
  const next = withTomlEntry(had, entry);
  assert.match(next, /^model = "o4"/);
  assert.ok(!next.includes('"old"'));
  assert.match(next, /\[mcp_servers\.other\]\ncommand = "y"/);
  assert.equal(next.match(/\[mcp_servers\.chatatlas\]/g).length, 1);
  assert.equal(withTomlEntry(next, entry), next, 'writing it twice changes nothing');
});

test('snippets and the Claude Code command', () => {
  const [desktop, code, , vscode] = clients({ platform: 'linux', env: {}, home: '/h' });
  assert.deepEqual(JSON.parse(snippetFor(desktop, entry)), { mcpServers: { chatatlas: entry } });
  assert.deepEqual(JSON.parse(snippetFor(vscode, entry)), { servers: { chatatlas: { type: 'stdio', ...entry } } });
  assert.equal(snippetFor(code, entry), 'claude mcp add --scope user chatatlas -- /usr/bin/node /opt/cal/bin/chatatlas-local.js mcp');
  assert.deepEqual(claudeCodeCommand(entry).slice(0, 6), ['claude', 'mcp', 'add', '--scope', 'user', 'chatatlas']);
  assert.equal(shellLine(['a b', "it's"], 'linux'), `'a b' 'it'\\''s'`);
  assert.equal(shellLine(['C:\\Program Files\\node.exe'], 'win32'), '"C:\\Program Files\\node.exe"');
});

test('writeClient writes, keeps a copy of the old file, and does nothing the second time', () => {
  const w = workspace();
  const c = clients({ platform: 'linux', env: {}, home: w.home }).find((x) => x.id === 'claude-desktop');
  mkdirSync(join(w.home, '.config', 'Claude'), { recursive: true });
  writeFileSync(c.file, JSON.stringify({ mcpServers: { keep: { command: 'k' } } }));
  const r = writeClient(c, entry, { now: new Date('2026-10-22T12:00:00Z') });
  assert.equal(r.changed, true);
  assert.match(r.backup, /claude_desktop_config\.json\.bak-2026-10-22T12-00-00-000Z$/);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(c.file, 'utf8')).mcpServers), ['keep', 'chatatlas']);
  assert.equal(writeClient(c, entry).changed, false);
  const codex = clients({ platform: 'linux', env: {}, home: w.home }).find((x) => x.id === 'codex');
  assert.equal(writeClient(codex, entry).backup, null, 'a new file needs no copy');
  assert.match(readFileSync(codex.file, 'utf8'), /\[mcp_servers\.chatatlas\]/);
});

test('installSkill copies the skill into Claude Code', () => {
  const w = workspace();
  const r = installSkill({ home: w.home });
  assert.equal(r.changed, true);
  assert.match(readFileSync(r.file, 'utf8'), /^---\nname: chatatlas-local\n/);
  assert.equal(installSkill({ home: w.home }).changed, false);
});

test('setup from the command line: shows every app, writes one', () => {
  const w = workspace();
  const env = { HOME: w.home, USERPROFILE: w.home, XDG_CONFIG_HOME: join(w.home, '.config'), APPDATA: join(w.home, 'AppData') };
  const all = cli(['setup'], { env });
  for (const name of ['Claude Desktop', 'Claude Code', 'Cursor', 'VS Code', 'Windsurf', 'Gemini CLI', 'Codex CLI', 'ChatGPT'])
    assert.match(all.out, new RegExp(name));
  const wrote = cli(['setup', 'cursor', '--write'], { env });
  assert.equal(wrote.code, 0, wrote.err);
  const cfg = JSON.parse(readFileSync(join(w.home, '.cursor', 'mcp.json'), 'utf8'));
  assert.deepEqual(cfg.mcpServers.chatatlas.args.slice(-1), ['mcp']);
  assert.match(cli(['setup', 'cursor', '--write'], { env }).out, /already has it/);
  assert.match(cli(['setup', 'notepad'], { env }).err, /There's no app called "notepad"/);
  assert.match(cli(['setup', '--write'], { env }).err, /Name the app/);
  assert.match(cli(['skill'], { env }).out, /Installed/);
  assert.ok(readdirSync(join(w.home, '.claude', 'skills', 'chatatlas-local')).includes('SKILL.md'));
  const doc = cli(['doctor', '--db', w.db], { env });
  assert.match(doc.out, /✓ Cursor is connected/);
  assert.match(doc.out, /✓ Claude Code skill installed/);
});
