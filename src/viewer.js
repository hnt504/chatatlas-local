// `chatatlas-local open`: the archive in a browser, served from this computer only. It listens on
// 127.0.0.1 (never the network), answers only requests addressed to that host (so a web page
// can't reach it through a look-alike domain), and every API call needs the random key in the
// address the command opens, which no other page knows.

import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { searchWords } from './db.js';
import { bestMessage, chatMarkdown, clampInt, fileNameFor, parseDate, snippet } from './format.js';

const PAGE = readFileSync(new URL('./viewer.html', import.meta.url), 'utf8');
const MAX_BODY = 64 * 1024;

const sameKey = (a, b) => {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
};

/** True when a Host header names this server on the loopback address. */
export function isLocalHost(host, port) {
  const h = String(host ?? '').toLowerCase();
  return h === `127.0.0.1:${port}` || h === `localhost:${port}` || h === `[::1]:${port}`;
}

/** The request handler, separate from the listening so tests can drive it. */
export function viewerHandler(archive, { key, port, readOnly = false }) {
  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  return async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    if (!isLocalHost(req.headers.host, port())) return json(res, 421, { error: 'This server only answers on 127.0.0.1.' });
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy':
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      });
      return res.end(PAGE);
    }
    if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not here.' });
    if (!sameKey(req.headers['x-chatatlas-key'], key)) return json(res, 403, { error: 'This page needs the address chatatlas-local open printed.' });
    const origin = req.headers.origin;
    if (origin && !isLocalHost(origin.replace(/^https?:\/\//, ''), port())) return json(res, 403, { error: 'Not from this page.' });

    try {
      if (req.method === 'GET' && url.pathname === '/api/overview') {
        return json(res, 200, { ...archive.stats(), readOnly, imports: archive.imports(5) });
      }
      if (req.method === 'GET' && url.pathname === '/api/chats') {
        const p = url.searchParams;
        const since = parseDate(p.get('since') || undefined);
        const until = parseDate(p.get('until') || undefined, true);
        if (since === null || until === null) return json(res, 400, { error: 'Use dates like 2026-08-15, 2026-08 or 2026.' });
        const opts = {
          platform: p.get('platform') || null,
          tag: p.get('tag') || null,
          since: since ?? null,
          until: until ?? null,
          limit: clampInt(p.get('limit') ?? '', 1, 200, 50),
          offset: clampInt(p.get('offset') ?? '', 0, 10_000_000, 0),
        };
        const q = (p.get('q') ?? '').trim();
        if (q) {
          const words = searchWords(q);
          const { rows, total } = archive.search(q, opts);
          return json(res, 200, {
            total,
            words,
            chats: rows.map(({ messages, ...r }) => {
              const best = bestMessage(messages, words);
              return { ...r, hit: best ? { index: best.index, role: best.role, text: snippet(best.content, words, 220) } : null };
            }),
          });
        }
        const { rows, total } = archive.list(opts);
        return json(res, 200, { total, words: [], chats: rows });
      }
      if (req.method === 'GET' && url.pathname === '/api/chat') {
        const { chat, ambiguous } = archive.getChat(url.searchParams.get('id'));
        if (!chat) return json(res, 404, { error: ambiguous ? 'More than one chat matches.' : 'No such chat.' });
        return json(res, 200, { ...chat, markdown: chatMarkdown(chat), fileName: fileNameFor(chat) });
      }
      if (req.method === 'POST' && (url.pathname === '/api/tags' || url.pathname === '/api/forget')) {
        if (readOnly) return json(res, 403, { error: 'The archive was opened read-only.' });
        const body = await readJson(req);
        if (typeof body?.id !== 'string') return json(res, 400, { error: 'Which chat?' });
        if (url.pathname === '/api/tags') {
          if (!Array.isArray(body.tags) || body.tags.some((t) => typeof t !== 'string' || t.length > 60) || body.tags.length > 30) {
            return json(res, 400, { error: 'Tags are short words, 30 at most.' });
          }
          if (!archive.setTags(body.id, body.tags)) return json(res, 404, { error: 'No such chat.' });
          return json(res, 200, { chat: archive.getChat(body.id).chat });
        }
        return json(res, 200, { forgotten: archive.forget([body.id]) });
      }
      return json(res, 404, { error: 'Not here.' });
    } catch (err) {
      process.stderr.write(`[chatatlas-local] ${err?.stack ?? err}\n`);
      return json(res, 500, { error: err?.message ?? 'Something went wrong.' });
    }
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Too much.'));
        req.destroy();
      } else parts.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || 'null'));
      } catch {
        resolve(null);
      }
    });
    req.on('error', reject);
  });
}

/** Starts the viewer. Answers the server and the address to open. */
export function startViewer(archive, { port = 0, readOnly = false, key = randomBytes(24).toString('base64url') } = {}) {
  let actual = port;
  const server = createServer(viewerHandler(archive, { key, port: () => actual, readOnly }));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      actual = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
      resolve({ server, port: actual, key, url: `http://127.0.0.1:${actual}/#key=${key}` });
    });
  });
}

/** Opens an address in the person's browser (best effort). */
export function openInBrowser(url, platform = process.platform) {
  const [cmd, args] = platform === 'darwin' ? ['open', [url]] : platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
