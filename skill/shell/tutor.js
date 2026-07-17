/* ── Chiron Tutor (eco-lite) + text highlighter — Concept C ──────────────────
   SHARED, server-injected asset (see skill/server/app.py) — served once at
   /shell/tutor.js and injected into every lesson.html at serve-time. NOT
   copied per-lesson. Self-contained: does not depend on main.js internals —
   it locates the lesson's own `.chiron-listen` audio panel (if any) itself
   and drives its collapse/expand, rather than relying on a main.js-exposed
   global. Talks to a host-side tutor service at http://<host>:8912/tutor-chat
   (+ GET /tutor-models); degrades gracefully to an offline notice when that
   service isn't running.
   ─────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';
  if (window.__chironTutorLoaded) return;
  window.__chironTutorLoaded = true;

  var LS_MODEL = 'chiron.tutormodel';
  var LS_MODE = 'chiron.tutormode';
  var LS_WIDTH = 'chiron.tutorwidth';
  var LS_SCOPE = 'chiron.tutorscope';
  var LS_SUGGEST = 'chiron.tutorsuggest';
  var LS_TRANSPORT = 'chiron.tutortransport';
  var FALLBACK_MODELS = [
    { id: 'gemma4', label: 'Gemma 4 · cloud (fast)' },
    { id: 'gemini3', label: 'Gemini 3 Flash · cloud' },
    { id: 'qwen_local', label: 'Qwen3 32B · Mac (local)' },
    { id: 'agent', label: 'Deep agent (Harrison’s, slower)' }
  ];
  var FILLER_WORDS = [
    'percolating', 'consulting the tomes', 'thinking hard', 'chasing a pathway',
    'cross-checking', 'rummaging in Harrison’s', 'connecting dots', 'brewing',
    'pondering', 'untangling'
  ];

  var messages = [];   // { role: 'user'|'assistant', content }
  var highlights = []; // { num, mark, sup, text }
  var hlCounter = 0;
  var sectionId = null;
  var sectionText = '';

  var tab, scrim, drawer, head, badge, title, modelSel, modeBtn, penBtn, gearBtn, closeBtn,
      scope, chips, msgs, inputRow, textarea, sendBtn, tabPen, resizeHandle,
      settingsPop, suggToggle, transportSseBtn, transportPollBtn;
  var mode = 'med';
  var scopeMode = 'section'; // 'section' | 'lesson' | 'free' — cycled by clicking .ct-scope
  var suggestOn = true; // 'Suggestions' setting (settings popover) — default ON, persisted to LS_SUGGEST
  var transportMode = 'sse'; // 'sse' | 'poll' — 'Live updates' setting, default sse, persisted to LS_TRANSPORT

  function deriveLessonSlug() {
    var parts = location.pathname.split('/').filter(Boolean);
    // .../lessons/<slug>/lesson.html (or file:///.../<slug>/lesson.html) — the
    // segment right before the filename is the slug.
    if (parts.length >= 2) return parts[parts.length - 2];
    return document.title || 'unknown-lesson';
  }

  /* ── audio-panel collapse (self-contained — no main.js dependency) ─────
     The lesson's own audio widget (main.js) builds `.chiron-listen`
     ASYNCHRONOUSLY (it fetches audio/manifest.json), so the panel may not
     exist yet when this script runs. Watch for it instead of assuming
     timing; wire the collapse toggle once, whenever it shows up. */
  function injectListenCollapse(panel) {
    if (panel.dataset.ctCollapseWired) return;
    panel.dataset.ctCollapseWired = '1';
    var listenHead = panel.querySelector('.chiron-listen-head');
    if (!listenHead) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chiron-listen-collapse';
    btn.title = 'collapse';
    btn.textContent = '▾'; // ▾
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      panel.classList.toggle('min');
    });
    listenHead.appendChild(btn);
  }

  function watchForListenPanel() {
    var existing = document.querySelector('.chiron-listen');
    if (existing) { injectListenCollapse(existing); return; }
    var mo = new MutationObserver(function () {
      var panel = document.querySelector('.chiron-listen');
      if (panel) { injectListenCollapse(panel); mo.disconnect(); }
    });
    mo.observe(document.body, { childList: true });
  }

  function collapseAudio(v) {
    var panel = document.querySelector('.chiron-listen');
    if (!panel) return; // no audio on this lesson — no-op
    panel.classList.toggle('min', v !== false);
  }

  /* ── model list (dynamic, with a graceful fallback) ─────────────────── */
  function populateModels(list) {
    var savedModel = null;
    try { savedModel = localStorage.getItem(LS_MODEL); } catch (e) {}
    modelSel.innerHTML = '';
    list.forEach(function (m) {
      var opt = document.createElement('option');
      opt.value = m.id; opt.textContent = m.label;
      modelSel.appendChild(opt);
    });
    if (savedModel && list.some(function (m) { return m.id === savedModel; })) {
      modelSel.value = savedModel;
    }
  }

  function loadModels() {
    populateModels(FALLBACK_MODELS); // render immediately — no flash of empty select
    fetch('http://' + location.hostname + ':8912/tutor-models')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.models || !data.models.length) return;
        var saved = null;
        try { saved = localStorage.getItem(LS_MODEL); } catch (e) {}
        populateModels(data.models);
        if (!saved && data.default) {
          var hasDefault = data.models.some(function (m) { return m.id === data.default; });
          if (hasDefault) modelSel.value = data.default;
        }
      })
      .catch(function () { /* tutor service offline — fallback list already rendered */ });
  }

  function build() {
    /* ── restore persisted drawer width (desktop drag-resize, #4) ──── */
    try {
      var savedWidth = localStorage.getItem(LS_WIDTH);
      if (savedWidth) document.documentElement.style.setProperty('--ct-width', savedWidth);
    } catch (e) {}

    /* ── tab ──────────────────────────────────────────────────────── */
    tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'chiron-tutor-tab';
    tab.setAttribute('aria-label', 'Open tutor');
    var tabLabel = document.createElement('span');
    tabLabel.textContent = '🎓 Tutor'; // 🎓 Tutor
    tabPen = document.createElement('span');
    tabPen.className = 'chiron-tutor-pen';
    tabPen.title = 'Highlight text';
    tabPen.textContent = '🖉'; // 🖉
    tab.appendChild(tabLabel);
    tab.appendChild(tabPen);
    document.body.appendChild(tab);

    /* ── back-to-library bar — every lesson needs a way home (slides down at top) ── */
    var backbar = document.createElement('a');
    backbar.className = 'chiron-backbar';
    backbar.href = location.origin + '/library/';
    backbar.setAttribute('aria-label', 'Back to the Chiron library');
    backbar.innerHTML = '<span class="cb-arrow">‹</span> Library';
    document.body.appendChild(backbar);

    /* ── scrim (mobile backdrop) ──────────────────────────────────── */
    scrim = document.createElement('div');
    scrim.className = 'ct-scrim';
    document.body.appendChild(scrim);

    /* ── drawer ───────────────────────────────────────────────────── */
    drawer = document.createElement('div');
    drawer.className = 'chiron-tutor';

    resizeHandle = document.createElement('div');
    resizeHandle.className = 'ct-resize';
    drawer.appendChild(resizeHandle); // must be the drawer's first child

    head = document.createElement('div');
    head.className = 'ct-head';
    badge = document.createElement('div'); badge.className = 'ct-badge'; badge.textContent = '🎓';
    title = document.createElement('div'); title.className = 'ct-title'; title.textContent = 'Tutor';
    modelSel = document.createElement('select'); modelSel.className = 'ct-model';
    modeBtn = document.createElement('button');
    modeBtn.type = 'button'; modeBtn.className = 'ct-mode'; modeBtn.title = 'Toggle med / ita mode';
    penBtn = document.createElement('button');
    penBtn.type = 'button'; penBtn.className = 'ct-pen';
    penBtn.title = 'Highlighter — turn on, then select lesson text to mark';
    penBtn.textContent = '🖉'; // 🖉
    gearBtn = document.createElement('button');
    gearBtn.type = 'button'; gearBtn.className = 'ct-gear'; gearBtn.title = 'Settings';
    gearBtn.setAttribute('aria-label', 'Settings');
    gearBtn.textContent = '⚙'; // ⚙
    closeBtn = document.createElement('button');
    closeBtn.type = 'button'; closeBtn.className = 'ct-close'; closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '✕';
    head.appendChild(badge); head.appendChild(title); head.appendChild(modelSel);
    head.appendChild(modeBtn); head.appendChild(penBtn); head.appendChild(gearBtn); head.appendChild(closeBtn);

    /* ── settings popover (⚙) — small, extensible list of drawer settings ── */
    settingsPop = document.createElement('div'); settingsPop.className = 'ct-settings';
    var settingsHead = document.createElement('div');
    settingsHead.className = 'ct-settings-head'; settingsHead.textContent = 'Settings';
    var suggRow = document.createElement('div'); suggRow.className = 'ct-settings-row';
    var suggLabel = document.createElement('span');
    suggLabel.className = 'ct-settings-label'; suggLabel.textContent = 'Suggestions';
    suggToggle = document.createElement('button');
    suggToggle.type = 'button'; suggToggle.className = 'ct-toggle';
    suggToggle.setAttribute('aria-label', 'Toggle follow-up suggestions');
    var suggToggleKnob = document.createElement('span'); suggToggleKnob.className = 'ct-toggle-knob';
    suggToggle.appendChild(suggToggleKnob);
    suggRow.appendChild(suggLabel); suggRow.appendChild(suggToggle);
    var transRow = document.createElement('div'); transRow.className = 'ct-settings-row';
    var transLabel = document.createElement('span');
    transLabel.className = 'ct-settings-label'; transLabel.textContent = 'Live updates';
    var transSwitch = document.createElement('div'); transSwitch.className = 'ct-transport';
    transportSseBtn = document.createElement('button');
    transportSseBtn.type = 'button'; transportSseBtn.className = 'ct-transport-btn';
    transportSseBtn.textContent = 'Stream';
    transportPollBtn = document.createElement('button');
    transportPollBtn.type = 'button'; transportPollBtn.className = 'ct-transport-btn';
    transportPollBtn.textContent = 'Poll';
    transSwitch.appendChild(transportSseBtn); transSwitch.appendChild(transportPollBtn);
    transRow.appendChild(transLabel); transRow.appendChild(transSwitch);
    settingsPop.appendChild(settingsHead); settingsPop.appendChild(suggRow); settingsPop.appendChild(transRow);
    settingsPop.addEventListener('click', function (e) { e.stopPropagation(); });

    scope = document.createElement('div'); scope.className = 'ct-scope';
    scope.title = 'Click to change scope: this section → whole lesson → free';
    chips = document.createElement('div'); chips.className = 'ct-chips';
    msgs = document.createElement('div'); msgs.className = 'ct-msgs';

    inputRow = document.createElement('div'); inputRow.className = 'ct-input';
    textarea = document.createElement('textarea');
    textarea.rows = 1; textarea.placeholder = 'Ask the tutor…';
    sendBtn = document.createElement('button');
    sendBtn.type = 'button'; sendBtn.className = 'ct-send'; sendBtn.setAttribute('aria-label', 'Send');
    sendBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>';
    inputRow.appendChild(textarea); inputRow.appendChild(sendBtn);

    drawer.appendChild(head);
    drawer.appendChild(settingsPop);
    drawer.appendChild(scope);
    drawer.appendChild(chips);
    drawer.appendChild(msgs);
    drawer.appendChild(inputRow);
    document.body.appendChild(drawer);

    /* ── model list + persisted mode ──────────────────────────────── */
    loadModels();
    try { mode = localStorage.getItem(LS_MODE) || 'med'; } catch (e) {}
    renderMode();
    try { scopeMode = localStorage.getItem(LS_SCOPE) || 'section'; } catch (e) {}
    try {
      var savedSuggest = localStorage.getItem(LS_SUGGEST);
      suggestOn = savedSuggest === null ? true : savedSuggest === '1';
    } catch (e) {}
    renderSuggestToggle();
    try { transportMode = localStorage.getItem(LS_TRANSPORT) || 'sse'; } catch (e) {}
    renderTransport();

    modelSel.addEventListener('change', function () {
      try { localStorage.setItem(LS_MODEL, modelSel.value); } catch (e) {}
    });
    modeBtn.addEventListener('click', function () {
      mode = mode === 'ita' ? 'med' : 'ita';
      try { localStorage.setItem(LS_MODE, mode); } catch (e) {}
      renderMode();
    });

    /* ── settings popover (⚙) — toggle + open/close ───────────────── */
    gearBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      settingsPop.classList.toggle('open');
    });
    document.addEventListener('click', function (e) {
      if (!settingsPop.classList.contains('open')) return;
      if (e.target.closest && (e.target.closest('.ct-settings') || e.target.closest('.ct-gear'))) return;
      settingsPop.classList.remove('open');
    });
    suggToggle.addEventListener('click', function () {
      suggestOn = !suggestOn;
      renderSuggestToggle();
      try { localStorage.setItem(LS_SUGGEST, suggestOn ? '1' : '0'); } catch (e) {}
      if (!suggestOn) clearSuggestions();
    });
    transportSseBtn.addEventListener('click', function () { setTransport('sse'); });
    transportPollBtn.addEventListener('click', function () { setTransport('poll'); });

    /* ── scope pill — click cycles section → whole lesson → free ────── */
    scope.addEventListener('click', function () {
      scopeMode = scopeMode === 'section' ? 'lesson' : (scopeMode === 'lesson' ? 'free' : 'section');
      try { localStorage.setItem(LS_SCOPE, scopeMode); } catch (e) {}
      renderScopePill();
    });

    /* ── open / close ─────────────────────────────────────────────── */
    tab.addEventListener('click', function () {
      if (drawer.classList.contains('open')) closeDrawer(); else openDrawer();
    });
    closeBtn.addEventListener('click', closeDrawer);
    scrim.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) {   // Escape always closes — belt-and-suspenders
      if (e.key !== 'Escape') return;
      if (settingsPop.classList.contains('open')) { settingsPop.classList.remove('open'); return; }
      if (drawer.classList.contains('open')) closeDrawer();
    });

    /* ── pen toggle ────────────────────────────────────────────────── */
    tabPen.addEventListener('click', togglePen);
    penBtn.addEventListener('click', togglePen);

    /* ── drag-resize (desktop only, #4) ───────────────────────────── */
    resizeHandle.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      resizeHandle.classList.add('dragging');
      try { resizeHandle.setPointerCapture(e.pointerId); } catch (err) {}
      var onMove = function (ev) {
        var w = window.innerWidth - ev.clientX;
        w = Math.max(320, Math.min(640, w));
        document.documentElement.style.setProperty('--ct-width', w + 'px');
      };
      var onUp = function (ev) {
        resizeHandle.classList.remove('dragging');
        resizeHandle.removeEventListener('pointermove', onMove);
        resizeHandle.removeEventListener('pointerup', onUp);
        try { resizeHandle.releasePointerCapture(ev.pointerId); } catch (err) {}
        try {
          var finalWidth = document.documentElement.style.getPropertyValue('--ct-width').trim();
          if (finalWidth) localStorage.setItem(LS_WIDTH, finalWidth);
        } catch (err) {}
      };
      resizeHandle.addEventListener('pointermove', onMove);
      resizeHandle.addEventListener('pointerup', onUp);
    });

    /* ── scope tracking ───────────────────────────────────────────── */
    var scopeThrottle = null;
    window.addEventListener('scroll', function () {
      if (scopeThrottle) return;
      scopeThrottle = setTimeout(function () {
        scopeThrottle = null;
        if (drawer.classList.contains('open')) updateScope();
      }, 400);
    }, { passive: true });

    /* ── highlighter ───────────────────────────────────────────────── */
    document.addEventListener('mouseup', function (e) {
      if (!document.body.classList.contains('chiron-pen-on')) return;
      if (e.target.closest && (e.target.closest('.chiron-tutor') || e.target.closest('.chiron-tutor-tab'))) return;
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      var text = sel.toString().trim();
      if (text.length < 3) return;
      var range;
      try { range = sel.getRangeAt(0); } catch (err) { return; }
      addHighlight(range, text);
      sel.removeAllRanges();
    });

    /* ── input wiring ─────────────────────────────────────────────── */
    sendBtn.addEventListener('click', send);
    textarea.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    textarea.addEventListener('input', function () {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    });

    /* ── audio-panel collapse (self-contained) ────────────────────── */
    watchForListenPanel();
  }

  function renderMode() {
    if (modeBtn) modeBtn.textContent = mode === 'ita' ? '🗣' : '🩺'; // 🗣 / 🩺
  }

  /* ── settings: "Suggestions" toggle + follow-up pills ─────────────── */
  function renderSuggestToggle() {
    if (!suggToggle) return;
    suggToggle.classList.toggle('on', suggestOn);
    suggToggle.setAttribute('aria-pressed', suggestOn ? 'true' : 'false');
  }

  /* ── settings: "Live updates" transport switch (Stream/SSE vs Poll) ── */
  function renderTransport() {
    if (transportSseBtn) transportSseBtn.classList.toggle('on', transportMode === 'sse');
    if (transportPollBtn) transportPollBtn.classList.toggle('on', transportMode === 'poll');
  }

  function setTransport(v) {
    transportMode = v;
    try { localStorage.setItem(LS_TRANSPORT, v); } catch (e) {}
    renderTransport();
  }

  function clearSuggestions() {
    if (!msgs) return;
    var old = msgs.querySelectorAll('.ct-sugg');
    for (var i = 0; i < old.length; i++) old[i].remove();
  }

  function renderSuggestions(list) {
    clearSuggestions();
    if (!suggestOn || !list || !list.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'ct-sugg';
    list.forEach(function (s) {
      var pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'ct-sugg-pill';
      pill.textContent = s;
      pill.addEventListener('click', function () {
        clearSuggestions();
        textarea.value = s;
        send();
      });
      wrap.appendChild(pill);
    });
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
  }

  /* ── pen toggle (shared by the edge tab AND the drawer-header button) ── */
  function togglePen(e) {
    if (e) e.stopPropagation();
    var on = document.body.classList.toggle('chiron-pen-on');
    tabPen.classList.toggle('on', on);
    penBtn.classList.toggle('on', on);
    showPenHint(on);
  }

  function showPenHint(on) {
    if (!on || !textarea) return;
    var prev = textarea.placeholder;
    textarea.placeholder = 'Select text in the lesson to highlight it';
    setTimeout(function () {
      if (textarea.placeholder === 'Select text in the lesson to highlight it') {
        textarea.placeholder = prev;
      }
    }, 2500);
  }

  /* ── open/close — desktop PUSHES content, narrow viewports OVERLAY ──── */
  function openDrawer() {
    drawer.classList.add('open');
    collapseAudio(true);
    if (window.innerWidth >= 760) {
      document.documentElement.classList.add('chiron-tutor-pushed');
    } else {
      scrim.classList.add('open');
    }
    renderScopePill();
    textarea.focus();
  }
  function closeDrawer() {
    drawer.classList.remove('open');
    scrim.classList.remove('open');
    document.documentElement.classList.remove('chiron-tutor-pushed');
  }

  function findCurrentSection() {
    var sections = document.querySelectorAll('section.chapter, section[id]');
    var best = null, bestDist = Infinity;
    sections.forEach(function (el) {
      var top = el.getBoundingClientRect().top;
      if (top <= 160) {
        var dist = Math.abs(top - 80);
        if (dist < bestDist) { best = el; bestDist = dist; }
      }
    });
    if (!best && sections.length) best = sections[0];
    return best;
  }

  function updateScope() {
    var el = findCurrentSection();
    if (!el) {
      sectionId = null; sectionText = '';
      if (scopeMode === 'section') scope.textContent = '';
      return;
    }
    var h = el.querySelector('h1,h2,h3,[data-section-title]');
    var label = (h && h.textContent.trim()) || el.id || 'Section';
    sectionId = el.id || null;
    sectionText = (el.textContent || '').trim().slice(0, 4000);
    // only overwrite the pill label in 'section' scope — don't clobber the
    // 'Whole lesson' / 'Free' labels while the learner keeps scrolling
    if (scopeMode === 'section') scope.textContent = '📌 On: ' + label; // 📌 On: ...
  }

  /* ── scope-pill label (all 3 states) ──────────────────────────────── */
  function renderScopePill() {
    if (scopeMode === 'lesson') { scope.textContent = '📖 Whole lesson'; return; } // 📖 Whole lesson
    if (scopeMode === 'free') { scope.textContent = '🌐 Free — ask anything'; return; } // 🌐 Free — ask anything
    updateScope();
  }

  /* ── whole-lesson text (excludes the tutor drawer itself — it's a <div>,
     not a <section>, so it's never matched by this selector) ─────────── */
  function computeLessonText() {
    var sections = document.querySelectorAll('section.chapter, section[id]');
    var parts = [];
    sections.forEach(function (el) {
      var t = (el.innerText || el.textContent || '').trim();
      if (t) parts.push(t);
    });
    return parts.join('\n\n').trim().slice(0, 8000);
  }

  /* ── what to send as page context, per the current scope mode ───────── */
  function computeScopePayload() {
    if (scopeMode === 'free') return { section_id: '', section_text: '' };
    if (scopeMode === 'lesson') return { section_id: '', section_text: computeLessonText() };
    return { section_id: sectionId, section_text: sectionText };
  }

  /* ── highlighter helpers ────────────────────────────────────────── */
  function addHighlight(range, text) {
    var mark = document.createElement('mark');
    mark.className = 'chiron-hl';
    try {
      range.surroundContents(mark);
    } catch (err) {
      return; // a selection spanning multiple elements can't be safely wrapped — skip it
    }
    hlCounter += 1;
    var num = hlCounter;
    mark.dataset.hlNum = String(num);
    var sup = document.createElement('sup');
    sup.className = 'chiron-hl-num';
    sup.textContent = String(num);
    sup.dataset.hlNum = String(num);
    if (mark.parentNode) mark.parentNode.insertBefore(sup, mark.nextSibling);
    sup.addEventListener('dblclick', function (e) { e.stopPropagation(); removeHighlight(num); });
    mark.addEventListener('click', function () { flashHighlight(num); });

    var entry = { num: num, mark: mark, sup: sup, text: text };
    highlights.push(entry);
    addChip(entry);
  }

  function removeHighlight(num) {
    var idx = -1;
    for (var i = 0; i < highlights.length; i++) { if (highlights[i].num === num) { idx = i; break; } }
    if (idx === -1) return;
    var h = highlights[idx];
    var parent = h.mark.parentNode;
    if (parent) {
      while (h.mark.firstChild) parent.insertBefore(h.mark.firstChild, h.mark);
      parent.removeChild(h.mark);
    }
    if (h.sup.parentNode) h.sup.parentNode.removeChild(h.sup);
    var chip = chips.querySelector('.ct-chip[data-hl-num="' + num + '"]');
    if (chip) chip.remove();
    highlights.splice(idx, 1);
  }

  function flashHighlight(num) {
    var h = null;
    for (var i = 0; i < highlights.length; i++) { if (highlights[i].num === num) { h = highlights[i]; break; } }
    if (!h) return;
    h.mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    h.mark.style.outline = '2px solid #10b981';
    setTimeout(function () { h.mark.style.outline = ''; }, 900);
  }

  function addChip(entry) {
    var chip = document.createElement('div');
    chip.className = 'ct-chip';
    chip.dataset.hlNum = String(entry.num);
    var numEl = document.createElement('span'); numEl.className = 'ct-chip-num'; numEl.textContent = String(entry.num);
    var textEl = document.createElement('span'); textEl.className = 'ct-chip-text'; textEl.textContent = entry.text;
    var xEl = document.createElement('button');
    xEl.type = 'button'; xEl.className = 'ct-chip-x'; xEl.textContent = '✕';
    xEl.addEventListener('click', function (e) { e.stopPropagation(); removeHighlight(entry.num); });
    chip.appendChild(numEl); chip.appendChild(textEl); chip.appendChild(xEl);
    chip.addEventListener('click', function () { flashHighlight(entry.num); });
    chips.appendChild(chip);
  }

  /* ── compact, safe markdown → HTML (assistant bubbles only) ─────── */
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function inlineMd(s) {
    return s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[^_])_([^_\s][^_]*?)_(?!_)/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  function isTableSep(line) {
    return /^[\s|:-]+$/.test(line) && line.indexOf('-') !== -1;
  }

  function splitTableRow(line) {
    var t = line.trim();
    if (t.charAt(0) === '|') t = t.slice(1);
    if (t.charAt(t.length - 1) === '|') t = t.slice(0, -1);
    return t.split('|').map(function (c) { return c.trim(); });
  }

  function mdToHtml(src) {
    if (!src) return '';
    var out = escapeHtml(src);

    // fenced code blocks → placeholders, so later rules can't mangle them
    var codeBlocks = [];
    out = out.replace(/```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/g, function (m, code) {
      var idx = codeBlocks.length;
      codeBlocks.push('<pre><code>' + code.replace(/\n$/, '') + '</code></pre>');
      return '@@CB' + idx + '@@';
    });

    var lines = out.split('\n');
    var htmlParts = [];
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      var cbMatch = /^@@CB(\d+)@@$/.exec(line.trim());
      var hMatch = /^(#{1,4})\s+(.*)$/.exec(line);

      if (cbMatch) { htmlParts.push(line.trim()); i++; continue; }

      if (hMatch) {
        var level = hMatch[1].length;
        htmlParts.push('<h' + level + '>' + inlineMd(hMatch[2]) + '</h' + level + '>');
        i++; continue;
      }

      if (/^---+\s*$/.test(line)) { htmlParts.push('<hr>'); i++; continue; }

      if (/^\s*\|.*\|\s*$/.test(line) && lines[i + 1] !== undefined && isTableSep(lines[i + 1])) {
        var headerCells = splitTableRow(line);
        var rows = [];
        var j = i + 2;
        while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) {
          rows.push(splitTableRow(lines[j]));
          j++;
        }
        var thead = '<thead><tr>' + headerCells.map(function (c) { return '<th>' + inlineMd(c) + '</th>'; }).join('') + '</tr></thead>';
        var tbody = '<tbody>' + rows.map(function (r) {
          return '<tr>' + r.map(function (c) { return '<td>' + inlineMd(c) + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody>';
        htmlParts.push('<table>' + thead + tbody + '</table>');
        i = j; continue;
      }

      if (/^\s*[-*]\s+/.test(line)) {
        var uitems = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          uitems.push(lines[i].replace(/^\s*[-*]\s+/, ''));
          i++;
        }
        htmlParts.push('<ul>' + uitems.map(function (it) { return '<li>' + inlineMd(it) + '</li>'; }).join('') + '</ul>');
        continue;
      }

      if (/^\s*\d+\.\s+/.test(line)) {
        var oitems = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          oitems.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
          i++;
        }
        htmlParts.push('<ol>' + oitems.map(function (it) { return '<li>' + inlineMd(it) + '</li>'; }).join('') + '</ol>');
        continue;
      }

      if (/^\s*$/.test(line)) { i++; continue; }

      var paraLines = [];
      while (i < lines.length && lines[i].trim() !== '' &&
             !/^#{1,4}\s+/.test(lines[i]) && !/^---+\s*$/.test(lines[i]) &&
             !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i]) &&
             !/^\s*\|.*\|\s*$/.test(lines[i]) && !/^@@CB\d+@@$/.test(lines[i].trim())) {
        paraLines.push(lines[i]);
        i++;
      }
      if (paraLines.length) htmlParts.push('<p>' + paraLines.map(inlineMd).join('<br>') + '</p>');
    }

    var result = htmlParts.join('\n');
    result = result.replace(/@@CB(\d+)@@/g, function (m, idx) { return codeBlocks[idx]; });
    return result;
  }

  /* ── MathJax safety net — some replies still slip in LaTeX ($...$,
     \alpha, \rightarrow) despite the system prompt asking for Unicode.
     The lesson page already loads MathJax v3; typeset assistant bubbles
     after render. Fully guarded — no-op if MathJax isn't present. ───── */
  function typesetMath(el) {
    try {
      if (window.MathJax && window.MathJax.typesetPromise) {
        window.MathJax.typesetPromise([el]).catch(function () {});
      }
    } catch (e) {}
  }

  /* ── chat ──────────────────────────────────────────────────────── */
  function appendBubble(role, text) {
    var b = document.createElement('div');
    b.className = 'ct-bub ' + (role === 'user' ? 'u' : 'a');
    if (role === 'assistant') { b.innerHTML = mdToHtml(text); typesetMath(b); }
    else b.textContent = text;
    msgs.appendChild(b);
    msgs.scrollTop = msgs.scrollHeight;
    return b;
  }

  /* ── live-progress status area (built inside the loading bubble) ──────
     Two transports feed it: SSE (/tutor-stream) or POLL (/tutor-chat +
     /tutor-status/<rid>). Both call setStatus() with the real status text;
     a rotating whimsical filler + elapsed timer runs alongside so long
     "agent" waits (2+ min) don't look dead. ─────────────────────────── */
  function buildStatusEl(bubEl) {
    bubEl.classList.add('ct-loading');
    bubEl.innerHTML = '';
    var wrap = document.createElement('div'); wrap.className = 'ct-status';
    var spin = document.createElement('span'); spin.className = 'ct-spin';
    var t = document.createElement('span'); t.className = 'ct-status-t'; t.textContent = 'Thinking…';
    var w = document.createElement('span'); w.className = 'ct-status-w';
    wrap.appendChild(spin); wrap.appendChild(t); wrap.appendChild(w);
    bubEl.appendChild(wrap);
    return { t: t, w: w, fillerTimer: null, tickTimer: null, startTime: Date.now(), currentWord: '' };
  }

  function setStatus(statusRefs, text) {
    if (!statusRefs || !statusRefs.t || !text) return;
    statusRefs.t.textContent = text;
  }

  function pickFillerWord(prev) {
    if (FILLER_WORDS.length <= 1) return FILLER_WORDS[0];
    var w;
    do { w = FILLER_WORDS[Math.floor(Math.random() * FILLER_WORDS.length)]; } while (w === prev);
    return w;
  }

  function startFiller(statusRefs) {
    if (!statusRefs || !statusRefs.w) return;
    statusRefs.currentWord = pickFillerWord(null);
    var tick = function () {
      var elapsed = Math.round((Date.now() - statusRefs.startTime) / 1000);
      statusRefs.w.textContent = '(' + statusRefs.currentWord + ' · ' + elapsed + 's)';
    };
    tick();
    statusRefs.tickTimer = setInterval(tick, 1000);
    statusRefs.fillerTimer = setInterval(function () {
      statusRefs.currentWord = pickFillerWord(statusRefs.currentWord);
      tick();
    }, 4000);
  }

  function stopFiller(statusRefs) {
    if (!statusRefs) return;
    if (statusRefs.fillerTimer) clearInterval(statusRefs.fillerTimer);
    if (statusRefs.tickTimer) clearInterval(statusRefs.tickTimer);
    statusRefs.fillerTimer = null; statusRefs.tickTimer = null;
  }

  function finalizeReply(loadingBub, statusRefs, data) {
    stopFiller(statusRefs);
    var reply = (data && data.reply) || '(no reply)';
    loadingBub.classList.remove('ct-loading');
    loadingBub.innerHTML = mdToHtml(reply);
    typesetMath(loadingBub);
    if (data && data.grounded) {
      var g = document.createElement('span');
      g.className = 'ct-grounded';
      g.textContent = typeof data.grounded === 'string' ? data.grounded : '✓ grounded';
      loadingBub.appendChild(g);
    }
    messages.push({ role: 'assistant', content: reply });
    renderSuggestions(suggestOn && data ? data.suggestions : null);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function failReply(loadingBub, statusRefs) {
    stopFiller(statusRefs);
    loadingBub.classList.remove('ct-loading');
    loadingBub.textContent = '⚠ Tutor service offline — start it on :8912 (host-side). Your highlights are saved.';
    msgs.scrollTop = msgs.scrollHeight;
  }

  /* ── transport A: SSE (/tutor-stream) — default ──────────────────── */
  function sendStream(payload, loadingBub, statusRefs) {
    var finished = false;
    fetch('http://' + location.hostname + ':8912/tutor-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok || !r.body) throw new Error('bad status ' + (r && r.status));
      var reader = r.body.getReader();
      var decoder = new TextDecoder();
      var buf = '';
      function handleEvent(line) {
        if (finished || line.indexOf('data: ') !== 0) return; // ignore ": keepalive" comments etc
        var evt;
        try { evt = JSON.parse(line.slice(6)); } catch (e) { return; }
        if (evt.type === 'status' && evt.text) {
          setStatus(statusRefs, evt.text);
        } else if (evt.type === 'final') {
          finished = true;
          finalizeReply(loadingBub, statusRefs, evt);
        }
      }
      function pump() {
        return reader.read().then(function (res) {
          if (res.done) {
            if (!finished) failReply(loadingBub, statusRefs);
            return;
          }
          buf += decoder.decode(res.value, { stream: true });
          var parts = buf.split('\n\n');
          buf = parts.pop(); // keep the last (possibly incomplete) chunk buffered
          for (var i = 0; i < parts.length && !finished; i++) {
            var lines = parts[i].split('\n');
            for (var j = 0; j < lines.length && !finished; j++) handleEvent(lines[j]);
          }
          if (finished) return;
          return pump();
        });
      }
      return pump();
    }).catch(function () {
      if (!finished) failReply(loadingBub, statusRefs);
    });
  }

  /* ── transport B: POLL (/tutor-chat + GET /tutor-status/<rid>) ────── */
  function sendPoll(payload, loadingBub, statusRefs) {
    var rid = 'r' + Date.now() + Math.random().toString(36).slice(2);
    payload.rid = rid;
    var pollTimer = setInterval(function () {
      fetch('http://' + location.hostname + ':8912/tutor-status/' + rid)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data || !data.events || !data.events.length) return;
          var last = data.events[data.events.length - 1];
          if (last && last.text) setStatus(statusRefs, last.text);
        })
        .catch(function () {});
    }, 700);

    fetch('http://' + location.hostname + ':8912/tutor-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      clearInterval(pollTimer);
      if (!r.ok) throw new Error('bad status ' + r.status);
      return r.json();
    }).then(function (data) {
      finalizeReply(loadingBub, statusRefs, data);
    }).catch(function () {
      clearInterval(pollTimer);
      failReply(loadingBub, statusRefs);
    });
  }

  function send() {
    var text = textarea.value.trim();
    if (!text) return;
    textarea.value = '';
    textarea.style.height = 'auto';
    messages.push({ role: 'user', content: text });
    appendBubble('user', text);
    var loadingBub = appendBubble('assistant', '');
    var statusRefs = buildStatusEl(loadingBub);
    startFiller(statusRefs);

    var scopePayload = computeScopePayload();
    var payload = {
      lesson_slug: deriveLessonSlug(),
      section_id: scopePayload.section_id,
      section_text: scopePayload.section_text,
      selection: highlights.map(function (h) { return h.text; }).join(' | '),
      messages: messages.slice(),
      model: modelSel.value,
      mode: mode,
      lang: mode === 'ita' ? 'it' : 'en',
      suggest: suggestOn
    };

    if (transportMode === 'poll') sendPoll(payload, loadingBub, statusRefs);
    else sendStream(payload, loadingBub, statusRefs);
  }

  function init() {
    build();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
