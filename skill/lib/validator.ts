import { BriefSchema, type Brief } from './schemas/brief.js';
import {
  ChapterSyllabusSchema,
  CANONICAL_MEDICINE_SECTIONS,
  type ChapterSyllabus,
} from './schemas/chapter-syllabus.js';

// Concept DAG — adjacency map: conceptId -> prereq conceptIds
export type ConceptDag = Record<string, string[]>;

export interface ValidationIssue {
  path: string;
  message: string;
  code:
    | 'zod'
    | 'dag-cycle'
    | 'dag-missing-prereq'
    | 'dag-missing-concept'
    | 'rubric-science-annotations'
    | 'rubric-spacing-connections'
    | 'rubric-quiz-variants'
    | 'rubric-engagement-floor-code'
    | 'rubric-engagement-floor-medicine'
    | 'rubric-engagement-floor-language'
    | 'rubric-engagement-floor-concepts'
    | 'rubric-chapter-count-exact'
    | 'rubric-chapter-count-target'
    | 'rubric-medicine-atlas-mismatch'
    | 'rubric-medicine-sections-missing'
    | 'rubric-medicine-sections-out-of-order'
    | 'rubric-medicine-level-coverage';
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

// Detect cycles in the concept DAG (Kahn's algorithm).
function findDagCycle(dag: ConceptDag): string[] | null {
  const inDegree: Record<string, number> = {};
  for (const node of Object.keys(dag)) {
    inDegree[node] = 0;
  }
  for (const node of Object.keys(dag)) {
    for (const prereq of dag[node]) {
      inDegree[node] = (inDegree[node] ?? 0) + 1;
      if (!(prereq in inDegree)) inDegree[prereq] = 0;
    }
  }
  const queue = Object.keys(inDegree).filter((k) => inDegree[k] === 0);
  let visited = 0;
  while (queue.length) {
    const n = queue.shift()!;
    visited++;
    for (const m of Object.keys(dag)) {
      if (dag[m].includes(n)) {
        inDegree[m]--;
        if (inDegree[m] === 0) queue.push(m);
      }
    }
  }
  if (visited < Object.keys(inDegree).length) {
    return Object.keys(inDegree).filter((k) => inDegree[k] > 0);
  }
  return null;
}

export function validateBrief(brief: unknown): ValidationResult {
  const parsed = BriefSchema.safeParse(brief);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
        code: 'zod' as const,
      })),
    };
  }
  return { ok: true, issues: [] };
}

export function validateConceptDag(dag: ConceptDag): ValidationResult {
  const issues: ValidationIssue[] = [];
  // Every prereq must reference an existing concept.
  for (const [concept, prereqs] of Object.entries(dag)) {
    for (const p of prereqs) {
      if (!(p in dag)) {
        issues.push({
          path: `dag.${concept}.prereq`,
          message: `prereq '${p}' not found in DAG`,
          code: 'dag-missing-prereq',
        });
      }
    }
  }
  // No cycles.
  const cycle = findDagCycle(dag);
  if (cycle) {
    issues.push({
      path: 'dag',
      message: `cycle detected involving: ${cycle.join(' → ')}`,
      code: 'dag-cycle',
    });
  }
  return { ok: issues.length === 0, issues };
}

