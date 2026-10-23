---
name: chatatlas-local
description: Search and read the user's saved ChatGPT, Claude and other AI chats, kept on their own computer by ChatAtlas Local. Use when the user mentions an earlier conversation ("what did ChatGPT tell me about…", "that chat where I planned…", "find where I decided…"), wants to compare what different AIs said, wants to pick up past work from another assistant, or wants to bring a ChatGPT or Claude data export into their archive.
---

# Your saved chats (ChatAtlas Local)

The user keeps their AI conversations in a local archive (one file on their computer), imported from
ChatGPT's and Claude's data exports. This plugin's `chatatlas-local` MCP server reads it. Everything
stays on their computer, and the tools only read.

## Find, then read

1. `search_chats` with the words the user would have used. Every word must be in the chat; each word
   also finds longer words it starts ("plan" finds "planning"), and accents don't matter. Narrow with
   `platform`, `since` and `until` when the user gives them. If nothing comes back, try fewer or
   different words before saying it isn't there.
2. `read_chat` on the chat that matters before answering from it. Long chats come a page at a time.

Other ways in: `list_chats` (newest first, by platform, date, title words or tag), `recent_topics`
(what they talked about lately) and `archive_overview` (what the archive holds and how far back).

## When you answer

- Say which platform and date the information came from ("in a ChatGPT chat from March 2026…").
- Quote the user's own words when it's a decision they made, rather than paraphrasing it.
- Summarize and quote the parts that matter; don't paste whole conversations back.

## An empty or out-of-date archive

The archive only knows what was in the exports the user imported. If it's empty, or the chat they
want is newer than their last export, explain how to get an export (ChatGPT: Settings → Data
controls → Export data. Claude: Settings → Privacy → Export data; each arrives by email as a .zip).

When they have the .zip, offer to bring it in, and run this only once they say yes:

```sh
npx -y chatatlas-local@0.1.2 import "<path to the export .zip>"
```

Importing again later only adds new chats and updates changed ones. Never run `forget` or `tag`
unless the user asks.
