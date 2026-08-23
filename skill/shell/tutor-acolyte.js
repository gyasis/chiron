/*
 * Chiron lesson tutor — acolyte, configured. Tier 2 of the three-tier model.
 *
 * The three tiers are ONE widget with three scope configs, not three widgets:
 *   1  Ask page      whole corpus     (a corpus sidecar, permissive)
 *   2  this file     THIS page only   (DOM scan, strict)          ← you are here
 *   3  focus         the lessons an answer stood on
 *
 * WHY STRICT. Gyasi's requirement: "when it's active per page the truth is per
 * page; we force the context of that page so further questions make sense."
 * Question four stays anchored to this lesson instead of drifting into the
 * general corpus mid-thread. `grounding:'strict'` is exactly that.
 *
 * A strict scope needs a way out or it is a trap, so the panel carries a
 * hand-up to the Ask page (?q= prefills, never auto-sends).
 *
 * The backend is the SAME :8912 tutor service the old tutor.js used, reached
 * through its OpenAI-compatible face. Acolyte stays a generic widget; the
 * adapter lives on the service, which is what lets the next site reuse it.
 */
(async function () {
  const HOST = location.hostname || '127.0.0.1';
  const TUTOR = `http://${HOST}:8912`;

  // Lesson identity, for the hand-up link and for telling the model where it is.
  const slug = (location.pathname.match(/\/lessons\/([^/]+)\//) || [])[1]
    || location.pathname.split('/').filter(Boolean).slice(-2)[0] || '';
  const title = (document.querySelector('h1')?.textContent || document.title || '').trim();

  let mount;
  try {
    ({ mount } = await import('./acolyte.js'));
  } catch (e) {
    console.warn('[chiron] tutor unavailable — acolyte bundle missing', e);
    return;                                   // the lesson works without it
  }

  // Ask the service what it can answer with, rather than hardcoding a model
  // that may have been retired. A failure here is not fatal: the service picks
  // its own default when the request names nothing.
  let model = null;
  try {
    const r = await fetch(`${TUTOR}/v1/models`, { signal: AbortSignal.timeout(4000) });
    if (r.ok) model = (await r.json()).data?.[0]?.id || null;
  } catch { /* service down — mount anyway so the tab is not silently missing */ }

  const handle = mount({
    llm: {
      provider: 'openai-compatible',
      baseUrl: `${TUTOR}/v1`,
      model: model || 'gemma4',
      apiKey: 'local',                        // the service is LAN-local and unauthenticated
    },
    persona: {
      name: 'Chiron',
      role: `You are the tutor for this one lesson: "${title}". Explain what is on `
          + `this page — its examples, its wording, its reasoning. The learner is an `
          + `English-speaking doctor. Answer in the language they ask in.`,
      grounding: 'strict',                    // the truth is THIS page
      refusalPolicy: 'redirect',
      greeting: 'Ask me about anything on this page — a phrase, a mechanism, a line you want unpacked.',
    },
    rag: {
      auto: true,                             // scan THIS page, nothing else
      topK: 6,
      showSourceCards: true,
      crossPageReferences: false,             // tier 2 does not leave the page
    },
    ui: {
      layout: 'overlay',                      // a companion to the lesson, not the page
      position: 'right',
      fabIcon: '🎓',
      defaultWidth: 'narrow',
    },
    storage: { dbName: `chiron-tutor-${slug || 'lesson'}` },   // per-lesson thread
  });

  // ── the way out ──────────────────────────────────────────────────────────
  // Strict scoping is only tolerable with a visible escape hatch. Whatever is
  // typed travels with it, so an out-of-scope question is not retyped.
  const panel = document.querySelector('.acolyte-panel') || document.body;
  const out = document.createElement('a');
  out.className = 'chiron-tutor-out';
  out.href = '/ask/';
  out.textContent = '↗ Ask this across the whole library';
  out.title = 'This tutor only knows this page. The Ask page searches every lesson.';
  out.addEventListener('click', e => {
    const ta = panel.querySelector('textarea');
    const q = (ta?.value || '').trim();
    if (q) { e.preventDefault(); location.href = '/ask/?q=' + encodeURIComponent(q); }
  });
  panel.appendChild(out);

  window.chironTutor = handle;                // for the lesson's own dispatch buttons
})();
