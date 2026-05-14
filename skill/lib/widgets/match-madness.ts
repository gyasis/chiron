/**
 * Chiron — Match Madness widget (multi-mode, multi-set retrieval anchor).
 *
 * PRD: canonical_shell_and_match_madness_2026-05-12 §4.10–4.12 (2026-05-14 pivot).
 *
 * Match Madness is the canonical retrieval-practice section for every Chiron
 * language lesson. The learner returns to it across sessions to refresh ALL
 * prior learning. Nested structure:
 *   Round   = one 105s timed 2×5 grid
 *   Set     = a group of rounds testing ONE content type (3–5 rounds)
 *   SuperSet = comprehensive mixed-content final (up to 10 rounds)
 *
 * Persistence at RUNTIME is `localStorage` (lessons run from `file://`; no
 * backing server). Generator-side persistence is the existing
 * `.chiron-state.db` (sqlite) — written when assembling lesson HTML.
 *
 * This module exports:
 *   1. Zod schemas (MatchMadnessConfigSchema with mode discriminator)
 *   2. Italian conjugator (regular rules + irregular table)
 *   3. Pair generators per mode
 *   4. HTML/CSS/JS emitter (self-contained, theme-token-only)
 *
 * No hardcoded hex/rgb — all colors flow through `var(--chiron-*)`.
 */

import { z } from 'zod';

// ============================================================================
// 1. Zod schemas
// ============================================================================

/** A single pair shown on the grid. Shape varies subtly by mode. */
export const PairSchema = z.object({
  id: z.string(), // stable for SR scheduler weak-pair tracking
  left: z.string(), // shown on left column (e.g., "to sweep")
  right: z.string(), // shown on right column (e.g., "spazzare")
  hint: z.string().optional(), // optional secondary display (e.g., gloss)
});
export type Pair = z.infer<typeof PairSchema>;

/** Mode discriminator — drives pair authoring + UI hints. */
export const MmModeSchema = z.enum([
  'vocab-pair', // L1 ↔ L2 (the original)
  'gender-pair', // article ↔ noun (la ↔ scopa)
  'prep-pair', // preposition phrase ↔ context gloss
  'collocation', // verb ↔ object (spazzare ↔ la scopa)
  'conjugation', // inflected form ↔ EN gloss-with-subject
  'mixed', // SUPER-SET: pulls from all completed sets in lesson
]);
export type MmMode = z.infer<typeof MmModeSchema>;

/** One Set = mode + rounds + pair pool. */
export const SetSchema = z.object({
  id: z.string(), // e.g., "set-3-gender"
  index: z.number().int().min(1),
  title: z.string(), // e.g., "Noun gender — la/lo/il/l'"
  subtitle: z.string().optional(),
  mode: MmModeSchema,
  rounds: z.number().int().min(1).max(20),
  pairs: z.array(PairSchema).min(5),
  // Per-set tuning (defaults inherited from MatchMadnessConfig)
  timerSec: z.number().int().min(30).max(600).optional(),
  wrongLockMs: z.number().int().min(100).max(5000).optional(),
  // Super-set draws from these set ids (only valid when mode === 'mixed')
  drawsFromSetIds: z.array(z.string()).optional(),
});
export type Set = z.infer<typeof SetSchema>;

/** Visual speed-up layer (PRD §4.3). Disabled in accessibility mode. */
export const VisualSpeedUpSchema = z.object({
  pulseFromMs: z.number().int().default(2000),
  pulseToMs: z.number().int().default(600),
  strengthFromOpacity: z.number().default(0.04),
  strengthToOpacity: z.number().default(0.18),
  refillFromMs: z.number().int().default(200),
  refillToMs: z.number().int().default(100),
});
export type VisualSpeedUp = z.infer<typeof VisualSpeedUpSchema>;

/** Top-level config for the entire Match Madness section in a lesson. */
export const MatchMadnessConfigSchema = z.object({
  lessonId: z.string(), // e.g., "italian-cleaning-verbs-2026-05-12"
  domain: z.enum(['language-it', 'language-de', 'medicine', 'code']),
  title: z.string().default('Match Madness'),
  description: z.string().optional(),
  // Defaults applied to each Set unless overridden per-set
  defaults: z.object({
    timerSec: z.number().int().default(105),
    wrongLockMs: z.number().int().default(1500),
    accessibilityModeAllowed: z.boolean().default(true),
    keyboardShortcuts: z.boolean().default(true),
    visualSpeedUp: VisualSpeedUpSchema.default({}),
  }),
  sets: z.array(SetSchema).min(1),
  // Unlock policy: must complete previous set with ≥ this accuracy to unlock next.
  unlockAccuracyThreshold: z.number().min(0).max(1).default(0.6),
  // SUPER-SET requires this many sets completed before unlocking
  superSetUnlockAfterNSetsCompleted: z.number().int().min(0).default(3),
});
export type MatchMadnessConfig = z.infer<typeof MatchMadnessConfigSchema>;

// ============================================================================
// 2. Italian conjugator
// ============================================================================

/** The 6 tenses Chiron supports per the 2026-05-14 PRD pivot. */
export type ItTense =
  | 'presente'
  | 'passato-prossimo'
  | 'imperfetto'
  | 'futuro-semplice'
  | 'congiuntivo-presente'
  | 'passato-remoto';

