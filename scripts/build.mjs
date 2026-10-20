#!/usr/bin/env node
// Render data/recs.json into dist/: the landing page plus RSS feeds
// (feed.xml for everything, and podcasts.xml / videos.xml / clips.xml).

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const SITE = 'https://feed.ballot.io';
const TITLE = 'Friendcast';
const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const recs = read('recs.json');
const themes = read('themes.json');
const sources = [...new Set(recs.map((r) => r.source))];
const TAGLINE = 'Podcasts, videos, and clips our friends think are worth your time.';
const dist = new URL('../dist/', import.meta.url);

const FEEDS = [
  { file: 'feed.xml', label: 'Everything', kinds: ['podcast', 'video', 'clip'] },
  { file: 'podcasts.xml', label: 'Podcasts', kinds: ['podcast'] },
  { file: 'videos.xml', label: 'Videos', kinds: ['video'] },
  { file: 'clips.xml', label: 'Clips', kinds: ['clip'] },
];
const KIND_LABEL = { podcast: 'Podcast', video: 'Video', clip: 'Clip' };

const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const duration = (sec) => {
  if (!sec) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}h ${m}m` : m >= 10 ? `${m} min` : `${m}:${String(s).padStart(2, '0')}`;
};
const day = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

// ── RSS ──────────────────────────────────────────────────────────────

function rss({ file, label, kinds }) {
  const items = recs.filter((r) => kinds.includes(r.kind));
  const name = label === 'Everything' ? TITLE : `${TITLE}: ${label}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
  <title>${esc(name)}</title>
  <link>${SITE}/</link>
  <atom:link href="${SITE}/${file}" rel="self" type="application/rss+xml"/>
  <description>${esc(TAGLINE)}</description>
  <language>en-us</language>
  <itunes:author>${esc(list(sources))}</itunes:author>
  <itunes:image href="${SITE}/cover.png"/>
  <lastBuildDate>${new Date(items[0]?.sharedAt ?? Date.now()).toUTCString()}</lastBuildDate>
