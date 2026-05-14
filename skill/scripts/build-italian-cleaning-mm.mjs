#!/usr/bin/env node
// Build the multi-set Match Madness for italian-cleaning-verbs-2026-05-12.
// PRD: canonical_shell_and_match_madness_2026-05-12 §4.10–4.12.
// 1. Define 11 sets + super-set as a MatchMadnessConfig.
// 2. Emit HTML/CSS/JS via the widget.
// 3. Surgically patch lesson.html (replace MM CSS, section s5 HTML, MM JS).

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildConjugationSet,
  emitMatchMadness,
} from '../dist/lib/widgets/match-madness.js';
import {
  emitSrDeck,
  emitSrCardCss,
} from '../dist/lib/widgets/sr-card.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const LESSON_HTML = resolve(REPO, 'lessons/italian-cleaning-verbs-2026-05-12/lesson.html');

// ============================================================================
// Italian content — the 14 verbs and 8 nouns from this lesson
// ============================================================================

/** @type {import('../dist/lib/widgets/match-madness.js').VerbEntry[]} */
const VERBS = [
  { infinitive: 'spazzare',      family: 'are',       englishGloss: 'sweep' },
  { infinitive: 'spolverare',    family: 'are',       englishGloss: 'dust' },
  { infinitive: 'pulire',        family: 'isco-ire',  englishGloss: 'clean' },
  { infinitive: 'strofinare',    family: 'are',       englishGloss: 'scrub' },
  { infinitive: 'lavare',        family: 'are',       englishGloss: 'wash' },
  { infinitive: 'sciacquare',    family: 'are',       englishGloss: 'rinse' },
  { infinitive: 'asciugare',     family: 'are',       englishGloss: 'dry' },
  { infinitive: 'stendere',      family: 'ere',       englishGloss: 'hang out',
    participle: 'steso',
    irregular: { 'passato-remoto:io': 'stesi' } },
  { infinitive: 'piegare',       family: 'are',       englishGloss: 'fold' },
  { infinitive: 'ammucchiare',   family: 'are',       englishGloss: 'pile up' },
  { infinitive: 'riordinare',    family: 'are',       englishGloss: 'tidy' },
  { infinitive: 'buttare',       family: 'are',       englishGloss: 'throw out' },
  { infinitive: 'mettere',       family: 'ere',       englishGloss: 'put',
    participle: 'messo',
    irregular: { 'passato-remoto:io': 'misi' } },
  { infinitive: 'passare',       family: 'are',       englishGloss: 'vacuum' }, // passare l'aspirapolvere
];

const NOUNS = [
  { it: 'la scopa',          en: 'broom',          article: 'la',  bare: 'scopa' },
  { it: 'lo straccio',       en: 'rag',            article: 'lo',  bare: 'straccio' },
  { it: 'il bucato',         en: 'laundry',        article: 'il',  bare: 'bucato' },
  { it: 'la pattumiera',     en: 'dustbin',        article: 'la',  bare: 'pattumiera' },
  { it: 'la candeggina',     en: 'bleach',         article: 'la',  bare: 'candeggina' },
  { it: 'lo sgrassatore',    en: 'degreaser',      article: 'lo',  bare: 'sgrassatore' },
  { it: 'la spugna',         en: 'sponge',         article: 'la',  bare: 'spugna' },
  { it: 'il secchio',        en: 'bucket',         article: 'il',  bare: 'secchio' },
  { it: "l'aspirapolvere",   en: 'vacuum cleaner', article: "l'",  bare: 'aspirapolvere' },
  { it: 'la spazzatura',     en: 'trash',          article: 'la',  bare: 'spazzatura' },
  { it: 'il detersivo',      en: 'detergent',      article: 'il',  bare: 'detersivo' },
];

const PREPOSITIONS = [
  { it: 'sotto il lavandino',   en: 'under the sink' },
  { it: 'sul balcone',          en: 'on the balcony' },
  { it: 'dal balcone',          en: 'from the balcony' },
  { it: 'in lavatrice',         en: 'in the washing machine' },
  { it: 'nella pattumiera',     en: 'into the dustbin' },
  { it: 'sopra il tavolo',      en: 'above the table' },
  { it: 'con lo sgrassatore',   en: 'with the degreaser' },
  { it: 'senza candeggina',     en: 'without bleach' },
  { it: 'durante le pulizie',   en: 'during the cleaning' },
  { it: 'dopo la cena',         en: 'after dinner' },
];

const COLLOCATIONS = [
  { left: 'spazzare',   right: 'la scopa' },
  { left: 'lavare',     right: 'i piatti' },
  { left: 'stendere',   right: 'il bucato' },
  { left: 'passare',    right: "l'aspirapolvere" },
  { left: 'pulire',     right: 'con lo sgrassatore' },
  { left: 'buttare',    right: 'la spazzatura' },
  { left: 'piegare',    right: 'la maglietta' },
  { left: 'riordinare', right: 'la stanza' },
  { left: 'spolverare', right: 'i mobili' },
  { left: 'sciacquare', right: 'le posate' },
];