export function validateSyllabus(
  syllabus: unknown,
  dag: ConceptDag,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const parsed = ChapterSyllabusSchema.safeParse(syllabus);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
        code: 'zod' as const,
      })),
    };
  }
  const chapter = parsed.data as ChapterSyllabus;

  // FR-022: ≥3 scienceAnnotations.
  if (chapter.scienceAnnotations.length < 3) {
    issues.push({
      path: 'scienceAnnotations',
      message: `chapter must have ≥3 scienceAnnotations (FR-022), got ${chapter.scienceAnnotations.length}`,
      code: 'rubric-science-annotations',
    });
  }
  // FR-022: chapter ≥8 needs 2-4 spacingConnections.
  if (chapter.chapterNumber >= 8) {
    const sc = chapter.spacingConnections ?? [];
    if (sc.length < 2 || sc.length > 4) {
      issues.push({
        path: 'spacingConnections',
        message: `chapter ${chapter.chapterNumber} needs 2-4 spacingConnections (FR-022), got ${sc.length}`,
        code: 'rubric-spacing-connections',
      });
    }
  }
  // FR-021: every quiz-type widget has non-empty variants[].
  const QUIZ_TYPES = new Set<string>([
    'mcq',
    'mcq-clinical-vignette',
    'true-false',
    'fill-blank',
    'matching-pair',
    'cloze',
    'spot-the-bug',
    'agreement-matrix',
    'assertion-reason',
    'confidence-weighted',
    'slider-estimation',
    'boss',
  ]);
  for (const w of chapter.widgets) {
    const wAny = w as { type: string; variants?: unknown[] };
    if (QUIZ_TYPES.has(wAny.type)) {
      if (!Array.isArray(wAny.variants) || wAny.variants.length === 0) {
        issues.push({
          path: `widgets[${wAny.type}].variants`,
          message: `quiz widget '${wAny.type}' missing non-empty variants[] (FR-021)`,
          code: 'rubric-quiz-variants',
        });
      }
    }
  }
  // Concept-DAG check: every keyConcept exists; no concept used before its prereqs.
  for (const c of chapter.keyConcepts) {
    if (!(c in dag)) {
      issues.push({
        path: 'keyConcepts',
        message: `keyConcept '${c}' not in concept DAG`,
        code: 'dag-missing-concept',
      });
    }
  }

  // ── Engagement-widget floor (v1 — added 2026-05-23) ────────────────────
  // Per-domain minimum-engagement rules. STRICT for code; soft for medicine
  // and language (warning-tier — they have their own locked primary widgets).
  // The chapter-write prompt (`04a-chapter-write.md`) instructs Stage 4 to
  // emit these widgets; the validator enforces a minimum so a chapter cannot
  // ship as a wall-of-text.
  const widgetKinds = new Set<string>(chapter.widgets.map((w: { type: string }) => w.type));
  const domain = (chapter as unknown as { domain?: string }).domain;

  // CODE domain (strict floor). Per c-to-c audit: every code chapter must
  // have at least one quiz, at least one code-english-translation when code
  // is shown, and a glossary-tooltips entry on first jargon use.
  if (domain === 'code') {
    const hasQuiz = QUIZ_TYPES.has('mcq')
      ? chapter.widgets.some((w: { type: string }) => QUIZ_TYPES.has(w.type))
      : false;
    if (!hasQuiz) {
      issues.push({
        path: 'widgets',
        message: 'code-domain chapter has no quiz widget (≥1 required — mcq / spot-the-bug / matching-pair / fill-blank)',
        code: 'rubric-engagement-floor-code',
      });
    }
    // Any `<pre>` or `<code>` block in narrativeHtml → require ≥1 code-english-translation widget
    // Stage-3 syllabus uses `narrative` (planning text); Stage-4 chapter-write
    // produces `narrativeHtml`. We check both — whichever the validator's
    // input carries — for code blocks indicating a translation widget is owed.
    const narrativeStr =
      ((chapter as { narrativeHtml?: string }).narrativeHtml ?? '') +
      ((chapter as { narrative?: string }).narrative ?? '');
    const showsCode = /<pre|<code|```/i.test(narrativeStr);
    if (showsCode && !widgetKinds.has('code-english-translation')) {
      issues.push({
        path: 'widgets',
        message: 'code-domain chapter shows code in narrativeHtml but emits no code-english-translation widget — non-engineer readers lose context',
        code: 'rubric-engagement-floor-code',
      });
    }
    if (!widgetKinds.has('glossary-tooltips') && !widgetKinds.has('why-care-callout')) {
      issues.push({
        path: 'widgets',
        message: 'code-domain chapter is missing both glossary-tooltips AND why-care-callout — at least one engagement primitive required',
        code: 'rubric-engagement-floor-code',
      });
    }
  }

  // MEDICINE domain (additive guidance — does NOT block on missing universal
  // widgets since primary assessment is mcq-clinical-vignette). Surfaces a
  // soft note when clinical-algorithm content lacks flow-animation.
  if (domain === 'medicine') {
    const looksLikeAlgo = /algorithm|differential|workup|protocol|pathway/i.test(
      (chapter as { title?: string }).title ?? '',
    );
    if (looksLikeAlgo && !widgetKinds.has('flow-animation') && !widgetKinds.has('pathway-diagram')) {
      issues.push({
        path: 'widgets',
        message: 'medicine chapter looks algorithmic (title) but emits no flow-animation or pathway-diagram — ddx algorithms teach best as walks',
        code: 'rubric-engagement-floor-medicine',
      });
    }
  }

  // CONCEPTS domain (soft floor). Formula-heavy or proof-heavy chapters
  // benefit most from step-cards / flow-animation companion + mathjax.
  // Universal widgets carry the load here — no domain-locked primaries.
  if (domain === 'concepts') {
    const title = (chapter as { title?: string }).title ?? '';
    const looksFormulaic = /theorem|proof|formula|derivation|equation|model|algorithm|distribution/i.test(title);
    const hasFormulaPrimary =
      widgetKinds.has('mathjax') ||
      widgetKinds.has('reactive-math') ||
      widgetKinds.has('chart-xy');
    const hasExplainer =
      widgetKinds.has('step-cards') ||
      widgetKinds.has('flow-animation') ||
      widgetKinds.has('code-english-translation');
    if (looksFormulaic && hasFormulaPrimary && !hasExplainer) {
      issues.push({
        path: 'widgets',
        message: 'concepts chapter has a formula/chart primary but no companion explainer (step-cards / flow-animation / code-english-translation) — hyper-pedagogy pattern missed',
        code: 'rubric-engagement-floor-concepts',
      });
    }
  }

  // LANGUAGE domain (additive guidance). Conversational-content chapters
  // benefit most from group-chat-animation between native ↔ learner.
  if (domain === 'language-it' || domain === 'language-de') {
    const looksConversational = /dialog|conversation|greeting|order|small.?talk|register/i.test(
      (chapter as { title?: string }).title ?? '',
    );
    if (looksConversational && !widgetKinds.has('group-chat-animation') && !widgetKinds.has('audio-tts')) {
      issues.push({
        path: 'widgets',
        message: 'language chapter is conversational (title) but emits no group-chat-animation or audio-tts — native-speaker exposure lost',
        code: 'rubric-engagement-floor-language',
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

// ============================================================================
// 2026-05-23 — Lesson-level validator (syllabus + brief together)
//
// Per-chapter rules live in validateSyllabus(). Whole-lesson invariants
// (chapter count vs brief target/exact/atlas) need both pieces. This is
// the entry point for the chapter-count overrides + medicine atlas binding.
// ============================================================================

export function validateLesson(
  brief: unknown,
  syllabus: unknown[],
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const briefParsed = BriefSchema.safeParse(brief);
  if (!briefParsed.success) {
    return {
      ok: false,
      issues: briefParsed.error.issues.map((i) => ({
        path: `brief.${i.path.join('.')}`,
        message: i.message,
        code: 'zod' as const,
      })),
    };
  }
  const b = briefParsed.data;
  const n = syllabus.length;

  // ── Universal: chapter count constraints ─────────────────────
  if (b.chapterCountExact !== undefined) {
    if (n !== b.chapterCountExact) {
      issues.push({
        path: 'syllabus',
        message: `brief.chapterCountExact=${b.chapterCountExact} but syllabus has ${n} chapters — hard lock violated`,
        code: 'rubric-chapter-count-exact',
      });
    }
  } else if (b.chapterCountTarget !== undefined) {
    const diff = Math.abs(n - b.chapterCountTarget);
    if (diff > 1) {
      issues.push({
        path: 'syllabus',
        message: `brief.chapterCountTarget=${b.chapterCountTarget} allows ±1 (range ${b.chapterCountTarget - 1}-${b.chapterCountTarget + 1}); syllabus has ${n}`,
        code: 'rubric-chapter-count-target',
      });
    }
  }

  // ── Medicine: atlas binding ─────────────────────────────────
  if (b.domain === 'medicine' && b.clinicalAtlasUnits && b.clinicalAtlasUnits.length > 0) {
    if (n !== b.clinicalAtlasUnits.length) {
      issues.push({
        path: 'syllabus',
        message: `brief.clinicalAtlasUnits has ${b.clinicalAtlasUnits.length} entities but syllabus has ${n} chapters — one chapter per entity required`,
        code: 'rubric-medicine-atlas-mismatch',
      });
    }
    // Each chapter should bind to a known atlas unit
    const atlasSet = new Set(b.clinicalAtlasUnits);
    syllabus.forEach((ch, i) => {
      const chAny = ch as { clinicalAtlasUnit?: string; chapterNumber?: number };
      if (chAny.clinicalAtlasUnit && !atlasSet.has(chAny.clinicalAtlasUnit)) {
        issues.push({
          path: `syllabus[${i}].clinicalAtlasUnit`,
          message: `chapter ${chAny.chapterNumber} bound to '${chAny.clinicalAtlasUnit}' not in brief.clinicalAtlasUnits`,
          code: 'rubric-medicine-atlas-mismatch',
        });
      }
    });
  }

  // ── Medicine: per-chapter canonical sections ────────────────
  if (b.domain === 'medicine') {
    const level = b.medicalLevel;
    // Required minimum sections by level. Step 1 requires basic-science
    // (etio + path); Step 2 CK requires clinical-decision (cf + dx + tx);
    // others require the core. References + overview ALWAYS required.
    const requiredCore: ReadonlyArray<string> = ['overview', 'references'];
    const levelRequired: Record<string, ReadonlyArray<string>> = {
      'step-1':    ['etiology', 'pathophysiology', 'clinical-features'],
      'step-2-ck': ['clinical-features', 'diagnostics', 'treatment'],
      'step-2-cs': ['clinical-features', 'diagnostics'],
      'step-3':    ['clinical-features', 'diagnostics', 'treatment', 'complications', 'prognosis'],
      'shelf-medicine': ['clinical-features', 'diagnostics', 'treatment'],
      'shelf-peds':     ['epidemiology', 'clinical-features', 'diagnostics', 'treatment'],
      'shelf-surgery':  ['clinical-features', 'diagnostics', 'treatment', 'complications'],
      'shelf-ob-gyn':   ['epidemiology', 'clinical-features', 'diagnostics', 'treatment'],
      'shelf-psych':    ['clinical-features', 'diagnostics', 'treatment'],
      'shelf-family-med': ['clinical-features', 'diagnostics', 'treatment', 'prognosis'],
      'attending-ce':   ['clinical-features', 'diagnostics', 'treatment', 'complications', 'prognosis'],
      'intern':         ['overview', 'clinical-features', 'diagnostics', 'treatment'],
      'resident':       ['clinical-features', 'diagnostics', 'differential-diagnosis', 'treatment', 'complications'],
      'fellow':         ['pathophysiology', 'clinical-features', 'diagnostics', 'treatment', 'complications', 'prognosis'],
    };
    const levelReq = level ? (levelRequired[level] ?? []) : [];
    const required = [...new Set([...requiredCore, ...levelReq])];
    const canonicalOrder = CANONICAL_MEDICINE_SECTIONS as ReadonlyArray<string>;

    syllabus.forEach((ch, i) => {
      const chAny = ch as { medicineSections?: string[]; chapterNumber?: number };
      const sections = chAny.medicineSections ?? [];
      // Missing required
      const missing = required.filter((s) => !sections.includes(s));
      if (missing.length > 0) {
        issues.push({
          path: `syllabus[${i}].medicineSections`,
          message: `chapter ${chAny.chapterNumber} missing required sections for level=${level ?? 'unspecified'}: ${missing.join(', ')}`,
          code: 'rubric-medicine-sections-missing',
        });
      }
      // Out of canonical order
      const indices = sections.map((s) => canonicalOrder.indexOf(s));
      for (let k = 1; k < indices.length; k++) {
        if (indices[k] !== -1 && indices[k - 1] !== -1 && indices[k] < indices[k - 1]) {
          issues.push({
            path: `syllabus[${i}].medicineSections[${k}]`,
            message: `chapter ${chAny.chapterNumber} sections out of canonical order at '${sections[k]}' — see CANONICAL_MEDICINE_SECTIONS`,
            code: 'rubric-medicine-sections-out-of-order',
          });
          break;
        }
      }
    });
  }

  return { ok: issues.length === 0, issues };
}
