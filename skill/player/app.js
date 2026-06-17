/* Chiron Player — app logic.
 *
 * Library of imported lessons (one tap to open, fully offline). Importing a
 * .chiron (zip) bundle unzips it IN-APP with fflate and writes every file into
 * the `chiron-lessons-v1` cache under lessons/<id>/<path>; the service worker
 * then serves those paths like a local HTTP server, so the lesson runs with
 * working relative audio and no file:// limits — and the user never extracts
 * anything by hand.
 */
'use strict';

const LESSON_CACHE = 'chiron-lessons-v1';
const INDEX_KEY = 'chiron.library.v1';   // localStorage: lesson metadata
const SERVER_KEY = 'chiron.server.v1';   // localStorage: catalog URL override

// Inside the Tauri native app, service workers / Cache Storage don't work, so
// lessons are imported + served NATIVELY via Rust (the lesson:// protocol).
const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);
const LESSON_BASE = /android/i.test(navigator.userAgent) ? 'http://lesson.localhost/' : 'lesson://localhost/';
let tauriLessons = [];

const els = {
  lessons: document.getElementById('lessons'),
  importBtn: document.getElementById('import-btn'),
  getBtn: document.getElementById('get-btn'),
  fileInput: document.getElementById('file-input'),
  viewer: document.getElementById('viewer'),
  frame: document.getElementById('frame'),
  back: document.getElementById('back-btn'),
  vtitle: document.getElementById('viewer-title'),
  toast: document.getElementById('toast'),
  server: document.getElementById('server'),
  serverClose: document.getElementById('server-close'),
  serverCfg: document.getElementById('server-cfg'),
  serverUrlRow: document.getElementById('server-url-row'),
  serverUrlInput: document.getElementById('server-url'),
  serverUrlSave: document.getElementById('server-url-save'),
  serverList: document.getElementById('server-list'),
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
let toastTimer = null;
function toast(msg, ms = 2200) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => els.toast.classList.remove('show'), ms);
}

