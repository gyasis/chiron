/*
 * Chiron · Ask — recovering a phrase-coach answer after the connection dropped.
 *
 * A coach run takes one to two minutes; on a phone the screen sleeps or Android suspends the WebView in that time and the
 * stream is lost. The SERVER keeps the run going (server/phrase_runs.py) and keeps its output. This module remembers which
 * request is pending, and when the page comes back (visible / pageshow / online / a reload) asks the server for the answer
 * and shows it in place of the interrupted bubble.
 *
 *   savePending / readPending / clearPending   the marker in localStorage: {text, session, started_at}
 *   splitReply(raw)                            reply text without the hidden blocks, plus the [[SPEAK]] text
 *   renderMarkdownLite(doc, text)              a small DOM-building renderer (textContent only) for the reply text
 *   createRecovery(deps)                       the state machine behind the page events
 *
 * Every piece of reply text goes in through textContent, never innerHTML.
 */

export const PENDING_KEY = 'chiron.ask.phrasePending';
export const PENDING_TTL_MS = 35 * 60 * 1000;      // a little over the server's 30 min retention of a finished run
export const STALL_MS = 15 * 1000;                 // a streaming bubble that has not changed for this long has lost its stream

export function savePending(storage, p) {
  try { storage.setItem(PENDING_KEY, JSON.stringify(p)); } catch (e) { console.warn('[chiron] pending request not saved:', e && e.message || e); }
}
export function readPending(storage) {
  try {
    const p = JSON.parse(storage.getItem(PENDING_KEY) || 'null');
    return p && typeof p.text === 'string' && typeof p.started_at === 'number' ? p : null;
  } catch { return null; }
}
export function clearPending(storage) {
  try { storage.removeItem(PENDING_KEY); } catch { /* storage blocked: nothing to clear */ }
}

const HIDDEN = /```(?:phrase|diagram|related|meta)[^\S\n]*\n[\s\S]*?```/gi;
const SPEAK = /\[\[\s*SPEAK\s*\]\]([\s\S]*?)\[\[\s*\/?\s*SPEAK\s*\]\]/i;

/** The visible text of a raw reply, and the text of its [[SPEAK]] block. */
export function splitReply(raw) {
  const s = String(raw || '');
  const m = SPEAK.exec(s);
  return { text: s.replace(HIDDEN, '').replace(/\[\[\s*SPEAK\s*\]\][\s\S]*?\[\[\s*\/?\s*SPEAK\s*\]\]/gi, '').trim(), speak: m ? m[1].trim() : '' };
}

function inline(doc, parent, line) {
  for (const part of line.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/)) {
    if (!part) continue;
    let node;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) { node = doc.createElement('strong'); node.textContent = part.slice(2, -2); }
    else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) { node = doc.createElement('code'); node.textContent = part.slice(1, -1); }
    else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) { node = doc.createElement('em'); node.textContent = part.slice(1, -1); }
    else node = doc.createTextNode(part);
    parent.appendChild(node);
  }
}

/** Paragraphs, numbered and bulleted lists, **bold**, *italic* and `code`: what the coach's reply uses. */
export function renderMarkdownLite(doc, text) {
  const root = doc.createElement('div');
  root.className = 'ask-md';
  for (const block of String(text || '').trim().split(/\n{2,}/)) {
    const lines = block.split('\n').filter(l => l.trim());
    if (!lines.length) continue;
    const numbered = lines.every(l => /^\s*\d+[.)]\s/.test(l));
    const bullets = lines.every(l => /^\s*[-*•]\s/.test(l));
    if (numbered || bullets) {
      const list = doc.createElement(numbered ? 'ol' : 'ul');
      for (const l of lines) { const li = doc.createElement('li'); inline(doc, li, l.replace(/^\s*(?:\d+[.)]|[-*•])\s+/, '')); list.appendChild(li); }
      root.appendChild(list);
    } else {
      const p = doc.createElement('p');
      lines.forEach((l, i) => { if (i) p.appendChild(doc.createElement('br')); inline(doc, p, l); });
      root.appendChild(p);
    }
  }
  return root;
}

export function threadMsg(doc, role, text) {
  const m = doc.createElement('div');
  m.className = `acolyte-msg ${role}`;
  m.dataset.raw = text;
  const b = doc.createElement('div');
  b.className = 'acolyte-msg-body';
  b.textContent = text;
  m.appendChild(b);
  return m;
}

/**
 * Put the recovered answer where the interrupted one was: in the assistant bubble that follows the pending question. A bubble
 * is created only when there is none (a reload leaves the thread empty), and the question gets one only when it is missing,
 * so a recovery never adds a second copy of either. `bind(msg)` runs the normal phrase / diagram / related binding on it.
 * `speak(text)` is wired to a Listen button on the recovered note and is never called on render.
 */
