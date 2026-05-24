#!/usr/bin/env node
// Build italian-medical-vocab-v2-klinefelter-2026-05-14 — test-drive shape.
// Same medical content as v1, restructured to Klinefelter's L5-textbook layout:
//   - 240px sidebar with chapter TOC + view picker (lesson / quizzes / flashcards)
//   - Wide main column with Tufte-style margin notes (high-yield boxes float right)
//   - Block-typed content (objective / paragraph / highYield / pearl / mnemonic)
//   - Mermaid sequence diagram for the anamnesis flow (code2tutorial craft borrow)
// v1 lives at italian-medical-vocab-2026-05-14 and is NOT touched.

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConjugationSet, emitMatchMadness } from '../dist/lib/widgets/match-madness.js';
import { emitSrDeck, emitSrCardCss } from '../dist/lib/widgets/sr-card.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const OUT = resolve(REPO, 'lessons/italian-medical-vocab-v2-klinefelter-2026-05-14/lesson.html');

// ---------- content (mirrors v1) ----------
const VERBS = [
  { infinitive: 'visitare',     family: 'are', englishGloss: 'examine' },
  { infinitive: 'ascoltare',    family: 'are', englishGloss: 'listen-to' },
  { infinitive: 'palpare',      family: 'are', englishGloss: 'palpate' },
  { infinitive: 'misurare',     family: 'are', englishGloss: 'measure' },
  { infinitive: 'controllare',  family: 'are', englishGloss: 'check' },
  { infinitive: 'prescrivere',  family: 'ere', englishGloss: 'prescribe', participle: 'prescritto', irregular: { 'passato-remoto:io': 'prescrissi' } },
  { infinitive: 'somministrare', family: 'are', englishGloss: 'administer' },
  { infinitive: 'spiegare',     family: 'are', englishGloss: 'explain' },
  { infinitive: 'chiedere',     family: 'ere', englishGloss: 'ask', participle: 'chiesto', irregular: { 'passato-remoto:io': 'chiesi' } },
  { infinitive: 'rassicurare',  family: 'are', englishGloss: 'reassure' },
  { infinitive: 'monitorare',   family: 'are', englishGloss: 'monitor' },
  { infinitive: 'aiutare',      family: 'are', englishGloss: 'help' },
  { infinitive: 'curare',       family: 'are', englishGloss: 'treat' },
  { infinitive: 'dimettere',    family: 'ere', englishGloss: 'discharge', participle: 'dimesso', irregular: { 'passato-remoto:io': 'dimisi' } },
];

const NOUNS = [
  { it: 'la testa', en: 'head', article: 'la', bare: 'la testa' },
  { it: 'il viso', en: 'face', article: 'il', bare: 'il viso' },
  { it: "l'occhio", en: 'eye', article: "l'", bare: "l'occhio" },
  { it: "l'orecchio", en: 'ear', article: "l'", bare: "l'orecchio" },
  { it: 'la bocca', en: 'mouth', article: 'la', bare: 'la bocca' },
  { it: 'il naso', en: 'nose', article: 'il', bare: 'il naso' },
  { it: 'la gola', en: 'throat', article: 'la', bare: 'la gola' },
  { it: 'i denti', en: 'teeth', article: 'i', bare: 'i denti' },
  { it: 'il petto', en: 'chest', article: 'il', bare: 'il petto' },
  { it: 'la pancia', en: 'belly', article: 'la', bare: 'la pancia' },
  { it: 'lo stomaco', en: 'stomach', article: 'lo', bare: 'lo stomaco' },
  { it: 'il cuore', en: 'heart', article: 'il', bare: 'il cuore' },
  { it: 'il polmone', en: 'lung', article: 'il', bare: 'il polmone' },
  { it: 'la schiena', en: 'back', article: 'la', bare: 'la schiena' },
  { it: 'il sangue', en: 'blood', article: 'il', bare: 'il sangue' },
  { it: 'il braccio', en: 'arm', article: 'il', bare: 'il braccio' },
  { it: 'la mano', en: 'hand', article: 'la', bare: 'la mano' },
  { it: 'la gamba', en: 'leg', article: 'la', bare: 'la gamba' },
  { it: 'il piede', en: 'foot', article: 'il', bare: 'il piede' },
  { it: 'il ginocchio', en: 'knee', article: 'il', bare: 'il ginocchio' },
  { it: 'la spalla', en: 'shoulder', article: 'la', bare: 'la spalla' },
];

