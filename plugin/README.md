# ChatAtlas Local

Your ChatGPT and Claude chats, searchable on your own computer. Ask Claude "what did ChatGPT tell me
about my sourdough starter?" or "find the chat where I planned the garden beds", and it searches
and reads your saved conversations to answer.

## What's in this plugin

- **An MCP server** (`chatatlas-local`, started with `npx chatatlas-local@<version> mcp`) with five
  read-only tools: `search_chats`, `list_chats`, `read_chat`, `recent_topics` and
  `archive_overview`. They can't change, tag or delete anything.
- **A skill** that tells Claude when to look in your saved chats, how to search and read them, and
  how to bring in a new export when you ask.

It runs in Claude Code and in Cowork sessions on your computer, and needs
[Node.js](https://nodejs.org) 22.16 or newer (or 24). In Claude Code:

```
/plugin install chatatlas-local --marketplace hnt504/chatatlas-local
```

## Bring your chats in

Ask ChatGPT (Settings → Data controls → Export data) and Claude (Settings → Privacy → Export data)
for your data exports. Each arrives by email as a .zip. Then ask Claude to import it, or run:

```sh
npx -y chatatlas-local@0.1.1 import ~/Downloads/<your export>.zip
```

## Data and privacy

Everything stays on your computer. Your chats are kept in one file, `~/.chatatlas-local/chatatlas.db`.
ChatAtlas Local makes no network connections, collects nothing and sends nothing anywhere. The
only download is the package itself, from npm, when the plugin first starts the server. What Claude
reads from your archive to answer you is part of your conversation with Claude, like anything else
you tell it. The full privacy policy:
https://github.com/hnt504/chatatlas-local#privacy-policy

Source, issues and the full command line: https://github.com/hnt504/chatatlas-local

MIT license.
