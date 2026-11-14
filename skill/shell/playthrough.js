/* ── Chiron play-through pane ──────────────────────────────────────────────────
   Plays a lesson's SOURCE audio straight through (audio/playthrough.mp3: the
   original recording, cut and stitched in lesson order) and lays the Chiron
   layer on top: the entry or line being spoken, its English, the example, and
   whether the word already has an Anki card. Nothing here is required: drills,
   quizzes and cards elsewhere in the lesson are optional stops.

   Data: window.__chironPlaythrough (audio/playthrough.timeline.js — works on
   file://). Two shapes:
     mode "entries": entries[{id, t0, t1, it, en, exIt, exEn, anki, parts[{t0, t1, kind}]}]
                     kind = word | word_slow | en | example_it | example_en
     mode "lines":   lines[{t0, t1, it, en, who}]          (a story / dialogue)
   Optional intro: {src, it, en} — the narrator's spoken overview of the lesson.

   Mounts into <div id="chiron-playthrough"></div>. Colours come only from the
   lesson's --chiron-* theme tokens.
   ─────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';
  if (window.__chironPlaythroughBooted) return;
  window.__chironPlaythroughBooted = true;
  var LS_EN = 'chiron.playthrough.hideEn';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(t) { t = Math.max(0, Math.floor(t)); return Math.floor(t / 60) + ':' + ('0' + t % 60).slice(-2); }

  function css() {
    var st = document.createElement('style');
    st.textContent =
      '.ptr{--ptr-tint:color-mix(in srgb,var(--chiron-accent) 16%,transparent);font-family:var(--chiron-font-body,system-ui,sans-serif);color:var(--chiron-fg);background:var(--chiron-surface);' +
      'border:1px solid var(--chiron-border);border-radius:var(--chiron-radius-lg,14px);padding:var(--chiron-space-4,16px);margin:0 0 var(--chiron-space-6,24px)}' +
      '.ptr-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px}' +
      '.ptr-btn{font:inherit;font-size:14px;border:1px solid var(--chiron-border);background:var(--chiron-elevated,var(--chiron-bg));color:var(--chiron-fg);' +
      'border-radius:999px;padding:6px 14px;cursor:pointer}' +
      '.ptr-btn[aria-pressed="true"]{background:var(--ptr-tint)}' +
      '.ptr-play{font-size:16px;font-weight:650;min-width:112px}' +
      '.ptr-time{font-variant-numeric:tabular-nums;color:var(--chiron-muted);font-size:13px;margin-left:auto}' +
      '.ptr-track{position:relative;height:8px;border-radius:999px;background:var(--chiron-divider,var(--chiron-border));margin:12px 0 4px;cursor:pointer}' +
      '.ptr-fill{position:absolute;left:0;top:0;bottom:0;border-radius:999px;background:var(--chiron-accent);width:0}' +
      '.ptr-now{margin-top:var(--chiron-space-4,16px);padding:var(--chiron-space-4,16px);border-radius:var(--chiron-radius-md,10px);background:var(--chiron-bg);min-height:120px}' +
      '.ptr-word{font-size:30px;font-weight:700;line-height:1.2;border-radius:8px;padding:2px 6px;display:inline-block}' +
      '.ptr-en{font-size:17px;color:var(--chiron-fg-secondary,var(--chiron-muted));margin-top:4px;border-radius:8px;padding:2px 6px;display:inline-block}' +
      '.ptr-ex{margin-top:12px;font-size:18px;border-radius:8px;padding:2px 6px}' +
      '.ptr-exen{font-size:15px;color:var(--chiron-muted);border-radius:8px;padding:2px 6px}' +
      '.ptr-on{background:var(--ptr-tint)}' +
      '.ptr-meta{margin-top:10px;font-size:13px;color:var(--chiron-muted)}' +
      '.ptr-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:1px;background:var(--chiron-muted)}' +
      '.ptr-dot.ptr-linked{background:var(--chiron-success)}.ptr-dot.ptr-new{background:var(--chiron-info)}' +
      '.ptr-hide-en .ptr-en,.ptr-hide-en .ptr-exen,.ptr-hide-en .ptr-li-en{visibility:hidden}' +
      '.ptr-list{list-style:none;margin:var(--chiron-space-4,16px) 0 0;padding:0;display:grid;gap:2px}' +
      '.ptr-li{display:grid;grid-template-columns:44px minmax(0,3fr) minmax(0,2fr);gap:10px;align-items:baseline;padding:6px 8px;border-radius:8px;cursor:pointer}' +
      '.ptr-li:hover{background:var(--chiron-bg)}.ptr-li.ptr-cur{background:var(--ptr-tint)}' +
      '.ptr-li-t{font-size:12px;color:var(--chiron-muted);font-variant-numeric:tabular-nums}' +
      '.ptr-li-it{font-weight:600}.ptr-li-en{color:var(--chiron-muted);font-size:14px}' +
      '.ptr-who{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--chiron-muted);margin-right:6px}' +
      '@media (max-width:560px){.ptr-word{font-size:24px}.ptr-li{grid-template-columns:38px 1fr}.ptr-li-en{grid-column:2}}';
    document.head.appendChild(st);
  }

  function mount(D, root) {
    css();
    var audio = new Audio(D.src || 'audio/playthrough.mp3');
    audio.preload = 'metadata';
    var items = D.mode === 'lines' ? D.lines : D.entries, cur = -1, hideEn = false;
    try { hideEn = localStorage.getItem(LS_EN) === '1'; } catch (e) {}
    var total = D.durationS || 0;

    root.className = 'ptr no-lang' + (hideEn ? ' ptr-hide-en' : ''); // no-lang: the lesson's IT/EN switch leaves the rows alone; the pane has its own English toggle
    root.innerHTML =
      '<div class="ptr-bar">' +
      '<button class="ptr-btn ptr-play" type="button">▶ Ascolta</button>' +
      (D.intro ? '<button class="ptr-btn ptr-intro" type="button">Introduzione</button>' : '') +
      '<button class="ptr-btn ptr-rate" type="button" data-r="1">1×</button>' +
      '<button class="ptr-btn ptr-enbtn" type="button" aria-pressed="' + hideEn + '">Senza inglese</button>' +
      '<span class="ptr-time">0:00 / ' + fmt(total) + '</span></div>' +
      '<div class="ptr-track" role="slider" aria-label="Posizione" tabindex="0"><div class="ptr-fill"></div></div>' +
      '<div class="ptr-now" aria-live="polite"></div>' +
      '<ol class="ptr-list"></ol>';
    var q = function (s) { return root.querySelector(s); };
    var list = q('.ptr-list'), now = q('.ptr-now'), playBtn = q('.ptr-play');

    list.innerHTML = items.map(function (x, i) {
      var dot = x.anki ? '<span class="ptr-dot ptr-' + (x.anki === 'linked' ? 'linked' : 'new') + '" title="' +
        (x.anki === 'linked' ? 'Già in Anki' : 'Nuova carta') + '"></span>' : '';
      var who = x.who ? '<span class="ptr-who">' + esc(x.who) + '</span>' : '';
      return '<li class="ptr-li" data-i="' + i + '"><span class="ptr-li-t">' + fmt(x.t0) + '</span>' +
        '<span class="ptr-li-it">' + dot + who + esc(x.it) + '</span><span class="ptr-li-en">' + esc(x.en) + '</span></li>';
    }).join('');

    function show(i, t) {
      if (i < 0) { now.innerHTML = '<div class="ptr-meta">Premi ▶ per ascoltare la lezione dall’inizio alla fine.</div>'; return; }
      var x = items[i];
      if (D.mode === 'lines') {
        now.innerHTML = (x.who ? '<div class="ptr-who">' + esc(x.who) + '</div>' : '') +
          '<div class="ptr-ex ptr-on" style="font-size:22px;font-weight:600">' + esc(x.it) + '</div>' +
          '<div class="ptr-exen">' + esc(x.en) + '</div>' +
          (x.note ? '<div class="ptr-meta">' + esc(x.note) + '</div>' : '');
        return;
      }
      var kind = '';
      (x.parts || []).forEach(function (p) { if (p.t0 <= t && t < p.t1) kind = p.kind; });
      var on = function (k) { return (k === kind || (k === 'word' && kind === 'word_slow')) ? ' ptr-on' : ''; };
      now.innerHTML =
        '<div><span class="ptr-word' + on('word') + '">' + esc(x.it) + '</span></div>' +
        '<div><span class="ptr-en' + on('en') + '">' + esc(x.en) + '</span></div>' +
        (x.exIt ? '<div class="ptr-ex' + on('example_it') + '">' + esc(x.exIt) + '</div>' : '') +
        (x.exEn ? '<div class="ptr-exen' + on('example_en') + '">' + esc(x.exEn) + '</div>' : '') +
        '<div class="ptr-meta">' + (i + 1) + ' / ' + items.length +
        (x.anki === 'linked' ? ' · <span class="ptr-dot ptr-linked"></span>già nelle tue carte Anki' :
         x.anki === 'new' ? ' · <span class="ptr-dot ptr-new"></span>nuova carta in questa lezione' : '') + '</div>';
    }

    function tick() {
      var t = audio.currentTime, d = audio.duration || total;
      q('.ptr-fill').style.width = (d ? 100 * t / d : 0) + '%';
      q('.ptr-time').textContent = fmt(t) + ' / ' + fmt(d);
      if (audio.__intro) return;
      var i = -1;
      for (var k = 0; k < items.length; k++) if (items[k].t0 <= t && t < items[k].t1) { i = k; break; }
      if (i === -1 && cur >= 0 && t >= items[cur].t1 && (cur + 1 >= items.length || t < items[cur + 1].t0)) i = cur; // gap between entries
      if (i !== cur) {
        var old = list.querySelector('.ptr-cur'); if (old) old.classList.remove('ptr-cur');
        if (i >= 0) list.children[i].classList.add('ptr-cur');
        cur = i;
      }
      show(cur, t);
    }

    function setSrc(src, intro) {
      if (audio.__src === src) return;
      audio.src = src; audio.__src = src; audio.__intro = !!intro;
    }
    setSrc(D.src || 'audio/playthrough.mp3', false);

    playBtn.onclick = function () {
      if (audio.__intro) { setSrc(D.src || 'audio/playthrough.mp3', false); }
      if (audio.paused) audio.play(); else audio.pause();
    };
    if (D.intro) q('.ptr-intro').onclick = function () {
      setSrc(D.intro.src, true); audio.currentTime = 0; audio.play();
      now.innerHTML = '<div class="ptr-ex ptr-on">' + esc(D.intro.it) + '</div><div class="ptr-exen">' + esc(D.intro.en) + '</div>';
    };
    q('.ptr-rate').onclick = function () {
      var r = { '1': 0.8, '0.8': 1.25, '1.25': 1 }[this.dataset.r] || 1;
      this.dataset.r = String(r); this.textContent = r + '×'; audio.playbackRate = r;
    };
    q('.ptr-enbtn').onclick = function () {
      hideEn = !hideEn; this.setAttribute('aria-pressed', String(hideEn));
      root.classList.toggle('ptr-hide-en', hideEn);
      try { localStorage.setItem(LS_EN, hideEn ? '1' : '0'); } catch (e) {}
    };
    function seekTo(e) {
      var r = this.getBoundingClientRect(), d = audio.duration || total;
      if (audio.__intro) setSrc(D.src || 'audio/playthrough.mp3', false);
      audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * d; tick();
    }
    q('.ptr-track').onclick = seekTo;
    list.onclick = function (e) {
      var li = e.target.closest('.ptr-li'); if (!li) return;
      if (audio.__intro) setSrc(D.src || 'audio/playthrough.mp3', false);
      audio.currentTime = items[+li.dataset.i].t0 + 0.01; audio.play(); tick();
    };
    audio.addEventListener('timeupdate', tick);
    audio.addEventListener('play', function () { playBtn.textContent = '⏸ Pausa'; });
    audio.addEventListener('pause', function () { playBtn.textContent = '▶ Ascolta'; });
    audio.addEventListener('ended', function () {
      playBtn.textContent = '▶ Ascolta';
      if (audio.__intro) { setSrc(D.src || 'audio/playthrough.mp3', false); audio.play(); }  // overview leads into the lesson
    });
    show(-1, 0);
  }

  function init() {
    var root = document.getElementById('chiron-playthrough');
    if (!root) return;
    function go(D) { if (D && (D.entries || D.lines)) mount(D, root); }
    if (window.__chironPlaythrough) return go(window.__chironPlaythrough);
    var s = document.createElement('script');
    s.src = 'audio/playthrough.timeline.js';
    s.onload = function () { go(window.__chironPlaythrough); };
    document.head.appendChild(s);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
