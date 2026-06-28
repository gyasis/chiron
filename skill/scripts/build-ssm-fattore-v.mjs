#!/usr/bin/env node
// Build chiron-ssm-fattore-v — language-it `passage` sub-mode, FULL SSM exam item.
// Voiced by Lucrezia. Stem + 5 REAL options (B = Fattore V correct).
// Built from the renderer (renderWidget) + the language-lesson-skeleton shell.

import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderWidget } from '../dist/lib/widget-renderer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SK = resolve(__dirname, '..');                       // skill/
const OUT = resolve(process.env.HOME, 'Documents/generated/chiron-ssm-fattore-v/lesson.html');
const GEN_DATE = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// The FULL exam item (verbatim from source)
// ---------------------------------------------------------------------------
const STEM_SENTENCES = [
  'Una donna di 28 anni in buone condizioni di salute vuole iniziare una terapia anticoncezionale con un estroprogestinico.',
  'Su consiglio del medico curante si sottopone a una dettagliata valutazione dei fattori di rischio pro-trombotici, in virtù del fatto che la madre, qualche anno prima, aveva avuto una tromboembolia polmonare.',
  'Gli esami risultano nei limiti di norma, fatta eccezione per la presenza di resistenza alla proteina C attivata.',
  'In quale delle seguenti proteine della coagulazione si verifica una mutazione tipicamente associata a tale dato di laboratorio?',
];
const STEM_FULL = STEM_SENTENCES.join(' ');
const OPTIONS = [
  { letter: 'A', text: 'Antitrombina' },
  { letter: 'B', text: 'Fattore V' },
  { letter: 'C', text: 'Fibrinogeno' },
  { letter: 'D', text: 'Fattore II' },
  { letter: 'E', text: 'Proteina S' },
];

