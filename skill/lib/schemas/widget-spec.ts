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
// Universal widgets (v1 — additive; usable in code / medicine / language)
//
// Added 2026-05-23 after codebase-to-course audit. These widgets fill the
// "engagement primitives" gap that was empirically present across all three
// chiron domains: chiron-shell.css carried the CSS classes (.chat-window,
// .flow-animation, .term-tooltip, etc.) but no schema kind referenced them,
// so no Stage-4 prompt could produce them. The lesson v1 sandbox
// (lessons/graphiti-implementation-2026-05-23-v1/) is the design target.
//
// IMPORTANT — these are ADDITIVE for medicine and language. Medicine still
// uses mcq-clinical-vignette / agreement-matrix / pathway-diagram as primary
// assessment. Language still uses conjugation / audio-tts / match-madness as
// primary practice. The universal widgets show up ALONGSIDE those, not in
// place of them.
// ----------------------------------------------------------------------------

/** Group chat animation — iMessage/WeChat-style multi-actor dialog reveal.
 *  Universal. Each message reveals on "Next" via chiron-shell's chat engine.
 *  Use cases: code = system/agent dialog; medicine = attending↔resident,
 *  drug↔receptor; language = native-speaker↔learner roleplay. */
export const GroupChatAnimationSchema = z.object({
  type: z.literal('group-chat-animation'),
  id: z.string(),
  title: z.string().optional(),
  framing: z.string().optional(),       // brief one-line lead-in shown above the chat
  messages: z.array(z.object({
    sender: z.string(),                  // actor id (e.g., "you", "agent", "native-speaker")
    senderLabel: z.string(),             // display name
    avatarChar: z.string().min(1).max(2),// 1-2 char initial / emoji
    avatarColorVar: z.string().optional(),// e.g., "--chiron-accent" — defaults to the sender's auto-color
    body: z.string(),                    // bubble text (can contain inline <code>)
  })).min(2),
});

/** Flow / data-flow / decision-tree animation. Universal — the same engine
 *  drives code data-flows AND medical algorithm walks AND language
 *  sentence-construction sequences.
 *
 *  Each `step` highlights one actor and optionally animates a "packet" from
 *  one actor to another, with a step label. The renderer wires this to
 *  chiron-shell's flow engine; the host page needs no extra JS. */
export const FlowAnimationSchema = z.object({
  type: z.literal('flow-animation'),
  id: z.string(),
  title: z.string().optional(),
  intro: z.string().optional(),
  actors: z.array(z.object({
    id: z.string(),                      // actor id; referenced by steps[].highlight + .from/.to
    label: z.string(),
    icon: z.string().optional(),         // single emoji or 1-2 char
  })).min(2),
  steps: z.array(z.object({
    label: z.string(),                   // shown in the .flow-step-label
    highlight: z.string().optional(),    // actor id to light up
    packet: z.boolean().optional(),      // true = animate a packet
    from: z.string().optional(),         // actor id (when packet=true)
    to: z.string().optional(),           // actor id (when packet=true)
  })).min(1),
});

/** Inline glossary tooltip set. Universal — every domain has jargon.
 *  Renderer emits a small inline span per (term, definition) pair via
 *  chiron-shell's .term / .term-tooltip pattern, and Stage 4 prose can
 *  reference any of these terms by string-match for auto-tooltip injection.
 *  USAGE: every CS term (code), clinical term (medicine), or vocabulary
 *  word (language) on first mention in a chapter should appear here. */
export const GlossaryTooltipsSchema = z.object({
  type: z.literal('glossary-tooltips'),
  id: z.string(),
  entries: z.array(z.object({
    term: z.string().min(1),
    definition: z.string().min(1),
    firstMentionChapter: z.number().int().min(1).optional(),
  })).min(1),
});

/** Pattern / feature cards. Universal — code patterns, drug classes,
 *  verb families. A small grid of cards each with a title + body + footer. */
