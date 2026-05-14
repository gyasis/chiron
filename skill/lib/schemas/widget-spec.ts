/**
 * Chiron — Zod runtime schema for WidgetSpec (T015).
 *
 * Mirrors `specs/001-chiron-v1/contracts/widget-spec.ts` 1:1 as a Zod
 * discriminated union keyed on `type`. The 21 widget variants are the canonical
 * set per FR-018; quiz-type widgets carry `variants[]` for FR-021 anti-gaming.
 *
 * Inferred TS types are exported via `z.infer` so callers may import either
 * the runtime schema (for parsing untrusted LLM output) or the type alone.
 */

import { z } from 'zod';

// ----------------------------------------------------------------------------
// Common
// ----------------------------------------------------------------------------

export const DifficultySchema = z.union([
  z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5),
]);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const VariantSchema = z.record(z.string(), z.unknown());
export type Variant = z.infer<typeof VariantSchema>;

export const McqOptionSchema = z.object({
  label: z.string(),
  text: z.string().optional(),
  correct: z.boolean().optional(),
  explanation: z.string(),
});
export type McqOption = z.infer<typeof McqOptionSchema>;

const variantsField = z.array(VariantSchema);

// ----------------------------------------------------------------------------
// Quiz-type widgets (carry variants[])
// ----------------------------------------------------------------------------

export const McqWidgetSchema = z.object({
  type: z.literal('mcq'),
  stem: z.string(),
  options: z.array(McqOptionSchema).min(2).max(5),
  difficulty: DifficultySchema.optional(),
  variants: variantsField,
});

export const McqClinicalVignetteWidgetSchema = z.object({
  type: z.literal('mcq-clinical-vignette'),
  vignette: z.string(),
  keyInfo: z.array(z.string()),
  stem: z.string(),
  options: z.tuple([
    McqOptionSchema, McqOptionSchema, McqOptionSchema, McqOptionSchema, McqOptionSchema,
  ]),
  hammer: DifficultySchema,
  attendingTip: z.string(),
  vignetteCategory: z.enum([
    'classic', 'atypical', 'pediatric', 'elderly',
    'immunocompromised', 'pregnancy', 'comorbidity', 'mimicker',
  ]),
  variants: variantsField,
});

export const TrueFalseWidgetSchema = z.object({
  type: z.literal('true-false'),
  statement: z.string(),
  correct: z.boolean(),
  explanation: z.string(),
  variants: variantsField,
});

export const FillBlankWidgetSchema = z.object({
  type: z.literal('fill-blank'),
  sentence: z.string(),
  blanks: z.array(z.object({
    answer: z.string(),
    alternates: z.array(z.string()).optional(),
    fuzzyMatch: z.enum(['umlaut', 'accent', 'none']).optional(),
  })),
  variants: variantsField,
});

export const MatchingPairWidgetSchema = z.object({
  type: z.literal('matching-pair'),
  pairs: z.array(z.object({ left: z.string(), right: z.string() })),
  mode: z.enum(['1to1', 'NtoN']),
  variants: variantsField,
});

export const ClozeWidgetSchema = z.object({
  type: z.literal('cloze'),
  sentence: z.string(),
  blanks: z.array(z.number().int()),
  ankiCompatible: z.literal(true),
  variants: variantsField,
});

export const SpotTheBugWidgetSchema = z.object({
  type: z.literal('spot-the-bug'),
  id: z.string().optional(),
  codeBlock: z.string(),
  language: z.string().optional(),
  bugLine: z.number().int().min(1),
  explanation: z.string(),
  variants: variantsField,
});

export const AgreementMatrixWidgetSchema = z.object({
  type: z.literal('agreement-matrix'),
  id: z.string().optional(),
  promptText: z.string().optional(),
  statements: z.array(z.string()),
  classifications: z.array(z.enum(['always', 'sometimes', 'never'])),
  options: z.array(z.string()).optional(),
  rationale: z.array(z.string()).optional(),
  variants: variantsField,
});

export const AssertionReasonWidgetSchema = z.object({
  type: z.literal('assertion-reason'),
  id: z.string().optional(),
  assertion: z.string(),
  reason: z.string(),
  correctRelationship: z.enum([
    'both-true-reason-explains',
    'both-true-reason-doesnt-explain',
    'assertion-true-reason-false',
    'assertion-false-reason-true',
    'both-false',
  ]),
  options: z.array(z.object({
    label: z.string(),
    text: z.string(),
    correct: z.boolean(),
  })).optional(),
  explanation: z.string().optional(),
  variants: variantsField,
});

export const ConfidenceWeightedWidgetSchema = z.object({
  type: z.literal('confidence-weighted'),
  mcq: z.object({
    stem: z.string(),
    options: z.array(McqOptionSchema),
  }),
  askConfidence: z.literal(true),
  variants: variantsField,
});

