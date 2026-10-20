#!/usr/bin/env node
// Pull podcast / video / clip links out of an iMessage group chat and merge
// them into data/recs.json. Only public metadata is stored: no phone numbers,
// no message text. Sharer names come from the gitignored people.local.json.
//
//   node scripts/import-imessage.mjs --chat "Frontier Pacers" [--since 2026-01-01] [--refresh]

import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { URL_RE, ingest, parseArgs, people } from './store.mjs';

const args = parseArgs(process.argv.slice(2));
const chatName = args.chat || 'Frontier Pacers';
const DB = join(homedir(), 'Library/Messages/chat.db');

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

const shares = messages.flatMap((m) =>
  [...new Set(textOf(m).match(URL_RE) || [])].map((url) => ({
    url,
    sharedAt: new Date(m.ts * 1000).toISOString(),
    sharedBy: m.me ? people.me : people[m.handle],
    reactions: m.reactions,
  })),
);

await ingest(shares, { source: chatName, refresh: !!args.refresh });
