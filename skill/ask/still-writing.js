/*
 * Chiron · Ask — a truthful status while a phrase reply is still streaming.
 *
 * The steps panel ("Worked for N s") stops counting when the first text lands, but a phrase reply keeps arriving for
 * a minute or more after that. This is a separate line in the reply area that keeps counting from the moment the
 * question was sent, and turns into the final total when streaming ends. The panel itself is left alone.
 *
 *   stillWriting(doc, msg, bornMs, { now, setTimer, clearTimer })   -> { stop() }
 *     msg      the assistant message element; streaming is over when msg.dataset.streaming !== '1' or it is detached
 *     bornMs   now()-clock time the question was sent
 */

export const TICK_MS = 1000;

export function stillWriting(doc, msg, bornMs, env = {}) {
  const now = env.now || (() => performance.now());
  const setTimer = env.setTimer || ((f, ms) => setInterval(f, ms));
  const clearTimer = env.clearTimer || (t => clearInterval(t));
  const secs = () => Math.max(0, Math.round((now() - bornMs) / 1000));
  const el = doc.createElement('div');
  el.className = 'ask-still-writing';
  el.setAttribute('role', 'status');
  const body = msg.querySelector && msg.querySelector('.acolyte-msg-body');
  if (body && msg.insertBefore) msg.insertBefore(el, body); else msg.appendChild(el);
  let timer = null, closed = false;
  const stop = () => { if (timer != null) clearTimer(timer); timer = null; };
  const tick = () => {
    if (closed) return;
    if (msg.isConnected === false) { closed = true; stop(); return; }     // the thread was re-rendered under it
    if (msg.dataset.streaming !== '1') {         // streaming ended: the final total replaces the running count
      closed = true; stop();
      el.className = 'ask-still-writing done';
      el.textContent = `Reply complete · ${secs()} s in all`;
      return;
    }
    el.textContent = `still writing… ${secs()} s`;
  };
  el.textContent = `still writing… ${secs()} s`;
  timer = setTimer(tick, TICK_MS);
  return { stop, tick, el };
}
