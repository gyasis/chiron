/* listen-size.js — make the floating "🎧 Listen" panel (.chiron-listen, desktop web) enlargeable.
 * It is 230px wide with its list capped at 46vh, too small to scroll a long playlist comfortably (Gyasi, 2026-10-18).
 * Adds a ⤢ button to its header that toggles a large size (wider, taller list); the choice is remembered in
 * localStorage "chiron.listen.big". Server-injected next to lesson-nav.js. The phone hides this panel (it uses the
 * bottom-bar player), so this only matters on desktop. */
(function () {
  'use strict';
  if (window.__chironListenSize) return; window.__chironListenSize = true;
  var KEY = 'chiron.listen.big';
  var css = document.createElement('style');
  css.textContent =
    '.chiron-listen.cl-big{width:min(460px,calc(100vw - 36px))!important}' +
    '.chiron-listen.cl-big{max-height:85vh;overflow-y:auto}' +
    '.chiron-listen.cl-big .chiron-listen-list,.chiron-listen.cl-big .chiron-listen-group{max-height:none!important}' +
    '.chiron-listen.cl-big .chiron-listen-btn{font-size:15px;padding-top:9px;padding-bottom:9px}' +
    '.cl-size{position:relative;z-index:2;margin-left:auto;border:1px solid var(--color-border,#e2e2e2);background:none;color:inherit;' +
    'border-radius:8px;font:600 13px/1 system-ui,sans-serif;padding:4px 8px;cursor:pointer}' +
    '.cl-size:hover{background:var(--color-accent-light,#f3f3f3)}';
  document.head.appendChild(css);

  function get() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
  function put(v) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) { /* private mode: not remembered */ } }

  function wire(panel) {
    var head = panel.querySelector('.chiron-listen-head');
    if (!head || head.querySelector('.cl-size')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'cl-size';
    var apply = function (big) {
      panel.classList.toggle('cl-big', big);
      b.textContent = big ? '⤡' : '⤢';
      b.title = big ? 'Riduci' : 'Ingrandisci';
      b.setAttribute('aria-label', b.title);
    };
    b.addEventListener('click', function (e) {   // the header has its own click (collapse): keep this one ours
      e.stopPropagation(); e.preventDefault();
      var big = !panel.classList.contains('cl-big'); put(big); apply(big);
    }, true);
    var col = head.querySelector('.chiron-listen-collapse');
    if (col) { col.style.marginLeft = '6px'; head.insertBefore(b, col); } else head.appendChild(b);
    apply(get());
  }

  function scan() { var p = document.querySelector('.chiron-listen'); if (p) wire(p); return !!p; }
  if (!scan()) {   // the panel is built after load by the lesson's own script
    var mo = new MutationObserver(function () { if (scan()) mo.disconnect(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { mo.disconnect(); }, 20000);
  }
})();
