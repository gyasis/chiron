/**
 * WidgetSpec contract — canonical TypeScript definition of all 21 widget variants
 * supported by Chiron v1. Mirrors PRD §6 plus FR-018, FR-019, FR-020, FR-021, FR-031.
 *
 * Discriminated-union pattern (Constitution III + PRD §3 #5): the LLM fills the slots,
 * Zod validates at runtime, the renderer enforces the shape. NOT a string-templating DSL.
 *
 * Every quiz-type widget carries `variants: Variant[]` for anti-gaming (FR-021):
 * at render time, one variant is randomly merged over the base.
 */

// ----------------------------------------------------------------------------
// Common
// ----------------------------------------------------------------------------

export type Difficulty = 1 | 2 | 3 | 4 | 5;

export interface Variant {
  // Each quiz-type widget has variants[]; runtime randomly picks one and merges
  // it over the base, producing a fresh question per attempt.
  [key: string]: unknown;
}

export interface McqOption {
  label: string;
  correct?: boolean;
  explanation: string;
}

// ----------------------------------------------------------------------------
// Quiz-type widgets (carry variants[])
// ----------------------------------------------------------------------------

export type WidgetSpec =
  // ---- Universal quiz primitives ----
  | {
      type: 'mcq';
      stem: string;
      options: McqOption[];                  // 2..5
      difficulty?: Difficulty;
      variants: Variant[];
    }
  | {
      // Medicine-only required structure (FR-019).
      // 5 options, per-distractor explanation, Hammer 1-5, Attending Tip, keyInfo tags.
      type: 'mcq-clinical-vignette';
      vignette: string;                      // 5-7 sentence stem
      keyInfo: string[];                     // tags rendered as <keyinfo> chips
      stem: string;                          // leading question
      options: [McqOption, McqOption, McqOption, McqOption, McqOption]; // exactly 5
      hammer: Difficulty;                    // 1-5
      attendingTip: string;
      vignetteCategory:                      // taxonomy enforcement (FR-019)
        | 'classic' | 'atypical' | 'pediatric' | 'elderly'
        | 'immunocompromised' | 'pregnancy' | 'comorbidity' | 'mimicker';
      variants: Variant[];
    }
  | {
      type: 'true-false';
      statement: string;
      correct: boolean;
      explanation: string;
      variants: Variant[];
    }
  | {
      // Languages — fuzzy umlaut/accent matching per FR-020.
      type: 'fill-blank';
      sentence: string;                      // contains "___" markers, one per blank
      blanks: Array<{
        answer: string;
        alternates?: string[];
        fuzzyMatch?: 'umlaut' | 'accent' | 'none';
      }>;
      variants: Variant[];
    }
  | {
      type: 'matching-pair';
      pairs: Array<{ left: string; right: string }>;
      mode: '1to1' | 'NtoN';
      variants: Variant[];
    }
  | {
      type: 'cloze';
      sentence: string;                      // contains numbered slots {{1}}, {{2}}, ...
      blanks: number[];                      // ordered list of slot numbers
      ankiCompatible: true;
      variants: Variant[];
    }
  | {
      type: 'spot-the-bug';
      codeBlock: string;
      bugLine: number;                       // 1-indexed
      explanation: string;
      variants: Variant[];
    }
  | {
      type: 'agreement-matrix';
      statements: string[];
      classifications: Array<'always' | 'sometimes' | 'never'>;
      variants: Variant[];
    }
  | {
      type: 'assertion-reason';
      assertion: string;
      reason: string;
      correctRelationship:
        | 'both-true-reason-explains'
        | 'both-true-reason-doesnt-explain'
        | 'assertion-true-reason-false'
        | 'assertion-false-reason-true'
        | 'both-false';
      variants: Variant[];
    }
  | {
      type: 'confidence-weighted';
      mcq: {
        stem: string;
        options: McqOption[];
      };
      askConfidence: true;
      variants: Variant[];
    }
  | {
      type: 'slider-estimation';
      question: string;
      correctValue: number;
      acceptableRange: number;               // ± from correctValue
      unit: string;
      variants: Variant[];
    }
  | {
      // End-of-chapter "boss" — open-ended explanation graded by rubric.
      type: 'boss';
      question: string;
      requiredConcepts: string[];
      rubric: string;
      variants: Variant[];
    }

  // ---- Renderable (non-quiz) widgets — exposition / dynamic content ----
  | {
      // \ce{...} via MathJax + mhchem
      type: 'chemical-reaction';
      equation: string;
    }
  | {
      // Concrete library deferred to Phase 4 prototype (FR-031, R-02).
      // Renderer is the abstract MoleculeRenderer interface.
      type: 'molecule-2d';
      smiles: string;
    }
  | {
      type: 'pathway-diagram';
      nodes: Array<{ id: string; label: string }>;
      edges: Array<{ from: string; to: string; label?: string }>;
      renderer: 'mermaid' | 'd3-custom';
    }
  | {
      type: 'mermaid';
      source: string;
    }
  | {
      type: 'mathjax';
      source: string;
    }
  | {
      // ChalkAI runtime loaded on-demand (PRD §3 #11).
      type: 'reactive-math';
      chalkDsl: string;
    }
  | {
      // Pyodide loaded lazily from CDN if present in chapter (R-03).
      type: 'code-runner';
      language: 'python' | 'javascript';
      initialCode: string;
      runtime: 'pyodide' | 'native';
    }
  | {
      type: 'forest-plot';
      studies: Array<{
        label: string;
        effect: number;
        ci: [number, number];
      }>;
    }
  | {
      // Language-only — Maria Italian native-speaker TTS via Gemini (R-01).
      type: 'audio-tts';
      transcript: string;
      voice: string;                         // persona voice ID
    };
