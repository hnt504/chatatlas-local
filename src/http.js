// The MCP server over HTTP, for assistants that live in a browser page (llama.cpp's web UI, Open
// WebUI and the like) and can't start a program the way Claude Desktop does. Same tools, same
// answers as src/stdio.js, carried as Streamable HTTP on one address: POST /mcp.
//
// It stays on this computer:
// - It listens on 127.0.0.1 only, never the network.
// - It answers only requests addressed to 127.0.0.1, localhost or [::1] on its own port, so a web
//   page can't reach it through a look-alike domain that points at this computer (DNS rebinding).
// - A request from a browser page must come from a page named with --allow-origin, or it's
//   refused before any tool runs. Programs that aren't browsers send no Origin and are let in, as
//   they could read the archive file anyway.
// - The tools only read, as over stdio. It keeps no sessions and offers no event stream.
//
// Over HTTP the tools are named chatatlas_search_chats, chatatlas_read_chat and so on. A browser
// assistant puts every server's tools in one list with its own, and llama.cpp's web UI already has
// a search_chats of its own (for chats saved in the web UI), which would win. Claude Desktop and
// the other stdio clients keep each server's tools apart, so they keep the plain names.

import { createServer } from 'node:http';
import { ERRORS, MCP_TOOLS, PROTOCOL_VERSIONS, answer, readMessage, rpcError } from './protocol.js';
import { runTool } from './tools.js';
import { isLocalHost } from './viewer.js';

export const DEFAULT_HTTP_PORT = 8770;
export const MCP_PATH = '/mcp';
const MAX_BODY = 1024 * 1024;
const ALLOW_HEADERS = 'content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id';

export const HTTP_TOOL_PREFIX = 'chatatlas_';
const TOOL_NAMES = new RegExp(`\\b(${MCP_TOOLS.map((t) => t.name).join('|')})\\b`, 'g');

/** Text with every plain tool name given the HTTP prefix (search_chats becomes chatatlas_search_chats). */
export const prefixToolNames = (text) => (typeof text === 'string' ? text.replace(TOOL_NAMES, `${HTTP_TOOL_PREFIX}$1`) : text);

/** The protocol's answer, with the tools named for HTTP: prefixed going out, plain coming in. */
async function answerNamed(msg, callTool) {
  if (msg.method === 'tools/call') {
    const name = msg.params?.name;
    if (typeof name !== 'string' || !name.startsWith(HTTP_TOOL_PREFIX)) {
      return 'id' in msg && msg.id !== undefined ? rpcError(msg.id, ERRORS.invalidParams, `There's no tool called ${String(name)}.`) : null;
    }
    msg = { ...msg, params: { ...msg.params, name: name.slice(HTTP_TOOL_PREFIX.length) } };
  }
  const a = await answer(msg, callTool);
  if (!a || !('result' in a)) return a;
  const r = /** @type {any} */ (a.result);
  if (msg.method === 'initialize') return { ...a, result: { ...r, instructions: prefixToolNames(r.instructions) } };
  if (msg.method === 'tools/list') {
    const tools = r.tools.map((t) => ({ ...t, name: `${HTTP_TOOL_PREFIX}${t.name}`, description: prefixToolNames(t.description) }));
    return { ...a, result: { ...r, tools } };
  }
  // Results are left exactly as they are: they quote the person's chats, which must never be altered.
  // Only an error ("Give read_chat a chat id…") holds no chat text, so it gets the names used here.
  if (msg.method === 'tools/call' && r.isError === true && Array.isArray(r.content)) {
    return { ...a, result: { ...r, content: r.content.map((c) => (c?.type === 'text' ? { ...c, text: prefixToolNames(c.text) } : c)) } };
  }
  return a;
}

/** A browser origin in its standard form (`http://localhost:8081`), or null if it isn't one. */
export function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value || value === 'null') return null;
  let u;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) return null;
  if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) return null;
  return u.origin;
}

/**
 * The pages allowed to use the server from a browser, from `--allow-origin a,b`. Each must be a
 * plain origin like http://localhost:8081: no wildcard, no path.
 * @returns {string[]}
 */
export function parseAllowedOrigins(value) {
  if (value === undefined || value === null || value === false) return [];
  if (typeof value !== 'string' || !value.trim()) throw new Error('--allow-origin needs an address, like http://localhost:8081.');
  const out = [];
  for (const raw of value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const o = normalizeOrigin(raw);
    if (!o || raw.includes('*')) throw new Error(`"${raw}" isn't a page address. Use something like http://localhost:8081, with no path.`);
    if (!out.includes(o)) out.push(o);
  }
  return out;
}

