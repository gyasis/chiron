'use strict';
/* Chiron phone — app-level voice tutor ("Chiedi a Lucrezia").
 * Lives in the APP shell, not in the lesson iframe, so it works for streamed lessons AND lessons saved
 * offline (http://lesson.localhost/…), which have no shell/tutor.js. Talks to the Mac over the LAN:
 *   tutor     <LIB host>:8912   GET /tutor-models · POST /tutor-chat · GET /tutor-status/<rid>
 *   voice     <LIB>             POST /api/oral/hear?lang=it|en|auto  (body = recorded audio -> {text})
 *                               POST /api/oral/say {text, lang}      (-> audio/wav, Lucrezia)
 * Uses globals from app.js: LIB, OPEN_SLUG, toast().  Grounding: the lesson slug (+title) is sent; the
 * tutor service reads that lesson's text server-side (tutor_server.slug_text). */
(function () {
  const LSK_MODEL = 'chiron.tutor.model', LSK_SPEAK = 'chiron.tutor.speak', LSK_ASR = 'chiron.tutor.asr', LSK_POS = 'chiron.tutor.btnpos';
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const host = () => { try { return new URL(LIB).hostname; } catch (e) { return ''; } };
  // Tutor base: explicit override (Offline tab "Tutor address" = localStorage chiron.tutor) > the https hub when LIB
  // is the hub (it reverse-proxies /tutor-* to :8912) > http://<LIB host>:8912.
  const tutorBase = () => (lsGet('chiron.tutor', '') || (isHub() ? new URL(LIB).origin : 'http://' + host() + ':8912')).replace(/\/+$/, '');
  const warn = (what, e) => console.warn('chiron tutor-panel: ' + what, e && (e.message || e), { lib: LIB, slug: typeof OPEN_SLUG !== 'undefined' ? OPEN_SLUG : null });

  const css = `
.tp-fab{position:absolute;z-index:45;left:14px;bottom:calc(14px + env(safe-area-inset-bottom));display:flex;align-items:center;gap:8px;border:none;border-radius:99px;
  background:var(--accent);color:#fff;font-family:var(--fh);font-weight:700;font-size:14px;padding:12px 18px 12px 14px;box-shadow:0 6px 20px rgba(0,0,0,.28);touch-action:none;user-select:none;-webkit-user-select:none}
.tp-fab svg{width:20px;height:20px;flex:0 0 auto}
.tp-fab.hide{display:none}
.tp-panel{position:fixed;z-index:50;right:0;bottom:0;left:0;margin:0 auto;width:100%;max-width:720px;height:min(82vh,820px);background:var(--surface);color:var(--fg);
  border-radius:20px 20px 0 0;box-shadow:0 -8px 40px rgba(0,0,0,.3);display:flex;flex-direction:column;transform:translateY(105%);transition:transform .28s cubic-bezier(.2,.7,.2,1);
  padding-bottom:env(safe-area-inset-bottom);font-family:var(--fb)}
.tp-panel.open{transform:none}
@media (min-width:900px){.tp-panel{left:auto;right:18px;bottom:18px;border-radius:20px;height:min(86vh,900px)}}
.tp-head{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:12px 14px 8px}
.tp-head b{font-family:var(--fh);font-weight:800;font-size:15px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tp-head b small{display:block;font-weight:500;font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tp-x{width:38px;height:38px;border-radius:50%;border:none;background:var(--elevated);color:var(--fg);font-size:18px}
.tp-opts{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:0 14px 8px;flex-wrap:wrap}
.tp-opts select{flex:1 1 150px;min-width:0;border:none;background:var(--elevated);color:var(--fg);border-radius:10px;padding:9px 10px;font:inherit;font-size:12.5px}
.tp-chip{border:none;border-radius:99px;background:var(--elevated);color:var(--fg2);font-family:var(--fh);font-weight:700;font-size:12px;padding:9px 13px;white-space:nowrap}
.tp-chip.on{background:var(--accent);color:#fff}
.tp-msgs{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:6px 14px 10px;display:flex;flex-direction:column;gap:9px}
.tp-m{max-width:92%;padding:10px 13px;border-radius:16px;font-size:15px;line-height:1.5;word-break:break-word}
.tp-m.u{align-self:flex-end;background:var(--accent);color:#fff;border-bottom-right-radius:5px}
.tp-m.a{align-self:flex-start;background:var(--elevated);color:var(--fg);border-bottom-left-radius:5px}
.tp-m.a p{margin:0 0 6px}.tp-m.a p:last-child{margin:0}.tp-m.a ul{margin:4px 0 6px 18px;padding:0}
.tp-m.err{align-self:stretch;max-width:100%;background:var(--reviewbg);color:var(--reviewfg);font-size:13.5px}
.tp-m.st{align-self:flex-start;background:none;color:var(--muted);font-size:13px;padding:4px 6px;display:flex;align-items:center;gap:8px}
.tp-m .tp-say{display:inline-block;margin-top:6px;border:none;background:none;color:var(--accent);font-family:var(--fh);font-weight:700;font-size:12px;padding:4px 0}
.tp-tw{overflow-x:auto;margin:4px 0 8px}.tp-m table{border-collapse:collapse;font-size:13px}.tp-m th,.tp-m td{border-bottom:1px solid var(--border);padding:5px 8px;text-align:left;vertical-align:top}.tp-m th{font-family:var(--fh);font-weight:700}
.tp-src{display:inline-block;margin:6px 8px 0 0;font-family:var(--fh);font-weight:700;font-size:11.5px;color:var(--muted);background:var(--surface);border-radius:99px;padding:3px 10px}
.tp-hint{color:var(--muted);font-size:13.5px;text-align:center;padding:26px 14px;line-height:1.55}
.tp-bar{flex:0 0 auto;display:flex;align-items:flex-end;gap:8px;padding:6px 14px 6px}
.tp-bar textarea{flex:1;min-width:0;resize:none;max-height:110px;border:1px solid var(--border);background:var(--bg);color:var(--fg);border-radius:14px;padding:11px 13px;font:inherit;font-size:15px;line-height:1.35}
.tp-send{flex:0 0 auto;width:46px;height:46px;border-radius:50%;border:none;background:var(--accent);color:#fff;font-size:20px}
.tp-send:disabled{opacity:.45}
.tp-mic{flex:0 0 auto;margin:4px 14px 10px;border:none;border-radius:18px;background:var(--elevated);color:var(--fg);font-family:var(--fh);font-weight:800;font-size:16px;padding:20px 16px;
  display:flex;align-items:center;justify-content:center;gap:10px;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
.tp-mic svg{width:26px;height:26px}
.tp-mic.rec{background:#c0392b;color:#fff;animation:tppulse 1s ease-in-out infinite}
.tp-mic:disabled{opacity:.5}
@keyframes tppulse{50%{box-shadow:0 0 0 10px rgba(192,57,43,.22)}}
.tp-stop{display:none;flex:0 0 auto;margin:0 14px 6px;border:none;border-radius:12px;background:var(--ok);color:#fff;font-family:var(--fh);font-weight:700;font-size:14px;padding:12px}
.tp-stop.on{display:block}
`;
  const ICO_MIC = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>';

  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  // ---- DOM
  const fab = document.createElement('button');
  fab.className = 'tp-fab hide'; fab.innerHTML = ICO_MIC + '<span>Chiedi a Lucrezia</span>';
  document.getElementById('lesson').appendChild(fab);

  const panel = document.createElement('div'); panel.className = 'tp-panel'; panel.id = 'tpanel';
  panel.innerHTML = `
  <div class="tp-head"><b><span id="tp-t">Lucrezia</span><small id="tp-sub"></small></b><button class="tp-x" id="tp-close" aria-label="Chiudi">✕</button></div>
  <div class="tp-opts"><select id="tp-model" aria-label="Modello"></select>
    <button class="tp-chip on" id="tp-speak">🔊 Voce</button><button class="tp-chip" id="tp-asr" title="Lingua del microfono">Mic: auto</button></div>
  <div class="tp-msgs" id="tp-msgs"></div>
  <button class="tp-stop" id="tp-stop">⏹ Ferma audio</button>
  <div class="tp-bar"><textarea id="tp-text" rows="1" placeholder="Chiedi qualcosa su questa lezione…"></textarea><button class="tp-send" id="tp-send" aria-label="Invia">➤</button></div>
  <button class="tp-mic" id="tp-mic">${ICO_MIC}<span id="tp-miclab">Tieni premuto per parlare</span></button>`;
  document.body.appendChild(panel);
  const $ = id => document.getElementById(id);
  const msgsEl = $('tp-msgs'), textEl = $('tp-text'), sendBtn = $('tp-send'), micBtn = $('tp-mic'), stopBtn = $('tp-stop');

  // ---- video lessons: the lesson page (scene-report.js) posts {type:'chiron-scene', scene, time} to us
  let NOW = null;
  window.addEventListener('message', ev => {
    const fr = document.getElementById('l-frame');
    if (ev.data && ev.data.type === 'chiron-scene' && fr && ev.source === fr.contentWindow) NOW = { scene: ev.data.scene | 0, time: +ev.data.time || 0, slug: OPEN_SLUG };
  });

  // ---- state
  let convoSlug = null, history = [], busy = false, speakOn = lsGet(LSK_SPEAK, '1') === '1', asrLang = lsGet(LSK_ASR, 'auto');
  const player = new Audio(); player.preload = 'auto';
  const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  $('tp-speak').classList.toggle('on', speakOn);
  const asrLabel = () => { $('tp-asr').textContent = 'Mic: ' + ({ auto: 'auto', it: 'IT', en: 'EN' })[asrLang]; };
  asrLabel();

  // Android WebView only lets media play after a user gesture; a reply arrives seconds later. Playing a
  // silent clip on the SAME element inside the tap unlocks it, so the later src swap + play() is allowed.
  function unlockAudio() { try { player.src = SILENT; const p = player.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }

  // ---- helpers
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  function md(s) {   // tiny, safe renderer: **bold**, *italic*, `code`, bullets, |tables|, paragraphs (all escaped first)
    const inl = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>');
    const out = []; let list = false, tbl = null;
    const flush = () => { if (list) { out.push('</ul>'); list = false; } if (tbl) { out.push('<div class="tp-tw"><table>' + tbl.join('') + '</table></div>'); tbl = null; } };
    for (const raw of s.split('\n')) {
      if (/^\s*\|.*\|\s*$/.test(raw)) {
        const cells = raw.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue;      // header separator row
        if (list) { out.push('</ul>'); list = false; }
        const first = !tbl; if (!tbl) tbl = [];
        tbl.push('<tr>' + cells.map(c => (first ? '<th>' : '<td>') + inl(c) + (first ? '</th>' : '</td>')).join('') + '</tr>');
        continue;
      }
      const m = raw.match(/^\s*[-*•]\s+(.*)/);
      if (m) { if (tbl) flush(); if (!list) { out.push('<ul>'); list = true; } out.push('<li>' + inl(m[1]) + '</li>'); continue; }
      flush();
      const t = raw.replace(/^#{1,6}\s*/, '').trim();
      if (t) out.push('<p>' + inl(t) + '</p>');
    }
    flush();
    return out.join('');
  }
  function addMsg(cls, html) {
    const d = document.createElement('div'); d.className = 'tp-m ' + cls; d.innerHTML = html;
    const hint = msgsEl.querySelector('.tp-hint'); if (hint) hint.remove();
    msgsEl.appendChild(d);
    if (cls === 'a') msgsEl.scrollTop = d.offsetTop - 8; else msgsEl.scrollTop = msgsEl.scrollHeight;   // read an answer from its top
    return d;
  }
  function showErr(text, e, what) { if (e) warn(what || text, e); addMsg('err', esc(text)); }
  const lessonTitle = () => ($('l-title') && $('l-title').textContent) || '';
  const isItalianLesson = () => /italian|italiano|pimsleur|language|ordine-dei-medici|medico-chirurgo/i.test((typeof OPEN_SLUG !== 'undefined' && OPEN_SLUG) || '');
  function guessLang(t) {
    const it = (t.match(/\b(il|lo|la|le|gli|di|che|è|per|con|una|un|del|della|non|sono|nel|alla|come|anche|dei|delle)\b/gi) || []).length;
    const en = (t.match(/\b(the|and|of|is|are|to|with|for|that|this|in|on|as|it|you|can|what)\b/gi) || []).length;
    return it > en ? 'it' : 'en';
  }
  function netMsg(e, what) {
    if (e && e.name === 'TypeError') return `Mac non raggiungibile (${host() || 'indirizzo non valido'}) — ${what}. Il Mac è acceso e sullo stesso wifi?`;
    return `${what}: ${e && e.message ? e.message : e}`;
  }

  // ---- open / close
  function resetIfNewLesson() {
    if (convoSlug === OPEN_SLUG) return;
    convoSlug = OPEN_SLUG; history = []; msgsEl.innerHTML = '';
    msgsEl.innerHTML = `<div class="tp-hint">Chiedi a Lucrezia di spiegarti qualcosa di <b>questa lezione</b>.<br>Scrivi, oppure tieni premuto il microfono e parla.</div>`;
    $('tp-sub').textContent = lessonTitle();
  }
  function openPanel() { resetIfNewLesson(); panel.classList.add('open'); fab.classList.add('hide'); loadModels(); }
  function closePanel() { panel.classList.remove('open'); stopSpeaking(); if (document.getElementById('lesson').classList.contains('open')) fab.classList.remove('hide'); }
  $('tp-close').onclick = closePanel;

  // FAB visibility follows the lesson overlay (class toggled by app.js openLesson/closeLesson).
  new MutationObserver(() => {
    const open = document.getElementById('lesson').classList.contains('open');
    if (!open) { panel.classList.remove('open'); stopSpeaking(); }
    fab.classList.toggle('hide', !open || panel.classList.contains('open'));
  }).observe(document.getElementById('lesson'), { attributes: true, attributeFilter: ['class'] });

  // FAB: tap opens, drag moves it (so it can be parked off a lesson's own controls); position persists.
  (function () {
    let sx, sy, ox, oy, moved = false, dragging = false;
    try { const p = JSON.parse(lsGet(LSK_POS, 'null')); if (p) { fab.style.left = p.l + 'px'; fab.style.bottom = 'auto'; fab.style.top = p.t + 'px'; } } catch (e) {}
    fab.addEventListener('pointerdown', e => { dragging = true; moved = false; sx = e.clientX; sy = e.clientY; const r = fab.getBoundingClientRect(), pr = fab.parentElement.getBoundingClientRect(); ox = r.left - pr.left; oy = r.top - pr.top; fab.setPointerCapture(e.pointerId); });
    fab.addEventListener('pointermove', e => {
      if (!dragging) return; const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 10) return; moved = true;
      const pr = fab.parentElement.getBoundingClientRect();
      const l = Math.max(4, Math.min(ox + dx, pr.width - fab.offsetWidth - 4)), t = Math.max(4, Math.min(oy + dy, pr.height - fab.offsetHeight - 4));
      fab.style.left = l + 'px'; fab.style.top = t + 'px'; fab.style.bottom = 'auto';
    });
    fab.addEventListener('pointerup', e => {
      dragging = false;
      if (moved) { lsSet(LSK_POS, JSON.stringify({ l: parseFloat(fab.style.left), t: parseFloat(fab.style.top) })); return; }
      openPanel();
    });
  })();

  // ---- models
  let modelsLoaded = false;
  async function loadModels() {
    if (modelsLoaded) return;
    const sel = $('tp-model');
    try {
      const r = await fetch(tutorBase() + '/tutor-models');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const groups = {};
      (d.models || []).forEach(m => { (groups[m.group || 'Cloud'] = groups[m.group || 'Cloud'] || []).push(m); });
      sel.innerHTML = '';
      Object.keys(groups).forEach(g => { const og = document.createElement('optgroup'); og.label = g;
        groups[g].forEach(m => { const o = document.createElement('option'); o.value = m.id; o.textContent = m.label || m.id; og.appendChild(o); }); sel.appendChild(og); });
      const saved = lsGet(LSK_MODEL, ''), ids = (d.models || []).map(m => m.id);
      sel.value = ids.includes(saved) ? saved : (d.default || ids[0] || '');
      modelsLoaded = true;
    } catch (e) {
      sel.innerHTML = '<option value="">modello: predefinito del Mac</option>';
      showErr(netMsg(e, 'elenco modelli non caricato'), e, 'tutor-models');
    }
  }
  $('tp-model').onchange = e => lsSet(LSK_MODEL, e.target.value);
  $('tp-speak').onclick = e => { speakOn = !speakOn; lsSet(LSK_SPEAK, speakOn ? '1' : '0'); e.currentTarget.classList.toggle('on', speakOn); if (!speakOn) stopSpeaking(); };
  $('tp-asr').onclick = () => { asrLang = ({ auto: 'it', it: 'en', en: 'auto' })[asrLang]; lsSet(LSK_ASR, asrLang); asrLabel(); };

  // ---- ask the tutor
  async function ask(text) {
    text = (text || '').trim(); if (!text || busy) return;
    busy = true; sendBtn.disabled = true; unlockAudio(); stopSpeaking(true);
    textEl.value = ''; textEl.style.height = 'auto';
    history.push({ role: 'user', content: text }); addMsg('u', esc(text));
    const rid = 'ph' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const stEl = addMsg('st', '<span class="spinc"></span><span class="stt">Lucrezia sta pensando…</span>');
    const poll = setInterval(async () => {
      try { const d = await (await fetch(tutorBase() + '/tutor-status/' + rid)).json(); const ev = d.events || [];
        if (ev.length) stEl.querySelector('.stt').textContent = ev[ev.length - 1].text; } catch (e) { /* status is cosmetic */ }
    }, 900);
    try {
      const body = { lesson_slug: OPEN_SLUG || '', section_id: '', section_text: '', selection: '',
        messages: history.slice(-8), model: $('tp-model').value || undefined,
        mode: isItalianLesson() ? 'ita' : 'med', lang: guessLang(text), rid };
      if (NOW && NOW.slug === OPEN_SLUG) { body.lesson_time = NOW.time; body.scene = NOW.scene; }   // video lesson: current scene
      const r = await fetch(tutorBase() + '/tutor-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      let d = null; try { d = await r.json(); } catch (e) {}
      if (!r.ok || !d || d.error || !d.reply) throw new Error((d && d.error) || ('HTTP ' + r.status));
      stEl.remove(); history.push({ role: 'assistant', content: d.reply });
      const src = d.source || (d.mode === 'ita' ? 'page' : '');   // top-level field of /tutor-chat
      let lab = src === 'scene' ? '🎬 dalla scena' : src === 'page' ? (d.grounded ? '📄 dalla lezione' : '📄 risposta generale') : src === 'textbook' ? "📚 Harrison's"
        : src === 'web' ? '🌐 web' : src === 'agent' ? '🔎 agente' : '';
      if (!lab) { lab = '❔ fonte sconosciuta'; warn('answer without a known source', d); }
      const box = addMsg('a', md(d.reply) + `<div class="tp-src" data-src="${esc(src || 'unknown')}">${esc(lab)}</div>` + '<button class="tp-say">🔊 Ascolta</button>');
      box.querySelector('.tp-say').onclick = () => { unlockAudio(); speak(d.reply); };
      if (speakOn) speak(d.reply);
    } catch (e) {
      stEl.remove(); history.pop();
      showErr(netMsg(e, 'il tutor non ha risposto'), e, '/tutor-chat');
    } finally { clearInterval(poll); busy = false; sendBtn.disabled = false; }
  }
  sendBtn.onclick = () => ask(textEl.value);
  textEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(textEl.value); } });
  textEl.addEventListener('input', () => { textEl.style.height = 'auto'; textEl.style.height = Math.min(textEl.scrollHeight, 110) + 'px'; });

  // ---- voice OUT
  function speakable(md0) {   // plain, bounded text for TTS: no markdown/tables/sources; <= ~450 chars (TTS ≈ 1 s per 40 chars on the Mac) at a sentence end
    let t = md0.split(/\n\s*Sources?:/i)[0].replace(/\|/g, ' ').replace(/[*_`#>]+/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^\s*[-•]\s+/gm, '').replace(/\s*\n+\s*/g, '. ').replace(/\.\s*\./g, '.').trim();
    if (t.length > 450) { const cut = t.slice(0, 450), i = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! ')); t = i > 150 ? cut.slice(0, i + 1) : cut; }
    return t;
  }
  let speakTok = 0, curUrl = null;
  function stopSpeaking(silent) { speakTok++; try { player.pause(); } catch (e) {} if (curUrl) { URL.revokeObjectURL(curUrl); curUrl = null; } stopBtn.classList.remove('on'); }
  async function speak(text) {
    const t = speakable(text); if (!t) return;
    const tok = ++speakTok; stopBtn.textContent = '⏳ Preparo la voce…'; stopBtn.classList.add('on');
    try {
      const r = await fetch(LIB + '/api/oral/say', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t, lang: guessLang(t) }) });
      if (!r.ok) throw new Error('TTS HTTP ' + r.status + ' ' + (await r.text()).slice(0, 120));
      const blob = await r.blob(); if (tok !== speakTok) return;
      if (curUrl) URL.revokeObjectURL(curUrl);
      curUrl = URL.createObjectURL(blob); player.src = curUrl;
      player.onended = () => { if (tok === speakTok) stopSpeaking(); };
      stopBtn.textContent = '⏹ Ferma audio';
      await player.play();
    } catch (e) {
      if (tok === speakTok) { stopSpeaking(); showErr(netMsg(e, 'voce non riprodotta (TTS)'), e, '/api/oral/say'); }
    }
  }
  stopBtn.onclick = () => stopSpeaking();

  // ---- voice IN (hold to talk)
  let rec = null, stream = null, chunks = [], recStart = 0, wantStop = false, starting = false;
  const pickMime = () => (['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m))) || '';
  function micErr(e) {
    const n = e && e.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'Microfono negato — consenti il microfono in Impostazioni → App → Chiron → Autorizzazioni.';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Nessun microfono trovato su questo dispositivo.';
    if (n === 'NotReadableError') return 'Il microfono è in uso da un’altra app.';
    return 'Microfono non disponibile: ' + (e && e.message || e);
  }
  async function micStart() {
    if (busy || starting || rec) return;
    unlockAudio(); stopSpeaking(true);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { showErr('Registrazione non supportata in questa WebView (contesto non sicuro o MediaRecorder assente).', null); return; }
    starting = true; wantStop = false;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { starting = false; showErr(micErr(e), e, 'getUserMedia'); return; }
    starting = false;
    if (wantStop) { stream.getTracks().forEach(t => t.stop()); stream = null; toast('Tieni premuto mentre parli'); return; }   // released during the permission prompt
    const mime = pickMime(); chunks = [];
    try { rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
    catch (e) { stream.getTracks().forEach(t => t.stop()); stream = null; showErr('Registrazione non avviata: ' + e.message, e, 'MediaRecorder'); return; }
    rec.ondataavailable = ev => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    rec.onstop = onRecorded; rec.start(); recStart = Date.now();
    micBtn.classList.add('rec'); $('tp-miclab').textContent = 'Sto ascoltando… rilascia per inviare';
  }
  function micStop() {
    wantStop = true;
    if (rec && rec.state !== 'inactive') rec.stop();
  }
  async function onRecorded() {
    const mime = (rec && rec.mimeType) || 'audio/webm', ms = Date.now() - recStart; rec = null;
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    micBtn.classList.remove('rec'); $('tp-miclab').textContent = 'Tieni premuto per parlare';
    const blob = new Blob(chunks, { type: mime });
    if (ms < 500 || blob.size < 1000) { toast('Troppo breve — tieni premuto mentre parli'); return; }
    micBtn.disabled = true; $('tp-miclab').textContent = 'Trascrivo…';
    try {
      const r = await fetch(LIB + '/api/oral/hear?lang=' + asrLang, { method: 'POST', headers: { 'Content-Type': mime }, body: blob });
      if (!r.ok) throw new Error('ASR HTTP ' + r.status + ' ' + (await r.text()).slice(0, 140));
      const d = await r.json(); const txt = (d.text || '').trim();
      if (!txt) { showErr('Non ho capito niente — riprova più vicino al microfono.' + (d.note ? ' (' + d.note + ')' : ''), null); return; }
      textEl.value = txt; ask(txt);
    } catch (e) { showErr(netMsg(e, 'trascrizione non riuscita (ASR)'), e, '/api/oral/hear'); }
    finally { micBtn.disabled = false; $('tp-miclab').textContent = 'Tieni premuto per parlare'; }
  }
  micBtn.addEventListener('pointerdown', e => { e.preventDefault(); micBtn.setPointerCapture(e.pointerId); micStart(); });
  micBtn.addEventListener('pointerup', micStop);
  micBtn.addEventListener('pointercancel', micStop);
  micBtn.addEventListener('contextmenu', e => e.preventDefault());

  window.ChironTutorPanel = { open: openPanel, close: closePanel, ask, speak, player };   // test/debug hook
})();
