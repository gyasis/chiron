'use strict';
/* "Ascolta" (the lesson overlay's Play tab) — ONE playlist player for the whole lesson.
 *
 * The playlist is built from the lesson's own audio manifest (audio/manifest.js, which only sets
 * window.__chironAudioManifest, or audio/manifest.json): riepilogo -> every section clip in manifest (= lesson) order ->
 * drill Pimsleur -> lezione completa. Missing / unfinished clips are skipped.
 *
 * Playback uses a single <audio> element that lives in the app shell (NOT in the lesson iframe), so it survives closing the
 * lesson, hiding the iframe and (where the WebView allows) a locked screen; MediaSession gives lock-screen controls.
 * Resume position is cached per lesson in localStorage and mirrored (best effort) to the hub progress API, key
 * "chiron-play-<slug>". Pure parts (parseManifest, buildPlaylist) are exported for skill/tests/play-playlist.test.mjs.
 * Uses app.js globals when present: askBase, toast.
 */
(function (root) {
  const KIND = {   // artifact -> [rank, Italian label]; section kinds keep manifest order inside rank 1
    summary: [0, 'Riepilogo'], dialogue: [1, 'Dialogo'], 'story-verbatim': [1, 'Storia'], 'story-description': [1, 'Descrizione'],
    'grammar-pearl': [1, 'Perla grammaticale'], phrase: [1, 'Frase'], section: [1, 'Sezione'],
    pimsleur: [2, 'Drill Pimsleur'], shortened: [3, 'Lezione completa'],
  };
  const PASSAGE = { 'passage-fast': 'La frase · veloce', 'passage-slow': 'La frase · lenta e scandita' };
  const GROUP = ['Introduzione', 'Sezioni', 'Drill Pimsleur', 'Lezione completa'];

  /** audio/manifest.js is `window.__chironAudioManifest = {...};` — read the JSON literal, never eval it. */
  function parseManifest(text) {
    let s = String(text || '').trim();
    const eq = s.indexOf('=');
    if (s[0] !== '{' && eq >= 0 && /__chironAudioManifest/.test(s.slice(0, eq))) s = s.slice(eq + 1).trim();
    s = s.replace(/;\s*$/, '');
    const m = JSON.parse(s);
    if (!m || !Array.isArray(m.clips)) throw new Error('manifest has no clips');
    return m;
  }

  function humanize(id) {
    const t = String(id || '').replace(/^(dlg|story|storydesc|pearl|instr|vocab|q)-/, '').replace(/[-_]+/g, ' ').trim();
    return t ? t[0].toUpperCase() + t.slice(1) : '';
  }
  const encPath = p => String(p).split('/').map(encodeURIComponent).join('/');

  /** manifest -> ordered playlist [{url, path, title, kind, group, dur}] */
  function buildPlaylist(manifest, baseUrl) {
    const base = String(baseUrl || '').replace(/[^/]*$/, '');   // directory of the lesson page, trailing slash kept
    const seen = new Set();
    const items = [];
    (manifest && manifest.clips || []).forEach((c, i) => {
      if (!c || c.status !== 'done' || !c.audioPath || !KIND[c.artifact] || seen.has(c.audioPath)) return;
      seen.add(c.audioPath);
      const [rank, label] = KIND[c.artifact];
      let title = c.label || label;
      if (!c.label && c.artifact !== 'summary' && c.artifact !== 'shortened' && c.artifact !== 'pimsleur') {
        title = PASSAGE[c.sectionId] || (humanize(c.sectionId) ? label + ' · ' + humanize(c.sectionId) : label);
      }
      items.push({ url: base + encPath(c.audioPath), path: c.audioPath, title, kind: c.artifact, group: GROUP[rank], rank, dur: +c.durationS || 0, i });
    });
    items.sort((a, b) => a.rank - b.rank || a.i - b.i);   // stable by manifest position inside a rank
    return items;
  }

  const api = { parseManifest, buildPlaylist, KIND };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ChironPlay = api;
  if (typeof document === 'undefined' || !document.getElementById('pl-list')) return;

  /* ---------------- player (browser only) ---------------- */
  const $ = id => document.getElementById(id);
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const say = m => { if (typeof toast === 'function') toast(m); else console.warn('chiron play:', m); };
  const hub = () => (typeof askBase === 'function' ? askBase() : '') + '/api/progress/';
  const ICON = {
    play: '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>',
  };

  const audio = document.createElement('audio');
  audio.preload = 'metadata'; audio.id = 'pl-audio'; document.body.appendChild(audio);

  let S = { slug: null, title: '', sub: '', items: [], idx: -1, rate: +ls.get('chiron.play.rate') || 1, errs: 0, seeking: false, resumeAt: 0, lastSave: 0 };
  const posKey = () => 'chiron.play.' + S.slug;

  function save(force) {
    if (!S.slug || S.idx < 0) return;
    const now = Date.now();
    if (!force && now - S.lastSave < 4000) return;
    const v = { path: S.items[S.idx].path, t: Math.floor(audio.currentTime || 0), ts: now };
    ls.set(posKey(), JSON.stringify(v));
    if (force || now - S.lastSave >= 20000) {   // the hub copy is best effort and coarser
      fetch(hub() + 'chiron-play-' + S.slug, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries: { cur: { v, t: now } } }) })
        .catch(e => console.warn('chiron play: hub save failed —', e.message));
    }
    S.lastSave = now;
  }
  async function loadSaved() {
    let local = null; try { local = JSON.parse(ls.get(posKey()) || 'null'); } catch (e) {}
    let remote = null;
    try {
      const ac = new AbortController(), t = setTimeout(() => ac.abort(), 2000);
      const r = await fetch(hub() + 'chiron-play-' + S.slug, { cache: 'no-store', signal: ac.signal }); clearTimeout(t);
      if (r.ok) { const e = ((await r.json()).entries || {}).cur; remote = e && e.v; }
    } catch (e) { /* offline or hub down: local copy only */ }
    return [local, remote].filter(x => x && x.path).sort((a, b) => (b.ts || 0) - (a.ts || 0))[0] || null;
  }

  function render() {
    const it = S.items[S.idx], n = S.items.length;
    $('pl-cover').textContent = S.title || '—';
    $('pl-t').textContent = it ? it.title : (n ? 'Scegli una traccia' : 'Nessun audio per questa lezione');
    $('pl-s').textContent = it ? `${S.idx + 1} di ${n} · ${it.group}` : (S.sub || '');
    $('pl-btn').innerHTML = audio.paused ? ICON.play : ICON.pause;
    $('pl-btn').setAttribute('aria-label', audio.paused ? 'Riproduci' : 'Pausa');
    $('pl-prev').disabled = S.idx <= 0; $('pl-next').disabled = S.idx < 0 || S.idx >= n - 1;
    document.querySelectorAll('#pl-speed button').forEach(b => b.classList.toggle('on', +b.dataset.r === S.rate));
    document.querySelectorAll('#pl-list .pli').forEach(el => {
      const cur = +el.dataset.i === S.idx; el.classList.toggle('cur', cur); el.setAttribute('aria-current', cur ? 'true' : 'false');
    });
  }
  function renderList() {
    let g = '', h = '';
    S.items.forEach((it, i) => {
      if (it.group !== g) { g = it.group; h += `<div class="plg">${esc(g)}</div>`; }
      h += `<button class="pli" data-i="${i}"><span class="pln">${i + 1}</span><span class="plt">${esc(it.title)}</span><span class="pld">${it.dur ? fmt(it.dur) : ''}</span></button>`;
    });
    $('pl-list').innerHTML = h || '<div class="empty">Nessun audio per questa lezione.</div>';
    $('pl-list').querySelectorAll('.pli').forEach(b => b.onclick = () => select(+b.dataset.i, 0, true));
  }
  function progress() {
    const d = audio.duration, it = S.items[S.idx], tot = isFinite(d) && d > 0 ? d : (it ? it.dur : 0), cur = audio.currentTime || 0;
    if (!S.seeking) { $('pl-seek').max = String(tot || 1); $('pl-seek').value = String(cur); }
    $('pl-cur').textContent = fmt(S.seeking ? +$('pl-seek').value : cur); $('pl-rem').textContent = tot ? fmt(tot) : '—';
    $('pl-seek').style.setProperty('--p', tot ? Math.min(100, 100 * (S.seeking ? +$('pl-seek').value : cur) / tot) + '%' : '0%');
    if ('mediaSession' in navigator && tot && navigator.mediaSession.setPositionState) {
      try { navigator.mediaSession.setPositionState({ duration: tot, playbackRate: audio.playbackRate || 1, position: Math.min(cur, tot) }); } catch (e) {}
    }
  }
  function meta() {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    const it = S.items[S.idx]; if (!it) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: it.title, artist: 'Chiron', album: S.title });
  }

  function select(i, at, play) {
    if (i < 0 || i >= S.items.length) return;
    S.idx = i; S.resumeAt = at || 0; S.errs = play ? 0 : S.errs;
    audio.src = S.items[i].url; audio.playbackRate = S.rate;
    audio.load();
    if (play) audio.play().catch(e => console.warn('chiron play: play() refused —', e && e.name));
    meta(); render(); progress(); save(true);
    const cur = document.querySelector('#pl-list .pli.cur'); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  }
  const toggle = () => { if (S.idx < 0) { if (S.items.length) select(0, 0, true); return; } if (audio.paused) audio.play().catch(() => {}); else audio.pause(); };
  const step = d => { if (S.idx + d >= 0 && S.idx + d < S.items.length) select(S.idx + d, 0, true); };

  audio.addEventListener('loadedmetadata', () => { if (S.resumeAt > 0 && S.resumeAt < audio.duration - 1) audio.currentTime = S.resumeAt; S.resumeAt = 0; audio.playbackRate = S.rate; progress(); });
  audio.addEventListener('timeupdate', () => { progress(); save(false); });
  audio.addEventListener('play', () => { S.errs = 0; render(); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; });
  audio.addEventListener('pause', () => { render(); save(true); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; });
  audio.addEventListener('ended', () => { if (S.idx < S.items.length - 1) select(S.idx + 1, 0, true); else { render(); save(true); } });
  audio.addEventListener('error', () => {   // a missing / unreadable clip is skipped, but never loop through a dead library
    const it = S.items[S.idx]; console.warn('chiron play: cannot load', it && it.url, audio.error && audio.error.code);
    if (++S.errs >= 3) { say('Audio non raggiungibile'); render(); return; }
    say('Traccia non disponibile, salto'); if (S.idx < S.items.length - 1) select(S.idx + 1, 0, true);
  });

  $('pl-btn').onclick = toggle; $('pl-prev').onclick = () => step(-1); $('pl-next').onclick = () => step(1);
  $('pl-back').onclick = () => { audio.currentTime = Math.max(0, audio.currentTime - 15); };
  $('pl-fwd').onclick = () => { audio.currentTime = Math.min(audio.duration || 1e9, audio.currentTime + 15); };
  $('pl-seek').addEventListener('input', () => { S.seeking = true; progress(); });
  $('pl-seek').addEventListener('change', () => { audio.currentTime = +$('pl-seek').value; S.seeking = false; progress(); });
  document.querySelectorAll('#pl-speed button').forEach(b => b.onclick = () => {
    S.rate = +b.dataset.r; audio.playbackRate = S.rate; ls.set('chiron.play.rate', String(S.rate)); render();
  });
  if ('mediaSession' in navigator) {
    const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) {} };
    h('play', () => audio.play().catch(() => {})); h('pause', () => audio.pause());
    h('previoustrack', () => step(-1)); h('nexttrack', () => step(1));
    h('seekbackward', () => { audio.currentTime = Math.max(0, audio.currentTime - 15); }); h('seekforward', () => { audio.currentTime += 15; });
    h('seekto', e => { if (e && e.seekTime != null) audio.currentTime = e.seekTime; });
  }

  /** manifest.js without fetch: a <script> tag needs no CORS (used for lesson:// copies the WebView will not let fetch read). */
  function viaScript(url) {
    return new Promise((res, rej) => {
      const prev = window.__chironAudioManifest; delete window.__chironAudioManifest;
      const s = document.createElement('script'); s.src = url;
      s.onload = () => { const m = window.__chironAudioManifest; window.__chironAudioManifest = prev; s.remove(); m ? res(m) : rej(new Error('script set no manifest')); };
      s.onerror = () => { window.__chironAudioManifest = prev; s.remove(); rej(new Error('script failed')); };
      document.head.appendChild(s);
    });
  }
  async function fetchManifest(base) {
    const tries = [async () => parseManifest(await (await okFetch(base + 'audio/manifest.js')).text()),
                   async () => parseManifest(await (await okFetch(base + 'audio/manifest.json')).text()),
                   () => viaScript(base + 'audio/manifest.js')];
    let last; for (const t of tries) { try { return await t(); } catch (e) { last = e; } }
    throw last;
  }
  async function okFetch(u) { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + u); return r; }

  /** Called by app.js openLesson. `pageUrl` is the lesson page actually shown (streamed or lesson://). Does NOT autoplay. */
  let loadSeq = 0;
  api.load = async function ({ slug, title, sub, pageUrl }) {
    if (S.slug === slug && S.items.length) { S.title = title; render(); return; }   // same lesson: keep playing
    const seq = ++loadSeq;
    if (S.slug && S.slug !== slug) { save(true); audio.pause(); }
    S = Object.assign(S, { slug, title, sub, items: [], idx: -1, errs: 0, resumeAt: 0, lastSave: 0 });
    audio.removeAttribute('src'); audio.load();
    $('pl-list').innerHTML = '<div class="empty">Carico la playlist…</div>'; render(); progress();
    try {
      const dir = String(pageUrl).split(/[?#]/)[0].replace(/[^/]*$/, '');   // the lesson's directory, trailing slash kept
      const m = await fetchManifest(dir);
      if (seq !== loadSeq) return;
      S.items = buildPlaylist(m, dir);
    } catch (e) {
      console.warn('chiron play: no manifest —', e.message);
      if (seq !== loadSeq) return;
      S.slug = null; $('pl-list').innerHTML = '<div class="empty">Audio non disponibile per questa lezione (o il computer non è raggiungibile).</div>'; render(); return;
    }
    renderList();
    const saved = await loadSaved(); if (seq !== loadSeq) return;
    const k = saved ? S.items.findIndex(x => x.path === saved.path) : -1;
    if (k >= 0) select(k, saved.t, false); else if (S.items.length) select(0, 0, false);
    render();
  };
  api.state = () => ({ slug: S.slug, idx: S.idx, n: S.items.length, paused: audio.paused, rate: S.rate });
  api.audio = audio;
  window.addEventListener('pagehide', () => save(true));
})(typeof window !== 'undefined' ? window : globalThis);