/** Subject pronoun (we focus on `io` for v1; future: full paradigm). */
export type ItSubject = 'io' | 'tu' | 'lui-lei' | 'noi' | 'voi' | 'loro';

/** Verb metadata for conjugation. */
export interface VerbEntry {
  infinitive: string; // e.g., "spazzare"
  family: 'are' | 'ere' | 'ire' | 'isco-ire'; // -isco-ire is the -isco subgroup
  englishGloss: string; // bare gloss, no "to ": e.g., "sweep"
  // Irregularity overrides keyed by `${tense}:${subject}` — fully spelled form.
  irregular?: Partial<Record<`${ItTense}:${ItSubject}`, string>>;
  // Past participle for passato prossimo. Default = stem + ato/uto/ito.
  participle?: string;
  // Auxiliary for passato prossimo. Default = "ho".
  auxiliary?: 'ho' | 'sono';
}

/** Subject-pronoun → English equivalent (for gloss assembly). */
const SUBJECT_EN: Record<ItSubject, string> = {
  io: 'I',
  tu: 'you',
  'lui-lei': 'he/she',
  noi: 'we',
  voi: 'you (pl.)',
  loro: 'they',
};

/** Regular endings — exhaustive for v1 needs (io-form first, others extensible). */
const REGULAR_ENDINGS: Record<ItTense, Record<VerbEntry['family'], Record<ItSubject, string>>> = {
  presente: {
    are: { io: 'o', tu: 'i', 'lui-lei': 'a', noi: 'iamo', voi: 'ate', loro: 'ano' },
    ere: { io: 'o', tu: 'i', 'lui-lei': 'e', noi: 'iamo', voi: 'ete', loro: 'ono' },
    ire: { io: 'o', tu: 'i', 'lui-lei': 'e', noi: 'iamo', voi: 'ite', loro: 'ono' },
    'isco-ire': { io: 'isco', tu: 'isci', 'lui-lei': 'isce', noi: 'iamo', voi: 'ite', loro: 'iscono' },
  },
  imperfetto: {
    are: { io: 'avo', tu: 'avi', 'lui-lei': 'ava', noi: 'avamo', voi: 'avate', loro: 'avano' },
    ere: { io: 'evo', tu: 'evi', 'lui-lei': 'eva', noi: 'evamo', voi: 'evate', loro: 'evano' },
    ire: { io: 'ivo', tu: 'ivi', 'lui-lei': 'iva', noi: 'ivamo', voi: 'ivate', loro: 'ivano' },
    'isco-ire': { io: 'ivo', tu: 'ivi', 'lui-lei': 'iva', noi: 'ivamo', voi: 'ivate', loro: 'ivano' },
  },
  'futuro-semplice': {
    are: { io: 'erò', tu: 'erai', 'lui-lei': 'erà', noi: 'eremo', voi: 'erete', loro: 'eranno' },
    ere: { io: 'erò', tu: 'erai', 'lui-lei': 'erà', noi: 'eremo', voi: 'erete', loro: 'eranno' },
    ire: { io: 'irò', tu: 'irai', 'lui-lei': 'irà', noi: 'iremo', voi: 'irete', loro: 'iranno' },
    'isco-ire': { io: 'irò', tu: 'irai', 'lui-lei': 'irà', noi: 'iremo', voi: 'irete', loro: 'iranno' },
  },
  'congiuntivo-presente': {
    are: { io: 'i', tu: 'i', 'lui-lei': 'i', noi: 'iamo', voi: 'iate', loro: 'ino' },
    ere: { io: 'a', tu: 'a', 'lui-lei': 'a', noi: 'iamo', voi: 'iate', loro: 'ano' },
    ire: { io: 'a', tu: 'a', 'lui-lei': 'a', noi: 'iamo', voi: 'iate', loro: 'ano' },
    'isco-ire': { io: 'isca', tu: 'isca', 'lui-lei': 'isca', noi: 'iamo', voi: 'iate', loro: 'iscano' },
  },
  'passato-remoto': {
    are: { io: 'ai', tu: 'asti', 'lui-lei': 'ò', noi: 'ammo', voi: 'aste', loro: 'arono' },
    ere: { io: 'ei', tu: 'esti', 'lui-lei': 'é', noi: 'emmo', voi: 'este', loro: 'erono' },
    ire: { io: 'ii', tu: 'isti', 'lui-lei': 'ì', noi: 'immo', voi: 'iste', loro: 'irono' },
    'isco-ire': { io: 'ii', tu: 'isti', 'lui-lei': 'ì', noi: 'immo', voi: 'iste', loro: 'irono' },
  },
  // Passato prossimo is COMPOUND — handled specially in conjugate()
  'passato-prossimo': {
    are: { io: '', tu: '', 'lui-lei': '', noi: '', voi: '', loro: '' },
    ere: { io: '', tu: '', 'lui-lei': '', noi: '', voi: '', loro: '' },
    ire: { io: '', tu: '', 'lui-lei': '', noi: '', voi: '', loro: '' },
    'isco-ire': { io: '', tu: '', 'lui-lei': '', noi: '', voi: '', loro: '' },
  },
};

