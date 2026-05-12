// Lesson runtime state — Svelte 5 runes + localStorage persistence.
// Replaces the vanilla "chiron-attempts" + "chiron-progress-*" + "chiron-drill-*" keys.

const LESSON_ID_KEY = 'chiron-lesson-id';

function readJSON<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || '') ?? fallback; }
  catch { return fallback; }
}

function makeQuizState(lessonId: string) {
  const KEY = `chiron-attempts-${lessonId}`;
  const stored = readJSON<Record<string, { picked: string; correct: boolean; ts: number }>>(KEY, {});
  const state = $state({ attempts: stored });
  function persist() { localStorage.setItem(KEY, JSON.stringify(state.attempts)); }
  function answer(qid: string, picked: string, correct: boolean) {
    state.attempts[qid] = { picked, correct, ts: Date.now() };
    persist();
  }
  function reset() {
    state.attempts = {};
    persist();
  }
  return {
    get attempts() { return state.attempts; },
    answer, reset,
    get score() { return Object.values(state.attempts).filter(a => a.correct).length; },
    get total() { return Object.keys(state.attempts).length; },
  };
}

function makeProgressState(lessonId: string) {
  const KEY = `chiron-progress-${lessonId}`;
  const stored = readJSON<{ chapters: Record<string, { viewed?: number; answered?: number }>; lastChapter: string | null }>(
    KEY, { chapters: {}, lastChapter: null }
  );
  const state = $state(stored);
  function persist() { localStorage.setItem(KEY, JSON.stringify(state)); }
  function markViewed(cid: string) {
    if (!state.chapters[cid]) state.chapters[cid] = {};
    if (!state.chapters[cid].viewed) {
      state.chapters[cid].viewed = Date.now();
      persist();
    }
  }
  function markAnswered(cid: string) {
    if (!state.chapters[cid]) state.chapters[cid] = {};
    state.chapters[cid].answered = Date.now();
    state.chapters[cid].viewed ??= Date.now();
    persist();
  }
  function setLast(cid: string) {
    state.lastChapter = cid;
    persist();
  }
  function chapterStatus(cid: string): 'unread' | 'viewed' | 'answered' {
    const ch = state.chapters[cid];
    if (!ch) return 'unread';
    if (ch.answered) return 'answered';
    if (ch.viewed) return 'viewed';
    return 'unread';
  }
  return {
    get chapters() { return state.chapters; },
    get lastChapter() { return state.lastChapter; },
    get viewedCount() {
      return Object.values(state.chapters).filter(c => c.viewed || c.answered).length;
    },
    markViewed, markAnswered, setLast, chapterStatus,
  };
}

// Singleton: one lesson loaded per browser tab.
const lessonId =
  (typeof window !== 'undefined' && (window as any).__CHIRON_LESSON__?.meta?.id) ||
  localStorage.getItem(LESSON_ID_KEY) ||
  'default';

if (typeof window !== 'undefined') localStorage.setItem(LESSON_ID_KEY, lessonId);

export const quizState = makeQuizState(lessonId);
export const progressState = makeProgressState(lessonId);