const IDIOMS = [
  { it: "fare un'anamnesi", literal: 'to do a history', meaning: 'to take a patient history' },
  { it: 'in osservazione', literal: 'in observation', meaning: 'admitted for observation' },
  { it: 'in bocca al lupo', literal: "in the wolf's mouth", meaning: 'good luck (between colleagues)' },
];

const PHRASES = [
  ['Come si sente oggi?', 'How are you feeling today?'],
  ['Da quanto tempo ha questi sintomi?', 'How long have you had these symptoms?'],
  ['Mi indichi dove fa male.', 'Show me where it hurts.'],
  ['Apra la bocca, per favore.', 'Open your mouth, please.'],
  ['Respiri profondamente.', 'Breathe deeply.'],
  ['È allergico/a a qualche medicina?', 'Are you allergic to any medication?'],
  ['Le prescrivo un antibiotico.', "I'll prescribe an antibiotic."],
  ['Lo prenda due volte al giorno dopo i pasti.', 'Take it twice a day after meals.'],
  ['Stia tranquillo/a, non è grave.', "Don't worry, it's not serious."],
  ['La dimettiamo domani mattina.', "We'll discharge you tomorrow morning."],
];

// MM config — same as v1
const setVerbs = { id: 'set-1-verbs', index: 1, mode: 'vocab-pair', title: 'Verbi medici ↔ EN', subtitle: '14 clinician verbs', rounds: 3,
  pairs: VERBS.map(v => ({ id: `verb:${v.infinitive}`, left: `to ${v.englishGloss}`, right: v.infinitive })) };
const setNouns = { id: 'set-2-body', index: 2, mode: 'vocab-pair', title: 'Parti del corpo ↔ EN', subtitle: '21 body parts', rounds: 5,
  pairs: NOUNS.map(n => ({ id: `noun:${n.bare}`, left: n.en, right: n.it })) };