/** "avere" present-tense forms (for passato prossimo aux). */
const AVERE_PRES: Record<ItSubject, string> = {
  io: 'ho',
  tu: 'hai',
  'lui-lei': 'ha',
  noi: 'abbiamo',
  voi: 'avete',
  loro: 'hanno',
};
const ESSERE_PRES: Record<ItSubject, string> = {
  io: 'sono',
  tu: 'sei',
  'lui-lei': 'è',
  noi: 'siamo',
  voi: 'siete',
  loro: 'sono',
};

/** Strip infinitive ending to get stem. */
function stem(verb: VerbEntry): string {
  const inf = verb.infinitive;
  if (verb.family === 'are') return inf.slice(0, -3);
  if (verb.family === 'ere') return inf.slice(0, -3);
  return inf.slice(0, -3); // ire and isco-ire both end in -ire
}

/** Default past participle from family. */
function defaultParticiple(verb: VerbEntry): string {
  const s = stem(verb);
  if (verb.family === 'are') return s + 'ato';
  if (verb.family === 'ere') return s + 'uto';
  return s + 'ito';
}

/** Italian gloss for one tense form, English equivalent. */
function glossEN(verb: VerbEntry, tense: ItTense, subject: ItSubject): string {
  const subj = SUBJECT_EN[subject];
  const v = verb.englishGloss; // bare verb, e.g., "sweep"
  // Map to English form roughly — purely for matching (not strict translation)
  switch (tense) {
    case 'presente':
      return subject === 'lui-lei' ? `${subj} ${v}s` : `${subj} ${v}`;
    case 'passato-prossimo':
      return `${subj} ${v === 'be' ? 'was' : v}ed`; // crude; covers most lesson verbs
    case 'imperfetto':
      return `${subj} used to ${v}`;
    case 'futuro-semplice':
      return `${subj} will ${v}`;
    case 'congiuntivo-presente':
      return `(that) ${subj} ${v}`;
    case 'passato-remoto':
      return `${subj} ${v === 'be' ? 'was' : v}ed (lit.)`;
  }
}

/**
 * Conjugate one verb in one tense × subject. Honors irregular overrides.
 * Returns `{ form, gloss }` for use as a Match Madness pair.
 */
export function conjugate(
  verb: VerbEntry,
  tense: ItTense,
  subject: ItSubject,
): { form: string; gloss: string } {
  const key = `${tense}:${subject}` as const;
  const override = verb.irregular?.[key];
  if (override) return { form: override, gloss: glossEN(verb, tense, subject) };

  if (tense === 'passato-prossimo') {
    const aux = (verb.auxiliary ?? 'ho') === 'sono' ? ESSERE_PRES[subject] : AVERE_PRES[subject];
    const part = verb.participle ?? defaultParticiple(verb);
    return { form: `${aux} ${part}`, gloss: glossEN(verb, tense, subject) };
  }

  const ending = REGULAR_ENDINGS[tense][verb.family][subject];
  const s = stem(verb);
  // Spelling guard: -care/-gare insert "h" before -i/-e endings in some tenses
  // (e.g., "sciacquare" → "sciacqui", "asciugare" → "asciughi").
  // For v1 we keep a small lookup; full orthography is in tests.
  const guarded = applySpellingGuard(s, ending, verb.family);
  return { form: guarded, gloss: glossEN(verb, tense, subject) };
}

function applySpellingGuard(stm: string, ending: string, family: VerbEntry['family']): string {
  if (family !== 'are') return stm + ending;
  // -care / -gare: insert "h" before "e" or "i"
  const hard = stm.endsWith('c') || stm.endsWith('g');
  if (hard && (ending.startsWith('e') || ending.startsWith('i'))) {
    return stm + 'h' + ending;
  }
  // -ciare / -giare: drop the "i" before "e" or "i"
  if ((stm.endsWith('ci') || stm.endsWith('gi')) && (ending.startsWith('e') || ending.startsWith('i'))) {
    return stm.slice(0, -1) + ending;
  }
  return stm + ending;
}

// ============================================================================
// 3. Pair generator (builds Set.pairs from authoring shorthand)
// ============================================================================

/** Build a conjugation set: cross product of {verbs} × {tenses} × {subjects}. */
export function buildConjugationSet(opts: {
  setId: string;
  index: number;
  title: string;
  verbs: VerbEntry[];
  tense: ItTense;
  subjects: ItSubject[]; // typically just ['io'] for v1
  rounds?: number;
}): Set {
  const pairs: Pair[] = [];
  for (const verb of opts.verbs) {
    for (const subject of opts.subjects) {
      const { form, gloss } = conjugate(verb, opts.tense, subject);
      pairs.push({
        id: `${opts.tense}:${subject}:${verb.infinitive}`,
        left: gloss,
        right: form,
        hint: verb.infinitive,
      });
    }
  }
  return {
    id: opts.setId,
    index: opts.index,
    title: opts.title,
    mode: 'conjugation',
    rounds: opts.rounds ?? 5,
    pairs,
  };
}

// ============================================================================
// 4. HTML / CSS / JS emitter
// ============================================================================

