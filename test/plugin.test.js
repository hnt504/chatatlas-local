// The Claude plugin (plugin/, for Anthropic's directory and the marketplace in .claude-plugin/)
// runs the npm package at a pinned version. A release bumps package.json first and the plugin once
// npm has the new version, so the plugin's pins all agree and never run ahead of package.json.
// server.json (the official MCP Registry) follows package.json exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (/** @type {string} */ p) => readFileSync(join(root, p), 'utf8');
const { version } = JSON.parse(read('package.json'));

/** -1, 0 or 1, comparing two plain x.y.z versions. */
const compare = (/** @type {string} */ a, /** @type {string} */ b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
};

test('the plugin and every pinned command agree, and never run ahead of the package', () => {
  const pinned = JSON.parse(read('plugin/.claude-plugin/plugin.json')).version;
  assert.ok(compare(pinned, version) <= 0, `the plugin pins ${pinned}, newer than package.json's ${version}`);
  const server = JSON.parse(read('plugin/.mcp.json')).mcpServers['chatatlas-local'];
  assert.equal(server.command, 'npx');
  assert.ok(server.args.includes(`chatatlas-local@${pinned}`), 'the MCP server runs the plugin version');
  for (const file of ['plugin/README.md', 'plugin/skills/chatatlas-local/SKILL.md']) {
    const pins = [...read(file).matchAll(/chatatlas-local@([0-9][^\s"`]*)/g)].map((m) => m[1]);
    assert.ok(pins.length > 0, `${file} shows the pinned command`);
    for (const pin of pins) assert.equal(pin, pinned, `${file} pins ${pin}`);
  }
});

test('the MCP Registry entry follows the package', () => {
  const pkg = JSON.parse(read('package.json'));
  const server = JSON.parse(read('server.json'));
  assert.equal(server.name, pkg.mcpName, 'the registry checks mcpName against this');
  assert.equal(server.version, version);
  assert.equal(server.packages[0].identifier, pkg.name);
  assert.equal(server.packages[0].version, version);
  assert.ok(server.description.length <= 100, 'the registry keeps descriptions short');
  assert.ok(!read('server.json').includes('\u2014'));
});

test('the plugin copy is plain, friendly and has no em dashes', () => {
  for (const file of ['plugin/README.md', 'plugin/skills/chatatlas-local/SKILL.md', 'plugin/.claude-plugin/plugin.json']) {
    assert.ok(!read(file).includes('—'), `${file} has an em dash`);
  }
});

test('the plugin carries the square icon the directory lists', () => {
  const png = readFileSync(join(root, 'plugin/.claude-plugin/icon.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  assert.equal(width, height);
  assert.ok(width >= 512 && width <= 2048, `${width}px`);
});

test('the marketplace lists the plugin folder', () => {
  const market = JSON.parse(read('.claude-plugin/marketplace.json'));
  assert.deepEqual(
    market.plugins.map((/** @type {{ name: string; source: string }} */ p) => [p.name, p.source]),
    [['chatatlas-local', './plugin']],
  );
});