/** The request handler, separate from the listening so tests can drive it. */
export function mcpHttpHandler({ getArchive, port, allowedOrigins = [], log = null }) {
  const allowed = new Set(allowedOrigins);
  let archive = null;
  const callTool = (name, args) => {
    archive ??= getArchive();
    return runTool(archive, name, args);
  };
  const plain = (res, status, message, extra = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...extra });
    res.end(JSON.stringify({ error: message }));
  };

  const handler = async (req, res) => {
    // --verbose: one line per request, about the request only. Never search words, chat text or answers.
    /** @type {string[]} */
    const seen = [];
    if (log) {
      const short = (v, n = 60) =>
        v === undefined
          ? '-'
          : String(v)
              .replace(/[^ -~]/g, '?')
              .slice(0, n);
      res.on('finish', () =>
        log(
          `${short(req.method, 10)} ${short((req.url ?? '').split('?')[0])} origin=${short(req.headers.origin)} accept=${short(req.headers.accept, 50)} -> ${res.statusCode}${seen.length ? ` ${seen.join(', ')}` : ''}`,
        ),
      );
    }
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('vary', 'Origin');
    if (!isLocalHost(req.headers.host, port())) return plain(res, 421, 'This server only answers on 127.0.0.1.');

    // A browser page must be one the person allowed. Checked before anything else happens.
    const origin = req.headers.origin;
    if (origin !== undefined) {
      const o = normalizeOrigin(origin);
      if (!o || !allowed.has(o)) return plain(res, 403, 'This page is not allowed to use ChatAtlas Local. Start it with --allow-origin to allow it.');
      res.setHeader('access-control-allow-origin', o);
    }

    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (path !== MCP_PATH) return plain(res, 404, `Not here. The MCP address is ${MCP_PATH}.`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': ALLOW_HEADERS,
        'access-control-max-age': '600',
      });
      return res.end();
    }
    if (req.method !== 'POST')
      return plain(res, 405, 'Send MCP messages with POST. This server keeps no sessions and has no event stream.', { allow: 'POST, OPTIONS' });
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) return plain(res, 415, 'Send JSON (content-type: application/json).');
    const version = req.headers['mcp-protocol-version'];
    if (version !== undefined && !PROTOCOL_VERSIONS.includes(String(version)))
      return plain(res, 400, `This server doesn't speak MCP version ${String(version)}.`);

    let body;
    try {
      body = await readBody(req);
    } catch {
      return plain(res, 413, 'That message is too big.');
    }
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return send(res, req, 400, rpcError(null, ERRORS.parse, "That wasn't JSON."));
    }
    const batch = Array.isArray(parsed);
    const answers = [];
    for (const item of batch ? parsed : [parsed]) {
      const msg = readMessage(item);
      if (!msg) {
        if (item && typeof item === 'object' && ('result' in item || 'error' in item)) continue;
        answers.push(rpcError(item?.id ?? null, ERRORS.invalidRequest, "That isn't a JSON-RPC request."));
        continue;
      }
      seen.push(msg.method === 'tools/call' ? `tools/call ${String(msg.params?.name ?? '?').slice(0, 40)}` : msg.method.slice(0, 40));
      const a = await answerNamed(msg, callTool);
      if (a) answers.push(a);
    }
    if (answers.length === 0) {
      res.writeHead(202);
      return res.end();
    }
    return send(res, req, 200, batch ? answers : answers[0]);
  };

  return Object.assign(handler, {
    close() {
      try {
        archive?.close();
      } catch {
        /* already closed */
      }
      archive = null;
    },
  });
}

/** JSON, or a one-message event stream for a client that only accepts that. */
function send(res, req, status, payload) {
  const accept = String(req.headers.accept ?? '');
  const json = !accept || /application\/json|\*\/\*/i.test(accept) || !/text\/event-stream/i.test(accept);
  if (json) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(payload));
  }
  res.writeHead(status, { 'content-type': 'text/event-stream; charset=utf-8' });
  return res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('too big'));
        req.resume();
      } else parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

/** Starts the HTTP server on 127.0.0.1. Answers the server, its port and the MCP address. */
export function startHttpServer({ getArchive, port = DEFAULT_HTTP_PORT, allowedOrigins = [], log = null }) {
  let actual = port;
  const handler = mcpHttpHandler({ getArchive, port: () => actual, allowedOrigins, log });
  const server = createServer(handler);
  server.on('close', () => handler.close());
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      actual = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
      resolve({ server, port: actual, url: `http://127.0.0.1:${actual}${MCP_PATH}` });
    });
  });
}
