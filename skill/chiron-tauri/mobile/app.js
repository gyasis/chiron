'use strict';
/* Chiron mobile — connects to the LIVE library + server on the user's computer over home wifi.
 * Native (Tauri): offline lessons via import_from_server/list_lessons + the lesson:// protocol.
 * Web (browser): browse + stream + generate against the same server (no native offline). */
const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);
const invoke = TAURI ? window.__TAURI__.core.invoke : null;
const isAndroid = /android/i.test(navigator.userAgent);
const DEFAULT_LIB = 'http://192.168.0.112:8911';
let LIB = localStorage.getItem('chiron.lib') || (location.port === '8911' ? location.origin : DEFAULT_LIB);
const idxUrl = () => LIB + '/library/library.index.json';
const catUrl = () => LIB + '/library/lessons';           // server_lessons(catUrl) + <catUrl>/<file>.chiron
const slugOf = id => id.replace(/\//g, '-');
let LESSONS = [], OFFLINE = {};   // slug -> {id,entry} of installed lessons (native)

/* ---------- nav: swipe panes + EDGE DRAWER ---------- */
const pane = document.getElementById('pane');
const drawerEl = document.getElementById('drawer'), scrimEl = document.getElementById('scrim');
const dItems = [...document.querySelectorAll('#drawer .ditem[data-nav]')];
let OPEN_SLUG = null;
function go(i) { pane.scrollTo({ left: i * pane.clientWidth, behavior: 'smooth' }); syncNav(i); }
function syncNav(i) { if (i == null) i = Math.round(pane.scrollLeft / pane.clientWidth);
  dItems.forEach((b, j) => b.classList.toggle('on', j === i)); }
pane.addEventListener('scroll', () => requestAnimationFrame(() => syncNav()), { passive: true });
function drawer(open) { drawerEl.classList.toggle('open', open); scrimEl.classList.toggle('on', open); }
scrimEl.onclick = () => drawer(false);
document.getElementById('ereg').onclick = () => drawer(true);          // TAP the invisible left strip → always opens (no gesture conflict)
dItems.forEach(b => b.onclick = () => { const n = +b.dataset.nav; go(n); drawer(false); if (n === 3) renderActivity(); });
// SWIPE to open — mid-band ONLY (30–62% height). Top + BOTTOM-LEFT stay free for Android system gestures (back/home).
let _sx = null, _sy = null;
document.body.addEventListener('touchstart', e => { const t = e.touches[0], h = innerHeight;
  if (t.clientX < 26 && t.clientY > h * 0.30 && t.clientY < h * 0.62) { _sx = t.clientX; _sy = t.clientY; } }, { passive: true });
document.body.addEventListener('touchmove', e => { if (_sx === null) return; const t = e.touches[0];
  if (t.clientX - _sx > 34 && Math.abs(t.clientY - _sy) < 44) { drawer(true); _sx = null; } }, { passive: true });
document.body.addEventListener('touchend', () => { _sx = null; });
function closeLesson() { document.getElementById('lesson').classList.remove('open'); }
function toast(m) { const t = document.getElementById('toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2200); }

/* ---------- theme ---------- */
function paintTheme() { const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.getElementById('themebtn').innerHTML = (dark ? '☀️' : '🌙') + ' &nbsp;Theme'; }
document.getElementById('themebtn').onclick = () => {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark', nx = dark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', nx); try { localStorage.setItem('chiron.theme', nx); } catch (e2) {}
  paintTheme(); drawer(false); };
paintTheme();

/* ---------- library ---------- */
const F = { q: '', dom: '', sort: 'domain', view: localStorage.getItem('chiron.view') || 'tiles', hideDom: new Set(), hideSys: new Set() };
try { const H = JSON.parse(localStorage.getItem('chiron.hide') || '{}'); (H.dom || []).forEach(d => F.hideDom.add(d)); (H.sys || []).forEach(s => F.hideSys.add(s)); } catch (e) {}
const saveHide = () => { try { localStorage.setItem('chiron.hide', JSON.stringify({ dom: [...F.hideDom], sys: [...F.hideSys] })); } catch (e) {} };
const DL_TIME = JSON.parse(localStorage.getItem('chiron.dltime') || '{}');   // slug → when it was synced to THIS device
function markSynced(slug) { if (!slug) return; DL_TIME[slug] = Date.now(); try { localStorage.setItem('chiron.dltime', JSON.stringify(DL_TIME)); } catch (e) {} }
const SORTS = [['domain', 'By domain'], ['generated', 'Recently made'], ['synced', 'Recently synced']];
function renderSort() { const el = document.getElementById('sortrow'); if (!el) return;
  const nHidden = F.hideDom.size + F.hideSys.size;
  el.innerHTML = '<span class="sortlab">Sort</span>'
    + SORTS.map(([v, l]) => `<div class="chip sm ${F.sort === v ? 'on' : ''}" data-s="${v}">${l}</div>`).join('')
    + '<span class="ctrlsp"></span>'
    + `<div class="chip vt ${F.view === 'tiles' ? 'on' : ''}" data-view="tiles" title="Tiles">▦</div>`
    + `<div class="chip vt ${F.view === 'index' ? 'on' : ''}" data-view="index" title="List">☰</div>`
    + `<div class="chip sm hf ${nHidden ? 'act' : ''}" id="hfbtn" title="Hide domains / systems">⚑${nHidden ? ' ' + nHidden : ''}</div>`;
  el.querySelectorAll('[data-s]').forEach(c => c.onclick = () => { F.sort = c.dataset.s; renderSort(); renderRows(); });
  el.querySelectorAll('[data-view]').forEach(c => c.onclick = () => { F.view = c.dataset.view; localStorage.setItem('chiron.view', F.view); renderSort(); renderRows(); });
  const hf = el.querySelector('#hfbtn'); if (hf) hf.onclick = () => { HIDE_OPEN = !HIDE_OPEN; renderHidePanel(); };
}
let HIDE_OPEN = false;
function renderHidePanel() {
  const el = document.getElementById('hidepanel'); if (!el) return;
  el.style.display = HIDE_OPEN ? '' : 'none';
  if (!HIDE_OPEN) { el.innerHTML = ''; return; }
  const doms = [['medicine', 'Medicine'], ['medical-italian', 'Med-Italian'], ['italian', 'Italian']].filter(([d]) => LESSONS.some(l => l.domain === d));
  const systems = [...new Set(LESSONS.map(l => l.system).filter(Boolean))].map(s => [s, LESSONS.filter(l => l.system === s).length]).sort((a, b) => b[1] - a[1]);
  let h = `<div class="hgh">Domain <span class="un ${F.hideDom.size ? '' : 'dim'}" data-un="dom">Unhide all</span></div><div class="hwrap">`;
  h += doms.map(([d, l]) => `<div class="hchip ${F.hideDom.has(d) ? 'off' : 'on'}" data-hd="${d}"><span class="bx"></span><span class="hn">${l}</span></div>`).join('') + `</div>`;
  h += `<div class="hgh">System <span class="un ${F.hideSys.size ? '' : 'dim'}" data-un="sys">Unhide all</span></div><div class="hwrap">`;
  h += systems.map(([s, n]) => `<div class="hchip ${F.hideSys.has(s) ? 'off' : 'on'}" data-hs="${esc(s)}"><span class="bx"></span><span class="hn">${esc(s)} <span style="opacity:.55">${n}</span></span></div>`).join('') + `</div>`;
  el.innerHTML = h;
  const refresh = () => { saveHide(); renderHidePanel(); renderSort(); renderRows(); };
  el.querySelectorAll('[data-hd]').forEach(c => c.onclick = () => { const d = c.dataset.hd; F.hideDom.has(d) ? F.hideDom.delete(d) : F.hideDom.add(d); refresh(); });
  el.querySelectorAll('[data-hs]').forEach(c => c.onclick = () => { const s = c.dataset.hs; F.hideSys.has(s) ? F.hideSys.delete(s) : F.hideSys.add(s); refresh(); });
  el.querySelectorAll('[data-un]').forEach(b => b.onclick = () => { (b.dataset.un === 'dom' ? F.hideDom : F.hideSys).clear(); refresh(); });
}
function sortLessons(arr) { const a = [...arr];
  if (F.sort === 'generated') a.sort((x, y) => (y.mtime || 0) - (x.mtime || 0));                                   // newest lesson.html first
  else if (F.sort === 'synced') a.sort((x, y) => ((DL_TIME[slugOf(y.id)] || 0) - (DL_TIME[slugOf(x.id)] || 0)) || (y.mtime || 0) - (x.mtime || 0));  // most-recently downloaded first
  else a.sort((x, y) => (x.domain || '').localeCompare(y.domain || '') || (x.title || '').localeCompare(y.title || ''));  // by domain, then title
  return a; }
const DOMS = [['', 'All'], ['medicine', 'Medicine'], ['medical-italian', 'Med-Italian'], ['italian', 'Italian']];
function domCls(d) { return d === 'medicine' ? 'm' : d === 'medical-italian' ? 'mi' : 'l'; }
function renderChips() {
  document.getElementById('chips').innerHTML = DOMS.map(([v, l]) =>
    `<div class="chip ${F.dom === v ? 'on' : ''}" data-d="${v}">${l}</div>`).join('');
  document.querySelectorAll('#chips .chip').forEach(c => c.onclick = () => { F.dom = c.dataset.d; renderChips(); renderRows(); });
}
function match(l) {
  if (F.hideDom.has(l.domain)) return false;                 // hide-filters win, incl. over search
  if (l.system && F.hideSys.has(l.system)) return false;
  if (F.dom && l.domain !== F.dom) return false;
  if (F.q) { const s = (l.title + ' ' + (l.system || '') + ' ' + (l.subject || '') + ' ' + (l.topic || '')).toLowerCase();
    if (!s.includes(F.q.toLowerCase())) return false; } return true;
}
function lessonAction(l) {   // shared by the list (Index) rows and the Tiles cards
  const slug = slugOf(l.id), off = !!OFFLINE[slug];
  if (!l.ready) { const gs = l.subject || l.system || l.topic || l.title, aj = activeFor(gs);
    return aj ? `<span class="btn spin" data-recon="${aj.id}"><span class="spinc"></span>Generating</span>`
              : `<span class="btn gen" data-gen="${esc(gs)}" data-dom="${l.domain}">✦ Generate</span>`; }
  if (l.status === 'staged') return `<span class="btn acc" data-acc="${slug}">✓ Accept</span>`;
  if (off) return `<span class="btn" data-open="${slug}">Open →</span>`;
  if (l.bundle) return `<span class="btn dl" data-dl="${slug}">⬇ ${l.sizeMB || ''}${l.sizeMB ? 'MB' : 'Get'}</span>`;
  return `<span class="btn" data-open="${slug}">Open →</span>`;
}
function rowHtml(l) {   // Index view — dense one-line rows
  const off = !!OFFLINE[slugOf(l.id)];
  const cat = l.system ? `<span class="tag ${domCls(l.domain)}">${l.system}</span>` : l.topic ? `<span class="tag l">${l.topic}</span>` : '';
  const lvl = l.level ? `<span class="tag">${l.level}</span>` : '';
  return `<div class="row ${domCls(l.domain)}"><div class="edge"></div>
    <div class="body"><div class="t">${esc(l.title)}</div>
      <div class="meta">${l.status === 'staged' ? '<span class="tag rev">🟡 REVIEW</span>' : ''}<span class="tag ${domCls(l.domain)}">${l.domain}</span>${cat}${lvl}${l.clips ? `<span class="clip">▸${l.clips}${off ? ' · ✓' : ''}</span>` : ''}</div></div>
    <div class="act">${lessonAction(l)}</div></div>`;
}
function tileHtml(l) {   // Tiles view — 2-up cards
  const off = !!OFFLINE[slugOf(l.id)];
  const sub = l.subject || l.system || l.topic || (l.level ? 'Livello ' + l.level : '') || '';
  return `<div class="tcard ${domCls(l.domain)}${l.ready ? '' : ' q'}"><div class="tstrip"></div>
    <div class="tbd"><div class="tt">${esc(l.title)}</div><div class="tsub">${esc(sub)}</div>${l.status === 'staged' ? '<span class="tag rev">🟡 REVIEW</span>' : ''}</div>
    <div class="tft"><span class="tag ${domCls(l.domain)}">${esc(l.domain)}</span>${l.clips ? `<span class="clip">▸${l.clips}${off ? ' ✓' : ''}</span>` : ''}${lessonAction(l)}</div></div>`;
}
function group(arr) { return F.view === 'tiles' ? `<div class="tgrid">${arr.map(tileHtml).join('')}</div>` : arr.map(rowHtml).join(''); }
function esc(s) { return String(s == null ? '' : s).replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
/* ---- generation status: poll active jobs, show spinners, tap to reconnect ---- */
let ACTIVE = [], ACTIVE_SIG = '';
function activeFor(subject) { const s = (subject || '').toLowerCase().trim(); return s && ACTIVE.find(j => (j.subject || '').toLowerCase().trim() === s); }
async function pollActive() {
  try {
    const d = await (await fetch(LIB + '/jobs')).json();
    const a = (d.jobs || []).filter(j => j.status === 'queued' || j.status === 'running');
    const sig = a.map(j => j.id + j.status + (j.phase || '')).join(',');
    if (sig !== ACTIVE_SIG) { ACTIVE = a; ACTIVE_SIG = sig; renderRows(); }
  } catch (e) {}
}
async function quickGen(subject, dom) {   // queue a lesson straight from a library row — never cancels others
  try {
    const r = await (await fetch(LIB + '/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: dom || 'medicine', subject, depth: null, stage: 'all' }) })).json();
    if (r.job_id) { toast('Queued: ' + subject); pollActive(); } else toast('Queue failed');
  } catch (e) { toast('Queue failed — library reachable?'); }
}
function reconnect(job) { if (!job) return; go(1); showProg({ slug: job.slug, depth: job.depth }); poll(job.id); }
function renderRows() {
  const list = LESSONS.filter(match);
  const staged = sortLessons(list.filter(l => l.ready && l.status === 'staged'));
  const ready = sortLessons(list.filter(l => l.ready && l.status !== 'staged'));
  const queued = list.filter(l => !l.ready);
  const hdr = (i, t, n, note) => `<div class="sec">${i} ${t} <span class="ct">${n}</span><span class="note">${note}</span></div>`;
  let h = '';
  if (ACTIVE.length) h += `<div class="sec">⏳ Generating <span class="ct">${ACTIVE.length}</span><span class="note">tap to watch</span></div>` +
    ACTIVE.map(j => `<div class="genrow" data-recon="${j.id}"><span class="spinc"></span><div class="gi"><b>${esc(j.subject || j.slug || 'lesson')}</b><small>${j.status === 'queued' ? 'queued…' : (j.phase || 'generating') + '…'}</small></div><span class="chev">›</span></div>`).join('');
  if (staged.length) { h += `<div class="reviewband">🟡 Needs Review — ${staged.length} generated, not yet published.</div>` + group(staged); }
  if (ready.length) { const dl = ready.filter(l => l.bundle).length; h += hdr('📚', 'Available', ready.length, dl ? dl + ' downloadable' : 'open to study') + group(ready); }
  if (queued.length) h += hdr('○', 'To generate', queued.length, 'tap Generate') + group(queued.slice(0, 400));
  document.getElementById('rows').innerHTML = h || `<div class="empty">No lessons match${F.hideDom.size || F.hideSys.size ? ' — some domains/systems are hidden (tap ⚑ to unhide)' : ''}.</div>`;
  document.querySelectorAll('#rows [data-open]').forEach(e => e.onclick = ev => { ev.stopPropagation(); openLesson(e.dataset.open); });
  document.querySelectorAll('#rows [data-dl]').forEach(e => e.onclick = ev => { ev.stopPropagation(); download(e.dataset.dl); });
  document.querySelectorAll('#rows [data-acc]').forEach(e => e.onclick = ev => { ev.stopPropagation(); accept(e.dataset.acc); });
  document.querySelectorAll('#rows [data-gen]').forEach(e => e.onclick = ev => { ev.stopPropagation(); quickGen(e.dataset.gen, e.dataset.dom); });
  document.querySelectorAll('#rows [data-recon]').forEach(e => e.onclick = ev => { ev.stopPropagation(); reconnect(ACTIVE.find(j => j.id === e.dataset.recon)); });
}
document.getElementById('q').oninput = e => { F.q = e.target.value; renderRows(); };

/* ---------- Activity: persistent cross-source job journal (survives app close) ---------- */
const PHASES = [['grounding', 'Grounding'], ['planning', 'Planning'], ['writing', 'Writing'], ['assembling', 'Assembling'], ['baking', 'Baking audio'], ['ready', 'Ready']];
function fmtDur(s) { if (s == null) return ''; s = Math.round(s); if (s < 60) return s + 's'; const m = Math.floor(s / 60); return m + 'm' + (s % 60 ? ' ' + (s % 60) + 's' : ''); }
function relTime(iso) { if (!iso) return ''; const t = Date.parse(iso); if (!t) return ''; const d = (Date.now() - t) / 1000;
  if (d < 60) return 'just now'; if (d < 3600) return Math.floor(d / 60) + 'm ago'; if (d < 86400) return Math.floor(d / 3600) + 'h ago'; return Math.floor(d / 86400) + 'd ago'; }
function actCard(j) {
  const src = j.source || (j.external ? 'External' : 'App'), srcCls = (j.external || (j.source && j.source !== 'App')) ? 'ext' : 'app';
  const live = j.status === 'queued' || j.status === 'running';
  const ci = PHASES.findIndex(([p]) => p === j.phase);
  const curIdx = (j.status === 'ready' || j.status === 'published') ? PHASES.length : (ci < 0 ? 0 : ci);
  if (live) {
    const bars = PHASES.map((_, i) => `<i class="${i < curIdx ? 'done' : i === curIdx ? 'now' : ''}"></i>`).join('');
    const phaseLabel = (PHASES[curIdx] || ['', 'Working'])[1];
    const eta = j.eta_seconds != null ? `<span class="eta">~${fmtDur(j.eta_seconds)} left</span>` : '';
    return `<div class="acard live tapp"><div class="ah"><span class="sp"></span><span class="at">${esc(j.subject || j.slug || 'lesson')}</span><span class="atime">${fmtDur(j.elapsed_seconds)}</span></div>
      <div class="asub"><span class="src ${srcCls}">${esc(src)}</span>${j.chain ? `<span>${esc(j.chain)}</span>` : ''}${j.depth ? `<span>· ${esc(j.depth)}</span>` : ''}</div>
      <div class="prog">${bars}</div><div class="plabel"><span>${phaseLabel}…</span>${eta}</div></div>`;
  }
  const ok = j.status === 'ready' || j.status === 'published';
  const staged = j.status === 'ready';        // generated, not yet accepted → Preview + Accept
  // actions: failed → Retry · staged → Preview + Accept · accepted(published) → Open
  let acts = '';
  if (j.status === 'error') acts = `<button class="abtn retry">↻ Retry</button>`;
  else if (staged && j.slug) acts = `<button class="abtn ghost preview">👁 Preview</button><button class="abtn accept">✓ Accept & keep</button>`;
  else if (j.status === 'published' && j.slug) acts = `<button class="abtn ghost open">Open →</button>`;
  return `<div class="acard"><div class="ah"><span class="ico ${ok ? 'ok' : 'err'}">${ok ? '✓' : '✕'}</span><span class="at">${esc(j.subject || j.slug || 'lesson')}</span><span class="atime">${relTime(j.finished || j.created)}</span></div>
    <div class="asub"><span class="src ${srcCls}">${esc(src)}</span>${j.chain ? `<span>${esc(j.chain)}</span>` : ''}${j.elapsed_seconds != null ? `<span>· took ${fmtDur(j.elapsed_seconds)}</span>` : ''}${staged ? '<span style="color:var(--review)">· needs review</span>' : j.status === 'error' ? '<span style="color:#dc2626">· failed</span>' : ''}</div>
    ${acts ? `<div class="aacts">${acts}</div>` : ''}</div>`;
}
async function retryJob(j) { try { const r = await (await fetch(LIB + '/retry/' + j.id, { method: 'POST' })).json();
  if (r.job_id) { toast('Retrying: ' + (j.subject || 'lesson')); pollActive(); renderActivity(); } else toast(r.detail || 'Retry failed'); }
  catch (e) { toast('Retry failed — library reachable?'); } }
async function acceptJob(j) { const ref = j.slug || j.id; try { const r = await (await fetch(LIB + '/accept/' + ref, { method: 'POST' })).json();
  if (r.ok) { toast('Kept in your library ✓'); loadLibrary(); renderActivity(); } else toast('Accept failed'); } catch (e) { toast('Accept failed'); } }
let ACT_BUSY = false;
async function renderActivity() {
  const body = document.getElementById('act-body'); if (!body || ACT_BUSY) return; ACT_BUSY = true;
  try {
    const d = await (await fetch(LIB + '/activity?limit=80')).json();
    const c = d.counts || { active: 0, done: 0, error: 0 };
    let h = `<div class="actsum"><div class="pill2 live"><b>${c.active}</b><span>active</span></div><div class="pill2 ok"><b>${c.done}</b><span>completed</span></div><div class="pill2 err"><b>${c.error}</b><span>failed</span></div></div>`;
    if (d.active.length) h += `<div class="acthead">Now running</div>` + d.active.map(actCard).join('');
    if (d.history.length) h += `<div class="acthead">History</div>` + d.history.map(actCard).join('');
    if (!d.active.length && !d.history.length) h += `<div class="empty">No lessons generated yet — start one from Generate. Anything you kick off will show here, even if you close the app.</div>`;
    body.innerHTML = h;
    const all = [...d.active, ...d.history];
    body.querySelectorAll('.acard').forEach((el, i) => { const j = all[i]; if (!j) return;
      if (j.status === 'queued' || j.status === 'running') el.onclick = () => reconnect(j);
      const on = (sel, fn) => { const b = el.querySelector(sel); if (b) b.onclick = ev => { ev.stopPropagation(); fn(); }; };
      on('.retry', () => retryJob(j));
      on('.preview', () => openLesson(j.slug));
      on('.open', () => openLesson(j.slug));
      on('.accept', () => acceptJob(j)); });
    const sub = document.getElementById('act-sub'); if (sub) sub.textContent = `${c.active} live · ${c.done} done · ${c.error} failed`;
  } catch (e) { body.innerHTML = `<div class="empty">Can't reach your library for activity.<br>Is the computer running Chiron on the same wifi?</div>`; }
  ACT_BUSY = false;
}
function curPane() { return Math.round(pane.scrollLeft / pane.clientWidth); }
async function loadLibrary() {
  try {
    const d = await (await fetch(idxUrl() + '?' + Date.now())).json();
    LESSONS = d.lessons || []; renderChips(); renderSort(); renderRows(); refreshSync();
  } catch (e) {
    document.getElementById('rows').innerHTML = `<div class="empty">Can't reach your library at<br><b>${LIB}</b><br><br>Make sure the computer running Chiron is on, on the same wifi. Set the address in the Offline tab.</div>`;
    document.getElementById('syncedtag').textContent = 'offline';
  }
}

/* ---------- open a lesson (offline lesson:// when installed, else stream from the box) ---------- */
function lessonSrc(l, slug) {
  if (OFFLINE[slug]) { const o = OFFLINE[slug]; const base = isAndroid ? 'http://lesson.localhost/' : 'lesson://localhost/'; return base + o.id + '/' + o.entry; }
  return LIB + '/lessons/' + l.id + '/lesson.html';
}
function openLesson(slug) {
  const l = LESSONS.find(x => slugOf(x.id) === slug) || { id: slug, title: slug, clips: 0 };
  document.getElementById('l-title').textContent = l.title.replace(/^Chiron\s*·\s*/, '');
  document.getElementById('l-frame').src = lessonSrc(l, slug);
  document.getElementById('pl-cover').textContent = l.title.replace(/^Chiron\s*·\s*/, '');
  document.getElementById('pl-t').textContent = l.system || l.topic || 'Lesson';
  const r = document.getElementById('l-resume'); const pos = localStorage.getItem('chiron.pos.' + slug);
  r.style.display = pos ? '' : 'none'; if (pos) r.innerHTML = '↩ Continue where you left off';
  localStorage.setItem('chiron.pos.' + slug, '1');
  OPEN_SLUG = slug; setMode('read');
  // show "save offline" only when it isn't already on the device
  document.getElementById('l-save').style.display = OFFLINE[slug] ? 'none' : '';
  document.getElementById('lesson').classList.add('open');
}
function setMode(m) {
  document.getElementById('mread').style.display = m === 'read' ? '' : 'none';
  document.getElementById('mplay').style.display = m === 'play' ? '' : 'none';
  document.getElementById('m-read').classList.toggle('mon', m === 'read');
  document.getElementById('m-play').classList.toggle('mon', m === 'play');
}
document.getElementById('pl-btn').onclick = e => { e.currentTarget.textContent = e.currentTarget.textContent === '▶' ? '❚❚' : '▶'; };
document.getElementById('l-save').onclick = () => { if (OPEN_SLUG) download(OPEN_SLUG); };   // cache the streaming lesson for offline

/* ---------- download / sync from the live library (native) ---------- */
async function download(slug) {
  if (!TAURI) { openLesson(slug); return; }   // web: just stream
  toast('Downloading…');
  try {
    const l = await invoke('import_from_server', { url: catUrl(), file: slug + '.chiron' });
    OFFLINE[slug] = { id: l.id, entry: l.entry }; markSynced(slug); renderRows(); refreshOffline(); toast('Saved offline ✓');
  } catch (e) { toast('Download failed'); }
}
async function refreshOffline() {
  const box = document.getElementById('offrows');
  if (TAURI) {
    try { const ls = await invoke('list_lessons'); OFFLINE = {};
      // map installed back onto library slugs by title where possible
      ls.forEach(o => { const m = LESSONS.find(l => (l.title || '').includes(o.title) || o.title.includes(l.title)); OFFLINE[m ? slugOf(m.id) : o.title] = { id: o.id, entry: o.entry }; });
      box.innerHTML = ls.length ? ls.map(o => `<div class="row m"><div class="edge"></div><div class="body"><div class="t">${esc(o.title)}</div><div class="meta"><span class="clip">✓ offline</span></div></div><div class="act"><span class="btn" data-oid="${o.id}" data-oentry="${o.entry}">Open →</span></div></div>`).join('') : `<div class="empty">Nothing saved yet. Download lessons from the Library.</div>`;
      box.querySelectorAll('[data-oid]').forEach(e => e.onclick = () => { const base = isAndroid ? 'http://lesson.localhost/' : 'lesson://localhost/'; document.getElementById('l-frame').src = base + e.dataset.oid + '/' + e.dataset.oentry; document.getElementById('l-title').textContent = 'Lesson'; setMode('read'); go(2); });
    } catch (e) { box.innerHTML = `<div class="empty">—</div>`; }
  } else box.innerHTML = `<div class="empty">Offline install works in the installed app. In the browser, lessons stream from your library.</div>`;
}
async function syncNow() {
  const tag = document.getElementById('syncedtag'); tag.textContent = 'syncing…';
  if (!TAURI) { await loadLibrary(); return; }
  try {
    const cat = await invoke('server_lessons', { url: catUrl() });
    const files = (cat.lessons || []).map(e => e.file);
    let n = 0;
    for (const f of files) { const slug = f.replace(/\.chiron$/, ''); if (OFFLINE[slug]) continue;
      try { const l = await invoke('import_from_server', { url: catUrl(), file: f }); OFFLINE[slug] = { id: l.id, entry: l.entry }; markSynced(slug); n++; } catch (e) {} }
    renderRows(); refreshOffline(); toast(n ? `Synced ${n} new lesson${n > 1 ? 's' : ''}` : 'Up to date'); refreshSync();
  } catch (e) { toast('Sync failed — is the library reachable?'); tag.textContent = 'offline'; }
}
document.getElementById('syncbtn').onclick = syncNow;
async function refreshSync() {
  const tag = document.getElementById('syncedtag'), sub = document.getElementById('syncsub');
  const ready = LESSONS.filter(l => l.ready).length, dl = LESSONS.filter(l => l.bundle).length;
  if (LESSONS.length) { sub.textContent = `${LIB} · ${ready} lessons · ${dl} downloadable`; tag.textContent = '✓ synced'; tag.style.color = 'var(--ok)'; }
  else { sub.textContent = `${LIB} (not reachable)`; tag.textContent = 'offline'; tag.style.color = 'var(--muted)'; }
}

/* ---------- import a .chiron file (native) ---------- */
document.getElementById('impfile').onclick = document.getElementById('importbtn').onclick = async () => {
  drawer(false);
  if (!TAURI) { toast('File import works in the installed app'); return; }
  try {
    const { open } = window.__TAURI__.dialog; const { readFile } = window.__TAURI__.fs;
    const path = await open({ multiple: false, filters: [{ name: 'Chiron', extensions: ['chiron', 'zip'] }] });
    if (!path) return; toast('Importing…');
    const bytes = await readFile(path);
    const l = await invoke('import_lesson', { data: Array.from(bytes) });
    OFFLINE[l.title] = { id: l.id, entry: l.entry }; refreshOffline(); toast('Imported ✓');
  } catch (e) { toast('Import failed'); }
};

/* ---------- library address setting ---------- */
document.getElementById('liburl').value = LIB;
document.getElementById('libsave').onclick = () => {
  let v = document.getElementById('liburl').value.trim().replace(/\/$/, '');
  if (v) { LIB = v; localStorage.setItem('chiron.lib', v); toast('Saved — reconnecting'); loadLibrary(); }
};

/* ---------- generate wizard ---------- */
const DEPTHS = { medicine: [['', 'Auto'], ['primer', 'Primer'], ['atlas', 'Atlas'], ['systematic', 'Systematic'], ['drug', 'Drug'], ['amboss', 'AMBOSS']],
  'medical-italian': [['ward', 'Ward'], ['passage', 'Passage']], italian: [['lesson', 'Lesson']] };
const ATLAS = ['cardiovascular', 'respiratory', 'gastrointestinal', 'renal', 'endocrine', 'metabolic', 'hematolog', 'oncolog', 'neurolog', 'psychiatr', 'musculoskeletal', 'rheumatolog', 'dermatolog', 'infectious', 'immunolog', 'reproductive', 'geriatric'];
const G = { dom: 'medicine', dep: '', imgs: [], paths: [], autofill: true, suggested: false, system: '', sysAutofill: true };
let sysTimer;
function scheduleResolve() { clearTimeout(sysTimer); sysTimer = setTimeout(resolveSystem, 700); }
async function resolveSystem() {   // pre-send preview: infer the medical system from the typed subject (spinner → editable)
  const row = document.getElementById('w-sysrow'), fld = document.getElementById('w-system'), spin = document.getElementById('w-sysspin');
  if (!row) return;
  if (G.dom !== 'medicine') { row.style.display = 'none'; return; }
  row.style.display = '';
  const subj = document.getElementById('w-subject').value.trim();
  if (!subj) { if (G.sysAutofill) { fld.value = ''; G.system = ''; } return; }
  if (!G.sysAutofill) return;   // you edited the system → yours wins
  spin.classList.add('on'); const ph = fld.getAttribute('placeholder'); fld.setAttribute('placeholder', 'detecting specialty…');
  try {
    const r = await (await fetch(LIB + '/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject: subj, domain: G.dom, depth: G.dep || null }) })).json();
    if (r && r.system && G.sysAutofill) { fld.value = r.system; G.system = r.system; }
  } catch (e) {}
  spin.classList.remove('on'); fld.setAttribute('placeholder', ph);
}
function detectDepth(s) { s = (s || '').toLowerCase().trim(); if (!s) return ''; if (s.includes('geriatr')) return 'primer'; if (ATLAS.some(k => s === k || s.includes(k))) return 'atlas'; return 'systematic'; }
function renderSegs() {
  document.getElementById('w-domseg').innerHTML = Object.keys(DEPTHS).map(d => `<div class="chip ${G.dom === d ? 'on' : ''}" data-d="${d}">${d === 'medical-italian' ? 'Med-Italian' : d[0].toUpperCase() + d.slice(1)}</div>`).join('');
  document.getElementById('w-depseg').innerHTML = DEPTHS[G.dom].map(([v, l]) => `<div class="chip ${G.dep === v ? 'on' : ''}" data-v="${v}">${l}</div>`).join('');
  document.querySelectorAll('#w-domseg .chip').forEach(c => c.onclick = () => { G.dom = c.dataset.d; G.dep = ''; renderSegs(); hint(); resolveSystem(); });
  document.querySelectorAll('#w-depseg .chip').forEach(c => c.onclick = () => { G.dep = c.dataset.v; renderSegs(); hint(); });
}
function hint() { const s = document.getElementById('w-subject').value, h = document.getElementById('w-hint');
  if (G.suggested) { h.innerHTML = '✨ suggested from your photos — edit if you like'; return; }
  if (G.dom === 'medicine' && !G.dep) { const d = detectDepth(s); h.innerHTML = d ? `Auto → <b>${d}</b> lesson` : 'Type a subject — depth auto-detects'; } else h.innerHTML = ''; }
document.getElementById('w-subject').oninput = () => { G.autofill = false; G.suggested = false; G.sysAutofill = true; hint(); scheduleResolve(); };   // you typed → your subject wins; re-infer system
document.getElementById('w-system').oninput = e => { G.sysAutofill = false; G.system = e.target.value.trim(); };   // you edited the system → yours wins
function genFor(subject, dom) { document.getElementById('w-subject').value = subject || ''; G.autofill = false; G.suggested = false; G.sysAutofill = true; if (dom && DEPTHS[dom]) { G.dom = dom; G.dep = ''; } renderSegs(); hint(); resolveSystem(); go(1); }
async function addImgs(input) {
  const files = [...input.files]; input.value = ''; if (!files.length) return;
  files.forEach(f => G.imgs.push(f)); renderThumbs('uploading');
  try { const fd = new FormData(); files.forEach((f, i) => fd.append('files', f, f.name || `page-${i + 1}.jpg`));
    const up = await (await fetch(LIB + '/upload', { method: 'POST', body: fd })).json(); G.paths.push(...(up.paths || [])); } catch (e) {}
  renderThumbs(); maybeSuggest();
}
async function maybeSuggest() {   // async subject suggestion — ONLY when the subject is blank / still auto-filled
  const field = document.getElementById('w-subject'), spin = document.getElementById('w-spin');
  if (!G.paths.length) return;
  if (field.value.trim() && !G.autofill) return;      // you typed a subject → don't touch it
  const ph = field.getAttribute('placeholder');
  spin.classList.add('on'); field.setAttribute('placeholder', 'Reading your photos to name this lesson…');
  document.getElementById('w-hint').innerHTML = '✨ finding a good subject from your photos…';
  try {
    const s = await (await fetch(LIB + '/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images: G.paths }) })).json();
    if (s && s.subject && G.autofill) {
      field.value = s.subject; G.suggested = true;
      if (s.domain && DEPTHS[s.domain]) G.dom = s.domain;
      G.dep = (s.depth && DEPTHS[G.dom].some(([v]) => v === s.depth)) ? s.depth : '';
      renderSegs(); hint();
      if (s.system && G.dom === 'medicine' && G.sysAutofill) { document.getElementById('w-system').value = s.system; G.system = s.system; document.getElementById('w-sysrow').style.display = ''; }
      else resolveSystem();
    } else if (!field.value.trim()) hint();
  } catch (e) { hint(); }
  finally { spin.classList.remove('on'); field.setAttribute('placeholder', ph); }
}
function renderThumbs(state) { document.getElementById('w-thumbs').innerHTML = G.imgs.map((f, i) => `<span class="thumbwrap"><img class="thumb" src="${URL.createObjectURL(f)}"><b data-rm="${i}">×</b></span>`).join('') + (G.imgs.length ? `<span class="clip">${G.imgs.length} page(s)${state === 'uploading' ? ' · uploading…' : ' · used as context'}</span>` : '');
  document.querySelectorAll('#w-thumbs [data-rm]').forEach(e => e.onclick = () => { const i = +e.dataset.rm; G.imgs.splice(i, 1); G.paths.splice(i, 1);
    if (!G.paths.length && G.autofill) { document.getElementById('w-subject').value = ''; G.suggested = false; } renderThumbs();
    if (G.paths.length && G.autofill) maybeSuggest(); else hint(); }); }
document.getElementById('w-cam').onchange = e => addImgs(e.target);
document.getElementById('w-gal').onchange = e => addImgs(e.target);
document.getElementById('w-go').onclick = async () => {
  const subject = document.getElementById('w-subject').value.trim();
  if (!subject) { toast(G.paths.length ? 'Reading your photos — one moment, then Generate' : 'Type a subject, or add a photo'); return; }
  const btn = document.getElementById('w-go'); btn.disabled = true; btn.textContent = 'Starting…';
  try {
    const r = await (await fetch(LIB + '/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: G.dom, subject, depth: G.dep || null, images: G.paths.length ? G.paths : null, stage: 'all', extra: (G.dom === 'medicine' && G.system) ? { system: G.system } : {} }) })).json();
    if (!r.job_id) throw 0;
    showProg(r); poll(r.job_id);
  } catch (e) { toast('Generate failed — is the library reachable?'); }
  btn.disabled = false; btn.textContent = '✦ Generate';
};
function showProg(r) { document.getElementById('genform').style.display = 'none'; document.getElementById('genprog').style.display = '';
  document.getElementById('p-title').firstChild.textContent = 'Generating: ' + (r.slug || ''); document.getElementById('p-sub').textContent = r.depth ? '(' + r.depth + ')' : ''; renderSteps('queued'); }
function renderSteps(phase) { const order = ['grounding', 'planning', 'writing', 'assembling', 'baking', 'ready'];
  const lab = { grounding: 'Grounding (Harrison / OCR)', planning: 'Planning chapters', writing: 'Writing chapters', assembling: 'Assembling', baking: 'Baking audio (Mac)', ready: 'Ready' };
  let ci = order.indexOf(phase); if (phase === 'queued' || ci < 0) ci = phase === 'ready' ? order.length - 1 : 0;
  document.getElementById('p-steps').innerHTML = order.map(s => { const i = order.indexOf(s), c = i < ci ? 'done' : i === ci ? 'now' : ''; return `<div class="step ${c}"><span class="dot">${i < ci ? '✓' : ''}</span>${lab[s]}</div>`; }).join(''); }
async function poll(jid) {
  try { const d = await (await fetch(LIB + '/jobs/' + jid)).json();
    renderSteps(d.phase || d.status);
    if (d.log_tail) { const lg = document.getElementById('p-log'); const atBottom = lg.scrollHeight - lg.scrollTop - lg.clientHeight < 40;
      lg.textContent = d.log_tail; if (atBottom) lg.scrollTop = lg.scrollHeight; }   // auto-follow unless you scrolled up
    if (d.status === 'ready' || d.status === 'published') { document.getElementById('p-title').firstChild.textContent = '✓ Ready — staged for review'; loadLibrary();
      setTimeout(() => { document.getElementById('genform').style.display = ''; document.getElementById('genprog').style.display = 'none'; }, 4000); return; }
    if (d.status === 'error') { document.getElementById('p-title').firstChild.textContent = '✗ Failed — see log'; return; }
    setTimeout(() => poll(jid), 2500);
  } catch (e) { setTimeout(() => poll(jid), 4000); }
}
async function accept(slug) { try { const r = await (await fetch(LIB + '/accept/' + slug, { method: 'POST' })).json(); if (r.ok) { toast('Published ✓'); loadLibrary(); } } catch (e) { toast('Accept failed'); } }

/* ---------- boot ---------- */
renderSegs(); hint();
loadLibrary().then(() => { refreshOffline(); pollActive(); renderActivity(); });
setInterval(() => { pollActive(); if (curPane() === 3) renderActivity(); }, 4000);   // keep the "Generating" band, row spinners + Activity feed live

/* ---- pull-down-to-sync on the Library ---- */
(function () {
  const scr = document.getElementById('s-lib'); if (!scr) return;
  const ind = document.createElement('div'); ind.className = 'ptr'; ind.innerHTML = '<span class="spinc"></span>'; scr.insertBefore(ind, scr.firstChild);
  let startY = null, dy = 0, busy = false;
  scr.addEventListener('touchstart', e => { startY = (scr.scrollTop <= 0 && !busy) ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  scr.addEventListener('touchmove', e => { if (startY === null) return; dy = e.touches[0].clientY - startY;
    if (dy > 0 && scr.scrollTop <= 0) { ind.style.height = Math.min(dy * 0.5, 64) + 'px'; ind.style.opacity = Math.min(dy / 64, 1); if (e.cancelable && dy > 6) e.preventDefault(); }
    else startY = null; }, { passive: false });
  scr.addEventListener('touchend', async () => {
    if (startY !== null && dy > 64) { busy = true; ind.style.height = '46px'; ind.style.opacity = '1';
      try { await (typeof syncNow === 'function' ? syncNow() : loadLibrary()); } catch (e) {} busy = false; }
    ind.style.height = '0'; ind.style.opacity = '0'; startY = null; dy = 0;
  }, { passive: true });
})();
