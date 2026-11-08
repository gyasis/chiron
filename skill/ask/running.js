/*
 * Chiron · the "N running" pill: what the server is working on, from GET /running, on every page.
 *
 *   mountRunning(doc, host, { base, fetchJson, setTimer, clearTimer, now })  -> { refresh(), el, stop() }
 *     host       the element the pill is appended to
 *     base       server origin ('' on pages the server serves)
 *
 * The list lives on the server, so a page closed and opened again shows the same jobs. The pill polls every
 * BUSY_MS while something runs and every IDLE_MS otherwise; it is hidden when nothing runs and nothing finished
 * recently. All model text goes through textContent.
 */

export const BUSY_MS = 5000;
export const IDLE_MS = 30000;
const ICON = { lesson: '📘', pimsleur: '🎧', phrase: '💬', drill: '🔁', dictation: '✍' };
const DONE = { ready: '✓', published: '✓', done: '✓', error: '⚠', 'audio-failed': '⚠', cancelled: '✕' };

export function clock(s) {
  if (s == null || s < 0) return '';
  const m = Math.floor(s / 60), h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} min` : m ? `${m} min ${s % 60} s` : `${s} s`;
}

export function pillText(d) {
  if (d.count) return `⏳ ${d.count} running`;
  if (d.recent && d.recent.length) return `✓ ${d.recent.length} finished`;
  return '';
}

export function mountRunning(doc, host, env = {}) {
  const base = env.base || '';
  const fetchJson = env.fetchJson || (async url => { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
  const setTimer = env.setTimer || ((f, ms) => setTimeout(f, ms));
  const clearTimer = env.clearTimer || (t => clearTimeout(t));
  const now = env.now || (() => Date.now() / 1000);

  const wrap = doc.createElement('div');
  wrap.className = 'chiron-running';
  const pill = doc.createElement('button');
  pill.type = 'button';
  pill.className = 'chiron-running-pill';
  pill.hidden = true;
  const list = doc.createElement('div');
  list.className = 'chiron-running-list';
  list.hidden = true;
  wrap.appendChild(pill);
  wrap.appendChild(list);
  host.appendChild(wrap);
  pill.addEventListener('click', () => { list.hidden = !list.hidden; });

  let last = { items: [], recent: [], count: 0, at: now() }, timer = null, stopped = false;

  const row = (icon, title, detail, link) => {
    const r = doc.createElement(link ? 'a' : 'div');
    r.className = 'chiron-running-row';
    if (link) r.href = base + link;
    const t = doc.createElement('div'); t.className = 'crr-t'; t.textContent = `${icon} ${title}`;
    const d = doc.createElement('div'); d.className = 'crr-d'; d.textContent = detail;
    r.appendChild(t); r.appendChild(d);
    return r;
  };

  const render = () => {
    const d = last, drift = Math.max(0, Math.round(now() - d.at));     // count up between polls
    pill.textContent = pillText(d);
    pill.hidden = !pill.textContent;
    if (pill.hidden) list.hidden = true;
    list.textContent = '';
    for (const it of d.items || []) {
      const secs = it.elapsed_s == null ? null : it.elapsed_s + drift;
      list.appendChild(row(ICON[it.kind] || '•', it.title, [it.detail, clock(secs)].filter(Boolean).join(' · '), it.link));
    }
    for (const it of d.recent || []) {
      const ago = Math.max(0, Math.round(now() - it.finished));
      list.appendChild(row(DONE[it.status] || '•', it.title, `${it.status} · ${clock(ago)} ago`, it.link));
    }
  };

  const refresh = async () => {
    try {
      last = await fetchJson(`${base}/running`);
      last.at = now();
      pill.title = '';
    } catch (e) {
      console.warn('[chiron] running jobs not loaded:', e && e.message || e);
      pill.title = `Could not reach the server: ${e && e.message || e}`;
    }
    render();
    return last;
  };

  const loop = async () => {
    if (stopped) return;
    await refresh();
    if (!stopped) timer = setTimer(loop, last.count ? BUSY_MS : IDLE_MS);
  };
  loop();
  return { refresh, render, el: wrap, stop: () => { stopped = true; if (timer != null) clearTimer(timer); } };
}
