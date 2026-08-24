/* ── Chiron Listen mode — audio lecture player + inline ▶ + section voice-follow
   Self-builds from audio/manifest.json (written by the audio bake). Two surfaces:
     • floating 🎧 panel — grouped "Whole lesson" (summary/full lecture) vs
       "By section" (section lectures glow their #sectionId while playing).
     • inline ▶ — anchored kinds (dialogue/phrase/grammar-pearl/story-*) get a
       small play button injected at their #anchor element (tap any phrase/line).
   One shared audio element → only one clip plays at a time. No-op without audio.
   ─────────────────────────────────────────────────────────────────────────────
   FEATURE A — Scrubbable seek on the playing button body (2026-06-11)
     The gradient fill on the playing button body IS the scrubber. Drag across
     the label area to seek; the --clip-progress fill and countdown update live.
     The .ico (▶/⏸) is the sole play/pause toggle and is NOT a seek surface.
     setPointerCapture ensures the drag survives leaving the button.
   FEATURE B — Audio-synced auto-scroll + manual-release (2026-06-11)
     While a clip plays, `timeupdate` proportionally scrolls the page
     (currentTime/duration → scrollY). Wheel, touchstart, or nav-key events
     immediately set userTookOver=true, stopping auto-scroll for that playback.
     prefers-reduced-motion: skip smooth-scroll easing. */
