/* chrome-lanes.js — "lanes" layout for the floating controls of a lesson page. ON by default (approved 2026-10-19); opt out
 * with ?lanes=0 or localStorage 'chiron.lanes' === '0'.  Rule (2026-10-18): every floating control lives in its own
 * lane — never over another control, a title or an interactive element; only the ☰ (.cl-nav-btn / .chiron-hamburger) may cover content.
 *   - bottom dock #chiron-dock adopts #chiron-handoff-btn | #wp-mini | .cl-lang (app mode: .cl-lang only, right, >=84px for the app's own pill)
 *   - --chiron-dock-h (on <html>) is the dock's height; body/scroll padding reserves it; .cra (Pimsleur read-along) sits above it
 *   - duplicate ☰ / bottom bars hidden; the in-page players are hidden in the app; the lesson's own #enBtn hidden when .cl-lang exists
 * Server-injected into /lessons/**\/lesson.html (server/app.py). window.__chironLanes = {dockH(), report()} for the audit. */
(function () {
  'use strict';
  var on = !/[?&]lanes=0(&|$)/.test(location.search);
  if (on) { try { on = localStorage.getItem('chiron.lanes') !== '0'; } catch (e) { /* private window: keep the default */ } }
  if (!on || window.__chironLanes) return;
  if (window.parent !== window && !/[?&]inapp=1/.test(location.search)) return;   // library iframes: leave alone
  var inapp = /[?&]inapp=1/.test(location.search);
  var root = document.documentElement;
  root.classList.add('chiron-lanes');
  if (inapp) root.classList.add('chiron-lanes-app');

  var css = document.createElement('style'); css.setAttribute('data-lt-own', '1');
  css.textContent =
    '#chiron-dock{position:fixed;left:0;right:0;bottom:0;z-index:9998;display:flex;align-items:center;gap:8px;box-sizing:border-box;' +
    'padding:8px 12px calc(8px + env(safe-area-inset-bottom,0px));background:transparent;pointer-events:none;' +
    'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
    '#chiron-dock:empty{display:none}' +
    '#chiron-dock>*{pointer-events:auto}' +
    '#chiron-dock .cl-docked{position:static!important;inset:auto!important;transform:none!important;margin:0!important;z-index:auto!important;box-sizing:border-box}' +
    '#chiron-dock #chiron-handoff-btn{order:1;flex:0 0 auto}' +
    '#chiron-dock #wp-mini{order:2;flex:1 1 0;min-width:0;width:auto!important;max-width:720px;margin:0 auto!important}' +
    '#chiron-dock .acolyte-fab{order:4;flex:0 0 auto}#chiron-dock .cl-lang{order:3;flex:0 0 auto;margin-left:auto!important}' +
    'html.chiron-lanes-app #chiron-dock{min-height:84px;align-items:flex-end;justify-content:flex-end}' +
    '#chiron-dock.cl-compact #chiron-handoff-btn{font-size:0!important;padding:0!important;width:40px;height:40px;display:grid!important;place-items:center}' +
    '#chiron-dock.cl-compact #chiron-handoff-btn::before{content:"\\1F4F1";font-size:18px;line-height:1}' +
    'html.chiron-lanes body{padding-bottom:calc(var(--chiron-dock-h,0px) + var(--chiron-bar-h,0px) + 8px)!important}' +
    'html.chiron-lanes{scroll-padding-bottom:calc(var(--chiron-dock-h,0px) + var(--chiron-bar-h,0px) + 8px)}' +
    'html.chiron-lanes .cra{bottom:calc(var(--chiron-dock-h,0px) + 12px)!important;left:calc(50% + var(--chiron-side-w,0px) / 2)!important;width:min(560px,calc(100vw - var(--chiron-side-w,0px) - 32px))!important}' +
    'html.chiron-lanes .cra-show{bottom:calc(var(--chiron-dock-h,0px) + 12px)!important}' +
    'html.chiron-lanes .chiron-bottom-bar{bottom:var(--chiron-dock-h,0px)!important}' +
    'html.chiron-lanes-app .chiron-listen,html.chiron-lanes-app .chiron-bottom-bar{display:none!important}' +
    'html.chiron-lanes .cl-dup{display:none!important}' +
    'html.chiron-tutor-open:not(.chiron-tutor-pushed) #chiron-dock,html.chiron-tutor-open.chiron-tutor-max #chiron-dock{z-index:9990}' +
    'html.chiron-tutor-pushed:not(.chiron-tutor-max) #chiron-dock{right:var(--ct-width,380px)}';
  document.head.appendChild(css);

  var dock = document.createElement('div'); dock.id = 'chiron-dock'; dock.setAttribute('role', 'toolbar'); dock.setAttribute('aria-label', 'Lesson controls');
  document.body.appendChild(dock);

  var WEB = ['#chiron-handoff-btn', '#wp-mini', '.cl-lang', '.acolyte-fab'], APP = ['.cl-lang', '.acolyte-fab'];
  function adopt() {
    (inapp ? APP : WEB).forEach(function (s) {
      var el = document.querySelector(s);
      if (el && el.parentNode !== dock) {
        el.classList.add('cl-docked'); dock.appendChild(el);
        if (el.id === 'chiron-handoff-btn') { el.title = el.title || 'Continua sul telefono'; el.setAttribute('aria-label', 'Continua sul telefono'); }
      }
    });
    ['.chiron-hamburger', '.chiron-bottom-bar'].forEach(function (s) {       // built twice on some language lessons: keep the first
      var l = document.querySelectorAll(s); for (var i = 1; i < l.length; i++) l[i].classList.add('cl-dup');
    });
    if (document.querySelector('.cl-lang')) { var b = document.querySelector('button.en-btn#enBtn'); if (b) b.classList.add('cl-dup'); }
    side(); measure();
  }
  // a sticky/in-flow sidebar on the left (not an off-canvas drawer): the dock starts at its right edge, never over it
  function side() {
    var a = document.querySelector('aside.side'), off = 0;
    if (a) { var r = a.getBoundingClientRect(), cs = getComputedStyle(a);
      if (cs.position !== 'fixed' && cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 1 && r.left <= 1 && r.right < innerWidth * .6) off = Math.round(r.right); }
    dock.style.left = off + 'px'; root.style.setProperty('--chiron-side-w', off + 'px');
  }
  function measure() {
    dock.classList.toggle('cl-compact', dock.clientWidth <= 760);   // narrow dock: the hand-off shows as an icon only
    var h = dock.getBoundingClientRect().height;
    if (inapp) h = Math.max(h, 84);
    root.style.setProperty('--chiron-dock-h', Math.round(h) + 'px');
    var bb = document.querySelector('.chiron-bottom-bar:not(.cl-dup)'), bh = 0;
    if (bb && getComputedStyle(bb).display !== 'none') bh = Math.round(bb.getBoundingClientRect().height);
    root.style.setProperty('--chiron-bar-h', bh + 'px');
  }
  var raf = 0;
  function soon() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; adopt(); }); }
  new MutationObserver(soon).observe(document.body, { childList: true, subtree: true });
  if (window.ResizeObserver) new ResizeObserver(measure).observe(dock);
  addEventListener('resize', soon);
  adopt(); setTimeout(adopt, 1500); setTimeout(adopt, 4000);
  window.__chironLanes = { dockH: function () { return parseInt(root.style.getPropertyValue('--chiron-dock-h')) || 0; },
    report: function () { return { inapp: inapp, dock: [].map.call(dock.children, function (c) { return c.id || c.className; }), h: this.dockH() }; } };
})();