// ===========================================================================
// WIDGET 1 — annotated-passage (interlinear breakdown of the STEM)
// Beginner-level: EVERY function word parsed. Concept layer ties IT→medicine.
// Stem sentences carry audioId="vocab-stem-N" so the inline ▶ wires per-sentence.
// ===========================================================================
const ap = {
  type: 'annotated-passage',
  id: 'ap-stem',
  language: 'it',
  domain: 'medicine',
  genre: 'exam-question',
  register: 'formal',
  layers: [
    { key: 'articles',    label: 'Articoli',     defaultOn: true },
    { key: 'nouns',       label: 'Nomi',         defaultOn: true },
    { key: 'verbs',       label: 'Verbi',        defaultOn: true },
    { key: 'preps',       label: 'Preposizioni', defaultOn: true },
    { key: 'pronouns',    label: 'Pronomi',      defaultOn: false },
    { key: 'adverbs',     label: 'Avverbi',      defaultOn: false },
    { key: 'phrases',     label: 'Espressioni',  defaultOn: true },
    { key: 'translation', label: 'Traduzione',   defaultOn: true },
    { key: 'literal',     label: 'Letterale',    defaultOn: false },
    { key: 'concept',     label: 'Concetto (medicina)', defaultOn: true },
  ],
  anomalies: [],
  sentences: [
    {
      idx: 1,
      text: STEM_SENTENCES[0],
      audioId: 'vocab-stem-1',
      translation: 'A 28-year-old woman in good health wants to start a contraceptive therapy with an estrogen-progestin.',
      literal: 'A woman of 28 years in good conditions of health wants to-start a therapy contraceptive with an estrogen-progestin.',
      mood: 'declarative',
      registerNote: 'Clinical-narrative register: the impersonal case-presentation voice of an exam vignette.',
      concept: 'The patient is a candidate for combined oral contraception (estrogen + progestin). Combined estrogen-progestin pills are themselves prothrombotic — this is the clinical hook the whole item turns on.',
      tokens: [
        { surface: 'Una', lemma: 'uno', pos: 'DET', layer: 'articles', features: { type: 'indefinite', gender: 'f', number: 'sg' }, note: 'Indefinite article, feminine singular. `una` (not `un`/`uno`) because the noun `donna` is feminine and starts with a consonant. The English "a/an".' },
        { surface: 'donna', lemma: 'donna', pos: 'NOUN', layer: 'nouns', features: { gender: 'f', number: 'sg' }, note: 'Noun "woman", feminine singular. It anchors the whole agreement chain: `una … donna … in buone condizioni`.' },
        { surface: 'di', lemma: 'di', pos: 'ADP', layer: 'preps', features: { type: 'simple' }, note: 'Simple preposition "of". Here it expresses age: `di 28 anni` = "of 28 years" = "28-year-old".' },
        { surface: '28', lemma: '28', pos: 'NUM', layer: 'nouns', features: { type: 'cardinal' }, note: 'Cardinal number twenty-eight (ventotto). Modifies `anni`.' },
        { surface: 'anni', lemma: 'anno', pos: 'NOUN', layer: 'nouns', features: { gender: 'm', number: 'pl' }, note: 'Noun "years", masculine plural (sing. `anno`). Italian states age as `di X anni` — literally "of X years".' },
        { surface: 'in', lemma: 'in', pos: 'ADP', layer: 'preps', features: { type: 'simple' }, note: 'Simple preposition "in". Introduces the state/condition phrase `in buone condizioni di salute`.' },
        { surface: 'buone', lemma: 'buono', pos: 'ADJ', layer: 'nouns', features: { gender: 'f', number: 'pl' }, note: 'Adjective "good", feminine plural — agrees with `condizioni` (f. pl.). `buono → buona → buone`.' },
        { surface: 'condizioni', lemma: 'condizione', pos: 'NOUN', layer: 'nouns', features: { gender: 'f', number: 'pl' }, note: 'Noun "conditions", feminine plural (sing. `condizione`). Nouns ending `-ione` are feminine.' },
        { surface: 'di', lemma: 'di', pos: 'ADP', layer: 'preps', features: { type: 'simple' }, note: 'Preposition "of" again — `condizioni di salute` = "conditions of health" = "health".' },
        { surface: 'salute', lemma: 'salute', pos: 'NOUN', layer: 'nouns', features: { gender: 'f', number: 'sg' }, note: 'Noun "health", feminine singular. `la salute`. A high-frequency clinical word.' },
        { surface: 'vuole', lemma: 'volere', pos: 'VERB', layer: 'verbs', features: { tense: 'presente', mood: 'indicativo', person: '3', number: 'sg', irregular: true }, note: 'From `volere` ("to want") — irregular. 3rd person singular present: `(lei) vuole` = "she wants". Modal verb: it is followed by a bare infinitive (`iniziare`).' },
        { surface: 'iniziare', lemma: 'iniziare', pos: 'VERB', layer: 'verbs', features: { form: 'infinitive', family: 'are' }, note: 'Infinitive "to start/begin", `-are` family. After a modal like `vuole`, the second verb stays in the infinitive: `vuole iniziare` = "wants to start".' },
        { surface: 'una', lemma: 'uno', pos: 'DET', layer: 'articles', features: { type: 'indefinite', gender: 'f', number: 'sg' }, note: 'Indefinite article again, f. sg. — agrees with `terapia` (feminine).' },
        { surface: 'terapia', lemma: 'terapia', pos: 'NOUN', layer: 'nouns', features: { gender: 'f', number: 'sg' }, note: 'Noun "therapy", feminine singular. `la terapia`.' },
        { surface: 'anticoncezionale', lemma: 'anticoncezionale', pos: 'ADJ', layer: 'nouns', features: { gender: 'f/m', number: 'sg' }, note: 'Adjective "contraceptive". Adjectives ending `-e` are the same for masculine and feminine; only number changes (`-e → -i`). Modifies `terapia`.' },
        { surface: 'con', lemma: 'con', pos: 'ADP', layer: 'preps', features: { type: 'simple' }, note: 'Simple preposition "with". Introduces the drug used: `con un estroprogestinico`.' },
        { surface: 'un', lemma: 'uno', pos: 'DET', layer: 'articles', features: { type: 'indefinite', gender: 'm', number: 'sg' }, note: 'Indefinite article, masculine singular. `un` (not `uno`) before a masculine noun starting with a simple consonant.' },
        { surface: 'estroprogestinico', lemma: 'estroprogestinico', pos: 'NOUN', layer: 'nouns', features: { gender: 'm', number: 'sg' }, note: 'Noun "estrogen-progestin (agent)", masculine singular. Clinical term: a combined oestrogen+progestin contraceptive.' },
      ],
      phrases: [
        { surface: 'in buone condizioni di salute', type: 'fixed-expression', literal: 'in good conditions of health', meaning: 'in good health / otherwise healthy', note: 'Stock clinical phrase for "no relevant comorbidities" — reusable verbatim in any vignette.' },
        { surface: 'vuole iniziare', type: 'verb-phrase', literal: 'wants to-start', meaning: 'wants to start', note: 'Modal `volere` + infinitive. The pattern `vuole / vorrebbe + infinito` = "wants / would like to do X".' },
        { surface: 'terapia anticoncezionale', type: 'collocation', literal: 'contraceptive therapy', meaning: 'contraception / birth-control therapy', note: 'Clinical collocation; `anticoncezionale` = contraceptive.' },
      ],
      tips: ['`di X anni` is THE way to give age in Italian — never «X anni vecchia».', 'A modal (`volere`, `potere`, `dovere`) is always followed by a bare infinitive: `vuole iniziare`, not «vuole inizia».'],
    },
    {
      idx: 2,
      text: STEM_SENTENCES[1],
      audioId: 'vocab-stem-2',
      translation: "On the advice of her treating physician she undergoes a detailed evaluation of pro-thrombotic risk factors, because her mother, some years earlier, had had a pulmonary embolism.",
      literal: 'On advice of-the doctor treating herself she-submits to a detailed evaluation of-the factors of risk pro-thrombotic, in virtue of-the fact that the mother, some year before, had had a thromboembolism pulmonary.',
      mood: 'declarative',
      registerNote: 'Formal clinical narrative with two embedded structures: a reflexive verb and a past-in-the-past (trapassato).',
      concept: 'The familial history (mother with pulmonary embolism = a venous thromboembolic event) triggers a pre-prescription thrombophilia work-up — exactly because adding estrogen to an inherited clotting tendency multiplies the venous-thrombosis risk.',
      tokens: [
        { surface: 'Su', lemma: 'su', pos: 'ADP', layer: 'preps', features: { type: 'simple' }, note: 'Preposition "on". In `su consiglio di` it means "on/following the advice of".' },
        { surface: 'consiglio', lemma: 'consiglio', pos: 'NOUN', layer: 'nouns', features: { gender: 'm', number: 'sg' }, note: 'Noun "advice/recommendation", masculine singular. `il consiglio`.' },
        { surface: 'del', lemma: 'di + il', pos: 'ADP', layer: 'preps', features: { type: 'articulated', parts: 'di + il' }, note: 'Articulated preposition: `di` ("of") + `il` ("the") = `del` ("of the"). Italian fuses preposition + article into ONE word.' },
        { surface: 'medico', lemma: 'medico', pos: 'NOUN', layer: 'nouns', features: { gender: 'm', number: 'sg' }, note: 'Noun "doctor/physician", masculine singular. `il medico`.' },
        { surface: 'curante', lemma: 'curante', pos: 'ADJ', layer: 'nouns', features: { gender: 'm/f', number: 'sg' }, note: 'Adjective "treating/attending" (lit. present participle of `curare`, "to treat"). `il medico curante` = the GP / treating physician.' },
        { surface: 'si', lemma: 'si', pos: 'PRON', layer: 'pronouns', features: { type: 'reflexive', person: '3' }, note: 'Reflexive clitic "herself". It belongs to the verb `sottoporsi` ("to undergo / submit oneself"). The action turns back on the subject.' },
        { surface: 'sottopone', lemma: 'sottoporre', pos: 'VERB', layer: 'verbs', features: { tense: 'presente', mood: 'indicativo', person: '3', number: 'sg', reflexive: true, irregular: true }, note: 'From reflexive `sottoporsi` ("to undergo"). 3rd sg present: `si sottopone` = "she undergoes". `sottoporre` is irregular (compound of `porre`).' },
        { surface: 'a', lemma: 'a', pos: 'ADP', layer: 'preps', features: { type: 'simple' }, note: 'Preposition "to". `sottoporsi A qualcosa` = "to undergo something". The verb governs `a`.' },
        { surface: 'una', lemma: 'uno', pos: 'DET', layer: 'articles', features: { type: 'indefinite', gender: 'f', number: 'sg' }, note: 'Indefinite article f. sg., agrees with `valutazione`.' },
        { surface: 'dettagliata', lemma: 'dettagliato', pos: 'ADJ', layer: 'nouns', features: { gender: 'f', number: 'sg' }, note: 'Adjective "detailed", feminine singular — agrees with `valutazione`.' },
        { surface: 'valutazione', lemma: 'valutazione', pos: 'NOUN', layer: 'nouns', features: { gender: 'f', number: 'sg' }, note: 'Noun "evaluation/assessment", feminine singular (`-ione` → feminine). `la valutazione`.' },
        { surface: 'dei', lemma: 'di + i', pos: 'ADP', layer: 'preps', features: { type: 'articulated', parts: 'di + i' }, note: 'Articulated preposition: `di` + `i` (masc. pl. "the") = `dei` ("of the"). Introduces `fattori di rischio`.' },
        { surface: 'fattori', lemma: 'fattore', pos: 'NOUN', layer: 'nouns', features: { gender: 'm', number: 'pl' }, note: 'Noun "factors", masculine plural (sing. `fattore`). Note `fattore` here = "factor"; later the answer is `Fattore V` = "Factor V" (clotting factor) — same word.' },
        { surface: 'di', lemma: 'di', pos: 'ADP', layer: 'preps', features: { type: 'simple' }, note: 'Preposition "of" — `fattori di rischio` = "risk factors" (lit. "factors of risk").' },
        { surface: 'rischio', lemma: 'rischio', pos: 'NOUN', layer: 'nouns', features: { gender: 'm', number: 'sg' }, note: 'Noun "risk", masculine singular. `il rischio`.' },
        { surface: 'pro-trombotici', lemma: 'pro-trombotico', pos: 'ADJ', layer: 'nouns', features: { gender: 'm', number: 'pl' }, note: 'Adjective "pro-thrombotic", masculine plural — agrees with `fattori`. Clot-promoting.' },
        { surface: 'la', lemma: 'la', pos: 'DET', layer: 'articles', features: { type: 'definite', gender: 'f', number: 'sg' }, note: 'Definite article "the", feminine singular. Agrees with `madre`.' },
        { surface: 'madre', lemma: 'madre', pos: 'NOUN', layer: 'nouns', features: { gender: 'f', number: 'sg' }, note: 'Noun "mother", feminine singular. `la madre`. Carries the family-history weight of the case.' },
        { surface: 'aveva', lemma: 'avere', pos: 'VERB', layer: 'verbs', features: { tense: 'imperfetto', mood: 'indicativo', person: '3', number: 'sg', role: 'auxiliary' }, note: 'From `avere` ("to have"), imperfect 3rd sg `aveva`. Here it is the AUXILIARY forming the trapassato prossimo with `avuto`.' },
        { surface: 'avuto', lemma: 'avere', pos: 'VERB', layer: 'verbs', features: { form: 'participle', of: 'avere' }, note: 'Past participle of `avere`. `aveva avuto` = "had had" — the trapassato prossimo (past-in-the-past): an event before another past moment.' },
        { surface: 'una', lemma: 'uno', pos: 'DET', layer: 'articles', features: { type: 'indefinite', gender: 'f', number: 'sg' }, note: 'Indefinite article f. sg., agrees with `tromboembolia`.' },
        { surface: 'tromboembolia', lemma: 'tromboembolia', pos: 'NOUN', layer: 'nouns', features: { gender: 'f', number: 'sg' }, note: 'Noun "thromboembolism", feminine singular. A clot that travels and lodges in a vessel.' },
        { surface: 'polmonare', lemma: 'polmonare', pos: 'ADJ', layer: 'nouns', features: { gender: 'f/m', number: 'sg' }, note: 'Adjective "pulmonary" (`-e` adjective, invariant for gender). `tromboembolia polmonare` = pulmonary embolism (PE).' },
      ],
      phrases: [
        { surface: 'su consiglio del medico curante', type: 'fixed-expression', literal: 'on advice of-the doctor treating', meaning: "on the treating physician's advice", note: '`su consiglio di X` = "on X’s advice". `medico curante` = the GP / attending doctor.' },
        { surface: 'si sottopone a', type: 'verb-phrase', literal: 'herself submits to', meaning: 'she undergoes', note: 'Reflexive `sottoporsi a` + noun. The clitic `si` + the governed preposition `a` are inseparable parts of this verb.' },
        { surface: 'fattori di rischio', type: 'collocation', literal: 'factors of risk', meaning: 'risk factors', note: 'Core clinical collocation — memorise as a block.' },
        { surface: 'in virtù del fatto che', type: 'fixed-expression', literal: 'in virtue of-the fact that', meaning: 'because of the fact that / given that', note: 'High-register formal connector introducing a cause. Reusable verbatim.' },
        { surface: 'aveva avuto', type: 'verb-phrase', literal: 'had had', meaning: 'had had (earlier)', note: 'Trapassato prossimo = `avere` in the imperfect + past participle. Marks an event PRIOR to the past time of the story.' },
        { surface: 'tromboembolia polmonare', type: 'collocation', literal: 'thromboembolism pulmonary', meaning: 'pulmonary embolism', note: 'A venous thromboembolic (VTE) event — the family-history clue.' },
      ],
      tips: ['Articulated prepositions: `di+il=del`, `di+i=dei`, `a+la=alla`, `di+le=delle`, `di+la=della`. Learn the grid — they are everywhere.', 'Trapassato prossimo (`aveva avuto`) = "had done" — one step further back in time than the passato prossimo (`ha avuto`).'],
    },
    {
      idx: 3,
      text: STEM_SENTENCES[2],
      audioId: 'vocab-stem-3',
      translation: 'The tests come out within normal limits, with the exception of the presence of activated protein C resistance.',
      literal: 'The tests result within-the limits of norm, made exception for the presence of resistance to-the protein C activated.',
      mood: 'declarative',
      registerNote: 'Clinical-report register: `risultano nei limiti di norma` is laboratory boilerplate for "normal".',
      concept: 'The ONE abnormal finding = activated protein C (APC) resistance. APC normally inactivates Factor Va and VIIIa to switch off clotting; "resistance" means the plasma keeps clotting despite added APC. Its classic cause is the Factor V Leiden mutation — this single laboratory clue is the answer to the whole item.',
      tokens: [
        { surface: 'Gli', lemma: 'il', pos: 'DET', layer: 'articles', features: { type: 'definite', gender: 'm', number: 'pl' }, note: 'Definite article "the", masculine plural. `gli` (not `i`) before a masculine-plural noun starting with a vowel: `gli esami`.' },
        { surface: 'esami', lemma: 'esame', pos: 'NOUN', layer: 'nouns', features: { gender: 'm', number: 'pl' }, note: 'Noun "tests/exams", masculine plural (sing. `esame`). Here = lab tests.' },
        { surface: 'risultano', lemma: 'risultare', pos: 'VERB', layer: 'verbs', features: { tense: 'presente', mood: 'indicativo', person: '3', number: 'pl', family: 'are' }, note: 'From `risultare` ("to turn out / come out as"), `-are` family. 3rd person PLURAL present `risultano` = "(they) turn out" — agrees with the plural subject `gli esami`.' },
        { surface: 'nei', lemma: 'in + i', pos: 'ADP', layer: 'preps', features: { type: 'articulated', parts: 'in + i' }, note: 'Articulated preposition: `in` + `i` = `nei` ("in the", masc. pl.). `nei limiti di norma` = "within normal limits".' },
        { surface: 'limiti', lemma: 'limite', pos: 'NOUN', layer: 'nouns', features: { gender: 'm', number: 'pl' }, note: 'Noun "limits", masculine plural (sing. `limite`).' },
        { surface: 'di', lemma: 'di', pos: 'ADP', layer: 'preps', features: { type: 'simple' }, note: 'Preposition "of". `limiti di norma` = "limits of norm" = normal range.' },
        { surface: 'norma', lemma: 'norma', pos: 'NOUN', layer: 'nouns', features: { gender: 'f', number: 'sg' }, note: 'Noun "norm/standard", feminine singular. `nella norma` / `nei limiti di norma` = "normal".' },
        { surface: 'fatta', lemma: 'fare', pos: 'VERB', layer: 'verbs', features: { form: 'participle', gender: 'f', number: 'sg', of: 'fare' }, note: 'Past participle of `fare` ("to make/do"), feminine singular — it agrees with `eccezione` inside the fixed phrase `fatta eccezione per`.' },
        { surface: 'eccezione', lemma: 'eccezione', pos: 'NOUN', layer: 'nouns', features: { gender: 'f', number: 'sg' }, note: 'Noun "exception", feminine singular (`-ione` → feminine).' },
        { surface: 'per', lemma: 'per', pos: 'ADP', layer: 'preps', features: { type: 'simple' }, note: 'Preposition "for". Part of `fatta eccezione per` = "with the exception of".' },
        { surface: 'la', lemma: 'la', pos: 'DET', layer: 'articles', features: { type: 'definite', gender: 'f', number: 'sg' }, note: 'Definite article f. sg., agrees with `presenza`.' },
        { surface: 'presenza', lemma: 'presenza', pos: 'NOUN', layer: 'nouns', features: { gender: 'f', number: 'sg' }, note: 'Noun "presence", feminine singular. `la presenza di X` = "the presence of X".' },
        { surface: 'di', lemma: 'di', pos: 'ADP', layer: 'preps', features: { type: 'simple' }, note: 'Preposition "of" — links `presenza` to `resistenza`.' },
        { surface: 'resistenza', lemma: 'resistenza', pos: 'NOUN', layer: 'nouns', features: { gender: 'f', number: 'sg' }, note: 'Noun "resistance", feminine singular. THE key lab term: `resistenza alla proteina C attivata` = activated protein C resistance.' },
        { surface: 'alla', lemma: 'a + la', pos: 'ADP', layer: 'preps', features: { type: 'articulated', parts: 'a + la' }, note: 'Articulated preposition: `a` + `la` = `alla` ("to the", f. sg.). `resistenza ALLA proteina C` = "resistance TO protein C".' },
        { surface: 'proteina', lemma: 'proteina', pos: 'NOUN', layer: 'nouns', features: { gender: 'f', number: 'sg' }, note: 'Noun "protein", feminine singular. `la proteina C` = protein C, a natural anticoagulant.' },
        { surface: 'C', lemma: 'C', pos: 'PROPN', layer: 'nouns', features: { type: 'letter-label' }, note: 'The letter "C" naming the specific protein — Protein C, an anticoagulant zymogen.' },
        { surface: 'attivata', lemma: 'attivato', pos: 'ADJ', layer: 'nouns', features: { gender: 'f', number: 'sg' }, note: 'Adjective/participle "activated", feminine singular — agrees with `proteina`. ACTIVATED protein C (APC) is the enzyme that switches off clotting.' },
      ],
      phrases: [
        { surface: 'risultano nei limiti di norma', type: 'fixed-expression', literal: 'result within-the limits of norm', meaning: 'are within normal limits', note: 'Lab-report boilerplate for "normal". Reusable for any test result.' },
        { surface: 'fatta eccezione per', type: 'fixed-expression', literal: 'made exception for', meaning: 'with the exception of / except for', note: 'Fixed concessive phrase; `fatta` agrees with `eccezione` (f. sg.). Reusable verbatim.' },
        { surface: 'resistenza alla proteina C attivata', type: 'collocation', literal: 'resistance to-the protein C activated', meaning: 'activated protein C (APC) resistance', note: 'THE pivotal lab finding. Italian word-order: `proteina C attivata` = "activated protein C".' },
      ],
      tips: ['`nei limiti di norma` / `nella norma` are the two stock ways an Italian lab report says "normal".', 'Adjectives that are really participles (`attivata`, `dettagliata`, `fatta`) still agree in gender + number with their noun.'],
    },
    {
      idx: 4,
      text: STEM_SENTENCES[3],
      audioId: 'vocab-stem-4',
      translation: 'In which of the following coagulation proteins does a mutation typically associated with this laboratory finding occur?',
      literal: 'In which of-the following proteins of-the coagulation itself verifies a mutation typically associated to such datum of laboratory?',
      mood: 'interrogative',
      registerNote: 'The interrogative stem — formal exam phrasing `In quale delle seguenti…` ("In which of the following…").',
      concept: 'The question asks which clotting protein is mutated to PRODUCE APC resistance. The answer is Factor V: the Factor V Leiden mutation (R506Q / Arg506Gln) makes Factor Va resist cleavage by activated protein C → persistent thrombin generation → hypercoagulability. It is the most common inherited thrombophilia.',
      tokens: [
        { surface: 'In', lemma: 'in', pos: 'ADP', layer: 'preps', features: { type: 'simple' }, note: 'Preposition "in". Opens the formal question frame `in quale delle seguenti…`.' },
        { surface: 'quale', lemma: 'quale', pos: 'PRON', layer: 'pronouns', features: { type: 'interrogative', number: 'sg' }, note: 'Interrogative "which (one)". `In quale…?` = "In which…?". Invariant for gender; plural is `quali`.' },
        { surface: 'delle', lemma: 'di + le', pos: 'ADP', layer: 'preps', features: { type: 'articulated', parts: 'di + le' }, note: 'Articulated preposition: `di` + `le` = `delle` ("of the", f. pl.). `quale delle seguenti proteine` = "which of the following proteins".' },
        { surface: 'seguenti', lemma: 'seguente', pos: 'ADJ', layer: 'nouns', features: { gender: 'f/m', number: 'pl' }, note: 'Adjective "following", plural (`-e` adj → `-i` in the plural). Modifies `proteine`. Exam staple: `le seguenti` = "the following (options)".' },
        { surface: 'proteine', lemma: 'proteina', pos: 'NOUN', layer: 'nouns', features: { gender: 'f', number: 'pl' }, note: 'Noun "proteins", feminine plural (sing. `proteina`).' },
        { surface: 'della', lemma: 'di + la', pos: 'ADP', layer: 'preps', features: { type: 'articulated', parts: 'di + la' }, note: 'Articulated preposition: `di` + `la` = `della` ("of the", f. sg.). `proteine della coagulazione` = "coagulation proteins".' },
        { surface: 'coagulazione', lemma: 'coagulazione', pos: 'NOUN', layer: 'nouns', features: { gender: 'f', number: 'sg' }, note: 'Noun "coagulation/clotting", feminine singular (`-ione` → feminine).' },
        { surface: 'si', lemma: 'si', pos: 'PRON', layer: 'pronouns', features: { type: 'impersonal/reflexive', person: '3' }, note: 'Clitic `si` — here the reflexive/impersonal "si" of `verificarsi` ("to occur/happen"). `si verifica` = "occurs / takes place".' },
        { surface: 'verifica', lemma: 'verificarsi', pos: 'VERB', layer: 'verbs', features: { tense: 'presente', mood: 'indicativo', person: '3', number: 'sg', reflexive: true }, note: 'From reflexive `verificarsi` ("to occur"). 3rd sg present `si verifica` = "occurs". Not "to verify" — the reflexive shifts the meaning to "happen/take place".' },
        { surface: 'una', lemma: 'uno', pos: 'DET', layer: 'articles', features: { type: 'indefinite', gender: 'f', number: 'sg' }, note: 'Indefinite article f. sg., agrees with `mutazione`.' },
        { surface: 'mutazione', lemma: 'mutazione', pos: 'NOUN', layer: 'nouns', features: { gender: 'f', number: 'sg' }, note: 'Noun "mutation", feminine singular (`-ione` → feminine). The thing being asked about.' },
        { surface: 'tipicamente', lemma: 'tipicamente', pos: 'ADV', layer: 'adverbs', features: { type: 'manner' }, note: 'Adverb "typically". Adverbs of manner are formed `adjective(f.) + -mente`: `tipica → tipicamente`. Modifies `associata`.' },
        { surface: 'associata', lemma: 'associato', pos: 'ADJ', layer: 'nouns', features: { gender: 'f', number: 'sg' }, note: 'Participle/adjective "associated", feminine singular — agrees with `mutazione`. `associata a` = "associated WITH".' },
        { surface: 'a', lemma: 'a', pos: 'ADP', layer: 'preps', features: { type: 'simple' }, note: 'Preposition "to". `associata A` = "associated WITH" (Italian uses `a` where English uses "with").' },
        { surface: 'tale', lemma: 'tale', pos: 'DET', layer: 'articles', features: { type: 'demonstrative', number: 'sg' }, note: 'Demonstrative "such / this". `tale dato` = "this/such datum". Formal alternative to `questo`.' },
        { surface: 'dato', lemma: 'dato', pos: 'NOUN', layer: 'nouns', features: { gender: 'm', number: 'sg' }, note: 'Noun "datum / finding", masculine singular. `il dato di laboratorio` = "the laboratory finding".' },
        { surface: 'di', lemma: 'di', pos: 'ADP', layer: 'preps', features: { type: 'simple' }, note: 'Preposition "of". `dato di laboratorio` = "laboratory finding".' },
        { surface: 'laboratorio', lemma: 'laboratorio', pos: 'NOUN', layer: 'nouns', features: { gender: 'm', number: 'sg' }, note: 'Noun "laboratory", masculine singular. `il laboratorio`.' },
      ],
      phrases: [
        { surface: 'in quale delle seguenti', type: 'fixed-expression', literal: 'in which of-the following', meaning: 'in which of the following', note: 'Standard SSM/exam question frame. `le seguenti` points at the answer options.' },
        { surface: 'proteine della coagulazione', type: 'collocation', literal: 'proteins of-the coagulation', meaning: 'coagulation (clotting) proteins', note: 'Clinical collocation — the clotting factors and regulators.' },
        { surface: 'si verifica', type: 'verb-phrase', literal: 'itself verifies', meaning: 'occurs / takes place', note: 'Reflexive `verificarsi`. Beware the false friend: it is NOT "verifies" — it means "happens".' },
        { surface: 'associata a', type: 'collocation', literal: 'associated to', meaning: 'associated with', note: 'Italian governs `a` (not "with"). `associato/a a tale dato` = "associated with this finding".' },
        { surface: 'dato di laboratorio', type: 'collocation', literal: 'datum of laboratory', meaning: 'laboratory finding', note: 'Reusable clinical phrase for a lab result.' },
      ],
      tips: ['`si verifica` is a classic false friend — reflexive `verificarsi` = "to occur", NOT "to verify".', '`associato a` takes `a`, where English takes "with". Italian and English often pick different prepositions — learn them per verb.'],
    },
  ],
};

