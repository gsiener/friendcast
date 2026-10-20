// Friendcast page behavior: search, kind filter, per-topic previews,
// URL state, and the on-page player.

const PREVIEW = 6;
const params = new URLSearchParams(location.search);
const state = {
  kind: params.get('kind') || 'all',
  q: params.get('q') || '',
  topic: params.get('topic') || '',
  open: new Set((params.get('open') || '').split(',').filter(Boolean)),
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

function matches(card) {
  return (state.kind === 'all' || card.dataset.kind === state.kind) && (!state.q || card.dataset.q.includes(state.q.toLowerCase()));
}

function render() {
  const searching = !!state.q;
  $('#latest').hidden = searching || !!state.topic || !$$('#latest .card').some(matches);
  $$('#latest .card').forEach((c) => (c.hidden = !matches(c)));

  let any = false;
  for (const s of $$('section.topic')) {
    const hits = $$('.card', s).filter(matches);
    const open = searching || state.topic === s.id || state.open.has(s.id);
    $$('.card', s).forEach((c) => (c.hidden = true));
    hits.forEach((c, i) => (c.hidden = !open && i >= PREVIEW));
    s.hidden = !hits.length || (!!state.topic && state.topic !== s.id);
    any ||= !s.hidden;
    const more = $('.more', s);
    more.hidden = searching || !!state.topic || hits.length <= PREVIEW;
    more.textContent = open ? 'Show fewer' : 'Show all ' + hits.length;
    more.setAttribute('aria-expanded', open);
  }
  $('.empty').hidden = any;
  $('#topic').value = state.topic;
  $$('.chip').forEach((c) => c.setAttribute('aria-pressed', c.dataset.filter === state.kind));

  const p = new URLSearchParams();
  if (state.kind !== 'all') p.set('kind', state.kind);
  if (state.q) p.set('q', state.q);
  if (state.topic) p.set('topic', state.topic);
  if (state.open.size) p.set('open', [...state.open].join(','));
  history.replaceState(null, '', (p.size ? '?' + p : location.pathname) + location.hash);
}

$$('.chip').forEach((chip) => chip.addEventListener('click', () => {
  state.kind = chip.dataset.filter;
  render();
}));

const q = $('#q');
q.value = state.q;
q.addEventListener('input', () => {
  state.q = q.value.trim();
  render();
});

$('#topic').addEventListener('change', (e) => {
  state.topic = e.target.value;
  render();
  scrollTo({ top: $('.controls').offsetTop });
});

$$('.more').forEach((b) => b.addEventListener('click', () => {
  const s = b.closest('section');
  state.open.has(s.id) ? state.open.delete(s.id) : state.open.add(s.id);
  render();
  if (!state.open.has(s.id)) s.scrollIntoView({ block: 'start' });
}));

$$('.copy').forEach((b) => b.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(b.dataset.url);
    b.textContent = 'Copied';
    setTimeout(() => (b.textContent = 'Copy URL'), 1500);
  } catch {
    location.href = b.dataset.url;
  }
}));
// Close the subscribe menu on outside click or Escape.
const menu = $('.subscribe');
document.addEventListener('click', (e) => menu.open && !menu.contains(e.target) && (menu.open = false));
document.addEventListener('keydown', (e) => e.key === 'Escape' && (menu.open = false));

// ── Player ─────────────────────────────────────────────────────────

const dialog = $('#player');
const stage = $('.stage', dialog);

function play(card) {
  const { play: type, src, title, show, platform, image } = card.dataset;
  $('#player-title').textContent = title;
  $('#player-show').textContent = show;
  const out = $('.open-out', dialog);
  out.href = $('a', card).href;
  out.textContent = 'Open on ' + platform;
  stage.className = 'stage ' + (type === 'audio' || 'audio' in card.dataset ? 'is-audio' : 'is-video');
  stage.replaceChildren();

  if (type === 'embed') {
    const f = document.createElement('iframe');
    f.src = src;
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.referrerPolicy = 'strict-origin-when-cross-origin'; // YouTube refuses embeds without a referrer
    f.title = title;
    stage.append(f);
  } else {
    if (type === 'audio' && image) {
      const art = document.createElement('img');
      art.src = image;
      art.alt = '';
      stage.append(art);
    }
    const m = document.createElement(type);
    m.src = src;
    m.controls = true;
    m.autoplay = true;
    m.playsInline = true;
    if (type === 'video' && image) m.poster = image;
    stage.append(m);
  }
  dialog.showModal();
}

// 'close' fires async; don't wipe a player that was reopened in the meantime.
dialog.addEventListener('close', () => dialog.open || stage.replaceChildren());
$('.close', dialog).addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());

document.addEventListener('click', (e) => {
  const card = e.target.closest('.card[data-play]');
  if (!card || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  play(card);
});

render();
