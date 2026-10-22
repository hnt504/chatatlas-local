# ChatAtlas Local

The free, open-source, local version of ChatAtlas (hnt504/ChatAtlas, chatatlas.pro, which is private
and paid). Imports ChatGPT/Claude exports into one SQLite file and serves it over MCP (stdio), a
CLI and a 127.0.0.1 browser view. See CONTRIBUTING.md for where things are.

- `npm run check` (prettier, `tsc` over JSDoc, `node:test`) before every push; CI runs it on
  Linux, macOS and Windows with Node 22.13, 22 and 24.
- No network, ever. MCP tools only read. One runtime dependency (fflate); keep it that way.
- Copy: plain, friendly, American English, no em dashes (tests check the MCP tool descriptions).
  Brand: "ChatAtlas" is one word; never "Atlas" alone.
- Releases: bump `version` in package.json, add to CHANGELOG.md, push a `v<version>` tag. The
  release workflow builds the Claude Desktop extension (`npm run pack:mcpb`) and publishes to npm
  when the `NPM_TOKEN` secret exists.
- Pro's MCP server lives in hnt504/ChatAtlas `scripts/mcp/`; `src/format.js` and the tool texts
  started as copies of it. The two share the ChatAtlas backup format (`toChatAtlasBackup`).