(function () {
  'use strict';
  var PANEL_KIND = { summary: 0, shortened: 1, section: 2 };
  var INLINE_KIND = { dialogue: 1, phrase: 1, 'grammar-pearl': 1, 'story-verbatim': 1, 'story-description': 1 };

  var audio = new Audio();
  var active = null; // { btn, glowEl, idle, timerEl, scrubEl, sectionId }
  /* ── play-through ("Tutto") — listen to the lesson end to end, hands free.
     queue is built in panel order as the buttons are created. ── */
  var queue = [];        // [{ c, btn, glow }]
  var qIndex = -1;
  var playAll = false;

  /* ── Feature B state ───────────────────────────────────────── */
  var userTookOver = false;      // set on manual scroll; cleared on fresh play
  var isAutoScrolling = false;   // bracketed around our own scrollTo calls
  var _prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Detect manual-scroll intent. All three signals reliably indicate the user
     is intentionally scrolling — not our programmatic scrollTo. */
  window.addEventListener('wheel', function () {
    if (!isAutoScrolling) userTookOver = true;
  }, { passive: true });
  window.addEventListener('touchstart', function () {
    if (!isAutoScrolling) userTookOver = true;
  }, { passive: true });
  /* Arrow/Page/Space keys that move the viewport */
  window.addEventListener('keydown', function (e) {
    if (isAutoScrolling) return;
    var scrollKeys = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' '];
    if (scrollKeys.indexOf(e.key) !== -1) userTookOver = true;
  });

  /* ── Feature B — timeupdate handler ───────────────────────── */
  /* Chapter-aware auto-scroll (Approach A, 2026-06-11):
     - Section clips (those with a sectionId matching a chapter anchor) scroll
       proportionally WITHIN that chapter's section bounds:
         target = sectionTop + ratio * max(0, sectionHeight - innerHeight)
       clamped to [sectionTop, sectionTop + max(0, sectionHeight - innerHeight)].
     - Summary / non-anchored clips keep the old whole-page proportional scroll.
     The sectionId is stored in active.sectionId (set by play() for section clips). */
  audio.addEventListener('timeupdate', function () {
    /* OFF by default (2026-08-04). This follow-scroll is time-proportional only: it maps
       elapsed/duration onto page position and knows NOTHING about what is being narrated,
       so on a whole-lesson clip 50% of the audio lands you 50% down the page — almost never
       the passage being spoken. It also re-issued a *smooth* scrollTo on every timeupdate
       (~4x/sec), stacking animations and making the page judder.
       The glow + one-time centre-scroll on press are kept; they are accurate.
       Opt back in with:  window.__chironFollowScroll = true  */
    if (!window.__chironFollowScroll) return;
    if (userTookOver) return;
    if (!active) return;
    var dur = audio.duration;
    if (!isFinite(dur) || dur <= 0) return;
    var ratio = audio.currentTime / dur;
    var targetTop;
    var sectionEl = active.sectionId ? document.getElementById(active.sectionId) : null;
    if (sectionEl) {
      // Section clip: scroll within this chapter's section.
      // getBoundingClientRect() returns viewport-relative — convert to document-absolute.
      var rect = sectionEl.getBoundingClientRect();
      var sectionTop = rect.top + window.scrollY;
      var sectionHeight = sectionEl.offsetHeight;
      var overflow = Math.max(0, sectionHeight - window.innerHeight);
      targetTop = Math.round(sectionTop + ratio * overflow);
    } else {
      // Summary / whole-lesson clip: whole-page proportional.
      var maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (maxScroll <= 0) return;
      targetTop = Math.round(ratio * maxScroll);
    }
    isAutoScrolling = true;
    window.scrollTo({ top: targetTop, behavior: _prefersReducedMotion ? 'auto' : 'smooth' });
    // Clear the flag after a short tick — enough for the browser to register it
    // as programmatic before any scroll event fires back to our wheel listener.
    setTimeout(function () { isAutoScrolling = false; }, 80);
  });

  /* ── Progress fill + countdown helpers ────────────────────── */
  var _progressTimer = null;

  function _clearProgress() {
    if (_progressTimer) { clearInterval(_progressTimer); _progressTimer = null; }
    if (active && active.btn) {
      active.btn.style.removeProperty('--clip-progress');
      if (active.timerEl) { active.timerEl.textContent = ''; }
    }
  }

  function _fmtRemaining(secs) {
    if (!isFinite(secs) || secs < 0) return '';
    var s = Math.ceil(secs);
    var m = Math.floor(s / 60);
    var ss = s % 60;
    return m + ':' + (ss < 10 ? '0' : '') + ss;
  }

  /* Update fill + countdown. Called by the interval tick AND during scrub drags. */
  function _applyProgress(progress) {
    if (!active) return;
    active.btn.style.setProperty('--clip-progress', progress);
    if (active.timerEl) {
      var dur = audio.duration;
      active.timerEl.textContent = isFinite(dur) ? _fmtRemaining(dur - audio.currentTime) : '';
    }
  }

  function _startProgress() {
    if (_progressTimer) clearInterval(_progressTimer);
    function tick() {
      var dur = audio.duration;
      if (!isFinite(dur) || dur <= 0) { return; } // wait for loadedmetadata
      _applyProgress(audio.currentTime / dur);
    }
    _progressTimer = setInterval(tick, 200);
    tick(); // immediate first update
  }

  /* ── Feature A — button-body seek wiring ──────────────────── */
  /* Seek to a fraction [0,1] of the current clip's duration.
     Guards: duration not-yet-loaded → no-op (avoids NaN seek). */
  function _seekTo(fraction) {
    var dur = audio.duration;
    if (!isFinite(dur) || dur <= 0) return;
    fraction = Math.max(0, Math.min(1, fraction));
    audio.currentTime = fraction * dur;
    _applyProgress(fraction);
  }

  /* Compute seek fraction from a pointer event over the button element. */
  function _fractionFromBtn(e, btn) {
    var rect = btn.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return (e.clientX - rect.left) / rect.width;
  }

  /* Wire seek drag onto the button body (excluding the .ico). Called once per
     panel button so listeners are attached only once, not repeatedly.
     A pointerdown that starts inside .ico is ignored (play/pause zone).
     A pointerdown anywhere else on the button body seeks only if the button
     is currently playing; otherwise falls through to the click handler. */
  function _wireBodyScrubber(btn) {
    if (btn._scrubWired) return;
    btn._scrubWired = true;

    var dragging = false;
    var didSeek = false;   // set true when a drag moves enough to be a real seek

    btn.addEventListener('pointerdown', function (e) {
      // Only engage scrub if this button IS the currently playing one.
      if (!active || active.btn !== btn) return;
      // Ignore clicks that originate inside the play/pause icon.
      if (e.target.closest && e.target.closest('.ico')) return;
      // Don't start drag on the timer label (right edge).
      if (e.target.classList && e.target.classList.contains('chiron-clip-timer')) return;
      dragging = true;
      didSeek = false;
      btn.setPointerCapture(e.pointerId);
      // Seek immediately on tap (no drag needed for point-seek).
      _seekTo(_fractionFromBtn(e, btn));
      didSeek = true;
      e.preventDefault(); // prevent text selection while dragging
    });

    btn.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      if (!active || active.btn !== btn) { dragging = false; return; }
      e.preventDefault();
      _seekTo(_fractionFromBtn(e, btn));
      didSeek = true;
    });

    function onUp(e) {
      if (!dragging) return;
      dragging = false;
      if (active && active.btn === btn) {
        _seekTo(_fractionFromBtn(e, btn));
      }
      btn.releasePointerCapture(e.pointerId);
      /* If the user dragged (didSeek), suppress the subsequent click so it
         doesn't toggle play/pause. We use a one-shot capture on the btn. */
      if (didSeek) {
        btn._suppressNextClick = true;
      }
      didSeek = false;
    }

    btn.addEventListener('pointerup', onUp);
    btn.addEventListener('pointercancel', function () { dragging = false; didSeek = false; });
  }

  function setIco(btn, ch) { var i = btn.querySelector('.ico'); if (i) i.textContent = ch; }

  function clearActive() {
    _clearProgress();
    if (!active) return;
    if (active.glowEl) active.glowEl.classList.remove('chiron-listening');
    if (active.btn) { active.btn.classList.remove('playing'); setIco(active.btn, active.idle); active.btn.style.removeProperty('--clip-progress'); }
    if (active.timerEl) { active.timerEl.textContent = ''; }
    active = null;
    userTookOver = false; // reset for next play
  }
  audio.addEventListener('ended', function () {
    if (playAll && qIndex >= 0 && qIndex + 1 < queue.length) {
      var nxt = queue[qIndex + 1];
      qIndex += 1;
      play(nxt.c, nxt.btn, nxt.glow(), '▶');
      _syncAllBtn();
      return;
    }
    playAll = false; qIndex = -1; _syncAllBtn();
    clearActive();
  });
  audio.addEventListener('pause', function () {
    // On pause (not ended), freeze progress but keep it visible; clear interval.
    if (_progressTimer) { clearInterval(_progressTimer); _progressTimer = null; }
  });

  /* Blob-cache each clip in memory so the <audio> source is a fully-buffered blob: URL —
     seeking works with ZERO dependency on HTTP Range support. GLOBAL (window) so BOTH the
     desktop Listen player and the mobile bottom-bar (separate closures) share one cache.
     Player-level fix → travels inside the .chiron package. Freed on page-hide. */
  if (!window._chironResolveSrc) {
    window._chironClipBlobs = {};
    window._chironResolveSrc = function (path, cb) {
      var C = window._chironClipBlobs;
      if (C[path]) { cb(C[path]); return; }
      /* file:// — fetch() is ALWAYS blocked (unique opaque origin), so don't even try:
         it only produced a CORS error per clip. data: URIs need no fetch either. */
      if (location.protocol === 'file:' || path.slice(0, 5) === 'data:') { cb(path); return; }
      try {
        fetch(path).then(function (r) { return r.ok ? r.blob() : Promise.reject(); })
          .then(function (b) { var u = URL.createObjectURL(b); C[path] = u; cb(u); })
          .catch(function () { cb(path); });  // fallback: direct URL (e.g. file:// where fetch is blocked)
      } catch (e) { cb(path); }
    };
    window.addEventListener('pagehide', function () {
      var C = window._chironClipBlobs || {};
      Object.keys(C).forEach(function (k) { try { URL.revokeObjectURL(C[k]); } catch (e) {} });
      window._chironClipBlobs = {};
    });
  }
  var _resolveSrc = window._chironResolveSrc;

  function play(clip, btn, glowEl, idleIco) {
    if (active && active.btn === btn) { audio.pause(); audio.currentTime = 0; clearActive(); return; }
    clearActive();
    userTookOver = false; // fresh play: re-enable auto-scroll
    _resolveSrc(clip.audioPath, function (resolvedSrc) {
    audio.src = resolvedSrc;
    audio.play().then(function () {
      // Find or create the countdown timer element for this button
      var timerEl = btn.querySelector('.chiron-clip-timer');
      if (!timerEl) {
        timerEl = document.createElement('span');
        timerEl.className = 'chiron-clip-timer';
        btn.appendChild(timerEl);
      }
      // Wire body-seek on panel buttons (only once; no-op on repeat calls)
      if (btn.classList.contains('chiron-listen-btn')) {
        _wireBodyScrubber(btn);
      }
      // sectionId drives chapter-aware scroll (Approach A): set for 'section' artifact clips,
      // null/undefined for summary/shortened (whole-page scroll).
      var sid = (clip.artifact === 'section' && clip.sectionId) ? clip.sectionId : null;
      active = { btn: btn, glowEl: glowEl || null, idle: idleIco, timerEl: timerEl, sectionId: sid };
      btn.classList.add('playing'); setIco(btn, '⏸');
      if (glowEl) { glowEl.classList.add('chiron-listening'); glowEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      for (var qi = 0; qi < queue.length; qi++) {          // clicked by hand? align the queue
        if (queue[qi].btn === btn) { qIndex = qi; break; }
      }
      _mediaSession(clip, btn.querySelector('.lbl') ? btn.querySelector('.lbl').textContent : '');
      _syncAllBtn();
      _startProgress();
    }).catch(function () { btn.classList.add('err'); setTimeout(function () { btn.classList.remove('err'); }, 1600); });
    });
  }

  function panelLabel(c) {
    if (c.artifact === 'summary') return 'Summary';
    if (c.artifact === 'shortened') return 'Full lecture';
    if (c.sectionId) {
      var el = document.getElementById(c.sectionId);
      var h = el && el.querySelector('h1,h2,h3,[data-section-title]');
      if (h && h.textContent.trim()) return h.textContent.trim().replace(/^\s*\d+[\.\)]?\s*/, '');
    }
    return c.sectionId || 'Section';
  }


  /* ── play-through helpers ─────────────────────────────────────────────── */
  function _syncAllBtn() {
    var b = document.getElementById('chiron-playall');
    if (!b) return;
    b.classList.toggle('on', playAll);
    var pod = active && active.isPodcast;
    b.classList.toggle('on', playAll || !!pod);
    b.textContent = pod ? '\u23F8 Tutto'
                  : playAll ? ('\u23F8 ' + (qIndex + 1) + '/' + queue.length)
                  : '\u25B6\u25B6 Tutto';
  }

  /* Lock-screen / AirPods / car-stereo controls. This is the point of a play-through:
     you are not looking at the page, so the transport has to live where the phone puts it. */
  function _mediaSession(clip, label) {
    if (!('mediaSession' in navigator)) return;
    try {
      var t = (document.querySelector('.board h1') || {}).textContent || document.title;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: label || 'Lezione',
        artist: 'il centro di italia',
        album: (t || '').replace(/\s+/g, ' ').trim()
      });
      navigator.mediaSession.setActionHandler('play', function () { audio.play(); });
      navigator.mediaSession.setActionHandler('pause', function () { audio.pause(); });
      navigator.mediaSession.setActionHandler('nexttrack', _next);
      navigator.mediaSession.setActionHandler('previoustrack', _prev);
    } catch (e) { /* older browsers: no transport, playback still fine */ }
  }
  function _next() {
    if (qIndex < 0 || qIndex + 1 >= queue.length) return;
    playAll = true; qIndex += 1;
    var q = queue[qIndex]; play(q.c, q.btn, q.glow(), '\u25B6'); _syncAllBtn();
  }
  function _prev() {
    /* first 3s = restart this clip, like every podcast player */
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    if (qIndex <= 0) return;
    playAll = true; qIndex -= 1;
    var q = queue[qIndex]; play(q.c, q.btn, q.glow(), '\u25B6'); _syncAllBtn();
  }

  function buildPanel(clips) {
    var panel = document.createElement('div');
    panel.className = 'chiron-listen';
    panel.innerHTML = '<div class="chiron-listen-head"><span>🎧</span><span>Listen</span></div>';
    function group(title, list) {
      if (!list.length) return;
      var g = document.createElement('div'); g.className = 'chiron-listen-group';
      var t = document.createElement('div'); t.className = 'chiron-listen-grouptitle'; t.textContent = title;
      g.appendChild(t);
      list.forEach(function (c) {
        var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'chiron-listen-btn';
        var ico = document.createElement('span'); ico.className = 'ico'; ico.textContent = '▶';
        var lbl = document.createElement('span'); lbl.className = 'lbl'; lbl.textContent = panelLabel(c);
        btn.appendChild(ico); btn.appendChild(lbl);
        /* Play/pause fires on click anywhere on the button UNLESS:
           - A seek drag just completed (_suppressNextClick flag), OR
           - The click originated outside the .ico while this btn is playing
             (body clicks during play are seek-taps, handled by pointerdown). */
        btn.addEventListener('click', function (e) {
          // Suppress click fired after a seek drag
          if (btn._suppressNextClick) { btn._suppressNextClick = false; return; }
          // If the button is currently playing and the click is NOT on the .ico,
          // it was handled as a seek-tap in pointerdown — don't also toggle play/pause.
          if (active && active.btn === btn) {
            var icoEl = btn.querySelector('.ico');
            if (icoEl && !icoEl.contains(e.target)) return;
          }
          var glow = (c.artifact === 'section' && c.sectionId) ? document.getElementById(c.sectionId) : null;
          play(c, btn, glow, '▶');
        });
        /* Only the lesson narration joins the play-through queue: the summary and the
           chapters, in order. 'shortened' is the SAME lesson condensed, so including it
           would play the content twice in one sitting. */
        if (c.artifact === 'summary' || c.artifact === 'section') {
          queue.push({ c: c, btn: btn,
            glow: function () { return (c.artifact === 'section' && c.sectionId)
              ? document.getElementById(c.sectionId) : null; } });
        }
        g.appendChild(btn);
      });
      panel.appendChild(g);
    }
    var podcast = clips.filter(function (c) { return c.artifact === 'podcast'; })[0] || null;
    group('Whole lesson', clips.filter(function (c) { return c.artifact === 'summary' || c.artifact === 'shortened'; }));
    group('By section', clips.filter(function (c) { return c.artifact === 'section'; }));

    if (queue.length > 1) {
      var head = panel.querySelector('.chiron-listen-head');
      var all = document.createElement('button');
      all.type = 'button'; all.id = 'chiron-playall'; all.className = 'chiron-playall';
      all.title = 'Riproduci tutta la lezione';
      all.setAttribute('aria-label', 'Play the whole lesson end to end');
      head.appendChild(all);
      all.addEventListener('click', function () {
        if (playAll || (podcast && active && active.isPodcast)) {
          playAll = false; qIndex = -1; audio.pause(); clearActive(); _syncAllBtn(); return;
        }
        /* ONE continuous file if the bake produced one. Critical for listening with the
           screen off: swapping audio.src per chapter is blocked once Android backgrounds
           the page, so a queue silently stops at the first hand-over. One file = one
           play() = it keeps running. Falls back to the queue if no podcast track. */
        if (podcast) {
          play(podcast, all, null, '▶▶ Tutto');
          if (active) active.isPodcast = true;
          _mediaSession(podcast, 'Lezione completa');
          _syncAllBtn();
          return;
        }
        playAll = true; qIndex = 0;
        play(queue[0].c, queue[0].btn, queue[0].glow(), '▶');
        _syncAllBtn();
      });
    }
    document.body.appendChild(panel);
    _syncAllBtn();          // after append — getElementById needs the panel in the DOM
  }

  function wireInline(clips) {
    clips.forEach(function (c) {
      if (!c.sectionId) return;
      var el = document.getElementById(c.sectionId);
      if (!el) return;
      if (el.querySelector('.chiron-play-inline')) return;   // idempotent: a second player (donor shell) already added one
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'chiron-play-inline'; btn.title = 'Ascolta'; btn.setAttribute('aria-label', 'Play audio');
      var ico = document.createElement('span'); ico.className = 'ico'; ico.textContent = '▶'; btn.appendChild(ico);
      /* Glow the row/tile the phrase lives in, not just the <dt>/<td> — so the whole
         entry pulses while it plays, matching what section clips do. (2026-08-04) */
      var glowEl = el.closest('dl.phrases > div, .clock, tr, .idx .r, li') || el;
      btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); play(c, btn, glowEl, '▶'); });
      el.classList.add('chiron-has-audio');
      el.insertBefore(btn, el.firstChild);
    });
  }

  function useManifest(m) {
    if (!m || !m.clips) return;
    var ready = m.clips.filter(function (c) { return c.status === 'done' && c.audioPath; });
    if (!ready.length) return;
    var panelClips = ready.filter(function (c) { return PANEL_KIND[c.artifact] != null; });
    var inlineClips = ready.filter(function (c) { return INLINE_KIND[c.artifact]; });
    if (panelClips.length) buildPanel(panelClips);
    if (inlineClips.length) wireInline(inlineClips);
  }

  function init() {
    // file:// lessons load audio/manifest.js (sets a global); HTTP lessons fetch manifest.json.
    if (window.__chironAudioManifest) { useManifest(window.__chironAudioManifest); return; }
    fetch('audio/manifest.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(useManifest)
      .catch(function () { /* no audio baked — silent no-op */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
