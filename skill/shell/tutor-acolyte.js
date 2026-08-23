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
/** Chiron's palette as acolyte tokens.
 *
 *  Duplicated from the Ask page's mapper rather than imported: a lesson is a
 *  self-contained .chiron bundle, so it cannot reach /ask/ask.js — an up-tree
 *  import 404s the moment the lesson is served from anywhere else.
 *
 *  Every value carries a fallback so a lesson built before a token existed
 *  still renders a real colour instead of an empty custom property.
 */
function token() {
  const v = (name, fallback) => `var(${name}, ${fallback})`;
  return {
    bg:                v('--chiron-bg', '#ffffff'),
    fg:                v('--chiron-fg', '#0f1f33'),
    'fg-muted':        v('--chiron-fg-secondary', '#334155'),
    'fg-faint':        v('--chiron-muted', '#64748b'),
    surface:           v('--chiron-surface', '#f8fafc'),
    'surface-alt':     v('--chiron-elevated', '#eef4fb'),
    border:            v('--chiron-border', '#d8e3f0'),
    'border-soft':     v('--chiron-divider', '#e6eef7'),
    'border-strong':   v('--chiron-border', '#d8e3f0'),
    accent:            v('--chiron-accent', '#1e6fbf'),
    'accent-light':    v('--chiron-elevated', '#eef4fb'),
    'accent-contrast': v('--chiron-surface', '#ffffff'),
    // The accent is reserved for send and citation chrome; the reader's own
    // bubble stays a quiet pill, as on the Ask page.
    'msg-user-bg':     v('--chiron-elevated', '#eef4fb'),
    'msg-user-fg':     v('--chiron-fg', '#0f1f33'),
    font:              v('--chiron-font-body', "system-ui, sans-serif"),
    radius: '10px',
    'radius-lg': '14px',
    'font-size': '15px',
  };
}

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
      // Chiron's palette, straight into acolyte's tokens — without this the
      // sidebar paints in acolyte's own green while the lesson around it is
      // clinical blue or linguistic warm, and the widget reads as bolted on.
      //
      // These are var() REFERENCES, not resolved values. Every lesson carries
      // its own theme (clinical / linguistic / …) and can toggle light-dark at
      // runtime, so a snapshot of the computed colours goes stale the moment
      // the reader flips it. A reference re-resolves on its own.
      theme: token(),
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
