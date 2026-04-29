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
  codeBlock: z.string(),
  bugLine: z.number().int().min(1),
  explanation: z.string(),
  variants: variantsField,
});

export const AgreementMatrixWidgetSchema = z.object({
  type: z.literal('agreement-matrix'),
  statements: z.array(z.string()),
  classifications: z.array(z.enum(['always', 'sometimes', 'never'])),
  variants: variantsField,
});

export const AssertionReasonWidgetSchema = z.object({
  type: z.literal('assertion-reason'),
  assertion: z.string(),
  reason: z.string(),
  correctRelationship: z.enum([
    'both-true-reason-explains',
    'both-true-reason-doesnt-explain',
    'assertion-true-reason-false',
    'assertion-false-reason-true',
    'both-false',
  ]),
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
  question: z.string(),
  correctValue: z.number(),
  acceptableRange: z.number(),
  unit: z.string(),
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
  equation: z.string(),
});

export const Molecule2dWidgetSchema = z.object({
  type: z.literal('molecule-2d'),
  smiles: z.string(),
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
  studies: z.array(z.object({
    label: z.string(),
    effect: z.number(),
    ci: z.tuple([z.number(), z.number()]),
  })),
});

export const AudioTtsWidgetSchema = z.object({
  type: z.literal('audio-tts'),
  transcript: z.string(),
  voice: z.string(),
});

// ----------------------------------------------------------------------------
// Discriminated union — the public schema
// ----------------------------------------------------------------------------

export const WidgetSchema = z.discriminatedUnion('type', [
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
]);

export type WidgetSpec = z.infer<typeof WidgetSchema>;
export type WidgetKind = WidgetSpec['type'];

/** Backwards-compatible alias used by some callers. */
export const WidgetSpecSchema = WidgetSchema;

/** Set of all 21 widget kinds — handy for renderer dispatch tables. */
export const WIDGET_KINDS: WidgetKind[] = [
  'mcq', 'mcq-clinical-vignette', 'true-false', 'fill-blank', 'matching-pair',
  'cloze', 'spot-the-bug', 'agreement-matrix', 'assertion-reason',
  'confidence-weighted', 'slider-estimation', 'boss',
  'chemical-reaction', 'molecule-2d', 'pathway-diagram', 'mermaid', 'mathjax',
  'reactive-math', 'code-runner', 'forest-plot', 'audio-tts',
];
