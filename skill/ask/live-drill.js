/*
 * Chiron · Ask — the live Pimsleur drill player.
 *
 *   openLiveDrill(sentences, { fetchImpl })   sentences: [{it, en}]. Starts POST /api/pimsleur/live, then plays the steps
 *                                              each line carries (narrator cue, Italian at 100/75/50%, the answer pause)
 *                                              while the server keeps making the later lines.
 *
 * The server hands over ready-to-play steps ({kind, text, url, dur, pause, speed}); this module never computes a pause.
 * One HTMLAudioElement plays everything. The English of a line is only ever shown, never spoken. Texts go in through
 * textContent. While a drill plays the screen is kept awake (Screen Wake Lock, when the browser has it) and, when the app
 * returns from the background, the state is fetched again and playback resumes.
 */

const POLL_MS = 1500;
const TICK_MS = 100;
const FAIL_SHOW_MS = 2500;
const SPEED_LABEL = s => `${Math.round((s || 1) * 100)}%`;
let OPEN = null;     // the one drill panel that can be open; opening another stops it

function el(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** A 0.1 s silent WAV: played inside the click so the browser lets later, script-started plays through. */
function silentWavUrl() {
  const n = 2400, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, 24000, true); v.setUint32(28, 48000, true); v.setUint16(32, 2, true);
  v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

export function openLiveDrill(sentences, { doc = document, fetchImpl = fetch } = {}) {
  if (OPEN) OPEN.stop();
  const lines0 = sentences.filter(p => p && p.it).slice(0, 12).map(p => ({ it: p.it, en: p.en || '' }));
  if (!lines0.length) return null;

  const audio = new Audio();
  audio.src = silentWavUrl();
  audio.play().catch(() => {});                    // unlock inside the user's click

  /* ─── panel ─── */
  const veil = el(doc, 'div', 'ld-veil');
  const card = el(doc, 'div', 'ld-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Live Pimsleur drill');
  const head = el(doc, 'div', 'ld-head');
  const progress = el(doc, 'strong', 'ld-progress', `Line 1 of ${lines0.length}`);
  const prep = el(doc, 'span', 'ld-prep');
  const close = el(doc, 'button', 'ld-x', '✕');
  close.type = 'button'; close.setAttribute('aria-label', 'Stop and close');
  head.append(progress, prep, close);
  const dots = el(doc, 'div', 'ld-dots');
  const it = el(doc, 'p', 'ld-it', lines0[0].it);
  const en = el(doc, 'p', 'ld-en', lines0[0].en);
  const meta = el(doc, 'div', 'ld-meta');
  const speed = el(doc, 'span', 'ld-speed');
  const cue = el(doc, 'span', 'ld-cue');
  meta.append(speed, cue);
  const turn = el(doc, 'div', 'ld-turn');
  const turnText = el(doc, 'span', 'ld-turn-text', 'Your turn — say it');
  const bar = el(doc, 'div', 'ld-bar'), fill = el(doc, 'div', 'ld-fill');
  bar.appendChild(fill);
  turn.append(turnText, bar);
  const msg = el(doc, 'p', 'ld-msg');
  const ctl = el(doc, 'div', 'ld-ctl');
  const mk = (label, aria) => { const b = el(doc, 'button', 'ld-btn', label); b.type = 'button'; b.setAttribute('aria-label', aria); return b; };
  const bPause = mk('⏸ Pause', 'Pause'), bReplay = mk('↺ Replay', 'Replay this line'), bSkip = mk('⏭ Next', 'Skip to the next line'), bStop = mk('■ Stop', 'Stop');
  ctl.append(bPause, bReplay, bSkip, bStop);
  card.append(head, dots, it, en, meta, turn, msg, ctl);
  veil.appendChild(card);
  doc.body.appendChild(veil);
  turn.style.visibility = 'hidden';

  /* ─── state ─── */
  const S = {
    sid: null, n: lines0.length, lines: lines0.map((l, i) => ({ i, ...l, state: 'queued', steps: [] })),
    k: 0, paused: false, stopped: false, epoch: 0, jump: null, prepSince: Date.now(), resumeAudio: false,
  };
  const waiters = new Set();
  let wake = null, pollTimer = null, tickTimer = null;

  const interrupt = () => { S.epoch++; for (const f of [...waiters]) f(); };
  class Interrupted extends Error {}
  const guard = ep => { if (ep !== S.epoch || S.stopped) throw new Interrupted(); };

  /** Resolves after ms of un-paused time (deadline-based, so a throttled background tab catches up), or on interrupt. */
  function waitFor(ms, onTick) {
    const ep = S.epoch;
    return new Promise((res, rej) => {
      let left = ms, last = Date.now();
      const done = () => { clearInterval(t); waiters.delete(done); (ep !== S.epoch || S.stopped) ? rej(new Interrupted()) : res(); };
      const t = setInterval(() => {
        const now = Date.now();
        if (!S.paused) left -= now - last;
        last = now;
        if (onTick) onTick(Math.max(0, left) / ms);
        if (left <= 0) done();
      }, TICK_MS);
      waiters.add(done);
    });
  }

  function playClip(url) {
    const ep = S.epoch;
    return new Promise((res, rej) => {
      const fin = (err) => { audio.onended = audio.onerror = null; waiters.delete(abort); err ? rej(err) : res(); };
      const abort = () => { audio.pause(); fin(new Interrupted()); };
      waiters.add(abort);
      audio.onended = () => fin();
      audio.onerror = () => fin(new Error(`audio would not load: ${url}`));
      audio.src = url;
      S.resumeAudio = true;
      if (!S.paused) startAudio();
      guard(ep);
    });
  }

  function startAudio() {
    audio.play().catch(e => {
      if (e && e.name === 'AbortError') return;
      S.paused = true;
      setPauseUi();
      say('The browser blocked playback. Tap Resume.');
      console.warn('[chiron] live drill: play() refused:', e && e.message || e);
    });
  }

  /* ─── ui ─── */
  const say = t => { msg.textContent = t || ''; };
  function setPauseUi() { bPause.textContent = S.paused ? '▶ Resume' : '⏸ Pause'; bPause.setAttribute('aria-label', S.paused ? 'Resume' : 'Pause'); }
  function showLine() {
    const l = S.lines[S.k];
    progress.textContent = `Line ${S.k + 1} of ${S.n}`;
    it.textContent = l.it; en.textContent = l.en;
  }
  function renderDots() {
    dots.textContent = '';
    for (const l of S.lines) {
      const d = el(doc, 'span', `ld-dot ${l.state}${l.i === S.k ? ' cur' : ''}`);
      d.title = `${l.i + 1}: ${l.state}`;
      dots.appendChild(d);
    }
  }
  function renderPrep() {
    const cur = S.lines[S.k], nxt = S.lines[S.k + 1];
    const waiting = (cur && cur.state !== 'ready' && cur.state !== 'failed') || (nxt && nxt.state !== 'ready' && nxt.state !== 'failed');
    if (!waiting) { prep.textContent = ''; S.prepSince = null; return; }
    if (!S.prepSince) S.prepSince = Date.now();
    prep.textContent = ` · preparing… ${Math.round((Date.now() - S.prepSince) / 1000)}s`;
  }

  /* ─── server ─── */
  async function poll() {
    if (!S.sid || S.stopped) return;
    try {
      const r = await fetchImpl(`/api/pimsleur/live/${S.sid}`);
      const d = await r.json();
      if (!r.ok || !d.lines) throw new Error(d.error || `HTTP ${r.status}`);
      for (const l of d.lines) S.lines[l.i] = { ...S.lines[l.i], ...l };
      if (wake) wake();
    } catch (e) {
      console.warn('[chiron] live drill poll failed:', e && e.message || e);
    }
    renderDots(); renderPrep();
    clearTimeout(pollTimer);
    if (!S.stopped && S.lines.some(l => l.state === 'queued' || l.state === 'making')) pollTimer = setTimeout(poll, POLL_MS);
  }

  /* ─── wake lock ─── */
  let lock = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator && !lock && !S.stopped) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); } }
    catch (e) { console.warn('[chiron] wake lock unavailable:', e && e.message || e); }
  }
  function releaseAwake() { try { if (lock) lock.release(); } catch (e) { /* already released */ } lock = null; }

  /* ─── the player ─── */
  async function lineReady(k) {
    const ep = S.epoch;
    while (!['ready', 'failed'].includes(S.lines[k].state)) {
      guard(ep);
      await new Promise(res => { wake = res; waiters.add(res); });
      waiters.delete(wake); wake = null;
    }
    guard(ep);
  }

  async function playLine(k) {
    const ep = S.epoch, l = S.lines[k];
    if (l.state === 'failed') {
      say(`Line ${k + 1} failed: ${l.error || 'unknown error'}`);
      await waitFor(FAIL_SHOW_MS);
      return;
    }
    say('');
    for (const st of l.steps) {
      guard(ep);
      cue.textContent = st.kind === 'cue' ? st.text : '';
      speed.textContent = st.kind === 'say' ? `Playing at ${SPEED_LABEL(st.speed)}` : 'Narrator';
      speed.className = 'ld-speed' + (st.kind === 'say' ? ' say' : '');
      turn.style.visibility = 'hidden';
      await playClip(st.url);
      guard(ep);
      if (st.kind === 'say' && st.pause > 0) {
        speed.textContent = '';
        turn.style.visibility = 'visible';
        fill.style.width = '100%';
        await waitFor(st.pause * 1000, f => { fill.style.width = `${(f * 100).toFixed(1)}%`; });
        turn.style.visibility = 'hidden';
      } else if (st.pause > 0) {
        await waitFor(st.pause * 1000);
      }
    }
  }

  async function run() {
    while (!S.stopped && S.k < S.n) {
      showLine(); renderDots(); renderPrep();
      try {
        await lineReady(S.k);
        await playLine(S.k);
        S.k++;
      } catch (e) {
        if (!(e instanceof Interrupted)) {
          console.error('[chiron] live drill step failed:', e);
          say(`Line ${S.k + 1}: ${e && e.message || e}`);
          await new Promise(r => setTimeout(r, FAIL_SHOW_MS));
          S.k++;
        } else if (S.jump != null) {
          S.k = Math.max(0, S.jump); S.jump = null;
        }
      }
    }
    if (S.stopped) return;
    S.k = S.n - 1; cue.textContent = ''; speed.textContent = ''; turn.style.visibility = 'hidden';
    progress.textContent = `Done · ${S.n} line${S.n === 1 ? '' : 's'}`;
    prep.textContent = '';
    say(S.lines.some(l => l.state === 'failed') ? 'Finished. Some lines could not be made.' : 'Finished.');
    releaseAwake();
  }

  /* ─── controls ─── */
  function stop() {
    if (S.stopped) return;
    S.stopped = true;
    interrupt();
    clearTimeout(pollTimer); clearInterval(tickTimer);
    audio.pause(); audio.removeAttribute('src');
    releaseAwake();
    doc.removeEventListener('visibilitychange', onVisible);
    veil.remove();
    if (OPEN === api) OPEN = null;
  }
  bStop.addEventListener('click', stop);
  close.addEventListener('click', stop);
  bPause.addEventListener('click', () => {
    S.paused = !S.paused; setPauseUi();
    if (S.paused) audio.pause(); else if (S.resumeAudio && !audio.ended && audio.src) startAudio();
    say('');
  });
  bReplay.addEventListener('click', () => { S.jump = S.k; S.paused = false; setPauseUi(); interrupt(); });
  bSkip.addEventListener('click', () => { S.jump = Math.min(S.n, S.k + 1); S.paused = false; setPauseUi(); interrupt(); });

  function onVisible() {
    if (doc.visibilityState !== 'visible' || S.stopped) return;
    keepAwake();
    poll();
    if (!S.paused && S.resumeAudio && audio.paused && !audio.ended && audio.src) startAudio();
  }
  doc.addEventListener('visibilitychange', onVisible);

  const api = { stop, state: S, el: veil };
  OPEN = api;
  keepAwake();
  setPauseUi(); showLine(); renderDots();
  tickTimer = setInterval(renderPrep, 1000);

  (async () => {
    try {
      const r = await fetchImpl('/api/pimsleur/live', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sentences: lines0 }) });
      const d = await r.json();
      if (!r.ok || !d.id) throw new Error(d.error || `HTTP ${r.status}`);
      S.sid = d.id;
      await poll();
      run();
    } catch (e) {
      console.error('[chiron] live drill could not start:', e);
      say(`Could not start the drill: ${e && e.message || e}`);
      prep.textContent = '';
    }
  })();
  return api;
}
