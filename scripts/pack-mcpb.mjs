// Builds the Claude Desktop extension (dist/chatatlas-local-<version>.mcpb): this package with its
// one dependency, a manifest, and the icon. Install it by opening the file with Claude Desktop.
//   npm run pack:mcpb

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCP_TOOLS } from '../src/protocol.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const stage = join(root, 'build', 'mcpb');
const out = join(root, 'dist', `chatatlas-local-${pkg.version}.mcpb`);

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
mkdirSync(dirname(out), { recursive: true });
for (const p of ['bin', 'src', 'LICENSE']) cpSync(join(root, p), join(stage, p), { recursive: true });
cpSync(join(root, 'assets', 'icon.png'), join(stage, 'icon.png'));
for (const dep of Object.keys(pkg.dependencies)) cpSync(join(root, 'node_modules', dep), join(stage, 'node_modules', dep), { recursive: true });
writeFileSync(
  join(stage, 'package.json'),
  JSON.stringify({ name: pkg.name, version: pkg.version, type: 'module', license: pkg.license, dependencies: pkg.dependencies }, null, 2),
);

const manifest = {
  manifest_version: '0.3',
  name: 'chatatlas-local',
  display_name: 'ChatAtlas Local',
  version: pkg.version,
  description: 'Search and read your saved ChatGPT and Claude chats, kept on your own computer.',
  long_description:
    'ChatAtlas Local keeps the chats from your ChatGPT and Claude data exports in one file on your computer, and lets Claude search and read them when you ask: "what did ChatGPT tell me about my sourdough?", "find the chat where I planned the garden". Nothing is sent anywhere; Claude only reads, and can\'t change, tag or delete anything.\n\nTo bring chats in, set an exports folder below and save your export .zip there (ChatGPT: Settings → Data controls → Export data. Claude: Settings → Privacy → Export data), or use the chatatlas-local command line.',
  author: { name: 'Heather Turner', url: 'https://chatatlas.pro' },
  repository: { type: 'git', url: 'https://github.com/hnt504/chatatlas-local' },
  homepage: 'https://github.com/hnt504/chatatlas-local',
  documentation: 'https://github.com/hnt504/chatatlas-local#readme',
  support: 'https://github.com/hnt504/chatatlas-local/issues',
  icon: 'icon.png',
  server: {
    type: 'node',
    entry_point: 'bin/chatatlas-local.js',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/bin/chatatlas-local.js', 'mcp'],
      env: { CHATATLAS_LOCAL_DB: '${user_config.archive}', CHATATLAS_LOCAL_INBOX: '${user_config.inbox}' },
    },
  },
  tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description })),
  keywords: pkg.keywords,
  license: pkg.license,
  compatibility: { platforms: ['darwin', 'win32', 'linux'], runtimes: { node: '>=22.16.0 <23.0.0 || >=24.0.0' } },
  user_config: {
    inbox: {
      type: 'directory',
      title: 'Exports folder',
      description:
        'Save your ChatGPT or Claude export .zip here (your Downloads folder works) and it comes into the archive by itself. Leave it empty to import with the command line instead.',
      required: false,
    },
    archive: {
      type: 'string',
      title: 'Archive file',
      description: 'Where your chats are kept. The command line uses the same file, so both see the same chats.',
      required: false,
      default: '${HOME}/.chatatlas-local/chatatlas.db',
    },
  },
};
writeFileSync(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const mcpb = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'mcpb.cmd' : 'mcpb');
execFileSync(mcpb, ['validate', join(stage, 'manifest.json')], { stdio: 'inherit' });
execFileSync(mcpb, ['pack', stage, out], { stdio: 'inherit' });
console.log(`\n${out}`);
