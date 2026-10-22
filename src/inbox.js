// An inbox folder: drop a ChatGPT or Claude export (.zip) in it, and it comes into the archive by
// itself. `chatatlas-local watch <folder>` and the MCP server's --inbox use this. Every file is
// looked at once (as long as it doesn't change); files that aren't exports are left alone.

import { readdirSync, statSync, watch } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { readExport } from './importers.js';

/** Files bigger than this aren't opened (exports with years of chats are well under it). */
export const MAX_INBOX_BYTES = 2 * 1024 ** 3;

/** The files in a folder that could be an export: .zip and .json, newest first. */
export function candidates(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const ext = extname(name).toLowerCase();
    if (ext !== '.zip' && ext !== '.json') continue;
    const path = join(dir, name);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (!st.isFile() || st.size === 0 || st.size > MAX_INBOX_BYTES) continue;
    out.push({ path, size: st.size, mtime: st.mtimeMs });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/**
 * Brings in every export in `dir` it hasn't looked at yet. Answers what happened to each file it
 * looked at this time.
 */
export function scanInbox(archive, dir, { log = /** @type {(message: string) => void} */ (() => {}) } = {}) {
  const results = [];
  for (const f of candidates(resolve(dir))) {
    if (archive.seenFile(f.path, f.size, f.mtime)) continue;
    let result;
    try {
      const r = readExport(f.path);
      const counts = archive.upsert(r.chats);
      archive.logImport(f.path, r.kind, counts);
      result = { file: f.path, kind: r.kind, ...counts };
      log(`${f.path}: ${r.kind}, ${counts.added} new, ${counts.updated} updated, ${counts.unchanged} already here`);
    } catch (err) {
      result = { file: f.path, skipped: err.message };
    }
    archive.markSeen(f.path, f.size, f.mtime, result.kind ? 'imported' : 'not an export');
    results.push(result);
  }
  return results;
}

/**
 * Scans now, then again whenever the folder changes (once a file has stopped growing). Answers a
 * function that stops watching.
 */
export function watchInbox(archive, dir, { log = /** @type {(message: string) => void} */ (() => {}), settleMs = 3000 } = {}) {
  scanInbox(archive, dir, { log });
  let timer = null;
  const again = () => {
    clearTimeout(timer);
    // A download in progress keeps changing; look once it's been quiet for a moment.
    timer = setTimeout(() => {
      try {
        scanInbox(archive, dir, { log });
      } catch (err) {
        log(`Couldn't look in ${dir}: ${err.message}`);
      }
    }, settleMs);
  };
  const w = watch(resolve(dir), { persistent: false }, again);
  w.on('error', (err) => log(`Stopped watching ${dir}: ${err.message}`));
  return () => {
    clearTimeout(timer);
    w.close();
  };
}