/** Emit the complete `<section>` HTML for the Match Madness section. */
export function emitMatchMadnessHtml(config: MatchMadnessConfig): string {
  const setCards = config.sets
    .map(
      (s) => `
      <article class="mm-set-card" data-set-id="${s.id}" data-mode="${s.mode}">
        <div class="mm-set-card-header">
          <span class="mm-set-num">Set ${s.index}</span>
          <span class="mm-set-mode">${s.mode}</span>
        </div>
        <h3 class="mm-set-title">${s.title}</h3>
        ${s.subtitle ? `<p class="mm-set-subtitle">${s.subtitle}</p>` : ''}
        <div class="mm-set-meta">
          <span><strong>${s.rounds}</strong> rounds</span>
          <span><strong>${s.pairs.length}</strong> pairs</span>
        </div>
        <div class="mm-set-mastery" data-mastery-for="${s.id}">
          <span class="mm-mastery-label">No history yet</span>
        </div>
        <button class="mm-set-play primary" data-play-set="${s.id}">Play set</button>
      </article>`,
    )
    .join('\n');

  return `
    <!-- ========================= Match Madness (multi-set) ========================= -->
    <div class="mm-section" data-mm-lesson="${config.lessonId}">
      <p class="mm-intro">${escapeHtml(config.description ?? '')}</p>

      <div class="mm-sets-grid">
        ${setCards}
      </div>

      <!-- The play surface is overlaid when a set is selected -->
      <div class="mm-play-surface" id="mm-play-surface" hidden>
        <button class="mm-close" id="mm-close" aria-label="Close Match Madness">×</button>
        <div class="mm-container" id="mm-game" data-active="false">
          <div class="mm-header">
            <div class="mm-set-label" id="mm-set-label">—</div>
            <div class="mm-timer" id="mm-timer">1:45</div>
            <div class="mm-stats">
              <span class="stat"><strong id="mm-correct">0</strong>correct</span>
              <span class="stat"><strong id="mm-wrong">0</strong>wrong</span>
              <span class="stat mm-combo" id="mm-combo">×0</span>
            </div>
          </div>
          <div class="mm-round-label" id="mm-round">Round — / —</div>
          <div class="mm-grid" id="mm-grid"></div>
          <div class="mm-keyboard-hint">Keyboard: <code>1–5</code> left · <code>Q W E R T</code> right · <code>Space</code> start/pause</div>
          <div class="mm-controls">
            <button class="primary" id="mm-start">Start</button>
            <button id="mm-reset">Reset</button>
            <button id="mm-accessibility">Accessibility mode (timer off)</button>
          </div>
          <div class="mm-result" id="mm-result" hidden>
            <h4 id="mm-result-title">Round complete!</h4>
            <div id="mm-result-body"></div>
          </div>
        </div>
      </div>
    </div>`;
}

