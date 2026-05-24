#!/usr/bin/env node
// Build italian-medical-vocab-2026-05-14 — cross-domain pipeline test.
// Validates: match-madness widget + language-flashcard-deck widget integration
// when invoked through `/chiron <italian medical topic>`.

import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildConjugationSet,
  emitMatchMadness,
} from '../dist/lib/widgets/match-madness.js';
import { emitSrDeck, emitSrCardCss } from '../dist/lib/widgets/sr-card.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const LESSON_DIR = resolve(REPO, 'lessons/italian-medical-vocab-2026-05-14');
const LESSON_HTML = resolve(LESSON_DIR, 'lesson.html');

// ============================================================================
// CONTENT — Italian medical vocab
// ============================================================================

// Clinician-side verbs: things YOU (the healthcare worker) do TO the patient
// or instructions YOU give. Reframed 2026-05-14 per user direction.
const VERBS = [
  { infinitive: 'visitare',     family: 'are',       englishGloss: 'examine' },
  { infinitive: 'ascoltare',    family: 'are',       englishGloss: 'listen-to' }, // ascoltare il cuore
  { infinitive: 'palpare',      family: 'are',       englishGloss: 'palpate' },
  { infinitive: 'misurare',     family: 'are',       englishGloss: 'measure' },   // la pressione, la febbre
  { infinitive: 'controllare',  family: 'are',       englishGloss: 'check' },
  { infinitive: 'prescrivere',  family: 'ere',       englishGloss: 'prescribe',
    participle: 'prescritto',
    irregular: { 'passato-remoto:io': 'prescrissi' } },
  { infinitive: 'somministrare', family: 'are',      englishGloss: 'administer' },
  { infinitive: 'spiegare',     family: 'are',       englishGloss: 'explain' },
  { infinitive: 'chiedere',     family: 'ere',       englishGloss: 'ask',
    participle: 'chiesto',
    irregular: { 'passato-remoto:io': 'chiesi' } },
  { infinitive: 'rassicurare',  family: 'are',       englishGloss: 'reassure' },
  { infinitive: 'monitorare',   family: 'are',       englishGloss: 'monitor' },
  { infinitive: 'aiutare',      family: 'are',       englishGloss: 'help' },
  { infinitive: 'curare',       family: 'are',       englishGloss: 'treat' },
  { infinitive: 'dimettere',    family: 'ere',       englishGloss: 'discharge',
    participle: 'dimesso',
    irregular: { 'passato-remoto:io': 'dimisi' } },
];

const NOUNS = [
  // Head & face
  { it: 'la testa',       en: 'head',         article: 'la',  bare: 'la testa' },
  { it: 'il viso',        en: 'face',         article: 'il',  bare: 'il viso' },
  { it: "l'occhio",       en: 'eye',          article: "l'",  bare: "l'occhio" },
  { it: "l'orecchio",     en: 'ear',          article: "l'",  bare: "l'orecchio" },
  { it: 'la bocca',       en: 'mouth',        article: 'la',  bare: 'la bocca' },
  { it: 'il naso',        en: 'nose',         article: 'il',  bare: 'il naso' },
  { it: 'la gola',        en: 'throat',       article: 'la',  bare: 'la gola' },
  { it: 'i denti',        en: 'teeth',        article: 'i',   bare: 'i denti' },
  // Torso & organs
  { it: 'il petto',       en: 'chest',        article: 'il',  bare: 'il petto' },
  { it: 'la pancia',      en: 'belly',        article: 'la',  bare: 'la pancia' },
  { it: 'lo stomaco',     en: 'stomach',      article: 'lo',  bare: 'lo stomaco' },
  { it: 'il cuore',       en: 'heart',        article: 'il',  bare: 'il cuore' },
  { it: 'il polmone',     en: 'lung',         article: 'il',  bare: 'il polmone' },
  { it: 'la schiena',     en: 'back',         article: 'la',  bare: 'la schiena' },
  { it: 'il sangue',      en: 'blood',        article: 'il',  bare: 'il sangue' },
  // Limbs
  { it: 'il braccio',     en: 'arm',          article: 'il',  bare: 'il braccio' },
  { it: 'la mano',        en: 'hand',         article: 'la',  bare: 'la mano' },
  { it: 'la gamba',       en: 'leg',          article: 'la',  bare: 'la gamba' },
  { it: 'il piede',       en: 'foot',         article: 'il',  bare: 'il piede' },
  { it: 'il ginocchio',   en: 'knee',         article: 'il',  bare: 'il ginocchio' },
  { it: 'la spalla',      en: 'shoulder',     article: 'la',  bare: 'la spalla' },
  // Symptoms
  { it: 'la febbre',      en: 'fever',        article: 'la',  bare: 'la febbre' },
  { it: 'il dolore',      en: 'pain',         article: 'il',  bare: 'il dolore' },
  { it: 'la tosse',       en: 'cough',        article: 'la',  bare: 'la tosse' },
  { it: 'la nausea',      en: 'nausea',       article: 'la',  bare: 'la nausea' },
];

