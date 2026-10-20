// data/recs.json read/merge/write, shared by every importer.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { classify, enrich, normalizeUrl, recId } from './links.mjs';

const RECS = new URL('../data/recs.json', import.meta.url);
const PEOPLE = new URL('../people.local.json', import.meta.url);

export const people = existsSync(PEOPLE) ? JSON.parse(readFileSync(PEOPLE, 'utf8')) : {};
export const URL_RE = /https?:\/\/[^\s"'<>\u0000-\u001f\u0080-ÿ]+/g;

export function parseArgs(argv) {
  return Object.fromEntries(
    argv.join(' ').split('--').filter(Boolean).map((a) => {
      const [k, ...v] = a.trim().split(' ');
      return [k, v.join(' ') || true];
    }),
  );
}

// shares: [{ url, sharedAt (ISO), sharedBy?, reactions? }]
export async function ingest(shares, { source, refresh = false }) {
  const recs = existsSync(RECS) ? JSON.parse(readFileSync(RECS, 'utf8')) : [];
  const byId = new Map(recs.map((r) => [r.id, r]));
  let added = 0;

  // First share of each link wins (shares arrive oldest first).
  const todo = new Map();
  for (const share of shares) {
    const url = normalizeUrl(share.url);
    const kind = url && classify(url);
    if (!kind) continue;
    const id = recId(url);
    const existing = byId.get(id);
    if (existing && !refresh) {
      existing.reactions = Math.max(existing.reactions || 0, share.reactions || 0);
      continue;
    }
    if (!todo.has(id)) todo.set(id, { ...share, url, kind, id, existing });
  }

  const queue = [...todo.values()];
  const worker = async () => {
    for (let s; (s = queue.shift()); ) await add(s);
  };
  await Promise.all(Array.from({ length: 6 }, worker));

  async function add({ url, kind, id, existing, ...share }) {
    const meta = await enrich(url, kind).catch((e) => {
      console.warn(`  ! ${url}: ${e.message}`);
      return null;
    });
    if (!meta) return; // e.g. an X post with no video isn't a clip
    const rec = {
      id,
      url,
      sharedAt: share.sharedAt,
      ...(share.sharedBy && { sharedBy: share.sharedBy }),
      reactions: share.reactions || 0,
      source,
      ...existing,
      ...meta,
    };
    byId.set(id, rec);
    if (!existing) added++;
    console.log(`+ [${rec.kind}] ${rec.title}`);
  }

  const out = [...byId.values()].sort((a, b) => b.sharedAt.localeCompare(a.sharedAt));
  writeFileSync(RECS, JSON.stringify(out, null, 2) + '\n');
  console.log(`\n${added} new, ${out.length} total → data/recs.json`);
}