export const PatternCardsSchema = z.object({
  type: z.literal('pattern-cards'),
  id: z.string(),
  title: z.string().optional(),
  cards: z.array(z.object({
    num: z.string().optional(),          // e.g., "Move 1", "Class A"
    title: z.string(),
    body: z.string(),
    foot: z.string().optional(),         // small footer text — typically the lever/cost
  })).min(2),
});

/** Numbered step cards. Universal — process steps, clinical protocols,
 *  sentence construction. Static companion to flow-animation. */
export const StepCardsSchema = z.object({
  type: z.literal('step-cards'),
  id: z.string(),
  title: z.string().optional(),
  steps: z.array(z.object({
    n: z.number().int().min(1),
    label: z.string(),                   // short caption like "Anchor", "Expand"
    body: z.string(),                    // 1-2 sentence detail
  })).min(2),
});

/** Visual file/path tree. Universal — file system (code), anatomy/taxonomy
 *  (medicine), morphology trees (language).  The renderer indents by .depth. */
export const FileTreeSchema = z.object({
  type: z.literal('file-tree'),
  id: z.string(),
  title: z.string().optional(),
  lines: z.array(z.object({
    depth: z.number().int().min(1).max(6),
    icon: z.string().optional(),         // emoji or short string
    name: z.string(),
    tag: z.string().optional(),          // small badge text on the right
    highlight: z.boolean().optional(),
  })).min(1),
});

/** Permission / cost / status badge. Tiny atomic widget — universal.
 *  Renderer emits a single .badge span. Variants control color. */
export const PermissionBadgeSchema = z.object({
  type: z.literal('permission-badge'),
  id: z.string(),
  label: z.string().min(1),
  variant: z.enum(['free', 'paid', 'hot', 'read']),  // color cue
});

/** Layer-toggle. Universal — two-axis comparisons (code = group_id vs
 *  entity_type; medicine = diagnosis vs differential; language = formal
 *  vs informal register).  Shows axis A only / axis B only / both. */
export const LayerToggleSchema = z.object({
  type: z.literal('layer-toggle'),
  id: z.string(),
  caption: z.string().optional(),
  axes: z.array(z.object({
    key: z.string(),                     // "1" / "2" / etc.
    label: z.string(),                   // button label
    title: z.string(),                   // bold title in the panel
    body: z.string(),                    // panel body markdown-light
  })).min(2),
  defaultShow: z.string().default('both'),
});

/** "Why you care" callout. Universal — codifies codebase-to-course's
 *  "answer 'why should I care?' before 'how does it work?'" rule.
 *  Renderer emits a left-bar callout above chapter content. */
export const WhyCareCalloutSchema = z.object({
  type: z.literal('why-care-callout'),
  id: z.string(),
  body: z.string().min(1),               // 1-3 sentence rationale
});

// ----------------------------------------------------------------------------
// Code-only widget (v1) — needs literal source code on the left
// ----------------------------------------------------------------------------

/** Code↔English translation block. CODE-ONLY (no analog in medicine/lang).
 *  Side-by-side: code lines on left, plain-English explanation on right,
 *  row N pairs across both sides via chiron-shell's row-tint cycle.
 *  Originates from codebase-to-course; lives here under chiron's schema. */
