'use strict';
/* Chiron phone — app-level voice tutor ("Chiedi a Lucrezia").
 * Lives in the APP shell, not in the lesson iframe, so it works for streamed lessons AND lessons saved
 * offline (http://lesson.localhost/…), which have no shell/tutor.js. Talks to the Mac over the LAN:
 *   tutor     <LIB host>:8912   GET /tutor-models · POST /tutor-chat · GET /tutor-status/<rid>
 *   voice     <LIB>             POST /api/oral/hear?lang=it|en|auto  (body = recorded audio -> {text})
 *                               POST /api/oral/say {text, lang}      (-> audio/wav, Lucrezia)
 * ⚡ Veloce (on-device): a second engine — Gemma 4 E2B via LiteRT-LM in the Tauri plugin `chiron-llm` (Kotlin) — answers
 * short questions on the phone with no Mac; 🧠 Approfondita is the original Mac tutor. The same plugin also exposes
 * Android SpeechRecognizer/TextToSpeech, used when the Mac is unreachable or "voce del telefono" is chosen.
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
.tp-mic.arming{background:#e67e22;color:#fff}
.tp-mic{position:relative;overflow:hidden}
.tp-level{position:absolute;left:0;bottom:0;height:6px;width:0;background:#fff;opacity:.85;transition:width .08s linear}
.tp-heard{flex:0 0 auto;margin:2px 14px 0;font-size:15px;line-height:1.35;min-height:0;color:var(--fg)}
.tp-heard:empty{display:none}
.tp-heard .h-q{font-weight:700}
.tp-heard .h-act{display:inline-flex;gap:8px;margin-left:8px}
.tp-heard button{border:1px solid var(--line,#ccc);background:var(--elevated);color:var(--fg);border-radius:999px;padding:3px 10px;font:inherit;font-size:13px}
.tp-heard.err{color:#c0392b;font-weight:700}
.tp-mic:disabled{opacity:.5}
@keyframes tppulse{50%{box-shadow:0 0 0 10px rgba(192,57,43,.22)}}
.tp-stop{display:none;flex:0 0 auto;margin:0 14px 6px;border:none;border-radius:12px;background:var(--ok);color:#fff;font-family:var(--fh);font-weight:700;font-size:14px;padding:12px}
.tp-stop.on{display:block}
.tp-badge{display:none;min-width:20px;height:20px;border-radius:99px;background:#fff;color:var(--accent);font-size:12px;font-weight:800;align-items:center;justify-content:center;padding:0 6px}
.tp-badge.on{display:inline-flex}
.tp-selpop{position:fixed;z-index:56;left:50%;transform:translateX(-50%);top:calc(64px + env(safe-area-inset-top));max-width:92vw;display:none;border:none;border-radius:99px;background:var(--accent);color:#fff;
  font-family:var(--fh);font-weight:700;font-size:13.5px;padding:11px 16px;box-shadow:0 6px 22px rgba(0,0,0,.35);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tp-selpop.on{display:block}
.tp-hl{flex:0 0 auto;padding:0 14px 6px}
.tp-hlh{display:flex;align-items:center;gap:8px;font-family:var(--fh);font-size:12px;color:var(--muted);min-height:34px}.tp-hlh b{color:var(--fg2)}.tp-hlh span{flex:1}
.tp-hlh button{border:none;background:none;color:var(--accent);font-family:var(--fh);font-weight:700;font-size:12px;padding:4px 2px}
.tp-chips{display:flex;flex-wrap:wrap;gap:6px;max-height:80px;overflow-y:auto;margin-top:2px}
.tp-hc{display:inline-flex;align-items:center;gap:6px;max-width:100%;border-radius:99px;background:var(--elevated);color:var(--fg);font-size:12.5px;padding:3px 4px 3px 4px;border:2px solid transparent}
.tp-hc.sel{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,var(--elevated))}
.tp-hc .n{width:22px;height:22px;border-radius:50%;background:var(--accent);color:#fff;font-size:11.5px;font-weight:800;display:grid;place-items:center;flex:0 0 auto}
.tp-hc .t{min-width:0;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:6px 0}
.tp-hc button{border:none;background:none;color:var(--muted);font-size:15px;width:26px;height:28px;padding:0}
.tp-hc button.saved{color:#d97706}
.tp-man{flex:0 0 auto;display:none;gap:8px;padding:0 14px 8px}.tp-man.on{display:flex}
.tp-man input{flex:1;min-width:0;border:1px solid var(--border);background:var(--bg);color:var(--fg);border-radius:12px;padding:10px 12px;font:inherit;font-size:14px}
.tp-man button{border:none;border-radius:12px;background:var(--accent);color:#fff;font-family:var(--fh);font-weight:700;font-size:13px;padding:0 14px}
.tp-disp{flex:0 0 auto;display:none;gap:6px;flex-wrap:nowrap;overflow-x:auto;align-items:center;padding:0 14px 8px;scrollbar-width:none}.tp-disp.on{display:flex}.tp-disp::-webkit-scrollbar{display:none}
.tp-disp .l{font-family:var(--fh);font-weight:700;font-size:12px;color:var(--fg2);flex:0 0 auto}
.tp-disp button{flex:0 0 auto;border:none;border-radius:99px;background:var(--elevated);color:var(--accent);font-family:var(--fh);font-weight:700;font-size:12.5px;padding:9px 12px;white-space:nowrap}
.tp-disp button:disabled{opacity:.5}
.tp-tools{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.tp-tools button{border:none;border-radius:99px;background:var(--surface);color:var(--accent);font-family:var(--fh);font-weight:700;font-size:12px;padding:7px 12px}
.tp-tools button:disabled{opacity:.5}
.tp-out{margin-top:8px;font-size:14px}.tp-out .xr-mcq,.tp-out .xr-step,.tp-out .xr-card{background:var(--surface)}
.tp-rel{align-self:stretch;max-width:100%;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.tp-rel .lab{font-family:var(--fh);font-weight:700;font-size:11.5px;color:var(--muted);flex:1 0 100%}
.tp-rel a{display:inline-block;border-radius:99px;background:var(--medbg);color:var(--med);font-size:12px;font-weight:600;padding:6px 11px;text-decoration:none}
.tp-rel a.direct{background:var(--accent);color:#fff}
.tp-m.tp-wide{align-self:stretch;max-width:100%}
.tp-mode{display:flex;flex:1 1 100%;gap:0;background:var(--elevated);border-radius:12px;padding:3px}
.tp-mode button{flex:1;border:none;border-radius:10px;background:none;color:var(--fg2);font-family:var(--fh);font-weight:800;font-size:13.5px;padding:10px 6px}
.tp-mode button.on{background:var(--accent);color:#fff}
.tp-pb{height:10px;border-radius:99px;background:var(--surface);overflow:hidden;margin:10px 0 6px}
.tp-pb i{display:block;height:100%;width:0;background:var(--accent);transition:width .25s linear}
.tp-card small{display:block;color:var(--muted);font-size:12.5px;line-height:1.45}
.tp-card .tp-cb{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.tp-card .tp-cb button{border:none;border-radius:99px;background:var(--accent);color:#fff;font-family:var(--fh);font-weight:800;font-size:13.5px;padding:11px 16px}
.tp-card .tp-cb button.sec{background:var(--surface);color:var(--accent)}
.tp-badge-fast{display:inline-block;margin:6px 8px 0 0;font-family:var(--fh);font-weight:700;font-size:11.5px;color:var(--accent);background:var(--surface);border-radius:99px;padding:3px 10px}
.tp-caret{opacity:.5;animation:tppulse 1s steps(2) infinite}
.tp-mic.rec.ph{background:#1f7a4d}
`;
  const ICO_MIC = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>';

  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  // ---- DOM
  const fab = document.createElement('button');
  fab.className = 'tp-fab hide'; fab.innerHTML = ICO_MIC + '<span>Chiedi a Lucrezia</span><b class="tp-badge" id="tp-badge"></b>';
  document.getElementById('lesson').appendChild(fab);

  const panel = document.createElement('div'); panel.className = 'tp-panel'; panel.id = 'tpanel';
  panel.innerHTML = `
  <div class="tp-head"><b><span id="tp-t">Lucrezia</span><small id="tp-sub"></small></b><button class="tp-x" id="tp-close" aria-label="Chiudi">✕</button></div>
  <div class="tp-opts"><div class="tp-mode" id="tp-mode" style="display:none"><button id="tp-m-fast">⚡ Veloce</button><button id="tp-m-deep">🧠 Approfondita</button></div><select id="tp-model" aria-label="Modello"></select>
    <button class="tp-chip" id="tp-vsrc" style="display:none" title="Chi parla e ascolta">Voce: Mac</button>
    <button class="tp-chip on" id="tp-speak">🔊 Voce</button><button class="tp-chip" id="tp-asr" title="Lingua del microfono">Mic: auto</button>
    <button class="tp-chip" id="tp-manbtn" title="Aggiungi un'evidenziazione scrivendo il testo">✎ Evidenzia</button><button class="tp-chip on" id="tp-tested" title="Dove si testa (domande collegate)">Dove si testa</button></div>
  <div class="tp-man" id="tp-man"><input id="tp-mant" placeholder="Scrivi o incolla il termine da evidenziare" maxlength="400"><button id="tp-mana">Aggiungi</button></div>
  <div class="tp-hl" id="tp-hl" style="display:none"><div class="tp-hlh"><b id="tp-hlt" style="cursor:pointer">Evidenziazioni ▾</b><span id="tp-hln"></span><button id="tp-hlclr">Svuota</button></div><div class="tp-chips" id="tp-chips"></div></div>
  <div class="tp-disp" id="tp-disp"><div class="l" id="tp-dmsg"></div><button data-k="keep">⭐ Salva</button><button data-k="cards">🎴 Schede</button><button data-k="mcqs">❓ Quiz</button><button data-k="train">🎓 Percorso</button><button data-k="lesson">📚 Lezione</button><button data-k="img">🖼 Immagini</button></div>
  <div class="tp-msgs" id="tp-msgs"></div>
  <button class="tp-stop" id="tp-stop">⏹ Ferma audio</button>
  <div class="tp-bar"><textarea id="tp-text" rows="1" placeholder="Chiedi qualcosa su questa lezione…"></textarea><button class="tp-send" id="tp-send" aria-label="Invia">➤</button></div>
  <div class="tp-heard" id="tp-heard" aria-live="polite"></div>
  <button class="tp-mic" id="tp-mic">${ICO_MIC}<span id="tp-miclab">Tieni premuto per parlare</span><span class="tp-level" id="tp-level"></span></button>`;
  document.body.appendChild(panel);
  const selPop = document.createElement('button'); selPop.className = 'tp-selpop'; selPop.id = 'tp-selpop'; document.body.appendChild(selPop);
  const $ = id => document.getElementById(id);
  const msgsEl = $('tp-msgs'), textEl = $('tp-text'), sendBtn = $('tp-send'), micBtn = $('tp-mic'), stopBtn = $('tp-stop');

  // ---- video lessons: the lesson page (scene-report.js) posts {type:'chiron-scene', scene, time} to us
  let NOW = null;
  window.addEventListener('message', ev => {
    const fr = document.getElementById('l-frame');
    if (ev.data && ev.data.type === 'chiron-scene' && fr && ev.source === fr.contentWindow) NOW = { scene: ev.data.scene | 0, time: +ev.data.time || 0, slug: OPEN_SLUG };
    // streamed lessons run cross-origin: shell/select-report.js (server-injected) posts the learner's text selection to us
    if (ev.data && ev.data.type === 'chiron-select' && fr && ev.source === fr.contentWindow) setPending(String(ev.data.text || ''), String(ev.data.context || ''));
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

  // ---- highlights -> star capture / cards / quiz / drill / lesson / real images (web tutor.js:493-1000 parity)
  let highlights = [], nextNum = 1, pending = null, testedOn = lsGet('chiron.tutor.tested', '1') === '1';
  const lessonOpen = () => document.getElementById('lesson').classList.contains('open');
  const lastQA = () => { let q = '', a = ''; for (let i = history.length - 1; i >= 0; i--) { if (!a && history[i].role === 'assistant') a = history[i].content; else if (a && history[i].role === 'user') { q = history[i].content; break; } } return { question: q, answer: a }; };
  function setPending(text, context) { pending = text.trim() ? { text: text.trim().slice(0, 400), context: context.slice(0, 1500) } : null; paintPop(); }
  function paintPop() {
    const on = !!pending && lessonOpen();
    selPop.classList.toggle('on', on);
    if (on) selPop.textContent = '➕ Evidenzia «' + (pending.text.length > 34 ? pending.text.slice(0, 33) + '…' : pending.text) + '»';
  }
  selPop.onclick = () => { if (pending) { addHighlight(pending.text, pending.context); pending = null; paintPop(); toast('Evidenziato — aprilo da “Chiedi a Lucrezia”'); } };
  let hlSlug = null, hlOpen = true;   // highlights belong to the lesson they were made in (they may be added BEFORE the panel is first opened)
  function addHighlight(text, context) {
    text = (text || '').trim(); if (!text) return;
    if (hlSlug !== OPEN_SLUG) { highlights = []; nextNum = 1; hlSlug = OPEN_SLUG; }
    if (highlights.some(h => h.text.toLowerCase() === text.toLowerCase())) { toast('Già evidenziato'); return; }
    highlights.push({ num: nextNum++, text, context: context || '', captureId: null, sel: false }); paintHl();
  }
  function paintHl() {
    const box = $('tp-hl'), chips = $('tp-chips'), n = highlights.length;
    const b = $('tp-badge'); b.textContent = n; b.classList.toggle('on', n > 0);
    box.style.display = n ? '' : 'none'; $('tp-hln').textContent = n + (n === 1 ? ' termine' : ' termini');
    chips.innerHTML = ''; chips.style.display = hlOpen ? '' : 'none'; $('tp-hlt').textContent = 'Evidenziazioni ' + (hlOpen ? '▾' : '▸');
    highlights.forEach(h => {
      const c = document.createElement('div'); c.className = 'tp-hc' + (h.sel ? ' sel' : '');
      c.innerHTML = `<span class="n">${h.num}</span><span class="t">${esc(h.text)}</span><button class="st ${h.captureId ? 'saved' : ''}" aria-label="Salva">${h.captureId ? '★' : '☆'}</button><button class="x" aria-label="Rimuovi">✕</button>`;
      c.querySelector('.t').onclick = c.querySelector('.n').onclick = () => { h.sel = !h.sel; paintHl(); };
      c.querySelector('.st').onclick = async ev => { ev.stopPropagation(); const id = await captureOne(h); toast(id ? 'Salvato ★' : 'Salvataggio non riuscito'); paintHl(); };
      c.querySelector('.x').onclick = ev => { ev.stopPropagation(); highlights = highlights.filter(x => x !== h); paintHl(); };
      chips.appendChild(c);
    });
    const ns = highlights.filter(h => h.sel).length, disp = $('tp-disp');
    disp.classList.toggle('on', ns > 0); if (ns) $('tp-dmsg').textContent = ns + ' selezionat' + (ns === 1 ? 'o' : 'i');
  }
  $('tp-hlt').onclick = () => { hlOpen = !hlOpen; paintHl(); };
  $('tp-hlclr').onclick = () => { highlights = []; paintHl(); };
  $('tp-manbtn').onclick = e => { const m = $('tp-man'); m.classList.toggle('on'); e.currentTarget.classList.toggle('on', m.classList.contains('on')); if (m.classList.contains('on')) $('tp-mant').focus(); };
  const manAdd = () => { const t = $('tp-mant').value; if (t.trim()) { addHighlight(t, ''); $('tp-mant').value = ''; } };
  $('tp-mana').onclick = manAdd; $('tp-mant').addEventListener('keydown', e => { if (e.key === 'Enter') manAdd(); });
  $('tp-tested').classList.toggle('on', testedOn);
  $('tp-tested').onclick = e => { testedOn = !testedOn; lsSet('chiron.tutor.tested', testedOn ? '1' : '0'); e.currentTarget.classList.toggle('on', testedOn); if (!testedOn) msgsEl.querySelectorAll('.tp-rel').forEach(x => x.remove()); };

  async function captureOne(h) {      // idempotent — POST /capture (served by chiron-server) once per highlight
    if (h.captureId) return h.captureId;
    const qa = lastQA();
    try {
      const r = await fetch(LIB + '/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        kind: 'term', text: h.text, question: qa.question, source_answer: qa.answer, surrounding_text: h.context, lesson_slug: OPEN_SLUG || '', section_id: '',
        concept: h.text, model: $('tp-model').value || null, source: 'tutor' }) });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d || !d.id) throw new Error((d && (d.detail || d.error)) || 'HTTP ' + r.status);
      h.captureId = d.id; return d.id;
    } catch (e) { warn('/capture', e); return null; }
  }
  const DWORK = { keep: 'salvo…', cards: '🎴 preparo le schede…', mcqs: '❓ preparo le domande…', train: '🎓 preparo il percorso…', lesson: '📚 metto in coda la lezione…' };
  async function dispatch(kind) {
    const chosen = highlights.filter(h => h.sel); if (!chosen.length) return;
    if (kind === 'img') { const wrap = addMsg('a tp-wide', ''); wrap.innerHTML = ''; ChironX.imageWidget(wrap, chosen.map(h => h.text).join(' ').trim(), { slug: OPEN_SLUG }); msgsEl.scrollTop = msgsEl.scrollHeight; return; }
    const btns = $('tp-disp').querySelectorAll('button'); btns.forEach(b => b.disabled = true); $('tp-dmsg').textContent = DWORK[kind];
    try {
      const ids = []; for (const h of chosen) { const id = await captureOne(h); if (id) ids.push(id); }
      if (!ids.length) throw new Error('salvataggio non riuscito — il computer è raggiungibile?');
      if (kind === 'keep') { $('tp-dmsg').textContent = '✓ salvati ' + ids.length; chosen.forEach(h => h.sel = false); paintHl(); btns.forEach(b => b.disabled = false); return; }
      const r = await fetch(LIB + '/captures/cards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, kind }) });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d) throw new Error((d && (d.detail || d.error)) || 'HTTP ' + r.status);
      const box = addMsg('a tp-wide', ''); box.innerHTML = '';
      if (kind === 'mcqs') { ChironX.renderMcqs(box, d.mcqs); $('tp-dmsg').textContent = '✓ ' + (d.mcqs || []).length + ' domande pronte'; }
      else if (kind === 'train') { ChironX.renderTrain(box, d.train); $('tp-dmsg').textContent = '✓ percorso pronto'; }
      else if (kind === 'lesson') { const sl = d.lesson_job && d.lesson_job.slug; box.innerHTML = '📚 Lezione in coda' + (sl ? ': <b>' + esc(sl) + '</b>' : '') + '. La trovi in Activity.'; $('tp-dmsg').textContent = '✓ lezione in coda'; }
      else { const n = (d.cards || []).length; ChironX.renderCards(box, d.cards); $('tp-dmsg').textContent = '✓ ' + (typeof d.written_to_sr === 'number' ? d.written_to_sr : n) + ' schede → da ripassare ora'; }
      if (kind !== 'lesson') box.insertAdjacentHTML('afterbegin', '<div class="xr-close">' + esc($('tp-dmsg').textContent) + '</div>');
      chosen.forEach(h => h.sel = false); msgsEl.scrollTop = box.offsetTop - 8; paintHl();
    } catch (e) { warn('dispatch ' + kind, e); $('tp-dmsg').textContent = '⚠ ' + (e && e.message || e); }
    btns.forEach(b => b.disabled = false);
  }
  $('tp-disp').querySelectorAll('button').forEach(b => b.onclick = () => dispatch(b.dataset.k));

  // deep-agent tools on an ANSWER (:8912 /decompose -> /mcqs | /train | /cards) — the spine is cached per answer
  async function tutorPost(path, body) {
    const r = await fetch(tutorBase() + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d || d.error) throw new Error((d && d.error) || 'HTTP ' + r.status + (path === '/cards' && isHub() ? " (l'hub https non inoltra /cards al tutor)" : ''));
    return d;
  }
  async function deepTool(kind, box, reply, question) {
    const out = box.querySelector('.tp-out') || box.appendChild(Object.assign(document.createElement('div'), { className: 'tp-out' }));
    const btns = box.querySelectorAll('.tp-tools button'); btns.forEach(b => b.disabled = true);
    out.innerHTML = '<span class="spinc"></span> ' + (box._spine ? 'preparo…' : 'scompongo la risposta…');
    try {
      const concept = highlights.map(h => h.text).join(', ') || question.slice(0, 80), lang = guessLang(reply);
      if (!box._spine) box._spine = await tutorPost('/decompose', { note: reply, question, concept, lang });
      const sp = box._spine; if (!(sp.topics || []).length) throw new Error('nessun punto didattico trovato');
      const payload = { topics: sp.topics, discriminators: sp.discriminators || [], concept, lang };
      out.innerHTML = '';
      if (kind === 'mcqs') ChironX.renderMcqs(out, (await tutorPost('/mcqs', payload)).mcqs);
      else if (kind === 'train') ChironX.renderTrain(out, await tutorPost('/train', payload));
      else {
        const d = await tutorPost('/cards', payload); ChironX.renderCards(out, d.cards);
        if ((d.cards || []).length) {
          const sv = document.createElement('button'); sv.className = 'tp-say'; sv.textContent = '➕ Aggiungi ad Anki (da ripassare ora)'; out.appendChild(sv);
          sv.onclick = async () => {
            sv.disabled = true;
            try {
              const id = await captureOne({ text: question.slice(0, 120) || reply.slice(0, 120), context: reply }); if (!id) throw new Error('salvataggio non riuscito');
              const r = await fetch(LIB + '/captures/' + id + '/cards', { method: 'POST' }); const dd = await r.json().catch(() => null); if (!r.ok) throw new Error((dd && dd.detail) || 'HTTP ' + r.status);
              sv.textContent = '✓ ' + (dd.written_to_sr || (dd.cards || []).length) + ' schede aggiunte';
            } catch (e) { sv.disabled = false; sv.textContent = '⚠ ' + (e.message || e); }
          };
        }
      }
    } catch (e) { warn('deep tool ' + kind, e); out.innerHTML = '⚠ ' + esc(netMsg(e, 'strumento non riuscito')); }
    btns.forEach(b => b.disabled = false);
  }

  // "where it's tested" pills (:8912 /related -> CHIRON_RELATED_URL passthrough; nothing shown when nothing is wired)
  const ssmLink = u => { try { const x = new URL(u, location.href), b = new URL(lsGet('chiron.ssmBase', '') || 'http://' + host() + ':5191'); x.protocol = b.protocol; x.host = b.host; return x.href; } catch (e) { return u; } };
  async function openExternal(url) { try { if (typeof TAURI !== 'undefined' && TAURI) await invoke('plugin:opener|open_url', { url }); else window.open(url, '_blank'); } catch (e) { warn('open ' + url, e); toast('Impossibile aprire il browser'); } }
  async function showRelated(question) {
    if (!testedOn) return;
    const concepts = highlights.map(h => h.text).concat(question ? [question] : []).filter(Boolean).slice(0, 8); if (!concepts.length) return;
    try {
      const r = await fetch(tutorBase() + '/related', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ concepts, k: 6 }) });
      const d = r.ok ? await r.json() : null; const list = ((d && d.related) || []).filter(x => x && x.url && x.label); if (!list.length) return;
      msgsEl.querySelectorAll('.tp-rel').forEach(x => x.remove());
      const w = document.createElement('div'); w.className = 'tp-rel'; w.innerHTML = '<div class="lab">Dove si testa</div>';
      list.forEach(x => {
        const a = document.createElement('a'); a.href = ssmLink(x.url); a.className = x.tier === 'direct' ? 'direct' : ''; a.textContent = x.label.length > 55 ? x.label.slice(0, 54) + '…' : x.label;
        a.onclick = ev => { ev.preventDefault(); openExternal(a.href); }; w.appendChild(a);
      });
      msgsEl.appendChild(w);
    } catch (e) { /* tutor offline or nothing wired: no pills, no error */ }
  }

  // ---- open / close
  function resetIfNewLesson() {
    if (convoSlug === OPEN_SLUG) return;
    convoSlug = OPEN_SLUG; history = []; msgsEl.innerHTML = ''; pending = null; paintPop();
    msgsEl.innerHTML = `<div class="tp-hint">Chiedi a Lucrezia di spiegarti qualcosa di <b>questa lezione</b>.<br>Scrivi, oppure tieni premuto il microfono e parla.</div>`;
    $('tp-sub').textContent = lessonTitle();
  }
  function openPanel() { resetIfNewLesson(); if (hlSlug !== OPEN_SLUG && highlights.length) { highlights = []; hlSlug = null; paintHl(); } panel.classList.add('open'); fab.classList.add('hide'); loadModels(); fastInit(); if (!phoneVoiceOn()) warmMic(); }
  function closePanel() { panel.classList.remove('open'); stopSpeaking(); releaseMic(); if (document.getElementById('lesson').classList.contains('open')) fab.classList.remove('hide'); }
  $('tp-close').onclick = closePanel;

  // FAB visibility follows the lesson overlay (class toggled by app.js openLesson/closeLesson).
  new MutationObserver(() => {
    const open = document.getElementById('lesson').classList.contains('open');
    if (!open) { panel.classList.remove('open'); stopSpeaking(); }
    fab.classList.toggle('hide', !open || panel.classList.contains('open'));
    if (!open) pending = null; paintPop();
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
      if (mode !== 'fast') showErr(netMsg(e, 'elenco modelli non caricato'), e, 'tutor-models');
      if (e && e.name === 'TypeError') { macDown = true; fastInit().then(() => suggestFast(null)); }
    }
  }
  $('tp-model').onchange = e => lsSet(LSK_MODEL, e.target.value);
  $('tp-speak').onclick = e => { speakOn = !speakOn; lsSet(LSK_SPEAK, speakOn ? '1' : '0'); e.currentTarget.classList.toggle('on', speakOn); if (!speakOn) stopSpeaking(); };
  $('tp-asr').onclick = () => { asrLang = ({ auto: 'it', it: 'en', en: 'auto' })[asrLang]; lsSet(LSK_ASR, asrLang); asrLabel(); };

  // ---- ⚡ Veloce — on-device tutor (plugin chiron-llm: Gemma 4 E2B .litertlm via LiteRT-LM; Kotlin side in src-tauri/plugins)
  const LSK_MODE = 'chiron.tutor.mode', LSK_VSRC = 'chiron.tutor.voicesrc', LSK_LLMURL = 'chiron.llm.url';
  const PLUG = (typeof TAURI !== 'undefined' && TAURI) ? (cmd, args) => invoke('plugin:chiron-llm|' + cmd, args) : null;
  const FAST_SYS = 'Sei Lucrezia, tutor di italiano medico. Rispondi in modo breve e corretto (massimo 3 frasi), usando il contesto. Se la risposta non è nel contesto, dillo.';
  // Why capped: latency. Veloce is a 3-sentence tutor; 320 tokens is ~20 s at the measured ~14 tok/s, far above a 3-sentence
  // answer (~60 tokens), so it only guards a runaway generation. Source: ~/models/phone-bench/results.md (2026-10-17).
  const FAST_MAX_TOKENS = 320, CTX_CHARS = 2000;
  let mode = lsGet(LSK_MODE, 'deep') === 'fast' ? 'fast' : 'deep', voiceSrc = lsGet(LSK_VSRC, 'mac') === 'phone' ? 'phone' : 'mac';
  let llmAvail = null, llmSt = null, macDown = false, phoneSpoke = false, sttActive = false;
  const newChannel = fn => { const c = new window.__TAURI__.core.Channel(); c.onmessage = fn; return c; };
  const llmUrl = () => lsGet(LSK_LLMURL, '') || ('http://' + host() + ':8910/models/gemma-4-E2B-it.litertlm');
  const manifestUrl = () => llmUrl().replace(/[^/]*$/, 'manifest.json');
  const phoneVoiceOn = () => !!PLUG && llmAvail !== false && (macDown || (mode === 'fast' && voiceSrc === 'phone'));
  const mb = n => (n / 1048576).toFixed(n >= 1e9 ? 0 : 1) + ' MB';
  async function fetchT(url, ms, opt) { const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms); try { return await fetch(url, Object.assign({ signal: ac.signal }, opt || {})); } finally { clearTimeout(t); } }

  async function fastInit() {       // probe the plugin once: absent on desktop/web (and on a build without it) -> no Veloce UI
    if (!PLUG) { llmAvail = false; paintMode(); return; }
    try { llmSt = await PLUG('llm_status'); llmAvail = true; } catch (e) { llmAvail = false; warn('chiron-llm plugin not available', e); }
    paintMode();
  }
  function paintMode() {
    const avail = llmAvail === true;
    $('tp-mode').style.display = avail ? '' : 'none';
    $('tp-m-fast').classList.toggle('on', mode === 'fast'); $('tp-m-deep').classList.toggle('on', mode !== 'fast');
    $('tp-model').style.display = mode === 'fast' && avail ? 'none' : '';
    const v = $('tp-vsrc'); v.style.display = mode === 'fast' && avail ? '' : 'none';
    v.textContent = 'Voce: ' + (voiceSrc === 'phone' ? 'telefono' : 'Mac'); v.classList.toggle('on', voiceSrc === 'phone');
    micBtn.classList.toggle('ph', phoneVoiceOn());
    textEl.placeholder = mode === 'fast' && avail ? '⚡ Domanda veloce (sul telefono)…' : 'Chiedi qualcosa su questa lezione…';
  }
  function setMode(m) {
    mode = m; lsSet(LSK_MODE, m); paintMode();
    if (m === 'fast') { if (phoneVoiceOn()) releaseMic(); ensureFastReady(); }
  }
  $('tp-m-fast').onclick = () => setMode('fast'); $('tp-m-deep').onclick = () => setMode('deep');
  $('tp-vsrc').onclick = () => { voiceSrc = voiceSrc === 'phone' ? 'mac' : 'phone'; lsSet(LSK_VSRC, voiceSrc); paintMode(); if (voiceSrc === 'phone') releaseMic(); else warmMic().catch(() => {}); };

  // -- download card
  let dl = { state: 'idle', received: 0, total: 0, bps: 0, err: '', man: null }, dlBox = null;
  function dlPaint() {
    if (!dlBox || !dlBox.isConnected) return;
    const m = dl.man, size = m && m.size ? mb(m.size) : '≈ 2,6 GB';
    const pct = dl.total ? Math.min(100, dl.received / dl.total * 100) : 0;
    let line = '', btns = '';
    if (dl.state === 'idle') btns = '<button data-a="go">Scarica sul telefono (Wi-Fi)</button><button class="sec" data-a="url">✎ Indirizzo</button>';
    else if (dl.state === 'run') { line = mb(dl.received) + ' / ' + mb(dl.total) + (dl.bps ? ' · ' + mb(dl.bps) + '/s · ~' + Math.max(1, Math.round((dl.total - dl.received) / dl.bps / 60)) + ' min' : ''); btns = '<button class="sec" data-a="pause">⏸ Pausa</button>'; }
    else if (dl.state === 'verify') line = '🔒 Controllo l’integrità del file… ' + Math.round(pct) + '%';
    else if (dl.state === 'paused') { line = 'In pausa a ' + mb(dl.received) + (dl.total ? ' / ' + mb(dl.total) : ''); btns = '<button data-a="go">▶ Riprendi</button>'; }
    else if (dl.state === 'err') { line = '⚠ ' + esc(dl.err); btns = '<button data-a="go">↻ Riprova</button><button class="sec" data-a="url">✎ Indirizzo</button>'; }
    dlBox.innerHTML = '<b>⚡ Veloce — il tutor sul telefono</b><small>Gemma 4 E2B · ' + size + ' · risponde in pochi secondi anche senza Mac. È un tutor <i>rapido</i>: per le risposte complete resta 🧠 Approfondita. Si scarica una volta sola; usa il Wi-Fi.</small>'
      + (dl.state === 'idle' ? '' : '<div class="tp-pb"><i style="width:' + pct + '%"></i></div><small>' + line + '</small>') + '<div class="tp-cb">' + btns + '</div>';
    dlBox.querySelectorAll('[data-a]').forEach(b => b.onclick = () => ({ go: dlStart, pause: () => PLUG('llm_download_cancel'), url: dlSetUrl })[b.dataset.a]());
  }
  function dlSetUrl() { const v = prompt('Indirizzo del modello (.litertlm)', llmUrl()); if (v && /^https?:\/\//.test(v.trim())) { lsSet(LSK_LLMURL, v.trim()); dl.man = null; toast('Indirizzo salvato'); } }
  async function dlStart() {
    if (dl.state === 'run' || dl.state === 'verify') return;
    try {
      if (llmSt && llmSt.wifi === false && !confirm('Sei su una rete a consumo (dati mobili?). Il modello pesa circa 2,6 GB. Scaricare lo stesso?')) return;
      dl.state = 'run'; dl.err = ''; dlPaint();
      if (!dl.man) {
        const r = await fetchT(manifestUrl(), 6000);
        if (!r.ok) throw new Error('manifest HTTP ' + r.status + ' (' + manifestUrl() + ')');
        dl.man = await r.json();
        if (!dl.man.file || !dl.man.sha256) throw new Error('manifest incompleto (servono file e sha256)');
      }
      const url = manifestUrl().replace(/[^/]*$/, dl.man.file);
      const ch = newChannel(ev => {
        if (ev.phase === 'download') { dl.state = 'run'; dl.received = ev.received; dl.total = ev.total; dl.bps = ev.bps || 0; }
        else if (ev.phase === 'verify') { dl.state = 'verify'; dl.received = ev.received; dl.total = ev.total; }
        dlPaint();
      });
      const res = await PLUG('llm_download', { url, sha256: dl.man.sha256, onEvent: ch });
      if (res && res.status === 'paused') { dl.state = 'paused'; dlPaint(); return; }
      dl.state = 'idle'; llmSt = await PLUG('llm_status'); toast('Veloce pronto ⚡');
      if (dlBox) { dlBox.remove(); dlBox = null; }
    } catch (e) {
      const m = (e && (e.name === 'TypeError' || e.name === 'AbortError')) ? 'Server modello non raggiungibile (' + manifestUrl() + ')' : String((e && e.message) || e);
      dl.state = 'err'; dl.err = m; warn('llm download', e); dlPaint();
    }
  }
  async function ensureFastReady() {      // true when the model file is on the phone; otherwise shows the download card
    if (llmAvail !== true) { await fastInit(); if (llmAvail !== true) { showErr('Veloce non è disponibile su questo dispositivo (serve l’app Android Chiron aggiornata).'); return false; } }
    try { llmSt = await PLUG('llm_status'); } catch (e) { warn('llm_status', e); }
    if (llmSt && llmSt.downloaded) return true;
    if (!dlBox || !dlBox.isConnected) { dlBox = addMsg('a tp-wide tp-card', ''); dlBox.innerHTML = ''; }
    if (llmSt && llmSt.partial_bytes && dl.state === 'idle') { dl.state = 'paused'; dl.received = llmSt.partial_bytes; dl.total = (dl.man && dl.man.size) || 0; }
    dlPaint();
    return false;
  }
  function suggestFast(text) {            // Mac unreachable -> offer the phone tutor
    if (llmAvail !== true || mode === 'fast') return;
    const ready = llmSt && llmSt.downloaded;
    const box = addMsg('a tp-wide tp-card', '<b>Il Mac non risponde.</b><small>' + (ready ? 'Puoi usare ⚡ Veloce: risponde sul telefono, senza rete.' : '⚡ Veloce funziona senza Mac, ma va scaricato una volta (Wi-Fi).') + '</small><div class="tp-cb"><button>' + (ready && text ? '⚡ Rispondi con Veloce' : ready ? '⚡ Passa a Veloce' : '⚡ Scarica Veloce') + '</button></div>');
    box.querySelector('button').onclick = () => { box.remove(); setMode('fast'); if (ready && text) ask(text, { reask: true }); };
  }

  // -- grounding: ≤ ~2000 chars from the section the learner is on, else the lesson text (server by slug, or the saved copy)
  const offlineRef = () => { const fr = document.getElementById('l-frame'), m = fr && /^(?:https?:\/\/lesson\.localhost|lesson:\/\/localhost)\/([^/]+)\/([^?#]+)/.exec(fr.src || ''); return m ? { id: m[1], entry: decodeURIComponent(m[2]) } : null; };
  async function fastContext(q) {
    const sel = highlights.filter(h => h.sel);
    if (sel.length) return { text: sel.map(h => (h.context || h.text)).join('\n').slice(0, CTX_CHARS), src: 'selezione' };
    if (pending && (pending.context || pending.text)) return { text: (pending.context || pending.text).slice(0, CTX_CHARS), src: 'selezione' };
    const off = offlineRef();
    if (off) {                                    // lesson opened from the phone's saved copy: read it natively
      try { return { text: await invoke('lesson_text', { id: off.id, entry: off.entry, question: q, cap: CTX_CHARS }), src: 'copia offline' }; }
      catch (e) { warn('lesson_text', e); return { text: '', src: '' }; }
    }
    if (OPEN_SLUG) {
      try {
        let u = tutorBase() + '/lesson-text/' + encodeURIComponent(OPEN_SLUG) + '?cap=' + CTX_CHARS + '&q=' + encodeURIComponent(q);
        if (NOW && NOW.slug === OPEN_SLUG) u += '&t=' + NOW.time + '&scene=' + NOW.scene;
        const r = await fetchT(u, 3000); if (r.ok) { const d = await r.json(); if (d.text) return { text: d.text.slice(0, CTX_CHARS), src: 'lezione' }; }
      } catch (e) { warn('/lesson-text', e); }
      const o = OFFLINE && OFFLINE[OPEN_SLUG];
      if (o) { try { return { text: await invoke('lesson_text', { id: o.id, entry: o.entry, question: q, cap: CTX_CHARS }), src: 'copia offline' }; } catch (e) { warn('lesson_text', e); } }
    }
    return { text: '', src: '' };
  }

  async function askFast(text, o) {
    if (!(await ensureFastReady())) return;
    busy = true; sendBtn.disabled = true; unlockAudio(); stopSpeaking(true);
    if (hlOpen) { hlOpen = false; paintHl(); }
    textEl.value = ''; textEl.style.height = 'auto';
    history.push({ role: 'user', content: text }); if (!o.reask) addMsg('u', esc(text));
    const stEl = addMsg('st', '<span class="spinc"></span><span class="stt">⚡ Preparo…</span><button class="tp-chip" id="tp-fx" style="margin-left:8px">⏹ Interrompi</button>');
    const setSt = t => { const x = stEl.querySelector('.stt'); if (x) x.textContent = t; };
    stEl.querySelector('#tp-fx').onclick = () => { PLUG('llm_cancel').catch(() => {}); };
    let box = null, acc = '', raf = 0;
    try {
      if (!llmSt || !llmSt.loaded) {
        setSt('⚡ Carico il modello sul telefono (la prima volta ci mette qualche secondo)…');
        const r = await PLUG('llm_load', { backend: 'gpu' });
        llmSt = Object.assign(llmSt || {}, { loaded: true, backend: r.backend });
        if (r.fell_back) toast('GPU non disponibile: uso la CPU');
      }
      setSt('⚡ Leggo la lezione…');
      const ctx = await fastContext(text);
      const prompt = 'Contesto della lezione:\n' + (ctx.text || '(nessun contesto disponibile)') + '\n\nDomanda: ' + text;
      setSt('⚡ Lucrezia sta rispondendo…');
      const paint = cursor => { if (!box) { stEl.remove(); box = addMsg('a', ''); } box.innerHTML = md(acc) + (cursor ? '<span class="tp-caret">▍</span>' : ''); msgsEl.scrollTop = msgsEl.scrollHeight; };
      const ch = newChannel(ev => { if (ev.type === 'token') { acc += ev.text; if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(true); }); } });
      const res = await PLUG('llm_generate', { system: FAST_SYS, prompt, maxTokens: FAST_MAX_TOKENS, onEvent: ch });
      if (raf) cancelAnimationFrame(raf);
      acc = (res && res.text) || acc;
      if (!acc.trim()) throw new Error('il modello non ha prodotto testo' + (res && res.cancelled ? ' (interrotto)' : ''));
      paint(false); stEl.remove();
      if (res && res.thinking_chars) warn('thinking text was emitted by the model (should be 0)', res.thinking_chars);
      history.push({ role: 'assistant', content: acc });
      box.insertAdjacentHTML('beforeend', '<div class="tp-badge-fast" data-src="phone">⚡ sul telefono · ' + String(res.backend || llmSt.backend || '').toUpperCase() + ' · ' + (res.total_ms / 1000).toFixed(1) + ' s</div>'
        + (ctx.src ? '<div class="tp-src" data-src="ctx">' + (ctx.src === 'selezione' ? '✎ dalla selezione' : '📄 dalla ' + ctx.src) + '</div>' : '<div class="tp-src">❔ senza contesto</div>')
        + '<button class="tp-say">🔊 Ascolta</button><div class="tp-tools"><button data-t="better">🧠 Chiedi meglio</button></div>');
      box.querySelector('.tp-say').onclick = () => { unlockAudio(); speak(acc); };
      box.querySelector('[data-t="better"]').onclick = () => { history.splice(-2); ask(text, { deep: true, reask: true }); };
      if (speakOn) speak(acc);
    } catch (e) {
      if (raf) cancelAnimationFrame(raf);
      stEl.remove(); history.pop(); if (box && !acc) box.remove();
      showErr('Veloce non ha risposto: ' + String((e && e.message) || e), e, 'veloce');
    } finally { busy = false; sendBtn.disabled = false; }
  }

  // -- phone voice (Android SpeechRecognizer / TextToSpeech through the plugin)
  async function speakPhone(t) {
    const tok = ++speakTok; stopBtn.textContent = '⏹ Ferma audio'; stopBtn.classList.add('on'); phoneSpoke = true;
    try { await PLUG('tts_speak', { text: t, lang: guessLang(t) === 'it' ? 'it-IT' : 'en-US' }); }
    catch (e) { if (tok === speakTok) showErr(String((e && e.message) || e), e, 'tts_speak'); }
    finally { if (tok === speakTok) { stopBtn.classList.remove('on'); phoneSpoke = false; } }
  }
  function sttUi(on) {
    micBtn.classList.toggle('rec', on); micBtn.classList.remove('arming'); if (!on) levelEl.style.width = '0';
    labEl.textContent = on ? '● Ascolto (telefono) — rilascia per inviare' : 'Tieni premuto per parlare';
  }
  async function sttStart() {
    sttActive = true; sttUi(true); heard('');
    const ch = newChannel(ev => {
      if (ev.type === 'partial') heard('… <span class="h-q">' + esc(ev.text) + '</span>');
      else if (ev.type === 'level') levelEl.style.width = Math.max(0, Math.min(100, (ev.rms + 2) / 12 * 100)) + '%';
    });
    try {
      const r = await PLUG('stt_listen', { lang: asrLang === 'en' ? 'en-US' : 'it-IT', preferOffline: true, onEvent: ch });
      sttActive = false; sttUi(false);
      const txt = ((r && r.text) || '').trim();
      if (!txt) { heard('Non ho capito niente — riprova più vicino al microfono.', 'err'); return; }
      offerHeard(txt, r.onDevice ? 'offline' : 'rete');
    } catch (e) {
      sttActive = false; sttUi(false);
      const m = String((e && e.message) || e); heard(esc(m), 'err'); showErr(m, e, 'stt_listen');
    }
  }

  // ---- ask the tutor
  async function ask(text, o) {
    o = o || {};
    text = (text || '').trim(); if (!text || busy) return;
    if (mode === 'fast' && !o.deep) return askFast(text, o);
    busy = true; sendBtn.disabled = true; unlockAudio(); stopSpeaking(true);
    if (hlOpen) { hlOpen = false; paintHl(); }   // give the answer the room (chips stay one tap away)
    textEl.value = ''; textEl.style.height = 'auto';
    history.push({ role: 'user', content: text }); if (!o.reask) addMsg('u', esc(text));
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
      if (macDown) { macDown = false; paintMode(); }   // the Mac answered: back to the Mac voice
      const src = d.source || (d.mode === 'ita' ? 'page' : '');   // top-level field of /tutor-chat
      let lab = src === 'scene' ? '🎬 dalla scena' : src === 'page' ? (d.grounded ? '📄 dalla lezione' : '📄 risposta generale') : src === 'textbook' ? "📚 Harrison's"
        : src === 'web' ? '🌐 web' : src === 'agent' ? '🔎 agente' : '';
      if (!lab) { lab = '❔ fonte sconosciuta'; warn('answer without a known source', d); }
      const box = addMsg('a', md(d.reply) + `<div class="tp-src" data-src="${esc(src || 'unknown')}">${esc(lab)}</div>` + '<button class="tp-say">🔊 Ascolta</button><div class="tp-tools"><button data-t="cards">🎴 Schede</button><button data-t="mcqs">❓ Quiz</button><button data-t="train">🎓 Percorso</button></div>');
      box.querySelector('.tp-say').onclick = () => { unlockAudio(); speak(d.reply); };
      box.querySelectorAll('.tp-tools button').forEach(b => b.onclick = () => deepTool(b.dataset.t, box, d.reply, text));
      showRelated(text);
      if (speakOn) speak(d.reply);
    } catch (e) {
      stEl.remove(); history.pop();
      showErr(netMsg(e, 'il tutor non ha risposto'), e, '/tutor-chat');
      if (e && e.name === 'TypeError') { macDown = true; fastInit().then(() => suggestFast(text)); }
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
  function stopSpeaking(silent) { speakTok++; try { player.pause(); } catch (e) {} if (phoneSpoke && PLUG) { PLUG('tts_stop').catch(() => {}); phoneSpoke = false; } if (curUrl) { URL.revokeObjectURL(curUrl); curUrl = null; } stopBtn.classList.remove('on'); }
  async function speak(text) {
    const t = speakable(text); if (!t) return;
    if (phoneVoiceOn()) return speakPhone(t);
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
      if (tok === speakTok) {
        stopSpeaking();
        if (e && e.name === 'TypeError' && PLUG) { macDown = true; return speakPhone(t); }   // Mac unreachable -> phone voice
        showErr(netMsg(e, 'voce non riprodotta (TTS)'), e, '/api/oral/say');
      }
    }
  }
  stopBtn.onclick = () => stopSpeaking();

  // ---- voice IN (hold to talk)
  // The mic stays open while the panel is open. Opening it on every press lost the
  // first second of speech, which garbled the transcript (seen on the Fold, 2026-10-17).
  let rec = null, stream = null, warming = null, chunks = [], recStart = 0, wantStop = false;
  let actx = null, analyser = null, levelRaf = 0, timerIv = 0, sendTimer = 0;
  const heardEl = $('tp-heard'), levelEl = $('tp-level'), labEl = $('tp-miclab');
  const pickMime = () => (['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m))) || '';
  function micErr(e) {
    const n = e && e.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'Microfono negato — consenti il microfono in Impostazioni → App → Chiron → Autorizzazioni.';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Nessun microfono trovato su questo dispositivo.';
    if (n === 'NotReadableError') return 'Il microfono è in uso da un’altra app.';
    return 'Microfono non disponibile: ' + (e && e.message || e);
  }
  function heard(html, cls) { heardEl.className = 'tp-heard' + (cls ? ' ' + cls : ''); heardEl.innerHTML = html; }
  function streamLive() { return stream && stream.getAudioTracks().some(t => t.readyState === 'live'); }
  function warmMic() {
    if (streamLive()) return Promise.resolve(stream);
    if (warming) return warming;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) return Promise.reject(new Error('unsupported'));
    warming = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then(st => { stream = st; warming = null; try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); analyser = actx.createAnalyser(); analyser.fftSize = 512; actx.createMediaStreamSource(st).connect(analyser); } catch (e) { warn('level meter', e); } return st; })
      .catch(e => { warming = null; throw e; });
    warming.catch(() => {});
    return warming;
  }
  function releaseMic() {
    if (rec && rec.state !== 'inactive') { wantStop = true; rec.stop(); }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    try { if (actx) actx.close(); } catch (e) {} actx = null; analyser = null;
  }
  function meter() {
    if (!analyser || !rec) { levelEl.style.width = '0'; return; }
    const d = new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(d);
    let peak = 0; for (const v of d) peak = Math.max(peak, Math.abs(v - 128));
    levelEl.style.width = Math.min(100, peak / 64 * 100) + '%';
    levelRaf = requestAnimationFrame(meter);
  }
  function recUi(on) {
    clearInterval(timerIv); cancelAnimationFrame(levelRaf); levelEl.style.width = '0';
    micBtn.classList.toggle('rec', on); micBtn.classList.remove('arming');
    if (on) {
      const t0 = Date.now();
      const tick = () => { labEl.textContent = '● REC ' + Math.floor((Date.now() - t0) / 1000) + 's — rilascia per inviare'; };
      tick(); timerIv = setInterval(tick, 250); meter();
    } else labEl.textContent = 'Tieni premuto per parlare';
  }
  async function micStart() {
    if (busy || rec || sttActive) return;
    unlockAudio(); stopSpeaking(true); clearTimeout(sendTimer); wantStop = false;
    if (phoneVoiceOn()) return sttStart();
    if (!streamLive()) {
      micBtn.classList.add('arming'); labEl.textContent = 'Attivo il microfono…';
      try { await warmMic(); }
      catch (e) { micBtn.classList.remove('arming'); labEl.textContent = 'Tieni premuto per parlare'; heard(esc(e.message === 'unsupported' ? 'Registrazione non supportata in questa WebView.' : micErr(e)), 'err'); showErr(micErr(e), e, 'getUserMedia'); return; }
      if (wantStop) { micBtn.classList.remove('arming'); labEl.textContent = 'Tieni premuto per parlare'; heard('Microfono pronto — ora tieni premuto mentre parli.'); return; }
    }
    const mime = pickMime(); chunks = [];
    try { rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
    catch (e) { heard(esc('Registrazione non avviata: ' + e.message), 'err'); showErr('Registrazione non avviata: ' + e.message, e, 'MediaRecorder'); return; }
    rec.ondataavailable = ev => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    rec.onstop = onRecorded; rec.start(); recStart = Date.now();
    heard(''); recUi(true);
  }
  function micStop() {
    wantStop = true;
    if (sttActive) { PLUG('stt_stop').catch(() => {}); return; }
    if (rec && rec.state !== 'inactive') rec.stop();
  }
  // Show what was heard, right above the mic, and send after a short countdown.
  function offerHeard(txt, via) {
    textEl.value = txt;
    let n = 3;
    const show = () => heard('Ho sentito' + (via ? ' (' + via + ')' : '') + ': <span class="h-q">«' + esc(txt) + '»</span><span class="h-act"><button id="tp-h-send">Invia ora (' + n + ')</button><button id="tp-h-edit">✎ Modifica</button></span>');
    show();
    const go = () => { clearInterval(sendTimer); heard(''); ask(textEl.value.trim() || txt); };
    heardEl.querySelector('#tp-h-send').onclick = go;
    heardEl.querySelector('#tp-h-edit').onclick = () => { clearInterval(sendTimer); heard('Correggi il testo e premi ➤.'); textEl.focus(); };
    clearInterval(sendTimer);
    sendTimer = setInterval(() => { n--; if (n <= 0) go(); else { const b = heardEl.querySelector('#tp-h-send'); if (b) b.textContent = 'Invia ora (' + n + ')'; } }, 1000);
  }
  async function onRecorded() {
    const mime = (rec && rec.mimeType) || 'audio/webm', ms = Date.now() - recStart; rec = null;
    recUi(false);
    const blob = new Blob(chunks, { type: mime });
    if (ms < 500 || blob.size < 1000) { heard('Troppo breve — tieni premuto mentre parli.', 'err'); return; }
    micBtn.disabled = true; labEl.textContent = 'Trascrivo…'; heard('⏳ Trascrivo quello che hai detto…');
    try {
      const r = await fetch(LIB + '/api/oral/hear?lang=' + asrLang, { method: 'POST', headers: { 'Content-Type': mime }, body: blob });
      if (!r.ok) throw new Error('ASR HTTP ' + r.status + ' ' + (await r.text()).slice(0, 140));
      const d = await r.json(); const txt = (d.text || '').trim();
      if (!txt) { heard('Non ho capito niente — riprova più vicino al microfono.', 'err'); return; }
      offerHeard(txt);
    } catch (e) {
      heard(esc(netMsg(e, 'trascrizione non riuscita (ASR)')) + (PLUG && e && e.name === 'TypeError' ? ' — passo alla voce del telefono: ripremi il microfono.' : ''), 'err');
      showErr(netMsg(e, 'trascrizione non riuscita (ASR)'), e, '/api/oral/hear');
      if (e && e.name === 'TypeError' && PLUG) { macDown = true; paintMode(); }
    }
    finally { micBtn.disabled = false; if (!rec) labEl.textContent = 'Tieni premuto per parlare'; }
  }
  micBtn.addEventListener('pointerdown', e => { e.preventDefault(); micBtn.setPointerCapture(e.pointerId); micStart(); });
  micBtn.addEventListener('pointerup', micStop);
  micBtn.addEventListener('pointercancel', micStop);
  micBtn.addEventListener('contextmenu', e => e.preventDefault());
  micBtn.style.touchAction = 'none';
  textEl.addEventListener('input', () => { if (sendTimer) { clearInterval(sendTimer); sendTimer = 0; heard('Correggi il testo e premi ➤.'); } });

  window.ChironTutorPanel = { open: openPanel, close: closePanel, ask, speak, player };   // test/debug hook
})();
