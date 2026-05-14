/**
 * Chiron — Rich SR card emitter for Italian language lessons.
 *
 * Verbs: front = infinitive, back = English gloss + 6-tense conjugation table.
 * Nouns: front = bare noun, back = article + English gloss + pairs-with note.
 * Idioms: front = idiom, back = meaning + (optional) literal gloss.
 *
 * Reuses the conjugator from match-madness.ts so the SR deck and MM widget
 * stay coherent (same forms shown across both).
 */

import { conjugate, type VerbEntry, type ItTense } from './match-madness.js';

export interface NounEntry {
  it: string; // "la scopa"
  en: string; // "broom"
  article: 'la' | 'lo' | 'il' | "l'" | 'le' | 'gli' | 'i';
  bare: string; // "scopa"
  pairsWith?: string; // "spazzare"
  plural?: string; // "le scope" — optional for future
  note?: string; // free-form trailing note
}

export interface IdiomEntry {
  it: string; // "essere uno specchio"
  literal?: string; // "to be a mirror"
  meaning: string; // "the house is shiningly clean"
}

/**
 * Tense display: 4 daily-use tenses only. Each row shows
 *   - Italian full term  (presente / pass. pross. / imperfetto / futuro)
 *   - English aspect hint (now / did / was -ing / will) underneath
 *   - the Italian form
 *   - the English gloss
 */
const TENSE_LABELS: Array<{
  tense: ItTense;
  italian: string;
  aspect: string;
  glossPattern: (v: string) => string;
}> = [
  { tense: 'presente',         italian: 'presente',     aspect: 'now',       glossPattern: (v) => `I ${v}` },
  { tense: 'passato-prossimo', italian: 'pass. pross.', aspect: 'did',       glossPattern: (v) => `I ${pastSimple(v)}` },
  { tense: 'imperfetto',       italian: 'imperfetto',   aspect: 'was -ing',  glossPattern: (v) => `I was ${ingForm(v)}` },
  { tense: 'futuro-semplice',  italian: 'futuro',       aspect: 'will',      glossPattern: (v) => `I will ${v}` },
];

/** Tiny English morphology helpers — best-effort, not exhaustive. */
function pastSimple(v: string): string {
  // crude regular past for lesson scope (swept→sweep is irregular; keep simple)
  const irregular: Record<string, string> = {
    sweep: 'swept', put: 'put', hang: 'hung', 'hang out': 'hung out',
    throw: 'threw', 'throw out': 'threw out',
  };
  if (irregular[v]) return irregular[v];
  if (v.endsWith('e')) return v + 'd';
  if (v.endsWith('y')) return v.slice(0, -1) + 'ied';
  return v + 'ed';
}

function ingForm(v: string): string {
  if (v.endsWith('e') && !v.endsWith('ee')) return v.slice(0, -1) + 'ing';
  return v + 'ing';
}

/** Emit one verb card with 4-tense conjugation table + glosses on the back. */
export function emitVerbCard(verb: VerbEntry): string {
  const rows = TENSE_LABELS.map(({ tense, italian, aspect, glossPattern }) => {
    const { form } = conjugate(verb, tense, 'io');
    const gloss = glossPattern(verb.englishGloss);
    return `        <tr>
          <th class="sr-tense-label"><span class="sr-tense-it">${italian}</span><span class="sr-tense-aspect">${aspect}</span></th>
          <td class="sr-form">${form}</td>
          <td class="sr-tense-gloss">${gloss}</td>
        </tr>`;
  }).join('\n');
  return `
  <div class="sr-card" data-card-type="verb">
    <div class="front">${verb.infinitive}</div>
    <div class="back">
      <div class="sr-back-head">
        <strong class="sr-back-gloss">to ${verb.englishGloss}</strong>
        <span class="sr-back-tag">${verb.family}</span>
      </div>
      <table class="sr-conj-table">
        <tbody>
${rows}
        </tbody>
      </table>
    </div>
  </div>`;
}

/** Emit one noun card — article highlighted on the back. */
export function emitNounCard(noun: NounEntry): string {
  const pairsWithLine = noun.pairsWith
    ? `<p class="sr-back-pair">pairs with <em>${noun.pairsWith}</em></p>` : '';
  const noteLine = noun.note ? `<p class="sr-back-note">${noun.note}</p>` : '';
  const pluralLine = noun.plural
    ? `<p class="sr-back-plural">pl. <strong>${noun.plural}</strong></p>` : '';
  return `
  <div class="sr-card" data-card-type="noun">
    <div class="front">${noun.bare}</div>
    <div class="back">
      <div class="sr-back-head">
        <strong class="sr-back-gloss">${noun.en}</strong>
        <span class="sr-back-tag sr-article">${noun.article}</span>
      </div>
      <p class="sr-back-full"><em class="sr-it">${noun.it}</em></p>
      ${pluralLine}
      ${pairsWithLine}
      ${noteLine}
    </div>
  </div>`;
}

