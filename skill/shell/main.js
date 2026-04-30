/**
 * CODEBASE-TO-COURSE — COMPLETE JS ENGINE
 * Copy this file verbatim into the course output directory.
 * Never regenerate it. It handles all interactivity generically.
 *
 * Engines included:
 *  - Navigation & progress bar
 *  - Scroll-triggered reveal animations
 *  - Keyboard navigation
 *  - Glossary tooltips
 *  - Quiz (multiple-choice & scenario)
 *  - Drag-and-drop matching
 *  - Group chat animation
 *  - Data flow / message flow animation
 *  - Architecture diagram
 *  - "Spot the bug" challenge
 *  - Layer toggle
 */
// FR-005 / FR-026 — scroll-position restore (v1 uses localStorage; .chiron-state.db is for CLI analytics only)
(function () {
  'use strict';

  /* ── HELPERS ──────────────────────────────────────────────── */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

  /* ── BOOKMARKS / SCROLL-POSITION RESTORE (FR-005 / FR-026) ── */
  (function setupBookmarks() {
    const META = document.querySelector('meta[name="chiron-lesson-id"]');
    const lessonId = (META && META.getAttribute('content')) || document.title || 'unknown';
    const STORAGE_KEY = 'chiron:lesson:' + lessonId + ':bookmarks';
    const MAX_ENTRIES = 20;
    const DEBOUNCE_MS = 500;

    function readBookmarks() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    }

    function writeBookmarks(arr) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(arr.slice(0, MAX_ENTRIES)));
      } catch (e) {
        /* quota or disabled — silently ignore */
      }
    }

    function currentChapterId() {
      const probe = document.elementFromPoint(window.innerWidth / 2, 100);
      let el = probe;
      while (el && el !== document.body) {
        if (el.dataset && el.dataset.chapterId) return el.dataset.chapterId;
        el = el.parentElement;
      }
      return null;
    }

    // Restore: pick the most recent bookmark and scroll to it after layout settles.
    function restore() {
      const bookmarks = readBookmarks();
      if (!bookmarks.length) return;
      const sorted = bookmarks.slice().sort((a, b) => (b.last_visited_at || 0) - (a.last_visited_at || 0));
      const top = sorted[0];
      if (!top || typeof top.scroll_position !== 'number') return;
      // Wait for layout (fonts, images, MathJax, Mermaid) before scrolling.
      window.addEventListener('load', () => {
        requestAnimationFrame(() => {
          window.scrollTo({ top: top.scroll_position, behavior: 'auto' });
        });
      });
    }

    let pendingTimer = null;
    let pendingEntry = null;
    // T119 — track current chapter for boundary-crossing detection
    let currentChapter = null;

    function flush() {
      if (!pendingEntry) return;
      const bookmarks = readBookmarks();
      const idx = bookmarks.findIndex(b => b.chapter_id === pendingEntry.chapter_id);
      if (idx >= 0) bookmarks[idx] = pendingEntry;
      else bookmarks.push(pendingEntry);
      // Sort newest first; cap at MAX_ENTRIES.
      bookmarks.sort((a, b) => (b.last_visited_at || 0) - (a.last_visited_at || 0));
      writeBookmarks(bookmarks);
      pendingEntry = null;
      pendingTimer = null;
    }

    // T119 — immediate (non-debounced) write of a specific entry; used at chapter boundaries.
    function writeImmediate(entry) {
      if (!entry || !entry.chapter_id) return;
      const bookmarks = readBookmarks();
      const idx = bookmarks.findIndex(b => b.chapter_id === entry.chapter_id);
      if (idx >= 0) bookmarks[idx] = entry;
      else bookmarks.push(entry);
      bookmarks.sort((a, b) => (b.last_visited_at || 0) - (a.last_visited_at || 0));
      writeBookmarks(bookmarks);
    }

    function onScroll() {
      const chapterId = currentChapterId();
      if (!chapterId) return;

      // T119 — chapter-switch detection: fires immediately, bypasses debounce
      if (currentChapter !== null && chapterId !== currentChapter) {
        const fromChapter = currentChapter;
        // Cancel any pending debounced write for the OLD chapter
        if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
        // Capture the old chapter's last-known scroll position immediately.
        // Prefer the pendingEntry if it's for the old chapter (most recent); else synthesize.
        const oldEntry = (pendingEntry && pendingEntry.chapter_id === fromChapter)
          ? pendingEntry
          : { chapter_id: fromChapter, scroll_position: window.scrollY, last_visited_at: Date.now() };
        writeImmediate(oldEntry);
        pendingEntry = null;
        // Notify other listeners (e.g., chapter-completion checker from T117)
        try {
          document.dispatchEvent(new CustomEvent('chiron:chapter-switched', {
            detail: { from: fromChapter, to: chapterId }
          }));
        } catch (e) { /* CustomEvent unavailable — silently ignore */ }
      }
      currentChapter = chapterId;

      pendingEntry = {
        chapter_id: chapterId,
        scroll_position: window.scrollY,
        last_visited_at: Date.now()
      };
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(flush, DEBOUNCE_MS);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('beforeunload', () => {
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      flush();
    });

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', restore);
    } else {
      restore();
    }
  })();

  /* ── CHAPTER COMPLETION TRACKING ──────────────────────────── */
  // FR-005 / spec.md — chapter-completion tracking via localStorage; TOC checkmarks update on scroll-debounced check
  (function setupChapterCompletion() {
    const META = document.querySelector('meta[name="chiron-lesson-id"]');
    const lessonId = (META && META.getAttribute('content')) || document.title || 'unknown';
    const STORAGE_KEY = 'chiron:lesson:' + lessonId + ':completion';
    const DEBOUNCE_MS = 500;
    const SCROLL_THRESHOLD = 90;
    const QUIZ_THRESHOLD = 0.5;

    function readCompletion() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object') ? parsed : {};
      } catch (e) {
        return {};
      }
    }

    function writeCompletion(obj) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
      } catch (e) {
        /* quota or disabled — silently ignore */
      }
    }

    function currentChapterId() {
      const probe = document.elementFromPoint(window.innerWidth / 2, 100);
      let el = probe;
      while (el && el !== document.body) {
        if (el.dataset && el.dataset.chapterId) return el.dataset.chapterId;
        el = el.parentElement;
      }
      return null;
    }

    function chapterEl(chapterId) {
      return document.querySelector('[data-chapter-id="' + chapterId + '"]:not(nav.toc *)') ||
             document.querySelector('[data-chapter-id="' + chapterId + '"]');
    }

    function computeScrollPercent(el) {
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      if (rect.bottom <= vh + 50) return 100;
      const total = rect.height;
      if (total <= 0) return 0;
      const scrolled = Math.max(0, vh - rect.top);
      return Math.min(100, Math.max(0, (scrolled / total) * 100));
    }

    function countQuizzes(el) {
      if (!el) return { attempted: 0, total: 0 };
      const quizzes = el.querySelectorAll('[data-quiz-id]');
      let attempted = 0;
      quizzes.forEach(q => { if (q.classList.contains('check-completed')) attempted++; });
      return { attempted: attempted, total: quizzes.length };
    }

    function markTocCompleted(chapterId) {
      const entries = document.querySelectorAll('nav.toc [data-chapter-id="' + chapterId + '"]');
      entries.forEach(entry => {
        entry.classList.add('completed');
        if (!entry.querySelector('.completion-check')) {
          const span = document.createElement('span');
          span.className = 'completion-check';
          span.setAttribute('aria-label', 'Completed');
          span.textContent = '✓';
          entry.appendChild(span);
        }
      });
    }

    function evaluateChapter(chapterId) {
      if (!chapterId) return;
      const el = chapterEl(chapterId);
      if (!el) return;
      const data = readCompletion();
      const scrollPercent = computeScrollPercent(el);
      const { attempted, total } = countQuizzes(el);
      const quizRatio = total > 0 ? (attempted / total) : 1; // chapters with no quizzes pass on scroll alone
      const existing = data[chapterId] || {};
      const updated = {
        completedAt: existing.completedAt || null,
        scrollPercent: Math.max(existing.scrollPercent || 0, Math.round(scrollPercent)),
        quizzesAttempted: attempted,
        totalQuizzes: total
      };
      const meetsCriteria = updated.scrollPercent >= SCROLL_THRESHOLD && quizRatio >= QUIZ_THRESHOLD;
      const wasCompleted = !!existing.completedAt;
      if (meetsCriteria && !wasCompleted) {
        updated.completedAt = Date.now();
        data[chapterId] = updated;
        writeCompletion(data);
        markTocCompleted(chapterId);
      } else if (existing.scrollPercent !== updated.scrollPercent ||
                 existing.quizzesAttempted !== updated.quizzesAttempted ||
                 existing.totalQuizzes !== updated.totalQuizzes) {
        data[chapterId] = updated;
        writeCompletion(data);
      }
    }

    let pendingTimer = null;
    function onScroll() {
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        evaluateChapter(currentChapterId());
      }, DEBOUNCE_MS);
    }

    // Forward-compat: widget renderers may emit this when their Check button is pressed.
    document.addEventListener('chiron:widget-checked', e => {
      const detail = (e && e.detail) || {};
      const quizId = detail.quizId;
      if (quizId) {
        const quizEl = document.querySelector('[data-quiz-id="' + quizId + '"]');
        if (quizEl) quizEl.classList.add('check-completed');
      }
      evaluateChapter(currentChapterId());
    });

    window.addEventListener('scroll', onScroll, { passive: true });

    function applyInitial() {
      const data = readCompletion();
      Object.keys(data).forEach(chapterId => {
        if (data[chapterId] && data[chapterId].completedAt) {
          markTocCompleted(chapterId);
        }
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyInitial);
    } else {
      applyInitial();
    }
  })();

  /* ── SR REVIEW SURFACE ────────────────────────────────────── */
  // FR-005 — in-lesson SR review surface; Option A persistence (localStorage; SQLite is for CLI analytics only)
  (function setupSrReview() {
    const META = document.querySelector('meta[name="chiron-lesson-id"]');
    const lessonId = (META && META.getAttribute('content')) || document.title || 'unknown';
    const CARDS_KEY = 'chiron:lesson:' + lessonId + ':sr-cards';
    const LOG_KEY = 'chiron:lesson:' + lessonId + ':sr-review-log';
    const MAX_LOG_ENTRIES = 1000;
    const MAX_SESSION_CARDS = 20;

    function readCards() {
      try {
        const raw = localStorage.getItem(CARDS_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : null;
      } catch (e) { return null; }
    }

    function writeCards(arr) {
      try { localStorage.setItem(CARDS_KEY, JSON.stringify(arr)); } catch (e) {}
    }

    function readLog() {
      try {
        const raw = localStorage.getItem(LOG_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) { return []; }
    }

    function appendLog(entry) {
      const log = readLog();
      log.push(entry);
      // FIFO eviction
      const trimmed = log.length > MAX_LOG_ENTRIES ? log.slice(log.length - MAX_LOG_ENTRIES) : log;
      try { localStorage.setItem(LOG_KEY, JSON.stringify(trimmed)); } catch (e) {}
    }

    function seedFromDom() {
      const seed = document.getElementById('sr-cards-seed');
      if (!seed) return [];
      try {
        const parsed = JSON.parse(seed.textContent || '[]');
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) { return []; }
    }

    // Inline SM-2 (matches lib/sr-scheduler.ts semantics)
    function nextDueSm2(card, rating) {
      let ease_factor = card.ease_factor || 2.5;
      let interval_days = card.interval_days || 0;
      let repetitions = card.repetitions || 0;
      const MIN_EASE = 1.3;
      if (rating === 1) {
        repetitions = 0;
        interval_days = 1;
        ease_factor = Math.max(MIN_EASE, ease_factor - 0.2);
      } else {
        const q = rating === 2 ? 3 : rating === 3 ? 4 : 5;
        ease_factor = Math.max(MIN_EASE, ease_factor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
        repetitions += 1;
        if (repetitions === 1) interval_days = 1;
        else if (repetitions === 2) interval_days = 6;
        else interval_days = Math.round(interval_days * ease_factor);
        if (rating === 4) {
          interval_days = Math.max(interval_days, Math.round(interval_days * 1.3));
        }
      }
      const next_due_at = Date.now() + interval_days * 86400000;
      return { ease_factor: ease_factor, interval_days: interval_days, repetitions: repetitions, next_due_at: next_due_at };
    }

    function ensureSeeded() {
      let cards = readCards();
      if (cards) return cards;
      const seeded = seedFromDom();
      writeCards(seeded);
      return seeded;
    }

    function dueCards(cards) {
      const now = Date.now();
      return cards
        .filter(c => c && c.suspended !== 1 && c.suspended !== true && (c.next_due_at || 0) <= now)
        .slice(0, MAX_SESSION_CARDS);
    }

    function findHostBeforeMain() {
      const main = document.querySelector('main') || document.body;
      return main;
    }

    function buildPanel(dueCount) {
      const panel = document.createElement('aside');
      panel.className = 'sr-review-panel';
      panel.setAttribute('aria-label', 'Spaced repetition review');
      panel.hidden = dueCount === 0;
      panel.innerHTML = ''
        + '<div class="sr-review-summary">'
        + '  <button type="button" class="sr-review-toggle">Review <span class="sr-due-count">' + dueCount + '</span> due cards</button>'
        + '  <span class="sr-session-progress" hidden></span>'
        + '</div>'
        + '<div class="sr-review-body" hidden>'
        + '  <div class="sr-card-front" aria-live="polite"></div>'
        + '  <button type="button" class="sr-show-answer">Show answer</button>'
        + '  <div class="sr-card-back" hidden></div>'
        + '  <div class="sr-rating-buttons" hidden>'
        + '    <button type="button" class="sr-rating" data-rating="1">Again</button>'
        + '    <button type="button" class="sr-rating" data-rating="2">Hard</button>'
        + '    <button type="button" class="sr-rating" data-rating="3">Good</button>'
        + '    <button type="button" class="sr-rating" data-rating="4">Easy</button>'
        + '  </div>'
        + '  <div class="sr-done" hidden></div>'
        + '</div>';
      return panel;
    }

    function init() {
      const cards = ensureSeeded();
      let queue = dueCards(cards);
      const host = findHostBeforeMain();
      const panel = buildPanel(queue.length);
      host.insertBefore(panel, host.firstChild);

      if (queue.length === 0) return;

      const toggleBtn = panel.querySelector('.sr-review-toggle');
      const body = panel.querySelector('.sr-review-body');
      const frontEl = panel.querySelector('.sr-card-front');
      const backEl = panel.querySelector('.sr-card-back');
      const showBtn = panel.querySelector('.sr-show-answer');
      const ratingWrap = panel.querySelector('.sr-rating-buttons');
      const doneEl = panel.querySelector('.sr-done');
      const progressEl = panel.querySelector('.sr-session-progress');
      const dueCountEl = panel.querySelector('.sr-due-count');

      let idx = 0;
      let reviewedThisSession = 0;

      function renderCurrent() {
        if (idx >= queue.length) {
          frontEl.hidden = true;
          showBtn.hidden = true;
          backEl.hidden = true;
          ratingWrap.hidden = true;
          doneEl.hidden = false;
          doneEl.textContent = 'All caught up — ' + reviewedThisSession + ' review' + (reviewedThisSession === 1 ? '' : 's') + ' complete this session';
          dueCountEl.textContent = '0';
          return;
        }
        const card = queue[idx];
        frontEl.hidden = false;
        frontEl.textContent = card.front || '';
        backEl.hidden = true;
        backEl.textContent = card.back || '';
        showBtn.hidden = false;
        showBtn.disabled = false;
        ratingWrap.hidden = true;
        doneEl.hidden = true;
        progressEl.hidden = false;
        progressEl.textContent = (idx + 1) + ' / ' + queue.length;
      }

      toggleBtn.addEventListener('click', () => {
        const collapsed = body.hidden;
        body.hidden = !collapsed;
        if (collapsed) renderCurrent();
      });

      showBtn.addEventListener('click', () => {
        backEl.hidden = false;
        showBtn.disabled = true;
        ratingWrap.hidden = false;
      });

      panel.querySelectorAll('.sr-rating').forEach(btn => {
        btn.addEventListener('click', () => {
          const rating = parseInt(btn.getAttribute('data-rating'), 10);
          if (!(rating >= 1 && rating <= 4)) return;
          const card = queue[idx];
          if (!card) return;
          const priorEase = card.ease_factor || 2.5;
          const priorInterval = card.interval_days || 0;
          const updated = nextDueSm2(card, rating);
          const merged = Object.assign({}, card, updated);

          // Update working state in localStorage (replace by card_id)
          const all = readCards() || [];
          const matchIdx = all.findIndex(c => c && c.card_id === card.card_id);
          if (matchIdx >= 0) all[matchIdx] = merged;
          else all.push(merged);
          writeCards(all);

          appendLog({
            card_id: card.card_id,
            rating: rating,
            prior_ease: priorEase,
            new_ease: updated.ease_factor,
            prior_interval: priorInterval,
            new_interval: updated.interval_days,
            reviewed_at: Date.now()
          });

          reviewedThisSession += 1;
          idx += 1;
          // Update header due count (remaining)
          const remaining = Math.max(0, queue.length - idx);
          dueCountEl.textContent = String(remaining);
          renderCurrent();
        });
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  })();

  /* ── NAVIGATION & PROGRESS BAR ────────────────────────────── */
  const progressBar = $('#progress-bar');
  const navDots     = $$('.nav-dot');
  const modules     = $$('.module');

  function updateProgress() {
    if (!progressBar) return;
    const scrollTop    = window.scrollY;
    const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
    const pct          = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
    progressBar.style.width = pct + '%';
    progressBar.setAttribute('aria-valuenow', Math.round(pct));
    updateNavDots();
  }

  function updateNavDots() {
    const scrollMid = window.scrollY + window.innerHeight / 2;
    modules.forEach((mod, i) => {
      const dot = navDots[i];
      if (!dot) return;
      const top    = mod.offsetTop;
      const bottom = top + mod.offsetHeight;
      if (scrollMid >= top && scrollMid < bottom) {
        dot.classList.add('active');
        dot.classList.remove('visited');
      } else if (window.scrollY + window.innerHeight > top) {
        dot.classList.remove('active');
        dot.classList.add('visited');
      } else {
        dot.classList.remove('active', 'visited');
      }
    });
  }

  window.addEventListener('scroll', () => requestAnimationFrame(updateProgress), { passive: true });
  updateProgress();

  // Nav dot click → scroll to module
  navDots.forEach(dot => {
    dot.addEventListener('click', () => {
      const target = $('#' + dot.dataset.target);
      if (target) target.scrollIntoView({ behavior: 'smooth' });
    });
  });

  /* ── KEYBOARD NAVIGATION ───────────────────────────────────── */
  function currentModuleIndex() {
    const scrollMid = window.scrollY + window.innerHeight / 2;
    for (let i = 0; i < modules.length; i++) {
      const top    = modules[i].offsetTop;
      const bottom = top + modules[i].offsetHeight;
      if (scrollMid >= top && scrollMid < bottom) return i;
    }
    return 0;
  }

  document.addEventListener('keydown', e => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      const next = modules[currentModuleIndex() + 1];
      if (next) { next.scrollIntoView({ behavior: 'smooth' }); e.preventDefault(); }
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      const prev = modules[currentModuleIndex() - 1];
      if (prev) { prev.scrollIntoView({ behavior: 'smooth' }); e.preventDefault(); }
    }
  });

  /* ── SCROLL-TRIGGERED REVEAL ───────────────────────────────── */
  const revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

  $$('.animate-in').forEach(el => revealObserver.observe(el));

  // Stagger children
  $$('.stagger-children').forEach(parent => {
    Array.from(parent.children).forEach((child, i) => {
      child.style.setProperty('--stagger-index', i);
    });
  });

  /* ── GLOSSARY TOOLTIPS ─────────────────────────────────────── */
  let activeTooltip = null;

  function positionTooltip(term, tip) {
    const rect     = term.getBoundingClientRect();
    const tipWidth = Math.min(320, Math.max(200, window.innerWidth * 0.8));
    let left = rect.left + rect.width / 2 - tipWidth / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tipWidth - 8));
    tip.style.left  = left + 'px';
    tip.style.width = tipWidth + 'px';
    document.body.appendChild(tip);
    const tipHeight = tip.offsetHeight;
    if (rect.top - tipHeight - 12 < 0) {
      tip.style.top = (rect.bottom + 8) + 'px';
      tip.classList.add('flip');
    } else {
      tip.style.top = (rect.top - tipHeight - 8) + 'px';
      tip.classList.remove('flip');
    }
  }

  function showTooltip(term, tip) {
    if (activeTooltip && activeTooltip !== tip) {
      activeTooltip.classList.remove('visible');
      activeTooltip.remove();
    }
    positionTooltip(term, tip);
    requestAnimationFrame(() => tip.classList.add('visible'));
    activeTooltip = tip;
  }

  function hideTooltip(tip) {
    tip.classList.remove('visible');
    setTimeout(() => { if (!tip.classList.contains('visible')) tip.remove(); }, 150);
    if (activeTooltip === tip) activeTooltip = null;
  }

  $$('.term').forEach(term => {
    const tip = document.createElement('span');
    tip.className = 'term-tooltip';
    tip.textContent = term.dataset.definition;

    term.addEventListener('mouseenter', () => showTooltip(term, tip));
    term.addEventListener('mouseleave', () => hideTooltip(tip));
    term.addEventListener('click', e => {
      e.stopPropagation();
      tip.classList.contains('visible') ? hideTooltip(tip) : showTooltip(term, tip);
    });
  });

  document.addEventListener('click', () => {
    if (activeTooltip) { activeTooltip.classList.remove('visible'); activeTooltip.remove(); activeTooltip = null; }
  });

  /* ── QUIZ ENGINE ───────────────────────────────────────────── */
  window.selectOption = function (btn) {
    const block = btn.closest('.quiz-question-block');
    $$('.quiz-option', block).forEach(o => o.classList.remove('selected'));
    btn.classList.add('selected');
  };

  window.checkQuiz = function (containerId) {
    const container = $('#' + containerId);
    if (!container) return;
    $$('.quiz-question-block', container).forEach(q => {
      const selected  = $('.quiz-option.selected', q);
      const feedback  = $('.quiz-feedback', q);
      const correct   = q.dataset.correct;
      const rightExp  = q.dataset.explanationRight  || '';
      const wrongExp  = q.dataset.explanationWrong  || '';

      if (!selected) {
        feedback.textContent = 'Pick an answer first!';
        feedback.className = 'quiz-feedback show warning';
        return;
      }
      $$('.quiz-option', q).forEach(o => o.disabled = true);

      if (selected.dataset.value === correct) {
        selected.classList.add('correct');
        feedback.innerHTML = '<strong>Exactly!</strong> ' + rightExp;
        feedback.className = 'quiz-feedback show success';
      } else {
        selected.classList.add('incorrect');
        const correctBtn = $(`.quiz-option[data-value="${correct}"]`, q);
        if (correctBtn) correctBtn.classList.add('correct');
        feedback.innerHTML = '<strong>Not quite.</strong> ' + wrongExp;
        feedback.className = 'quiz-feedback show error';
      }
    });
  };

  window.resetQuiz = function (containerId) {
    const container = $('#' + containerId);
    if (!container) return;
    $$('.quiz-option', container).forEach(o => {
      o.classList.remove('selected', 'correct', 'incorrect');
      o.disabled = false;
    });
    $$('.quiz-feedback', container).forEach(f => { f.className = 'quiz-feedback'; f.textContent = ''; });
  };

  /* ── DRAG-AND-DROP ENGINE ──────────────────────────────────── */
  function initDnD(containerEl) {
    if (!containerEl) return;
    const chips = $$('.dnd-chip', containerEl);
    const zones = $$('.dnd-zone', containerEl);

    // Mouse (HTML5 Drag API)
    chips.forEach(chip => {
      chip.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', chip.dataset.answer);
        chip.classList.add('dragging');
      });
      chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
    });

    zones.forEach(zone => {
      const target = $('.dnd-zone-target', zone);
      if (!target) return;
      target.addEventListener('dragover',  e => { e.preventDefault(); target.classList.add('drag-over'); });
      target.addEventListener('dragleave', ()  => target.classList.remove('drag-over'));
      target.addEventListener('drop', e => {
        e.preventDefault();
        target.classList.remove('drag-over');
        const answer = e.dataTransfer.getData('text/plain');
        const chip   = $(`.dnd-chip[data-answer="${answer}"]`, containerEl);
        if (!chip) return;
        target.textContent    = chip.textContent;
        target.dataset.placed = answer;
        chip.classList.add('placed');
      });
    });

    // Touch
    chips.forEach(chip => {
      chip.addEventListener('touchstart', e => {
        e.preventDefault();
        const touch = e.touches[0];
        const ghost = chip.cloneNode(true);
        ghost.classList.add('touch-ghost');
        ghost.style.cssText = `position:fixed;z-index:9999;pointer-events:none;left:${touch.clientX - 40}px;top:${touch.clientY - 20}px;`;
        document.body.appendChild(ghost);
        chip._ghost  = ghost;
        chip._answer = chip.dataset.answer;
      }, { passive: false });

      chip.addEventListener('touchmove', e => {
        e.preventDefault();
        const touch = e.touches[0];
        if (chip._ghost) {
          chip._ghost.style.left = (touch.clientX - 40) + 'px';
          chip._ghost.style.top  = (touch.clientY - 20) + 'px';
        }
        zones.forEach(z => { const t = $('.dnd-zone-target', z); if (t) t.classList.remove('drag-over'); });
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        const zt = el && el.closest('.dnd-zone-target');
        if (zt) zt.classList.add('drag-over');
      }, { passive: false });

      chip.addEventListener('touchend', e => {
        if (chip._ghost) { chip._ghost.remove(); chip._ghost = null; }
        const touch = e.changedTouches[0];
        const el    = document.elementFromPoint(touch.clientX, touch.clientY);
        const zt    = el && el.closest('.dnd-zone-target');
        if (zt) {
          zt.textContent    = chip.textContent;
          zt.dataset.placed = chip._answer;
          chip.classList.add('placed');
        }
        zones.forEach(z => { const t = $('.dnd-zone-target', z); if (t) t.classList.remove('drag-over'); });
      });
    });
  }

  window.checkDnD = function (containerId) {
    const container = $('#' + containerId);
    if (!container) return;
    $$('.dnd-zone', container).forEach(zone => {
      const target  = $('.dnd-zone-target', zone);
      if (!target || !target.dataset.placed) return;
      if (target.dataset.placed === zone.dataset.correct) {
        target.classList.add('correct-placed');
      } else {
        target.classList.add('incorrect-placed');
      }
    });
  };

  window.resetDnD = function (containerId) {
    const container = $('#' + containerId);
    if (!container) return;
    $$('.dnd-zone-target', container).forEach(t => {
      t.textContent = 'Drop here';
      delete t.dataset.placed;
      t.classList.remove('correct-placed', 'incorrect-placed');
    });
    $$('.dnd-chip', container).forEach(c => c.classList.remove('placed', 'dragging'));
  };

  // Auto-init all dnd containers
  $$('.dnd-container').forEach(el => initDnD(el));

  /* ── GROUP CHAT ENGINE ─────────────────────────────────────── */
  function initChat(containerEl) {
    if (!containerEl) return;
    const messages    = $$('.chat-message', containerEl);
    const typingEl    = $('.chat-typing', containerEl);
    const typingAvEl  = $('#' + containerEl.id + '-typing-avatar') || $('.chat-avatar', typingEl);
    const progressEl  = $('.chat-progress', containerEl);
    let index = 0;

    // Build actor map from messages
    const actors = {};
    messages.forEach(msg => {
      const sender = msg.dataset.sender;
      const avatar = $('.chat-avatar', msg);
      if (avatar && !actors[sender]) {
        actors[sender] = { initial: avatar.textContent.trim(), style: avatar.style.background };
      }
    });

    function updateProgress() {
      if (progressEl) progressEl.textContent = index + ' / ' + messages.length + ' messages';
    }

    function showNext() {
      if (index >= messages.length) return;
      const msg    = messages[index];
      const sender = msg.dataset.sender;

      if (typingEl && actors[sender]) {
        if (typingAvEl) {
          typingAvEl.textContent       = actors[sender].initial;
          typingAvEl.style.background  = actors[sender].style;
        }
        typingEl.style.display = 'flex';
      }

      setTimeout(() => {
        if (typingEl) typingEl.style.display = 'none';
        msg.style.display = 'flex';
        msg.style.animation = 'fadeSlideUp 0.3s var(--ease-out)';
        index++;
        updateProgress();
      }, 800);
    }

    function showAll() {
      const iv = setInterval(() => {
        if (index >= messages.length) { clearInterval(iv); return; }
        showNext();
      }, 1200);
    }

    function reset() {
      index = 0;
      messages.forEach(m => { m.style.display = 'none'; m.style.animation = ''; });
      if (typingEl) typingEl.style.display = 'none';
      updateProgress();
    }

    // Bind controls
    const nextBtn  = $('.chat-next-btn',  containerEl);
    const allBtn   = $('.chat-all-btn',   containerEl);
    const resetBtn = $('.chat-reset-btn', containerEl);
    if (nextBtn)  nextBtn.addEventListener('click',  showNext);
    if (allBtn)   allBtn.addEventListener('click',   showAll);
    if (resetBtn) resetBtn.addEventListener('click', reset);

    updateProgress();
  }

  $$('.chat-window').forEach(el => initChat(el));

  /* ── FLOW ANIMATION ENGINE ─────────────────────────────────── */
  function initFlow(containerEl) {
    if (!containerEl) return;
    const stepsData  = JSON.parse(containerEl.dataset.steps || '[]');
    const labelEl    = $('.flow-step-label', containerEl);
    const progressEl = $('.flow-progress',   containerEl);
    const packet     = $('.flow-packet',     containerEl);
    let step = 0;

    function updateProgress() {
      if (progressEl) progressEl.textContent = 'Step ' + step + ' / ' + stepsData.length;
    }

    function animatePacket(fromId, toId) {
      if (!packet) return;
      const fromEl = $('#' + fromId);
      const toEl   = $('#' + toId);
      if (!fromEl || !toEl) return;
      const fromR = fromEl.getBoundingClientRect();
      const toR   = toEl.getBoundingClientRect();
      const contR = containerEl.getBoundingClientRect();
      const fx = fromR.left + fromR.width / 2  - contR.left;
      const fy = fromR.top  + fromR.height / 2 - contR.top;
      const tx = toR.left   + toR.width / 2    - contR.left;
      const ty = toR.top    + toR.height / 2   - contR.top;
      packet.style.setProperty('--packet-from-x', fx + 'px');
      packet.style.setProperty('--packet-from-y', fy + 'px');
      packet.style.setProperty('--packet-to-x',   tx + 'px');
      packet.style.setProperty('--packet-to-y',   ty + 'px');
      packet.style.display    = 'block';
      packet.style.animation  = 'none';
      packet.offsetHeight; // reflow
      packet.style.animation  = 'packetMove 0.8s var(--ease-in-out) forwards';
      setTimeout(() => { packet.style.display = 'none'; }, 850);
    }

    function next() {
      if (step >= stepsData.length) return;
      const s = stepsData[step];
      $$('.flow-actor', containerEl).forEach(a => a.classList.remove('active'));
      if (s.highlight) {
        const hEl = $('#' + s.highlight, containerEl) || $('#flow-' + s.highlight);
        if (hEl) hEl.classList.add('active');
      }
      if (s.packet && s.from && s.to) animatePacket('flow-' + s.from, 'flow-' + s.to);
      if (labelEl) labelEl.textContent = s.label || '';
      step++;
      updateProgress();
    }

    function reset() {
      step = 0;
      $$('.flow-actor', containerEl).forEach(a => a.classList.remove('active'));
      if (labelEl) labelEl.textContent = 'Click "Next Step" to begin';
      if (packet)  packet.style.display = 'none';
      updateProgress();
    }

    const nextBtn  = $('.flow-next-btn',  containerEl);
    const resetBtn = $('.flow-reset-btn', containerEl);
    if (nextBtn)  nextBtn.addEventListener('click',  next);
    if (resetBtn) resetBtn.addEventListener('click', reset);

    updateProgress();
  }

  $$('.flow-animation').forEach(el => initFlow(el));

  /* ── ARCHITECTURE DIAGRAM ──────────────────────────────────── */
  $$('.arch-component').forEach(comp => {
    comp.addEventListener('click', function () {
      const diagram = this.closest('.arch-diagram');
      $$('.arch-component', diagram).forEach(c => c.classList.remove('active'));
      this.classList.add('active');
      const descEl = $('.arch-description', diagram);
      if (descEl) descEl.textContent = this.dataset.desc || '';
    });
  });

  /* ── BUG CHALLENGE ─────────────────────────────────────────── */
  window.checkBugLine = function (el, isCorrect) {
    const challenge = el.closest('.bug-challenge');
    const feedback  = $('.bug-feedback', challenge);
    if (isCorrect) {
      el.classList.add('correct');
      feedback.innerHTML  = '<strong>Found it!</strong> ' + (el.dataset.explanation || '');
      feedback.className  = 'bug-feedback show success';
      $$('.bug-line', challenge).forEach(l => l.style.pointerEvents = 'none');
    } else {
      el.classList.add('incorrect');
      feedback.innerHTML  = (el.dataset.hint || 'Not this line — keep looking...');
      feedback.className  = 'bug-feedback show error';
      setTimeout(() => {
        el.classList.remove('incorrect');
        feedback.className = 'bug-feedback';
      }, 1800);
    }
  };

  /* ── LAYER TOGGLE ──────────────────────────────────────────── */
  window.showLayer = function (layerId, btn) {
    const demo = btn ? btn.closest('.layer-demo') : null;
    if (!demo) return;
    $$('.layer', demo).forEach(l => l.style.display = 'none');
    $$('.layer-tab', demo).forEach(t => t.classList.remove('active'));
    const layer = $('#' + layerId);
    if (layer) layer.style.display = 'block';
    btn.classList.add('active');
  };

})();
