// Mode-A vs Mode-B heuristic per FR-003 / contracts/skill-triggers.md §"Mode-A-vs-B heuristic".
//
//   < 2000 words → Mode B candidate (case-study)
//   ≥ 2000 words → Mode A candidate (course-style)
//
// User overrides ("mode a" / "mode b") and slash-command forces (/chiron-case-study)
// bypass this heuristic — handled in trigger-context, not here.

const MODE_B_WORD_THRESHOLD = 2000;

export interface ModeHeuristicResult {
  mode: 'A' | 'B';
  reason: string;
  wordCount: number;
}

export function detectMode(extractedText: string): ModeHeuristicResult {
  const wordCount = countWords(extractedText);
  if (wordCount < MODE_B_WORD_THRESHOLD) {
    return {
      mode: 'B',
      reason: `Source has ${wordCount} words (< ${MODE_B_WORD_THRESHOLD}) — short enough for case-study form.`,
      wordCount,
    };
  }
  return {
    mode: 'A',
    reason: `Source has ${wordCount} words (≥ ${MODE_B_WORD_THRESHOLD}) — long enough for multi-chapter course.`,
    wordCount,
  };
}

function countWords(text: string): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}