const setGender = { id: 'set-3-gender', index: 3, mode: 'gender-pair', title: 'Genere — la/lo/il/l\'', subtitle: 'Article match', rounds: 5,
  pairs: NOUNS.slice(0, 16).map(n => ({ id: `gender:${n.bare}`, left: n.bare.replace(/^(la|lo|il|i|le|gli|l')\s?/,''), right: n.article, hint: n.en })) };
const TENSE_SETS = [
  { tense: 'presente', index: 4, title: 'Presente — io', sub: 'io visito, io ascolto, io prescrivo' },
  { tense: 'passato-prossimo', index: 5, title: 'Passato prossimo — io', sub: 'io ho visitato, io ho prescritto' },
  { tense: 'imperfetto', index: 6, title: 'Imperfetto — io', sub: 'Habitual past' },
  { tense: 'futuro-semplice', index: 7, title: 'Futuro — io', sub: 'io visiterò, io prescriverò' },
].map(s => ({ ...buildConjugationSet({ setId: `set-${s.index}-${s.tense}`, index: s.index, title: s.title, verbs: VERBS, tense: s.tense, subjects: ['io'], rounds: 5 }), subtitle: s.sub }));
const allPriorPairs = [setVerbs, setNouns, setGender, ...TENSE_SETS].flatMap(s => s.pairs);
const setSuper = { id: 'set-super', index: 8, mode: 'mixed', title: '🔥 SUPER-SET', subtitle: 'All content mixed', rounds: 8, pairs: allPriorPairs, drawsFromSetIds: [setVerbs.id, setNouns.id, setGender.id, ...TENSE_SETS.map(s=>s.id)] };
const mmConfig = {
  lessonId: 'italian-medical-vocab-v2-klinefelter-2026-05-14',
  domain: 'language-it',
  title: 'Match Madness',
  description: '8 sets · vocab + body parts + gender + 4 tenses + SUPER. Per-pair latency logged in your browser.',
  defaults: { timerSec: 105, wrongLockMs: 1500, accessibilityModeAllowed: true, keyboardShortcuts: true, visualSpeedUp: {} },
  sets: [setVerbs, setNouns, setGender, ...TENSE_SETS, setSuper],
  unlockAccuracyThreshold: 0.6, superSetUnlockAfterNSetsCompleted: 3,
};
const mmEmitted = emitMatchMadness(mmConfig);
const srDeckHtml = emitSrDeck({ verbs: VERBS, nouns: NOUNS.slice(0,15).map(n=>({...n,bare:n.bare.replace(/^(la|lo|il|i|le|gli|l')\s?/,'')})), idioms: IDIOMS });

// ---------- chapter content as block-typed records (Klinefelter style) ----------
const CHAPTERS = [
  {
    id: 'ch1', num: 1, title: 'Inquadramento — Italian in the Italian ward',
    objective: 'Understand the register (formal Lei) and the role you will play (foreign clinician taking histories in Italian).',
    blocks: [
      { type: 'paragraph', html: '<strong>You are a foreign-trained doctor on your first ward shift in Bologna.</strong> A patient walks in: <em>«Dottore, non mi sento bene»</em>. The clinical workflow you already know — history, exam, plan, discharge — has to happen in Italian, in the formal register, with a vocabulary you may have only studied in textbooks. This lesson focuses on the words and structures you will use every shift.' },
      { type: 'paragraph', html: 'The lesson is built around <strong>active retrieval</strong>, not vocabulary lists. After reading each block, the matching Match Madness set and SR flashcard deck will drill the same items under time pressure. Per-pair latency is logged in your browser — words you fumble come back next session.' },
      { type: 'highYield', items: [
        'Always use <strong>Lei</strong> with patients, never <em>tu</em>. Even with the parents of pediatric patients.',
        'Italian conjugates the verb to the subject; you almost never say the subject pronoun out loud (<em>(io) prescrivo</em>, <em>(lei) si distenda</em>).',
        '14 clinician verbs + 21 body parts + 10 phrases will carry you through 80% of routine encounters.',
      ] },
    ],
  },
  {
    id: 'ch2', num: 2, title: 'Parti del corpo — 21 anatomical landmarks',
    objective: 'Master 21 body-part nouns with correct articles (la / lo / il / l\').',
    blocks: [
      { type: 'paragraph', html: 'The 21 nouns split into three clusters: <strong>head + face</strong> (8), <strong>torso + organs</strong> (7), <strong>limbs</strong> (6). Article (<em>la / lo / il / l\'</em>) is part of the noun and must be memorized with it — say it out loud every time.' },
      { type: 'table', rows: NOUNS.map(n => [n.it, n.en, n.article]) },
      { type: 'pearl', tag: 'Pearl · l\' vs lo', body: '<em>l\'</em> is the elided form of <em>lo</em> (masculine) or <em>la</em> (feminine) before a vowel. <em>l\'occhio</em> = "the eye" (m). <em>l\'orecchio</em> = "the ear" (m). Both keep masculine agreement.' },
    ],
  },
  {
    id: 'ch3', num: 3, title: 'I verbi del medico — 14 clinical actions',
    objective: 'Conjugate 14 clinician verbs in the 4 daily-use tenses.',
    blocks: [
      { type: 'paragraph', html: 'You will use these verbs every shift, mostly in present and present-perfect. The Match Madness set 4-7 drills all 4 tenses; the SR cards in this lesson show the full paradigm per verb on the back of each card.' },
      { type: 'table', rows: VERBS.map(v => [v.infinitive, `to ${v.englishGloss}`, v.family]) },
      { type: 'mnemonic', tag: 'Mnemonic · -ere irregulars', body: 'The four <em>-ere</em> verbs (<em>prescrivere</em>, <em>chiedere</em>, <em>dimettere</em>, <em>mettere</em>) have <strong>irregular past participles</strong> ending in <em>-tto</em> or <em>-sto</em>: <em>prescritto, chiesto, dimesso, messo</em>. Worth memorizing as a block.' },
    ],
  },
  {
    id: 'ch4', num: 4, title: 'Anamnesi — sequence diagram of a first encounter',
    objective: 'Walk through a complete history-taking dialogue with Sig.ra Russo.',
    blocks: [
      { type: 'paragraph', html: 'Below is a <strong>sequence diagram</strong> (code2tutorial-style) of the canonical first-encounter flow. Each arrow is a turn; the labels show what each speaker contributes.' },
      { type: 'mermaid', src: `sequenceDiagram
    participant Tu as Tu (medico straniero)
    participant P as Sig.ra Russo (paziente)
    Tu->>P: Saluto + chi sono
    P->>Tu: Sintomo principale
    Tu->>P: Cronologia (da quanto?)
    P->>Tu: Dettagli temporali + altri sintomi
    Tu->>P: Allergie + farmaci in corso
    P->>Tu: Lista allergie
    Tu->>P: Esame obiettivo (respiri / apra la bocca)
    Tu->>P: Diagnosi + piano terapeutico
    P->>Tu: Domande sul dosaggio
    Tu->>P: Istruzioni + follow-up
    P->>Tu: Ringraziamento` },
      { type: 'highYield', items: [
        '<strong>5 mandatory beats:</strong> saluto · sintomo · cronologia · allergie · esame.',
        'Open every encounter with <em>«Come si sente oggi?»</em> — sets register and invites narrative.',
        'Close every encounter with explicit follow-up: <em>«La controlliamo tra X giorni»</em>.',
      ] },
    ],
  },
  {
    id: 'ch5', num: 5, title: 'Frasi salvavita — 10 phrases that pay rent',
    objective: 'Memorize 10 sentence-frames that cover ~80% of routine clinician utterances.',
    blocks: [
      { type: 'paragraph', html: 'These 10 frames give you imperative (commands), polite questions, and reassurance — the three speech acts you perform constantly. All in <strong>Lei form</strong>.' },
      { type: 'table', rows: PHRASES.map(([it, en]) => [it, en]) },
      { type: 'pearl', tag: 'Pearl · Lei-imperative shape', body: 'Polite commands use the <strong>congiuntivo presente</strong> form: <em>apr<u>a</u></em> (open), <em>respir<u>i</u></em> (breathe), <em>prend<u>a</u></em> (take), <em>stia tranquill<u>o/a</u></em> (be calm). This is why MM Set 10 in v1 drilled congiuntivo specifically.' },
    ],
  },
  {
    id: 'ch6', num: 6, title: 'Match Madness — automatismo medico',
    objective: 'Drill all content from the prior 5 chapters under time pressure. Returns each session.',
    blocks: [
      { type: 'paragraph', html: 'Click any set card below to enter the play surface. Keyboard: <code>1–5</code> left column, <code>Q W E R T</code> right column, <code>Space</code> start/pause. Per-pair latency feeds the SR scheduler — words you fumble come back tomorrow.' },
      { type: 'widget', kind: 'match-madness' },
    ],
  },
  {
    id: 'ch7', num: 7, title: 'Carte SR — full paradigms on the back',
    objective: 'Review verbs and nouns. Verb cards show the full 4-tense paradigm on flip.',
    blocks: [
      { type: 'paragraph', html: 'Click any card to flip. Verbs show all 4 daily-use tenses with English aspect hint underneath each Italian label.' },
      { type: 'widget', kind: 'language-flashcard-deck' },
    ],
  },
  {
    id: 'ch8', num: 8, title: 'Chiusura — your first shift, in Italian',
    objective: 'Recap and next steps.',
    blocks: [
      { type: 'paragraph', html: '<strong>You can now</strong> take a history, examine, prescribe, and discharge — all in Italian and in the formal Lei register. 14 verbs, 21 body parts, 10 phrases, 4 tenses, a complete first-encounter flow.' },
      { type: 'paragraph', html: '<strong>Next:</strong> <em>«Italiano in ospedale 2»</em> will cover specialist contexts (pronto soccorso triage, sala operatoria handover, dimissione complex). For now: <em>«In bocca al lupo per il tuo prossimo turno!»</em>' },
    ],
  },
];

// ---------- HTML emit ----------
function renderBlock(b) {
  if (b.type === 'paragraph') return `<p>${b.html}</p>`;
  if (b.type === 'highYield') return `<aside class="hy"><div class="hy-title">High yield</div><ul>${b.items.map(i => `<li>${i}</li>`).join('')}</ul></aside>`;
  if (b.type === 'pearl') return `<aside class="pearl"><div class="pearl-title">${b.tag}</div><p>${b.body}</p></aside>`;
  if (b.type === 'mnemonic') return `<aside class="mnemonic"><div class="mnemonic-title">${b.tag}</div><p>${b.body}</p></aside>`;
  if (b.type === 'table') return `<table><tbody>${b.rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  if (b.type === 'mermaid') return `<div class="mermaid-wrap"><pre class="mermaid">${b.src}</pre></div>`;
  if (b.type === 'widget' && b.kind === 'match-madness') return mmEmitted.html;
  if (b.type === 'widget' && b.kind === 'language-flashcard-deck') return `<div class="deck"><div class="sr-deck">${srDeckHtml}</div></div>`;
  return '';
}

const chaptersHtml = CHAPTERS.map(ch => `
    <section class="chapter" id="${ch.id}" data-chapter="${ch.num}">
      <div class="ch-num">Chapter ${ch.num}</div>
      <h1>${ch.title}</h1>
      <div class="objective"><strong>Objective.</strong> ${ch.objective}</div>
${ch.blocks.map(renderBlock).join('\n')}
    </section>`).join('\n');

const sidebarToc = CHAPTERS.map(ch =>
  `<a class="toc-link" href="#${ch.id}" data-chapter-target="${ch.id}"><span class="toc-num">${ch.num}.</span><span class="toc-title">${ch.title.replace(/ — .*$/, '')}</span></a>`
).join('\n');

const html = `<!DOCTYPE html>
<html lang="it" data-theme="clinical" data-layout="l5" data-view="lesson">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Chiron · Italiano in ospedale (v2 · Klinefelter style)</title>

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700;12..96,800&family=Source+Serif+4:ital,wght@0,400;0,600&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

  <link rel="stylesheet" href="themes/_tokens.css" />
  <link rel="stylesheet" href="themes/midnight.css" />
  <link rel="stylesheet" href="themes/warm-paper.css" />
  <link rel="stylesheet" href="themes/clinical.css" />
  <link rel="stylesheet" href="themes/linguistic.css" />
  <link rel="stylesheet" href="themes/ocean.css" />

  <link rel="stylesheet" href="layouts/l1-lms.css" />
  <link rel="stylesheet" href="layouts/l2-editorial.css" />
  <link rel="stylesheet" href="layouts/l5-textbook.css" />

  <script>
    (function () {
      const validT = ['linguistic','midnight','warm-paper','clinical','ocean'];
      const validL = ['l1','l2','l5'];
      const p = new URLSearchParams(location.search);
      const t = p.get('theme'); const l = p.get('layout');
      const storedT = localStorage.getItem('chiron-theme');
      const storedL = localStorage.getItem('chiron-layout');
      const theme = validT.includes(t) ? t : (validT.includes(storedT) ? storedT : 'clinical');
      const layout = validL.includes(l) ? l : (validL.includes(storedL) ? storedL : 'l5');
      document.documentElement.setAttribute('data-theme', theme);
      document.documentElement.setAttribute('data-layout', layout);
      if (t) localStorage.setItem('chiron-theme', t);
      if (l) localStorage.setItem('chiron-layout', l);
    })();
  </script>

  <style>
    /* === Shell — 240px sidebar + main, per L5 Klinefelter contract === */
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      display: grid; grid-template-columns: 240px 1fr; min-height: 100vh;
      background: var(--chiron-bg); color: var(--chiron-fg);
      font-family: var(--chiron-font-body); font-size: 16px; line-height: 1.65;
    }
    aside.side {
      background: var(--chiron-surface); border-right: 1px solid var(--chiron-border);
      padding: var(--chiron-space-6) var(--chiron-space-5);
      overflow-y: auto; height: 100vh; position: sticky; top: 0;
    }
    .side .brand { font-family: var(--chiron-font-heading); font-weight: 700; font-size: 1.05rem; color: var(--chiron-accent); margin-bottom: var(--chiron-space-2); }
    .side .brand .dot { color: var(--chiron-warm-accent); }
    .side .sub { font-size: 0.78rem; color: var(--chiron-muted); margin-bottom: var(--chiron-space-6); line-height: 1.4; }
    .side .toc-header { font-family: var(--chiron-font-mono, monospace); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--chiron-muted); margin: var(--chiron-space-6) 0 var(--chiron-space-3); }
    .side .toc-link { display: flex; gap: var(--chiron-space-2); padding: var(--chiron-space-2) var(--chiron-space-3); border-radius: var(--chiron-radius-sm); color: var(--chiron-fg-secondary); text-decoration: none; font-size: 0.85rem; line-height: 1.35; margin-bottom: 2px; }
    .side .toc-link:hover { background: var(--chiron-elevated); color: var(--chiron-fg); }
    .side .toc-link.active { background: var(--chiron-accent-light); color: var(--chiron-accent); border-left: 3px solid var(--chiron-accent); padding-left: calc(var(--chiron-space-3) - 3px); }
    .side .toc-num { font-family: var(--chiron-font-mono, monospace); color: var(--chiron-muted); flex-shrink: 0; font-size: 0.8rem; }
    .side .view-picker { display: flex; gap: 4px; flex-wrap: wrap; margin-top: var(--chiron-space-3); }
    .side .view-picker button { font: inherit; font-size: 11px; padding: 5px 9px; border-radius: var(--chiron-radius-sm); background: var(--chiron-elevated); color: var(--chiron-fg-secondary); border: 1px solid var(--chiron-border); cursor: pointer; }
    .side .view-picker button[aria-pressed="true"] { background: var(--chiron-accent); color: var(--chiron-surface); border-color: var(--chiron-accent); }
    .side .theme-picker, .side .layout-picker { display: flex; gap: 4px; flex-wrap: wrap; margin-top: var(--chiron-space-2); }
    .side .theme-picker button, .side .layout-picker button { font: inherit; font-size: 10px; padding: 3px 7px; border-radius: var(--chiron-radius-sm); background: var(--chiron-elevated); color: var(--chiron-fg-secondary); border: 1px solid var(--chiron-border); cursor: pointer; }
    .side .theme-picker button[aria-pressed="true"], .side .layout-picker button[aria-pressed="true"] { background: var(--chiron-accent); color: var(--chiron-surface); border-color: var(--chiron-accent); }

    main.main { overflow-y: auto; height: 100vh; }

    /* === Chapter typography === */
    section.chapter { max-width: 1500px; margin: 0 auto; padding: 3rem 3rem 5rem; min-height: auto; }
    section.chapter > .ch-num { font-family: var(--chiron-font-mono, monospace); text-transform: uppercase; letter-spacing: 0.1em; color: var(--chiron-muted); font-size: 0.75rem; }
    section.chapter > h1 { font-family: var(--chiron-font-heading); font-size: 2.1rem; line-height: 1.2; margin: var(--chiron-space-2) 0 var(--chiron-space-4); color: var(--chiron-fg); max-width: 75ch; }
    section.chapter > .objective { font-style: italic; color: var(--chiron-fg-secondary); border-left: 3px solid var(--chiron-accent); padding-left: var(--chiron-space-4); margin-bottom: var(--chiron-space-6); max-width: 75ch; }
    section.chapter > p { max-width: 75ch; margin: var(--chiron-space-4) 0; }
    section.chapter > p code { background: var(--chiron-elevated); padding: 2px 6px; border-radius: var(--chiron-radius-sm); font-family: var(--chiron-font-mono, monospace); font-size: 0.88em; }
    section.chapter > table { width: 100%; max-width: 75ch; border-collapse: collapse; margin: var(--chiron-space-5) 0; clear: both; }
    section.chapter > table td { padding: var(--chiron-space-2) var(--chiron-space-3); border-bottom: 1px dashed var(--chiron-divider); font-size: 0.92rem; }
    section.chapter > table td:first-child { color: var(--chiron-accent); font-family: var(--chiron-font-heading); font-weight: 600; font-style: italic; }
    section.chapter > table td:last-child { color: var(--chiron-fg-secondary); font-family: var(--chiron-font-mono, monospace); font-size: 0.78rem; text-align: right; }
    section.chapter > table td:nth-child(2) { color: var(--chiron-fg); }

    /* Tufte-style margin notes — float right at ≥1200px */
    @media (min-width: 1200px) {
      section.chapter > .hy,
      section.chapter > .pearl,
      section.chapter > .mnemonic {
        float: right; clear: right; width: 280px;
        margin: 0 0 var(--chiron-space-4) var(--chiron-space-6);
        font-size: 0.86rem; line-height: 1.5;
      }
    }
    .hy, .pearl, .mnemonic {
      background: var(--chiron-elevated);
      border-left: 3px solid var(--chiron-accent);
      border-radius: var(--chiron-radius-sm);
      padding: var(--chiron-space-4);
      margin: var(--chiron-space-4) 0;
    }
    .pearl { border-left-color: var(--chiron-warm-accent); }
    .mnemonic { border-left-color: var(--chiron-accent); background: var(--chiron-surface); }
    .hy-title, .pearl-title, .mnemonic-title {
      font-family: var(--chiron-font-mono, monospace); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--chiron-muted); margin-bottom: var(--chiron-space-2);
    }
    .hy ul { margin: 0; padding-left: var(--chiron-space-5); }
    .hy li { margin: var(--chiron-space-2) 0; }

    /* Mermaid wrap */
    .mermaid-wrap { background: var(--chiron-surface); border: 1px solid var(--chiron-border); border-radius: var(--chiron-radius-md); padding: var(--chiron-space-5); margin: var(--chiron-space-5) 0; max-width: 75ch; clear: both; overflow-x: auto; }
    .mermaid { font-family: var(--chiron-font-mono, monospace); font-size: 0.85rem; color: var(--chiron-fg-secondary); white-space: pre; }

    /* Deck cleanup — widget surface */
    .deck { clear: both; }

    /* View switching — hide non-active views */
    body[data-view="quizzes"] section.chapter:not(#ch6) { display: none; }
    body[data-view="flashcards"] section.chapter:not(#ch7) { display: none; }

    /* footer */
    footer.lesson-footer { padding: var(--chiron-space-5) 3rem; color: var(--chiron-muted); font-size: 0.78rem; border-top: 1px solid var(--chiron-divider); max-width: 1500px; margin: 0 auto; }
    footer code { background: var(--chiron-elevated); padding: 2px 5px; border-radius: 3px; font-size: 0.85em; font-family: var(--chiron-font-mono, monospace); }

    /* Mobile: sidebar collapses to top strip */
    @media (max-width: 880px) {
      body { grid-template-columns: 1fr; }
      aside.side { position: relative; height: auto; border-right: none; border-bottom: 1px solid var(--chiron-border); padding: var(--chiron-space-4) var(--chiron-space-5); }
      .side .brand { display: inline-block; margin-right: var(--chiron-space-4); margin-bottom: 0; }
      section.chapter { padding: 2rem 1.25rem 4rem; }
    }

${emitSrCardCss().replace(/\n/g, '\n    ')}
${mmEmitted.css.replace(/\n/g, '\n    ')}
  </style>
</head>
<body>
  <aside class="side">
    <div class="brand">Chiron<span class="dot">·</span></div>
    <div class="sub">Italiano in ospedale<br>v2 · Klinefelter test-drive</div>

    <div class="toc-header">View</div>
    <div class="view-picker" role="group" aria-label="View">
      <button data-set-view="lesson">Lesson</button>
      <button data-set-view="quizzes">Quizzes</button>
      <button data-set-view="flashcards">Flashcards</button>
    </div>

    <div class="toc-header">Chapters</div>
${sidebarToc}

    <div class="toc-header">Theme</div>
    <div class="theme-picker">
      <button data-set-theme="clinical">clinical</button>
      <button data-set-theme="linguistic">linguistic</button>
      <button data-set-theme="warm-paper">warm</button>
      <button data-set-theme="midnight">midnight</button>
      <button data-set-theme="ocean">ocean</button>
    </div>

    <div class="toc-header">Layout</div>
    <div class="layout-picker">
      <button data-set-layout="l1">l1 · LMS</button>
      <button data-set-layout="l2">l2 · editorial</button>
      <button data-set-layout="l5">l5 · textbook</button>
    </div>
  </aside>

  <main class="main">
${chaptersHtml}

    <footer class="lesson-footer">
      Chiron · v2 Klinefelter-style test-drive · L5 textbook layout · clinical theme · ${new Date().toISOString().slice(0,10)}<br>
      Companion to <code>italian-medical-vocab-2026-05-14</code> (v1 · language-skeleton). Same content, different shell.
    </footer>
  </main>

  <!-- Mermaid CDN — graceful no-op if offline -->
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <script>
    if (window.mermaid) mermaid.initialize({ startOnLoad: true, theme: 'dark', securityLevel: 'loose' });

    // Theme + layout + view switching
    function wirePicker(attr, storageKey, htmlAttr) {
      document.querySelectorAll('[data-set-' + attr + ']').forEach(btn => {
        btn.addEventListener('click', () => {
          const v = btn.getAttribute('data-set-' + attr);
          document.documentElement.setAttribute(htmlAttr, v);
          if (storageKey) localStorage.setItem(storageKey, v);
          if (attr === 'view') document.body.setAttribute('data-view', v);
          document.querySelectorAll('[data-set-' + attr + ']').forEach(b =>
            b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
        });
      });
      const curr = (htmlAttr === 'data-view' ? document.body : document.documentElement).getAttribute(htmlAttr);
      document.querySelectorAll('[data-set-' + attr + ']').forEach(b =>
        b.setAttribute('aria-pressed', b.getAttribute('data-set-' + attr) === curr ? 'true' : 'false'));
    }
    document.body.setAttribute('data-view', 'lesson');
    wirePicker('theme', 'chiron-theme', 'data-theme');
    wirePicker('layout', 'chiron-layout', 'data-layout');
    wirePicker('view', null, 'data-view');

    // Sidebar TOC scrollspy
    const tocLinks = document.querySelectorAll('.toc-link');
    tocLinks.forEach(a => a.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.querySelector(a.getAttribute('href'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    const chapters = Array.from(document.querySelectorAll('section.chapter'));
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          const id = e.target.id;
          tocLinks.forEach(a => a.classList.toggle('active', a.getAttribute('data-chapter-target') === id));
        }
      });
    }, { rootMargin: '-30% 0px -55% 0px' });
    chapters.forEach(c => io.observe(c));

    // Flashcard flip
    document.querySelectorAll('.sr-card').forEach(card =>
      card.addEventListener('click', () => card.classList.toggle('flipped')));

    ${mmEmitted.js}
  </script>
</body>
</html>`;

writeFileSync(OUT, html);
console.error('[v2-build] Wrote', OUT);
console.error('[v2-build] Length:', html.length, 'chars · chapters:', CHAPTERS.length, '· MM sets:', mmConfig.sets.length);