${items.map(item).join('\n')}
</channel>
</rss>
`;
}

function item(r) {
  const theme = themes.find((t) => t.slug === r.theme);
  const body = [
    r.image && `<p><img src="${esc(r.image)}" alt=""/></p>`,
    `<p><strong>${esc(KIND_LABEL[r.kind])}</strong>${r.show ? ` from ${esc(r.show)}` : ''}${r.durationSec ? `, ${duration(r.durationSec)}` : ''}</p>`,
    r.description && `<p>${esc(r.description)}</p>`,
    `<p>Shared${r.sharedBy ? ` by ${esc(r.sharedBy)}` : ''} in ${esc(r.source)}. <a href="${esc(r.url)}">Open on ${esc(r.platform)}</a></p>`,
  ].filter(Boolean).join('');
  return `  <item>
    <title>${esc(r.title)}</title>
    <link>${esc(r.url)}</link>
    <guid isPermaLink="false">friendcast-${r.id}</guid>
    <pubDate>${new Date(r.sharedAt).toUTCString()}</pubDate>
    <category>${KIND_LABEL[r.kind]}</category>${theme ? `\n    <category>${esc(theme.name)}</category>` : ''}
    <description><![CDATA[${body.replaceAll(']]>', ']]]]><![CDATA[>')}]]></description>${
      r.enclosure ? `\n    <enclosure url="${esc(r.enclosure.url)}" length="0" type="${esc(r.enclosure.type)}"/>` : ''}${
      r.image ? `\n    <itunes:image href="${esc(r.image)}"/>\n    <media:thumbnail url="${esc(r.image)}"/>` : ''}${
      r.durationSec ? `\n    <itunes:duration>${r.durationSec}</itunes:duration>` : ''}
  </item>`;
}

// ── Page ─────────────────────────────────────────────────────────────

const sections = [
  { slug: 'just-in', name: 'Just in', blurb: 'New to the feed and not sorted yet.', items: recs.filter((r) => !themes.some((t) => t.slug === r.theme)) },
  ...themes.map((t) => ({ ...t, items: recs.filter((r) => r.theme === t.slug) })),
].filter((s) => s.items.length);

function card(r) {
  const meta = [r.show, duration(r.durationSec)].filter(Boolean).map(esc).join(' · ');
  return `<li class="card" data-kind="${r.kind}">
  <a href="${esc(r.url)}" target="_blank" rel="noopener">
    <div class="thumb ${r.kind}">${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy">` : ''}<span class="badge">${KIND_LABEL[r.kind]}</span></div>
    <div class="body">
      <h3>${esc(r.title)}</h3>
      ${meta ? `<p class="meta">${meta}</p>` : ''}
      <p class="foot"><span>${esc(r.platform)}</span><span>${r.sharedBy ? `${esc(r.sharedBy)} · ` : ''}${day(r.sharedAt)}${r.reactions ? ` · <span class="hearts" title="${r.reactions} reactions">♥ ${r.reactions}</span>` : ''}</span></p>
    </div>
  </a>
</li>`;
}

const counts = Object.fromEntries(FEEDS.map((f) => [f.label, recs.filter((r) => f.kinds.includes(r.kind)).length]));

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLE} · Friend Recs</title>
<meta name="description" content="${esc(TAGLINE)}">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${esc(TAGLINE)}">
<meta property="og:image" content="${SITE}/cover.png">
${FEEDS.map((f) => `<link rel="alternate" type="application/rss+xml" title="${esc(`${TITLE}: ${f.label}`)}" href="/${f.file}">`).join('\n')}
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏃</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,800&family=Inter:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="hero">
  <div class="wrap">
    <p class="eyebrow">🏃 friend recs</p>
    <h1>${TITLE}</h1>
    <p class="tagline">${esc(TAGLINE)}</p>
    <p class="sources">From ${esc(list(sources))}.</p>
    <div class="subscribe">
      <a class="btn primary" href="/feed.xml">Subscribe via RSS</a>
      <a class="btn" href="/podcasts.xml">Podcasts only</a>
      <button class="btn" id="copy" data-url="${SITE}/feed.xml">Copy feed URL</button>
    </div>
  </div>
</header>
<main class="wrap">
  <nav class="topics" aria-label="Topics">
    ${sections.map((s) => `<a href="#${s.slug}">${esc(s.name)} <span>${s.items.length}</span></a>`).join('\n    ')}
  </nav>
  <nav class="filters" aria-label="Filter recommendations">
    ${FEEDS.map((f, i) => `<button class="chip${i ? '' : ' on'}" data-filter="${i ? f.kinds[0] : 'all'}">${f.label} <span>${counts[f.label]}</span></button>`).join('\n    ')}
  </nav>
${sections.map((s) => `  <section id="${s.slug}">
    <h2>${esc(s.name)}</h2>
    <p class="blurb">${esc(s.blurb)}</p>
    <ul class="grid">
${s.items.map(card).join('\n')}
    </ul>
  </section>`).join('\n')}
</main>
<footer class="wrap">
  <p>Feeds: ${FEEDS.map((f) => `<a href="/${f.file}">${f.file}</a>`).join(' · ')}</p>
  <p>Updated ${day(new Date().toISOString())} · ${recs.length} recommendations · <a href="https://github.com/gsiener/friendcast">Source</a></p>
</footer>
<script>
document.querySelectorAll('.chip').forEach((chip) => chip.addEventListener('click', () => {
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === chip));
  const f = chip.dataset.filter;
  document.querySelectorAll('.card').forEach((c) => (c.hidden = f !== 'all' && c.dataset.kind !== f));
  document.querySelectorAll('main section').forEach((s) => (s.hidden = !s.querySelector('.card:not([hidden])')));
}));
document.getElementById('copy').addEventListener('click', async (e) => {
  try { await navigator.clipboard.writeText(e.target.dataset.url); e.target.textContent = 'Copied!'; }
  catch { location.href = e.target.dataset.url; }
});
</script>
</body>
</html>
`;

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
cpSync(new URL('../static/', import.meta.url), dist, { recursive: true });
writeFileSync(new URL('index.html', dist), page);
for (const f of FEEDS) writeFileSync(new URL(f.file, dist), rss(f));
console.log(`Built ${recs.length} recs in ${sections.length} sections → dist/`);