/** Emit the runtime JS — self-contained, depends only on `document`. */
export function emitMatchMadnessJs(config: MatchMadnessConfig): string {
  // We serialize the config and ship it. localStorage key is namespaced by lessonId.
  const data = JSON.stringify({
    lessonId: config.lessonId,
    defaults: config.defaults,
    sets: config.sets,
    unlockAccuracyThreshold: config.unlockAccuracyThreshold,
    superSetUnlockAfterNSetsCompleted: config.superSetUnlockAfterNSetsCompleted,
  });

  return `
  /* ========================= Match Madness (multi-set) ========================= */
  (function() {
    const CONFIG = ${data};
    const STORE_KEY = 'chiron-mm::' + CONFIG.lessonId;

    function loadState() {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        return raw ? JSON.parse(raw) : { sets: {}, sessions: [], pairLog: [] };
      } catch (_) { return { sets: {}, sessions: [], pairLog: [] }; }
    }
    function saveState(st) {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (_) {}
    }

    const STATE = loadState();

    // ----- Render mastery on each set card -----
    function renderMasteryAll() {
      document.querySelectorAll('[data-mastery-for]').forEach(node => {
        const id = node.getAttribute('data-mastery-for');
        const s = STATE.sets[id];
        if (!s || !s.attempts) {
          node.innerHTML = '<span class="mm-mastery-label">No history yet</span>';
          return;
        }
        const mastery = Math.round((s.bestAccuracy || 0) * 100);
        const last = s.lastPlayedIso ? new Date(s.lastPlayedIso) : null;
        const ago = last ? timeAgo(last) : '';
        const weak = (s.weakPairs || []).length;
        node.innerHTML =
          '<span class="mm-mastery-pct" data-mastery="' + mastery + '"><strong>' + mastery + '%</strong> mastery</span>' +
          '<span class="mm-mastery-when">last ' + ago + '</span>' +
          (weak > 0 ? '<span class="mm-mastery-weak"><strong>' + weak + '</strong> weak pairs</span>' : '');
      });
    }

    function timeAgo(d) {
      const diff = (Date.now() - d.getTime()) / 1000;
      if (diff < 60) return 'just now';
      if (diff < 3600) return Math.floor(diff/60) + 'm ago';
      if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
      return Math.floor(diff/86400) + 'd ago';
    }

    // ----- Play loop -----
    const G = {
      activeSet: null,
      pool: [],
      onGrid: [],
      selected: null,
      roundIdx: 0,
      correct: 0, wrong: 0, streak: 0, bestStreak: 0,
      remainingSec: 0,
      running: false, paused: false, accessibility: false,
      lockUntil: 0, tickHandle: 0, sessionStart: 0,
      tileShownAt: {},
      pairLog: []
    };

    function $(id) { return document.getElementById(id); }
    function shuffle(a) { const r = a.slice(); for (let i=r.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [r[i],r[j]]=[r[j],r[i]];} return r; }

    function openSet(setId) {
      const set = CONFIG.sets.find(s => s.id === setId);
      if (!set) return;
      G.activeSet = set;
      $('mm-set-label').textContent = 'Set ' + set.index + ' · ' + set.title;
      $('mm-play-surface').hidden = false;
      G.roundIdx = 0; G.correct = 0; G.wrong = 0; G.streak = 0; G.bestStreak = 0;
      G.pool = shuffle(set.pairs.slice());
      G.remainingSec = set.timerSec || CONFIG.defaults.timerSec;
      G.running = false; G.paused = false; G.accessibility = false;
      G.tileShownAt = {}; G.pairLog = []; G.sessionStart = Date.now();
      seedGrid(); renderGrid(); updateHud();
      $('mm-result').hidden = true;
      document.body.style.overflow = 'hidden';
    }

    function closeSet() {
      G.running = false;
      clearInterval(G.tickHandle);
      $('mm-play-surface').hidden = true;
      document.body.style.overflow = '';
      renderMasteryAll();
    }

    function seedGrid() {
      const seed = [];
      for (let i = 0; i < 5; i++) seed.push(G.pool.length ? G.pool.shift() : null);
      G.onGrid = seed;
    }

    function renderGrid() {
      const grid = $('mm-grid'); grid.innerHTML = '';
      const leftL1 = G.onGrid.map(p => p ? { l1: p.left, right: p.right, id: p.id } : null);
      const rightL2 = shuffle(G.onGrid.filter(Boolean).map(p => ({ left: p.left, right: p.right, id: p.id })));
      while (rightL2.length < 5) rightL2.push(null);
      for (let i = 0; i < 5; i++) {
        const lp = leftL1[i], rp = rightL2[i];
        const lt = document.createElement('button');
        lt.className = 'mm-tile'; lt.setAttribute('data-side','L'); lt.setAttribute('data-row', String(i));
        if (lp) { lt.textContent = lp.l1; lt.setAttribute('data-pair-id', lp.id); }
        else lt.setAttribute('data-state','empty');
        grid.appendChild(lt);
        const rt = document.createElement('button');
        rt.className = 'mm-tile'; rt.setAttribute('data-side','R'); rt.setAttribute('data-row', String(i));
        if (rp) { rt.textContent = rp.right; rt.setAttribute('data-pair-id', rp.id); }
        else rt.setAttribute('data-state','empty');
        grid.appendChild(rt);
      }
      const now = performance.now();
      G.onGrid.forEach(p => { if (p) G.tileShownAt[p.id] = now; });
      grid.querySelectorAll('.mm-tile').forEach(t => t.addEventListener('click', () => onTile(t)));
    }

    function onTile(tile) {
      if (!G.running || G.paused) return;
      if (performance.now() < G.lockUntil) return;
      if (tile.getAttribute('data-state') === 'empty') return;
      if (tile.getAttribute('data-state') === 'correct') return;
      if (!G.selected) { tile.setAttribute('data-state','selected'); G.selected = tile; return; }
      // Second pick
      const a = G.selected, b = tile;
      if (a === b) { a.removeAttribute('data-state'); G.selected = null; return; }
      const aSide = a.getAttribute('data-side'), bSide = b.getAttribute('data-side');
      if (aSide === bSide) { a.removeAttribute('data-state'); b.setAttribute('data-state','selected'); G.selected = b; return; }
      const aId = a.getAttribute('data-pair-id'), bId = b.getAttribute('data-pair-id');
      if (aId === bId) {
        a.setAttribute('data-state','correct'); b.setAttribute('data-state','correct');
        G.selected = null; G.correct++; G.streak++; if (G.streak > G.bestStreak) G.bestStreak = G.streak;
        const lat = performance.now() - (G.tileShownAt[aId] || performance.now());
        G.pairLog.push({ id: aId, latency_ms: Math.round(lat), was_wrong_first: false });
        // Refill this slot with a new pair
        setTimeout(() => refillSlot(a, b), refillDelay());
        updateHud(); updateVisualSpeedUp();
      } else {
        a.setAttribute('data-state','wrong'); b.setAttribute('data-state','wrong');
        G.wrong++; G.streak = 0;
        G.pairLog.push({ id: aId, latency_ms: 0, was_wrong_first: true });
        G.lockUntil = performance.now() + (G.activeSet.wrongLockMs || CONFIG.defaults.wrongLockMs);
        setTimeout(() => { a.removeAttribute('data-state'); b.removeAttribute('data-state'); }, CONFIG.defaults.wrongLockMs);
        G.selected = null;
        updateHud();
      }
    }

    function refillSlot(aTile, bTile) {
      // Replace whichever side has data-pair-id with a fresh pair from pool
      const next = G.pool.shift();
      const replaceTile = (t) => {
        if (next) {
          t.removeAttribute('data-state');
          const side = t.getAttribute('data-side');
          t.textContent = side === 'L' ? next.left : next.right;
          t.setAttribute('data-pair-id', next.id);
          G.tileShownAt[next.id] = performance.now();
        } else {
          t.setAttribute('data-state','empty'); t.textContent = '';
        }
      };
      // Pair the same next on both sides (L=left, R=right)
      replaceTile(aTile); replaceTile(bTile);
      checkRoundEnd();
    }

    function refillDelay() {
      const vs = CONFIG.defaults.visualSpeedUp;
      // Scale by streak — more streak = shorter delay
      const t = Math.min(1, G.streak / 10);
      return Math.round(vs.refillFromMs + (vs.refillToMs - vs.refillFromMs) * t);
    }

    function updateVisualSpeedUp() {
      const vs = CONFIG.defaults.visualSpeedUp;
      const t = Math.min(1, G.streak / 10);
      const pulseMs = vs.pulseFromMs + (vs.pulseToMs - vs.pulseFromMs) * t;
      const strength = vs.strengthFromOpacity + (vs.strengthToOpacity - vs.strengthFromOpacity) * t;
      const root = document.getElementById('mm-game');
      if (root && !G.accessibility) {
        root.style.setProperty('--mm-pulse-ms', pulseMs + 'ms');
        root.style.setProperty('--mm-pulse-strength', String(strength));
      }
    }

    function checkRoundEnd() {
      const tilesLeft = G.onGrid.filter(Boolean).length;
      const poolLeft = G.pool.length;
      // Round ends when grid is empty AND pool is empty
      if (tilesLeft === 0 && poolLeft === 0) endRound();
    }

    function endRound() {
      G.roundIdx++;
      const totalRounds = G.activeSet.rounds;
      if (G.roundIdx >= totalRounds) endSession(true);
      else {
        // Start next round: reshuffle a fresh pool from full pairs
        G.pool = shuffle(G.activeSet.pairs.slice());
        seedGrid(); renderGrid(); updateHud();
      }
    }

    function endSession(completed) {
      G.running = false;
      clearInterval(G.tickHandle);
      const total = G.correct + G.wrong;
      const accuracy = total > 0 ? G.correct / total : 0;
      // Persist
      const setId = G.activeSet.id;
      STATE.sets[setId] = STATE.sets[setId] || { attempts: 0, bestAccuracy: 0, weakPairs: [] };
      STATE.sets[setId].attempts++;
      if (accuracy > STATE.sets[setId].bestAccuracy) STATE.sets[setId].bestAccuracy = accuracy;
      STATE.sets[setId].lastPlayedIso = new Date().toISOString();
      // Weak pairs = those that had a wrong_first event
      const weak = {};
      G.pairLog.forEach(p => { if (p.was_wrong_first) weak[p.id] = (weak[p.id]||0) + 1; });
      STATE.sets[setId].weakPairs = Object.entries(weak).map(([id,n]) => ({ id, misses: n }));
      STATE.sessions.push({ setId, startedAt: G.sessionStart, endedAt: Date.now(), correct: G.correct, wrong: G.wrong, accuracy, completed });
      saveState(STATE);
      // Show result
      $('mm-result-title').textContent = completed ? 'Set complete!' : 'Time up!';
      $('mm-result-body').innerHTML =
        '<p><strong>' + G.correct + '</strong> correct · <strong>' + G.wrong + '</strong> wrong · <strong>' + Math.round(accuracy*100) + '%</strong> accuracy</p>' +
        '<p>Best streak: <strong>' + G.bestStreak + '</strong></p>' +
        (Object.keys(weak).length > 0 ? '<p>Weak pairs flagged: <strong>' + Object.keys(weak).length + '</strong> — they\\'ll come back in spaced review.</p>' : '<p>No weak pairs — nice.</p>');
      $('mm-result').hidden = false;
    }

    function updateHud() {
      $('mm-correct').textContent = String(G.correct);
      $('mm-wrong').textContent = String(G.wrong);
      $('mm-combo').textContent = '×' + G.streak;
      $('mm-round').textContent = 'Round ' + (G.roundIdx + 1) + ' / ' + (G.activeSet ? G.activeSet.rounds : '—');
      const m = Math.floor(G.remainingSec / 60), s = G.remainingSec % 60;
      $('mm-timer').textContent = m + ':' + (s < 10 ? '0' + s : s);
    }

    function start() {
      if (!G.activeSet) return;
      G.running = true; G.paused = false;
      G.tickHandle = setInterval(() => {
        if (!G.running || G.paused || G.accessibility) return;
        G.remainingSec--;
        if (G.remainingSec <= 0) { G.remainingSec = 0; updateHud(); endSession(false); }
        else updateHud();
      }, 1000);
    }

    function reset() {
      if (G.activeSet) openSet(G.activeSet.id);
    }

    function toggleAccessibility() {
      G.accessibility = !G.accessibility;
      const btn = $('mm-accessibility');
      btn.setAttribute('aria-pressed', String(G.accessibility));
      btn.textContent = G.accessibility ? 'Accessibility ON (no timer)' : 'Accessibility mode (timer off)';
      if (G.accessibility) {
        const root = $('mm-game');
        root.style.setProperty('--mm-pulse-strength','0');
      }
    }

    // ----- Wire-up -----
    document.querySelectorAll('[data-play-set]').forEach(btn => {
      btn.addEventListener('click', () => openSet(btn.getAttribute('data-play-set')));
    });
    $('mm-close')?.addEventListener('click', closeSet);
    $('mm-start')?.addEventListener('click', start);
    $('mm-reset')?.addEventListener('click', reset);
    $('mm-accessibility')?.addEventListener('click', toggleAccessibility);

    document.addEventListener('keydown', (e) => {
      if ($('mm-play-surface').hidden) return;
      if (e.key === 'Escape') closeSet();
      if (e.key === ' ' && !e.repeat) { e.preventDefault(); if (!G.running) start(); else G.paused = !G.paused; }
      if (G.running && !G.paused) {
        const leftKeys = ['1','2','3','4','5'];
        const rightKeys = ['q','w','e','r','t'];
        const k = e.key.toLowerCase();
        const li = leftKeys.indexOf(k); const ri = rightKeys.indexOf(k);
        if (li >= 0) { const tiles = document.querySelectorAll('.mm-tile[data-side="L"]'); tiles[li] && onTile(tiles[li]); }
        if (ri >= 0) { const tiles = document.querySelectorAll('.mm-tile[data-side="R"]'); tiles[ri] && onTile(tiles[ri]); }
      }
    });

    renderMasteryAll();
  })();`;
}