const MIME = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', wasm: 'application/wasm',
};
function mimeFor(path) {
  const ext = path.split('.').pop().toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

function loadIndex() {
  if (TAURI) return tauriLessons;
  try { return JSON.parse(localStorage.getItem(INDEX_KEY)) || []; }
  catch { return []; }
}
function saveIndex(list) { localStorage.setItem(INDEX_KEY, JSON.stringify(list)); }

function serverUrl() {
  return localStorage.getItem(SERVER_KEY) ||
         (TAURI ? 'https://gyasis.github.io/chiron/lessons' : 'lessons');
}
function setServerUrl(v) { localStorage.setItem(SERVER_KEY, v.trim()); }

function humanSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

// Strip a single common top-level directory if EVERY entry shares it, so the
// lesson entry resolves at lessons/<id>/lesson.html regardless of how the zip
// was rolled.
function commonPrefix(names) {
  const tops = new Set(names.map((n) => n.split('/')[0]));
  if (tops.size !== 1) return '';
  const top = [...tops][0];
  // only strip if it's actually a directory prefix (every name has a slash)
  return names.every((n) => n.startsWith(top + '/')) ? top + '/' : '';
}

function pickEntry(paths) {
  const htmls = paths.filter((p) => /\.html?$/i.test(p) && !p.includes('/'));
  if (htmls.length) {
    return htmls.find((p) => /(^|\/)lesson\.html$/i.test(p)) ||
           htmls.find((p) => /index\.html$/i.test(p)) || htmls[0];
  }
  // fall back to any html anywhere
  const any = paths.filter((p) => /\.html?$/i.test(p));
  return any.find((p) => /lesson\.html$/i.test(p)) || any[0] || null;
}

function titleFromHtml(bytes, fallback) {
  try {
    const head = new TextDecoder().decode(bytes.slice(0, 8192));
    const m = head.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (m) {
      const t = m[1].trim();
      if (t && !/^course_title$/i.test(t)) return t;
    }
  } catch { /* ignore */ }
  return fallback;
}

// ---------------------------------------------------------------------------
// import
// ---------------------------------------------------------------------------
function unzip(u8) {
  return new Promise((resolve, reject) => {
    // async unzip uses workers → doesn't freeze the UI on big bundles
    fflate.unzip(u8, (err, files) => (err ? reject(err) : resolve(files)));
  });
}

// Core import logic — takes raw bytes and a display name, writes to cache,
// saves to the index, and re-renders. Extracted so server downloads can reuse it.
async function importBundleBytes(u8, name) {
  if (!('caches' in window)) { toast('Storage unavailable — open via https/localhost.'); return; }

  let files;
  try { files = await unzip(u8); }
  catch { toast('Could not read that file — is it a .chiron/.zip?'); return; }

  let names = Object.keys(files).filter(
    (n) => !n.endsWith('/') && !n.includes('__MACOSX/') && !n.endsWith('.DS_Store'),
  );
  if (!names.length) { toast('That bundle is empty.'); return; }

  const prefix = commonPrefix(names);
  const rel = (n) => (prefix && n.startsWith(prefix) ? n.slice(prefix.length) : n);
  const relPaths = names.map(rel);

  const entry = pickEntry(relPaths);
  if (!entry) { toast('No lesson HTML found in that bundle.'); return; }

  toast('Importing ' + relPaths.length + ' files…', 0);
  const id = 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const cache = await caches.open(LESSON_CACHE);

  let total = 0;
  for (const original of names) {
    const path = rel(original);
    const bytes = files[original];
    total += bytes.byteLength;
    const url = new URL('lessons/' + id + '/' + path, location.href).href;
    await cache.put(
      new Request(url),
      new Response(bytes, { headers: { 'Content-Type': mimeFor(path), 'Content-Length': String(bytes.byteLength) } }),
    );
  }

  const title = titleFromHtml(
    files[names[relPaths.indexOf(entry)]] || new Uint8Array(),
    name.replace(/\.(chiron\.)?zip$/i, '').replace(/\.chiron$/i, ''),
  );
  const list = loadIndex();
  list.unshift({ id, title, entry, size: total, importedAt: Date.now() });
  saveIndex(list);
  render();
  return title;
}

async function importBundle(file) {
  toast('Reading ' + file.name + '…', 0);
  const u8 = new Uint8Array(await file.arrayBuffer());
  const title = await importBundleBytes(u8, file.name);
  if (title) toast('Added “' + title + '”');
}

async function deleteLesson(id) {
  if (TAURI) {
    try { await window.__TAURI__.core.invoke('delete_lesson', { id }); } catch (e) { /* ignore */ }
    tauriLessons = tauriLessons.filter((l) => l.id !== id);
    render(); toast('Removed.');
    return;
  }
  const cache = await caches.open(LESSON_CACHE);
  const keys = await cache.keys();
  await Promise.all(
    keys.filter((req) => new URL(req.url).pathname.includes('/lessons/' + id + '/'))
        .map((req) => cache.delete(req)),
  );
  saveIndex(loadIndex().filter((l) => l.id !== id));
  render();
  toast('Removed.');
}

// ---------------------------------------------------------------------------
// viewer
// ---------------------------------------------------------------------------
function openLesson(l) {
  els.vtitle.textContent = l.title;
  els.frame.src = TAURI ? (LESSON_BASE + l.id + '/' + l.entry)
                        : new URL('lessons/' + l.id + '/' + l.entry, location.href).href;
  els.viewer.classList.add('open');
  document.body.style.overflow = 'hidden';
  // Push a history entry so the Android back gesture (or browser back) returns
  // to the library instead of exiting the app.
  history.pushState({ chironViewer: 1 }, '');
}
function actuallyClose() {
  els.viewer.classList.remove('open');
  els.frame.src = 'about:blank';
  document.body.style.overflow = '';
}
function closeViewer() {
  if (!els.viewer.classList.contains('open')) return;
  // Pop our pushed entry → fires popstate → actuallyClose(); falls back to a
  // direct close if the state isn't ours.
  if (history.state && history.state.chironViewer) history.back();
  else actuallyClose();
}
// Android system back / swipe-back, browser back button.
window.addEventListener('popstate', () => {
  if (els.viewer.classList.contains('open')) actuallyClose();
});

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------
function render() {
  const list = loadIndex();
  els.lessons.innerHTML = '';
  if (!list.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.innerHTML =
      '<div class="big"><img src="icons/icon-192.png" alt="" style="width:88px;height:88px;border-radius:19px"></div>' +
      '<p><strong>No lessons yet.</strong></p>' +
      '<p class="hint">Tap “Add lesson” and pick a <code>.chiron</code> file.<br>' +
      'It opens here instantly — no extracting, works offline.</p>';
    els.lessons.appendChild(e);
    return;
  }
  for (const l of list) {
    const card = document.createElement('div');
    card.className = 'card';
    const sub = (l.size ? humanSize(l.size) : 'Lesson')
              + (l.importedAt ? ' · added ' + new Date(l.importedAt).toLocaleDateString() : '');
    card.innerHTML =
      '<div class="thumb">📖</div>' +
      '<div class="meta">' +
        '<p class="title"></p>' +
        '<div class="sub">' + sub + '</div>' +
      '</div>' +
      '<button class="del" title="Remove" aria-label="Remove lesson">×</button>';
    card.querySelector('.title').textContent = l.title;
    card.addEventListener('click', () => openLesson(l));
    card.querySelector('.del').addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (confirm('Remove “' + l.title + '” from this device?')) deleteLesson(l.id);
    });
    els.lessons.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// server overlay
// ---------------------------------------------------------------------------
function domainIcon(domain) {
  if (!domain) return '📖';
  const d = String(domain).toLowerCase();
  if (d === 'medicine' || d === 'medical') return '🩺';
  if (d === 'language' || d === 'lang') return '🗣';
  return '📖';
}

async function renderServerList(catalog) {
  const library = loadIndex();
  const importedTitles = new Set(library.map((l) => l.title));
  els.serverList.innerHTML = '';

  if (!catalog.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.innerHTML = '<p><strong>No lessons available on this server.</strong></p>';
    els.serverList.appendChild(e);
    return;
  }

  for (const item of catalog) {
    const already = importedTitles.has(item.title);
    const row = document.createElement('div');
    row.className = 'server-item' + (already ? ' imported' : '');
    const sub = (item.sizeMB != null ? item.sizeMB + ' MB' : '')
              + (item.clips != null ? (item.sizeMB != null ? ' · ' : '') + item.clips + ' clips' : '');
    row.innerHTML =
      '<div class="si-thumb">' + domainIcon(item.domain) + '</div>' +
      '<div class="si-meta">' +
        '<p class="si-title"></p>' +
        '<div class="si-sub">' + sub + '</div>' +
      '</div>' +
      (already ? '<span class="si-badge">In library</span>' : '');
    row.querySelector('.si-title').textContent = item.title;
    if (!already) {
      row.addEventListener('click', () => getServerLesson(item));
    }
    els.serverList.appendChild(row);
  }
}

async function openServer() {
  els.server.classList.add('open');
  document.body.style.overflow = 'hidden';
  els.serverList.innerHTML = '<div class="empty"><p>Loading…</p></div>';

  let catalog = [];
  try {
    if (TAURI) {
      const result = await window.__TAURI__.core.invoke('server_lessons', { url: serverUrl() });
      // handle both {lessons:[...]} and [...] directly
      catalog = Array.isArray(result) ? result : (result.lessons || []);
    } else {
      const base = serverUrl();
      const sep = base.endsWith('/') ? '' : '/';
      const resp = await fetch(base + sep + 'lessons.json');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      catalog = Array.isArray(data) ? data : (data.lessons || []);
    }
  } catch (err) {
    els.serverList.innerHTML = '';
    const e = document.createElement('div');
    e.className = 'empty';
    e.innerHTML = '<p><strong>Server unreachable</strong></p>' +
                  '<p class="hint">Check the URL or your Wi-Fi connection.</p>';
    els.serverList.appendChild(e);
    toast('Server unreachable — check the URL/Wi-Fi');
    return;
  }

  await renderServerList(catalog);
}

async function getServerLesson(item) {
  toast('Downloading…', 0);
  try {
    if (TAURI) {
      const lesson = await window.__TAURI__.core.invoke('import_from_server', { url: serverUrl(), file: item.file });
      tauriLessons.unshift(lesson);
      render();
      toast('Added "' + lesson.title + '"');
    } else {
      const base = serverUrl();
      const sep = base.endsWith('/') ? '' : '/';
      const resp = await fetch(base + sep + item.file);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const buf = await resp.arrayBuffer();
      const title = await importBundleBytes(new Uint8Array(buf), item.file);
      if (title) toast('Added "' + title + '"');
    }
    // Refresh imported-state badges in the list without a full reload
    const library = loadIndex();
    const importedTitles = new Set(library.map((l) => l.title));
    els.serverList.querySelectorAll('.server-item').forEach((row) => {
      const t = row.querySelector('.si-title');
      if (t && importedTitles.has(t.textContent) && !row.classList.contains('imported')) {
        row.classList.add('imported');
        row.insertAdjacentHTML('beforeend', '<span class="si-badge">In library</span>');
        row.replaceWith(row.cloneNode(true)); // remove click listener
      }
    });
  } catch (err) {
    toast('Download failed — check the URL/Wi-Fi');
  }
}

function closeServer() {
  els.server.classList.remove('open');
  document.body.style.overflow = '';
}

// ---------------------------------------------------------------------------
// wire-up
// ---------------------------------------------------------------------------
// Tauri native import: native file dialog → Rust unzips + registers the lesson.
async function tauriImport() {
  try {
    // No extension filter: Android maps filters to MIME types and `.chiron`
    // has none, so a filter greys it out. Show all files; Rust validates it's
    // a real zip on import.
    const path = await window.__TAURI__.dialog.open({ multiple: false });
    if (!path) return;
    toast('Importing…', 0);
    // Read bytes via the fs plugin — it understands Android content:// URIs,
    // which std::fs in Rust cannot. Then hand the raw bytes to Rust to unzip.
    const data = await window.__TAURI__.fs.readFile(path);
    const lesson = await window.__TAURI__.core.invoke('import_lesson', { data });
    tauriLessons.unshift(lesson);
    render();
    toast('Added “' + lesson.title + '”');
  } catch (e) {
    toast('Import failed: ' + e);
  }
}

els.importBtn.addEventListener('click', () => { if (TAURI) tauriImport(); else els.fileInput.click(); });
els.fileInput.addEventListener('change', (ev) => {
  const f = ev.target.files && ev.target.files[0];
  els.fileInput.value = '';
  if (f) importBundle(f);
});
els.back.addEventListener('click', closeViewer);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeViewer(); closeServer(); } });

// Server overlay
els.getBtn.addEventListener('click', openServer);
els.serverClose.addEventListener('click', closeServer);

els.serverCfg.addEventListener('click', () => {
  const row = els.serverUrlRow;
  const opening = !row.classList.contains('open');
  row.classList.toggle('open');
  if (opening) {
    els.serverUrlInput.value = serverUrl();
    els.serverUrlInput.focus();
  }
});

function saveAndReloadServer() {
  const v = els.serverUrlInput.value.trim();
  if (v) setServerUrl(v);
  els.serverUrlRow.classList.remove('open');
  openServer();
}
els.serverUrlSave.addEventListener('click', saveAndReloadServer);
els.serverUrlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveAndReloadServer(); });

if (TAURI) {
  window.__TAURI__.core.invoke('list_lessons')
    .then((ls) => { tauriLessons = ls || []; render(); })
    .catch(() => render());
} else {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {
      toast('Offline mode unavailable here (needs https/localhost).');
    });
  } else {
    toast('This browser can’t run the offline player.');
  }
  render();
}
