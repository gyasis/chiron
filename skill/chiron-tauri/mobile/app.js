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
dItems.forEach(b => b.onclick = () => { go(+b.dataset.nav); drawer(false); });
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
const F = { q: '', dom: '' };
const DOMS = [['', 'All'], ['medicine', 'Medicine'], ['medical-italian', 'Med-Italian'], ['italian', 'Italian']];
function domCls(d) { return d === 'medicine' ? 'm' : d === 'medical-italian' ? 'mi' : 'l'; }
function renderChips() {
  document.getElementById('chips').innerHTML = DOMS.map(([v, l]) =>
    `<div class="chip ${F.dom === v ? 'on' : ''}" data-d="${v}">${l}</div>`).join('');
  document.querySelectorAll('#chips .chip').forEach(c => c.onclick = () => { F.dom = c.dataset.d; renderChips(); renderRows(); });
}
function match(l) {
  if (F.dom && l.domain !== F.dom) return false;
  if (F.q) { const s = (l.title + ' ' + (l.system || '') + ' ' + (l.subject || '') + ' ' + (l.topic || '')).toLowerCase();
    if (!s.includes(F.q.toLowerCase())) return false; } return true;
}
function rowHtml(l) {
  const slug = slugOf(l.id), off = !!OFFLINE[slug];
  const cat = l.system ? `<span class="tag ${domCls(l.domain)}">${l.system}</span>` : l.topic ? `<span class="tag l">${l.topic}</span>` : '';
  const lvl = l.level ? `<span class="tag">${l.level}</span>` : '';
  let act;
  if (!l.ready) act = `<span class="btn gen" data-gen="${esc(l.subject || l.system || l.topic || l.title)}" data-dom="${l.domain}">✦ Generate</span>`;
  else if (l.status === 'staged') act = `<span class="btn acc" data-acc="${slug}">✓ Accept</span>`;
  else if (off) act = `<span class="btn" data-open="${slug}">Open →</span>`;
  else if (l.bundle) act = `<span class="btn dl" data-dl="${slug}">⬇ ${l.sizeMB || ''}${l.sizeMB ? 'MB' : 'Get'}</span>`;
  else act = `<span class="btn" data-open="${slug}">Open →</span>`;
  return `<div class="row ${domCls(l.domain)}"><div class="edge"></div>
    <div class="body"><div class="t">${esc(l.title)}</div>
      <div class="meta">${l.status === 'staged' ? '<span class="tag rev">🟡 REVIEW</span>' : ''}<span class="tag ${domCls(l.domain)}">${l.domain}</span>${cat}${lvl}${l.clips ? `<span class="clip">▸${l.clips}${off ? ' · ✓' : ''}</span>` : ''}</div></div>
    <div class="act">${act}</div></div>`;
}
function esc(s) { return String(s == null ? '' : s).replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function renderRows() {
  const list = LESSONS.filter(match);
  const staged = list.filter(l => l.ready && l.status === 'staged');
  const ready = list.filter(l => l.ready && l.status !== 'staged');
  const queued = list.filter(l => !l.ready);
  const hdr = (i, t, n, note) => `<div class="sec">${i} ${t} <span class="ct">${n}</span><span class="note">${note}</span></div>`;
  let h = '';
  if (staged.length) { h += `<div class="reviewband">🟡 Needs Review — ${staged.length} generated, not yet published.</div>` + staged.map(rowHtml).join(''); }
  if (ready.length) { const dl = ready.filter(l => l.bundle).length; h += hdr('📚', 'Available', ready.length, dl ? dl + ' downloadable' : 'open to study') + ready.map(rowHtml).join(''); }
  if (queued.length) h += hdr('○', 'To generate', queued.length, 'tap Generate') + queued.slice(0, 400).map(rowHtml).join('');
  document.getElementById('rows').innerHTML = h || `<div class="empty">No lessons match.</div>`;
  document.querySelectorAll('#rows [data-open]').forEach(e => e.onclick = ev => { ev.stopPropagation(); openLesson(e.dataset.open); });
  document.querySelectorAll('#rows [data-dl]').forEach(e => e.onclick = ev => { ev.stopPropagation(); download(e.dataset.dl); });
  document.querySelectorAll('#rows [data-acc]').forEach(e => e.onclick = ev => { ev.stopPropagation(); accept(e.dataset.acc); });
  document.querySelectorAll('#rows [data-gen]').forEach(e => e.onclick = ev => { ev.stopPropagation(); genFor(e.dataset.gen, e.dataset.dom); });
}
document.getElementById('q').oninput = e => { F.q = e.target.value; renderRows(); };
async function loadLibrary() {
  try {
    const d = await (await fetch(idxUrl() + '?' + Date.now())).json();
    LESSONS = d.lessons || []; renderChips(); renderRows(); refreshSync();
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
    OFFLINE[slug] = { id: l.id, entry: l.entry }; renderRows(); refreshOffline(); toast('Saved offline ✓');
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
      try { const l = await invoke('import_from_server', { url: catUrl(), file: f }); OFFLINE[slug] = { id: l.id, entry: l.entry }; n++; } catch (e) {} }
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
const DEPTHS = { medicine: [['', 'Auto'], ['primer', 'Primer'], ['atlas', 'Atlas'], ['systematic', 'Systematic'], ['amboss', 'AMBOSS']],
  'medical-italian': [['ward', 'Ward'], ['passage', 'Passage']], italian: [['lesson', 'Lesson']] };
const ATLAS = ['cardiovascular', 'respiratory', 'gastrointestinal', 'renal', 'endocrine', 'metabolic', 'hematolog', 'oncolog', 'neurolog', 'psychiatr', 'musculoskeletal', 'rheumatolog', 'dermatolog', 'infectious', 'immunolog', 'reproductive', 'geriatric'];
const G = { dom: 'medicine', dep: '', imgs: [] };
function detectDepth(s) { s = (s || '').toLowerCase().trim(); if (!s) return ''; if (s.includes('geriatr')) return 'primer'; if (ATLAS.some(k => s === k || s.includes(k))) return 'atlas'; return 'systematic'; }
function renderSegs() {
  document.getElementById('w-domseg').innerHTML = Object.keys(DEPTHS).map(d => `<div class="chip ${G.dom === d ? 'on' : ''}" data-d="${d}">${d === 'medical-italian' ? 'Med-Italian' : d[0].toUpperCase() + d.slice(1)}</div>`).join('');
  document.getElementById('w-depseg').innerHTML = DEPTHS[G.dom].map(([v, l]) => `<div class="chip ${G.dep === v ? 'on' : ''}" data-v="${v}">${l}</div>`).join('');
  document.querySelectorAll('#w-domseg .chip').forEach(c => c.onclick = () => { G.dom = c.dataset.d; G.dep = ''; renderSegs(); hint(); });
  document.querySelectorAll('#w-depseg .chip').forEach(c => c.onclick = () => { G.dep = c.dataset.v; renderSegs(); hint(); });
}
function hint() { const s = document.getElementById('w-subject').value, h = document.getElementById('w-hint');
  if (G.dom === 'medicine' && !G.dep) { const d = detectDepth(s); h.innerHTML = d ? `Auto → <b>${d}</b> lesson` : 'Type a subject — depth auto-detects'; } else h.innerHTML = ''; }
document.getElementById('w-subject').oninput = hint;
function genFor(subject, dom) { document.getElementById('w-subject').value = subject || ''; if (dom && DEPTHS[dom]) { G.dom = dom; G.dep = ''; } renderSegs(); hint(); go(1); }
function addImgs(input) { [...input.files].forEach(f => G.imgs.push(f)); input.value = ''; renderThumbs(); }
function renderThumbs() { document.getElementById('w-thumbs').innerHTML = G.imgs.map((f, i) => `<span class="thumbwrap"><img class="thumb" src="${URL.createObjectURL(f)}"><b data-rm="${i}">×</b></span>`).join('') + (G.imgs.length ? `<span class="clip">${G.imgs.length} page(s) · OCR'd on generate</span>` : '');
  document.querySelectorAll('#w-thumbs [data-rm]').forEach(e => e.onclick = () => { G.imgs.splice(+e.dataset.rm, 1); renderThumbs(); }); }
document.getElementById('w-cam').onchange = e => addImgs(e.target);
document.getElementById('w-gal').onchange = e => addImgs(e.target);
document.getElementById('w-go').onclick = async () => {
  const subject = document.getElementById('w-subject').value.trim(); if (!subject) { toast('Type a subject'); return; }
  const btn = document.getElementById('w-go'); btn.disabled = true; btn.textContent = 'Starting…';
  try {
    let images = null;
    if (G.imgs.length) { const fd = new FormData(); G.imgs.forEach((f, i) => fd.append('files', f, f.name || `page-${i + 1}.jpg`));
      images = (await (await fetch(LIB + '/upload', { method: 'POST', body: fd })).json()).paths; }
    const r = await (await fetch(LIB + '/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: G.dom, subject, depth: G.dep || null, images, stage: 'all' }) })).json();
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
    renderSteps(d.phase || d.status); if (d.log_tail) document.getElementById('p-log').textContent = d.log_tail;
    if (d.status === 'ready' || d.status === 'published') { document.getElementById('p-title').firstChild.textContent = '✓ Ready — staged for review'; loadLibrary();
      setTimeout(() => { document.getElementById('genform').style.display = ''; document.getElementById('genprog').style.display = 'none'; }, 4000); return; }
    if (d.status === 'error') { document.getElementById('p-title').firstChild.textContent = '✗ Failed — see log'; return; }
    setTimeout(() => poll(jid), 2500);
  } catch (e) { setTimeout(() => poll(jid), 4000); }
}
async function accept(slug) { try { const r = await (await fetch(LIB + '/accept/' + slug, { method: 'POST' })).json(); if (r.ok) { toast('Published ✓'); loadLibrary(); } } catch (e) { toast('Accept failed'); } }

/* ---------- boot ---------- */
renderSegs(); hint();
loadLibrary().then(() => { refreshOffline(); });