/** Emit one idiom card. */
export function emitIdiomCard(idiom: IdiomEntry): string {
  const literal = idiom.literal
    ? `<p class="sr-back-literal">lit. <em>${idiom.literal}</em></p>` : '';
  return `
  <div class="sr-card" data-card-type="idiom">
    <div class="front">${idiom.it}</div>
    <div class="back">
      <div class="sr-back-head">
        <strong class="sr-back-gloss">${idiom.meaning}</strong>
        <span class="sr-back-tag">idiom</span>
      </div>
      ${literal}
    </div>
  </div>`;
}

/** Emit the entire SR deck given verb + noun + idiom arrays. */
export function emitSrDeck(opts: {
  verbs: VerbEntry[];
  nouns: NounEntry[];
  idioms: IdiomEntry[];
}): string {
  return [
    ...opts.verbs.map(emitVerbCard),
    ...opts.nouns.map(emitNounCard),
    ...opts.idioms.map(emitIdiomCard),
  ].join('\n');
}

/** CSS additions for the rich SR cards. Theme-token-only. */
export function emitSrCardCss(): string {
  return `
  /* ---- SR cards (rich, multi-tense back) ---- */
  .sr-card[data-card-type] {
    min-height: 150px;
    padding: var(--chiron-space-4);
    display: flex; align-items: stretch; justify-content: center; text-align: center;
    overflow: hidden;
    position: relative;
  }
  .sr-card[data-card-type] .front {
    display: flex; align-items: center; justify-content: center; width: 100%;
    font-size: 1.15em; color: var(--chiron-accent); font-weight: 700;
    line-height: 1.3;
  }
  .sr-card[data-card-type] .back {
    text-align: left;
    width: 100%;
    display: none;
    flex-direction: column;
    gap: var(--chiron-space-2);
  }
  .sr-card.flipped[data-card-type] .front { display: none; }
  .sr-card.flipped[data-card-type] .back { display: flex; }
  .sr-card.flipped[data-card-type='verb'],
  .sr-card.flipped[data-card-type='noun'] {
    min-height: 260px;
  }

  .sr-back-head {
    display: flex; align-items: center; justify-content: space-between;
    gap: var(--chiron-space-2);
    padding-bottom: var(--chiron-space-2);
    border-bottom: 1px dashed var(--chiron-divider);
    margin-bottom: var(--chiron-space-2);
  }
  .sr-back-gloss { color: var(--chiron-fg); font-family: var(--chiron-font-heading); font-size: 0.92em; font-weight: 700; line-height: 1.3; }
  .sr-back-tag {
    font-family: var(--chiron-font-mono, monospace);
    font-size: 0.65em; letter-spacing: 0.06em; text-transform: uppercase;
    padding: 2px 6px; border-radius: var(--chiron-radius-sm);
    background: var(--chiron-elevated); color: var(--chiron-muted);
    flex-shrink: 0;
  }
  .sr-back-tag.sr-article {
    background: var(--chiron-accent-light); color: var(--chiron-accent);
    font-weight: 700; font-size: 0.78em; text-transform: none; letter-spacing: 0;
  }
  .sr-back-full { margin: 0; font-size: 0.86em; color: var(--chiron-fg-secondary); }
  .sr-back-full .sr-it { color: var(--chiron-fg); font-style: italic; }
  .sr-back-plural,
  .sr-back-pair,
  .sr-back-note,
  .sr-back-literal { margin: 0; font-size: 0.78em; color: var(--chiron-fg-secondary); line-height: 1.45; }
  .sr-back-pair em { color: var(--chiron-accent); font-style: italic; }
  .sr-back-literal em { color: var(--chiron-fg); }

  .sr-conj-table {
    width: 100%; border-collapse: collapse;
    font-size: 0.78em;
    font-family: var(--chiron-font-body);
  }
  .sr-conj-table .sr-tense-label {
    text-align: left; padding: var(--chiron-space-1) var(--chiron-space-2) var(--chiron-space-1) 0;
    display: flex; flex-direction: column; gap: 1px;
    white-space: nowrap;
    vertical-align: top;
  }
  .sr-conj-table .sr-tense-it {
    color: var(--chiron-accent); font-weight: 600;
    font-family: var(--chiron-font-heading);
    font-size: 0.95em; letter-spacing: 0.01em;
  }
  .sr-conj-table .sr-tense-aspect {
    color: var(--chiron-muted); font-weight: 400;
    font-family: var(--chiron-font-mono, monospace);
    font-size: 0.7em; text-transform: lowercase; letter-spacing: 0.06em;
  }
  .sr-conj-table .sr-form {
    text-align: left; padding: var(--chiron-space-1) var(--chiron-space-2);
    color: var(--chiron-fg); font-family: var(--chiron-font-heading);
    font-weight: 700;
  }
  .sr-conj-table .sr-tense-gloss {
    text-align: right; padding: var(--chiron-space-1) 0;
    color: var(--chiron-fg-secondary); font-style: italic;
    font-size: 0.95em;
  }
  .sr-conj-table tbody tr + tr th,
  .sr-conj-table tbody tr + tr td { border-top: 1px dotted var(--chiron-divider); }`;
}
