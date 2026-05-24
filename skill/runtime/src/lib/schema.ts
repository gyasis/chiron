// ChironLesson schema — typed contract between LLM emission and Svelte runtime.
// The lesson.json file conforms to ChironLesson; renderer is in Lesson.svelte.

export type Block =
  | { type: 'objective'; text: string }
  | { type: 'paragraph'; html: string }                                   // small inline HTML allowed (strong/em/code/sup)
  | { type: 'heading'; level: 2 | 3; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }                   // each item: inline-HTML allowed
  | { type: 'table'; headers: string[]; rows: string[][] }                // cells: inline-HTML allowed
  | { type: 'highYield'; items: string[] }
  | { type: 'mnemonic'; text: string }
  | { type: 'pearl'; text: string }
  | { type: 'dialogue'; turns: { persona: 'alice' | 'bob' | 'tutor'; speaker: string; body: string }[] }
  | { type: 'quiz'; quiz: Quiz }
  | { type: 'deck'; cards: { front: string; back: string }[] }
  | { type: 'deepVignette'; badge: string; quiz: Quiz; vignette: string }; // vignette: inline-HTML stem

export interface Quiz {
  qid: string;
  qhead: string;        // e.g. "Question 1 of 17"
  qstem: string;        // inline-HTML allowed
  options: { key: string; text: string }[];
  correct: string;      // option key
  feedback: {
    headline: string;
    body: string;       // inline-HTML allowed
    distractors: { key: string; body: string }[];   // explanation per option (key matches options)
  };
}

export interface Chapter {
  id: string;
  number: number;
  title: string;
  objective: string;
  blocks: Block[];
}

export interface ChironLesson {
  meta: {
    id: string;
    title: string;
    domain: 'medicine' | 'language' | 'code';
    subMode?: string;                                // e.g. AMBOSS
    generated: string;
    learner?: string;
    sourceGrounding: 'parent-LLM' | 'pdf' | 'codebase' | 'web';
  };
  chapters: Chapter[];
  cards: { front: string; back: string; chapterId: string }[];   // collected SR cards across chapters
}