export const CodeEnglishTranslationSchema = z.object({
  type: z.literal('code-english-translation'),
  id: z.string(),
  domain: z.literal('code'),             // schema-level enforcement
  codeLabel: z.string().default('CODE'),
  englishLabel: z.string().default('PLAIN ENGLISH'),
  language: z.string().default('python'),// syntax-highlight hint
  pairs: z.array(z.object({
    code: z.string(),                    // the code line (preserve indentation)
    english: z.string(),                 // the plain-English explanation for THIS line
  })).min(2),
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
  // Universal engagement primitives (v1 — added 2026-05-23, all 3 domains)
  GroupChatAnimationSchema,
  FlowAnimationSchema,
  GlossaryTooltipsSchema,
  PatternCardsSchema,
  StepCardsSchema,
  FileTreeSchema,
  PermissionBadgeSchema,
  LayerToggleSchema,
  WhyCareCalloutSchema,
  // Code-only widget (v1)
  CodeEnglishTranslationSchema,
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
  // 2026-05-23: flow-animation — every step.highlight / .from / .to must
  // reference an existing actor.id. Catches typos at validate time, not at
  // runtime when the engine silently fails to highlight.
  if (val.type === 'flow-animation') {
    const ids = new Set(val.actors.map(a => a.id));
    val.steps.forEach((s, i) => {
      (['highlight', 'from', 'to'] as const).forEach(field => {
        const v = s[field];
        if (v !== undefined && !ids.has(v)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `flow-animation step[${i}].${field} = "${v}" does not match any actor.id`,
            path: ['steps', i, field],
          });
        }
      });
      if (s.packet === true && (s.from === undefined || s.to === undefined)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `flow-animation step[${i}] has packet=true but missing 'from' or 'to'`,
          path: ['steps', i, 'packet'],
        });
      }
    });
  }
  // 2026-05-23: code-english-translation — code and english arrays must be
  // the same length (one-to-one row pairing is the whole point of the widget).
  if (val.type === 'code-english-translation') {
    // pairs already enforces this via .object — no extra check needed
    // (kept as a hook for future "min 2 pairs" extension)
  }
});

export type WidgetSpec = z.infer<typeof WidgetSchema>;
export type WidgetKind = WidgetSpec['type'];

/** Backwards-compatible alias used by some callers. */
export const WidgetSpecSchema = WidgetSchema;

/** Set of all 33 widget kinds — handy for renderer dispatch tables. */
export const WIDGET_KINDS: WidgetKind[] = [
  // Quiz primitives
  'mcq', 'mcq-clinical-vignette', 'true-false', 'fill-blank', 'matching-pair',
  'cloze', 'spot-the-bug', 'agreement-matrix', 'assertion-reason',
  'confidence-weighted', 'slider-estimation', 'boss',
  // Domain-specific renderables
  'chemical-reaction', 'molecule-2d', 'pathway-diagram', 'mermaid', 'mathjax',
  'reactive-math', 'code-runner', 'forest-plot', 'audio-tts',
  // Retrieval-practice anchors
  'match-madness', 'language-flashcard-deck',
  // Universal engagement primitives (v1)
  'group-chat-animation', 'flow-animation', 'glossary-tooltips',
  'pattern-cards', 'step-cards', 'file-tree', 'permission-badge',
  'layer-toggle', 'why-care-callout',
  // Code-only (v1)
  'code-english-translation',
];

/** Which widgets are universal (no domain constraint) vs domain-gated.
 *  Used by the validator (03-validate-rubric) + Stage 4 prompts to know
 *  what to offer for a given chapter. */
export const UNIVERSAL_WIDGETS: WidgetKind[] = [
  'mcq', 'true-false', 'mermaid', 'mathjax',
  'group-chat-animation', 'flow-animation', 'glossary-tooltips',
  'pattern-cards', 'step-cards', 'file-tree', 'permission-badge',
  'layer-toggle', 'why-care-callout',
];
export const CODE_ONLY_WIDGETS: WidgetKind[] = [
  'spot-the-bug', 'code-runner', 'code-english-translation',
];
export const MEDICINE_ONLY_WIDGETS: WidgetKind[] = [
  'mcq-clinical-vignette', 'agreement-matrix', 'assertion-reason',
  'chemical-reaction', 'molecule-2d', 'pathway-diagram',
  'reactive-math', 'forest-plot', 'slider-estimation', 'boss',
  'confidence-weighted',
];
export const LANGUAGE_ONLY_WIDGETS: WidgetKind[] = [
  'fill-blank', 'matching-pair', 'cloze',
  'audio-tts', 'match-madness', 'language-flashcard-deck',
];
