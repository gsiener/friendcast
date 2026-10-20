// URL classification + metadata lookup for podcast, video, and clip links.

import { createHash } from 'node:crypto';

const TRACKING = /^(utm_\w+|si|is|s|igsh|igshid|feature|ref|ref_src|fbclid)$/;

export function normalizeUrl(raw) {
  try {
    const u = new URL(raw.replace(/[).,;!?]+$/, ''));
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.replace(/^(www|m|mobile)\./, '').replace(/^twitter\.com$/, 'x.com');
    if (u.hostname === 'youtu.be') {
      const t = u.searchParams.get('t');
      return `https://youtube.com/watch?v=${u.pathname.slice(1)}${t ? `&t=${t}` : ''}`;
    }
    return u.toString();
  } catch {
    return null;
  }
}

export const recId = (url) => createHash('sha1').update(url).digest('hex').slice(0, 12);

const RULES = [
  ['podcast', /podcasts\.apple\.com\/.*[?&]i=\d+/],
  ['podcast', /open\.spotify\.com\/(episode|show)\//],
  ['podcast', /(overcast\.fm\/\+|pca\.st\/|pocketcasts\.com\/)/],
  ['clip', /youtube\.com\/shorts\//],
  ['clip', /(tiktok\.com\/|instagram\.com\/(reel|p)\/)/],
  ['clip', /x\.com\/\w+\/status\/\d+/], // kept only if the post has video
  ['video', /youtube\.com\/(watch|live)/],
  ['video', /vimeo\.com\/\d+/],
];

export const classify = (url) => RULES.find(([, re]) => re.test(url))?.[0] ?? null;

const UA = { 'user-agent': 'friendcast/1.0 (+https://feed.ballot.io)' };
const json = async (url) => {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};

export async function enrich(url, kind) {
  const host = new URL(url).hostname;
  if (host === 'podcasts.apple.com') return applePodcast(url);
  if (host === 'youtube.com') return youtube(url, kind);
  if (host === 'x.com') return xPost(url);
  if (host === 'open.spotify.com') return oembed(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, kind, 'Spotify');
  if (host === 'vimeo.com') return oembed(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`, kind, 'Vimeo');
  return openGraph(url, kind);
}

async function applePodcast(url) {
  const u = new URL(url);
  const show = u.pathname.match(/id(\d+)/)?.[1];
  const ep = Number(u.searchParams.get('i'));
  const { results } = await json(`https://itunes.apple.com/lookup?id=${show}&entity=podcastEpisode&limit=200`);
  const e = results.find((r) => r.trackId === ep);
  if (!e) return openGraph(url, 'podcast');
  return {
    kind: 'podcast',
    title: e.trackName,
    show: e.collectionName,
    description: e.shortDescription || e.description?.slice(0, 400),
    image: e.artworkUrl600,
    published: e.releaseDate,
    durationSec: e.trackTimeMillis ? Math.round(e.trackTimeMillis / 1000) : undefined,
    enclosure: e.episodeUrl && { url: e.episodeUrl, type: e.episodeContentType === 'video' ? 'video/mp4' : 'audio/mpeg' },
    platform: 'Apple Podcasts',
  };
}

async function youtube(url, kind) {
  const o = await json(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
  return { kind, title: o.title, show: o.author_name, image: o.thumbnail_url, platform: 'YouTube' };
}

async function xPost(url) {
  const id = url.match(/status\/(\d+)/)[1];
  const { tweet } = await json(`https://api.fxtwitter.com/status/${id}`);
  const video = tweet?.media?.videos?.[0];
  if (!video) return null;
  const text = tweet.text.replace(/\s*https:\/\/t\.co\/\S+$/, '');
  const line = text.replace(/\s+/g, ' ').trim();
  return {
    kind: 'clip',
    title: line.length > 120 ? `${line.slice(0, 117).trimEnd()}…` : line,
    description: text,
    show: `${tweet.author.name} (@${tweet.author.screen_name})`,
    image: video.thumbnail_url,
    published: new Date(tweet.created_timestamp * 1000).toISOString(),
    durationSec: Math.round(video.duration),
    platform: 'X',
  };
}

async function oembed(endpoint, kind, platform) {
  const o = await json(endpoint);
  return { kind, title: o.title, show: o.author_name || o.provider_name, image: o.thumbnail_url, platform };
}

async function openGraph(url, kind) {
  const html = await (await fetch(url, { headers: UA })).text();
  const og = (p) =>
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']og:${p}["'][^>]+content=["']([^"']*)`, 'i'))?.[1];
  const title = og('title') || html.match(/<title>([^<]*)/i)?.[1];
  if (!title) return null;
  return { kind, title: decode(title), description: og('description') && decode(og('description')), image: og('image'), platform: og('site_name') || new URL(url).hostname };
}

const decode = (s) =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
