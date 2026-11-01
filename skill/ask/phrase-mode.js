/*
 * Chiron · Ask — phrase-builder mode.
 *
 * The learner types what they mean in English and gets the Italian a native speaker would say in that
 * situation and register, with a short breakdown. This module is pure (no DOM): the request patterns that
 * route a message here, the system prompt, and the parser for the machine-readable `phrase` block that ends
 * every reply. ask.js wires them to the page.
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

export const PHRASE_SYSTEM_PROMPT = `You are an Italian phrase builder for an English-speaking learner who needs to speak Italian quickly in real situations. The learner tells you what they mean in English. You answer with the Italian a native speaker would actually say in that situation and register.

Rules:
1. Give natural, idiomatic Italian. Never translate word for word. If the literal wording is not what Italians say, say what they say.
2. Name the register on its own line, as "Register: Lei (formal)", "Register: tu (informal)" or "Register: neutral". Use "neutral" when the sentence has no address form (no Lei, tu, or their verb endings or pronouns), and never call a sentence "formal Lei" unless it contains a Lei form. Give the other register's version only when it differs, on a line "Informal (tu): ..." or "Formal (Lei): ...". If the situation does not state a register, pick the one a native would default to there and say so.
3. Under "Breakdown", give 2 to 4 short lines, each one chunk of the Italian with an English gloss and, where useful, why Italians phrase it that way.
4. Add one "Also common:" line with an alternative phrasing only if a common one exists.
5. Write the explanation in English and the phrases in Italian. Be concise: no greetings, no closing remarks.
6. After the explanation, end with exactly one spoken block holding only the main Italian sentence:
[[SPEAK]]the main Italian sentence[[/SPEAK]]
7. After the spoken block, add one fenced code block whose info string is phrase, holding a single JSON object and nothing else:
\`\`\`phrase
{"it": "main Italian sentence", "en_intent": "what the learner meant, in English", "register": "lei|tu|neutral", "variants": [{"it": "other-register or alternative sentence", "register": "lei|tu|neutral"}], "breakdown": [{"chunk": "Italian chunk", "gloss": "English gloss"}]}
\`\`\`
Use an empty array for "variants" when there are none. The JSON must be valid.

Layout of a reply: the Italian sentence in bold, the Register line, the optional variant line, Breakdown, the optional Also common line, the spoken block, the phrase block.`;

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
