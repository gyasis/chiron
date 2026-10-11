/* ── Chiron Pimsleur read-along ─────────────────────────────────────────────
   Shows the words of the Pimsleur drill in sync with the audio: the line being
   spoken (English narrator / Italian / the examiner's question) and, in the
   silences, the learner's turn ("Tocca a te", "Ripeti", free talk countdown).

   Self-contained and inlined into each lesson.html by
   scripts/upgrade_player_pimsleur.py (lessons work offline: phone app, file://,
   Chiron server). It never touches the player: it notices any <audio>/Audio()
   whose src is the drill (…/pimsleur.mp3) by wrapping HTMLMediaElement.play,
   and follows that element's currentTime.

   Timeline: window.__chironPimsleurTimeline (audio/pimsleur.timeline.js, works
   on file://), else audio/pimsleur.timeline.json via fetch. No timeline → the
   panel simply never appears.
   ─────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';
  if (window.__chironReadalong) return;
  window.__chironReadalong = true;
  var LS_HIDE = 'chiron.readalong.hidden';
  var TL = null, rows = [], panel = null, cur = -1, hidden = false;
  try { hidden = localStorage.getItem(LS_HIDE) === '1'; } catch (e) {}

  function load(cb) {
    if (window.__chironPimsleurTimeline) return cb(window.__chironPimsleurTimeline);
    var s = document.createElement('script');
    s.src = 'audio/pimsleur.timeline.js';
    s.onload = function () { cb(window.__chironPimsleurTimeline || null); };
    s.onerror = function () {
      if (!window.fetch) return cb(null);
      fetch('audio/pimsleur.timeline.json').then(function (r) { return r.ok ? r.json() : null; })
        .then(cb, function () { cb(null); });
    };
    document.head.appendChild(s);
  }

  // Turn the raw timeline into display rows: [start, end, kind, text].
  function prepare(tl) {
    var t = tl.timeline || [], out = [], examNext = false;
    for (var i = 0; i < t.length; i++) {
      var e = t[i], end = i + 1 < t.length ? t[i + 1].t : (tl.durationS || e.t + 5);
      if (e.who === 'cue') {
        examNext = /^The examiner asks/.test(e.text);
        out.push([e.t, end, 'en', e.text]);
      } else if (e.who === 'target') {
        out.push([e.t, end, examNext ? 'exam' : 'it', e.text]); examNext = false;
      } else if (e.who === 'answer' || e.who === 'pause') {
        out.push([e.t, end, 'turn', 'Tocca a te — rispondi']);
      } else if (e.who === 'repeat') {
        out.push([e.t, end, 'repeat', 'Ripeti']);
      } else if (e.who === 'talk') {
        out.push([e.t, end, 'talk', 'Parla liberamente']);
      }
    }
    return out;
  }

  function css() {
    var st = document.createElement('style');
    st.textContent =
      '.cra{position:fixed;left:50%;transform:translateX(-50%);bottom:96px;z-index:2147483000;width:min(560px,calc(100vw - 32px));' +
      'background:var(--cra-bg);color:var(--cra-fg);border:1px solid var(--cra-line);border-radius:14px;' +
      'box-shadow:0 8px 28px rgba(0,0,0,.18);padding:12px 14px 12px;font:16px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}' +
      '.cra{--cra-bg:#fffdf8;--cra-fg:#2a2420;--cra-mute:#7a6f66;--cra-line:#e6ddd0;--cra-chip:#f3ece2}' +
      '@media (prefers-color-scheme:dark){.cra{--cra-bg:#1f1c1a;--cra-fg:#f2ece6;--cra-mute:#a99d92;--cra-line:#3a342f;--cra-chip:#2c2724}}' +
      '.cra-prev{color:var(--cra-mute);font-size:13px;min-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.cra-now{margin-top:4px;font-size:19px;min-height:27px}' +
      // state classes are PREFIXED: lesson CSS already styles bare .turn/.it (dialogue turns -> display:grid)
      '.cra-now{display:block}' +
      '.cra-now.cra-k-en{font-style:italic;color:var(--cra-mute);font-size:16px}' +
      '.cra-now.cra-k-it,.cra-now.cra-k-exam{font-weight:650}' +
      '.cra-now.cra-k-turn,.cra-now.cra-k-repeat,.cra-now.cra-k-talk{color:var(--cra-mute)}' +
      '.cra-tag{display:inline-block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--cra-mute);' +
      'background:var(--cra-chip);border-radius:6px;padding:1px 6px;margin-right:6px;vertical-align:2px}' +
      '.cra-x{position:absolute;top:6px;right:8px;border:0;background:none;color:var(--cra-mute);font-size:15px;cursor:pointer;padding:4px}' +
      '.cra-show{position:fixed;right:16px;bottom:96px;z-index:2147483000;border:1px solid var(--cra-line,#e6ddd0);' +
      'background:var(--cra-bg,#fffdf8);color:var(--cra-fg,#2a2420);border-radius:999px;padding:6px 12px;font:13px system-ui,sans-serif;cursor:pointer}' +
      '@media (min-width:900px){.cra{bottom:24px}.cra-show{bottom:24px}}';
    document.head.appendChild(st);
  }

  function build() {
    css();
    panel = document.createElement('div');
    panel.className = 'cra'; panel.setAttribute('role', 'status'); panel.setAttribute('aria-live', 'polite');
    panel.innerHTML = '<button class="cra-x" type="button" aria-label="Hide the words">✕</button>' +
                      '<div class="cra-prev"></div><div class="cra-now"></div>';
    var show = document.createElement('button');
    show.className = 'cra-show'; show.type = 'button'; show.textContent = 'Aa testo';
    panel.querySelector('.cra-x').onclick = function () { setHidden(true); };
    show.onclick = function () { setHidden(false); };
    panel._show = show;
    document.body.appendChild(panel); document.body.appendChild(show);
    setHidden(hidden); panel.style.display = 'none'; show.style.display = 'none';
  }

  function setHidden(h) {
    hidden = h;
    try { localStorage.setItem(LS_HIDE, h ? '1' : '0'); } catch (e) {}
    if (!panel || !panel._active) return;
    panel.style.display = h ? 'none' : ''; panel._show.style.display = h ? '' : 'none';
  }

  function label(k) {
    return k === 'exam' ? '<span class="cra-tag">Esaminatore</span>' : k === 'it' ? '<span class="cra-tag">IT</span>' :
           k === 'en' ? '<span class="cra-tag">EN</span>' : k === 'talk' ? '🎙 ' : k === 'turn' ? '🎙 ' : k === 'repeat' ? '↻ ' : '';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function render(t) {
    var i = cur;
    if (i < 0 || !(rows[i][0] <= t && t < rows[i][1])) {
      i = -1;
      for (var k = 0; k < rows.length; k++) if (rows[k][0] <= t && t < rows[k][1]) { i = k; break; }
    }
    if (i === cur) {
      if (i >= 0 && rows[i][2] === 'talk') panel.querySelector('.cra-now').innerHTML =
        label('talk') + 'Parla liberamente — ' + Math.max(0, Math.ceil(rows[i][1] - t)) + ' s';
      return;
    }
    cur = i;
    var now = panel.querySelector('.cra-now'), prev = panel.querySelector('.cra-prev');
    if (i < 0) { now.className = 'cra-now'; now.innerHTML = ''; prev.textContent = ''; return; }
    var r = rows[i], p = null;
    for (var j = i - 1; j >= 0; j--) if (rows[j][2] === 'en' || rows[j][2] === 'it' || rows[j][2] === 'exam') { p = rows[j]; break; }
    now.className = 'cra-now cra-k-' + r[2];
    now.innerHTML = label(r[2]) + esc(r[3]);
    prev.textContent = (r[2] === 'turn' || r[2] === 'repeat' || r[2] === 'talk') && p ? p[3] : (p ? p[3] : '');
  }

  // The drill element: its src is …/pimsleur.mp3, or (phone app / bundles) the blob: URL the player mapped it to.
  function isDrill(el) {
    var src = el.currentSrc || el.src || '';
    if (/pimsleur\.mp3/.test(src)) return true;
    var b = window._chironClipBlobs;
    if (b) for (var k in b) if (/pimsleur\.mp3/.test(k) && b[k] === src) return true;
    return false;
  }

  function follow(el) {
    if (el.__craFollow) return;
    el.__craFollow = true;
    el.addEventListener('timeupdate', function () {
      if (!isDrill(el)) { if (panel) { panel.style.display = 'none'; panel._show.style.display = 'none'; panel._active = false; } return; }
      if (!rows.length) return;
      if (!panel._active) { panel._active = true; setHidden(hidden); }
      render(el.currentTime);
    });
  }

  function init() {
    load(function (tl) {
      if (!tl || !tl.timeline) return;
      rows = prepare(tl);
      build();
      var play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        try { follow(this); } catch (e) {}   // follow() itself checks isDrill on every timeupdate
        return play.apply(this, arguments);
      };
      [].forEach.call(document.querySelectorAll('audio'), follow);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