export const SliderEstimationWidgetSchema = z.object({
  type: z.literal('slider-estimation'),
  id: z.string().optional(),
  question: z.string(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  correctValue: z.number(),
  acceptableRange: z.number().optional(),
  tolerance: z.number().optional(),
  unit: z.string(),
  explanation: z.string().optional(),
  variants: variantsField,
});

export const BossWidgetSchema = z.object({
  type: z.literal('boss'),
  question: z.string(),
  requiredConcepts: z.array(z.string()),
  rubric: z.string(),
  variants: variantsField,
});

// ----------------------------------------------------------------------------
// Renderable (non-quiz) widgets
// ----------------------------------------------------------------------------

export const ChemicalReactionWidgetSchema = z.object({
  type: z.literal('chemical-reaction'),
  id: z.string().optional(),
  label: z.string().optional(),
  equation: z.string(),
  mhchemNotation: z.string().optional(),
  explanation: z.string().optional(),
});

export const Molecule2dWidgetSchema = z.object({
  type: z.literal('molecule-2d'),
  id: z.string().optional(),
  label: z.string().optional(),
  smiles: z.string(),
  alternateNames: z.array(z.string()).optional(),
  explanation: z.string().optional(),
});

export const PathwayDiagramWidgetSchema = z.object({
  type: z.literal('pathway-diagram'),
  nodes: z.array(z.object({ id: z.string(), label: z.string() })),
  edges: z.array(z.object({
    from: z.string(),
    to: z.string(),
    label: z.string().optional(),
  })),
  renderer: z.enum(['mermaid', 'd3-custom']),
});

export const MermaidWidgetSchema = z.object({
  type: z.literal('mermaid'),
  source: z.string(),
});

export const MathjaxWidgetSchema = z.object({
  type: z.literal('mathjax'),
  source: z.string(),
});

export const ReactiveMathWidgetSchema = z.object({
  type: z.literal('reactive-math'),
  chalkDsl: z.string(),
});

export const CodeRunnerWidgetSchema = z.object({
  type: z.literal('code-runner'),
  language: z.enum(['python', 'javascript']),
  initialCode: z.string(),
  runtime: z.enum(['pyodide', 'native']),
});

export const ForestPlotWidgetSchema = z.object({
  type: z.literal('forest-plot'),
  id: z.string().optional(),
  title: z.string().optional(),
  studies: z.array(z.object({
    label: z.string(),
    effect: z.number(),
    ci: z.tuple([z.number(), z.number()]),
    weight: z.number().optional(),
    n: z.number().int().optional(),
  })),
  pooledEffect: z.number().optional(),
  pooledCi: z.tuple([z.number(), z.number()]).optional(),
  effectMetric: z.enum(['OR', 'RR', 'HR', 'MD']).optional(),
  modelType: z.enum(['fixed-effects', 'random-effects']).optional(),
  heterogeneityI2: z.number().optional(),
  heterogeneityP: z.number().optional(),
  explanation: z.string().optional(),
  variants: variantsField.optional(),
});

export const AudioTtsWidgetSchema = z.object({
  type: z.literal('audio-tts'),
  transcript: z.string(),
  voice: z.string(),
});

// ----------------------------------------------------------------------------
// match-madness — multi-set timed retrieval anchor (PRD §4.10–4.12, 2026-05-14)
//
// Domain-agnostic. The `mode` field on each set drives content shape:
//   - vocab-pair, term-def, formula-result : universal (any domain)
//   - gender-pair, prep-pair, collocation, conjugation : language only
//   - mixed : super-set drawing from prior sets
//
// Per-language helpers (e.g. Italian conjugator) live in
// `skill/lib/widgets/match-madness.ts`. The widget itself is universal.
// ----------------------------------------------------------------------------

export const MmModeSchema = z.enum([
  'vocab-pair', 'gender-pair', 'prep-pair', 'collocation',
  'conjugation', 'mixed', 'term-def', 'formula-result',
]);

export const MmPairSchema = z.object({
  id: z.string(),
  left: z.string(),
  right: z.string(),
  hint: z.string().optional(),
});

export const MmSetSchema = z.object({
  id: z.string(),
  index: z.number().int().min(1),
  title: z.string(),
  subtitle: z.string().optional(),
  mode: MmModeSchema,
  rounds: z.number().int().min(1).max(20),
  pairs: z.array(MmPairSchema).min(5),
  timerSec: z.number().int().min(30).max(600).optional(),
  wrongLockMs: z.number().int().min(100).max(5000).optional(),
  drawsFromSetIds: z.array(z.string()).optional(),
});

export const MmVisualSpeedUpSchema = z.object({
  pulseFromMs: z.number().int().default(2000),
  pulseToMs: z.number().int().default(600),
  strengthFromOpacity: z.number().default(0.04),
  strengthToOpacity: z.number().default(0.18),
  refillFromMs: z.number().int().default(200),
  refillToMs: z.number().int().default(100),
});

export const MatchMadnessWidgetSchema = z.object({
  type: z.literal('match-madness'),
  lessonId: z.string(),
  domain: z.enum(['language-it', 'language-de', 'medicine', 'code']),
  title: z.string().default('Match Madness'),
  description: z.string().optional(),
  defaults: z.object({
    timerSec: z.number().int().default(105),
    wrongLockMs: z.number().int().default(1500),
    accessibilityModeAllowed: z.boolean().default(true),
    keyboardShortcuts: z.boolean().default(true),
    visualSpeedUp: MmVisualSpeedUpSchema.default({}),
  }),
  sets: z.array(MmSetSchema).min(1),
  unlockAccuracyThreshold: z.number().min(0).max(1).default(0.6),
  superSetUnlockAfterNSetsCompleted: z.number().int().min(0).default(3),
});

// ----------------------------------------------------------------------------
// language-flashcard-deck — rich SR cards with conjugation paradigms
//
// Front: headword. Back: gloss + 4-tense table (verbs) or article + gloss
// (nouns) or meaning + literal (idioms). The renderer reuses the per-language
// conjugator in `skill/lib/widgets/match-madness.ts`.
// ----------------------------------------------------------------------------

export const LangVerbEntrySchema = z.object({
  infinitive: z.string(),
  family: z.enum(['are', 'ere', 'ire', 'isco-ire']),
  englishGloss: z.string(),
  participle: z.string().optional(),
  auxiliary: z.enum(['ho', 'sono']).optional(),
  irregular: z.record(z.string(), z.string()).optional(),
});

export const LangNounEntrySchema = z.object({
  it: z.string(),
  en: z.string(),
  article: z.enum(['la', 'lo', 'il', "l'", 'le', 'gli', 'i']),
  bare: z.string(),
  pairsWith: z.string().optional(),
  plural: z.string().optional(),
  note: z.string().optional(),
});

export const LangIdiomEntrySchema = z.object({
  it: z.string(),
  literal: z.string().optional(),
  meaning: z.string(),
});

export const LanguageFlashcardDeckWidgetSchema = z.object({
  type: z.literal('language-flashcard-deck'),
  language: z.enum(['it', 'de']),
  verbs: z.array(LangVerbEntrySchema).default([]),
  nouns: z.array(LangNounEntrySchema).default([]),
  idioms: z.array(LangIdiomEntrySchema).default([]),
});

// ----------------------------------------------------------------------------
// Discriminated union — the public schema
// ----------------------------------------------------------------------------

const WidgetUnionSchema = z.discriminatedUnion('type', [
  // Quiz primitives
  McqWidgetSchema,
  McqClinicalVignetteWidgetSchema,
  TrueFalseWidgetSchema,
  FillBlankWidgetSchema,
  MatchingPairWidgetSchema,
  ClozeWidgetSchema,
  SpotTheBugWidgetSchema,
  AgreementMatrixWidgetSchema,
  AssertionReasonWidgetSchema,
  ConfidenceWeightedWidgetSchema,
  SliderEstimationWidgetSchema,
  BossWidgetSchema,
  // Renderables
  ChemicalReactionWidgetSchema,
  Molecule2dWidgetSchema,
  PathwayDiagramWidgetSchema,
  MermaidWidgetSchema,
  MathjaxWidgetSchema,
  ReactiveMathWidgetSchema,
  CodeRunnerWidgetSchema,
  ForestPlotWidgetSchema,
  AudioTtsWidgetSchema,
  // Retrieval-practice anchors (PRD canonical_shell_and_match_madness §4.10–4.12)
  MatchMadnessWidgetSchema,
  LanguageFlashcardDeckWidgetSchema,
]);

/**
 * Cross-field refinements that can't live on individual ZodObject members
 * (because `discriminatedUnion` requires raw ZodObject — not ZodEffects).
 * Applied at the union level via superRefine.
 */
export const WidgetSchema = WidgetUnionSchema.superRefine((val, ctx) => {
  // T135: slider-estimation must have at least one of acceptableRange or tolerance
  if (val.type === 'slider-estimation') {
    if (val.acceptableRange === undefined && val.tolerance === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'slider-estimation requires at least one of `acceptableRange` or `tolerance`',
        path: ['acceptableRange'],
      });
    }
  }
  // T139: agreement-matrix rationale.length must equal statements.length
  if (val.type === 'agreement-matrix') {
    if (val.rationale !== undefined && val.rationale.length !== val.statements.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'rationale.length must equal statements.length',
        path: ['rationale'],
      });
    }
  }
});

export type WidgetSpec = z.infer<typeof WidgetSchema>;
export type WidgetKind = WidgetSpec['type'];

/** Backwards-compatible alias used by some callers. */
export const WidgetSpecSchema = WidgetSchema;

/** Set of all 23 widget kinds — handy for renderer dispatch tables. */
export const WIDGET_KINDS: WidgetKind[] = [
  'mcq', 'mcq-clinical-vignette', 'true-false', 'fill-blank', 'matching-pair',
  'cloze', 'spot-the-bug', 'agreement-matrix', 'assertion-reason',
  'confidence-weighted', 'slider-estimation', 'boss',
  'chemical-reaction', 'molecule-2d', 'pathway-diagram', 'mermaid', 'mathjax',
  'reactive-math', 'code-runner', 'forest-plot', 'audio-tts',
  'match-madness', 'language-flashcard-deck',
];
