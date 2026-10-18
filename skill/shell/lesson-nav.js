/* lesson-nav.js — a ☰ for a lesson whose sidebar is hidden and which shows no ☰ of its own, so its sections and
 * theme buttons are always reachable. The generated lessons hide the theme bar at 769-880 px and only add their
 * own ☰ at <=768 px: the Pixel Fold's inner screen (iframe ~830 px) fell in that gap (2026-10-18).
 * The sheet's theme buttons drive the lesson's own (hidden) switcher, so it stays the one that saves and
 * highlights: language lessons have `.theme-bar` buttons, medicine lessons a `.theme-select` dropdown. In the phone app (?inapp=1) the sidebar also gets bottom room: the app's
 * "Chiedi a Lucrezia" button floats over the lesson's bottom-left corner.
 * Injected into every lesson.html at serve time (server/app.py), next to select-report.js. */
(function () {
  'use strict';
  var side = document.querySelector('aside.side');
  if (!side) return;
  var css = document.createElement('style');
  css.textContent =
    '.cl-nav-btn{position:fixed;top:12px;left:12px;z-index:10100;width:44px;height:44px;display:none;align-items:center;justify-content:center;' +
    'background:var(--chiron-surface,#fff);color:var(--chiron-fg,#222);border:1px solid var(--chiron-border,#ccc);border-radius:10px;' +
    'box-shadow:0 4px 14px rgba(0,0,0,.18);font-size:20px;cursor:pointer}' +
    '.cl-nav-btn.on{display:flex}' +
    '.cl-nav-sheet{position:fixed;inset:0;z-index:10101;display:none;background:rgba(0,0,0,.35)}' +
    '.cl-nav-sheet.open{display:block}' +
    '.cl-nav-in{position:absolute;top:0;left:0;bottom:0;width:min(320px,86vw);overflow-y:auto;padding:16px 16px 96px;' +
    'background:var(--chiron-surface,#fff);color:var(--chiron-fg,#222);box-shadow:4px 0 24px rgba(0,0,0,.25)}' +
    '.cl-nav-in h4{margin:14px 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--chiron-fg-secondary,#666)}' +
    '.cl-nav-in a{display:block;padding:8px 6px;border-radius:8px;color:inherit;text-decoration:none}' +
    '.cl-nav-in a:hover{background:var(--chiron-border,#eee)}' +
    '.cl-nav-themes{display:flex;flex-wrap:wrap;gap:6px}' +
    '.cl-nav-themes button{padding:6px 10px;border-radius:99px;border:1px solid var(--chiron-border,#ccc);background:transparent;color:inherit;cursor:pointer}' +
    '.cl-nav-themes button[aria-pressed="true"]{background:var(--chiron-accent,#1e3a5f);border-color:var(--chiron-accent,#1e3a5f);color:#fff}' +
    (/[?&]inapp=1\b/.test(location.search) ? 'aside.side{padding-bottom:80px!important}' : '');
  document.head.appendChild(css);

  var btn = document.createElement('button');
  btn.className = 'cl-nav-btn'; btn.type = 'button'; btn.setAttribute('aria-label', 'Sezioni e tema'); btn.textContent = '☰';
  var sheet = document.createElement('div');
  sheet.className = 'cl-nav-sheet';
  sheet.innerHTML = '<div class="cl-nav-in" role="dialog" aria-label="Sezioni e tema"></div>';
  var inner = sheet.firstChild;
  document.body.appendChild(btn); document.body.appendChild(sheet);

  function shown(el) {
    if (!el) return false;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth;
  }
  // Needed when the lesson offers neither its own ☰ nor a visible theme bar.
  function needed() {
    var bars = document.querySelectorAll('.theme-bar, .theme-switcher');
    for (var i = 0; i < bars.length; i++) if (shown(bars[i])) return false;
    return !shown(document.querySelector('.chiron-hamburger'));
  }
  function paintPressed() {
    var cur = document.documentElement.getAttribute('data-theme');
    inner.querySelectorAll('.cl-nav-themes button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.t === cur ? 'true' : 'false'); });
  }
  function build() {
    inner.innerHTML = '';
    var links = side.querySelectorAll('.toc-link');
    if (links.length) {
      inner.insertAdjacentHTML('beforeend', '<h4>Sezioni</h4>');
      links.forEach(function (a) {
        var c = document.createElement('a'); c.href = a.getAttribute('href'); c.textContent = a.textContent.replace(/\s+/g, ' ').trim();
        c.onclick = function () { close(); };
        inner.appendChild(c);
      });
    }
    var themes = [], sel = document.querySelector('.theme-select');
    document.querySelectorAll('.theme-bar [data-set-theme]').forEach(function (o) {
      themes.push({ t: o.getAttribute('data-set-theme'), label: o.textContent.trim(), apply: function () { o.click(); } });
    });
    if (!themes.length && sel) Array.prototype.forEach.call(sel.options, function (o) {
      themes.push({ t: o.value, label: o.textContent.trim(), apply: function () { sel.value = o.value; sel.dispatchEvent(new Event('change')); } });
    });
    if (themes.length) {
      inner.insertAdjacentHTML('beforeend', '<h4>Tema</h4><div class="cl-nav-themes"></div>');
      var box = inner.querySelector('.cl-nav-themes');
      themes.forEach(function (th) {
        var b = document.createElement('button'); b.type = 'button'; b.dataset.t = th.t; b.textContent = th.label;
        b.onclick = function () { th.apply(); paintPressed(); };
        box.appendChild(b);
      });
    }
    paintPressed();
  }
  function open() { build(); sheet.classList.add('open'); }
  function close() { sheet.classList.remove('open'); }
  function update() { var n = needed(); btn.classList.toggle('on', n); if (!n) close(); }
  btn.onclick = open;
  sheet.onclick = function (e) { if (e.target === sheet) close(); };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  window.addEventListener('resize', update);
  window.addEventListener('load', update);
  // The lesson adds its own ☰ from script, possibly after this runs: re-check when the body gains children.
  new MutationObserver(update).observe(document.body, { childList: true });
  update();
})();