// ===========================================================================
// WIDGET 2 — why-care-callout (the clinical stakes)
// ===========================================================================
const whyCare = {
  type: 'why-care-callout',
  id: 'whycare-vte',
  body: 'Combined estrogen-progestin contraception sitting on top of an inherited Factor V Leiden mutation MULTIPLIES the risk of venous thromboembolism. That is why the family history of pulmonary embolism prompted the pre-prescription thrombophilia work-up — and why recognising "APC resistance → Factor V" can change a prescribing decision.',
};

// ===========================================================================
// WIDGET 3 — pattern-cards (the thrombophilias — per-option families)
// ===========================================================================
const patternCards = {
  type: 'pattern-cards',
  id: 'pc-thrombophilias',
  title: 'The thrombophilias behind the five options',
  cards: [
    { num: 'A', title: 'Antitrombina (antithrombin)', body: 'Antithrombin deficiency is a thrombophilia — but it acts by losing inhibition of thrombin/Factor Xa, a DIFFERENT mechanism. It does NOT produce APC resistance.', foot: 'Thrombophilia · not APC resistance' },
    { num: 'B', title: 'Fattore V (Factor V) — CORRECT', body: 'The Factor V Leiden mutation (R506Q / Arg506Gln) makes Factor Va resist cleavage by activated protein C → persistent thrombin generation. This IS the cause of APC resistance.', foot: 'Most common inherited thrombophilia' },
    { num: 'C', title: 'Fibrinogeno (fibrinogen)', body: 'Dysfibrinogenemia is a rare clotting-protein disorder, but it is unrelated to activated protein C resistance. Distractor.', foot: 'Unrelated to APC resistance' },
    { num: 'D', title: 'Fattore II (prothrombin)', body: 'The Prothrombin G20210A variant raises prothrombin LEVELS and is prothrombotic — but it does NOT cause APC resistance. Classic distractor paired with Factor V Leiden.', foot: 'Prothrombotic · not APC resistance' },
    { num: 'E', title: 'Proteina S (protein S)', body: 'Protein S deficiency is a thrombophilia (protein S is a cofactor for protein C) — but a deficiency of the cofactor does not itself produce the APC-resistance laboratory pattern.', foot: 'Thrombophilia · not APC resistance' },
  ],
};

