#!/usr/bin/env node
// Import links from any pasted text: a Signal / WhatsApp / Slack copy-paste,
// an export file, or a plain list of URLs. Reads a file or stdin.
//
//   pbpaste | node scripts/import-text.mjs --source "Gotham AI Nerds (GAIN)"
//   node scripts/import-text.mjs --source "GAIN" --file links.txt [--date 2026-10-01]
//
// A line can start with an ISO-ish date ("2026-10-14", "2026-10-14 09:30")
// and links on that line, and the lines after it, are dated to it.

import { readFileSync } from 'node:fs';
import { URL_RE, ingest, parseArgs } from './store.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.source) throw new Error('--source "<group name>" is required');
const text = readFileSync(args.file || 0, 'utf8');

let current = args.date ? new Date(args.date) : new Date();
const shares = [];
for (const line of text.split('\n')) {
  const stamp = line.match(/\b(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?/);
  if (stamp) current = new Date(`${stamp[1]}T${stamp[2]?.padStart(5, '0') ?? '12:00'}:00`);
  for (const url of line.match(URL_RE) || []) shares.push({ url, sharedAt: current.toISOString() });
}

await ingest(shares, { source: args.source, refresh: !!args.refresh });