const PREPOSITIONS = [
  { it: 'al pronto soccorso',    en: 'at the ER' },
  { it: 'dal dottore',           en: 'at the doctor (going to)' },
  { it: 'in farmacia',           en: 'at the pharmacy' },
  { it: 'sotto il braccio',      en: 'under the arm' },
  { it: "nell'orecchio",         en: 'in the ear' },
  { it: 'durante la notte',      en: 'during the night' },
  { it: 'da tre giorni',         en: 'for three days' },
  { it: 'con la febbre',         en: 'with a fever' },
  { it: 'senza dolore',          en: 'without pain' },
  { it: 'dopo i pasti',          en: 'after meals' },
];

// Clinician-side collocations: action + clinical object
const COLLOCATIONS = [
  { left: 'visitare',     right: 'il paziente' },
  { left: 'ascoltare',    right: 'il cuore' },
  { left: 'misurare',     right: 'la pressione' },
  { left: 'controllare',  right: 'la temperatura' },
  { left: 'prescrivere',  right: "l'antibiotico" },
  { left: 'somministrare', right: "l'iniezione" },
  { left: 'palpare',      right: "l'addome" },
  { left: 'spiegare',     right: 'la diagnosi' },
  { left: 'chiedere',     right: "l'anamnesi" },
  { left: 'dimettere',    right: 'il paziente' },
];

const IDIOMS = [
  { it: 'fare un\'anamnesi',     literal: 'to do a history',          meaning: 'to take a patient history' },
  { it: 'in osservazione',       literal: 'in observation',           meaning: 'admitted for observation' },
  { it: 'in bocca al lupo',      literal: 'in the wolf\'s mouth',     meaning: 'good luck (used between colleagues before a tough shift)' },
];

// 10 essential CLINICIAN phrases — questions you ask, instructions you give
const PHRASES = [
  { it: 'Come si sente oggi?',                    en: 'How are you feeling today?' },
  { it: 'Da quanto tempo ha questi sintomi?',     en: 'How long have you had these symptoms?' },
  { it: 'Mi indichi dove fa male.',               en: 'Show me where it hurts.' },
  { it: 'Apra la bocca, per favore.',             en: 'Open your mouth, please.' },
  { it: 'Respiri profondamente.',                 en: 'Breathe deeply.' },
  { it: 'È allergico/a a qualche medicina?',      en: 'Are you allergic to any medication?' },
  { it: 'Le prescrivo un antibiotico.',           en: "I'll prescribe an antibiotic." },
  { it: 'Lo prenda due volte al giorno dopo i pasti.', en: 'Take it twice a day after meals.' },
  { it: 'Stia tranquillo/a, non è grave.',        en: "Don't worry, it's not serious." },
  { it: 'La dimettiamo domani mattina.',          en: "We'll discharge you tomorrow morning." },
];

// ============================================================================
// MATCH MADNESS — universal multi-set retrieval anchor
// ============================================================================

const setVerbs = {
  id: 'set-1-verbs', index: 1, mode: 'vocab-pair',
  title: 'Verbi medici ↔ English',
  subtitle: 'Core 14 patient/doctor verbs',
  rounds: 3,
  pairs: VERBS.map(v => ({ id: `verb:${v.infinitive}`, left: `to ${v.englishGloss}`, right: v.infinitive })),
};

const setNouns = {
  id: 'set-2-body-parts', index: 2, mode: 'vocab-pair',
  title: 'Parti del corpo ↔ English',
  subtitle: '21 body parts + 4 symptom nouns',
  rounds: 5,
  pairs: NOUNS.map(n => ({ id: `noun:${n.bare}`, left: n.en, right: n.it })),
};

