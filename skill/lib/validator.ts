import { BriefSchema, type Brief } from './schemas/brief.js';
import { ChapterSyllabusSchema, type ChapterSyllabus } from './schemas/chapter-syllabus.js';

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
    | 'rubric-quiz-variants';
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
  const QUIZ_TYPES = new Set([
    'mcq',
    'true-false',
    'fill-blank',
    'matching',
    'spot-the-bug',
    'agreement-matrix',
    'sentence-reorder',
    'vignette',
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

  return { ok: issues.length === 0, issues };
}
