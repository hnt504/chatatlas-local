# Security

ChatAtlas Local keeps private conversations, so its promises are simple:

- It makes no network connections.
- The browser view (`chatatlas-local open`) listens on 127.0.0.1 only, refuses requests addressed
  to any other host name, and needs a random key for every request. The key is made fresh each
  time and lives only in the tab that was opened.
- The MCP tools only read. They can't change, tag or delete anything.

If you find a way around any of that, or anything else that could expose someone's chats, please
report it privately through GitHub's
[security advisories](https://github.com/hnt504/chatatlas-local/security/advisories/new) rather
than a public issue. You'll hear back within a few days.