const setGender = {
  id: 'set-3-gender', index: 3, mode: 'gender-pair',
  title: "Genere — la / lo / il / l'",
  subtitle: 'Match each body part with its article',
  rounds: 5,
  pairs: NOUNS.slice(0, 16).map(n => ({ id: `gender:${n.bare}`, left: n.bare.replace(/^(la|lo|il|i|le|gli|l')\s?/,''), right: n.article, hint: n.en })),
};

const setPreps = {
  id: 'set-4-preps', index: 4, mode: 'prep-pair',
  title: 'Preposizioni in ospedale',
  subtitle: 'Hospital-context preposition phrases',
  rounds: 5,
  pairs: PREPOSITIONS.map((p, i) => ({ id: `prep:${i}`, left: p.en, right: p.it })),
};

const setCollocations = {
  id: 'set-5-collocations', index: 5, mode: 'collocation',
  title: 'Collocazioni — verbo + parte/oggetto',
  subtitle: 'avere mal di testa, prendere la medicina, ...',
  rounds: 5,
  pairs: COLLOCATIONS.map((c, i) => ({ id: `coll:${i}`, left: c.left, right: c.right })),
};

const TENSE_SETS = [
  { tense: 'presente',         index: 6,  title: 'Presente — io',       sub: 'Right now — io ho, io sento, io respiro' },
  { tense: 'passato-prossimo', index: 7,  title: 'Passato prossimo — io', sub: 'Compound past — io ho avuto, io ho sentito' },
  { tense: 'imperfetto',       index: 8,  title: 'Imperfetto — io',     sub: 'Continuous past — io avevo la febbre' },
  { tense: 'futuro-semplice',  index: 9,  title: 'Futuro semplice — io', sub: 'Future — io guarirò, io prenderò' },
].map(s => ({
  ...buildConjugationSet({
    setId: `set-${s.index}-${s.tense}`,
    index: s.index,
    title: s.title,
    verbs: VERBS,
    tense: s.tense,
    subjects: ['io'],
    rounds: 5,
  }),
  subtitle: s.sub,
}));

const allPriorPairs = [setVerbs, setNouns, setGender, setPreps, setCollocations, ...TENSE_SETS].flatMap(s => s.pairs);

const setSuper = {
  id: 'set-super', index: 10, mode: 'mixed',
  title: '🔥 SUPER-SET — Tutto insieme',
  subtitle: 'Up to 10 rounds, all medical content mixed.',
  rounds: 10,
  pairs: allPriorPairs,
  drawsFromSetIds: [
    'set-1-verbs','set-2-body-parts','set-3-gender','set-4-preps','set-5-collocations',
    'set-6-presente','set-7-passato-prossimo','set-8-imperfetto','set-9-futuro-semplice',
  ],
};

const mmConfig = {
  lessonId: 'italian-medical-vocab-2026-05-14',
  domain: 'language-it',
  title: 'Match Madness — automatismo medico',
  description: 'Ten sets of timed retrieval practice for Italian hospital vocabulary. Vocab, body-part gender, prepositions, collocations, and the 4 daily-use tenses for medical verbs. The final SUPER-SET interleaves everything. Per-pair latency is logged locally; weak pairs come back next session.',
  defaults: {
    timerSec: 105, wrongLockMs: 1500,
    accessibilityModeAllowed: true, keyboardShortcuts: true,
    visualSpeedUp: { pulseFromMs: 2000, pulseToMs: 600, strengthFromOpacity: 0.04, strengthToOpacity: 0.18, refillFromMs: 200, refillToMs: 100 },
  },
  sets: [setVerbs, setNouns, setGender, setPreps, setCollocations, ...TENSE_SETS, setSuper],
  unlockAccuracyThreshold: 0.6,
  superSetUnlockAfterNSetsCompleted: 3,
};

// ============================================================================
// EMIT — assemble the full lesson.html
// ============================================================================

const mmEmitted = emitMatchMadness(mmConfig);

// Flashcard deck: verbs + first 15 nouns (body parts) + idioms
const srDeckHtml = emitSrDeck({
  verbs: VERBS,
  nouns: NOUNS.slice(0, 15).map(n => ({ ...n, bare: n.bare.replace(/^(la|lo|il|i|le|gli|l')\s?/,'') })),
  idioms: IDIOMS,
});

const vocab1 = NOUNS.slice(0, 8);   // head & face
const vocab2 = NOUNS.slice(8, 15);  // torso & organs
const vocab3 = NOUNS.slice(15, 21); // limbs

function vocabRows(items) {
  return items.map(n => `        <tr><td><em>${n.it}</em></td><td>${n.en}</td></tr>`).join('\n');
}

// Reframed: YOU are the clinician (Tu), Sig.ra Russo is the patient
const dialogue = [
  ['Tu',             "Buongiorno, signora Russo. Sono il dottore / la dottoressa di turno. Come si sente oggi?",   "Good morning, Mrs Russo. I'm the doctor on shift. How are you feeling today?"],
  ['Sig.ra Russo',   "Non bene, dottore. Ho mal di testa e febbre da tre giorni.",                                  "Not well, doctor. I've had a headache and fever for three days."],
  ['Tu',             "Da quanto tempo, esattamente? E ha altri sintomi?",                                           "How long exactly? And do you have other symptoms?"],
  ['Sig.ra Russo',   "Da giovedì sera. Ho anche tosse e mi fa male il petto quando respiro.",                       "Since Thursday evening. I also have a cough and my chest hurts when I breathe."],
  ['Tu',             "Le misuro la pressione e la temperatura. È allergica a qualche medicina?",                    "I'll measure your blood pressure and temperature. Are you allergic to any medication?"],
  ['Sig.ra Russo',   "Sono allergica alla penicillina.",                                                            "I'm allergic to penicillin."],
  ['Tu',             "Bene, lo noto in cartella. Adesso ascolto il torace — respiri profondamente, per favore.",   "Good, I'll note that on the chart. Now I'll listen to your chest — breathe deeply, please."],
  ['Sig.ra Russo',   "Così? È grave, dottore?",                                                                     "Like this? Is it serious, doctor?"],
  ['Tu',             "Stia tranquilla, è una bronchite. Le prescrivo un antibiotico — non penicillina — per sette giorni.", "Don't worry, it's bronchitis. I'll prescribe an antibiotic — not penicillin — for seven days."],
  ['Sig.ra Russo',   "Come lo prendo?",                                                                              "How do I take it?"],
  ['Tu',             "Due volte al giorno dopo i pasti. E beva molta acqua. La controlliamo tra cinque giorni.",     "Twice a day after meals. And drink plenty of water. We'll check on you in five days."],
  ['Sig.ra Russo',   "Grazie mille, dottore.",                                                                       "Thank you so much, doctor."],
];

const dialogueHtml = dialogue.map(([speaker, it, en]) => {
  // Speaker color coding: Tu (clinician — you) = primary accent; patient = warm-accent
  const cls = speaker === 'Tu' ? 'marco' : 'alice';
  return `        <div class="turn ${cls}"><span class="speaker">${speaker}</span><div class="what"><span class="it">${it}</span><span class="gloss">${en}</span></div></div>`;
}).join('\n');

// ============================================================================
// STORIES — 6 medical-themed Italian stories, A2 + B1 paired by theme
// ============================================================================

const STORIES = [
  {
    level: 'a2', tone: 'funny',
    title: 'La febbre del cavallo',
    text: `<p>Il primo turno della dottoressa Smith a Bologna. Entra il signor Rossi, sudato e tremante. «Dottoressa, ho la <span class="g" title="lit. 'horse fever' — idiom for very high fever">febbre del cavallo!</span>». La dottoressa lo guarda preoccupata: «Un cavallo? Lei ha toccato un cavallo? Le ha morso?». Il paziente ride: «No, dottoressa! È un <em>modo di dire</em>. Significa che ho una febbre molto alta». La dottoressa sorride: «Capisco. Bene, misuriamola». 39 e 5. «Sì, in effetti, è proprio una febbre da cavallo!».</p>`,
    source: 'Original — common Italian medical idiom',
  },
  {
    level: 'b1', tone: 'funny',
    title: 'La febbre del cavallo (versione lunga)',
    text: `<p>Il primo turno della dottoressa Smith a Bologna, otto del mattino. Entra il signor Rossi, sudato e <span class="g" title="trembling">tremante</span>, con la moglie. «Dottoressa, ho la <span class="g" title="horse fever — idiom for very high fever">febbre del cavallo</span> da tre giorni!». La dottoressa, perplessa, prende l'<span class="g" title="patient history">anamnesi</span>: «Lei ha avuto contatti con cavalli recentemente? Stalle, ippodromi?». La moglie scoppia a ridere. Il marito spiega: «Dottoressa, è un'espressione. "Febbre da cavallo" significa una febbre molto, molto alta». La dottoressa <span class="g" title="reassures herself">si rassicura</span> e misura: 39,5 °C. «Capisco adesso. La lingua italiana è piena di animali — anche <em>la febbre del cavallo</em> esiste solo qui». Le prescrive paracetamolo e <span class="g" title="bed rest">riposo</span>.</p>`,
    source: 'Original — based on common newly-arrived-foreign-doctor anecdotes',
  },
  {
    level: 'a2', tone: 'serious',
    title: 'Il primo turno di notte',
    text: `<p>Sono le tre del mattino in reparto. La dottoressa straniera è sola al banco. Una infermiera entra: «Letto 12, la signora di 82 anni. Ha la pressione bassa». La dottoressa controlla. Ottanta su quaranta. Bassa davvero. Visita la paziente. La signora dorme, ma il respiro è regolare. La dottoressa <span class="g" title="prescribes">prescrive</span> fluidi, monitora per due ore. Alle cinque la pressione torna normale. La dottoressa <span class="g" title="writes in chart">scrive in cartella</span> e respira profondamente. Il primo turno di notte sta finendo. Ha capito tutto in italiano.</p>`,
    source: 'Original — reflective slice',
  },
  {
    level: 'b1', tone: 'serious',
    title: 'Il primo turno di notte (versione lunga)',
    text: `<p>Le tre del mattino, reparto di medicina interna, ospedale Sant'Orsola, Bologna. La dottoressa straniera è sola al banco. L'<span class="g" title="night-shift nurse">infermiera del turno notturno</span> arriva con la cartella: «Letto 12, la signora Bertoli, 82 anni. La pressione è scesa a 80/40. Era 120/70 alle ventidue». La dottoressa <span class="g" title="goes back over the case">ripercorre il caso</span> mentalmente: <span class="g" title="dehydration">disidratazione</span>? <span class="g" title="cardiac issue">scompenso</span>? Visita la paziente: <span class="g" title="weak but rhythmic pulse">polso debole ma ritmico</span>, respiro regolare. <span class="g" title="prescribes">Prescrive</span> 500 ml di <span class="g" title="saline">soluzione fisiologica</span> e ordina di rimisurare ogni trenta minuti. Alle cinque la pressione è 100/60. La dottoressa <span class="g" title="writes in chart">scrive in cartella</span>, firma, e va a prendere un caffè. Il primo turno di notte sta finendo. Ha capito tutto, ha deciso tutto, in italiano.</p>`,
    source: 'Original — Bologna reflective piece',
  },
  {
    level: 'a2', tone: 'immersive',
    title: 'Una mattina in reparto',
    text: `<p>Sette del mattino. Il <span class="g" title="primario — ward chief">primario</span> entra in reparto. «Buongiorno a tutti. Iniziamo il <span class="g" title="ward round">giro visite</span>». La dottoressa straniera prende le cartelle. Letto uno: signor Ferri, polmonite, terzo giorno di antibiotico. Letto due: signora Conti, in osservazione per <span class="g" title="chest pain">dolore al petto</span>. Letto tre: il giovane Marco, appendicectomia ieri, sta meglio. Il primario chiede alla dottoressa: «Cosa pensa del letto due?». Lei risponde, in italiano: «Tre <span class="g" title="ECGs">elettrocardiogrammi</span> normali, troponine negative. Possiamo dimetterla oggi». Il primario sorride: «Brava».</p>`,
    source: 'Original — morning ward round',
  },
  {
    level: 'b1', tone: 'immersive',
    title: 'Una mattina in reparto (versione lunga)',
    text: `<p>Sette del mattino. Il <span class="g" title="primario — ward chief">primario</span>, professore Marchetti, entra in reparto seguito da due specializzandi e l'<span class="g" title="ward sister">infermiera caposala</span>. «Buongiorno a tutti. Iniziamo il giro». La dottoressa straniera, alla sua quarta settimana, prende le cartelle. <strong>Letto 1</strong>: signor Ferri, polmonite acquisita in comunità, terzo giorno di ceftriaxone, <span class="g" title="afebrile">apiretico</span> da ventiquattro ore. <strong>Letto 2</strong>: signora Conti, ammessa ieri per dolore toracico atipico, tre ECG normali, troponine negative. <strong>Letto 3</strong>: Marco, vent'anni, <span class="g" title="appendicectomy">appendicectomia</span> ieri, <span class="g" title="passing gas — sign of bowel recovery">canalizzato a gas</span>, niente <span class="g" title="fever">febbre</span>. Il primario, davanti al letto 2: «Cosa propone, dottoressa?». Lei risponde, in italiano fluente: «Tre ECG seriali normali, due troponine negative a sei ore di distanza, <span class="g" title="discharge">dimissione</span> con visita di controllo cardiologica tra dieci giorni». Il primario annuisce: «D'accordo. Brava».</p>`,
    source: 'Original — extended morning round',
  },
];

const storiesHtml = STORIES.map(s => `
        <article class="story-block level-${s.level}">
          <div class="meta">
            <span class="level">${s.level.toUpperCase()}</span>
            <span class="tone">${s.tone}</span>
          </div>
          <h4>${s.title}</h4>
          <div class="story-grid">
            <div class="it-text">${s.text}</div>
            <aside class="gloss-panel">
              <h5>Gloss / hint</h5>
              <p>Hover any <span style="border-bottom: 1px dotted var(--chiron-warm-accent);">underlined</span> word in the story for the English meaning.</p>
            </aside>
          </div>
          <div class="source">${s.source}</div>
        </article>`).join('\n');

// ============================================================================
// JOKES — 2 medical Italian jokes (pausa umoristica)
// ============================================================================

const JOKES = [
  {
    title: 'Barzelletta 1 · «E lei non lo faccia»',
    body: `<p>Un paziente entra dallo specialista. «Dottore, mi fa male <strong>quando faccio così</strong>», e alza il braccio sopra la testa.</p>
           <p>Lo specialista lo guarda serenamente. <em>«E lei non lo faccia.»</em></p>
           <p>Il paziente: <em>«Ma dottore, era una visita da settecento euro!»</em></p>
           <p>Lo specialista: <em>«Sì, ma il consiglio è gratis».</em></p>`,
    note: `Universal medical joke, very common in Italian repertoire. Plays on "<em>quando faccio così</em>" = "when I do this" — the patient demonstrates the painful motion.`,
  },
  {
    title: 'Barzelletta 2 · «Il farmacista»',
    body: `<p>Una signora entra in farmacia: <em>«Buongiorno, vorrei qualcosa per il <strong>singhiozzo</strong>»</em> (the hiccups).</p>
           <p>Il farmacista, all'improvviso, urla: <em>«ATTENZIONE! C'È UN INCENDIO!»</em>.</p>
           <p>La signora, terrorizzata, salta indietro. Poi si calma, e dice piano: <em>«Grazie, mi è passato».</em></p>
           <p>Il farmacista, sorridendo: <em>«Vede? Funziona sempre. Sono cinque euro.»</em></p>`,
    note: `Italian pharmacist humor — the spavento (scare) cure for hiccups is folk-medicine standard.`,
  },
];

const jokesHtml = JOKES.map(j => `
        <div class="joke">
          <div class="joke-title">${j.title}</div>
          ${j.body}
          <div class="callout false-friend" style="margin-top: var(--chiron-space-3);">
            <span class="tag">Note</span>
            ${j.note}
          </div>
        </div>`).join('\n');

const phrasesHtml = PHRASES.map(p =>
  `        <div class="phrase-row"><span class="phrase-it">${p.it}</span><span class="phrase-en">${p.en}</span></div>`
).join('\n');

// ----------------------------------------------------------------------------
// Borrow component CSS from the cleaning-verbs lesson (proven working) + emit
// the MM and SR card CSS via the widget functions, all inline. Theme tokens
// loaded via <link> per the BLOCKING contract.
// ----------------------------------------------------------------------------

const baseLessonHtml = readFileSync(resolve(REPO, 'lessons/italian-cleaning-verbs-2026-05-12/lesson.html'), 'utf8');
// Extract just the <style>…</style> block (lines ~20-310) — proven theme-token-safe
const styleMatch = baseLessonHtml.match(/<style>([\s\S]*?)<\/style>/);
if (!styleMatch) throw new Error('Could not extract base styles');
let baseStyles = styleMatch[1];

// Strip the OLD inline MM-specific CSS from the base styles — we re-add our widget CSS via emitters
baseStyles = baseStyles.replace(/\n    \/\* ---- Match Madness[\s\S]*?(?=\n    \/\* ---- SR drawer)/, '\n    /* (MM CSS now emitted by widget) */\n');
// Add a small phrasebook style
const phrasebookCss = `
    /* ---- Phrasebook ---- */
    .phrasebook { display: grid; grid-template-columns: 1fr 1fr; gap: var(--chiron-space-3); }
    .phrase-row { display: contents; }
    .phrase-it { font-family: var(--chiron-font-heading); color: var(--chiron-fg); padding: var(--chiron-space-3) 0; border-bottom: 1px dashed var(--chiron-divider); }
    .phrase-en { color: var(--chiron-fg-secondary); padding: var(--chiron-space-3) 0; border-bottom: 1px dashed var(--chiron-divider); font-style: italic; }
    @media (max-width: 720px) { .phrasebook { grid-template-columns: 1fr; } }
`;

const lessonHtml = `<!DOCTYPE html>
<html lang="it" data-theme="linguistic" data-view="lesson" data-skeleton="language-lesson-skeleton-v1">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Chiron · Italiano in ospedale</title>

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700;12..96,800&family=Source+Serif+4:ital,wght@0,400;0,600;1,400;1,600&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

  <link rel="stylesheet" href="themes/_tokens.css" />
  <link rel="stylesheet" href="themes/midnight.css" />
  <link rel="stylesheet" href="themes/warm-paper.css" />
  <link rel="stylesheet" href="themes/clinical.css" />
  <link rel="stylesheet" href="themes/linguistic.css" />
  <link rel="stylesheet" href="themes/ocean.css" />

  <script>
    (function () {
      const valid = ['linguistic','midnight','warm-paper','clinical','ocean'];
      const p = new URLSearchParams(location.search);
      const t = p.get('theme');
      const stored = localStorage.getItem('chiron-theme');
      const theme = valid.includes(t) ? t : (valid.includes(stored) ? stored : 'linguistic');
      document.documentElement.setAttribute('data-theme', theme);
      if (t) localStorage.setItem('chiron-theme', t);
    })();
  </script>

  <style>${baseStyles}${phrasebookCss}
${emitSrCardCss()}
  </style>
</head>
<body>

  <header class="top-bar">
    <span class="brand">Chiron<span class="dot">·</span></span>
    <div class="theme-bar" role="group" aria-label="Theme">
      <button data-set-theme="linguistic">linguistic</button>
      <button data-set-theme="warm-paper">warm paper</button>
      <button data-set-theme="clinical">clinical</button>
      <button data-set-theme="midnight">midnight</button>
      <button data-set-theme="ocean">ocean</button>
    </div>
  </header>

  <nav class="nav-dots" role="tablist" aria-label="Sezioni">
    <button class="nav-dot" data-target="s0" role="tab" aria-label="Cold open"></button>
    <button class="nav-dot" data-target="s1a" role="tab" aria-label="Body 1"></button>
    <button class="nav-dot" data-target="s1b" role="tab" aria-label="Body 2"></button>
    <button class="nav-dot" data-target="s1c" role="tab" aria-label="Body 3"></button>
    <button class="nav-dot" data-target="s2" role="tab" aria-label="Symptoms"></button>
    <button class="nav-dot" data-target="s3" role="tab" aria-label="Dialogue"></button>
    <button class="nav-dot" data-target="s4" role="tab" aria-label="Phrasebook"></button>
    <button class="nav-dot" data-target="s5" role="tab" aria-label="Match Madness"></button>
    <button class="nav-dot" data-target="s7" role="tab" aria-label="SR cards"></button>
    <button class="nav-dot" data-target="s8" role="tab" aria-label="Closing"></button>
  </nav>

  <div class="lesson-shell">

    <header class="lesson-header">
      <span class="eyebrow">Italian · for healthcare professionals · A2-B1</span>
      <h1 class="lesson-title">Italiano in ospedale — per chi lavora</h1>
      <p class="subtitle">For English-speaking doctors and nurses working in Italian wards — body, symptoms, taking a history, giving instructions</p>
    </header>

    <!-- ========================= 0. COLD OPEN ========================= -->
    <section class="lesson-section" id="s0">
      <div class="cold-open">
        <span class="it">Sei un medico straniero al tuo primo turno in reparto a Bologna. Una paziente entra: <em>«Dottore, non mi sento bene»</em>. Sai prendere l'anamnesi, fare l'esame obiettivo, e spiegarle la diagnosi <strong>in italiano</strong>?</span>
        <span class="gloss" style="display:block;margin-top:var(--chiron-space-3);font-style:normal;color:var(--chiron-muted);font-size:0.9em;">You're a foreign doctor on your first ward shift in Bologna. A patient walks in: <em>"Doctor, I don't feel well."</em> Can you take the history, do the physical exam, and explain the diagnosis <strong>in Italian</strong>?</span>
      </div>
    </section>

    <!-- ========================= 1a. HEAD & FACE ========================= -->
    <section class="lesson-section" id="s1a">
      <h2 class="section-h"><span class="num">1·</span>Corpo 1 — la testa e il viso</h2>
      <p>Otto parole per la zona "alta": testa, viso, occhi, orecchi, bocca, naso, gola, denti. Notate gli articoli — sono fondamentali in italiano.</p>
      <div class="vocab-arc">
        <table class="vocab-table">
          <thead><tr><th>Italiano</th><th>English</th></tr></thead>
          <tbody>
${vocabRows(vocab1)}
          </tbody>
        </table>
      </div>
    </section>

    <!-- ========================= 1b. TORSO & ORGANS ========================= -->
    <section class="lesson-section" id="s1b">
      <h2 class="section-h"><span class="num">2·</span>Corpo 2 — il tronco e gli organi</h2>
      <p>Per descrivere dolori interni e respirazione.</p>
      <div class="vocab-arc">
        <table class="vocab-table">
          <thead><tr><th>Italiano</th><th>English</th></tr></thead>
          <tbody>
${vocabRows(vocab2)}
          </tbody>
        </table>
      </div>
    </section>

    <!-- ========================= 1c. LIMBS ========================= -->
    <section class="lesson-section" id="s1c">
      <h2 class="section-h"><span class="num">3·</span>Corpo 3 — gli arti</h2>
      <p>Braccia, gambe, mani, piedi — più le articolazioni più dolorose: ginocchio, spalla.</p>
      <div class="vocab-arc">
        <table class="vocab-table">
          <thead><tr><th>Italiano</th><th>English</th></tr></thead>
          <tbody>
${vocabRows(vocab3)}
          </tbody>
        </table>
      </div>
    </section>

    <!-- ========================= 2. CLINICIAN VERBS ========================= -->
    <section class="lesson-section" id="s2">
      <h2 class="section-h"><span class="num">4·</span>I verbi del medico</h2>
      <p>I 14 verbi che <strong>tu</strong> usi durante un turno: come si prende l'anamnesi, si fa l'esame, si prescrive, si dimette. Per descrivere i sintomi del paziente vedi le frasi "salvavita" più avanti.</p>
      <div class="vocab-arc">
        <table class="vocab-table">
          <thead><tr><th>Infinitive</th><th>English</th><th>Family</th></tr></thead>
          <tbody>
${VERBS.map(v => `        <tr><td><em>${v.infinitive}</em></td><td>to ${v.englishGloss}</td><td><code>${v.family}</code></td></tr>`).join('\n')}
          </tbody>
        </table>
      </div>

      <div class="callout grammar-pearl" style="margin-top: var(--chiron-space-4);">
        <span class="tag">Pearl · "Le" vs "ti" — formal vs informal</span>
        With patients you always use the <strong>formal</strong> Lei form, even with children's parents. <em>Le prescrivo</em> ("I prescribe to you-formal"), <em>Respiri</em> ("breathe-formal-imperative"), <em>Si distenda</em> ("lie down, formal"). Switching to <em>tu</em> with an adult patient is unprofessional in an Italian clinical setting.
      </div>
    </section>

    <!-- ========================= 3. DIALOGUE ========================= -->
    <section class="lesson-section" id="s3">
      <h2 class="section-h"><span class="num">5·</span>Conversazione — prendere l'anamnesi</h2>
      <p>Tu (il medico straniero) visiti la sig.ra Russo al primo accesso in ambulatorio. Dodici turni, comprensione alla fine.</p>

      <div class="vocab-arc">
${dialogueHtml}
      </div>

      <h3 class="subsection-h">Domande di comprensione</h3>
      <div class="cloze-line" data-answer="tre giorni">
        1. Da quanto tempo la paziente ha i sintomi? <input type="text" /> <span class="hint">(2 parole)</span>
      </div>
      <div class="cloze-line" data-answer="penicillina">
        2. A cosa è allergica? <input type="text" />
      </div>
      <div class="cloze-line" data-answer="bronchite">
        3. Qual è la diagnosi? <input type="text" />
      </div>
      <div class="cloze-line" data-answer="cinque giorni">
        4. Tra quanto tempo è prevista la visita di controllo? <input type="text" /> <span class="hint">(2 parole)</span>
      </div>
    </section>

    <!-- ========================= 4. PHRASEBOOK ========================= -->
    <section class="lesson-section" id="s4">
      <h2 class="section-h"><span class="num">6·</span>Frasi salvavita — 10 espressioni che dici tu</h2>
      <p>Le 10 frasi che <strong>tu, il medico straniero,</strong> dirai ogni turno. Tutte in forma di cortesia (Lei). Le risposte tipiche del paziente in italiano sono nella colonna a destra.</p>
      <div class="phrasebook">
${phrasesHtml}
      </div>
    </section>

    <!-- ========================= 4b. RACCONTI (6 stories) ========================= -->
    <section class="lesson-section" id="s4b">
      <h2 class="section-h"><span class="num">7·</span>Racconti dall'ospedale — sei storie</h2>
      <p>Tre temi (divertente · serio · immersivo) × due livelli (A2 · B1). Le storie usano il vocabolario medico che hai appena imparato; le versioni B1 introducono ~5–8 lessemi clinici nuovi (gloss in margine).</p>
${storiesHtml}
    </section>

    <!-- ========================= 4c. PAUSA UMORISTICA (jokes) ========================= -->
    <section class="lesson-section" id="s4-funny">
      <h2 class="section-h"><span class="num">8·</span>Pausa umoristica medica — due barzellette</h2>
      <p>Due classici dell'umorismo medico italiano. Da raccontare al collega dopo un turno faticoso.</p>
      <div class="jokes-sidebar">
${jokesHtml}
      </div>
      <div class="callout cultural-note">
        <span class="tag">Cultural note · medical humor in Italy</span>
        Italian hospital staff use humor as a coping mechanism just like everywhere else, but the register is strictly informal — <em>tu</em> between colleagues, never with patients. The two jokes above work in any Italian doctors' lounge.
      </div>
    </section>

    <!-- ========================= 5. MATCH MADNESS ========================= -->
    <section class="lesson-section" id="s5">
      <h2 class="section-h"><span class="num">9·</span>Match Madness — automatismo medico</h2>
      ${mmEmitted.html}
      <style>${mmEmitted.css}</style>
    </section>

    <!-- ========================= 7. SR DRAWER ========================= -->
    <section class="lesson-section" id="s7">
      <h2 class="section-h"><span class="num">10·</span>Carte SR — ripasso spaziato</h2>
      <p>Click to flip. Verbs show the 4 daily-use tenses on the back. Nouns show article + gloss. Idioms show meaning + literal.</p>
      <div class="sr-deck">${srDeckHtml}
      </div>
    </section>

    <!-- ========================= 8. CLOSING ========================= -->
    <section class="lesson-section" id="s8">
      <h2 class="section-h"><span class="num">11·</span>Chiusura</h2>
      <div class="closing">
        <div class="turn marco">
          <span class="speaker">Collega italiano</span>
          <div class="what">
            <span class="it">Adesso sai prendere un'anamnesi, fare un esame obiettivo di base, prescrivere, dare istruzioni e dimettere — tutto in italiano e nella forma di cortesia. Conosci 25 parti del corpo, 14 verbi clinici, e 10 frasi essenziali. <strong>In bocca al lupo per il tuo prossimo turno!</strong></span>
            <span class="gloss">Now you know how to take a history, do a basic physical exam, prescribe, give instructions, and discharge — all in Italian and in the formal register. You know 25 body parts, 14 clinical verbs, and 10 essential phrases. Good luck on your next shift! (lit. "into the wolf's mouth")</span>
          </div>
        </div>
      </div>
    </section>

    <footer class="lesson-footer">
      Chiron · language-lesson-skeleton v1 · 2026-05-14 · linguistic theme · for English-speaking healthcare workers in Italian hospitals ·
      try <code>?theme=clinical</code> in the URL for medical vibes
    </footer>

  </div>

  <!-- ========================= JS ========================= -->
  <script>
    /* ===== Theme switcher ===== */
    document.querySelectorAll('[data-set-theme]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.getAttribute('data-set-theme');
        document.documentElement.setAttribute('data-theme', t);
        localStorage.setItem('chiron-theme', t);
        document.querySelectorAll('[data-set-theme]').forEach(b => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
      });
    });
    { const current = document.documentElement.getAttribute('data-theme');
      document.querySelectorAll('[data-set-theme]').forEach(b => b.setAttribute('aria-pressed', b.getAttribute('data-set-theme') === current ? 'true' : 'false')); }

    /* ===== Nav dot scrollspy + click ===== */
    const dots = document.querySelectorAll('.nav-dot');
    dots.forEach(d => d.addEventListener('click', () => {
      const target = document.getElementById(d.getAttribute('data-target'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    const sections = Array.from(document.querySelectorAll('section.lesson-section'));
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          const id = e.target.id;
          dots.forEach(d => d.setAttribute('aria-current', d.getAttribute('data-target') === id ? 'true' : 'false'));
        }
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    sections.forEach(s => io.observe(s));

    /* ===== Cloze grading ===== */
    document.querySelectorAll('.cloze-line').forEach(line => {
      const input = line.querySelector('input');
      const answer = line.getAttribute('data-answer').toLowerCase().trim();
      const check = () => {
        const val = (input.value || '').toLowerCase().trim();
        if (!val) return;
        if (val === answer) input.classList.add('correct'), input.classList.remove('incorrect');
        else input.classList.add('incorrect'), input.classList.remove('correct');
      };
      input.addEventListener('blur', check);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') check(); });
    });

    /* ===== Flashcard flip ===== */
    document.querySelectorAll('.sr-card').forEach(card => {
      card.addEventListener('click', () => card.classList.toggle('flipped'));
    });

${mmEmitted.js}
  </script>
</body>
</html>
`;

writeFileSync(LESSON_HTML, lessonHtml);
console.error('[medical-build] Wrote', LESSON_HTML);
console.error('[medical-build] MM sets:', mmConfig.sets.length, '· total pairs:', mmConfig.sets.reduce((n,s)=>n+s.pairs.length,0));
console.error('[medical-build] SR cards: verbs', VERBS.length, 'nouns', 15, 'idioms', IDIOMS.length);
console.error('[medical-build] Lesson length:', lessonHtml.length, 'chars');
