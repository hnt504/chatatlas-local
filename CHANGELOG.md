# Changes

## Unreleased

- `mcp --http`: the same MCP server at `http://127.0.0.1:8770/mcp`, for assistants that live in a
  browser page, such as llama.cpp's web UI or Open WebUI. It answers on this computer only,
  refuses look-alike host names, and lets in only the browser pages named with `--allow-origin`.
- Over `mcp --http` the tools are named `chatatlas_search_chats` and so on, because llama.cpp's
  web UI has a `search_chats` of its own that took the calls. Over stdio the names are unchanged.
- `mcp --http --verbose` logs one line per request (the kind of request and which page sent it,
  never chat text or search words), for finding out why an assistant isn't using the tools.
- Every tool's description now says it reads the user's ChatAtlas archive, so an assistant with its
  own "saved chats" tool (llama.cpp's web UI has one) picks the right one.

## 0.1.3

- Claude: import a single conversation saved from claude.ai with `tree=True` (the README shows
  how), and keep every branch of it. The branch on screen comes first; each branch hidden by Retry
  or by editing a message follows, opening with "Earlier version, hidden on claude.ai by a retry or
  an edit. Kept by ChatAtlas." Nothing you wrote vanishes because you clicked Retry.

## 0.1.2

- Listed in the official MCP Registry (`io.github.hnt504/chatatlas-local`).
- A Claude plugin (Claude Code and Cowork), with a privacy policy in the README.

## 0.1.1

- The README no longer says ChatGPT can use ChatAtlas Pro.
- Releases publish to npm through npm's trusted publishing, and run once per release.

## 0.1.0

The first release.

- Import ChatGPT and Claude data exports (.zip, `conversations.json` or the unzipped folder) and
  ChatAtlas backups. Importing again adds new chats and updates changed ones.
- Search every chat by words, with filters for platform, tag and dates; list, read, tag, forget,
  stats and recent topics from the command line.
- A browser view, served from your own computer only.
- An MCP server with five read-only tools, and `setup` for Claude Desktop, Claude Code, Cursor,
  VS Code, Windsurf, Gemini CLI and Codex.
- A Claude Desktop extension (.mcpb) and a Claude Code skill.
- An exports folder that brings new exports in by itself (`watch`, `mcp --inbox`).
- Export to Markdown files or a ChatAtlas backup.