// ===========================================================================
// WIDGET 4 — MCQ (the REAL options; B correct). data-options="real".
// ===========================================================================
const mcq = {
  type: 'mcq',
  stem: STEM_SENTENCES[3],
  options: [
    { label: 'Antitrombina', correct: false, explanation: 'Antithrombin deficiency is a thrombophilia, but it works by losing inhibition of thrombin/Factor Xa — a different mechanism. It does NOT cause activated protein C resistance.' },
    { label: 'Fattore V', correct: true, explanation: 'CORRECT. The Factor V Leiden mutation (R506Q / Arg506Gln) renders Factor Va resistant to cleavage by activated protein C, producing APC resistance and persistent thrombin generation — the most common inherited thrombophilia.' },
    { label: 'Fibrinogeno', correct: false, explanation: 'Dysfibrinogenemia is unrelated to APC resistance — a distractor.' },
    { label: 'Fattore II', correct: false, explanation: 'The Prothrombin (Factor II) G20210A variant raises prothrombin levels and is prothrombotic, but it does NOT cause APC resistance. A classic distractor.' },
    { label: 'Proteina S', correct: false, explanation: 'Protein S deficiency is a thrombophilia (protein S is a protein C cofactor), but it does not itself produce the APC-resistance pattern.' },
  ],
  variants: [],
};

