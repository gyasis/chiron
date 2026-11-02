/*
 * Chiron · Ask — the Pimsleur drill intent. Pure (no DOM), so it runs under node --test.
 *
 *   classifyDrillIntent(text)   'drill' | 'lesson' | 'none'
 *       drill   open the live drill player now             ("play these as pimsleur live", "drill me with pimsleur")
 *       lesson  show the full saved-lesson action          ("make a pimsleur lesson from these")
 *       none    an ordinary message: it goes to the model  ("quiz me", "how does pimsleur work?")
 *   splitSpeak(speak)           the Italian lines of a [[SPEAK]] block
 *   composerLines(text)         one sentence per line typed in the composer
 *   pickSource({composer, replies, basket})   the {it, en} list to drill, by priority; replies are newest first
 *
 * Only the name activates it: a message without "Pimsleur" (in any dictation spelling) is always 'none', so practice,
 * quiz and test requests stay a conversation with Lucrezia. With the name: an explanation question is never an intent;
 * "<pimsleur> live" is a drill; a lesson noun or a create/save verb is a lesson; a drill or play verb is a drill.
 * Voice dictation spells the name many ways (pimsler, pimsleer, pims layer), so the name is matched by shape.
 */

const PIMS = String.raw`p[iy]m+p?[sz]\s?l[eua]{1,3}y?e?r?s?`;
const PIMS_RE = new RegExp(String.raw`\b${PIMS}\b`);
const PIMS_LIVE_RE = new RegExp(String.raw`\b${PIMS}\s*[- ]?\s*(?:live|mode|drill)\b|\blive\s+${PIMS}\b`);
const EXPLAIN_RE = /^(?:how\s+(?:does|do|is|are|did|come)|what(?:'s|\s+is|\s+are|\s+does)?|why|who|when|where|which|is|are|does|did|tell me about|explain)\b/;
const LESSON_NOUN_RE = /\b(?:lessons?|seasons?|courses?|episodes?|full|saved)\b/;
const CREATE_RE = /\b(?:make|create|generate|build|turn|convert|bake|save|add|put|send|produce|write)\b/;
const LIBRARY_RE = /\b(?:to|in|into|for)\s+(?:my\s+|the\s+)?(?:library|lessons?|raccolte|collection)\b/;
const PIMS_VERB_RE = /\b(?:drill|play|practi[sc]e|do|run|start|open|launch|convert|turn|switch|use|try|put|read|say|speak|go|rehearse)\b/;
const PHRASE_TARGET = String.raw`(?:these|them|this|it|those|the\s+(?:phrases?|sentences?|lines?|words?)|my\s+(?:phrases?|sentences?|basket)|phrases?|sentences?|me)`;
const DRILL_VERB_RE = new RegExp(String.raw`\b(?:drill|practi[sc]e|rehearse|quiz|test)\s+(?:me\s+(?:on\s+|with\s+)?)?${PHRASE_TARGET}\b|\bplay\s+${PHRASE_TARGET}(?:\s+(?:back|out|aloud|again))?\b|\b(?:run|go)\s+(?:through|over)\s+${PHRASE_TARGET}\b|^\s*drill\s*[.!]?\s*$`);

/** Lower-case, accents and typographic quotes folded, whitespace collapsed. */
function norm(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim();
}

export function classifyDrillIntent(text) {
  const t = norm(text);
  if (!t || t.length > 240 || !PIMS_RE.test(t)) return 'none';
  if (EXPLAIN_RE.test(t)) return 'none';
  if (PIMS_LIVE_RE.test(t)) return 'drill';
  if (LESSON_NOUN_RE.test(t) || LIBRARY_RE.test(t)) return 'lesson';
  if (DRILL_VERB_RE.test(t) || PIMS_VERB_RE.test(t) || t.split(' ').length <= 3) return 'drill';
  if (CREATE_RE.test(t)) return 'lesson';
  return 'none';
}

/** The Italian lines of a [[SPEAK]] block: one per line, else one per sentence. */
export function splitSpeak(speak) {
  const s = String(speak || '').trim();
  if (!s) return [];
  const byLine = s.split(/\n+/).map(x => x.trim()).filter(Boolean);
  const parts = byLine.length > 1 ? byLine : s.split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean);
  return parts.map(x => x.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '')).filter(Boolean);
}

/** One sentence per non-empty composer line. */
export function composerLines(text) {
  return String(text || '').split(/\n+/).map(x => x.trim()).filter(Boolean).map(it => ({ it, en: '' }));
}

/**
 * What to drill: (a) the composer's lines, else (b) the newest reply that has phrases ({phrases:[{it,en}]}) or an Italian
 * [[SPEAK]] ({speak}), else (c) the basket. Every result is {it, en} with duplicates removed.
 */
export function pickSource({ composer = '', replies = [], basket = [] } = {}) {
  const clean = list => {
    const seen = new Set(), out = [];
    for (const p of list || []) {
      const it = String(p && p.it || '').trim();
      if (!it || seen.has(it.toLowerCase())) continue;
      seen.add(it.toLowerCase());
      out.push({ it, en: String(p.en || '') });
    }
    return out;
  };
  const a = clean(composerLines(composer));
  if (a.length) return a;
  for (const r of replies) {
    const b = clean(r.phrases && r.phrases.length ? r.phrases : splitSpeak(r.speak).map(it => ({ it, en: '' })));
    if (b.length) return b;
  }
  return clean(basket);
}

export const EMPTY_NOTE = 'Ask Lucrezia for a phrase first, or add phrases to the basket.';
