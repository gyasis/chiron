'use strict';
/* "Riprendi" — one learner, many screens. The hub slot now-studying/cur = {lesson, anchor, scroll, title, section, ts, from}
 * (relayed by chiron-server :8911 → hub progress API). Reads it into a Library banner ("Dal web: … — Riprendi") and writes
 * the phone's own reading position (reported by shell/handoff.js inside the lesson iframe) so the web can show the reverse.
 * Uses app.js globals: askBase, LESSONS, OPEN_SLUG, openLesson, slugOf, toast. */
(function () {
  const SLOT = () => askBase() + '/api/progress/now-studying';   // plain-HTTP :8911 even when LIB is the https hub (WebView refuses its cert)
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  let lastPos = null, banner = null, timer = 0;

  async function read() {
    const r = await fetch(SLOT(), { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status);
    const en = (await r.json()).entries || {}, cur = en.cur && en.cur.v, pin = en.pin && en.pin.v;
    // A deliberate hand-off ("pin", ≤30 min old) beats automatic position reports from other open screens.
    const p = pin && pin.lesson && Date.now() - pin.ts < 30 * 60000 ? pin : cur; return p && p.lesson ? p : null;
  }
  async function write(p, explicit) {
    const entries = explicit ? { cur: { v: p, t: p.ts }, pin: { v: p, t: p.ts } } : { cur: { v: p, t: p.ts } };
    const r = await fetch(SLOT(), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
  }
  const ago = ts => { const m = Math.max(0, Math.round((Date.now() - ts) / 60000)); return m < 1 ? 'adesso' : m < 60 ? m + ' min fa' : m < 1440 ? Math.round(m / 60) + ' h fa' : Math.round(m / 1440) + ' g fa'; };
  const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function show(p) {
    if (!banner) {
      banner = document.createElement('div'); banner.id = 'hf-banner';
      banner.setAttribute('style', 'display:flex;align-items:center;gap:10px;margin:0 0 10px;padding:10px 12px;border-radius:12px;background:var(--medbg);color:var(--fg);font-size:12.5px;border:1px solid var(--elevated)');
      const anchor = document.getElementById('offbanner') || document.getElementById('rows'); anchor.parentNode.insertBefore(banner, anchor);
    }
    const where = p.from === 'web' ? 'Dal web' : 'Dal telefono';
    banner.innerHTML = `<div style="flex:1;min-width:0"><div style="color:var(--muted);font-size:11px">${where} · ${ago(p.ts)}</div>
      <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.title)}${p.section ? ' § ' + esc(p.section) : ''}</div></div>
      <button id="hf-go" class="hbtn" style="font-weight:600;color:var(--med)">Riprendi</button><button id="hf-x" class="hbtn" aria-label="Chiudi">✕</button>`;
    banner.style.display = 'flex';
    banner.querySelector('#hf-go').onclick = () => { banner.style.display = 'none'; ls.set('chiron.hf.dismissed', String(p.ts));
      const a = String(p.anchor || '').replace(/[^\w.-]/g, '');
      openLesson(slugOf(p.lesson), a ? '#' + a : (p.scroll > 0 ? '#sf=' + p.scroll : ''), p.lesson); };
    banner.querySelector('#hf-x').onclick = () => { banner.style.display = 'none'; ls.set('chiron.hf.dismissed', String(p.ts)); };
  }
  async function poll() {
    try {
      const p = await read();
      if (p && p.from !== 'phone' && p.ts > +(ls.get('chiron.hf.dismissed') || 0)) show(p);
      else if (banner) banner.style.display = 'none';
    } catch (e) { console.warn('chiron handoff: could not read the slot —', e.message); }
  }

  // position reports from the lesson iframe (shell/handoff.js, ?inapp=1) — already throttled to section changes + pauses
  window.addEventListener('message', ev => {
    const fr = document.getElementById('l-frame'); const d = ev.data;
    if (!d || d.type !== 'chiron-handoff:pos' || !fr || ev.source !== fr.contentWindow || typeof d.lesson !== 'string') return;
    lastPos = { lesson: d.lesson, anchor: String(d.anchor || ''), section: String(d.section || ''), scroll: +d.scroll || 0, title: String(d.title || ''), ts: Date.now(), from: 'phone' };
    ls.set('chiron.hf.dismissed', String(lastPos.ts));   // our own report is not something to be offered back
    write(lastPos).catch(e => console.warn('chiron handoff: could not save position —', e.message));
  });

  window.ChironHandoff = {
    async toWeb() {
      const slug = typeof OPEN_SLUG !== 'undefined' ? OPEN_SLUG : null; if (!slug) return;
      const l = LESSONS.find(x => slugOf(x.id) === slug);
      const p = lastPos && slugOf(lastPos.lesson) === slug ? { ...lastPos, ts: Date.now() }
        : { lesson: l ? l.id : slug, anchor: '', section: '', scroll: 0, title: l ? l.title.replace(/^Chiron\s*·\s*/, '') : slug, ts: Date.now(), from: 'phone' };
      try { await write(p, true); toast('Salvato — riprendi sul web'); } catch (e) { toast('Non salvato: ' + e.message); }
    }, poll,
  };
  const tick = () => { if (!document.hidden) poll(); };
  document.addEventListener('visibilitychange', tick); window.addEventListener('focus', tick);
  setTimeout(poll, 1500); timer = setInterval(tick, 30000);
})();