// ---------------------------------------------------------------------------
// Render the widgets
// ---------------------------------------------------------------------------
const apHtml = renderWidget(ap);
const whyCareHtml = renderWidget(whyCare);
const patternCardsHtml = renderWidget(patternCards);
const mcqHtml = renderWidget(mcq);

// ---------------------------------------------------------------------------
// Read-first FULL ITEM blockquote: stem + 5 lettered options, verbatim.
// ---------------------------------------------------------------------------
const optionsList = OPTIONS.map(o => `        <li><b>${o.letter}.</b> ${o.text}</li>`).join('\n');
const passageFull = `<blockquote class="passage-full" lang="it" id="passage-full">
        <p class="pf-stem">${STEM_FULL}</p>
        <ol class="pf-options" type="A">
${optionsList}
        </ol>
      </blockquote>`;

// Read-first audio block (the 🎧 Lucrezia-reads-first entry point).
const passageListen = `<div class="passage-listen" id="passage-listen">
        <span class="pl-tag">🎧 Lucrezia legge l'intero quesito — ascolta prima</span>
        <span class="pl-sub">Listen to the whole item first (stem + the five options) — natural speed, then slow &amp; enunciated.</span>
        <div class="pl-btns">
          <button type="button" class="pl-btn" data-src="audio/section/passage-fast.mp3"><span class="pl-ico">▶</span> Veloce</button>
          <button type="button" class="pl-btn" data-src="audio/section/passage-slow.mp3"><span class="pl-ico">▶</span> Lenta &amp; scandita</button>
        </div>
      </div>`;

