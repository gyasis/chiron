/**
 * Deterministic widget-spec normalizer — maps the reasonable-but-wrong field names LLMs emit
 * onto the exact shapes the renderers (dist/lib/widget-renderer.js) require. This is what makes
 * the STATIC pipeline reliable: instead of re-prompting an LLM to guess the right key, we map
 * common aliases deterministically. Shared by assemble-medicine.mjs AND render-check.mjs so the
 * gate and the assembler agree byte-for-byte.
 */

const pick = (o, ...keys) => { for (const k of keys) if (o?.[k] != null) return o[k]; return undefined; };

/** MCQ-family option: renderer wants {label, correct, explanation}. */
function normOption(opt) {
  return {
    ...opt,
    // DISPLAY the option CONTENT — prefer text/option/choice over the bare letter `label`.
    // (Regression 2026-06-29: picking `label` first showed only "A/B/C/D/E" — the option text was lost.)
    label: pick(opt, 'text', 'option', 'choice', 'label') ?? '',
    correct: !!pick(opt, 'correct', 'isCorrect', 'is_correct'),
    explanation: pick(opt, 'explanation', 'rationale', 'feedback') ?? '',
  };
}

export function normaliseWidget(spec) {
  if (!spec || typeof spec !== 'object') return spec;
  const t = spec.type;

  if (t === 'mcq' || t === 'mcq-clinical-vignette') {
    return { ...spec, options: Array.isArray(spec.options) ? spec.options.map(normOption) : [] };
  }
  if (t === 'confidence-weighted' && spec.mcq) {
    return { ...spec, mcq: { ...spec.mcq, options: (spec.mcq.options || []).map(normOption) } };
  }
  // why-care-callout: renderer wants spec.body (calls escapeHtml(spec.body)).
  if (t === 'why-care-callout') {
    return { ...spec, body: pick(spec, 'body', 'text', 'content', 'message', 'callout', 'detail') ?? '' };
  }
  // pattern-cards: renderer wants each card {num?, title, body, foot?}
  if (t === 'pattern-cards') {
    const cards = (spec.cards || spec.items || []).map((c) => ({
      ...c,
      num: pick(c, 'num', 'number', 'n'),
      title: pick(c, 'title', 'term', 'name', 'label', 'heading') ?? '',
      body: pick(c, 'body', 'definition', 'desc', 'description', 'text', 'detail') ?? '',
      foot: pick(c, 'foot', 'footnote', 'note'),
    }));
    return { ...spec, cards };
  }
  // step-cards: renderer wants each step {n, label, body}
  if (t === 'step-cards') {
    const steps = (spec.steps || spec.items || []).map((s, i) => ({
      ...s,
      n: pick(s, 'n', 'number', 'step', 'index') ?? i + 1,
      label: pick(s, 'label', 'title', 'heading', 'name') ?? '',
      body: pick(s, 'body', 'text', 'detail', 'description', 'content') ?? '',
    }));
    return { ...spec, steps };
  }
  // glossary-tooltips: renderer wants spec.entries[] {term, definition}
  if (t === 'glossary-tooltips') {
    const entries = (spec.entries || spec.terms || spec.items || spec.glossary || spec.definitions || []).map((e) => ({
      ...e,
      term: pick(e, 'term', 'word', 'name', 'label') ?? '',
      definition: pick(e, 'definition', 'def', 'meaning', 'description', 'text') ?? '',
    }));
    return { ...spec, entries };
  }
  // ddx-tree: branches[].leaves[] {title, detail}
  if (t === 'ddx-tree') {
    const branches = (spec.branches || spec.columns || []).map((b) => ({
      ...b,
      label: pick(b, 'label', 'category', 'name', 'title') ?? '',
      leaves: (b.leaves || b.diagnoses || b.items || b.cards || []).map((l) => ({
        ...l,
        title: pick(l, 'title', 'name', 'dx', 'diagnosis', 'label') ?? '',
        detail: pick(l, 'detail', 'features', 'description', 'desc', 'clues', 'note'),
      })),
    }));
    return { ...spec, root: pick(spec, 'root', 'criterion', 'finding', 'stem') ?? '', branches };
  }
  // decision-flow: branches[].steps[] {kind, text}
  if (t === 'decision-flow') {
    const branches = (spec.branches || []).map((b) => ({
      ...b,
      label: pick(b, 'label', 'name') ?? '',
      steps: (b.steps || b.nodes || b.path || []).map((s) => ({
        ...s,
        kind: s.kind || (s.dx || s.diagnosis ? 'dx' : 'decision'),
        text: pick(s, 'text', 'label', 'node', 'dx', 'diagnosis', 'body') ?? '',
      })),
    }));
    return { ...spec, start: pick(spec, 'start', 'presenting', 'root') ?? '',
             question: pick(spec, 'question', 'decision', 'firstDecision') ?? '', branches };
  }
  // compare-lanes: columns[] {label}, rows[] {feature, cells[]}
  if (t === 'compare-lanes') {
    const columns = (spec.columns || spec.entities || spec.lanes || []).map((c) =>
      typeof c === 'string' ? { label: c } : { ...c, label: pick(c, 'label', 'name', 'title') ?? '' });
    const rows = (spec.rows || spec.features || []).map((r) => ({
      ...r,
      feature: pick(r, 'feature', 'dimension', 'aspect', 'label', 'name') ?? '',
      cells: r.cells || r.values || r.columns || [],
    }));
    return { ...spec, columns, rows };
  }
  return spec;
}
