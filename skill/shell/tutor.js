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
  var FALLBACK_MODELS = [
    { id: 'gemma4', label: 'Gemma 4 · cloud (fast)' },
    { id: 'gemini3', label: 'Gemini 3 Flash · cloud' },
    { id: 'qwen_local', label: 'Qwen3 32B · Mac (local)' },
    { id: 'agent', label: 'Deep agent (Harrison’s, slower)' }
  ];

  var messages = [];   // { role: 'user'|'assistant', content }
  var highlights = []; // { num, mark, sup, text }
  var hlCounter = 0;
  var sectionId = null;
  var sectionText = '';

  var tab, scrim, drawer, head, badge, title, modelSel, modeBtn, penBtn, closeBtn,
      scope, chips, msgs, inputRow, textarea, sendBtn, tabPen, resizeHandle;
  var mode = 'med';

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
    closeBtn = document.createElement('button');
    closeBtn.type = 'button'; closeBtn.className = 'ct-close'; closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '✕';
    head.appendChild(badge); head.appendChild(title); head.appendChild(modelSel);
    head.appendChild(modeBtn); head.appendChild(penBtn); head.appendChild(closeBtn);

    scope = document.createElement('div'); scope.className = 'ct-scope';
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
    drawer.appendChild(scope);
    drawer.appendChild(chips);
    drawer.appendChild(msgs);
    drawer.appendChild(inputRow);
    document.body.appendChild(drawer);

    /* ── model list + persisted mode ──────────────────────────────── */
    loadModels();
    try { mode = localStorage.getItem(LS_MODE) || 'med'; } catch (e) {}
    renderMode();

    modelSel.addEventListener('change', function () {
      try { localStorage.setItem(LS_MODEL, modelSel.value); } catch (e) {}
    });
    modeBtn.addEventListener('click', function () {
      mode = mode === 'ita' ? 'med' : 'ita';
      try { localStorage.setItem(LS_MODE, mode); } catch (e) {}
      renderMode();
    });

    /* ── open / close ─────────────────────────────────────────────── */
    tab.addEventListener('click', function () {
      if (drawer.classList.contains('open')) closeDrawer(); else openDrawer();
    });
    closeBtn.addEventListener('click', closeDrawer);
    scrim.addEventListener('click', closeDrawer);

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
    updateScope();
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
    if (!el) { scope.textContent = ''; sectionId = null; sectionText = ''; return; }
    var h = el.querySelector('h1,h2,h3,[data-section-title]');
    var label = (h && h.textContent.trim()) || el.id || 'Section';
    scope.textContent = '📌 On: ' + label; // 📌 On: ...
    sectionId = el.id || null;
    sectionText = (el.textContent || '').trim().slice(0, 4000);
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

  /* ── chat ──────────────────────────────────────────────────────── */
  function appendBubble(role, text) {
    var b = document.createElement('div');
    b.className = 'ct-bub ' + (role === 'user' ? 'u' : 'a');
    if (role === 'assistant') b.innerHTML = mdToHtml(text);
    else b.textContent = text;
    msgs.appendChild(b);
    msgs.scrollTop = msgs.scrollHeight;
    return b;
  }

  function send() {
    var text = textarea.value.trim();
    if (!text) return;
    textarea.value = '';
    textarea.style.height = 'auto';
    messages.push({ role: 'user', content: text });
    appendBubble('user', text);
    var loadingBub = appendBubble('assistant', '…');

    var payload = {
      lesson_slug: deriveLessonSlug(),
      section_id: sectionId,
      section_text: sectionText,
      selection: highlights.map(function (h) { return h.text; }).join(' | '),
      messages: messages.slice(),
      model: modelSel.value,
      mode: mode,
      lang: mode === 'ita' ? 'it' : 'en'
    };

    fetch('http://' + location.hostname + ':8912/tutor-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) throw new Error('bad status ' + r.status);
      return r.json();
    }).then(function (data) {
      var reply = (data && data.reply) || '(no reply)';
      loadingBub.innerHTML = mdToHtml(reply);
      if (data && data.grounded) {
        var g = document.createElement('span');
        g.className = 'ct-grounded';
        g.textContent = typeof data.grounded === 'string' ? data.grounded : '✓ grounded';
        loadingBub.appendChild(g);
      }
      messages.push({ role: 'assistant', content: reply });
      msgs.scrollTop = msgs.scrollHeight;
    }).catch(function () {
      loadingBub.textContent = '⚠ Tutor service offline — start it on :8912 (host-side). Your highlights are saved.';
      msgs.scrollTop = msgs.scrollHeight;
    });
  }

  function init() {
    build();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
