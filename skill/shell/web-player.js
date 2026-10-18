/* web-player.js — the ONE audio player for the web lessons: the phone app's Ascolta player (mobile/play.js, served at
 * /shell/play.js) mounted in the page. Replaces the old floating "Listen"/"Ascolta" panels, which restarted clips on
 * every tap and had no scrubber (Gyasi, 2026-10-18: "unify the audio player, scrub, enlarge").
 *   mini bar (docked, bottom centre): ▶/❚❚ · title · scrubber · time · ⤢
 *   ⤢ → podcast view: full-height sheet with cover, scrubber, ±15 s, prev/next, speed, Aa testo (subtitles), playlist
 * Resume position, speed and captions are play.js's own (localStorage + hub /api/progress/chiron-play-<slug>).
 * Server-injected (server/app.py) into lessons that have audio/; not in the phone app (?inapp=1, it has its own player)
 * and not on video episodes (they have their own player). Esc closes the podcast view; Space toggles play in it. */
(function () {
  'use strict';
  if (window.__chironWebPlayer) return; window.__chironWebPlayer = true;
  if (/[?&]inapp=1\b/.test(location.search) || window.parent !== window) return;
  if (document.querySelector('.subsbar')) return;
  var m = location.pathname.match(/^\/lessons\/(.+)\/lesson\.html$/); if (!m) return;
  var slug = m[1].split('/').map(decodeURIComponent).join('/');
  window.askBase = window.askBase || function () { return ''; };   // play.js: same-origin hub relay on :8911

  var css = document.createElement('style');
  css.textContent = [
    ':root{--wp-bg:var(--color-surface,#fff);--wp-fg:var(--color-text,#1a1a1a);--wp-mut:var(--color-text-muted,#777);',
    '--wp-acc:var(--color-accent,#D94F30);--wp-el:var(--color-accent-light,#f3efe9);--wp-bd:var(--color-border,#e2e2e2)}',
    '.chiron-listen,.chiron-bottom-bar{display:none!important}',            /* the old players, retired */
    '#wp-mini{position:fixed;left:50%;transform:translateX(-50%);bottom:14px;z-index:9998;width:min(720px,calc(100vw - 28px));',
    'display:flex;align-items:center;gap:10px;padding:8px 10px 8px 8px;border-radius:16px;background:var(--wp-bg);color:var(--wp-fg);',
    'border:1px solid var(--wp-bd);box-shadow:0 10px 34px rgba(0,0,0,.18);font:14px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    '#wp-mini .wp-pp{flex:0 0 42px;height:42px;border-radius:50%;border:none;background:var(--wp-acc);color:#fff;display:grid;place-items:center;cursor:pointer}',
    '#wp-mini .wp-mid{flex:1;min-width:0}',
    '#wp-mini .wp-ttl{font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#wp-mini .wp-row{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--wp-mut)}',
    '#wp-mini input[type=range]{flex:1;accent-color:var(--wp-acc);height:18px;margin:0}',
    '#wp-mini .wp-x{flex:0 0 auto;border:1px solid var(--wp-bd);background:none;color:inherit;border-radius:10px;padding:8px 10px;cursor:pointer;font-weight:700}',
    '#wp-sheet{position:fixed;inset:0;z-index:2147483600;background:rgba(0,0,0,.35);display:none}',
    '#wp-sheet.on{display:block}',
    '#wp-sheet .wp-card{position:absolute;right:0;top:0;bottom:0;width:min(560px,100vw);background:var(--wp-bg);color:var(--wp-fg);',
    'display:flex;flex-direction:column;padding:18px 22px 14px;box-shadow:-10px 0 40px rgba(0,0,0,.2);',
    'font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:hidden}',
    '#wp-sheet .wp-top{display:flex;align-items:center;gap:10px;margin-bottom:10px}',
    '#wp-sheet .wp-top b{flex:1;font-size:13px;color:var(--wp-mut);text-transform:uppercase;letter-spacing:.06em}',
    '#wp-sheet .wp-close{border:1px solid var(--wp-bd);background:none;color:inherit;border-radius:10px;padding:6px 12px;cursor:pointer;font-weight:700}',
    /* play.js's own markup, styled like the phone app */
    '#wp-sheet .cover{border-radius:16px;background:var(--wp-el);display:grid;place-items:center;font-weight:800;font-size:15px;text-align:center;padding:22px 16px;margin:0 0 12px}',
    '#wp-sheet .np-t{font-weight:800;font-size:20px;line-height:1.25}#wp-sheet .np-s{color:var(--wp-mut);font-size:13px;margin-top:3px;min-height:1.2em}',
    '#wp-sheet .seek{width:100%;margin:12px 0 0;accent-color:var(--wp-acc);height:22px}',
    '#wp-sheet .tspan{display:flex;justify-content:space-between;font-size:12px;color:var(--wp-mut)}',
    '#wp-sheet .transport{display:flex;align-items:center;justify-content:center;gap:16px;margin:10px 0 8px}',
    '#wp-sheet .transport button{border:none;background:none;color:var(--wp-fg);padding:8px;display:grid;place-items:center;font:inherit;cursor:pointer}',
    '#wp-sheet .transport button:disabled{opacity:.3}',
    '#wp-sheet .transport .t15{font-weight:700;font-size:13px;color:var(--wp-mut)}',
    '#wp-sheet .transport .play{width:66px;height:66px;border-radius:50%;background:var(--wp-acc);color:#fff;padding:0}',
    '#wp-sheet .speed{display:flex;justify-content:center;gap:8px;margin:0 0 10px;flex-wrap:wrap}',
    '#wp-sheet .speed button{border:1px solid var(--wp-bd);background:none;color:var(--wp-fg);font-weight:700;font-size:12px;padding:6px 12px;border-radius:99px;cursor:pointer}',
    '#wp-sheet .speed button.on,#wp-sheet .speed button[aria-pressed="true"]{background:var(--wp-el);color:var(--wp-acc);border-color:var(--wp-acc)}',
    '#wp-sheet .plcap{margin:0 0 10px;padding:12px 14px;border-radius:14px;background:var(--wp-el);min-height:3.2em}',
    '#wp-sheet .plcap-it{font-weight:600;font-size:17px;line-height:1.4}#wp-sheet .plcap-en{color:var(--wp-mut);font-size:14px;margin-top:4px}',
    '#wp-sheet .plcap .was{opacity:.55}',
    '#wp-sheet .pllist{flex:1;min-height:80px;overflow-y:auto;border-top:1px solid var(--wp-bd);padding-top:4px}',
    '#wp-sheet .plg{font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--wp-mut);margin:10px 4px 2px}',
    '#wp-sheet .pli{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:none;background:none;color:var(--wp-fg);font:inherit;font-size:14px;padding:9px 6px;border-radius:9px;cursor:pointer}',
    '#wp-sheet .pli:hover{background:var(--wp-el)}#wp-sheet .pli.cur{background:var(--wp-el);color:var(--wp-acc);font-weight:700}',
    '#wp-sheet .pln{flex:0 0 22px;color:var(--wp-mut);font-size:12px;text-align:right}#wp-sheet .plt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#wp-sheet .pld{color:var(--wp-mut);font-size:12px}#wp-sheet .empty{color:var(--wp-mut);padding:14px 4px}',
    'body{padding-bottom:84px}',
    '@media print{#wp-mini,#wp-sheet{display:none!important}}'
  ].join('');
  document.head.appendChild(css);

  var PLAY = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
  var PAUSE = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';

  var mini = document.createElement('div'); mini.id = 'wp-mini'; mini.setAttribute('role', 'region'); mini.setAttribute('aria-label', 'Ascolta');
  mini.innerHTML = '<button class="wp-pp" type="button" aria-label="Riproduci">' + PLAY + '</button>' +
    '<div class="wp-mid"><div class="wp-ttl">🎧 Ascolta</div><div class="wp-row"><span class="wp-cur">0:00</span>' +
    '<input type="range" min="0" max="1" step="any" value="0" aria-label="Posizione"><span class="wp-tot">—</span></div></div>' +
    '<button class="wp-x" type="button" title="Apri il lettore (podcast)" aria-label="Apri il lettore">⤢</button>';

  var sheet = document.createElement('div'); sheet.id = 'wp-sheet';
  sheet.innerHTML = '<div class="wp-card" role="dialog" aria-label="Ascolta la lezione"><div class="wp-top"><b>Ascolta la lezione</b>' +
    '<button class="wp-close" type="button">Chiudi ✕</button></div>' +
    '<div class="cover" id="pl-cover">—</div><div class="np-t" id="pl-t">—</div><div class="np-s" id="pl-s"></div>' +
    '<input type="range" class="seek" id="pl-seek" min="0" max="1" value="0" step="any" aria-label="Posizione">' +
    '<div class="tspan"><span id="pl-cur">0:00</span><span id="pl-rem">—</span></div>' +
    '<div class="transport"><button id="pl-back" class="t15" aria-label="Indietro di 15 secondi">-15</button>' +
    '<button id="pl-prev" aria-label="Traccia precedente"><svg viewBox="0 0 24 24" width="26" height="26"><path d="M6 5h2v14H6zM20 5v14L9.5 12z" fill="currentColor"/></svg></button>' +
    '<button class="play" id="pl-btn" aria-label="Riproduci"></button>' +
    '<button id="pl-next" aria-label="Traccia successiva"><svg viewBox="0 0 24 24" width="26" height="26"><path d="M16 5h2v14h-2zM4 5v14l10.5-7z" fill="currentColor"/></svg></button>' +
    '<button id="pl-fwd" class="t15" aria-label="Avanti di 15 secondi">+15</button></div>' +
    '<div class="speed" id="pl-speed" role="group" aria-label="Velocità"><button data-r="0.75">0,75x</button><button data-r="1" class="on">1x</button>' +
    '<button data-r="1.25">1,25x</button><button id="pl-captog" class="captog" aria-pressed="false" hidden>Aa testo</button></div>' +
    '<div class="plcap" id="pl-cap" hidden aria-live="polite"><div class="plcap-it" id="pl-cap-it"></div><div class="plcap-en" id="pl-cap-en"></div></div>' +
    '<div class="pllist" id="pl-list"></div></div>';

  function mount() {
    document.body.appendChild(sheet); document.body.appendChild(mini);
    var s = document.createElement('script'); s.src = '/shell/play.js';
    s.onload = start; s.onerror = function () { console.warn('chiron web-player: /shell/play.js failed to load'); mini.remove(); };
    document.head.appendChild(s);
  }
  var fmt = function (x) { x = Math.max(0, Math.floor(x || 0)); return Math.floor(x / 60) + ':' + String(x % 60).padStart(2, '0'); };
  var open = function () { sheet.classList.add('on'); };
  var close = function () { sheet.classList.remove('on'); };

  function start() {
    var P = window.ChironPlay; if (!P || !P.load || !P.audio) { console.warn('chiron web-player: ChironPlay missing'); mini.remove(); return; }
    var a = P.audio, pp = mini.querySelector('.wp-pp'), seek = mini.querySelector('input'), ttl = mini.querySelector('.wp-ttl');
    var cur = mini.querySelector('.wp-cur'), tot = mini.querySelector('.wp-tot'), dragging = false;
    var title = (document.querySelector('h1') || {}).textContent || document.title || slug;
    P.load({ slug: slug, title: title.trim().slice(0, 120), sub: '', pageUrl: location.href });

    var sync = function () {
      var d = isFinite(a.duration) && a.duration > 0 ? a.duration : 0;
      pp.innerHTML = a.paused ? PLAY : PAUSE; pp.setAttribute('aria-label', a.paused ? 'Riproduci' : 'Pausa');
      if (!dragging) { seek.max = String(d || 1); seek.value = String(a.currentTime || 0); }
      cur.textContent = fmt(dragging ? +seek.value : a.currentTime); tot.textContent = d ? fmt(d) : '—';
      var t = document.getElementById('pl-t'); ttl.textContent = '🎧 ' + (t && t.textContent && t.textContent !== '—' ? t.textContent : 'Ascolta');
    };
    ['play', 'pause', 'timeupdate', 'loadedmetadata', 'durationchange', 'ended', 'emptied'].forEach(function (e) { a.addEventListener(e, sync); });
    // the mini button is play.js's own toggle (the same one the sheet uses), so behaviour is identical everywhere
    pp.onclick = function () { document.getElementById('pl-btn').click(); };
    seek.addEventListener('input', function () { dragging = true; sync(); });
    seek.addEventListener('change', function () { a.currentTime = +seek.value; dragging = false; sync(); });
    mini.querySelector('.wp-x').onclick = open;
    sheet.querySelector('.wp-close').onclick = close;
    sheet.addEventListener('click', function (e) { if (e.target === sheet) close(); });
    document.addEventListener('keydown', function (e) {
      if (!sheet.classList.contains('on')) return;
      if (e.key === 'Escape') close();
      else if (e.key === ' ' && !/INPUT|TEXTAREA|SELECT/.test((e.target || {}).tagName || '')) { e.preventDefault(); pp.click(); }
    });
    // one sound at a time: the lesson's own inline buttons pause the player, and the player pauses them
    document.addEventListener('play', function (e) {
      var t = e.target; if (!(t instanceof HTMLMediaElement)) return;
      if (t === a) document.querySelectorAll('audio,video').forEach(function (o) { if (o !== a && !o.paused) o.pause(); });
      else if (!a.paused) a.pause();
    }, true);
    sync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
