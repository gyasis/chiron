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

  /* ── T163: XSS-safe feedback writer ────────────────────────────
   * LLM-authored explanations/hints are prompt-injectable, so they must
   * NEVER reach innerHTML. Render an optional bold label as a real <strong>
   * element, then append the untrusted body as a text node (textContent
   * semantics) so any markup in it is shown literally, not executed. */
  function setFeedback(el, label, body) {
    if (!el) return;
    el.textContent = '';
    if (label) {
      const strong = document.createElement('strong');
      strong.textContent = label;
      el.appendChild(strong);
      if (body) el.appendChild(document.createTextNode(' '));
    }
    if (body) el.appendChild(document.createTextNode(body));
  }

  /* ── T180: localStorage quota-aware setter ─────────────────── */
  function getLessonId() {
    const meta = document.querySelector('meta[name="chiron-lesson-id"]');
    return (meta && meta.getAttribute('content')) || document.title || 'unknown';
  }

  function showBanner(msg) {
    let banner = document.querySelector('.chiron-storage-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'chiron-storage-banner';
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#fff3cd;color:#856404;padding:8px;text-align:center;z-index:9999';
      document.body.prepend(banner);
    }
    banner.textContent = msg;
  }

  function trimLocalStorage() {
    // Drop SR review log first (largest, most evictable).
    const lessonId = getLessonId();
    if (!lessonId) return;
    const logKey = 'chiron:lesson:' + lessonId + ':sr-review-log';
    try {
      const log = JSON.parse(localStorage.getItem(logKey) || '[]');
      if (Array.isArray(log) && log.length > 100) {
        localStorage.setItem(logKey, JSON.stringify(log.slice(-100)));
      }
    } catch (e) { /* ignore parse errors */ }
  }

  function safeSetItem(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
        // eslint-disable-next-line no-console
        console.warn('[chiron] localStorage quota exceeded; trimming...');
        trimLocalStorage();
        try {
          localStorage.setItem(key, value);
          return true;
        } catch (e2) {
          showBanner('Lesson progress not saving — clear other lessons or reset state.');
          return false;
        }
      }
      return false;
    }
  }

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
      safeSetItem(STORAGE_KEY, JSON.stringify(arr.slice(0, MAX_ENTRIES)));
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
      safeSetItem(STORAGE_KEY, JSON.stringify(obj));
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
      safeSetItem(CARDS_KEY, JSON.stringify(arr));
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
      safeSetItem(LOG_KEY, JSON.stringify(trimmed));
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
        setFeedback(feedback, 'Exactly!', rightExp);
        feedback.className = 'quiz-feedback show success';
      } else {
        selected.classList.add('incorrect');
        const correctBtn = $(`.quiz-option[data-value="${correct}"]`, q);
        if (correctBtn) correctBtn.classList.add('correct');
        setFeedback(feedback, 'Not quite.', wrongExp);
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
      setFeedback(feedback, 'Found it!', el.dataset.explanation || '');
      feedback.className  = 'bug-feedback show success';
      $$('.bug-line', challenge).forEach(l => l.style.pointerEvents = 'none');
    } else {
      el.classList.add('incorrect');
      setFeedback(feedback, '', el.dataset.hint || 'Not this line — keep looking...');
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
  audio.addEventListener('ended', clearActive);
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
        g.appendChild(btn);
      });
      panel.appendChild(g);
    }
    group('Whole lesson', clips.filter(function (c) { return c.artifact === 'summary' || c.artifact === 'shortened'; }));
    group('By section', clips.filter(function (c) { return c.artifact === 'section'; }));
    document.body.appendChild(panel);
  }

  function wireInline(clips) {
    clips.forEach(function (c) {
      if (!c.sectionId) return;
      var el = document.getElementById(c.sectionId);
      if (!el) return;
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'chiron-play-inline'; btn.title = 'Ascolta'; btn.setAttribute('aria-label', 'Play audio');
      var ico = document.createElement('span'); ico.className = 'ico'; ico.textContent = '▶'; btn.appendChild(ico);
      btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); play(c, btn, null, '▶'); });
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

