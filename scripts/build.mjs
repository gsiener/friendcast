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
const PACE = 330; // seconds per km: an easy 5:30/km

const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const duration = (sec) => {
  if (!sec) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h} hr ${m} min` : m >= 10 ? `${m} min` : `${m}:${String(s).padStart(2, '0')}`;
};
const distance = (sec) => {
  if (!sec) return null;
  const km = sec / PACE;
  return km < 1 ? { n: Math.max(50, Math.round((km * 1000) / 50) * 50), unit: 'm' } : { n: km.toFixed(1), unit: 'km' };
};
const day = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

function row(r) {
  const d = distance(r.durationSec);
  return `<li class="rec" data-kind="${r.kind}">
  <a href="${esc(r.url)}" target="_blank" rel="noopener">
    <span class="thumb">${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy">` : ''}</span>
    <span class="what">
      <span class="kind ${r.kind}">${KIND_LABEL[r.kind]}</span>
      <span class="title">${esc(r.title)}</span>
      <span class="by">${esc(r.show || r.platform)}</span>
      <span class="when">${r.sharedBy ? `${esc(r.sharedBy)}, ` : ''}${day(r.sharedAt)}${r.reactions ? `<span class="hearts" title="${r.reactions} ${r.reactions === 1 ? 'reaction' : 'reactions'} in the chat">♥ ${r.reactions}</span>` : ''}</span>
    </span>
    ${d ? `<span class="dist" title="${duration(r.durationSec)} at 5:30/km"><b>${d.n}</b><small>${d.unit}</small><span>${duration(r.durationSec)}</span></span>` : '<span class="dist none"></span>'}
  </a>
</li>`;
}

const totalKm = Math.round(recs.reduce((s, r) => s + (r.durationSec || 0), 0) / PACE);

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLE}</title>
<meta name="description" content="${esc(TAGLINE)}">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${esc(TAGLINE)}">
<meta property="og:image" content="${SITE}/cover.png">
${FEEDS.map((f) => `<link rel="alternate" type="application/rss+xml" title="${esc(`${TITLE}: ${f.label}`)}" href="/${f.file}">`).join('\n')}
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏃</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;900&family=Instrument+Sans:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="track">
  <div class="wrap">
    <h1>${TITLE}</h1>
    <p class="lede">${esc(TAGLINE)} Pulled from ${esc(list(sources))}, sorted by topic, and measured in how far you’d run before each one ends.</p>
    <div class="actions">
      <a class="btn go" href="/feed.xml">Subscribe to everything</a>
      <a class="btn" href="/podcasts.xml">Podcasts only</a>
      <button class="btn" type="button" id="copy" data-url="${SITE}/feed.xml">Copy feed URL</button>
    </div>
  </div>
  <nav class="lanes" aria-label="Topics">
    ${sections.map((s) => `<a class="lane" href="#${s.slug}"><span class="wrap"><span>${esc(s.name)}</span><span class="count">${s.items.length}</span></span></a>`).join('\n    ')}
  </nav>
</header>

<div class="bar">
  <div class="wrap">
    <div class="filters" role="group" aria-label="Show">
      ${FEEDS.map((f, i) => `<button type="button" class="chip" aria-pressed="${!i}" data-filter="${i ? f.kinds[0] : 'all'}">${f.label}</button>`).join('\n      ')}
    </div>
    <p class="pace">${recs.length} recs, about ${totalKm} km of listening at 5:30/km</p>
  </div>
</div>

<main class="wrap">
${sections.map((s) => `  <section id="${s.slug}">
    <header><h2>${esc(s.name)}</h2><p>${esc(s.blurb)}</p></header>
    <ol>
${s.items.map(row).join('\n')}
    </ol>
  </section>`).join('\n')}
</main>

<footer class="wrap">
  <p>Every list is also an RSS feed: ${FEEDS.map((f) => `<a href="/${f.file}">${f.label.toLowerCase()}</a>`).join(', ')}. Podcast episodes include audio, so the podcasts feed plays in any podcast app.</p>
  <p><a href="https://github.com/gsiener/friendcast">Source on GitHub</a></p>
</footer>
<script>
const chips = document.querySelectorAll('.chip');
chips.forEach((chip) => chip.addEventListener('click', () => {
  chips.forEach((c) => c.setAttribute('aria-pressed', c === chip));
  const f = chip.dataset.filter;
  document.querySelectorAll('.rec').forEach((r) => (r.hidden = f !== 'all' && r.dataset.kind !== f));
  document.querySelectorAll('main section').forEach((s) => (s.hidden = !s.querySelector('.rec:not([hidden])')));
}));
document.getElementById('copy').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  try { await navigator.clipboard.writeText(b.dataset.url); b.textContent = 'Feed URL copied'; }
  catch { location.href = b.dataset.url; }
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
