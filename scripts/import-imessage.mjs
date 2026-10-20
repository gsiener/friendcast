#!/usr/bin/env node
// Pull podcast / video / clip links out of an iMessage group chat and merge
// them into data/recs.json. Only public metadata is stored: no phone numbers,
// no message text. Sharer names come from the gitignored people.local.json.
//
//   node scripts/import-imessage.mjs --chat "Frontier Pacers" [--since 2026-01-01] [--refresh]

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { classify, enrich, normalizeUrl, recId } from './links.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).join(' ').split('--').filter(Boolean).map((a) => {
    const [k, ...v] = a.trim().split(' ');
    return [k, v.join(' ') || true];
  }),
);
const chatName = args.chat || 'Frontier Pacers';
const DB = join(homedir(), 'Library/Messages/chat.db');
const RECS = new URL('../data/recs.json', import.meta.url);
const PEOPLE = new URL('../people.local.json', import.meta.url);

const people = existsSync(PEOPLE) ? JSON.parse(readFileSync(PEOPLE, 'utf8')) : {};
const recs = existsSync(RECS) ? JSON.parse(readFileSync(RECS, 'utf8')) : [];
const byId = new Map(recs.map((r) => [r.id, r]));

const sql = (q) => JSON.parse(execFileSync('sqlite3', ['-readonly', '-json', DB, q], { maxBuffer: 1 << 28 }).toString() || '[]');
const esc = (s) => s.replace(/'/g, "''");

const [chat] = sql(`select ROWID as id from chat where display_name = '${esc(chatName)}'`);
if (!chat) throw new Error(`No chat named "${chatName}"`);
const since = args.since ? (Date.parse(args.since) / 1000 - 978307200) * 1e9 : 0;

const messages = sql(`
  select m.guid, m.text, hex(m.attributedBody) as body, m.is_from_me as me, h.id as handle,
         m.date / 1000000000 + 978307200 as ts,
         (select count(*) from message r
           where r.associated_message_guid like '%' || m.guid
             and r.associated_message_type between 2000 and 2006) as reactions
  from message m
  join chat_message_join cmj on cmj.message_id = m.ROWID
  left join handle h on h.ROWID = m.handle_id
  where cmj.chat_id = ${chat.id} and m.associated_message_type = 0 and m.date > ${since}
  order by m.date`);

// Newer messages keep their text only in the attributedBody blob.
const textOf = (m) => m.text || (m.body ? Buffer.from(m.body, 'hex').toString('latin1') : '');
const URL_RE = /https?:\/\/[^\s"'<>\u0000-\u001f\u0080-ÿ]+/g;

let added = 0;
for (const m of messages) {
  const urls = new Set((textOf(m).match(URL_RE) || []).map(normalizeUrl).filter(Boolean));
  for (const url of urls) {
    const kind = classify(url);
    if (!kind) continue;
    const id = recId(url);
    const existing = byId.get(id);
    const sharedBy = m.me ? people.me : people[m.handle];
    if (existing && !args.refresh) {
      existing.reactions = Math.max(existing.reactions || 0, m.reactions);
      continue;
    }
    const meta = await enrich(url, kind).catch((e) => {
      console.warn(`  ! ${url}: ${e.message}`);
      return null;
    });
    if (!meta) continue; // e.g. an X post with no video isn't a clip
    const rec = {
      id,
      url,
      sharedAt: new Date(m.ts * 1000).toISOString(),
      ...(sharedBy && { sharedBy }),
      reactions: m.reactions,
      source: chatName,
      ...existing,
      ...meta,
    };
    byId.set(id, rec);
    if (!existing) added++;
    console.log(`+ [${rec.kind}] ${rec.title}`);
  }
}

const out = [...byId.values()].sort((a, b) => b.sharedAt.localeCompare(a.sharedAt));
writeFileSync(RECS, JSON.stringify(out, null, 2) + '\n');
console.log(`\n${added} new, ${out.length} total → data/recs.json`);