/* ── MOBILE RESPONSIVE LAYER ──────────────────────────────────────
   Feature A — Hamburger TOC drawer (mobile ≤768px only)
   Feature B — Bottom-bar mini-player + full-screen now-playing (mobile ≤768px only)

   BUG FIXES (2026-06-11):
     1. Bar is injected on init, visible immediately — NOT deferred until scroll.
     2. Sheet opens on tap regardless of play state.
     3. Full transport: prev/next chapter, touch scrubber, auto-advance.
     4. Double-tap mini-bar OR explicit ⛶ expand → full-screen now-playing.

   All logic is width-guarded: initialises only if matchMedia ≤768px.
   Above 768px: nothing injected, no side-effects.
   ─────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var MQL = window.matchMedia && window.matchMedia('(max-width: 768px)');

  /* ── STATE ──────────────────────────────────────────────────────── */
  var hamburger    = null;
  var backdrop     = null;
  var sidebar      = null;
  var bottomBar    = null;   // <div class="chiron-bottom-bar">
  var barPlayBtn   = null;
  var barPrevBtn   = null;
  var barNextBtn   = null;
  var barClipName  = null;
  var barCountdown = null;
  var barProgress  = null;
  var barSheet     = null;
  var barExpandBtn = null;   // ▲/▼ chevron
  var barFsBtn     = null;   // ⛶ full-screen button

  var fsOverlay    = null;   // full-screen now-playing overlay
  var fsTitle      = null;
  var fsElapsed    = null;
  var fsRemaining  = null;
  var fsScrubTrack = null;
  var fsScrubThumb = null;
  var fsPlayBtn    = null;
  var fsPrevBtn    = null;
  var fsNextBtn    = null;
  var fsClipList   = null;
  var fsOpen       = false;

  var mobileAudio  = null;   // shared Audio element
  var activeClip   = null;   // { clip, idx }
  var mobileClips  = [];     // ordered (summary first, then sections)
  var barTimer     = null;
  var sheetOpen    = false;
  var drawerOpen_  = false;

  /* ─── Feature A helpers ─────────────────────────────────────────── */
  function openDrawer() {
    if (!sidebar) return;
    drawerOpen_ = true;
    sidebar.classList.add('drawer-open');
    backdrop.classList.add('open');
    document.body.classList.add('drawer-scroll-lock');
    hamburger.setAttribute('aria-expanded', 'true');
    hamburger.textContent = '✕';
  }
  function closeDrawer() {
    if (!sidebar) return;
    drawerOpen_ = false;
    sidebar.classList.remove('drawer-open');
    backdrop.classList.remove('open');
    document.body.classList.remove('drawer-scroll-lock');
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.textContent = '☰';
  }
  function toggleDrawer() { drawerOpen_ ? closeDrawer() : openDrawer(); }

  function injectHamburger() {
    if (hamburger) return;
    sidebar = document.querySelector('aside.side');
    if (!sidebar) return;
    backdrop = document.createElement('div');
    backdrop.className = 'chiron-drawer-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', closeDrawer);
    hamburger = document.createElement('button');
    hamburger.type = 'button';
    hamburger.className = 'chiron-hamburger';
    hamburger.textContent = '☰';
    hamburger.setAttribute('aria-label', 'Open chapter list');
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.setAttribute('aria-controls', 'side-drawer');
    hamburger.addEventListener('click', toggleDrawer);
    document.body.appendChild(hamburger);
    sidebar.setAttribute('id', 'side-drawer');
    sidebar.setAttribute('role', 'dialog');
    sidebar.setAttribute('aria-label', 'Chapter list');
    sidebar.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { if (drawerOpen_) closeDrawer(); });
    });
  }

  /* ─── Feature B helpers ─────────────────────────────────────────── */
  function fmtTime(secs) {
    if (!isFinite(secs) || secs < 0) return '0:00';
    var s = Math.ceil(secs);
    var m = Math.floor(s / 60);
    var ss = s % 60;
    return m + ':' + (ss < 10 ? '0' : '') + ss;
  }

  function setBarProgress(fraction) {
    if (!barProgress) return;
    barProgress.style.width = (Math.min(1, Math.max(0, fraction)) * 100) + '%';
  }

  function updateFsScrubber(fraction) {
    if (!fsScrubTrack) return;
    var pct = Math.min(1, Math.max(0, fraction)) * 100;
    fsScrubTrack.style.setProperty('--fs-progress', pct + '%');
    if (fsScrubThumb) fsScrubThumb.style.left = pct + '%';
  }

  function updateAllDisplays() {
    if (!mobileAudio || !activeClip) return;
    var dur = mobileAudio.duration;
    var ct  = mobileAudio.currentTime;
    var frac = (isFinite(dur) && dur > 0) ? ct / dur : 0;

    // Mini bar
    setBarProgress(frac);
    if (barCountdown) barCountdown.textContent = (isFinite(dur) && dur > 0) ? fmtTime(dur - ct) : '';

    // Full-screen scrubber + times
    updateFsScrubber(frac);
    if (fsElapsed)   fsElapsed.textContent   = fmtTime(ct);
    if (fsRemaining) fsRemaining.textContent = (isFinite(dur) && dur > 0) ? '-' + fmtTime(dur - ct) : '';

    // Sheet button states
    mobileClips.forEach(function (c, i) {
      var btn = barSheet && barSheet.querySelector('[data-clip-idx="' + i + '"]');
      if (!btn) return;
      var playing = activeClip && activeClip.idx === i && !mobileAudio.paused;
      btn.classList.toggle('playing', playing);
      var ico = btn.querySelector('.ico');
      if (ico) ico.textContent = playing ? '⏸' : '▶';
    });

    // Full-screen clip list states
    if (fsClipList) {
      fsClipList.querySelectorAll('[data-clip-idx]').forEach(function (btn) {
        var i = parseInt(btn.getAttribute('data-clip-idx'), 10);
        var playing = activeClip && activeClip.idx === i && !mobileAudio.paused;
        btn.classList.toggle('playing', playing);
        var ico = btn.querySelector('.ico');
        if (ico) ico.textContent = playing ? '⏸' : '▶';
      });
    }

    // Prev/next button states
    var idx = activeClip ? activeClip.idx : -1;
    if (barPrevBtn) barPrevBtn.disabled = idx <= 0;
    if (barNextBtn) barNextBtn.disabled = idx < 0 || idx >= mobileClips.length - 1;
    if (fsPrevBtn)  fsPrevBtn.disabled  = idx <= 0;
    if (fsNextBtn)  fsNextBtn.disabled  = idx < 0 || idx >= mobileClips.length - 1;
  }

  function startBarTimer() {
    if (barTimer) clearInterval(barTimer);
    barTimer = setInterval(updateAllDisplays, 200);
  }
  function stopBarTimer() {
    if (barTimer) { clearInterval(barTimer); barTimer = null; }
  }

  /* Core play function — plays clip at ordered index idx */
  function playClipAt(idx) {
    if (!mobileAudio) return;
    if (idx < 0 || idx >= mobileClips.length) return;
    var clip = mobileClips[idx];

    // If same clip, toggle play/pause
    if (activeClip && activeClip.idx === idx) {
      if (mobileAudio.paused) {
        mobileAudio.play().catch(function () {});
      } else {
        mobileAudio.pause();
      }
      return;
    }

    // New clip
    activeClip = { clip: clip, idx: idx };
    window._chironResolveSrc(clip.audioPath, function (resolvedSrc) {
    mobileAudio.src = resolvedSrc;
    mobileAudio.play().then(function () {
      syncBarToActive();
    }).catch(function () {
      activeClip = null;
    });
    });
  }

  function syncBarToActive() {
    if (!activeClip) return;
    var clip = activeClip.clip;
    // Mini bar name
    if (barClipName) {
      barClipName.textContent = clip._label || 'Playing';
      barClipName.classList.remove('idle');
    }
    // Full-screen title
    if (fsTitle) fsTitle.textContent = clip._label || 'Playing';
    // Play button states
    if (barPlayBtn) { barPlayBtn.textContent = '⏸'; barPlayBtn.classList.remove('idle'); }
    if (fsPlayBtn)  { fsPlayBtn.textContent = '⏸'; }
    updateAllDisplays();
  }

  function playBarClip(clip) {
    var idx = mobileClips.indexOf(clip);
    if (idx < 0) return;
    playClipAt(idx);
  }

  function stopBarAudio() {
    if (!mobileAudio) return;
    mobileAudio.pause();
    mobileAudio.currentTime = 0;
    stopBarTimer();
    activeClip = null;
    if (barPlayBtn)  { barPlayBtn.textContent = '▶'; barPlayBtn.classList.add('idle'); }
    if (barClipName) { barClipName.textContent = 'Tap to browse · double-tap to zoom'; barClipName.classList.add('idle'); }
    if (barCountdown) barCountdown.textContent = '';
    setBarProgress(0);
    updateFsScrubber(0);
    if (fsElapsed)   fsElapsed.textContent   = '0:00';
    if (fsRemaining) fsRemaining.textContent = '';
    if (fsPlayBtn)   fsPlayBtn.textContent   = '▶';
    if (fsTitle)     fsTitle.textContent     = 'Choose a clip below';
    updateAllDisplays();
  }

  /* Sheet (clip list under bar) */
  function openSheet() {
    if (!bottomBar || !barSheet) return;
    sheetOpen = true;
    bottomBar.classList.add('sheet-open');
    if (barExpandBtn) barExpandBtn.textContent = '▼';
  }
  function closeSheet() {
    if (!bottomBar) return;
    sheetOpen = false;
    bottomBar.classList.remove('sheet-open');
    if (barExpandBtn) barExpandBtn.textContent = '▲';
  }

  /* Full-screen now-playing overlay */
  function openFullScreen() {
    if (!fsOverlay) return;
    fsOpen = true;
    fsOverlay.classList.add('open');
    document.body.classList.add('chiron-fs-lock');
    // Sync state to overlay
    if (activeClip) {
      if (fsTitle) fsTitle.textContent = activeClip.clip._label || 'Playing';
    } else {
      if (fsTitle) fsTitle.textContent = 'Choose a clip below';
    }
    updateAllDisplays();
  }
  function closeFullScreen() {
    fsOpen = false;
    if (fsOverlay) fsOverlay.classList.remove('open');
    document.body.classList.remove('chiron-fs-lock');
  }

  /* Build the ordered clip list (summary → sections) */
  function buildOrderedClips(rawClips) {
    var whole = rawClips.filter(function (c) { return c.artifact === 'summary' || c.artifact === 'shortened'; });
    var sects = rawClips.filter(function (c) { return c.artifact === 'section'; });
    return whole.concat(sects);
  }

  /* Label clips for display */
  function labelClips(clips) {
    clips.forEach(function (c) {
      if (c.artifact === 'summary')   { c._label = 'Summary'; return; }
      if (c.artifact === 'shortened') { c._label = 'Full lecture'; return; }
      if (c.sectionId) {
        var el = document.getElementById(c.sectionId);
        var h = el && el.querySelector('h1,h2,h3,[data-section-title]');
        c._label = h && h.textContent.trim()
          ? h.textContent.trim().replace(/^\s*\d+[\.\)]?\s*/, '')
          : (c.sectionId || 'Section');
        return;
      }
      c._label = 'Clip';
    });
  }

  /* Build clip list rows (shared by sheet and full-screen list) */
  function buildClipRows(container, clips, onPick) {
    container.innerHTML = '';
    clips.forEach(function (c, i) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chiron-bar-clip-btn';
      btn.setAttribute('data-clip-idx', i);
      var ico = document.createElement('span'); ico.className = 'ico'; ico.textContent = '▶';
      var lbl = document.createElement('span'); lbl.textContent = c._label || c.sectionId || 'Clip';
      btn.appendChild(ico); btn.appendChild(lbl);
      btn.addEventListener('click', function () { onPick(c, i); });
      container.appendChild(btn);
    });
  }

  /* ─── Feature B — seek wiring helpers ──────────────────────────── */
  function seekAudioTo(fraction) {
    if (!mobileAudio || !activeClip) return;
    var dur = mobileAudio.duration;
    if (!isFinite(dur) || dur <= 0) return;
    mobileAudio.currentTime = Math.max(0, Math.min(1, fraction)) * dur;
    updateAllDisplays();
  }

  function wireSeekOn(el, fractionFn) {
    var dragging = false;
    el.addEventListener('pointerdown', function (e) {
      if (!activeClip) return;
      dragging = true;
      el.setPointerCapture(e.pointerId);
      seekAudioTo(fractionFn(e, el));
      e.preventDefault();
    });
    el.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      seekAudioTo(fractionFn(e, el));
      e.preventDefault();
    });
    function onUp(e) {
      if (!dragging) return;
      dragging = false;
      seekAudioTo(fractionFn(e, el));
      el.releasePointerCapture(e.pointerId);
    }
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', function () { dragging = false; });
  }

  function fractionFromHoriz(e, el) {
    var rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  }

  /* ─── Build full-screen now-playing overlay ─────────────────────── */
  function buildFsOverlay() {
    if (fsOverlay) return;
    fsOverlay = document.createElement('div');
    fsOverlay.className = 'chiron-fs-overlay';
    fsOverlay.setAttribute('role', 'dialog');
    fsOverlay.setAttribute('aria-modal', 'true');
    fsOverlay.setAttribute('aria-label', 'Now playing');

    /* ── Header row: close chevron ── */
    var hdr = document.createElement('div');
    hdr.className = 'chiron-fs-header';
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button'; closeBtn.className = 'chiron-fs-close';
    closeBtn.setAttribute('aria-label', 'Collapse');
    closeBtn.innerHTML = '&#8964;'; // ⌄ chevron-down
    closeBtn.addEventListener('click', closeFullScreen);
    hdr.appendChild(closeBtn);
    fsOverlay.appendChild(hdr);

    /* ── Chapter title ── */
    fsTitle = document.createElement('div');
    fsTitle.className = 'chiron-fs-title';
    fsTitle.textContent = 'Choose a clip below';
    fsOverlay.appendChild(fsTitle);

    /* ── Scrubber + time row ── */
    var scrubWrap = document.createElement('div');
    scrubWrap.className = 'chiron-fs-scrub-wrap';

    fsElapsed = document.createElement('span');
    fsElapsed.className = 'chiron-fs-time chiron-fs-elapsed';
    fsElapsed.textContent = '0:00';

    fsScrubTrack = document.createElement('div');
    fsScrubTrack.className = 'chiron-fs-scrub-track';
    fsScrubTrack.setAttribute('role', 'slider');
    fsScrubTrack.setAttribute('aria-valuemin', '0');
    fsScrubTrack.setAttribute('aria-valuemax', '100');
    fsScrubTrack.setAttribute('aria-valuenow', '0');
    fsScrubTrack.setAttribute('tabindex', '0');
    fsScrubThumb = document.createElement('div');
    fsScrubThumb.className = 'chiron-fs-scrub-thumb';
    fsScrubTrack.appendChild(fsScrubThumb);
    wireSeekOn(fsScrubTrack, fractionFromHoriz);

    fsRemaining = document.createElement('span');
    fsRemaining.className = 'chiron-fs-time chiron-fs-remaining';
    fsRemaining.textContent = '';

    scrubWrap.appendChild(fsElapsed);
    scrubWrap.appendChild(fsScrubTrack);
    scrubWrap.appendChild(fsRemaining);
    fsOverlay.appendChild(scrubWrap);

    /* ── Transport row ── */
    var transport = document.createElement('div');
    transport.className = 'chiron-fs-transport';

    fsPrevBtn = document.createElement('button');
    fsPrevBtn.type = 'button'; fsPrevBtn.className = 'chiron-fs-prev';
    fsPrevBtn.setAttribute('aria-label', 'Previous chapter');
    fsPrevBtn.textContent = '⏮';
    fsPrevBtn.addEventListener('click', function () {
      if (activeClip && activeClip.idx > 0) playClipAt(activeClip.idx - 1);
    });

    fsPlayBtn = document.createElement('button');
    fsPlayBtn.type = 'button'; fsPlayBtn.className = 'chiron-fs-play';
    fsPlayBtn.setAttribute('aria-label', 'Play/Pause');
    fsPlayBtn.textContent = '▶';
    fsPlayBtn.addEventListener('click', function () {
      if (!activeClip) return;
      if (mobileAudio.paused) { mobileAudio.play().catch(function () {}); }
      else { mobileAudio.pause(); }
    });

    fsNextBtn = document.createElement('button');
    fsNextBtn.type = 'button'; fsNextBtn.className = 'chiron-fs-next';
    fsNextBtn.setAttribute('aria-label', 'Next chapter');
    fsNextBtn.textContent = '⏭';
    fsNextBtn.addEventListener('click', function () {
      if (activeClip && activeClip.idx < mobileClips.length - 1) playClipAt(activeClip.idx + 1);
    });

    transport.appendChild(fsPrevBtn);
    transport.appendChild(fsPlayBtn);
    transport.appendChild(fsNextBtn);
    fsOverlay.appendChild(transport);

    /* ── Clip list ── */
    var listHdr = document.createElement('div');
    listHdr.className = 'chiron-fs-list-hdr';
    listHdr.textContent = 'Chapters';
    fsOverlay.appendChild(listHdr);

    fsClipList = document.createElement('div');
    fsClipList.className = 'chiron-fs-clip-list';
    fsOverlay.appendChild(fsClipList);

    document.body.appendChild(fsOverlay);
  }

  /* Populate the full-screen clip list (called after clips are loaded) */
  function populateFsClipList() {
    if (!fsClipList) return;
    buildClipRows(fsClipList, mobileClips, function (c, i) {
      playClipAt(i);
      // keep overlay open
    });
  }

  /* ─── Build bar DOM — injected immediately on mobile init ────────
     The bar is visible on page load even before the manifest loads.
     Clips are populated later via loadClips(). ─────────────────── */
  function injectBottomBar() {
    if (bottomBar) return;
    mobileAudio = new Audio();

    bottomBar = document.createElement('div');
    bottomBar.className = 'chiron-bottom-bar';
    bottomBar.setAttribute('role', 'region');
    bottomBar.setAttribute('aria-label', 'Audio player');

    /* Progress line */
    barProgress = document.createElement('div');
    barProgress.className = 'chiron-bar-progress-line';
    barProgress.setAttribute('role', 'progressbar');
    barProgress.setAttribute('aria-valuemin', '0');
    barProgress.setAttribute('aria-valuemax', '100');
    barProgress.setAttribute('aria-valuenow', '0');

    /* Main row */
    var row = document.createElement('div');
    row.className = 'chiron-bar-row';

    /* ── Prev chapter ── */
    barPrevBtn = document.createElement('button');
    barPrevBtn.type = 'button'; barPrevBtn.className = 'chiron-bar-prev-btn';
    barPrevBtn.setAttribute('aria-label', 'Previous chapter');
    barPrevBtn.textContent = '⏮';
    barPrevBtn.disabled = true;
    barPrevBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (activeClip && activeClip.idx > 0) playClipAt(activeClip.idx - 1);
    });

    /* ── Play/Pause ── */
    barPlayBtn = document.createElement('button');
    barPlayBtn.type = 'button'; barPlayBtn.className = 'chiron-bar-play-btn idle';
    barPlayBtn.textContent = '▶';
    barPlayBtn.setAttribute('aria-label', 'Play/Pause');
    barPlayBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!activeClip) { openSheet(); return; }
      if (mobileAudio.paused) { mobileAudio.play().catch(function () {}); }
      else { mobileAudio.pause(); }
    });

    /* ── Clip name ── */
    barClipName = document.createElement('div');
    barClipName.className = 'chiron-bar-clip-name idle';
    barClipName.textContent = 'Tap to browse · double-tap to zoom';

    /* ── Countdown ── */
    barCountdown = document.createElement('div');
    barCountdown.className = 'chiron-bar-countdown';

    /* ── Next chapter ── */
    barNextBtn = document.createElement('button');
    barNextBtn.type = 'button'; barNextBtn.className = 'chiron-bar-next-btn';
    barNextBtn.setAttribute('aria-label', 'Next chapter');
    barNextBtn.textContent = '⏭';
    barNextBtn.disabled = true;
    barNextBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (activeClip && activeClip.idx < mobileClips.length - 1) playClipAt(activeClip.idx + 1);
    });

    /* (No full-screen icon — gestures handle it: tap = sheet, double-tap = zoom.) */

    /* ── Chevron expand/collapse sheet ── */
    barExpandBtn = document.createElement('button');
    barExpandBtn.type = 'button'; barExpandBtn.className = 'chiron-bar-expand-btn';
    barExpandBtn.textContent = '▲';
    barExpandBtn.setAttribute('aria-label', 'Show clip list');
    barExpandBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      sheetOpen ? closeSheet() : openSheet();
    });

    row.appendChild(barPrevBtn);
    row.appendChild(barPlayBtn);
    row.appendChild(barClipName);
    row.appendChild(barCountdown);
    row.appendChild(barNextBtn);
    row.appendChild(barExpandBtn);

    /* Sheet (clip list) */
    barSheet = document.createElement('div');
    barSheet.className = 'chiron-bar-sheet';
    barSheet.setAttribute('aria-label', 'Clip list');
    var sheetTitle = document.createElement('div');
    sheetTitle.className = 'chiron-bar-sheet-title';
    sheetTitle.textContent = 'Choose a clip';
    barSheet.appendChild(sheetTitle);

    bottomBar.appendChild(barProgress);
    bottomBar.appendChild(row);
    bottomBar.appendChild(barSheet);
    document.body.appendChild(bottomBar);

    /* Tap the bar → bring up the clip sheet; double-tap → zoom to full-screen.
       Prev/play/next/chevron buttons stopPropagation, so taps on them never
       reach here. A single tap waits ~280ms in case a second tap (zoom) lands. */
    var _tapTimer = null;
    row.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('button')) return;
      if (_tapTimer) {                       // 2nd tap within window → zoom
        clearTimeout(_tapTimer); _tapTimer = null;
        if (sheetOpen) closeSheet();
        openFullScreen();
      } else {                                // 1st tap → open sheet after a beat
        _tapTimer = setTimeout(function () {
          _tapTimer = null;
          sheetOpen ? closeSheet() : openSheet();
        }, 280);
      }
    });

    /* Sheet tapping outside → close sheet */
    document.addEventListener('click', function (e) {
      if (!sheetOpen || !bottomBar) return;
      if (!bottomBar.contains(e.target)) closeSheet();
    });

    /* Audio event handlers */
    mobileAudio.addEventListener('ended', function () {
      stopBarTimer();
      // Auto-advance to next clip
      if (activeClip && activeClip.idx < mobileClips.length - 1) {
        var nextIdx = activeClip.idx + 1;
        activeClip = null; // clear before playClipAt so it triggers new-clip path
        playClipAt(nextIdx);
        // Scroll to the chapter section of the new clip
        var nextClip = mobileClips[nextIdx];
        if (nextClip && nextClip.sectionId) {
          var el = document.getElementById(nextClip.sectionId);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } else {
        // Last clip ended — stop gracefully, keep controls live
        stopBarAudio();
        // Allow replay: leave barPlayBtn available
        if (barClipName) barClipName.textContent = 'Finished — tap to replay';
      }
    });

    mobileAudio.addEventListener('pause', function () {
      stopBarTimer();
      if (barPlayBtn) barPlayBtn.textContent = '▶';
      if (fsPlayBtn)  fsPlayBtn.textContent  = '▶';
      updateAllDisplays();
    });

    mobileAudio.addEventListener('play', function () {
      if (barPlayBtn) { barPlayBtn.textContent = '⏸'; barPlayBtn.classList.remove('idle'); }
      if (fsPlayBtn)  fsPlayBtn.textContent  = '⏸';
      startBarTimer();
      syncBarToActive();
    });

    /* Build the full-screen overlay (hidden initially) */
    buildFsOverlay();
  }

  /* Called once clips are available (manifest loaded) */
  function loadClips(rawClips) {
    var ordered = buildOrderedClips(rawClips);
    labelClips(ordered);
    mobileClips = ordered;

    /* Populate sheet list */
    if (barSheet) {
      /* preserve title node */
      var titleNode = barSheet.querySelector('.chiron-bar-sheet-title');
      barSheet.innerHTML = '';
      if (titleNode) barSheet.appendChild(titleNode);
      buildClipRows(barSheet, ordered, function (c) {
        playBarClip(c);
        closeSheet();
      });
    }

    /* Populate full-screen list */
    populateFsClipList();

    /* Update prev/next disabled states */
    updateAllDisplays();
  }

  /* ─── Main init: wires everything ─────────────────────────────── */
  function initMobile() {
    injectHamburger();

    /* BUG FIX 1: inject bar immediately (not after manifest fetch) so it's
       visible on page load. Clips are populated once manifest arrives. */
    injectBottomBar();

    /* Fetch manifest and populate clips */
    if (window.__chironAudioManifest) {
      var ready = (window.__chironAudioManifest.clips || []).filter(function (c) {
        return c.status === 'done' && c.audioPath;
      });
      if (ready.length) loadClips(ready);
      return;
    }
    fetch('audio/manifest.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) {
        if (!m || !m.clips) return;
        var ready = m.clips.filter(function (c) { return c.status === 'done' && c.audioPath; });
        if (ready.length) loadClips(ready);
      })
      .catch(function () { /* no audio — bar stays as placeholder */ });
  }

  /* ─── MQL guard ─────────────────────────────────────────────────── */
  function onMqlChange(mq) {
    if (mq.matches) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMobile);
      } else {
        initMobile();
      }
    } else {
      // Exited mobile range — hide injected elements
      if (hamburger) hamburger.style.display = 'none';
      if (backdrop)  backdrop.style.display  = 'none';
      if (bottomBar) bottomBar.style.display = 'none';
      if (fsOverlay) { fsOverlay.classList.remove('open'); }
      if (sidebar) {
        sidebar.classList.remove('drawer-open');
        sidebar.style.removeProperty('display');
      }
      document.body.classList.remove('drawer-scroll-lock', 'chiron-fs-lock');
      drawerOpen_ = false;
    }
  }

  if (MQL) {
    if (MQL.addEventListener) MQL.addEventListener('change', onMqlChange);
    else if (MQL.addListener) MQL.addListener(onMqlChange);
    onMqlChange(MQL);
  }
})();

// group-chat English-translation toggle (universal — all Italian lessons)
(function () {
  document.querySelectorAll('.chat-window.has-en .chat-en-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var w = btn.closest('.chat-window');
      var on = w.classList.toggle('show-en');
      btn.textContent = on ? '\u{1F1EE}\u{1F1F9} Italiano' : '\u{1F1EC}\u{1F1E7} English';
    });
  });
})();
