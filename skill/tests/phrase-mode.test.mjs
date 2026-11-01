// Phrase-builder mode: request routing, the system prompt's contract, and the `phrase` block parser.
// Run: node --test skill/tests/phrase-mode.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPhraseRequest, parsePhraseBlock, PHRASE_PATTERNS, PHRASE_HOST, PHRASE_MODEL } from '../ask/phrase-mode.js';

test('isPhraseRequest: phrase openings route', () => {
  for (const t of [
    "How do I say I'm here for my specialization?",
    'how would i say thank you',
    'How do I ask where the station is',
    'HOW WOULD I ASK for the bill?',
    'how to say good morning',
    'How can I say I am late',
    "What's the Italian for fever?",
    'what’s the italian for fever',
    'what is the italian for fever',
    'How do you say "excuse me"',
    'Come si dice "nice to meet you"?',
    '  come dico che sono stanco',
    '"How do I say sorry"',
  ]) assert.equal(isPhraseRequest(t), true, t);
});

test('isPhraseRequest: other questions stay in the librarian', () => {
  for (const t of [
    'what did I study about heart failure',
    "Che differenza c'è tra affanno e dispnea?",
    'Quiz me on the chest-pain ward phrases.',
    'I wonder how do I say this, actually',
    'how does the passato prossimo work',
    'how do I sayonara',
    '',
    undefined,
  ]) assert.equal(isPhraseRequest(t), false, String(t));
});

test('pattern list is the single source for the router', () => {
  assert.ok(PHRASE_PATTERNS.includes('come si dice'));
  assert.equal(PHRASE_PATTERNS.length, 11);
});

const GOOD = {
  it: 'Sono qui per la specializzazione.', en_intent: "I'm here for my specialization", register: 'neutral',
  variants: [{ it: 'Sono venuto per la specializzazione.', register: 'neutral' }],
  breakdown: [{ chunk: 'Sono qui', gloss: 'I am here' }],
};

test('parsePhraseBlock: valid block', () => {
  const raw = `**Sono qui.**\n[[SPEAK]]Sono qui.[[/SPEAK]]\n\n\`\`\`phrase\n${JSON.stringify(GOOD, null, 1)}\n\`\`\``;
  const r = parsePhraseBlock(raw);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, GOOD);
});

test('parsePhraseBlock: malformed block reports why', () => {
  const r = parsePhraseBlock('x\n```phrase\n{"it": "ciao",\n```');
  assert.equal(r.ok, false);
  assert.match(r.reason, /not valid JSON/);
  assert.equal(parsePhraseBlock('```phrase\n[1,2]\n```').ok, false);
  assert.match(parsePhraseBlock('```phrase\n{"en_intent":"x"}\n```').reason, /no "it"/);
});

test('parsePhraseBlock: no block or empty input', () => {
  assert.match(parsePhraseBlock('just prose, no fence').reason, /no phrase block/);
  assert.match(parsePhraseBlock('```json\n{"it":"a"}\n```').reason, /no phrase block/);
  assert.match(parsePhraseBlock('').reason, /empty/);
  assert.equal(parsePhraseBlock(null).ok, false);
});

test('the page talks to the server-side coach, not a browser prompt', async () => {
  assert.equal(PHRASE_HOST, '/ask/phrase');
  assert.equal(PHRASE_MODEL, 'phrase-coach');
  const mod = await import('../ask/phrase-mode.js');
  assert.equal(mod.PHRASE_SYSTEM_PROMPT, undefined);
});

test('parsePhraseBlock: the coach block with pattern, slots and practice', () => {
  const data = { ...GOOD, pattern: 'Sono qui per + [noun]', slots: ['noun'], practice: "I'm here for my interview." };
  const r = parsePhraseBlock('**x**\n\n[[SPEAK]]x[[/SPEAK]]\n\n```phrase\n' + JSON.stringify(data) + '\n```');
  assert.equal(r.ok, true);
  assert.equal(r.data.practice, data.practice);
  assert.deepEqual(r.data.slots, ['noun']);
});
