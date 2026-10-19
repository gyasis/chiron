/* handoff.js — "Riprendi": one learner, many screens. Reports WHERE the learner is reading so whichever screen opens
 * next can pick up there. Injected into every streamed lesson (server/app.py, next to select-report.js).
 *   in the phone app (?inapp=1)  postMessage({type:'chiron-handoff:pos', ...}) to the app, which owns the hub write
 *   in a browser tab             a quiet "📱 Continua sul telefono" chip + an automatic report (section change, pause)
 * Slot: GET/PUT /api/progress/now-studying, field "cur" = {lesson, anchor, scroll, title, section, ts, from}.
 * Same-origin on :8911 (relayed to the hub) and on the hub itself. A "#sf=0.42" hash restores a scroll fraction. */
(function () {
  'use strict';
  var m = location.pathname.match(/^\/lessons\/(.+)\/lesson\.html$/);
  if (!m) return;
  var lesson = m[1].split('/').map(decodeURIComponent).join('/');
  var inapp = /[?&]inapp=1\b/.test(location.search), framed = window.parent !== window;
  var API = '/api/progress/now-studying', last = '', timer = 0;

  /* RESCUE: a lesson loaded as the WHOLE page inside the Chiron phone app's WebView (a target=_blank link in an in-app
     page replaced the app; seen on the Galaxy 2026-10-18 — web pills over the status bar, "Continua sul telefono" on
     the phone). Pin this lesson in the hand-off slot and go back to the app, whose Riprendi banner reopens it in the
     app's own lesson screen (with its Ascolta tab). Android WebView user agents carry "; wv)"; Chrome does not. */
  if (!inapp && !framed && /; wv\)/.test(navigator.userAgent)) {
    var rp = { lesson: lesson, anchor: (location.hash || '').replace(/^#/, ''), section: '', scroll: 0,
               title: (document.title || lesson).replace(/^Chiron\s*·\s*/, '').slice(0, 140), ts: Date.now(), from: 'web' };
    var back = function () { location.replace('http://tauri.localhost/'); };
    fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: { cur: { v: rp, t: rp.ts }, pin: { v: rp, t: rp.ts } } }) }).then(back, back);
    setTimeout(back, 2500);
    return;
  }

  /* A lesson inside the app's lesson frame that lost ?inapp=1 (reached by a plain link or a script navigation) would
     render the web chrome in the app — Tutor tab, "Continua sul telefono" (seen 2026-10-18 after a hub link). Reload
     it with the marker. Framed + WebView UA = the app; a desktop page framing a lesson has no "; wv)". */
  if (!inapp && framed && /; wv\)/.test(navigator.userAgent) && /\/lesson\.html$/.test(location.pathname)) {
    var fix = new URL(location.href); fix.searchParams.set('inapp', '1');
    location.replace(fix.href);
    return;
  }

  /* In the app, keep every same-origin lesson link in this frame and carry ?inapp=1: a target=_blank link would replace
     the whole app WebView, and a plain link would drop the marker. Back returns to the page that linked. */
  if (inapp && framed) document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var t = a.getAttribute('target') || '';
    if (t && !/^_(blank|top|parent|self)$/i.test(t)) return;   // a named frame: not ours
    var u; try { u = new URL(a.href, location.href); } catch (err) { return; }
    if (u.origin !== location.origin) return;            // external sites: leave to the app's own handling
    if (!t && !/\/lesson\.html$/.test(u.pathname)) return;   // plain non-lesson links (anchors, assets) work as they are
    if (!t && u.pathname === location.pathname) return;  // same-page anchor
    e.preventDefault();
    if (/\/lesson\.html$/.test(u.pathname) && !/[?&]inapp=1\b/.test(u.search)) u.searchParams.set('inapp', '1');
    location.href = u.href;
  }, true);

  var sf = location.hash.match(/^#sf=([\d.]+)/);       // restore a bare scroll fraction (no section anchor to jump to)
  if (sf) addEventListener('load', function () {
    var h = document.documentElement.scrollHeight - innerHeight; if (h > 0) scrollTo(0, h * Math.min(1, +sf[1] || 0));
  });

  function section() {
    var hs = document.querySelectorAll('h1[id],h2[id],h3[id],h4[id],section[id]'), cur = null;
    for (var i = 0; i < hs.length; i++) { if (hs[i].getBoundingClientRect().top <= 90) cur = hs[i]; else break; }
    if (!cur) return { anchor: '', section: '' };
    var t = /^SECTION$/i.test(cur.tagName) ? (cur.querySelector('h1,h2,h3,h4') || cur) : cur;
    return { anchor: cur.id, section: (t.textContent || '').replace(/\s+/g, ' ').trim().replace(/^\d{1,2}\.?\s*(?=\S)/, '').slice(0, 120) };   // drop the TOC number ("4DAT in pratica")
  }
  function pos() {
    var h = document.documentElement.scrollHeight - innerHeight, s = section();
    return { lesson: lesson, anchor: s.anchor, section: s.section, scroll: h > 0 ? Math.round(scrollY / h * 1000) / 1000 : 0,
             title: (document.title || lesson).replace(/^Chiron\s*·\s*/, '').slice(0, 140), ts: Date.now() };
  }
  /* force: write even without a section change (page hide). explicit: the learner pressed the button — that also writes
     field "pin", which every Riprendi banner prefers for 30 min, so a tab left open elsewhere cannot overwrite a
     deliberate hand-off with its automatic reports (seen 2026-10-18). */
  function send(force, explicit) {
    var p = pos(), key = p.lesson + '#' + p.anchor;
    if (!force && key === last) return;               // throttle: only on a section change (or a pause after a move)
    last = key;
    if (inapp && framed) { try { parent.postMessage(Object.assign({ type: 'chiron-handoff:pos' }, p), '*'); } catch (e) { console.warn('chiron handoff: postMessage failed', e); } return Promise.resolve(true); }
    p.from = 'web';
    return fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ entries: explicit ? { cur: { v: p, t: p.ts }, pin: { v: p, t: p.ts } } : { cur: { v: p, t: p.ts } } }) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return true; })
      .catch(function (e) { console.warn('chiron handoff: could not save position —', e.message); return false; });
  }
  function soon() { clearTimeout(timer); timer = setTimeout(function () { send(false); }, 1500); }
  addEventListener('scroll', soon, { passive: true });
  addEventListener('pagehide', function () { send(true); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) send(true); });
  setTimeout(function () { send(false); }, 1200);       // opening a lesson = "now studying"

  if (inapp || framed) return;                          // the app has its own ‘···’ menu entry
  var b = document.createElement('button');
  b.id = 'chiron-handoff-btn'; b.type = 'button'; b.textContent = '📱 Continua sul telefono';
  b.setAttribute('style', 'position:fixed;left:14px;bottom:14px;z-index:2147483000;font:500 13px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;' +
    'padding:9px 14px;border-radius:999px;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.12);color:inherit;' +
    'backdrop-filter:blur(6px);cursor:pointer');
  b.onclick = function () {
    b.textContent = '…'; send(true, true).then(function (ok) {
      b.textContent = ok ? '✓ Salvato — riprendi sul telefono' : '⚠ Non salvato';
      setTimeout(function () { b.textContent = '📱 Continua sul telefono'; }, 2600);
    });
  };
  // "Continue on the phone" means nothing when this IS a phone (touch + narrow screen)
  var st = document.createElement('style'); st.textContent = '@media print{#chiron-handoff-btn{display:none}}@media (pointer:coarse) and (max-width:900px){#chiron-handoff-btn{display:none}}';
  document.head.appendChild(st); document.body.appendChild(b);
})();
