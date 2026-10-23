// The Claude plugin (plugin/, for Anthropic's directory and the marketplace in .claude-plugin/)
// runs the npm package at a pinned version, so every pin has to follow package.json's version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (/** @type {string} */ p) => readFileSync(join(root, p), 'utf8');
const { version } = JSON.parse(read('package.json'));

test('the plugin and every pinned command follow the package version', () => {
  assert.equal(JSON.parse(read('plugin/.claude-plugin/plugin.json')).version, version);
  const server = JSON.parse(read('plugin/.mcp.json')).mcpServers['chatatlas-local'];
  assert.equal(server.command, 'npx');
  assert.ok(server.args.includes(`chatatlas-local@${version}`), 'the MCP server runs this version');
  for (const file of ['plugin/README.md', 'plugin/skills/chatatlas-local/SKILL.md']) {
    const pins = [...read(file).matchAll(/chatatlas-local@([0-9][^\s"`]*)/g)].map((m) => m[1]);
    assert.ok(pins.length > 0, `${file} shows the pinned command`);
    for (const pin of pins) assert.equal(pin, version, `${file} pins ${pin}`);
  }
});

test('the plugin copy is plain, friendly and has no em dashes', () => {
  for (const file of ['plugin/README.md', 'plugin/skills/chatatlas-local/SKILL.md', 'plugin/.claude-plugin/plugin.json']) {
    assert.ok(!read(file).includes('—'), `${file} has an em dash`);
  }
});

test('the marketplace lists the plugin folder', () => {
  const market = JSON.parse(read('.claude-plugin/marketplace.json'));
  assert.deepEqual(
    market.plugins.map((/** @type {{ name: string; source: string }} */ p) => [p.name, p.source]),
    [['chatatlas-local', './plugin']],
  );
});
