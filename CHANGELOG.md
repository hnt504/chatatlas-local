# Changes

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
