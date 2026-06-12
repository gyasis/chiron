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

const els = {
  lessons: document.getElementById('lessons'),
  importBtn: document.getElementById('import-btn'),
  fileInput: document.getElementById('file-input'),
  viewer: document.getElementById('viewer'),
  frame: document.getElementById('frame'),
  back: document.getElementById('back-btn'),
  vtitle: document.getElementById('viewer-title'),
  toast: document.getElementById('toast'),
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
  try { return JSON.parse(localStorage.getItem(INDEX_KEY)) || []; }
  catch { return []; }
}
function saveIndex(list) { localStorage.setItem(INDEX_KEY, JSON.stringify(list)); }

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

async function importBundle(file) {
  if (!('caches' in window)) { toast('Storage unavailable — open via https/localhost.'); return; }
  toast('Reading ' + file.name + '…', 0);
  const buf = new Uint8Array(await file.arrayBuffer());

  let files;
  try { files = await unzip(buf); }
  catch { toast('Could not read that file — is it a .chiron/.zip?'); return; }

  // entries (skip directory placeholders + macOS junk)
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

  const title = titleFromHtml(files[names[relPaths.indexOf(entry)]] || new Uint8Array(),
                              file.name.replace(/\.(chiron\.)?zip$/i, '').replace(/\.chiron$/i, ''));
  const list = loadIndex();
  list.unshift({ id, title, entry, size: total, importedAt: Date.now() });
  saveIndex(list);
  render();
  toast('Added “' + title + '”');
}

async function deleteLesson(id) {
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
  els.frame.src = new URL('lessons/' + l.id + '/' + l.entry, location.href).href;
  els.viewer.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeViewer() {
  els.viewer.classList.remove('open');
  els.frame.src = 'about:blank';
  document.body.style.overflow = '';
}

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
    const d = new Date(l.importedAt);
    card.innerHTML =
      '<div class="thumb">📖</div>' +
      '<div class="meta">' +
        '<p class="title"></p>' +
        '<div class="sub">' + humanSize(l.size) + ' · added ' + d.toLocaleDateString() + '</div>' +
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
// wire-up
// ---------------------------------------------------------------------------
els.importBtn.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', (ev) => {
  const f = ev.target.files && ev.target.files[0];
  els.fileInput.value = '';
  if (f) importBundle(f);
});
els.back.addEventListener('click', closeViewer);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeViewer(); });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    toast('Offline mode unavailable here (needs https/localhost).');
  });
} else {
  toast('This browser can’t run the offline player.');
}

render();