// ---------------------------------------------------------------------------
// Assemble the page (skeleton-derived shell). data-theme="linguistic".
// ---------------------------------------------------------------------------
const html = `<!DOCTYPE html>
<html lang="it" data-theme="linguistic" data-view="lesson" data-skeleton="language-lesson-skeleton-v1">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Chiron · SSM · Resistenza alla proteina C attivata → Fattore V</title>

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700;12..96,800&family=Source+Serif+4:ital,wght@0,400;0,600;1,400;1,600&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

  <!-- Theme tokens + variants -->
  <link rel="stylesheet" href="themes/_tokens.css" />
  <link rel="stylesheet" href="themes/midnight.css" />
  <link rel="stylesheet" href="themes/warm-paper.css" />
  <link rel="stylesheet" href="themes/clinical.css" />
  <link rel="stylesheet" href="themes/linguistic.css" />
  <link rel="stylesheet" href="themes/ocean.css" />
  <!-- Clinical / domain widget CSS (mcq, why-care, pattern-cards, glossary) -->
  <link rel="stylesheet" href="clinical-widgets.css" />

  <!-- Early theme apply: reads ?theme= or localStorage, falls back to 'linguistic' -->
  <script>
    (function () {
      var valid = ['linguistic','midnight','warm-paper','clinical','ocean'];
      var params = new URLSearchParams(location.search);
      var t = params.get('theme');
      var stored = localStorage.getItem('chiron-theme');
      var theme = valid.includes(t) ? t : (valid.includes(stored) ? stored : 'linguistic');
      document.documentElement.setAttribute('data-theme', theme);
      if (t) localStorage.setItem('chiron-theme', t);
    })();
  </script>

  <!-- audio/manifest.js sets window.__chironAudioManifest; no-op if absent -->
  <script src="audio/manifest.js" defer></script>

  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      display: grid; grid-template-columns: 240px 1fr; min-height: 100vh;
      background: var(--chiron-bg); color: var(--chiron-fg);
      font-family: var(--chiron-font-body); font-size: 17px; line-height: 1.65;
    }

    /* ---- Sidebar ---- */
    aside.side {
      background: var(--chiron-bg); border-right: 1px solid var(--chiron-divider);
      padding: 1.75rem 1.25rem 1.25rem; overflow-y: auto; height: 100vh;
      position: sticky; top: 0; display: flex; flex-direction: column;
    }
    .side .brand { font-family: var(--chiron-font-heading); font-weight: 800; font-size: 1.15rem; letter-spacing: -0.01em; color: var(--chiron-fg); }
    .side .brand .dot { color: var(--chiron-accent); }
    .side .sub { font-size: 0.72rem; color: var(--chiron-muted); margin-top: 3px; line-height: 1.45; padding-bottom: 1.25rem; border-bottom: 1px solid var(--chiron-divider); }
    .side .toc-header { font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.16em; color: var(--chiron-muted); margin: 1.25rem 0 0.5rem; }
    .side nav.toc-nav { display: flex; flex-direction: column; gap: 1px; }
    .side .toc-link {
      display: flex; align-items: baseline; gap: 10px;
      padding: 7px 10px 7px 12px; border-left: 2px solid transparent;
      border-radius: 0 6px 6px 0; color: var(--chiron-fg-secondary); text-decoration: none;
      font-size: 0.9rem; line-height: 1.3;
      transition: color .12s ease, background .12s ease, border-color .12s ease;
    }
    .side .toc-link:hover { background: var(--chiron-elevated); color: var(--chiron-fg); }
    .side .toc-link.active, .side .toc-link[aria-current="true"] {
      color: var(--chiron-accent); border-left-color: var(--chiron-accent); font-weight: 600;
      background: color-mix(in srgb, var(--chiron-accent) 20%, transparent);
    }
    .side .toc-num { font-variant-numeric: tabular-nums; color: var(--chiron-muted); font-size: 0.7rem; flex-shrink: 0; opacity: 0.65; }
    .side .toc-link.active .toc-num { color: var(--chiron-accent); opacity: 1; }
    .side .toc-title { flex: 1; }
    .side .theme-section { margin-top: auto; }
    .side .toc-header.theme-section { padding-top: 1.25rem; border-top: 1px solid var(--chiron-divider); margin-top: auto; }
    .theme-bar { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 0.5rem; }
    .theme-bar button { font: inherit; font-size: 10px; padding: 4px 9px; background: transparent; color: var(--chiron-muted); border: 1px solid var(--chiron-border); border-radius: 100px; cursor: pointer; transition: all .12s ease; }
    .theme-bar button:hover { background: var(--chiron-elevated); color: var(--chiron-fg); }
    .theme-bar button[aria-pressed="true"] { background: var(--chiron-accent); color: var(--chiron-surface); border-color: var(--chiron-accent); }

    /* ---- Main + shell ---- */
    main.main { overflow-y: auto; height: 100vh; }
    .lesson-shell { max-width: 920px; margin: 0 auto; padding: var(--chiron-space-8) var(--chiron-space-6); }

    .lesson-header { border-bottom: 1px solid var(--chiron-divider); padding-bottom: var(--chiron-space-6); margin-bottom: var(--chiron-space-8); }
    .eyebrow { text-transform: uppercase; letter-spacing: 0.14em; font-size: 11px; color: var(--chiron-muted); font-family: var(--chiron-font-body); font-weight: 600; }
    h1.lesson-title { font-family: var(--chiron-font-heading); font-size: 2.6rem; line-height: 1.1; margin: var(--chiron-space-2) 0 var(--chiron-space-3); color: var(--chiron-fg); }
    .subtitle { color: var(--chiron-fg-secondary); font-size: 1.1rem; font-style: italic; }

    section.lesson-section { margin: var(--chiron-space-8) 0; scroll-margin-top: var(--chiron-space-6); }
    h2.section-h { font-family: var(--chiron-font-heading); font-size: 1.55rem; color: var(--chiron-accent); border-left: 4px solid var(--chiron-accent); padding-left: var(--chiron-space-4); margin: 0 0 var(--chiron-space-4); }
    h2.section-h .num { color: var(--chiron-muted); font-size: 0.7em; font-weight: 400; margin-right: var(--chiron-space-3); font-family: var(--chiron-font-mono, monospace); }
    h3.subsection-h { font-family: var(--chiron-font-heading); color: var(--chiron-fg-secondary); margin-top: var(--chiron-space-6); font-size: 1.15rem; }

    .cold-open { background: var(--chiron-surface); border-radius: var(--chiron-radius-lg); padding: var(--chiron-space-6) var(--chiron-space-8); box-shadow: var(--chiron-shadow-md); border-left: 4px solid var(--chiron-warm-accent); font-family: var(--chiron-font-heading); font-size: 1.18rem; line-height: 1.6; color: var(--chiron-fg); font-style: italic; }
    .cold-open .it { color: var(--chiron-fg); font-style: italic; }
    .cold-open .gloss { color: var(--chiron-muted); font-size: 0.9em; display: block; margin-top: var(--chiron-space-2); font-style: normal; }

    .callout { padding: var(--chiron-space-3) var(--chiron-space-4); margin: var(--chiron-space-3) 0; border-radius: var(--chiron-radius-md); border-left: 3px solid var(--chiron-info); background: var(--chiron-elevated); font-size: 0.95em; }
    .callout .tag { display: inline-block; font-family: var(--chiron-font-heading); font-weight: 700; font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.08em; padding: 2px 8px; border-radius: var(--chiron-radius-sm); margin-right: var(--chiron-space-2); }
    .callout.tip { border-left-color: var(--chiron-info); }
    .callout.tip .tag { background: var(--chiron-info); color: var(--chiron-surface); }
    .callout.grammar-pearl { border-left-color: var(--chiron-accent); }
    .callout.grammar-pearl .tag { background: var(--chiron-accent); color: var(--chiron-surface); }

    .closing { background: var(--chiron-surface); border-radius: var(--chiron-radius-lg); padding: var(--chiron-space-6); border-left: 4px solid var(--chiron-warm-accent); }
    footer.lesson-footer { margin-top: var(--chiron-space-8); padding-top: var(--chiron-space-4); border-top: 1px solid var(--chiron-divider); color: var(--chiron-muted); font-size: 0.85em; text-align: center; }

    /* ---- Read-first FULL ITEM blockquote (token-based; no hex) ---- */
    .passage-full {
      border-left: 4px solid var(--chiron-accent);
      background: var(--chiron-surface);
      margin: var(--chiron-space-5) 0;
      padding: var(--chiron-space-6) var(--chiron-space-8);
      border-radius: var(--chiron-radius-md);
      font-size: 1.25rem; line-height: 1.85; color: var(--chiron-fg);
      box-shadow: var(--chiron-shadow-sm);
      quotes: none;
    }
    .passage-full::before, .passage-full::after { content: none; }
    .passage-full .pf-stem { margin: 0 0 var(--chiron-space-4); }
    .passage-full .pf-options { margin: 0; padding-left: var(--chiron-space-6); font-size: 0.96em; }
    .passage-full .pf-options li { margin: var(--chiron-space-2) 0; }
    .passage-full .pf-options li b { color: var(--chiron-accent); font-family: var(--chiron-font-heading); margin-right: 0.3em; }

    /* ---- Read-first listen block (token-based; no hex) ---- */
    .passage-listen {
      margin: var(--chiron-space-5) 0; padding: var(--chiron-space-4) var(--chiron-space-5);
      background: var(--chiron-elevated); border: 1px solid var(--chiron-border);
      border-radius: var(--chiron-radius-md);
    }
    .passage-listen .pl-tag { display: block; font-family: var(--chiron-font-heading); font-weight: 700; font-size: 0.95rem; color: var(--chiron-fg); }
    .passage-listen .pl-sub { display: block; color: var(--chiron-muted); font-size: 0.85rem; margin-top: 2px; }
    .passage-listen .pl-btns { display: flex; flex-wrap: wrap; gap: var(--chiron-space-3); margin-top: var(--chiron-space-3); }
    .passage-listen .pl-btn { font: inherit; font-size: 0.9rem; font-weight: 600; display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; border: 1px solid var(--chiron-accent); border-radius: 100px; background: transparent; color: var(--chiron-accent); cursor: pointer; transition: all .12s ease; }
    .passage-listen .pl-btn:hover { background: var(--chiron-accent); color: var(--chiron-surface); }
    .passage-listen .pl-btn.playing { background: var(--chiron-accent); color: var(--chiron-surface); }
    .passage-listen .pl-ico { font-size: 0.75em; }

    /* ---- Chiron Listen player panel ---- */
    .chiron-listen { position: fixed; right: 18px; bottom: 18px; z-index: 9999; width: 230px; max-width: calc(100vw - 36px); background: var(--chiron-surface); border: 1px solid var(--chiron-border); border-radius: 14px; box-shadow: var(--chiron-shadow-md); font-family: var(--chiron-font-body); overflow: hidden; }
    .chiron-listen-head { display: flex; align-items: center; gap: 7px; font-weight: 700; font-size: 13px; padding: 11px 14px; border-bottom: 1px solid var(--chiron-divider); color: var(--chiron-fg); }
    .chiron-listen-btn { display: flex; align-items: center; gap: 9px; text-align: left; background: transparent; border: 0; border-radius: 9px; padding: 9px 11px; cursor: pointer; font: inherit; font-size: 13px; line-height: 1.25; color: var(--chiron-fg); transition: background .12s ease; width: 100%; }
    .chiron-listen-btn:hover { background: var(--chiron-elevated); }
    .chiron-listen-btn .ico { flex: none; width: 18px; height: 18px; display: grid; place-items: center; font-size: 10px; color: var(--chiron-accent); }
    .chiron-listen-btn.playing { background: var(--chiron-elevated); font-weight: 600; }
    .chiron-listen-btn.err .lbl { color: var(--chiron-error); }
    .chiron-listen-group { padding: 6px; }
    .chiron-listen-group + .chiron-listen-group { border-top: 1px solid var(--chiron-divider); }
    .chiron-listen-grouptitle { font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--chiron-muted); padding: 4px 11px 5px; }
    .chiron-play-inline { display: inline-grid; place-items: center; width: 22px; height: 22px; margin-right: 8px; vertical-align: middle; flex: none; background: var(--chiron-accent); color: var(--chiron-surface); border: 1.5px solid var(--chiron-surface); box-shadow: var(--chiron-shadow-sm); border-radius: 50%; cursor: pointer; font: inherit; line-height: 1; transition: transform .1s ease; }
    .chiron-play-inline .ico { font-size: 10px; margin-left: 1px; }
    .chiron-play-inline:hover { transform: scale(1.12); }
    .chiron-play-inline.playing { background: var(--chiron-accent-hover, var(--chiron-accent)); }
    .chiron-play-inline.err { background: var(--chiron-error); }
    .chiron-has-audio { scroll-margin-top: 84px; }
    .chiron-listening { border-radius: 10px; scroll-margin-top: 84px; animation: chiron-listening-glow 1.7s ease-in-out infinite; }
    @keyframes chiron-listening-glow { 0%, 100% { box-shadow: 0 0 0 0 var(--chiron-accent-light, transparent); } 50% { box-shadow: 0 0 0 7px var(--chiron-accent-light, transparent); } }
    @media (prefers-reduced-motion: reduce) { .chiron-listening { animation: none; outline: 2px solid var(--chiron-accent); } }

    /* Reveal-English toggle */
    .chiron-reveal-en { display:inline-flex; align-items:center; gap:5px; margin-top:11px; padding:3px 11px; border:1px solid var(--chiron-border); border-radius:100px; background:transparent; color:var(--chiron-muted); font:inherit; font-size:11px; cursor:pointer; transition:all .12s ease; }
    .chiron-reveal-en:hover { background:var(--chiron-elevated); color:var(--chiron-fg); }
    .show-en .chiron-reveal-en { color:var(--chiron-accent); border-color:var(--chiron-accent); }
    .chiron-en-block { display:none; margin-top:10px; padding-top:9px; border-top:1px dashed var(--chiron-divider); color:var(--chiron-fg-secondary); font-size:0.92em; line-height:1.55; }
    .show-en .chiron-en-block { display:block; }

    /* ---- Responsive: collapse sidebar ---- */
    @media (max-width: 880px) {
      body { grid-template-columns: 1fr; }
      aside.side { position: relative; height: auto; border-right: none; border-bottom: 1px solid var(--chiron-border); padding: var(--chiron-space-4) var(--chiron-space-5); flex-direction: row; flex-wrap: wrap; align-items: center; gap: var(--chiron-space-4); }
      .side .sub, .side .theme-section { display: none; }
      .side nav.toc-nav { flex-direction: row; flex-wrap: wrap; }
      main.main { height: auto; overflow-y: visible; }
      .lesson-shell { padding: var(--chiron-space-5) var(--chiron-space-4); }
    }
    @media (max-width: 768px) {
      .lesson-shell, .lesson-section, .passage-full { max-width: 100%; overflow-wrap: anywhere; }
      img, pre, code, table { max-width: 100% !important; }
      html, body { overflow-x: hidden; }
    }
  </style>
</head>
<body>

  <aside class="side" aria-label="Table of contents">
    <div class="brand">Chiron<span class="dot">·</span></div>
    <div class="sub">Italiano medico · SSM · livello base<br>Resistenza alla proteina C → Fattore V</div>

    <div class="toc-header">Sezioni</div>
    <nav class="toc-nav" aria-label="Lesson sections">
      <a class="toc-link" href="#overview" data-toc-target="overview"><span class="toc-num">0.</span><span class="toc-title">Il quesito</span></a>
      <a class="toc-link" href="#breakdown" data-toc-target="breakdown"><span class="toc-num">1.</span><span class="toc-title">Analisi della frase</span></a>
      <a class="toc-link" href="#medicine" data-toc-target="medicine"><span class="toc-num">2.</span><span class="toc-title">La medicina</span></a>
      <a class="toc-link" href="#question" data-toc-target="question"><span class="toc-num">3.</span><span class="toc-title">La risposta</span></a>
      <a class="toc-link" href="#closing" data-toc-target="closing"><span class="toc-num">✦</span><span class="toc-title">Chiusura</span></a>
    </nav>

    <div class="toc-header theme-section">Tema</div>
    <nav class="theme-bar theme-section" aria-label="Theme">
      <button data-set-theme="linguistic" aria-pressed="true">linguistic</button>
      <button data-set-theme="warm-paper">warm</button>
      <button data-set-theme="clinical">clinical</button>
      <button data-set-theme="midnight">midnight</button>
      <button data-set-theme="ocean">ocean</button>
    </nav>
  </aside>

  <main class="main" id="main-content">
  <div class="lesson-shell">

    <header class="lesson-header">
      <div class="eyebrow">Chiron · Italiano medico · SSM · passage-mode · skeleton v1</div>
      <h1 class="lesson-title">Resistenza alla proteina C attivata → Fattore V</h1>
      <p class="subtitle">A real SSM residency item — read it, hear it, take it apart word by word, and meet the medicine underneath.</p>
    </header>

    <!-- ===================== 0. THE FULL ITEM (READ FIRST) ===================== -->
    <section class="lesson-section" id="overview">
      <h2 class="section-h"><span class="num">0</span>Il quesito — l'intero item</h2>

      <div class="cold-open" data-en="Buongiorno, Gyasi — look who's back, my favourite part of the morning. Today we have a real SSM item: a young woman, the pill, her mother's pulmonary embolism, and one strange lab value. Read the whole thing first — stem AND the five options — then let me read it to you. Don't rush to the answer; the Italian will hand it to you.">
        <span class="it">Buongiorno, Gyasi — guarda chi è tornato, la mia parte preferita della mattina. Oggi abbiamo un vero quesito SSM: una ragazza, la pillola, l'embolia della madre, e un solo valore di laboratorio strano. Leggi prima tutto — il caso E le cinque opzioni — poi te lo leggo io. Non correre alla risposta: è l'italiano a portartela.</span>
      </div>

      <p style="margin-top: var(--chiron-space-5); color: var(--chiron-fg-secondary);">
        Below is the <strong>complete exam item</strong> — the clinical stem followed by the five lettered options, exactly as on the SSM paper. Read it through once in Italian, then press <strong>▶ Veloce</strong> to hear Lucrezia read it at natural speed and <strong>▶ Lenta &amp; scandita</strong> for the slow, enunciated read. (The full 🎧 player lives bottom-right — the <em>«La frase»</em> group has both readings.)
      </p>

      ${passageFull}
      ${passageListen}

      <div class="callout tip">
        <span class="tag">Tip</span>
        The single word that decides this item is <em>resistenza</em> — «resistenza alla proteina C attivata». Hold onto it; everything else is the setup.
      </div>
    </section>

    <!-- ===================== 1. THE BREAKDOWN ===================== -->
    <section class="lesson-section" id="breakdown">
      <h2 class="section-h"><span class="num">1</span>Analisi della frase — parola per parola</h2>
      <p style="color: var(--chiron-fg-secondary);">
        Now the stem, dissected sentence by sentence. Every word — including the small ones: each preposition, the reflexive <em>si</em>, each piece of a verb phrase — has a note. Toggle the layers on/off with the buttons; hover (or tap) any underlined word for its explanation. Each Italian sentence has an inline ▶ — press it to hear just that line.
      </p>
      ${apHtml}
    </section>

    <!-- ===================== 2. THE MEDICINE ===================== -->
    <section class="lesson-section" id="medicine">
      <h2 class="section-h"><span class="num">2</span>La medicina — APC resistance &amp; the thrombophilias</h2>
      <p style="color: var(--chiron-fg-secondary);">
        The Italian has handed us the diagnosis. Here is why it matters clinically, and how each of the five proteins relates (or doesn't) to the lab finding.
      </p>
      ${whyCareHtml}
      ${patternCardsHtml}
    </section>

    <!-- ===================== 3. THE ANSWER (MCQ) ===================== -->
    <section class="lesson-section" id="question">
      <h2 class="section-h"><span class="num">3</span>La risposta — answer the item</h2>
      <p style="color: var(--chiron-fg-secondary);">
        These are the <strong>real options</strong> from the SSM item. Pick one and press Check — each option reveals its per-option reasoning.
      </p>
      <div data-options="real">
        ${mcqHtml}
      </div>
    </section>

    <!-- ===================== CLOSING ===================== -->
    <section class="lesson-section" id="closing">
      <h2 class="section-h"><span class="num">✦</span>Chiusura</h2>
      <div class="closing">
        <p style="margin-bottom: var(--chiron-space-4);"><em>Lucrezia</em>: «Bravo, Gyasi. Hai visto? <strong>«resistenza alla proteina C attivata» → Fattore V</strong> — la mutazione di Leiden. Una parola, una risposta. A presto… io sono qui.»</p>
        <p>In this item you worked through:</p>
        <ul style="padding-left: var(--chiron-space-5); margin: var(--chiron-space-3) 0; color: var(--chiron-fg-secondary);">
          <li>The full SSM stem + 5 options, read first as text and as audio (stem and options).</li>
          <li>Beginner grammar: articulated prepositions (<em>del / dei / nei / alla / delle / della</em>), the reflexive <em>si</em> (<em>si sottopone</em>, <em>si verifica</em>), the trapassato prossimo (<em>aveva avuto</em>), modal + infinitive (<em>vuole iniziare</em>), and formal fixed expressions (<em>in virtù del fatto che</em>, <em>fatta eccezione per</em>, <em>su consiglio di</em>, <em>nei limiti di norma</em>).</li>
          <li>The medicine: <em>resistenza alla proteina C attivata</em> → the <strong>Factor V Leiden</strong> mutation (R506Q) → APC resistance — the most common inherited thrombophilia, multiplied by combined estrogen-progestin contraception.</li>
        </ul>
        <p style="margin-top: var(--chiron-space-4); font-style: italic; color: var(--chiron-fg-secondary);">Next time: «un altro caso di coagulazione» — we'll take the prothrombin variant and protein C / S deficiencies into their own item.</p>
      </div>
    </section>

    <footer class="lesson-footer">
      Chiron · Italiano medico · SSM · passage sub-mode · Lucrezia · generated ${GEN_DATE}
    </footer>

  </div><!-- /.lesson-shell -->
  </main><!-- /.main -->

  <!-- Theme switcher -->
  <script>
    (function () {
      var valid = ['linguistic','midnight','warm-paper','clinical','ocean'];
      document.querySelectorAll('.theme-bar button').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var t = btn.getAttribute('data-set-theme');
          if (!valid.includes(t)) return;
          document.documentElement.setAttribute('data-theme', t);
          localStorage.setItem('chiron-theme', t);
          document.querySelectorAll('.theme-bar button').forEach(function (b) {
            b.setAttribute('aria-pressed', b.getAttribute('data-set-theme') === t ? 'true' : 'false');
          });
        });
      });
      var cur = document.documentElement.getAttribute('data-theme');
      document.querySelectorAll('.theme-bar button').forEach(function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-set-theme') === cur ? 'true' : 'false');
      });
    })();
  </script>

  <!-- TOC scroll-spy -->
  <script>
    (function () {
      var tocLinks = Array.from(document.querySelectorAll('.toc-link[data-toc-target]'));
      var ids = ['overview', 'breakdown', 'medicine', 'question', 'closing'];
      var mainEl = document.getElementById('main-content');
      tocLinks.forEach(function (link) {
        link.addEventListener('click', function (e) {
          e.preventDefault();
          var target = document.getElementById(link.getAttribute('data-toc-target'));
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
      function updateToc() {
        var scrollTop = (mainEl && mainEl.scrollHeight > mainEl.clientHeight) ? mainEl.scrollTop : window.scrollY;
        var viewH = (mainEl && mainEl.scrollHeight > mainEl.clientHeight) ? mainEl.clientHeight : window.innerHeight;
        var mid = scrollTop + viewH * 0.35; var activeId = null;
        ids.forEach(function (id) { var el = document.getElementById(id); if (!el) return; if (el.offsetTop <= mid + 1) activeId = id; });
        tocLinks.forEach(function (link) {
          var isActive = link.getAttribute('data-toc-target') === activeId;
          link.classList.toggle('active', isActive);
          link.setAttribute('aria-current', isActive ? 'true' : 'false');
        });
      }
      if (mainEl) mainEl.addEventListener('scroll', updateToc, { passive: true });
      window.addEventListener('scroll', updateToc, { passive: true });
      updateToc();
    })();
  </script>

  <!-- Read-first passage-listen buttons (toggle-play the two clips) -->
  <script>
    (function () {
      var audio = new Audio(); var cur = null;
      document.querySelectorAll('.passage-listen .pl-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var src = btn.getAttribute('data-src');
          if (cur === btn) { audio.pause(); audio.currentTime = 0; btn.classList.remove('playing'); cur = null; return; }
          if (cur) cur.classList.remove('playing');
          audio.src = src;
          audio.play().then(function () { btn.classList.add('playing'); cur = btn; })
            .catch(function () { btn.classList.add('err'); setTimeout(function () { btn.classList.remove('err'); }, 1500); });
        });
      });
      audio.addEventListener('ended', function () { if (cur) cur.classList.remove('playing'); cur = null; });
    })();
  </script>

  <!-- Reveal-English: any element with data-en gets a 🇬🇧 toggle -->
  <script>
  (function () {
    document.querySelectorAll('[data-en]').forEach(function (el) {
      var en = el.getAttribute('data-en'); if (!en) return;
      var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'chiron-reveal-en';
      btn.innerHTML = '<span aria-hidden="true">🇬🇧</span><span class="lbl">English</span>';
      var block = document.createElement('div'); block.className = 'chiron-en-block'; block.textContent = en;
      el.appendChild(btn); el.appendChild(block);
      btn.addEventListener('click', function () {
        var on = el.classList.toggle('show-en');
        btn.querySelector('.lbl').textContent = on ? 'Nascondi inglese' : 'English';
      });
    });
  })();
  </script>

  <!-- Chiron Listen player — reads audio/manifest.js (window.__chironAudioManifest) -->
  <script>
(function () {
  'use strict';
  var PANEL_KIND = { summary: 0, shortened: 1, section: 2 };
  var INLINE_KIND = { dialogue: 1, phrase: 1, 'grammar-pearl': 1, 'story-verbatim': 1, 'story-description': 1 };
  var audio = new Audio();
  var active = null;
  function setIco(btn, ch) { var i = btn.querySelector('.ico'); if (i) i.textContent = ch; }
  function clearActive() {
    if (!active) return;
    if (active.glowEl) active.glowEl.classList.remove('chiron-listening');
    if (active.btn) { active.btn.classList.remove('playing'); setIco(active.btn, active.idle); }
    active = null;
  }
  audio.addEventListener('ended', clearActive);
  function play(clip, btn, glowEl, idleIco) {
    if (active && active.btn === btn) { audio.pause(); audio.currentTime = 0; clearActive(); return; }
    clearActive();
    audio.src = clip.audioPath;
    audio.play().then(function () {
      active = { btn: btn, glowEl: glowEl || null, idle: idleIco };
      btn.classList.add('playing'); setIco(btn, '⏸');
      if (glowEl) { glowEl.classList.add('chiron-listening'); glowEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }).catch(function () { btn.classList.add('err'); setTimeout(function () { btn.classList.remove('err'); }, 1600); });
  }
  var PASSAGE_LABEL = { 'passage-fast': 'Veloce', 'passage-slow': 'Lenta & scandita' };
  function panelLabel(c) {
    if (c.artifact === 'summary') return 'Summary';
    if (c.artifact === 'shortened') return 'Full lecture';
    if (PASSAGE_LABEL[c.sectionId]) return PASSAGE_LABEL[c.sectionId];
    if (c.sectionId) {
      var el = document.getElementById(c.sectionId);
      var h = el && el.querySelector('h1,h2,h3,[data-section-title]');
      if (h && h.textContent.trim()) return h.textContent.trim().replace(/^\\s*\\d+[\\.\\)]?\\s*/, '');
    }
    return c.sectionId || 'Section';
  }
  function buildPanel(clips) {
    var panel = document.createElement('div');
    panel.className = 'chiron-listen';
    panel.innerHTML = '<div class="chiron-listen-head"><span>🎧</span><span>Listen</span></div>';
    function group(title, list) {
      if (!list.length) return;
      var g = document.createElement('div'); g.className = 'chiron-listen-group';
      var t = document.createElement('div'); t.className = 'chiron-listen-grouptitle'; t.textContent = title;
      g.appendChild(t);
      list.forEach(function (c) {
        var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'chiron-listen-btn';
        var ico = document.createElement('span'); ico.className = 'ico'; ico.textContent = '▶';
        var lbl = document.createElement('span'); lbl.className = 'lbl'; lbl.textContent = panelLabel(c);
        btn.appendChild(ico); btn.appendChild(lbl);
        btn.addEventListener('click', function () {
          var glow = (c.artifact === 'section' && c.sectionId) ? document.getElementById(c.sectionId) : null;
          play(c, btn, glow, '▶');
        });
        g.appendChild(btn);
      });
      panel.appendChild(g);
    }
    group('La frase', clips.filter(function (c) { return c.artifact === 'section' && /^passage-/.test(c.sectionId); }));
    group('Whole lesson', clips.filter(function (c) { return c.artifact === 'summary' || c.artifact === 'shortened'; }));
    group('By section', clips.filter(function (c) { return c.artifact === 'section' && !/^passage-/.test(c.sectionId); }));
    document.body.appendChild(panel);
  }
  function wireInline(clips) {
    clips.forEach(function (c) {
      if (!c.sectionId) return;
      var el = document.getElementById(c.sectionId);
      if (!el) return;
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'chiron-play-inline'; btn.title = 'Listen'; btn.setAttribute('aria-label', 'Play audio');
      var ico = document.createElement('span'); ico.className = 'ico'; ico.textContent = '▶'; btn.appendChild(ico);
      btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); play(c, btn, null, '▶'); });
      el.classList.add('chiron-has-audio');
      el.insertBefore(btn, el.firstChild);
    });
  }
  function useManifest(m) {
    if (!m || !m.clips) return;
    var ready = m.clips.filter(function (c) { return c.status === 'done' && c.audioPath; });
    if (!ready.length) return;
    var panelClips = ready.filter(function (c) { return PANEL_KIND[c.artifact] != null; });
    var inlineClips = ready.filter(function (c) { return INLINE_KIND[c.artifact]; });
    if (panelClips.length) buildPanel(panelClips);
    if (inlineClips.length) wireInline(inlineClips);
  }
  function init() {
    if (window.__chironAudioManifest) { useManifest(window.__chironAudioManifest); return; }
    fetch('audio/manifest.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(useManifest)
      .catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
  </script>

</body>
</html>`;

writeFileSync(OUT, html);
console.error('[ssm-fattore-v] Wrote', OUT);
console.error('[ssm-fattore-v] Length:', html.length, 'chars · sentences:', ap.sentences.length, '· options:', mcq.options.length);
