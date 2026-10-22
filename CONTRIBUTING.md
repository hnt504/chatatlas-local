# Contributing

Thanks for helping. ChatAtlas Local is small on purpose: plain JavaScript (checked with TypeScript
through JSDoc), Node's built-in SQLite, one dependency (fflate, for zip files), and no network.

## Working on it

```sh
git clone https://github.com/hnt504/chatatlas-local
cd chatatlas-local
npm install
npm run check        # formatting, types and tests
node bin/chatatlas-local.js --help
```

Use a throwaway archive while you work: `--db /tmp/test.db`, or `CHATATLAS_LOCAL_DB=/tmp/test.db`.

## Where things are

| | |
| --- | --- |
| `src/importers.js` | Reading ChatGPT, Claude and ChatAtlas exports into one shape |
| `src/db.js` | The archive: SQLite, the FTS5 search index, imports |
| `src/format.js` | Dates, snippets, pages of a chat, Markdown |
| `src/tools.js`, `src/protocol.js`, `src/stdio.js` | The MCP server |
| `src/viewer.js`, `src/viewer.html` | The browser view (`open`) |
| `src/inbox.js` | The exports folder (`watch`, `mcp --inbox`) |
| `src/setup.js` | Connecting Claude Desktop, Claude Code, Cursor and the rest |
| `src/cli.js` | The commands |
| `skill/chatatlas-local/SKILL.md` | The Claude Code skill |
| `scripts/pack-mcpb.mjs` | Builds the Claude Desktop extension (`npm run pack:mcpb`) |

## A new kind of export

The most welcome contribution. Add a reader to `src/importers.js` that turns the export into
`{ id, platform, title, date, updated, tags, messages: [{ role, content }] }` (with an id that
stays the same between exports, so importing twice updates instead of doubling), teach `fromJson`
to recognize it, and add a small made-up example to `test/fixtures.js`. Never commit a real export.

## House rules

- Nothing talks to the network. Tools given to an assistant only read.
- Words people read are plain and friendly, in American English, without em dashes.
- Every change comes with tests (`node:test`), and `npm run check` passes.
