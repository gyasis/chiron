/* ── Chiron Tutor (eco-lite) + text highlighter — Concept C ──────────────────
   SHARED, server-injected asset (see skill/server/app.py) — served once at
   /shell/tutor.js and injected into every lesson.html at serve-time. NOT
   copied per-lesson. Self-contained: does not depend on main.js internals —
   it locates the lesson's own `.chiron-listen` audio panel (if any) itself
   and drives its collapse/expand, rather than relying on a main.js-exposed
   global. Talks to a host-side tutor service at http://<host>:8912/tutor-chat
   (+ GET /tutor-models); degrades gracefully to an offline notice when that
   service isn't running. The conversation itself is persisted per-lesson in
   localStorage under the `chiron.tutorchat.<slug>` key (restored on reopen;
   the ↺ button clears it). Assistant answers and highlighted terms each get
   a ☆/`.ct-star`/`.ct-chip-star` button that POSTs to the SAME-ORIGIN
   `/capture` endpoint (served by this app, not the :8912 tutor service) to
   flag the item for the corpus store.
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
  var LS_TESTED = 'chiron.tutortested';
  var LS_CHAT = 'chiron.tutorchat.';
  var CHAT_MAX_ENTRIES = 40;
  var CHAT_MAX_BYTES = 200000;
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
  var highlights = []; // { num, mark, sup, text, chipEl, captureId }
  var selected = [];   // subset of `highlights` entries currently selected for batch dispatch
  var hlCounter = 0;
  var sectionId = null;
  var sectionText = '';
  var lastQuestion = null; // most recent user turn — paired with the next assistant reply for capture
  var mathBlocks = []; // per-render array of math→HTML fragments (sub/sup/frac), placeholder-swapped like codeBlocks (reset per mdToHtml call)

  var tab, scrim, drawer, head, badge, title, modelSel, modeBtn, penBtn, newChatBtn, gearBtn, closeBtn,
      scope, chips, msgs, dispatchBar, dispatchLabel, dispatchSpin, dispatchKeepBtn, dispatchCardsBtn,
      dispatchMcqsBtn, dispatchTrainBtn, dispatchLessonBtn, dispatchImagesBtn,
      dispatchClearBtn, dispatchMsg, inputRow, textarea, sendBtn, tabPen, resizeHandle,
      settingsPop, suggToggle, transportSseBtn, transportPollBtn, testedToggle;
  var mode = 'med';
  var scopeMode = 'section'; // 'section' | 'lesson' | 'free' — cycled by clicking .ct-scope
  var suggestOn = true; // 'Suggestions' setting (settings popover) — default ON, persisted to LS_SUGGEST
  var transportMode = 'sse'; // 'sse' | 'poll' — 'Live updates' setting, default sse, persisted to LS_TRANSPORT
  var testedOn = true; // 'Practice links' setting (settings popover) — default ON, persisted to LS_TESTED

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
    newChatBtn = document.createElement('button');
    newChatBtn.type = 'button'; newChatBtn.className = 'ct-new';
    newChatBtn.title = "New chat — clears this lesson's conversation";
    newChatBtn.setAttribute('aria-label', 'New chat');
    newChatBtn.textContent = '↺'; // ↺
    gearBtn = document.createElement('button');
    gearBtn.type = 'button'; gearBtn.className = 'ct-gear'; gearBtn.title = 'Settings';
    gearBtn.setAttribute('aria-label', 'Settings');
    gearBtn.textContent = '⚙'; // ⚙
    closeBtn = document.createElement('button');
    closeBtn.type = 'button'; closeBtn.className = 'ct-close'; closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '✕';
    head.appendChild(badge); head.appendChild(title); head.appendChild(modelSel);
    head.appendChild(modeBtn); head.appendChild(penBtn); head.appendChild(newChatBtn);
    head.appendChild(gearBtn); head.appendChild(closeBtn);

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
    var testedRow = document.createElement('div'); testedRow.className = 'ct-settings-row';
    var testedLabel = document.createElement('span');
    testedLabel.className = 'ct-settings-label'; testedLabel.textContent = 'Practice links';
    testedToggle = document.createElement('button');
    testedToggle.type = 'button'; testedToggle.className = 'ct-toggle';
    testedToggle.setAttribute('aria-label', 'Toggle practice-question links');
    var testedToggleKnob = document.createElement('span'); testedToggleKnob.className = 'ct-toggle-knob';
    testedToggle.appendChild(testedToggleKnob);
    testedRow.appendChild(testedLabel); testedRow.appendChild(testedToggle);
    settingsPop.appendChild(settingsHead); settingsPop.appendChild(suggRow); settingsPop.appendChild(transRow);
    settingsPop.appendChild(testedRow);
    settingsPop.addEventListener('click', function (e) { e.stopPropagation(); });

    scope = document.createElement('div'); scope.className = 'ct-scope';
    scope.title = 'Click to change scope: this section → whole lesson → free';
    chips = document.createElement('div'); chips.className = 'ct-chips';
    msgs = document.createElement('div'); msgs.className = 'ct-msgs';

    /* ── dispatch bar — batch actions (Keep / Cards) for selected highlight
       chips; hidden until ≥1 chip is selected (see toggleSelect/renderDispatchBar) ── */
    dispatchBar = document.createElement('div'); dispatchBar.className = 'ct-dispatch';
    dispatchLabel = document.createElement('span'); dispatchLabel.className = 'ct-dispatch-n';
    dispatchSpin = document.createElement('span'); dispatchSpin.className = 'ct-spin ct-dispatch-spin';
    dispatchKeepBtn = document.createElement('button');
    dispatchKeepBtn.type = 'button'; dispatchKeepBtn.className = 'ct-dispatch-keep';
    dispatchKeepBtn.textContent = '⭐ Keep';
    dispatchCardsBtn = document.createElement('button');
    dispatchCardsBtn.type = 'button'; dispatchCardsBtn.className = 'ct-dispatch-cards';
    dispatchCardsBtn.textContent = '🎴 Cards';
    dispatchMcqsBtn = document.createElement('button');
    dispatchMcqsBtn.type = 'button'; dispatchMcqsBtn.className = 'ct-dispatch-mcqs';
    dispatchMcqsBtn.textContent = '❓ MCQs';
    dispatchTrainBtn = document.createElement('button');
    dispatchTrainBtn.type = 'button'; dispatchTrainBtn.className = 'ct-dispatch-train';
    dispatchTrainBtn.textContent = '🎓 Train';
    dispatchLessonBtn = document.createElement('button');
    dispatchLessonBtn.type = 'button'; dispatchLessonBtn.className = 'ct-dispatch-lesson';
    dispatchLessonBtn.textContent = '📚 Lesson';
    dispatchImagesBtn = document.createElement('button');
    dispatchImagesBtn.type = 'button'; dispatchImagesBtn.className = 'ct-dispatch-images';
    dispatchImagesBtn.textContent = '🖼 Images';
    dispatchClearBtn = document.createElement('button');
    dispatchClearBtn.type = 'button'; dispatchClearBtn.className = 'ct-dispatch-clear';
    dispatchClearBtn.title = 'Clear selection';
    dispatchClearBtn.setAttribute('aria-label', 'Clear selection');
    dispatchClearBtn.textContent = '✕';
    dispatchMsg = document.createElement('span'); dispatchMsg.className = 'msg';
    dispatchBar.appendChild(dispatchLabel);
    dispatchBar.appendChild(dispatchSpin);
    dispatchBar.appendChild(dispatchKeepBtn);
    dispatchBar.appendChild(dispatchCardsBtn);
    dispatchBar.appendChild(dispatchMcqsBtn);
    dispatchBar.appendChild(dispatchTrainBtn);
    dispatchBar.appendChild(dispatchLessonBtn);
    dispatchBar.appendChild(dispatchImagesBtn);
    dispatchBar.appendChild(dispatchClearBtn);
    dispatchBar.appendChild(dispatchMsg);

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
    drawer.appendChild(dispatchBar);
    drawer.appendChild(inputRow);
    document.body.appendChild(drawer);

    /* ── restore any persisted conversation for THIS lesson ─────────── */
    restoreChat();

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
    try {
      var savedTested = localStorage.getItem(LS_TESTED);
      testedOn = savedTested === null ? true : savedTested === '1';
    } catch (e) {}
    renderTestedToggle();

    modelSel.addEventListener('change', function () {
      try { localStorage.setItem(LS_MODEL, modelSel.value); } catch (e) {}
    });
    modeBtn.addEventListener('click', function () {
      mode = mode === 'ita' ? 'med' : 'ita';
      try { localStorage.setItem(LS_MODE, mode); } catch (e) {}
      renderMode();
    });
    newChatBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!window.confirm("Start a new chat? This clears this lesson's conversation.")) return;
      messages = [];
      lastQuestion = null;
      msgs.innerHTML = '';
      try { localStorage.removeItem(LS_CHAT + deriveLessonSlug()); } catch (err) {}
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
    testedToggle.addEventListener('click', function () {
      testedOn = !testedOn;
      renderTestedToggle();
      try { localStorage.setItem(LS_TESTED, testedOn ? '1' : '0'); } catch (e) {}
      if (!testedOn) clearTested();
    });
    transportSseBtn.addEventListener('click', function () { setTransport('sse'); });
    transportPollBtn.addEventListener('click', function () { setTransport('poll'); });

    /* ── scope pill — click cycles section → whole lesson → free ────── */
    scope.addEventListener('click', function () {
      scopeMode = scopeMode === 'section' ? 'lesson' : (scopeMode === 'lesson' ? 'free' : 'section');
      try { localStorage.setItem(LS_SCOPE, scopeMode); } catch (e) {}
      renderScopePill();
    });

    /* ── dispatch bar — batch actions for selected highlight chips ──── */
    dispatchKeepBtn.addEventListener('click', dispatchKeep);
    dispatchCardsBtn.addEventListener('click', function () { dispatch('cards'); });
    dispatchMcqsBtn.addEventListener('click', function () { dispatch('mcqs'); });
    dispatchTrainBtn.addEventListener('click', function () { dispatch('train'); });
    dispatchLessonBtn.addEventListener('click', function () { dispatch('lesson'); });
    dispatchImagesBtn.addEventListener('click', openImagesForSelection);
    dispatchClearBtn.addEventListener('click', clearSelection);

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

  /* ── settings: "Practice links" toggle + "where it's tested" pills ──────
     After an assistant reply, POST the concepts (highlight chips + the last
     question) to the tutor service's /related endpoint and render whatever
     {label, url, tier} rows come back as small deep-link pills. Chiron is
     domain-blind here — it just renders what the backend returns. ─────── */
  function renderTestedToggle() {
    if (!testedToggle) return;
    testedToggle.classList.toggle('on', testedOn);
    testedToggle.setAttribute('aria-pressed', testedOn ? 'true' : 'false');
  }

  function clearTested() {
    if (!msgs) return;
    var old = msgs.querySelectorAll('.ct-tested');
    for (var i = 0; i < old.length; i++) old[i].remove();
  }

  function renderTested(list) {
    clearTested();
    if (!testedOn || !list || !list.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'ct-tested';
    var label = document.createElement('div');
    label.className = 'ct-tested-label';
    label.textContent = 'Where it’s tested';
    wrap.appendChild(label);
    list.forEach(function (r) {
      if (!r || !r.url || !r.label) return;
      var pill = document.createElement('a');
      pill.className = 'ct-tested-pill' + (r.tier === 'direct' ? ' direct' : '');
      pill.href = ssmLink(r.url);
      pill.target = '_blank';
      pill.rel = 'noopener';
      var text = String(r.label);
      if (text.length > 55) text = text.slice(0, 54) + '…';
      pill.textContent = text;
      wrap.appendChild(pill);
    });
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
  }

  // The library's SSM indicator holds the base address (shared localStorage, same origin).
  // Rewrite the server-built ?qid= link's origin to it so pills open on THIS device's LAN
  // address (never localhost / never a stale server default). Falls back to same-host:5191.
  function ssmBase() {
    var b = '';
    try { b = localStorage.getItem('chiron.ssmBase') || ''; } catch (e) {}
    if (b) return b.replace(/\/+$/, '');
    return location.protocol + '//' + location.hostname + ':5191';
  }
  function ssmLink(url) {
    try {
      var u = new URL(url, location.href), base = new URL(ssmBase());
      u.protocol = base.protocol; u.host = base.host;
      return u.href;
    } catch (e) { return url; }
  }

  function collectTestedConcepts() {
    var fromHighlights = highlights.map(function (h) { return h.text; });
    return fromHighlights.concat(lastQuestion ? [lastQuestion] : []).filter(Boolean).slice(0, 8);
  }

  function fetchTestedQuestions(concepts) {
    if (!testedOn || !concepts || !concepts.length) return;
    fetch('http://' + location.hostname + ':8912/related', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ concepts: concepts, k: 6 })
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.related) return;
        renderTested(data.related);
      })
      .catch(function () { /* tutor service offline or no match — no pills, no error shown */ });
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
    var selIdx = selected.indexOf(h);
    if (selIdx !== -1) { selected.splice(selIdx, 1); renderDispatchBar(); }
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
    numEl.addEventListener('click', function (e) { e.stopPropagation(); flashHighlight(entry.num); });
    var textEl = document.createElement('span'); textEl.className = 'ct-chip-text'; textEl.textContent = entry.text;
    var starEl = document.createElement('button');
    starEl.type = 'button'; starEl.className = 'ct-chip-star'; starEl.textContent = '☆';
    starEl.title = 'Save this term to your captures';
    starEl.setAttribute('aria-label', 'Save this term');
    starEl.addEventListener('click', function (e) {
      e.stopPropagation();
      if (starEl.disabled) return;
      starEl.disabled = true;
      var qa = lastQA();
      var payload = {
        kind: 'term',
        text: entry.text,
        question: qa.question,
        source_answer: qa.answer,
        surrounding_text: sectionText,
        lesson_slug: deriveLessonSlug(),
        section_id: sectionId,
        concept: entry.text,
        model: modelSel ? modelSel.value : null,
        source: 'tutor'
      };
      postCapture(payload, function () {
        starEl.textContent = '★';
        starEl.classList.add('saved');
        starEl.title = 'Saved to your captures';
      }, function () {
        starEl.disabled = false;
        starEl.title = 'Save failed — try again';
      });
    });
    var xEl = document.createElement('button');
    xEl.type = 'button'; xEl.className = 'ct-chip-x'; xEl.textContent = '✕';
    xEl.addEventListener('click', function (e) { e.stopPropagation(); removeHighlight(entry.num); });
    chip.appendChild(numEl); chip.appendChild(textEl); chip.appendChild(starEl); chip.appendChild(xEl);
    entry.chipEl = chip;
    chip.addEventListener('click', function () { toggleSelect(entry, chip); });
    chips.appendChild(chip);
  }

  /* ── selectable chips + dispatch bar (batch Keep / Cards) ──────────── */
  function toggleSelect(entry, chip) {
    var idx = selected.indexOf(entry);
    if (idx === -1) { selected.push(entry); chip.classList.add('selected'); }
    else { selected.splice(idx, 1); chip.classList.remove('selected'); }
    renderDispatchBar();
  }

  function renderDispatchBar() {
    if (!dispatchBar) return;
    if (!selected.length) { dispatchBar.classList.remove('open'); return; }
    dispatchBar.classList.add('open');
    dispatchLabel.textContent = selected.length + ' selected';
    dispatchMsg.textContent = '';
  }

  function clearChipSelectionState() {
    selected.forEach(function (entry) { if (entry.chipEl) entry.chipEl.classList.remove('selected'); });
    selected = [];
  }

  function clearSelection() {
    clearChipSelectionState();
    renderDispatchBar();
  }

  function hideDispatchBar() {
    if (!dispatchBar) return;
    dispatchBar.classList.remove('open', 'working');
    dispatchLabel.textContent = '';
    dispatchMsg.textContent = '';
  }

  function setDispatchButtonsDisabled(v) {
    dispatchKeepBtn.disabled = v; dispatchCardsBtn.disabled = v;
    dispatchMcqsBtn.disabled = v; dispatchTrainBtn.disabled = v; dispatchLessonBtn.disabled = v;
    dispatchClearBtn.disabled = v;
  }

  /* capture ONE highlight entry (idempotent — reuses entry.captureId if already saved) */
  function captureEntry(entry, done) {
    if (entry.captureId) { done(entry.captureId); return; }
    var qa = lastQA();
    var payload = {
      kind: 'term',
      text: entry.text,
      question: qa.question,
      source_answer: qa.answer,
      surrounding_text: sectionText,
      lesson_slug: deriveLessonSlug(),
      section_id: sectionId,
      concept: entry.text,
      model: modelSel ? modelSel.value : null,
      source: 'tutor'
    };
    postCapture(payload, function (data) {
      entry.captureId = (data && data.id) || null;
      done(entry.captureId);
    }, function () {
      done(null);
    });
  }

  /* capture every currently-selected entry that doesn't already have a captureId,
     then hand back the full list of ids (existing + newly captured) */
  function captureAllSelected(cb) {
    var toCapture = selected.filter(function (e) { return !e.captureId; });
    if (!toCapture.length) {
      cb(selected.map(function (e) { return e.captureId; }).filter(Boolean));
      return;
    }
    var remaining = toCapture.length;
    toCapture.forEach(function (entry) {
      captureEntry(entry, function () {
        remaining -= 1;
        if (remaining === 0) cb(selected.map(function (e) { return e.captureId; }).filter(Boolean));
      });
    });
  }

  function dispatchKeep() {
    if (!selected.length) return;
    var toMark = selected.slice();
    setDispatchButtonsDisabled(true);
    dispatchLabel.textContent = '';
    dispatchMsg.textContent = 'saving…';
    captureAllSelected(function (ids) {
      setDispatchButtonsDisabled(false);
      if (!ids.length) {
        dispatchMsg.textContent = '⚠ save failed — try again';
        return;
      }
      toMark.forEach(function (entry) {
        if (entry.captureId && entry.chipEl) entry.chipEl.classList.add('saved');
      });
      dispatchMsg.textContent = 'saved ' + ids.length;
      clearChipSelectionState();
      setTimeout(function () { if (!selected.length) hideDispatchBar(); }, 4000);
    });
  }

  var DISPATCH_WORKING_MSG = {
    cards: '🎴 making cards…',
    mcqs: '❓ making questions…',
    train: '🎓 building a drill…',
    lesson: '📚 queuing lesson…'
  };

  /* generic dispatch — Cards / MCQs / Train / Lesson all share the same
     capture-then-POST-with-working-state flow; only the request `kind` and
     the result rendering differ (see handleDispatchResult). */
  function dispatch(kind) {
    if (!selected.length) return;
    var toMark = selected.slice();
    setDispatchButtonsDisabled(true);
    dispatchBar.classList.add('working');
    dispatchLabel.textContent = '';
    dispatchMsg.textContent = '🧬 decomposing…';
    captureAllSelected(function (ids) {
      if (!ids.length) {
        dispatchBar.classList.remove('working');
        setDispatchButtonsDisabled(false);
        dispatchMsg.textContent = '⚠ capture failed — try again';
        return;
      }
      toMark.forEach(function (entry) {
        if (entry.captureId && entry.chipEl) entry.chipEl.classList.add('saved');
      });
      dispatchMsg.textContent = DISPATCH_WORKING_MSG[kind] || 'working…';
      fetch('/captures/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ids, kind: kind })
      }).then(function (r) {
        if (!r.ok) throw new Error('bad status ' + r.status);
        return r.json();
      }).then(function (data) {
        dispatchBar.classList.remove('working');
        setDispatchButtonsDisabled(false);
        handleDispatchResult(kind, data);
        clearChipSelectionState();
        setTimeout(function () { if (!selected.length) hideDispatchBar(); }, 6000);
      }).catch(function (e) {
        dispatchBar.classList.remove('working');
        setDispatchButtonsDisabled(false);
        dispatchMsg.textContent = '⚠ ' + (e && e.message ? e.message : 'request failed');
      });
    });
  }

  /* per-kind SUCCESS handling — sets the dispatch-bar result line, and for
     mcqs/train renders an interactive block into the message list */
  function handleDispatchResult(kind, data) {
    if (kind === 'mcqs') {
      var mcqs = (data && data.mcqs) || [];
      dispatchMsg.textContent = '✓ ' + mcqs.length + ' practice question' + (mcqs.length === 1 ? '' : 's') + ' ready';
      if (mcqs.length) renderMcqBlock(mcqs);
      return;
    }
    if (kind === 'train') {
      var train = data && data.train;
      dispatchMsg.textContent = '✓ drill ready';
      if (train) renderTrainBlock(train);
      return;
    }
    if (kind === 'lesson') {
      var job = data && data.lesson_job;
      var slug = job && job.slug;
      dispatchMsg.textContent = slug ? ('✓ lesson queued — ' + slug) : '✓ lesson queued';
      renderLessonQueuedBlock(slug, job && job.status);
      return;
    }
    // cards (default)
    var cardCount = (data && data.cards && data.cards.length) || 0;
    var written = (data && typeof data.written_to_sr === 'number') ? data.written_to_sr : cardCount;
    dispatchMsg.textContent = '✓ ' + written + ' cards → due now';
  }

  /* append a `.ct-bub a`-styled block to the message list so a dispatch
     result reads as something the tutor produced, not a raw API response */
  function appendResultBlock(contentEl) {
    var b = document.createElement('div');
    b.className = 'ct-bub a';
    b.appendChild(contentEl);
    msgs.appendChild(b);
    msgs.scrollTop = msgs.scrollHeight;
    return b;
  }

  /* ── interactive MCQ rendering — the distractor feedback (why_wrong) IS
     the pedagogy, so it must show on every answer, right or wrong ──────── */
  function renderMcqBlock(mcqs) {
    var wrap = document.createElement('div');
    wrap.className = 'ct-mcq-block';
    mcqs.forEach(function (q) {
      var item = document.createElement('div');
      item.className = 'ct-mcq';
      var stemEl = document.createElement('div');
      stemEl.className = 'ct-mcq-stem';
      stemEl.textContent = q && q.stem || '';
      item.appendChild(stemEl);

      var optWrap = document.createElement('div');
      optWrap.className = 'ct-mcq-opts';
      var options = (q && q.options) || {};
      var correctKey = q && q.correct;
      var whyWrong = (q && q.why_wrong) || {};
      var answered = false;
      var btnByKey = {};
      Object.keys(options).forEach(function (key) {
        var optBtn = document.createElement('button');
        optBtn.type = 'button';
        optBtn.className = 'ct-mcq-opt';
        optBtn.textContent = key.toUpperCase() + '. ' + options[key];
        btnByKey[key] = optBtn;
        optBtn.addEventListener('click', function () {
          if (answered) return;
          answered = true;
          Object.keys(btnByKey).forEach(function (k) { btnByKey[k].disabled = true; });
          var isCorrect = key === correctKey;
          optBtn.classList.add(isCorrect ? 'correct' : 'wrong');
          if (!isCorrect && btnByKey[correctKey]) btnByKey[correctKey].classList.add('correct');
          var lines = [];
          if (whyWrong[key]) lines.push(whyWrong[key]);
          if (!isCorrect && whyWrong[correctKey]) {
            lines.push('Why ' + String(correctKey).toUpperCase() + ' is right: ' + whyWrong[correctKey]);
          }
          if (lines.length) {
            var whyEl = document.createElement('div');
            whyEl.className = 'ct-mcq-why';
            whyEl.textContent = lines.join(' ');
            item.appendChild(whyEl);
          }
          if (q && q.discriminator) {
            var discEl = document.createElement('div');
            discEl.className = 'ct-mcq-disc';
            discEl.textContent = 'Tested rule: ' + q.discriminator;
            item.appendChild(discEl);
          }
        });
        optWrap.appendChild(optBtn);
      });
      item.appendChild(optWrap);
      wrap.appendChild(item);
    });
    appendResultBlock(wrap);
  }

  /* ── train drill rendering — teach → drill(reveal) → closer walk ─────── */
  function renderTrainBlock(train) {
    var wrap = document.createElement('div');
    wrap.className = 'ct-train-block';
    var steps = (train && train.steps) || [];
    steps.forEach(function (step) {
      var stepEl = document.createElement('div');
      stepEl.className = 'ct-train-step';
      var topicEl = document.createElement('div');
      topicEl.className = 'ct-train-topic';
      topicEl.textContent = (step && step.topic) || '';
      stepEl.appendChild(topicEl);
      if (step && step.teach) {
        var teachEl = document.createElement('div');
        teachEl.className = 'ct-train-teach';
        teachEl.textContent = step.teach;
        stepEl.appendChild(teachEl);
      }
      if (step && step.drill) {
        var drillEl = document.createElement('div');
        drillEl.className = 'ct-train-drill';
        var qEl = document.createElement('div');
        qEl.textContent = step.drill.q || '';
        drillEl.appendChild(qEl);
        var answerEl = document.createElement('div');
        answerEl.className = 'ct-train-answer';
        answerEl.style.display = 'none';
        var ansText = step.drill.answer || '';
        if (step.drill.why) ansText += ' — ' + step.drill.why;
        answerEl.textContent = ansText;
        var revealBtn = document.createElement('button');
        revealBtn.type = 'button';
        revealBtn.className = 'ct-reveal';
        revealBtn.textContent = 'Reveal';
        revealBtn.addEventListener('click', function () {
          var showing = answerEl.style.display !== 'none';
          answerEl.style.display = showing ? 'none' : 'block';
          revealBtn.textContent = showing ? 'Reveal' : 'Hide';
        });
        drillEl.appendChild(revealBtn);
        drillEl.appendChild(answerEl);
        stepEl.appendChild(drillEl);
      }
      wrap.appendChild(stepEl);
    });
    if (train && train.closer) {
      var closerEl = document.createElement('div');
      closerEl.className = 'ct-train-closer';
      closerEl.textContent = train.closer;
      wrap.appendChild(closerEl);
    }
    appendResultBlock(wrap);
  }

  /* ── lesson-job queued notice (the full lesson bakes in the background) ── */
  function renderLessonQueuedBlock(slug, status) {
    var wrap = document.createElement('div');
    wrap.className = 'ct-lesson-queued';
    var textEl = document.createElement('div');
    textEl.textContent = slug
      ? ('Lesson queued: ' + slug + (status ? ' (' + status + ')' : ''))
      : 'Lesson queued.';
    wrap.appendChild(textEl);
    var link = document.createElement('a');
    link.href = location.origin + '/library/';
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'ct-lesson-link';
    link.textContent = 'open jobs →';
    wrap.appendChild(link);
    appendResultBlock(wrap);
  }

  /* ── image-lookup widget (🖼 Images dispatch action) ────────────────────
     Search REAL medical images for the selected highlight(s), render a paged
     2×2 grid inline in the chat (sibling of .ct-tested/.ct-sugg — not a
     .ct-bub, needs full width for the grid), let the user ⭐-select the good
     ones, then POST the selection to the corpus. Images are RETRIEVED only,
     never generated. Backend: GET :8912/images?q=&k= · POST /images/keep
     (same-origin, relative — matches the existing /capture pattern). ────── */
  var IMG_PAGE_SIZE = 4;

  function openImagesForSelection() {
    if (!selected.length) return;
    var concept = selected.map(function (h) { return h.text; }).join(' ').trim();
    if (!concept) return;
    openImageWidget(concept);
  }

  function openImageWidget(concept) {
    var wrap = document.createElement('div');
    wrap.className = 'ct-imgwidget';
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
    renderImageLoading(wrap, concept);
    fetch('http://' + location.hostname + ':8912/images?q=' + encodeURIComponent(concept) + '&k=8')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { renderImageResults(wrap, concept, (data && data.images) || []); })
      .catch(function () { renderImageResults(wrap, concept, []); });
  }

  function renderImageLoading(wrap, concept) {
    wrap.innerHTML = '';
    var loadHead = document.createElement('div');
    loadHead.className = 'ct-imgwidget-head';
    var spin = document.createElement('span'); spin.className = 'ct-spin';
    var loadMsg = document.createElement('span');
    loadMsg.className = 'ct-imgwidget-title';
    loadMsg.textContent = '🔎 searching images for ' + concept + '…';
    loadHead.appendChild(spin); loadHead.appendChild(loadMsg);
    wrap.appendChild(loadHead);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function appendImageCloseRow(wrap) {
    var row = document.createElement('div');
    row.className = 'ct-imgsave';
    var imgCloseBtn = document.createElement('button');
    imgCloseBtn.type = 'button'; imgCloseBtn.className = 'ct-imgclose'; imgCloseBtn.textContent = '✕ Close';
    imgCloseBtn.addEventListener('click', function () { wrap.remove(); });
    row.appendChild(imgCloseBtn);
    wrap.appendChild(row);
  }

  function renderImageResults(wrap, concept, images) {
    wrap.innerHTML = '';
    var state = { selectedUrls: {} };

    var resHead = document.createElement('div');
    resHead.className = 'ct-imgwidget-head';
    var titleEl = document.createElement('span');
    titleEl.className = 'ct-imgwidget-title';
    titleEl.textContent = '🖼 ' + concept;
    var countEl = document.createElement('span');
    countEl.className = 'ct-imgwidget-count';
    countEl.textContent = images.length + ' result' + (images.length === 1 ? '' : 's');
    resHead.appendChild(titleEl); resHead.appendChild(countEl);
    wrap.appendChild(resHead);

    if (!images.length) {
      var empty = document.createElement('div');
      empty.className = 'ct-imgwidget-empty';
      empty.textContent = 'No images found.';
      wrap.appendChild(empty);
      appendImageCloseRow(wrap);
      msgs.scrollTop = msgs.scrollHeight;
      return;
    }

    var sub = document.createElement('div');
    sub.className = 'ct-imgwidget-sub';
    sub.textContent = 'real images · pick the ⭐ ones to save';
    wrap.appendChild(sub);

    var grid = document.createElement('div');
    grid.className = 'ct-imggrid';
    wrap.appendChild(grid);

    var pager = document.createElement('div');
    pager.className = 'ct-imgpager';
    wrap.appendChild(pager);

    var footer = document.createElement('div');
    footer.className = 'ct-imgsave';
    var saveBtn = document.createElement('button');
    saveBtn.type = 'button'; saveBtn.className = 'ct-imgsave-btn'; saveBtn.disabled = true;
    saveBtn.textContent = '⭐ Save (0)';
    var imgCloseBtn = document.createElement('button');
    imgCloseBtn.type = 'button'; imgCloseBtn.className = 'ct-imgclose'; imgCloseBtn.textContent = '✕ Close';
    imgCloseBtn.addEventListener('click', function () { wrap.remove(); });
    footer.appendChild(saveBtn); footer.appendChild(imgCloseBtn);
    wrap.appendChild(footer);

    var page = 0;
    var totalPages = Math.ceil(images.length / IMG_PAGE_SIZE);

    function updateSaveBtn() {
      var n = Object.keys(state.selectedUrls).length;
      saveBtn.textContent = '⭐ Save (' + n + ')';
      saveBtn.disabled = n === 0;
    }

    function renderPager() {
      pager.innerHTML = '';
      if (totalPages <= 1) return;
      var prevBtn = document.createElement('button');
      prevBtn.type = 'button'; prevBtn.className = 'ct-imgpager-btn'; prevBtn.textContent = '‹ Prev';
      prevBtn.disabled = page === 0;
      prevBtn.addEventListener('click', function () { page -= 1; renderPage(); });
      var info = document.createElement('span');
      info.className = 'ct-imgpager-info';
      info.textContent = (page + 1) + ' / ' + totalPages;
      var nextBtn = document.createElement('button');
      nextBtn.type = 'button'; nextBtn.className = 'ct-imgpager-btn'; nextBtn.textContent = 'More ▾';
      nextBtn.disabled = page >= totalPages - 1;
      nextBtn.addEventListener('click', function () { page += 1; renderPage(); });
      pager.appendChild(prevBtn); pager.appendChild(info); pager.appendChild(nextBtn);
    }

    function renderPage() {
      grid.innerHTML = '';
      var start = page * IMG_PAGE_SIZE;
      images.slice(start, start + IMG_PAGE_SIZE).forEach(function (im) {
        grid.appendChild(buildImageCell(im, state, updateSaveBtn));
      });
      renderPager();
    }

    saveBtn.addEventListener('click', function () {
      var chosen = images.filter(function (im) { return state.selectedUrls[im.url]; });
      if (!chosen.length) return;
      saveBtn.disabled = true;
      saveBtn.textContent = 'saving…';
      var payloadImages = chosen.map(function (im) {
        return {
          url: im.url,
          concept: concept,
          caption: im.caption || null,
          kind: im.kind || null,
          source_url: im.page_url || im.url,
          source_domain: im.source || null,
          license: im.license || null,
          engine: im.engine || null,
          width: im.width || null,
          height: im.height || null
        };
      });
      fetch('/images/keep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: payloadImages,
          lesson_slug: deriveLessonSlug(),
          section_id: sectionId
        })
      }).then(function (r) {
        if (!r.ok) throw new Error('bad status ' + r.status);
        return r.json();
      }).then(function (data) {
        var kept = (data && data.kept) || [];
        var errs = (data && data.errors) || [];
        footer.innerHTML = '';
        var savedMsg = document.createElement('span');
        savedMsg.className = 'ct-imgsave-msg';
        savedMsg.textContent = '✓ saved ' + kept.length + ' image' + (kept.length === 1 ? '' : 's') + ' → Captures' +
          (errs.length ? (' (' + errs.length + ' failed)') : '');
        var doneCloseBtn = document.createElement('button');
        doneCloseBtn.type = 'button'; doneCloseBtn.className = 'ct-imgclose'; doneCloseBtn.textContent = '✕ Close';
        doneCloseBtn.addEventListener('click', function () { wrap.remove(); });
        footer.appendChild(savedMsg); footer.appendChild(doneCloseBtn);
      }).catch(function () {
        saveBtn.disabled = false;
        updateSaveBtn();
        var errMsg = document.createElement('span');
        errMsg.className = 'ct-imgsave-msg';
        errMsg.textContent = '⚠ save failed — try again';
        footer.insertBefore(errMsg, footer.firstChild);
      });
    });

    renderPage();
    msgs.scrollTop = msgs.scrollHeight;
  }

  function buildImageCell(im, state, onToggle) {
    var cell = document.createElement('div');
    cell.className = 'ct-imgcell';
    var isSel = !!state.selectedUrls[im.url];
    if (isSel) cell.classList.add('sel');

    var img = document.createElement('img');
    img.src = im.thumbnail || im.url;
    img.loading = 'lazy';
    img.alt = im.source || '';
    img.addEventListener('error', function () { cell.classList.add('broken'); });
    cell.appendChild(img);

    var star = document.createElement('button');
    star.type = 'button'; star.className = 'ct-imgcell-star';
    star.textContent = isSel ? '★' : '☆';
    star.setAttribute('aria-label', 'Select this image');
    cell.appendChild(star);

    var cap = document.createElement('div');
    cap.className = 'ct-imgcell-cap';
    var dims = (im.width && im.height) ? (im.width + '×' + im.height) : '';
    cap.textContent = [im.source, dims].filter(Boolean).join(' · ');
    cell.appendChild(cap);

    function toggle() {
      var nowSel = !state.selectedUrls[im.url];
      if (nowSel) state.selectedUrls[im.url] = true; else delete state.selectedUrls[im.url];
      cell.classList.toggle('sel', nowSel);
      star.textContent = nowSel ? '★' : '☆';
      onToggle();
    }
    cell.addEventListener('click', function (e) {
      if (e.target === star) return; // star has its own handler below
      toggle();
    });
    star.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });

    return cell;
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

  // Deterministic LaTeX → Unicode. Lesson/tutor content comes from MANY models, so a prompt can't
  // reliably stop LaTeX — we normalize at render instead. Simple symbols (arrows, α, ×, ≤ …) become
  // real Unicode; genuine math (^ _ \frac …) is rewritten to MathJax's native \(…\)/\[…\] delimiters
  // so the MathJax safety net actually typesets it (v3 does NOT read $…$ by default). $…$ is treated
  // as math ONLY when it contains a real \command, so "$5 and $10" is left untouched.
  var TEX_UNI = {
    rightarrow:'→', to:'→', longrightarrow:'→', Rightarrow:'⇒', implies:'⇒', mapsto:'↦',
    leftarrow:'←', Leftarrow:'⇐', leftrightarrow:'↔', Leftrightarrow:'⇔', iff:'⇔',
    uparrow:'↑', downarrow:'↓', updownarrow:'↕', times:'×', cdot:'·', div:'÷', ast:'∗',
    pm:'±', mp:'∓', leq:'≤', le:'≤', geq:'≥', ge:'≥', neq:'≠', ne:'≠', approx:'≈',
    equiv:'≡', cong:'≅', sim:'∼', simeq:'≃', propto:'∝', ll:'≪', gg:'≫', infty:'∞',
    partial:'∂', nabla:'∇', degree:'°', circ:'∘', bullet:'•', cdots:'⋯', ldots:'…', dots:'…',
    alpha:'α', beta:'β', gamma:'γ', Gamma:'Γ', delta:'δ', Delta:'Δ', epsilon:'ε', varepsilon:'ε',
    zeta:'ζ', eta:'η', theta:'θ', Theta:'Θ', iota:'ι', kappa:'κ', lambda:'λ', Lambda:'Λ',
    mu:'μ', nu:'ν', xi:'ξ', pi:'π', Pi:'Π', rho:'ρ', sigma:'σ', Sigma:'Σ', tau:'τ',
    upsilon:'υ', phi:'φ', varphi:'φ', Phi:'Φ', chi:'χ', psi:'ψ', Psi:'Ψ', omega:'ω', Omega:'Ω',
    prime:'′', pm_:'±', in:'∈', notin:'∉', subset:'⊂', supset:'⊃', cup:'∪', cap:'∩',
    forall:'∀', exists:'∃', emptyset:'∅', angle:'∠', perp:'⊥', parallel:'∥', therefore:'∴', because:'∵'
  };
  // real-math structure. Commands use a (?![a-zA-Z]) boundary so \right does NOT match \rightarrow etc.
  var TEX_COMPLEX = /[\^_]|\\(frac|sqrt|sum|int|prod|lim|begin|matrix|left|right|over|binom|vec|hat)(?![a-zA-Z])/;
  function texCmds(s) {
    return s.replace(/\\([a-zA-Z]+)/g, function (m, name) {
      return Object.prototype.hasOwnProperty.call(TEX_UNI, name) ? TEX_UNI[name] : m;
    });
  }
  function texConv(inner) {   // LaTeX fragment → plain Unicode text (spacing/braces cleaned)
    return texCmds(inner).replace(/\\[,;!:> ]/g, ' ').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
  }
  // ── inline-HTML math (sub/sup/frac/sqrt) — tried BEFORE falling back to
  // MathJax for any "complex" ($\^_$ or \frac etc.) fragment. The tutor
  // sidebar is inline HTML and medical text is full of Na⁺, HCO₃⁻, PaCO₂,
  // cm², dosing fractions — those render fine as plain markup without a
  // MathJax round-trip. Returns null (→ caller falls back to \(…\)/\[…\]
  // for MathJax) for constructs HTML can't do well: \int \sum \prod \lim
  // \begin \matrix \binom \vec \hat, nested/complex \frac, or any
  // unrecognized \command.
  var TEX_HTML_DENY = /\\(int|sum|prod|lim|begin|matrix|binom|vec|hat)(?![a-zA-Z])/;

  function findMatchingBrace(s, openIdx) { // s[openIdx] === '{' — returns index of its matching '}' or -1
    var depth = 0;
    for (var i = openIdx; i < s.length; i++) {
      if (s[i] === '{') depth++;
      else if (s[i] === '}') { depth--; if (depth === 0) return i; }
    }
    return -1;
  }

  function texToHtml(inner) {
    if (TEX_HTML_DENY.test(inner)) return null;
    var out = '', i = 0, n = inner.length, ok = true;
    while (i < n && ok) {
      var ch = inner[i];
      if (ch === '\\') {
        var rest = inner.slice(i);
        var mf = /^\\frac\s*/.exec(rest);
        if (mf) {
          i += mf[0].length;
          if (inner[i] !== '{') { ok = false; break; }
          var closeA = findMatchingBrace(inner, i);
          if (closeA === -1) { ok = false; break; }
          var argA = inner.slice(i + 1, closeA);
          i = closeA + 1;
          while (inner[i] === ' ') i++;
          if (inner[i] !== '{') { ok = false; break; }
          var closeB = findMatchingBrace(inner, i);
          if (closeB === -1) { ok = false; break; }
          var argB = inner.slice(i + 1, closeB);
          i = closeB + 1;
          // nested/complex \frac (another \frac, sup/sub, or a deny-listed construct) → bail to MathJax
          if (/\\frac|[\^_]/.test(argA) || /\\frac|[\^_]/.test(argB) ||
              TEX_HTML_DENY.test(argA) || TEX_HTML_DENY.test(argB)) { ok = false; break; }
          out += '<span class="ct-frac"><span class="ct-frac-n">' + texConv(argA) +
                 '</span><span class="ct-frac-d">' + texConv(argB) + '</span></span>';
          continue;
        }
        var ms = /^\\sqrt\s*/.exec(rest);
        if (ms) {
          i += ms[0].length;
          if (inner[i] !== '{') { ok = false; break; }
          var closeS = findMatchingBrace(inner, i);
          if (closeS === -1) { ok = false; break; }
          var argS = inner.slice(i + 1, closeS);
          i = closeS + 1;
          if (/\\frac|[\^_]/.test(argS) || TEX_HTML_DENY.test(argS)) { ok = false; break; }
          out += '√<span class="ct-sqrt">' + texConv(argS) + '</span>';
          continue;
        }
        var msp = /^\\[,;!:> ]/.exec(rest);
        if (msp) { out += ' '; i += msp[0].length; continue; }
        var mc = /^\\([a-zA-Z]+)/.exec(rest);
        if (mc) {
          if (Object.prototype.hasOwnProperty.call(TEX_UNI, mc[1])) {
            out += TEX_UNI[mc[1]];
            i += mc[0].length;
            continue;
          }
          ok = false; break; // unrecognized \command — let MathJax try
        }
        ok = false; break; // lone backslash we don't understand
      }
      if (ch === '^' || ch === '_') {
        i++;
        var content;
        if (inner[i] === '{') {
          var close = findMatchingBrace(inner, i);
          if (close === -1) { ok = false; break; }
          content = inner.slice(i + 1, close);
          i = close + 1;
        } else if (i < n) {
          content = inner[i]; i++;
        } else { ok = false; break; }
        if (/\\frac|\\sqrt/.test(content) || TEX_HTML_DENY.test(content)) { ok = false; break; }
        out += (ch === '^' ? '<sup>' : '<sub>') + texConv(content) + (ch === '^' ? '</sup>' : '</sub>');
        continue;
      }
      if (ch === '{' || ch === '}') { i++; continue; } // stray grouping braces — drop
      out += ch; i++;
    }
    if (!ok) return null;
    return out.replace(/\s+/g, ' ').trim();
  }

  // wraps a "complex" fragment: try inline-HTML first, else fall back to the MathJax delimiters
  function mathOrHtml(inner, openDelim, closeDelim) {
    var html = texToHtml(inner);
    if (html === null) return openDelim + inner + closeDelim;
    var idx = mathBlocks.length;
    mathBlocks.push(html);
    return '@@MJ' + idx + '@@';
  }

  function latexToUnicode(text) {
    if (!text || text.indexOf('\\') === -1 && text.indexOf('$') === -1) return text;
    // display math $$…$$ and \[…\]
    text = text.replace(/\$\$([\s\S]+?)\$\$/g, function (m, inner) { return TEX_COMPLEX.test(inner) ? mathOrHtml(inner, '\\[', '\\]') : texConv(inner); });
    text = text.replace(/\\\[([\s\S]+?)\\\]/g, function (m, inner) { return TEX_COMPLEX.test(inner) ? mathOrHtml(inner, '\\[', '\\]') : texConv(inner); });
    // inline \(…\) — already MathJax-native; only downgrade to Unicode/HTML when simple/renderable
    text = text.replace(/\\\(([\s\S]+?)\\\)/g, function (m, inner) { return TEX_COMPLEX.test(inner) ? mathOrHtml(inner, '\\(', '\\)') : texConv(inner); });
    // inline $…$ — math ONLY if it holds a real \command OR a bare ^/_ (sub/superscript,
    // e.g. "Na$^+$"), so "$5 and $10" (no backslash, no ^/_) is left untouched
    text = text.replace(/\$([^$\n]*(?:\\[a-zA-Z]|[\^_])[^$\n]*)\$/g, function (m, inner) { return TEX_COMPLEX.test(inner) ? mathOrHtml(inner, '\\(', '\\)') : texConv(inner); });
    // any stray bare \command outside delimiters (e.g. a lone \rightarrow)
    text = texCmds(text);
    return text;
  }

  function mdToHtml(src) {
    if (!src) return '';
    var out = escapeHtml(src);
    mathBlocks = []; // reset per-render (like codeBlocks below)

    // fenced code blocks → placeholders, so later rules can't mangle them
    var codeBlocks = [];
    out = out.replace(/```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/g, function (m, code) {
      var idx = codeBlocks.length;
      codeBlocks.push('<pre><code>' + code.replace(/\n$/, '') + '</code></pre>');
      return '@@CB' + idx + '@@';
    });

    out = latexToUnicode(out);   // normalize LaTeX (code already extracted above): simple → Unicode, complex → MathJax delims

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
    result = result.replace(/@@MJ(\d+)@@/g, function (m, idx) { return mathBlocks[idx]; });
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

  /* ── chat persistence (per-lesson localStorage; capped, never throws) ── */
  function saveChat() {
    try {
      var key = LS_CHAT + deriveLessonSlug();
      var trimmed = messages.slice(-CHAT_MAX_ENTRIES);
      var json = JSON.stringify(trimmed);
      while (json.length > CHAT_MAX_BYTES && trimmed.length > 1) {
        trimmed = trimmed.slice(1);
        json = JSON.stringify(trimmed);
      }
      if (json.length > CHAT_MAX_BYTES) return; // a single giant turn — skip rather than throw
      localStorage.setItem(key, json);
    } catch (e) { /* quota / serialization failure — never break the tutor */ }
  }

  function restoreChat() {
    try {
      var key = LS_CHAT + deriveLessonSlug();
      var raw = localStorage.getItem(key);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (!saved || !saved.length) return;
      messages = saved;
      var pendingQuestion = null;
      saved.forEach(function (m) {
        if (!m || !m.role) return;
        if (m.role === 'user') {
          appendBubble('user', m.content);
          pendingQuestion = m.content;
          lastQuestion = m.content;
        } else if (m.role === 'assistant') {
          var b = appendBubble('assistant', m.content);
          attachAnswerStar(b, m.content, pendingQuestion);
        }
      });
      msgs.scrollTop = msgs.scrollHeight;
    } catch (e) { /* corrupted storage — start fresh, never throw */ }
  }

  /* ── ⭐ capture (feeds the corpus store) ──────────────────────────── */
  function extractHandle(text) {
    if (!text) return '';
    var lines = String(text).split('\n');
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].trim();
      if (!l) continue;
      var h = /^#{1,4}\s+(.*)$/.exec(l);
      if (h) return h[1].slice(0, 120);
      var s = /^(.*?[.!?])(\s|$)/.exec(l);
      return (s ? s[1] : l).slice(0, 120);
    }
    return String(text).slice(0, 120);
  }

  function lastQA() {
    var q = null, a = null;
    for (var i = messages.length - 1; i >= 0 && (q === null || a === null); i--) {
      if (q === null && messages[i].role === 'user') q = messages[i].content;
      if (a === null && messages[i].role === 'assistant') a = messages[i].content;
    }
    return { question: q, answer: a };
  }

  function postCapture(payload, onOk, onFail) {
    fetch('/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) throw new Error('bad status ' + r.status);
      return r.json();
    }).then(function (data) { onOk(data); })
      .catch(function (e) { onFail(e); });
  }

  function attachAnswerStar(bubEl, replyText, questionText) {
    var starBtn = document.createElement('button');
    starBtn.type = 'button';
    starBtn.className = 'ct-star';
    starBtn.title = 'Save this answer to your captures';
    starBtn.setAttribute('aria-label', 'Save this answer');
    starBtn.textContent = '☆';
    starBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (starBtn.disabled) return;
      starBtn.disabled = true;
      var payload = {
        kind: 'answer',
        text: extractHandle(replyText),
        question: questionText || null,
        source_answer: replyText,
        surrounding_text: sectionText,
        lesson_slug: deriveLessonSlug(),
        section_id: sectionId,
        concept: null,
        model: modelSel ? modelSel.value : null,
        source: 'tutor'
      };
      postCapture(payload, function () {
        starBtn.textContent = '★';
        starBtn.classList.add('saved');
        starBtn.title = 'Saved to your captures';
      }, function () {
        starBtn.disabled = false;
        starBtn.title = 'Save failed — try again';
      });
    });
    bubEl.appendChild(starBtn);
    return starBtn;
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
    attachAnswerStar(loadingBub, reply, lastQuestion);
    renderSuggestions(suggestOn && data ? data.suggestions : null);
    fetchTestedQuestions(collectTestedConcepts());
    msgs.scrollTop = msgs.scrollHeight;
    saveChat();
  }

  function failReply(loadingBub, statusRefs) {
    stopFiller(statusRefs);
    loadingBub.classList.remove('ct-loading');
    loadingBub.textContent = '⚠ Tutor service offline — start it on :8912 (host-side). Your highlights are saved.';
    msgs.scrollTop = msgs.scrollHeight;
    saveChat();
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
    lastQuestion = text;
    appendBubble('user', text);
    saveChat();
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
