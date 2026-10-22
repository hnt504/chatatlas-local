import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { chatatlasBackup, chatgptExport, claudeExport } from './fixtures.js';

export const BIN = fileURLToPath(new URL('../bin/chatatlas-local.js', import.meta.url));

/** A fresh folder with the three made-up exports in it. */
export function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'cal-'));
  const chatgpt = join(dir, 'chatgpt-export.zip');
  writeFileSync(chatgpt, zipSync({ 'conversations.json': strToU8(JSON.stringify(chatgptExport)) }));
  const claude = join(dir, 'claude-export.zip');
  writeFileSync(claude, zipSync({ 'conversations.json': strToU8(JSON.stringify(claudeExport)), 'users.json': strToU8('[]') }));
  const backup = join(dir, 'backup.json');
  writeFileSync(backup, JSON.stringify(chatatlasBackup));
  return { dir, db: join(dir, 'archive', 'chatatlas.db'), chatgpt, claude, backup, home: join(dir, 'home') };
}

/** Runs the command line and answers what it said. */
export function cli(args, { env = {}, input } = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', ...env }, input });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** Starts the MCP server and gives a way to ask it things, one answer per question. */
export function mcp(db) {
  const child = spawn(process.execPath, [BIN, 'mcp', '--db', db], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const waiting = [];
  const lines = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      lines.push(line);
      waiting.shift()?.(JSON.parse(line));
    }
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  return {
    child,
    lines,
    stderr: () => stderr,
    send(msg) {
      child.stdin.write(`${typeof msg === 'string' ? msg : JSON.stringify(msg)}\n`);
    },
    ask(msg) {
      return new Promise((resolve) => {
        waiting.push(resolve);
        this.send(msg);
      });
    },
    close() {
      child.stdin.end();
      return new Promise((r) => child.on('close', r));
    },
  };
}
