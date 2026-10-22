// The MCP server over stdio: the assistant (Claude Desktop, Claude Code, Cursor…) starts this as a
// program and talks to it in newline-delimited JSON-RPC on stdin and stdout. Nothing goes over the
// network. Logs go to stderr, never stdout, which belongs to the protocol.

import { createInterface } from 'node:readline';
import { ERRORS, answer, readMessage, rpcError } from './protocol.js';
import { runTool } from './tools.js';

/**
 * Serves MCP on the given streams until the input ends. `getArchive` opens the archive the first
 * time a tool needs it (so a client that only lists tools never touches the file).
 */
export function serveStdio({ getArchive, input = process.stdin, output = process.stdout }) {
  let archive = null;
  const callTool = (name, args) => {
    archive ??= getArchive();
    return runTool(archive, name, args);
  };
  const send = (msg) => {
    output.write(`${JSON.stringify(msg)}\n`);
  };
  const rl = createInterface({ input, crlfDelay: Infinity });
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();

  rl.on('line', (line) => {
    if (!line.trim()) return;
    // One message at a time, in order: answers go out in the order questions came in.
    queue = queue.then(() => handle(line)).catch((err) => process.stderr.write(`[chatatlas-local] ${err?.stack ?? err}\n`));
  });

  async function handle(line) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return send(rpcError(null, ERRORS.parse, "That wasn't JSON."));
    }
    const batch = Array.isArray(parsed);
    const answers = [];
    for (const item of batch ? parsed : [parsed]) {
      const msg = readMessage(item);
      if (!msg) {
        // A reply to something we never asked (we ask nothing), or not JSON-RPC at all.
        if (item && typeof item === 'object' && ('result' in item || 'error' in item)) continue;
        answers.push(rpcError(item?.id ?? null, ERRORS.invalidRequest, "That isn't a JSON-RPC request."));
        continue;
      }
      const a = await answer(msg, callTool);
      if (a) answers.push(a);
    }
    if (answers.length === 0) return;
    send(batch ? answers : answers[0]);
  }

  return new Promise((resolve) => {
    rl.on('close', () => {
      queue.finally(() => {
        try {
          archive?.close();
        } catch {
          /* already closed */
        }
        resolve(undefined);
      });
    });
  });
}
