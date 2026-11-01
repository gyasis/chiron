/*
 * Chiron · Ask — phrase-builder mode.
 *
 * The learner types what they mean in English and a server-side coach (chains/2026-11-01_chiron-phrase-coach-chain)
 * builds the Italian a native would say, then teaches the pattern behind it. This module is pure (no DOM): the
 * request patterns that route a message here, the coach endpoint, and the parser for the machine-readable
 * `phrase` block that ends every reply. ask.js wires them to the page.
 */

/** Message openings that mean "build me a phrase". Matched case-insensitively at the start of a message. */
export const PHRASE_PATTERNS = [
  'how do i say', 'how would i say', 'how do i ask', 'how would i ask', 'how to say', 'how can i say',
  "what's the italian for", 'what is the italian for', 'how do you say', 'come si dice', 'come dico',
];

const PHRASE_RE = new RegExp(
  '^[\\s"\'“‘(]*(?:' + PHRASE_PATTERNS.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|') + ')(?![\\p{L}\\p{N}])',
  'iu');

/** True when `text` opens like a phrase request ("how do I say …", "come si dice …"). */
export function isPhraseRequest(text) {
  if (typeof text !== 'string') return false;
  return PHRASE_RE.test(text.replace(/[’‘`]/g, "'"));
}

/** The Ollama-shaped endpoint the server's phrase coach answers on, and its one pseudo-model. */
export const PHRASE_HOST = '/ask/phrase';
export const PHRASE_MODEL = 'phrase-coach';

const FENCE_RE = /```phrase[^\S\n]*\n([\s\S]*?)```/i;

/**
 * Pull the `phrase` JSON block out of a reply's raw text.
 * Returns { ok: true, data } or { ok: false, reason }; never throws.
 */
export function parsePhraseBlock(raw) {
  if (typeof raw !== 'string' || !raw) return { ok: false, reason: 'empty reply' };
  const m = FENCE_RE.exec(raw);
  if (!m) return { ok: false, reason: 'no phrase block in reply' };
  let data;
  try { data = JSON.parse(m[1]); }
  catch (e) { return { ok: false, reason: `phrase block is not valid JSON (${e.message})` }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'phrase block is not a JSON object' };
  if (typeof data.it !== 'string' || !data.it.trim()) return { ok: false, reason: 'phrase block has no "it" sentence' };
  return { ok: true, data };
}