export function renderRecoveredInto(doc, box, content, pending, { bind, speak, onFirstBubble } = {}) {
  if (!box) return null;
  const kids = () => [...box.children];
  let user = kids().filter(m => m.classList.contains('user') && (m.dataset.raw || '').trim() === pending.text).pop();
  if (!user) {
    if (onFirstBubble) onFirstBubble();
    user = box.appendChild(threadMsg(doc, 'user', pending.text));
  }
  let msg = kids()[kids().indexOf(user) + 1];
  if (!msg || !msg.classList.contains('assistant')) {
    const fresh = threadMsg(doc, 'assistant', '');
    const after = msg || null;
    box.insertBefore(fresh, after);
    msg = fresh;
  }
  let body = msg.querySelector('.acolyte-msg-body');
  if (!body) { body = doc.createElement('div'); body.className = 'acolyte-msg-body'; msg.appendChild(body); }
  for (const c of [...msg.children]) if (c !== body) c.remove();           // the interrupted notice, old actions, old extras
  const { text, speak: speakText } = splitReply(content);
  body.textContent = '';
  body.appendChild(renderMarkdownLite(doc, text));
  const note = doc.createElement('div');
  note.className = 'ask-recovered-note';
  note.textContent = 'Recovered after the connection dropped.';
  body.appendChild(note);
  delete msg.dataset.streaming;
  delete msg.dataset.acts;                                                 // the normal action row is built again
  msg.dataset.raw = content;
  msg.dataset.phraseBound = '1';
  if (bind) bind(msg);
  if (msg.scrollIntoView) msg.scrollIntoView({ block: 'start' });
  if (speak && speakText) {            // a recovered answer is never spoken on its own: the learner taps to hear it
    const listen = doc.createElement('button');
    listen.type = 'button';
    listen.className = 'ask-recovered-listen';
    listen.textContent = 'Listen';
    listen.addEventListener('click', () => speak(speakText));
    note.appendChild(doc.createTextNode(' '));
    note.appendChild(listen);
  }
  return msg;
}

/**
 * The recovery state machine. Dependencies are injected so it can be tested without a browser:
 *   storage, fetchFn(url, init), now(), session()            plain environment
 *   replyState(pending) -> 'complete'|'missing'|'streaming'|'interrupted'    what the page shows for the pending request
 *   lastChangeAt() -> ms timestamp of the last DOM change in the thread (a live stream keeps changing it)
 *   render(content, pending)   puts the recovered answer on the page (once)
 *   status(text|null)          shows or clears "Still working… (Ns)"
 *   pollMs, setTimer, clearTimer
 * check() returns what it did: 'none' | 'expired' | 'complete' | 'live' | 'unknown' | 'other' | 'offline' | 'running' | 'recovered' | 'failed'.
 */
export function createRecovery(d) {
  const pollMs = d.pollMs ?? 3000;
  const setTimer = d.setTimer || ((f, ms) => setTimeout(f, ms));
  const clearTimer = d.clearTimer || (t => clearTimeout(t));
  let busy = false, timer = null, recoveredFor = null;

  async function check() {
    if (busy) return 'busy';
    const p = readPending(d.storage);
    if (!p) return 'none';
    if (d.now() - p.started_at > PENDING_TTL_MS) { clearPending(d.storage); d.status(null); return 'expired'; }
    if (recoveredFor === p.started_at) return 'recovered';
    const st = d.replyState(p);
    if (st === 'complete') { clearPending(d.storage); d.status(null); return 'complete'; }
    if (st === 'streaming' && d.now() - d.lastChangeAt() < STALL_MS) return 'live';
    busy = true;
    try {
      let r;
      try {
        r = await d.fetchFn('/ask/phrase/run/latest', { headers: { 'X-Ask-Session': d.session() } });
      } catch (e) { return schedule('offline'); }          // still offline: the next online/visible event (or poll) tries again
      if (r.status === 404) { d.status(null); return 'unknown'; }
      if (!r.ok) return schedule('unknown');
      const run = await r.json();
      if (run.user !== p.text) { d.status(null); return 'other'; }
      if (run.status === 'done') {
        if (timer) { clearTimer(timer); timer = null; }
        recoveredFor = p.started_at;
        d.status(null);
        d.render(run.content_so_far, p);
        clearPending(d.storage);
        return 'recovered';
      }
      if (run.status === 'running') { d.status(`Still working… (${run.elapsed_s}s)`); return schedule('running'); }
      d.status(`The answer could not be finished: ${run.error || run.status}`);
      clearPending(d.storage);
      return 'failed';
    } finally { busy = false; }
  }

  function schedule(result) {
    if (!timer) timer = setTimer(() => { timer = null; check(); }, pollMs);
    return result;
  }

  return { check, stop() { if (timer) clearTimer(timer); timer = null; } };
}