// ============================================================================
// Build all 11 sets + SUPER-SET
// ============================================================================

const setVerbs = {
  id: 'set-1-verbs', index: 1, mode: 'vocab-pair',
  title: 'Verbi ↔ English',
  subtitle: 'Core 14 verbs of cleaning',
  rounds: 3,
  pairs: VERBS.map(v => ({
    id: `verb:${v.infinitive}`,
    left: `to ${v.englishGloss}`,
    right: v.infinitive,
  })),
};

const setNouns = {
  id: 'set-2-nouns', index: 2, mode: 'vocab-pair',
  title: 'Nomi ↔ English',
  subtitle: 'Household nouns',
  rounds: 5,
  pairs: NOUNS.map(n => ({
    id: `noun:${n.bare}`,
    left: n.en,
    right: n.it,
  })),
};

const setGender = {
  id: 'set-3-gender', index: 3, mode: 'gender-pair',
  title: 'Genere — la / lo / il / l\'',
  subtitle: 'Match each noun with its correct article',
  rounds: 5,
  pairs: NOUNS.map(n => ({
    id: `gender:${n.bare}`,
    left: n.bare,
    right: n.article,
    hint: n.en,
  })),
};

const setPreps = {
  id: 'set-4-preps', index: 4, mode: 'prep-pair',
  title: 'Preposizioni in contesto',
  subtitle: 'Cleaning-context preposition phrases',
  rounds: 5,
  pairs: PREPOSITIONS.map((p, i) => ({
    id: `prep:${i}`,
    left: p.en,
    right: p.it,
  })),
};

const setCollocations = {
  id: 'set-5-collocations', index: 5, mode: 'collocation',
  title: 'Collocazioni — verbo + oggetto',
  subtitle: 'Which object goes with which verb',
  rounds: 5,
  pairs: COLLOCATIONS.map((c, i) => ({
    id: `coll:${i}`,
    left: c.left,
    right: c.right,
  })),
};

// Conjugation sets — io-form for every tense (per 2026-05-14 spec)
const TENSE_SETS = [
  { tense: 'presente',              index: 6,  title: 'Presente — io',
    subtitle: 'Today, right now — io spazzo, io pulisco, io lavo' },
  { tense: 'passato-prossimo',     index: 7,  title: 'Passato prossimo — io',
    subtitle: 'Compound past — io ho spazzato, io ho pulito' },
  { tense: 'imperfetto',            index: 8,  title: 'Imperfetto — io',
    subtitle: 'Habitual / continuous past — io spazzavo, io pulivo' },
  { tense: 'futuro-semplice',      index: 9,  title: 'Futuro semplice — io',
    subtitle: 'Simple future — io spazzerò, io pulirò' },
  { tense: 'congiuntivo-presente', index: 10, title: 'Congiuntivo presente — che io',
    subtitle: 'Subjunctive — che io spazzi, che io pulisca' },
  { tense: 'passato-remoto',       index: 11, title: 'Passato remoto — io',
    subtitle: 'Literary past — io spazzai (Calvino, Ginzburg)' },
].map(s => buildConjugationSet({
  setId: `set-${s.index}-${s.tense}`,
  index: s.index,
  title: s.title,
  verbs: VERBS,
  tense: s.tense,
  subjects: ['io'],
  rounds: 5,
})).map((set, i) => ({
  ...set,
  subtitle: [
    'Today, right now — io spazzo, io pulisco, io lavo',
    'Compound past — io ho spazzato, io ho pulito',
    'Habitual / continuous past — io spazzavo, io pulivo',
    'Simple future — io spazzerò, io pulirò',
    'Subjunctive — che io spazzi, che io pulisca',
    'Literary past — io spazzai (Calvino, Ginzburg)',
  ][i],
}));

// SUPER-SET: pool drawn from all prior sets (we materialize a flat pair list)
const allPriorPairs = [
  setVerbs, setNouns, setGender, setPreps, setCollocations, ...TENSE_SETS,
].flatMap(s => s.pairs);

const setSuper = {
  id: 'set-super', index: 12, mode: 'mixed',
  title: '🔥 SUPER-SET — Tutto insieme',
  subtitle: 'Up to 10 rounds, all content mixed. The retrieval anchor.',
  rounds: 10,
  pairs: allPriorPairs, // each round shuffles a random subset of these
  drawsFromSetIds: [
    'set-1-verbs','set-2-nouns','set-3-gender','set-4-preps','set-5-collocations',
    'set-6-presente','set-7-passato-prossimo','set-8-imperfetto',
    'set-9-futuro-semplice','set-10-congiuntivo-presente','set-11-passato-remoto',
  ],
};