/** Emit the CSS — all colors via theme tokens. */
export function emitMatchMadnessCss(): string {
  return `
  /* ========================= Match Madness (multi-set) ========================= */
  .mm-section { margin: var(--chiron-space-6) 0; }
  .mm-intro { color: var(--chiron-fg-secondary); font-size: 0.95rem; margin-bottom: var(--chiron-space-5); }

  .mm-sets-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: var(--chiron-space-4);
  }

  .mm-set-card {
    background: var(--chiron-surface);
    border: 1px solid var(--chiron-border);
    border-radius: var(--chiron-radius-md);
    padding: var(--chiron-space-5);
    display: flex; flex-direction: column; gap: var(--chiron-space-3);
    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
  }
  .mm-set-card:hover { transform: translateY(-2px); box-shadow: var(--chiron-shadow-md); border-color: var(--chiron-accent); }
  .mm-set-card[data-mode="conjugation"] { border-left: 3px solid var(--chiron-warm-accent); }
  .mm-set-card[data-mode="mixed"] { border-left: 3px solid var(--chiron-accent); background: linear-gradient(135deg, var(--chiron-surface), var(--chiron-elevated)); }

  .mm-set-card-header { display: flex; justify-content: space-between; align-items: center; font-size: 11px; }
  .mm-set-num { font-family: var(--chiron-font-mono, monospace); color: var(--chiron-muted); letter-spacing: 0.08em; text-transform: uppercase; }
  .mm-set-mode { font-family: var(--chiron-font-mono, monospace); color: var(--chiron-accent); font-size: 10px; padding: 2px 6px; background: var(--chiron-accent-light); border-radius: var(--chiron-radius-sm); }
  .mm-set-title { font-family: var(--chiron-font-heading); font-size: 1.1rem; margin: 0; color: var(--chiron-fg); }
  .mm-set-subtitle { color: var(--chiron-fg-secondary); font-size: 0.85rem; margin: 0; font-style: italic; }
  .mm-set-meta { display: flex; gap: var(--chiron-space-3); font-size: 0.85rem; color: var(--chiron-fg-secondary); }
  .mm-set-mastery { display: flex; flex-wrap: wrap; gap: var(--chiron-space-2); font-size: 0.78rem; color: var(--chiron-muted); padding: var(--chiron-space-2) 0; border-top: 1px dashed var(--chiron-divider); margin-top: auto; }
  .mm-mastery-pct strong { color: var(--chiron-accent); }
  .mm-mastery-weak strong { color: var(--chiron-warm-accent); }
  .mm-set-play.primary {
    background: var(--chiron-accent); color: var(--chiron-surface);
    border: none; padding: var(--chiron-space-2) var(--chiron-space-4); border-radius: var(--chiron-radius-sm);
    cursor: pointer; font-weight: 600; font-size: 0.9rem;
  }
  .mm-set-play.primary:hover { background: var(--chiron-accent-hover, var(--chiron-accent)); }

  /* Play surface = full-screen overlay */
  .mm-play-surface {
    position: fixed; inset: 0; z-index: 1000;
    background: var(--chiron-bg);
    display: flex; align-items: center; justify-content: center;
    padding: var(--chiron-space-6);
    overflow: auto;
  }
  .mm-close {
    position: absolute; top: var(--chiron-space-4); right: var(--chiron-space-4);
    background: var(--chiron-surface); border: 1px solid var(--chiron-border);
    width: 36px; height: 36px; border-radius: 50%;
    font-size: 1.2rem; cursor: pointer; color: var(--chiron-fg);
  }
  .mm-close:hover { background: var(--chiron-elevated); }

  .mm-container {
    --mm-pulse-ms: 2000ms;
    --mm-pulse-strength: 0;
    width: 100%; max-width: 720px;
    background: var(--chiron-surface);
    border: 1px solid var(--chiron-border);
    border-radius: var(--chiron-radius-lg);
    padding: var(--chiron-space-6);
    box-shadow: var(--chiron-shadow-lg);
    position: relative; overflow: hidden;
  }
  .mm-container::before {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    background: var(--chiron-accent);
    opacity: var(--mm-pulse-strength);
    animation: mm-pulse var(--mm-pulse-ms) ease-in-out infinite;
  }
  @keyframes mm-pulse { 0%, 100% { opacity: var(--mm-pulse-strength); } 50% { opacity: calc(var(--mm-pulse-strength) * 1.8); } }

  .mm-header { display: flex; justify-content: space-between; align-items: center; gap: var(--chiron-space-4); margin-bottom: var(--chiron-space-4); }
  .mm-set-label { font-size: 0.9rem; color: var(--chiron-fg-secondary); }
  .mm-timer { font-family: var(--chiron-font-mono, monospace); font-size: 2rem; font-weight: 700; color: var(--chiron-accent); }
  .mm-stats { display: flex; gap: var(--chiron-space-3); font-size: 0.85rem; }
  .mm-stats .stat strong { display: block; font-size: 1.4rem; color: var(--chiron-fg); }
  .mm-combo strong { color: var(--chiron-warm-accent); }
  .mm-round-label { text-align: center; font-size: 0.85rem; color: var(--chiron-muted); margin-bottom: var(--chiron-space-3); }

  .mm-grid {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: var(--chiron-space-3); margin: var(--chiron-space-4) 0;
  }
  .mm-tile {
    background: var(--chiron-elevated);
    color: var(--chiron-fg);
    border: 2px solid var(--chiron-border);
    border-radius: var(--chiron-radius-md);
    padding: var(--chiron-space-4) var(--chiron-space-3);
    font: inherit; font-size: 0.95rem; font-weight: 500;
    cursor: pointer; min-height: 56px;
    transition: transform 0.12s ease, border-color 0.12s ease, background 0.12s ease;
  }
  .mm-tile:hover:not([data-state="empty"]):not([data-state="correct"]) { border-color: var(--chiron-accent); transform: translateY(-1px); }
  .mm-tile[data-state="selected"] { border-color: var(--chiron-accent); background: var(--chiron-accent-light); color: var(--chiron-fg); }
  .mm-tile[data-state="correct"] { border-color: var(--chiron-success, var(--chiron-accent)); background: var(--chiron-success-bg, var(--chiron-accent-light)); opacity: 0.55; cursor: default; }
  .mm-tile[data-state="wrong"] { border-color: var(--chiron-warm-accent); background: var(--chiron-warm-accent); color: var(--chiron-surface); animation: mm-shake 0.4s; }
  .mm-tile[data-state="empty"] { background: transparent; border-style: dashed; cursor: default; }
  @keyframes mm-shake { 0%,100% { transform: translateX(0);} 25%{transform:translateX(-4px);} 75%{transform:translateX(4px);} }

  .mm-keyboard-hint { font-size: 0.78rem; color: var(--chiron-muted); text-align: center; margin: var(--chiron-space-3) 0; }
  .mm-keyboard-hint code { background: var(--chiron-elevated); padding: 2px 6px; border-radius: var(--chiron-radius-sm); font-family: var(--chiron-font-mono, monospace); }
  .mm-controls { display: flex; gap: var(--chiron-space-2); justify-content: center; flex-wrap: wrap; }
  .mm-controls button { font: inherit; padding: var(--chiron-space-2) var(--chiron-space-4); border-radius: var(--chiron-radius-sm); border: 1px solid var(--chiron-border); background: var(--chiron-surface); color: var(--chiron-fg); cursor: pointer; }
  .mm-controls button.primary { background: var(--chiron-accent); color: var(--chiron-surface); border-color: var(--chiron-accent); }
  .mm-controls button:hover { background: var(--chiron-elevated); }

  .mm-result { margin-top: var(--chiron-space-5); padding: var(--chiron-space-4); background: var(--chiron-elevated); border-radius: var(--chiron-radius-md); border-left: 3px solid var(--chiron-accent); }
  .mm-result h4 { margin: 0 0 var(--chiron-space-2); color: var(--chiron-accent); font-family: var(--chiron-font-heading); }
  .mm-result p { margin: var(--chiron-space-2) 0; color: var(--chiron-fg-secondary); }
  .mm-result strong { color: var(--chiron-fg); }`;
}

/** Tiny HTML-escape for emitted strings. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================================
// 5. Convenience: emit everything as three named blocks for assembler
// ============================================================================

export interface EmittedWidget {
  html: string; // goes inside the lesson's <section id="s5">
  css: string; // appended to lesson's <style>
  js: string; // appended to lesson's runtime <script>
}

export function emitMatchMadness(config: MatchMadnessConfig): EmittedWidget {
  const parsed = MatchMadnessConfigSchema.parse(config); // throws on invalid input
  return {
    html: emitMatchMadnessHtml(parsed),
    css: emitMatchMadnessCss(),
    js: emitMatchMadnessJs(parsed),
  };
}
