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
    (r.summary || r.description) && `<p>${esc(r.summary || r.description)}</p>`,
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

const LATEST = 8;
const sections = [
  { slug: 'just-in', name: 'Just in', blurb: 'New to the feed and not sorted yet.', items: recs.filter((r) => !themes.some((t) => t.slug === r.theme)) },
  ...themes.map((t) => ({ ...t, items: recs.filter((r) => r.theme === t.slug) })),
].filter((s) => s.items.length);

// How a rec plays in the on-page player, if it can.
function player(r) {
  const u = new URL(r.url);
  if (r.enclosure) return { type: r.enclosure.type.startsWith('video') ? 'video' : 'audio', src: r.enclosure.url };
  if (r.videoUrl) return { type: 'video', src: r.videoUrl };
  if (u.hostname === 'youtube.com') {
    const id = u.searchParams.get('v') || u.pathname.split('/')[2];
    const start = parseInt(u.searchParams.get('t'), 10);
    return id && { type: 'embed', src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1${start ? `&start=${start}` : ''}` };
  }
  const spotify = u.hostname === 'open.spotify.com' && u.pathname.match(/^\/(episode|show)\/(\w+)/);
  if (spotify) return { type: 'embed', src: `https://open.spotify.com/embed/${spotify[1]}/${spotify[2]}`, audio: true };
  if (u.hostname === 'vimeo.com') return { type: 'embed', src: `https://player.vimeo.com/video/${u.pathname.slice(1)}?autoplay=1` };
  return null;
}

function card(r) {
  const p = player(r);
  const len = duration(r.durationSec);
  const data = [
    `data-kind="${r.kind}"`,
    `data-q="${esc(`${r.title} ${r.show || ''} ${r.platform}`.toLowerCase())}"`,
    p && `data-play="${p.type}" data-src="${esc(p.src)}"${p.audio ? ' data-audio' : ''}`,
    `data-title="${esc(r.title)}" data-show="${esc(r.show || '')}" data-platform="${esc(r.platform)}"${r.image ? ` data-image="${esc(r.image)}"` : ''}`,
  ].filter(Boolean).join(' ');
  const foot = `<p class="foot"><span>${esc(r.platform)}</span><span>${r.sharedBy ? `${esc(r.sharedBy)} · ` : ''}${day(r.sharedAt)}${r.reactions ? ` · <span class="hearts" title="${r.reactions} reactions">♥ ${r.reactions}</span>` : ''}</span></p>`;

  // Podcasts lead with the episode, not the (often repeated) show artwork.
  if (r.kind === 'podcast') {
    return `<li class="card podcast" ${data}>
  <a href="${esc(r.url)}" target="_blank" rel="noopener">
    <div class="pod-head">
      ${r.image ? `<img class="art" src="${esc(r.image)}" alt="" loading="lazy">` : '<span class="art"></span>'}
      <div><span class="badge">${p ? '▶ ' : ''}Podcast${len ? ` · ${len}` : ''}</span><p class="meta">${esc(r.show || r.platform)}</p></div>
    </div>
    <div class="body">
      <h3>${esc(r.title)}</h3>
      ${r.summary || r.description ? `<p class="desc">${esc(r.summary || r.description)}</p>` : ''}
      ${foot}
    </div>
  </a>
</li>`;
  }
  return `<li class="card ${r.kind}" ${data}>
  <a href="${esc(r.url)}" target="_blank" rel="noopener">
    <div class="thumb">${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy">` : ''}<span class="badge">${KIND_LABEL[r.kind]}</span>${len ? `<span class="len">${p ? '▶ ' : ''}${len}</span>` : p ? '<span class="len">▶</span>' : ''}</div>
    <div class="body">
      <h3>${esc(r.title)}</h3>
      ${r.show ? `<p class="meta">${esc(r.show)}</p>` : ''}
      ${foot}
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
<meta name="referrer" content="no-referrer">
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
<script src="/app.js" defer></script>
</head>
<body>
<header class="hero">
  <div class="wrap">
    <div>
      <h1>${TITLE}</h1>
      <p class="tagline">${esc(TAGLINE)}</p>
    </div>
    <details class="subscribe">
      <summary class="btn primary">Subscribe</summary>
      <div class="menu">
        <p>Paste a feed into any RSS reader. The podcast feed plays in podcast apps.</p>
        <ul>
          ${FEEDS.map((f) => `<li><a href="/${f.file}">${f.label}</a><button type="button" class="copy" data-url="${SITE}/${f.file}">Copy URL</button></li>`).join('\n          ')}
        </ul>
      </div>
    </details>
  </div>
</header>
<div class="controls">
  <div class="wrap">
    <input type="search" id="q" placeholder="Search ${recs.length} recs" aria-label="Search recommendations" autocomplete="off">
    <div class="chips" role="group" aria-label="Type">
      ${FEEDS.map((f, i) => `<button type="button" class="chip" aria-pressed="${!i}" data-filter="${i ? f.kinds[0] : 'all'}">${i ? f.label : 'All'} <span>${counts[f.label]}</span></button>`).join('\n      ')}
    </div>
    <select id="topic" aria-label="Topic">
      <option value="">All topics</option>
      ${sections.map((s) => `<option value="${s.slug}">${esc(s.name)} (${s.items.length})</option>`).join('\n      ')}
    </select>
  </div>
</div>
<main class="wrap">
  <section id="latest" class="latest">
    <h2>Latest</h2>
    <p class="blurb">The most recent shares from every group.</p>
    <ul class="rail">
${recs.slice(0, LATEST).map(card).join('\n')}
    </ul>
  </section>
${sections.map((s) => `  <section id="${s.slug}" class="topic">
    <h2>${esc(s.name)}</h2>
    <p class="blurb">${esc(s.blurb)}</p>
    <ul class="grid">
${s.items.map(card).join('\n')}
    </ul>
    <button class="more" type="button" hidden>Show all</button>
  </section>`).join('\n')}
  <p class="empty" hidden>Nothing matches. Try another search, type, or topic.</p>
</main>
<footer class="wrap">
  <p>Feeds: ${FEEDS.map((f) => `<a href="/${f.file}">${f.file}</a>`).join(' · ')}</p>
  <p>Updated ${day(new Date().toISOString())} · ${recs.length} recommendations · <a href="https://github.com/gsiener/friendcast">Source</a></p>
</footer>
<dialog id="player" aria-labelledby="player-title">
  <div class="player-head">
    <div>
      <p class="meta" id="player-show"></p>
      <h2 id="player-title"></h2>
    </div>
    <button type="button" class="close" aria-label="Close player">✕</button>
  </div>
  <div class="stage"></div>
  <a class="open-out" href="/" target="_blank" rel="noopener"></a>
</dialog>
</body>
</html>
`;

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
cpSync(new URL('../static/', import.meta.url), dist, { recursive: true });
writeFileSync(new URL('index.html', dist), page);
for (const f of FEEDS) writeFileSync(new URL(f.file, dist), rss(f));
console.log(`Built ${recs.length} recs in ${sections.length} sections → dist/`);
