// The MCP side (Model Context Protocol): JSON-RPC messages in and out, the handshake and the tool
// list. Pure: src/stdio.js carries the messages, src/tools.js answers the tools.

import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const MCP_SERVER = { name: 'chatatlas-local', title: 'ChatAtlas Local', version: pkg.version };

/** Protocol versions this server knows. A client asking for one gets it; any other gets the newest. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export const negotiate = (requested) => (typeof requested === 'string' && PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0]);

export const ERRORS = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603 };

/** What a connected assistant is told about the archive when it connects. */
export const MCP_INSTRUCTIONS = [
  "This is the user's ChatAtlas Local archive: their conversations with ChatGPT, Claude and other AI assistants, imported from those apps' data exports and kept on their own computer.",
  'Use it when the user mentions an earlier conversation, something they asked or decided with another AI, or wants to find, compare or pick up past work.',
  'Search first (search_chats), then read the conversation that matters (read_chat) before answering from it. list_chats browses by platform, date, title or tag; recent_topics shows what they were talking about in a stretch of time; archive_overview says what the archive holds and how far it goes.',
  "The archive only holds what was in the exports the user imported, so the newest chats may be missing. When you use something from it, say which platform and date it came from, and quote the user's own decisions rather than paraphrasing them.",
  'Everything here is read-only: you cannot change, tag or delete their chats.',
].join('\n');

const PLATFORM = { type: 'string', description: 'Only chats from this platform: chatgpt, claude, gemini, grok, perplexity, deepseek…' };
const SINCE = { type: 'string', description: 'Only chats from this date on: 2026-08-01, 2026-08 or 2026' };
const UNTIL = { type: 'string', description: 'Only chats up to and including this date: 2026-08-31, 2026-08 or 2026' };
const TAG = { type: 'string', description: 'Only chats with this tag' };

const readOnly = (title) => ({ title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

/** Every tool the server offers. All of them only read. */
export const MCP_TOOLS = [
  {
    name: 'search_chats',
    title: 'Search chats',
    description:
      "Find the user's saved conversations that mention something: chats holding every word of the query in the title or messages (each word also matches longer words it starts, accents ignored), title matches first, then newest, with the best-matching message quoted. Each result has the chat's id for read_chat.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The words to look for' },
        platform: PLATFORM,
        since: SINCE,
        until: UNTIL,
        tag: TAG,
        limit: { type: 'integer', minimum: 1, maximum: 25, description: 'How many chats (default 10)' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: readOnly('Search chats'),
  },
  {
    name: 'list_chats',
    title: 'List chats',
    description:
      "Browse the user's saved conversations, newest first, by platform, date, words in the title or tag. Each line has the chat's id for read_chat.",
    inputSchema: {
      type: 'object',
      properties: {
        platform: PLATFORM,
        since: SINCE,
        until: UNTIL,
        title: { type: 'string', description: 'Words the title holds' },
        tag: TAG,
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'How many (default 25)' },
        offset: { type: 'integer', minimum: 0, description: 'Skip this many (for the next page)' },
      },
      additionalProperties: false,
    },
    annotations: readOnly('List chats'),
  },
  {
    name: 'read_chat',
    title: 'Read a chat',
    description:
      'Read one saved conversation, message by message, numbered from 1. Long chats come a page at a time: carry on with from_message. A very long single message comes in parts: carry on with part.',
    inputSchema: {
      type: 'object',
      properties: {
        chat: { type: 'string', description: "The chat's id from search_chats or list_chats (its start is enough)" },
        from_message: { type: 'integer', minimum: 1, description: 'Start at this message (default 1)' },
        part: { type: 'integer', minimum: 1, description: 'For a message too long for one page: which part of it (default 1)' },
      },
      required: ['chat'],
      additionalProperties: false,
    },
    annotations: readOnly('Read a chat'),
  },
  {
    name: 'recent_topics',
    title: 'Recent topics',
    description:
      "What the user talked about with their AIs over a stretch of days: how many chats on each platform, the tags that come up most, and the chats' titles week by week.",
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'integer', minimum: 1, maximum: 3650, description: 'How far back (default 30)' },
        platform: PLATFORM,
      },
      additionalProperties: false,
    },
    annotations: readOnly('Recent topics'),
  },
  {
    name: 'archive_overview',
    title: 'Archive overview',
    description: 'What the archive holds: how many chats from each platform, the dates they cover, the tags in use and when it was last imported.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: readOnly('Archive overview'),
  },
];

export const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
export const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

/** The message as a JSON-RPC request or notification this server can read, else null. */
export function readMessage(x) {
  if (!isObj(x) || x.jsonrpc !== '2.0' || typeof x.method !== 'string') return null;
  if ('id' in x && x.id !== null && typeof x.id !== 'string' && typeof x.id !== 'number') return null;
  return x;
}

/**
 * Answers one message. `callTool(name, args)` runs a tool; everything else is the protocol's own.
 * Notifications (no id) get no answer (null).
 */
export async function answer(msg, callTool) {
  if (!('id' in msg) || msg.id === undefined) return null;
  const id = msg.id;
  const params = isObj(msg.params) ? msg.params : {};
  switch (msg.method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: negotiate(params.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_SERVER,
        instructions: MCP_INSTRUCTIONS,
      });
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: MCP_TOOLS });
    case 'tools/call': {
      const name = params.name;
      if (typeof name !== 'string' || !MCP_TOOLS.some((t) => t.name === name)) {
        return rpcError(id, ERRORS.invalidParams, `There's no tool called ${String(name)}.`);
      }
      const args = isObj(params.arguments) ? params.arguments : {};
      try {
        return rpcResult(id, await callTool(name, args));
      } catch (err) {
        process.stderr.write(`[chatatlas-local] ${name} failed: ${err?.stack ?? err}\n`);
        return rpcResult(id, {
          content: [{ type: 'text', text: `That didn't work: ${err?.message ?? 'something went wrong reading the archive'}.` }],
          isError: true,
        });
      }
    }
    case 'resources/list':
      return rpcResult(id, { resources: [] });
    case 'resources/templates/list':
      return rpcResult(id, { resourceTemplates: [] });
    case 'prompts/list':
      return rpcResult(id, { prompts: [] });
    default:
      return rpcError(id, ERRORS.methodNotFound, `This server doesn't do ${msg.method}.`);
  }
}