const config = {
  lessonId: 'italian-cleaning-verbs-2026-05-12',
  domain: 'language-it',
  title: 'Match Madness',
  description: 'Twelve sets of timed retrieval practice. Each set drills one slice — vocab, gender, prepositions, collocations, six tenses. The final SUPER-SET interleaves everything. Per-pair latency is logged in your browser; weak pairs come back next session.',
  defaults: {
    timerSec: 105,
    wrongLockMs: 1500,
    accessibilityModeAllowed: true,
    keyboardShortcuts: true,
    visualSpeedUp: {
      pulseFromMs: 2000, pulseToMs: 600,
      strengthFromOpacity: 0.04, strengthToOpacity: 0.18,
      refillFromMs: 200, refillToMs: 100,
    },
  },
  sets: [setVerbs, setNouns, setGender, setPreps, setCollocations, ...TENSE_SETS, setSuper],
  unlockAccuracyThreshold: 0.6,
  superSetUnlockAfterNSetsCompleted: 3,
};

console.error(`[mm-build] Built ${config.sets.length} sets. Total pairs: ${config.sets.reduce((n,s)=>n+s.pairs.length,0)}`);

const emitted = emitMatchMadness(config);

// ============================================================================
// Surgical patch of lesson.html
// ============================================================================

let html = readFileSync(LESSON_HTML, 'utf8');

// 1) Replace the CSS block between any `/* ---- Match Madness ... ---- */`
//    heading and the next major comment heading. Idempotent.
{
  const css = '\n    /* ---- Match Madness (multi-set) ---- */' + emitted.css.replace(/\n/g,'\n    ') + '\n';
  const re = /\n    \/\* ---- Match Madness[\s\S]*?(?=\n    \/\* ---- SR drawer)/;
  if (!re.test(html)) throw new Error('Could not locate MM CSS block');
  html = html.replace(re, css);
}

// 2) Replace section s5 HTML.
{
  const re = /<section class="lesson-section" id="s5">[\s\S]*?<\/section>\s*\n(?=    <!-- ========================= 6\.)/;
  if (!re.test(html)) throw new Error('Could not locate section s5 HTML');
  const newSection =
    '<section class="lesson-section" id="s5">\n' +
    '      <h2 class="section-h"><span class="num">5</span>Match Madness — automatismo</h2>\n' +
    emitted.html.split('\n').map(l => l ? '      ' + l : '').join('\n') +
    '\n    </section>\n';
  html = html.replace(re, newSection);
}

// 3) Replace JS block from `/* ===== Match Madness ... ===== */` to just
//    before the closing </script>. Idempotent.
{
  const re = /    \/\* ===== Match Madness[\s\S]*?(?=\n  <\/script>)/;
  if (!re.test(html)) throw new Error('Could not locate MM JS block');
  html = html.replace(re, '    /* ===== Match Madness (multi-set) ===== */' + emitted.js);
}

// ============================================================================
// 4) Patch the SR drawer (section s7) with rich conjugation-tabled cards.
// ============================================================================

const NOUNS_FOR_SR = [
  { it: 'la scopa',       en: 'broom',        article: 'la', bare: 'la scopa',       pairsWith: 'spazzare' },
  { it: 'lo straccio',    en: 'rag / mop cloth', article: 'lo', bare: 'lo straccio', pairsWith: 'strofinare' },
  { it: 'il bucato',      en: 'laundry',      article: 'il', bare: 'il bucato',      pairsWith: 'lavare / stendere / piegare' },
  { it: 'la pattumiera',  en: 'dustbin',      article: 'la', bare: 'la pattumiera',  note: 'Calvino — "il rito della pattumiera"' },
  { it: 'la candeggina',  en: 'bleach',       article: 'la', bare: 'la candeggina',  note: 'essential Italian household' },
  { it: 'lo sgrassatore', en: 'degreaser',    article: 'lo', bare: 'lo sgrassatore', note: 'kitchen "holy grail"' },
];

const IDIOMS_FOR_SR = [
  { it: 'essere uno specchio',  literal: 'to be a mirror',     meaning: 'a shiningly clean house' },
  { it: 'fare piazza pulita',   literal: 'to make a clean square', meaning: 'to make a clean sweep (figurative)' },
];

const srHtml = emitSrDeck({ verbs: VERBS, nouns: NOUNS_FOR_SR, idioms: IDIOMS_FOR_SR });

// 4a) Replace the deck contents.
{
  const re = /<div class="sr-deck">[\s\S]*?<\/div>\s*\n(?=    <\/section>)/;
  if (!re.test(html)) throw new Error('Could not locate SR deck');
  const indented = srHtml.split('\n').map(l => l ? '        ' + l : '').join('\n');
  html = html.replace(re, `<div class="sr-deck">\n${indented}\n      </div>\n`);
}

// 4b) Append SR card CSS once (idempotent guard).
if (!html.includes('/* ---- SR cards (rich, multi-tense back) ---- */')) {
  const re = /(\n    \/\* ---- SR drawer ----[\s\S]*?\.sr-card\.flipped \.back \{ display: block; \}\n)/;
  if (!re.test(html)) throw new Error('Could not locate SR drawer CSS block');
  const css = emitSrCardCss().replace(/\n/g, '\n    ');
  html = html.replace(re, `$1    ${css}\n`);
}

writeFileSync(LESSON_HTML, html);
console.error('[sr-build] Patched SR deck with rich cards.');
console.error('[mm-build] Patched lesson.html');
console.error(`[mm-build] New file length: ${html.length} chars (was 74298 before)`);
