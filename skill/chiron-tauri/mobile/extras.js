'use strict';
/* Chiron phone — wave-2 parity extras (web library/tutor features that the phone lacked). Loaded after app.js and
 * before tutor-panel.js; uses app.js globals (LIB, LESSONS, OPEN_SLUG, toast, go, slugOf, loadLibrary, isHub, TAURI,
 * invoke) and exposes window.ChironX. Everything talks to the same endpoints as the web library (skill/library):
 *   captures  GET /captures · GET|DELETE /captures/{id} · POST /captures/{id}/cards · POST /captures/cards {ids,kind}
 *   activity  POST /cancel/{ref} · /jobs/clear-failed · /gen/pause|resume · /gen/rotation · GET /jobs/{slug}/steps|recovery
 *   bake      POST /bake/{slug}?engine · /bake-batch · /bake-all?engine · /bake-estimate
 *   library   GET /corpus/status · POST /regenerate/{slug} · tutor :8912 GET /images · POST /images/keep
 * Labels are English on the screens that were already English; the tutor panel (tutor-panel.js) is Italian. */
(function () {
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
  const e2 = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const warn = (what, e) => console.warn('chiron extras: ' + what, e && (e.message || e));
  const host = () => { try { return new URL(LIB).hostname; } catch (e) { return ''; } };
  // same resolution as tutor-panel.js: explicit override > the https hub (proxies /tutor-*, /images, /decompose …) > :8912
  const tutorBase = () => (lsGet('chiron.tutor', '') || (isHub() ? new URL(LIB).origin : 'http://' + host() + ':8912')).replace(/\/+$/, '');
  async function api(path, opt, base) {
    opt = opt || {};
    const init = { method: opt.method || 'GET', headers: {} };
    if (opt.json !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opt.json); }
    let r;
    try { r = await fetch((base || LIB) + path, init); }
    catch (e) { throw new Error('computer non raggiungibile (' + (host() || 'indirizzo?') + ')'); }
    let d = null; try { d = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error((d && (d.detail || d.error)) || 'HTTP ' + r.status);
    return d || {};
  }
  const clipOf = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  /* ---------------- CSS ---------------- */
  const css = `
.xs-scrim{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:57;opacity:0;transition:opacity .2s}.xs-scrim.on{opacity:1}
.xs-sheet{position:fixed;left:0;right:0;bottom:0;margin:0 auto;max-width:720px;max-height:86vh;z-index:58;background:var(--surface);color:var(--fg);border-radius:20px 20px 0 0;
  box-shadow:0 -8px 40px rgba(0,0,0,.3);display:flex;flex-direction:column;transform:translateY(105%);transition:transform .25s cubic-bezier(.2,.7,.2,1);padding-bottom:env(safe-area-inset-bottom);font-family:var(--fb)}
.xs-sheet.on{transform:none}
.xs-head{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:14px 16px 8px}
.xs-head b{flex:1;font-family:var(--fh);font-weight:800;font-size:16px}
.xs-x{width:36px;height:36px;border-radius:50%;border:none;background:var(--elevated);color:var(--fg);font-size:16px}
.xs-body{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:4px 16px 18px;font-size:14px;line-height:1.5}
.xs-btn{border:none;border-radius:99px;background:var(--accent);color:#fff;font-family:var(--fh);font-weight:700;font-size:13px;padding:10px 16px}
.xs-btn.ghost{background:var(--elevated);color:var(--accent)}.xs-btn.warn{background:var(--elevated);color:#dc2626}.xs-btn.ok{background:var(--ok)}
.xs-btn:disabled{opacity:.5}
.xs-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px}
.xs-row .fi{flex:1;width:auto;min-width:0}
.aacts{flex-wrap:wrap}
.xs-ta{width:100%;border:1px solid var(--border);background:var(--bg);color:var(--fg);border-radius:12px;padding:11px 12px;font:inherit;font-size:14.5px;min-height:84px;resize:vertical}
.xs-engine{display:flex;flex-direction:column;gap:9px;margin-top:10px}
.xs-engine button{border:1px solid var(--border);background:var(--bg);color:var(--fg);border-radius:14px;padding:13px 14px;text-align:left;font-family:var(--fh);font-weight:800;font-size:15px}
.xs-engine button small{display:block;font-family:var(--fb);font-weight:500;font-size:12px;color:var(--muted);margin-top:3px}
.xs-kv{display:flex;justify-content:space-between;border-bottom:1px solid var(--divider);padding:9px 2px;font-size:13.5px}.xs-kv b{font-family:var(--fh)}
/* shared result renderers */
.xr-mcq{background:var(--elevated);border-radius:14px;padding:11px 12px;margin:8px 0}
.xr-stem{font-weight:600;font-size:14px;margin-bottom:8px}
.xr-opt{display:block;width:100%;text-align:left;border:1px solid var(--border);background:var(--surface);color:var(--fg);border-radius:10px;padding:9px 11px;margin-top:6px;font:inherit;font-size:13.5px}
.xr-opt.correct{border-color:var(--ok);background:var(--langbg)}.xr-opt.wrong{border-color:#dc2626;background:#fde2e2;color:#7f1d1d}
:root[data-theme=dark] .xr-opt.wrong{background:#3a1414;color:#fecaca}
.xr-why{font-size:12.5px;color:var(--fg2);margin-top:8px}.xr-disc{font-size:12px;color:var(--accent);font-weight:700;margin-top:5px}
.xr-step{background:var(--elevated);border-radius:14px;padding:11px 12px;margin:8px 0}.xr-topic{font-family:var(--fh);font-weight:800;font-size:14px}
.xr-teach{font-size:13.5px;margin-top:5px}.xr-drill{margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);font-size:13.5px}
.xr-ans{display:none;margin-top:6px;color:var(--ok);font-weight:600}.xr-rev{border:none;background:none;color:var(--accent);font-family:var(--fh);font-weight:700;font-size:12px;padding:6px 0}
.xr-card{background:var(--elevated);border-radius:14px;padding:11px 12px;margin:8px 0;font-size:13.5px}.xr-card .f{font-weight:700}.xr-card .b{color:var(--fg2);margin-top:5px;padding-top:5px;border-top:1px dashed var(--border)}
.xr-close{font-size:13px;color:var(--fg2);font-style:italic;margin:8px 2px}
/* images */
.xi{background:var(--elevated);border-radius:14px;padding:11px 12px;margin:8px 0}
.xi-h{font-family:var(--fh);font-weight:800;font-size:13.5px}.xi-s{font-size:11.5px;color:var(--muted);margin:2px 0 8px}
.xi-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.xi-cell{position:relative;border-radius:10px;overflow:hidden;background:var(--bg);border:2px solid transparent;padding:0;aspect-ratio:4/3}
.xi-cell img{width:100%;height:100%;object-fit:cover;display:block}.xi-cell.on{border-color:transparent}
.xi-star{position:absolute;top:5px;right:5px;width:28px;height:28px;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;display:grid;place-items:center;font-size:15px}
.xi-cell.on .xi-star{background:var(--accent)}
.xi-src{position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.55);color:#fff;font-size:10px;padding:2px 6px;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* library toolbar + selection bar */
.xbar{display:flex;gap:7px;flex-wrap:wrap;margin:2px 0 8px}
.xbar .chip.on{background:var(--accent);color:#fff}
.btn.selb{color:var(--accent)}.btn.selb.on{background:var(--accent);color:#fff}
.selbar{position:sticky;bottom:calc(8px + env(safe-area-inset-bottom));z-index:15;background:var(--surface);border:1px solid var(--accent);border-radius:16px;padding:10px 12px;margin-top:14px;box-shadow:0 6px 24px rgba(0,0,0,.2);display:none}
.selbar.on{display:block}
.selbar .sr{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.selbar .sr+.sr{margin-top:8px}
.selbar .lab{font-family:var(--fh);font-weight:700;font-size:13px;flex:1;min-width:90px}
.selbar input[type=number]{width:62px;border:1px solid var(--border);background:var(--bg);color:var(--fg);border-radius:10px;padding:8px;font:inherit;font-size:14px}
.lmore{width:40px;height:40px;border-radius:50%;background:var(--surface);border:1px solid var(--border);color:var(--fg);display:grid;place-items:center;font-size:20px;flex:0 0 auto}
/* captures screen */
.cap-bar{display:flex;gap:7px;flex-wrap:wrap;margin:6px 0 4px;align-items:center}
.cap-row{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:11px 12px;margin-bottom:9px;display:flex;gap:10px}
.cap-row.unp{background:color-mix(in srgb,var(--accent) 7%,var(--surface))}.cap-row.sel{background:color-mix(in srgb,var(--accent) 16%,var(--surface))}
.cap-row input[type=checkbox]{width:22px;height:22px;flex:0 0 auto;margin-top:2px;accent-color:var(--accent)}
.cap-main{flex:1;min-width:0}
.cap-top{display:flex;gap:7px;align-items:flex-start}.cap-t{font-family:var(--fh);font-weight:700;font-size:14px;flex:1;min-width:0;word-break:break-word}
.cap-k{font-size:9.5px;font-weight:800;padding:2px 7px;border-radius:99px;background:var(--elevated);color:var(--fg2);text-transform:uppercase;flex:0 0 auto}
.cap-k.term{background:var(--medbg);color:var(--med)}.cap-k.answer{background:var(--meditbg);color:var(--medit)}.cap-k.image{background:var(--langbg);color:var(--lang)}
.cap-m{font-size:11.5px;color:var(--muted);margin-top:4px}
.cap-x{margin-top:9px}.cap-x .q{font-size:12px;color:var(--muted);margin-bottom:5px}.cap-x .a{font-size:13.5px;white-space:pre-wrap;max-height:240px;overflow-y:auto}
.cap-act{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.cap-act .xs-btn{padding:8px 13px;font-size:12.5px}
.cap-disp{position:sticky;bottom:calc(8px + env(safe-area-inset-bottom));z-index:15;background:var(--surface);border:1px solid var(--accent);border-radius:16px;padding:10px 12px;margin-top:10px;box-shadow:0 6px 24px rgba(0,0,0,.2);display:none;gap:7px;flex-wrap:wrap;align-items:center}
.cap-disp.on{display:flex}.cap-disp .lab{font-family:var(--fh);font-weight:700;font-size:13px;flex:1;min-width:100px}
/* activity extras */
.axbar{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 4px;align-items:center}
.axpaused{background:var(--reviewbg);color:var(--reviewfg);border-radius:12px;padding:10px 12px;font-size:12.5px;font-weight:600;margin:6px 0}
.axprov{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.axprov .chip.on{background:var(--accent);color:#fff}
.axlane{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:10px 12px;margin:8px 0;font-size:12.5px;color:var(--fg2)}
.axlane .qi{display:flex;align-items:center;gap:8px;margin-top:6px}.axlane .qi span{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.axrail{margin-top:10px;border-top:1px dashed var(--border);padding-top:9px}
.tln{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:5px 0;font-size:12.5px}
.tln .tldot{width:10px;height:10px;border-radius:50%;background:var(--border);flex:0 0 auto}
.tln.done .tldot{background:var(--ok)}.tln.running .tldot{background:var(--accent);animation:apulse 1s infinite}.tln.error .tldot{background:#dc2626}
.tln .tlnm{font-family:var(--fh);font-weight:700;flex:1;min-width:0}.tln .tlm{color:var(--muted);font-size:11.5px}
.tlsubs{flex:0 0 100%;padding-left:18px;color:var(--fg2);font-size:11.5px}.tls.err{color:#dc2626}
.axrec{font-size:12px;color:var(--fg2);margin:6px 0}.axrec b.nr{color:#dc2626}
`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  /* ---------------- sheets ---------------- */
  function sheet(title, onClose) {
    const sc = document.createElement('div'); sc.className = 'xs-scrim';
    const sh = document.createElement('div'); sh.className = 'xs-sheet';
    sh.innerHTML = `<div class="xs-head"><b>${e2(title)}</b><button class="xs-x" aria-label="Chiudi">✕</button></div><div class="xs-body"></div>`;
    document.body.appendChild(sc); document.body.appendChild(sh);
    requestAnimationFrame(() => { sc.classList.add('on'); sh.classList.add('on'); });
    let closed = false;
    const close = () => { if (closed) return; closed = true; sc.classList.remove('on'); sh.classList.remove('on'); setTimeout(() => { sc.remove(); sh.remove(); }, 260); if (onClose) onClose(); };
    sc.onclick = close; sh.querySelector('.xs-x').onclick = close;
    return { el: sh, body: sh.querySelector('.xs-body'), close };
  }
  function ask(title, msg, okLabel, danger) {   // promise<bool> — own sheet: native confirm() is unreliable in the Android WebView
    return new Promise(res => {
      let done = false; const s = sheet(title, () => fin(false));
      s.body.innerHTML = `<div>${msg}</div><div class="xs-row"><button class="xs-btn ${danger ? 'warn' : ''}" id="xk">${e2(okLabel || 'OK')}</button><button class="xs-btn ghost" id="xc">Cancel</button></div>`;
      const fin = v => { if (done) return; done = true; s.close(); res(v); };
      s.body.querySelector('#xk').onclick = () => fin(true); s.body.querySelector('#xc').onclick = () => fin(false);
    });
  }
  // ⚡ Fast (Modal, paid) vs 🐢 Mac (free) — with the server's own cost/time estimate, exactly like the web library
  function chooseEngine(title, slugs) {
    return new Promise(async res => {
      let done = false; const s = sheet(title, () => fin(null));
      const fin = v => { if (done) return; done = true; s.close(); res(v); };
      s.body.innerHTML = '<div class="empty"><span class="spinc"></span> stimo costo e tempo…</div>';
      let est = null; try { est = await api('/bake-estimate', { method: 'POST', json: { slugs } }); } catch (e) { warn('bake-estimate', e); }
      const usd = est && est.est_usd != null ? '~$' + Number(est.est_usd).toFixed(2) : 'small $';
      const fm = est && est.est_wall_min_modal ? '~' + est.est_wall_min_modal + ' min' : '~min';
      const mm = est && est.est_wall_min_mac ? '~' + est.est_wall_min_mac + ' min' : 'slow';
      s.body.innerHTML = `<div style="color:var(--muted);font-size:12.5px">${est ? est.n_lessons + ' lesson' + (est.n_lessons === 1 ? '' : 's') + ' · ' + est.n_clips + ' audio segments' : (est === null ? 'estimate unavailable' : '')}</div>
        <div class="xs-engine"><button id="ef">⚡ Fast — Modal<small>${usd} · ${fm} · cloud</small></button><button id="em">🐢 Mac<small>free · ${mm} · serial</small></button></div>`;
      s.body.querySelector('#ef').onclick = () => fin('modal'); s.body.querySelector('#em').onclick = () => fin('mac');
    });
  }

  /* ---------------- shared result renderers (tutor panel + captures) ---------------- */
  function renderMcqs(el, list) {
    (list || []).forEach(q => {
      const item = document.createElement('div'); item.className = 'xr-mcq';
      const opts = (q && q.options) || {}, ck = q && q.correct, why = (q && q.why_wrong) || {}, by = {}; let answered = false;
      item.innerHTML = `<div class="xr-stem">${e2(q && q.stem)}</div>`;
      Object.keys(opts).forEach(k => {
        const b = document.createElement('button'); b.className = 'xr-opt'; b.textContent = k.toUpperCase() + '. ' + opts[k]; by[k] = b;
        b.onclick = () => {
          if (answered) return; answered = true; Object.values(by).forEach(x => x.disabled = true);
          const ok = k === ck; b.classList.add(ok ? 'correct' : 'wrong'); if (!ok && by[ck]) by[ck].classList.add('correct');
          const lines = []; if (why[k]) lines.push(why[k]); if (!ok && why[ck]) lines.push('Perché ' + String(ck).toUpperCase() + ' è giusta: ' + why[ck]);
          if (lines.length) { const w = document.createElement('div'); w.className = 'xr-why'; w.textContent = lines.join(' '); item.appendChild(w); }
          if (q && q.discriminator) { const d = document.createElement('div'); d.className = 'xr-disc'; d.textContent = 'Regola testata: ' + q.discriminator; item.appendChild(d); }
        };
        item.appendChild(b);
      });
      el.appendChild(item);
    });
  }
  function renderTrain(el, train) {
    ((train && train.steps) || []).forEach(s => {
      const d = document.createElement('div'); d.className = 'xr-step';
      d.innerHTML = `<div class="xr-topic">${e2(s.topic)}</div>` + (s.teach ? `<div class="xr-teach">${e2(s.teach)}</div>` : '');
      if (s.drill) {
        const dr = document.createElement('div'); dr.className = 'xr-drill';
        dr.innerHTML = `<div>${e2(s.drill.q)}</div><button class="xr-rev">Mostra risposta</button><div class="xr-ans">${e2((s.drill.answer || '') + (s.drill.why ? ' — ' + s.drill.why : ''))}</div>`;
        const rb = dr.querySelector('.xr-rev'), an = dr.querySelector('.xr-ans');
        rb.onclick = () => { const sh = an.style.display === 'block'; an.style.display = sh ? 'none' : 'block'; rb.textContent = sh ? 'Mostra risposta' : 'Nascondi'; };
        d.appendChild(dr);
      }
      el.appendChild(d);
    });
    if (train && train.closer) { const c = document.createElement('div'); c.className = 'xr-close'; c.textContent = train.closer; el.appendChild(c); }
  }
  function renderCards(el, cards) {
    (cards || []).forEach(c => { const d = document.createElement('div'); d.className = 'xr-card';
      d.innerHTML = `<div class="f">${e2(c.front || c.q || '')}</div><div class="b">${e2(c.back || c.a || '')}</div>`; el.appendChild(d); });
  }

  /* ---------------- real medical images: lookup (:8912 /images) + keep (/images/keep) ---------------- */
  function imageWidget(parent, concept, ctx) {
    ctx = ctx || {};
    const wrap = document.createElement('div'); wrap.className = 'xi'; parent.appendChild(wrap);
    wrap.innerHTML = `<div class="xi-h">🖼 ${e2(concept)}</div><div class="xi-s"><span class="spinc" style="display:inline-block;vertical-align:middle"></span> cerco immagini reali…</div>`;
    const sel = new Set();
    fetch(tutorBase() + '/images?q=' + encodeURIComponent(concept) + '&k=8').then(async r => {
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error((d && d.error) || 'HTTP ' + r.status);
      return d;
    }).then(d => {
      const ims = (d && d.images) || [];
      if (!ims.length) { wrap.innerHTML = `<div class="xi-h">🖼 ${e2(concept)}</div><div class="xi-s">Nessuna immagine trovata.</div><div class="xs-row"><button class="xs-btn ghost" data-x>Chiudi</button></div>`; wrap.querySelector('[data-x]').onclick = () => wrap.remove(); return; }
      wrap.innerHTML = `<div class="xi-h">🖼 ${e2(concept)}</div><div class="xi-s">immagini reali · tocca per scegliere, poi salva</div><div class="xi-grid"></div>
        <div class="xs-row"><button class="xs-btn" data-save disabled>⭐ Salva (0)</button><button class="xs-btn ghost" data-x>Chiudi</button><span data-msg style="font-size:12px;color:var(--muted)"></span></div>`;
      const grid = wrap.querySelector('.xi-grid'), save = wrap.querySelector('[data-save]'), msg = wrap.querySelector('[data-msg]');
      ims.forEach((im, i) => {
        const c = document.createElement('button'); c.className = 'xi-cell'; c.type = 'button';
        c.innerHTML = `<img referrerpolicy="no-referrer" alt="" src="${e2(im.thumbnail || im.url)}"><span class="xi-star">★</span><span class="xi-src">${e2(im.source || '')}</span>`;
        c.querySelector('img').onerror = () => { c.style.opacity = '.4'; };
        c.onclick = () => { sel.has(i) ? sel.delete(i) : sel.add(i); c.classList.toggle('on', sel.has(i)); save.disabled = !sel.size; save.textContent = '⭐ Salva (' + sel.size + ')'; };
        grid.appendChild(c);
      });
      wrap.querySelector('[data-x]').onclick = () => wrap.remove();
      save.onclick = async () => {
        save.disabled = true; msg.textContent = 'salvo…';
        const images = [...sel].map(i => { const im = ims[i]; return { url: im.url, concept, caption: im.caption || null, kind: im.kind || null, source_url: im.page_url || im.url,
          source_domain: im.source || null, license: im.license || null, engine: im.engine || null, width: im.width || null, height: im.height || null }; });
        try { const r = await api('/images/keep', { method: 'POST', json: { images, lesson_slug: ctx.slug || null, section_id: ctx.section || null } });
          msg.textContent = '✓ salvate ' + (r.kept || []).length + ' → Captures' + ((r.errors || []).length ? ' (' + r.errors.length + ' non riuscite)' : ''); sel.clear();
        } catch (e) { warn('/images/keep', e); msg.textContent = '⚠ ' + e.message; save.disabled = false; }
      };
    }).catch(e => { warn('/images', e); wrap.innerHTML = `<div class="xi-h">🖼 ${e2(concept)}</div><div class="xi-s">⚠ ricerca immagini non riuscita: ${e2(e.message)}</div><div class="xs-row"><button class="xs-btn ghost" data-x>Chiudi</button></div>`; wrap.querySelector('[data-x]').onclick = () => wrap.remove(); });
    return wrap;
  }

  /* ---------------- Captures inbox (pane 4) ---------------- */
  const CAP = { q: '', unp: false, sel: new Set(), open: new Set(), items: [], busy: false };
  let capTimer = null;
  const when = s => { if (!s) return ''; const t = new Date(s); return isNaN(t) ? '' : t.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  async function loadCaptures() {
    const body = document.getElementById('cap-body'); if (!body) return;
    try {
      const d = await api('/captures?' + new URLSearchParams({ q: CAP.q, unprocessed: CAP.unp ? 'true' : 'false', limit: 100 }));
      CAP.items = d.items || [];
      [...CAP.sel].forEach(id => { if (!CAP.items.some(x => x.id === id)) CAP.sel.delete(id); });
      document.getElementById('cap-sub').textContent = `${d.count || 0} total · ${d.unprocessed || 0} unprocessed`;
      paintCaptures();
    } catch (e) { warn('/captures', e); body.innerHTML = `<div class="empty">Can't load captures.<br>${e2(e.message)}</div>`; }
  }
  function paintCaptures() {
    const body = document.getElementById('cap-body'); if (!body) return;
    if (!CAP.items.length) { body.innerHTML = `<div class="empty">No captures${CAP.unp ? ' — everything is processed' : ''}.<br>Highlight a term in a lesson with the tutor and tap ☆ to keep it here.</div>`; paintCapDisp(); return; }
    body.innerHTML = CAP.items.map(x => {
      const sel = CAP.sel.has(x.id), open = CAP.open.has(x.id);
      return `<div class="cap-row ${x.processed_at ? '' : 'unp'} ${sel ? 'sel' : ''}" data-id="${x.id}"><input type="checkbox" ${sel ? 'checked' : ''} data-sel="${x.id}" aria-label="Select">
        <div class="cap-main" data-tog="${x.id}"><div class="cap-top"><span class="cap-k ${e2(x.kind)}">${e2(x.kind)}</span><span class="cap-t">${e2(x.text)}</span>${x.processed_at ? '<span style="color:var(--ok)">✓</span>' : ''}</div>
        <div class="cap-m">${x.concept ? e2(x.concept) + ' · ' : ''}${x.lesson_slug ? e2(clipOf(x.lesson_slug, 38)) + ' · ' : ''}${when(x.created_at)}</div>
        ${open ? `<div class="cap-x" id="capx-${x.id}"><div class="q">Loading…</div></div>` : ''}</div></div>`; }).join('');
    body.querySelectorAll('[data-sel]').forEach(cb => { cb.onclick = ev => { ev.stopPropagation(); const id = +cb.dataset.sel; CAP.sel.has(id) ? CAP.sel.delete(id) : CAP.sel.add(id); paintCaptures(); }; });
    body.querySelectorAll('[data-tog]').forEach(m => { m.onclick = () => { const id = +m.dataset.tog; CAP.open.has(id) ? CAP.open.delete(id) : CAP.open.add(id); paintCaptures(); }; });
    CAP.open.forEach(fillCapX); paintCapDisp();
  }
  async function fillCapX(id) {
    const el = document.getElementById('capx-' + id); if (!el) return;
    try {
      const d = await api('/captures/' + id);
      el.innerHTML = (d.question ? `<div class="q">Asked: ${e2(d.question)}</div>` : '') + `<div class="a">${e2(d.source_answer || d.text || '')}</div>
        <div class="cap-act"><button class="xs-btn" data-k="cards">🎴 Cards</button><button class="xs-btn ghost" data-k="mcqs">❓ Quiz</button><button class="xs-btn ghost" data-k="lesson">📚 Lesson</button><button class="xs-btn warn" data-k="del">🗑 Delete</button></div>`;
      el.querySelectorAll('[data-k]').forEach(b => b.onclick = ev => { ev.stopPropagation(); capAction(b.dataset.k, [id], b); });
    } catch (e) { el.innerHTML = `<div class="q">Failed to load: ${e2(e.message)}</div>`; }
  }
  function paintCapDisp() {
    const bar = document.getElementById('cap-disp'); if (!bar || CAP.busy) return;
    const n = CAP.sel.size; bar.classList.toggle('on', n > 0); if (!n) { bar.innerHTML = ''; return; }
    bar.innerHTML = `<span class="lab">${n} selected</span><button class="xs-btn" data-k="cards">🎴 Cards</button><button class="xs-btn ghost" data-k="mcqs">❓ Quiz</button><button class="xs-btn ghost" data-k="train">🎓 Train</button><button class="xs-btn ghost" data-k="lesson">📚 Lesson</button><button class="xs-btn ghost" data-k="clr">✕</button>`;
    bar.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { if (b.dataset.k === 'clr') { CAP.sel.clear(); paintCaptures(); } else capAction(b.dataset.k, [...CAP.sel], b); });
  }
  async function capAction(kind, ids, btn) {
    if (kind === 'del') {
      if (!(await ask('Delete capture', 'This deletes the capture permanently.', 'Delete', true))) return;
      try { await api('/captures/' + ids[0], { method: 'DELETE' }); CAP.sel.delete(ids[0]); CAP.open.delete(ids[0]); toast('Capture deleted'); loadCaptures(); }
      catch (e) { toast('Delete failed: ' + e.message); } return;
    }
    if (CAP.busy) return; CAP.busy = true; const old = btn && btn.textContent; if (btn) { btn.disabled = true; btn.textContent = '🧬 …'; }
    const s = sheet({ cards: 'Cards', mcqs: 'Quiz', train: 'Drill', lesson: 'Lesson' }[kind] || kind);
    s.body.innerHTML = '<div class="empty"><span class="spinc"></span> elaboro… (può richiedere un minuto)</div>';
    try {
      const r = (kind === 'cards' && ids.length === 1)
        ? await api('/captures/' + ids[0] + '/cards', { method: 'POST' })
        : await api('/captures/cards', { method: 'POST', json: { ids, kind } });
      s.body.innerHTML = '';
      if (kind === 'cards') { s.body.insertAdjacentHTML('beforeend', `<div class="xr-close">✓ ${(r.cards || []).length || r.written_to_sr || 0} cards → due now</div>`); renderCards(s.body, r.cards); }
      else if (kind === 'mcqs') { s.body.insertAdjacentHTML('beforeend', `<div class="xr-close">✓ ${(r.mcqs || []).length} practice questions</div>`); renderMcqs(s.body, r.mcqs); }
      else if (kind === 'train') renderTrain(s.body, r.train);
      else s.body.innerHTML = `<div class="xr-close">✓ lesson queued — ${e2((r.lesson_job && r.lesson_job.slug) || '')}. Follow it in Activity.</div>`;
      CAP.sel.clear();
    } catch (e) { warn('capture dispatch ' + kind, e); s.body.innerHTML = `<div class="empty">⚠ ${e2(e.message)}</div>`; }
    CAP.busy = false; if (btn) { btn.disabled = false; btn.textContent = old; } loadCaptures();
  }
  function renderCaptures() {
    clearInterval(capTimer); loadCaptures(); capTimer = setInterval(() => { if (curPane() === 4 && !CAP.busy) loadCaptures(); }, 8000);
  }
  (function wireCaptures() {
    const q = document.getElementById('cap-q'), u = document.getElementById('cap-unp'); if (!q) return;
    let t; q.oninput = () => { clearTimeout(t); t = setTimeout(() => { CAP.q = q.value.trim(); loadCaptures(); }, 300); };
    u.onclick = () => { CAP.unp = !CAP.unp; u.classList.toggle('on', CAP.unp); loadCaptures(); };
  })();

  /* ---------------- Activity: cancel · clear failed · pause/resume · rotation · step-by-step detail ---------------- */
  const PROVIDERS = [['🏠 Local (Mac)', 'local/'], ['🐢 Ollama Cloud', 'glm@latest'], ['⚡ Gemini', 'gemini/gemini-flash-latest'], ['💲 GPT-5-mini', 'gpt-5-mini']];
  const OPEN_DETAIL = new Set(), RAIL = {};
  const secs = n => n == null ? '' : (n >= 60 ? Math.floor(n / 60) + 'm' + String(n % 60).padStart(2, '0') + 's' : n + 's');
  function railHtml(d, rec) {
    const P = d.phases || []; let h = '';
    if (rec && rec.text !== undefined) h += `<div class="axrec">text ${rec.text ? '✓' : '✕'} · audio ${rec.clips_done != null ? rec.clips_done + '/' + (rec.clips_total != null ? rec.clips_total : '?') + ' clips' : '—'}${rec.needs_rebake ? ' · <b class="nr">needs rebake</b>' : ''}</div>`;
    if (!P.length) return h + '<div class="axrec">no steps yet…</div>';
    return h + P.map(p => {
      let subs = '';
      if (p.status === 'running' && p.events && p.events.length) subs = '<div class="tlsubs">' + p.events.filter(ev => (ev.event_type || '') !== 'PROGRESS').slice(-8).map(ev => {
        const et = ev.event_type || '';
        if (et.indexOf('MODEL_CALL') === 0) return `<div class="tls">MODEL ${e2(ev.model || '')}${ev.tokens ? ' · ' + ev.tokens + ' tok' : ''} ${et === 'MODEL_CALL_END' ? '✓' : '…'}</div>`;
        if (et.indexOf('TOOL_CALL') === 0) return `<div class="tls">TOOL ${e2(ev.instruction || '')} ${et === 'TOOL_CALL_END' ? '✓' : '…'}</div>`;
        if (et === 'STEP_ERROR') return `<div class="tls err">⚠ ${e2(ev.instruction || ev.error || '')}</div>`;
        if (et === 'CLIP') return `<div class="tls ${/⚠/.test(ev.instruction || '') ? 'err' : ''}">${e2(ev.instruction || '')}</div>`;
        if (et === 'RECOVERY') return `<div class="tls">♻ ${e2(ev.instruction || '')}</div>`;
        return `<div class="tls">${e2(et)}</div>`; }).join('') + '</div>';
      const prog = (p.events || []).filter(ev => (ev.event_type || '') === 'PROGRESS').slice(-1)[0];
      const meta = p.status === 'done' ? '✓ ' + secs(p.seconds) : p.status === 'error' ? '✗ failed' : p.status === 'running' ? 'running' + (p.seconds ? ' · ' + secs(p.seconds) : '') + (prog && prog.instruction ? ' · ' + e2(prog.instruction) : '') : '';
      return `<div class="tln ${p.status}"><span class="tldot"></span><span class="tlnm">${e2(p.name)}</span><span class="tlm">${meta}</span>${subs}</div>`;
    }).join('');
  }
  async function fillRail(key, slug, box, j) {
    try {
      const [d, rec] = await Promise.all([api('/jobs/' + encodeURIComponent(slug) + '/steps'), api('/jobs/' + encodeURIComponent(slug) + '/recovery').catch(() => null)]);
      let h = railHtml(d, rec);
      const canBake = rec && rec.text && (rec.needs_rebake || !rec.clips_done);
      if (canBake && !(j.status === 'queued' || j.status === 'running' || j.status === 'baking')) h += `<div class="aacts"><button class="abtn" data-rebake>🔊 Rebake audio</button></div>`;
      RAIL[key] = h; box.innerHTML = h;
      const rb = box.querySelector('[data-rebake]'); if (rb) rb.onclick = ev => { ev.stopPropagation(); bakeSlugs([slug], 'Rebake this lesson — pick an engine:'); };
    } catch (e) { warn('steps ' + slug, e); if (!RAIL[key]) box.innerHTML = '<div class="axrec">steps unavailable</div>'; }
  }
  function afterActivity(d, body, all) {
    // control bar (inserted before the first card/heading)
    const bar = document.createElement('div');
    const nErr = (d.counts && d.counts.error) || 0, pool = d.pool || [];
    bar.innerHTML = (d.paused ? `<div class="axpaused">⏸ Generation is paused — queued lessons wait, running ones finish.</div>` : '')
      + `<div class="axbar"><button class="xs-btn ${d.paused ? 'ok' : 'ghost'}" data-a="pr">${d.paused ? '▶ Resume queue' : '⏸ Pause queue'}</button>`
      + `<button class="xs-btn ghost" data-a="cf" ${nErr ? '' : 'disabled'}>🧹 Clear failed${nErr ? ' (' + nErr + ')' : ''}</button></div>`
      + `<div class="axprov">${PROVIDERS.map(([l, v]) => { const on = pool.some(p => v === 'local/' ? p.indexOf('local/') === 0 : p === v); return `<div class="chip sm ${on ? 'on' : ''}" data-v="${e2(v)}">${l}</div>`; }).join('')}</div>`;
    const bk = d.bake || {};
    if ((bk.running || []).length || (bk.queued || []).length) {
      bar.insertAdjacentHTML('beforeend', `<div class="axlane"><b>🔊 Audio lane</b> — ${(bk.running || []).length} baking · ${(bk.queued || []).length} queued`
        + (bk.running || []).map(r => `<div class="qi"><span>▶ ${e2(r.slug)} · ${e2(r.engine)}</span><button class="xs-btn warn" data-cx="${e2(r.slug)}">Stop</button></div>`).join('')
        + (bk.queued || []).slice(0, 12).map(r => `<div class="qi"><span>… ${e2(r.slug)} · ${e2(r.engine)}</span><button class="xs-btn warn" data-cx="${e2(r.id || r.slug)}">Cancel</button></div>`).join('') + '</div>');
    }
    body.insertBefore(bar, body.querySelector('.actsum').nextSibling);
    bar.querySelector('[data-a=pr]').onclick = async () => { try { await api(d.paused ? '/gen/resume' : '/gen/pause', { method: 'POST' }); toast(d.paused ? 'Queue resumed' : 'Queue paused'); } catch (e) { toast(e.message); } if (typeof renderActivity === 'function') renderActivity(); };
    bar.querySelector('[data-a=cf]').onclick = async () => { try { const r = await api('/jobs/clear-failed', { method: 'POST' }); toast('Cleared ' + (r.removed || 0) + ' failed'); } catch (e) { toast(e.message); } renderActivity(); };
    bar.querySelectorAll('[data-v]').forEach(c => c.onclick = async () => {
      const v = c.dataset.v, cur = pool.slice(), has = c.classList.contains('on');
      let next; if (v === 'local/') next = has ? cur.filter(p => p.indexOf('local/') !== 0) : cur.concat((d.local_model || 'local/qwen2.5:7b'));
      else next = has ? cur.filter(p => p !== v) : cur.concat(v);
      if (!next.length) { toast('Keep at least one provider on'); return; }
      try { await api('/gen/rotation', { method: 'POST', json: { pool: next } }); } catch (e) { toast('Provider update failed: ' + e.message); } renderActivity(); });
    bar.querySelectorAll('[data-cx]').forEach(b => b.onclick = async () => { try { const r = await api('/cancel/' + encodeURIComponent(b.dataset.cx), { method: 'POST' }); toast(r.ok === false ? 'Nothing to cancel' : 'Stopped'); } catch (e) { toast(e.message); } renderActivity(); });
    // per-card: Cancel (live) + Detail (step timeline / recovery)
    const cards = body.querySelectorAll('.acard');
    cards.forEach((el, i) => {
      const j = all[i]; if (!j) return; const slug = j.slug || j.id, key = j.id;
      const live = j.status === 'queued' || j.status === 'running' || j.status === 'baking';
      let acts = el.querySelector('.aacts'); if (!acts) { acts = document.createElement('div'); acts.className = 'aacts'; el.appendChild(acts); }
      if (live) { const c = document.createElement('button'); c.className = 'abtn retry'; c.textContent = '■ Cancel'; acts.appendChild(c);
        c.onclick = async ev => { ev.stopPropagation(); if (!(await ask('Cancel this job?', 'The lesson text is kept — you can rebake the audio later.', 'Cancel job', true))) return;
          try { const r = await api('/cancel/' + encodeURIComponent(j.id), { method: 'POST' }); toast(r.ok === false ? 'Nothing to cancel' : 'Cancelled'); } catch (e) { toast(e.message); } renderActivity(); }; }
      const dt = document.createElement('button'); dt.className = 'abtn ghost'; dt.textContent = OPEN_DETAIL.has(key) ? '▾ Hide steps' : '▸ Steps'; acts.appendChild(dt);
      const rail = document.createElement('div'); rail.className = 'axrail'; rail.style.display = OPEN_DETAIL.has(key) ? '' : 'none'; rail.innerHTML = RAIL[key] || '<div class="axrec">loading…</div>'; el.appendChild(rail);
      dt.onclick = ev => { ev.stopPropagation(); if (OPEN_DETAIL.has(key)) { OPEN_DETAIL.delete(key); rail.style.display = 'none'; dt.textContent = '▸ Steps'; }
        else { OPEN_DETAIL.add(key); rail.style.display = ''; dt.textContent = '▾ Hide steps'; fillRail(key, slug, rail, j); } };
      if (OPEN_DETAIL.has(key)) fillRail(key, slug, rail, j);
    });
  }

  /* ---------------- Bake (one / batch / all) ---------------- */
  async function bakeSlugs(slugs, title) {
    if (!slugs.length) { toast('Nothing to bake'); return false; }
    const engine = await chooseEngine(title || `Bake audio for ${slugs.length} lesson${slugs.length === 1 ? '' : 's'} — pick an engine:`, slugs);
    if (!engine) return false;
    try {
      if (slugs.length === 1) { await api('/bake/' + encodeURIComponent(slugs[0]) + '?engine=' + engine, { method: 'POST' }); toast('Bake queued — watch Activity'); }
      else { const r = await api('/bake-batch', { method: 'POST', json: { slugs, engine } });
        if (r.ok === false) { toast('Can’t bake now — ' + (r.reason || 'try again later')); return false; }
        toast(`Queued ${r.queued != null ? r.queued : slugs.length} bake(s) on ${engine === 'modal' ? 'Modal' : 'Mac'}`); }
      return true;
    } catch (e) { toast('Bake failed: ' + e.message); return false; }
  }
  async function bakeAll() {
    const engine = await chooseEngine('Bake ALL lessons that still lack audio — pick an engine:', LESSONS.filter(l => l.ready && !(l.clips || 0)).map(l => slugOf(l.id)));
    if (!engine) return;
    try {
      let r;
      if (engine === 'modal') r = await api('/bake-batch', { method: 'POST', json: { slugs: LESSONS.filter(l => l.ready && !(l.clips || 0)).map(l => slugOf(l.id)), engine } });
      else r = await api('/bake-all?engine=mac', { method: 'POST' });
      if (r.ok === false) { toast('Can’t bake now — ' + (r.reason || 'try again later')); return; }
      toast(`Queued ${r.queued || 0} bake(s)`);
    } catch (e) { toast('Bake all failed: ' + e.message); }
  }

  /* ---------------- Library: selection mode (batch generate / bake), generate-next-N, corpus, images ---------------- */
  const SEL = new Set();
  const X = { selMode: '' };   // '' | 'gen' | 'bake'
  const keyOf = l => slugOf(l.id);
  function selAction(l) {
    const k = keyOf(l);
    if (X.selMode === 'gen' && !l.ready) return `<span class="btn selb ${SEL.has(k) ? 'on' : ''}" data-selk="${e2(k)}">${SEL.has(k) ? '✓ Chosen' : '○ Choose'}</span>`;
    if (X.selMode === 'bake' && l.ready && !(l.clips || 0)) return `<span class="btn selb ${SEL.has(k) ? 'on' : ''}" data-selk="${e2(k)}">${SEL.has(k) ? '✓ Chosen' : '○ Choose'}</span>`;
    return null;
  }
  const visible = () => LESSONS.filter(match);
  const pickable = () => visible().filter(l => X.selMode === 'gen' ? !l.ready : (l.ready && !(l.clips || 0)));
  function paintXbar() {
    const el = document.getElementById('xbar'); if (!el) return;
    el.innerHTML = `<div class="chip sm ${X.selMode === 'gen' ? 'on' : ''}" data-m="gen">☑ Select</div><div class="chip sm ${X.selMode === 'bake' ? 'on' : ''}" data-m="bake">🔊 Audio</div>`
      + `<div class="chip sm" data-m="img">🖼 Images</div><div class="chip sm" data-m="corpus">⛁ Corpus</div>`;
    el.querySelectorAll('[data-m]').forEach(c => c.onclick = () => {
      const m = c.dataset.m;
      if (m === 'gen' || m === 'bake') { X.selMode = X.selMode === m ? '' : m; SEL.clear(); renderRows(); }
      else if (m === 'corpus') corpusSheet(); else imagesSheet(); });
  }
  function paintSelbar() {
    const bar = document.getElementById('selbar'); if (!bar) return;
    bar.classList.toggle('on', !!X.selMode); if (!X.selMode) { bar.innerHTML = ''; return; }
    const n = SEL.size, all = pickable();
    if (X.selMode === 'gen') bar.innerHTML = `<div class="sr"><span class="lab">${n} chosen</span><button class="xs-btn ghost" data-s="all">All visible (${all.length})</button><button class="xs-btn ghost" data-s="clr">Clear</button></div>
      <div class="sr"><button class="xs-btn" data-s="go" ${n ? '' : 'disabled'} style="flex:1">✦ Generate ${n || ''} chosen</button></div>
      <div class="sr"><span class="lab">or the next</span><input type="number" id="gnN" min="1" max="200" value="10" inputmode="numeric"><button class="xs-btn" data-s="next">✦ Generate</button></div>
      <div style="font-size:11px;color:var(--muted);margin-top:7px">Text only (stage “audio”): audio is baked later from 🔊 Audio.</div>`;
    else bar.innerHTML = `<div class="sr"><span class="lab">${n} chosen</span><button class="xs-btn ghost" data-s="all">All visible (${all.length})</button><button class="xs-btn ghost" data-s="clr">Clear</button></div>
      <div class="sr"><button class="xs-btn" data-s="bake" ${n ? '' : 'disabled'}>🔊 Bake ${n || ''}</button><button class="xs-btn ghost" data-s="bakeall">Bake all missing…</button></div>`;
    bar.querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
      const s = b.dataset.s;
      if (s === 'all') { all.forEach(l => SEL.add(keyOf(l))); renderRows(); }
      else if (s === 'clr') { SEL.clear(); renderRows(); }
      else if (s === 'go') pushGen(LESSONS.filter(l => !l.ready && SEL.has(keyOf(l))));
      else if (s === 'next') { const n2 = Math.max(1, parseInt(document.getElementById('gnN').value) || 10); pushGen(sortLessons(visible()).filter(l => !l.ready).slice(0, n2)); }
      else if (s === 'bake') bakeSlugs([...SEL].filter(k => LESSONS.some(l => keyOf(l) === k && l.ready && !(l.clips || 0)))).then(ok => { if (ok) { SEL.clear(); X.selMode = ''; renderRows(); } });
      else if (s === 'bakeall') bakeAll(); });
  }
  async function pushGen(list) {
    if (!list.length) { toast('Nothing to generate here'); return; }
    const n = list.length;
    if (!(await ask(`Queue ${n} lesson${n === 1 ? '' : 's'}?`, `They are generated as TEXT only, a few at a time; audio is NOT baked (do it later from 🔊 Audio). Large batches take a while.`, `Queue ${n}`))) return;
    let ok = 0, fail = 0; const t = toast;
    for (const l of list) {
      try { const r = await api('/generate', { method: 'POST', json: { domain: l.domain, subject: l.subject || l.system || l.topic || l.title, depth: null, stage: 'audio' } });
        r.job_id ? ok++ : fail++; } catch (e) { fail++; warn('batch generate ' + l.title, e); }
      t(`Queuing… ${ok + fail}/${n}`);
    }
    toast(`Queued ${ok}/${n}${fail ? ' (' + fail + ' failed)' : ''}`); SEL.clear(); X.selMode = ''; renderRows(); if (typeof pollActive === 'function') pollActive();
  }
  function afterRows() {
    paintXbar();
    document.querySelectorAll('#rows [data-selk]').forEach(e => e.onclick = ev => { ev.stopPropagation(); const k = e.dataset.selk; SEL.has(k) ? SEL.delete(k) : SEL.add(k); renderRows(); });
    paintSelbar();
  }
  async function corpusSheet() {
    const s = sheet('Corpus status'); s.body.innerHTML = '<div class="empty"><span class="spinc"></span></div>';
    try { const d = await api('/corpus/status');
      s.body.innerHTML = d.ok ? `<div style="color:var(--ok);font-weight:700;margin-bottom:6px">● Corpus reachable</div>` + Object.entries(d.counts || {}).map(([k, v]) => `<div class="xs-kv"><span>${e2(k)}</span><b>${e2(v)}</b></div>`).join('')
        : `<div class="empty">Corpus unreachable.<br>${e2(d.error || '')}</div>`;
    } catch (e) { s.body.innerHTML = `<div class="empty">⚠ ${e2(e.message)}</div>`; }
  }
  function imagesSheet(prefill) {
    const s = sheet('Real images'); s.body.innerHTML = `<div class="xs-row" style="margin-top:2px"><input class="fi" id="xi-q" placeholder="Concept, e.g. aortic dissection" value="${e2(prefill || '')}"><button class="xs-btn" id="xi-go">Search</button></div><div id="xi-out"></div>`;
    const go1 = () => { const q = s.body.querySelector('#xi-q').value.trim(); if (!q) return; const out = s.body.querySelector('#xi-out'); out.innerHTML = '';
      imageWidget(out, q, { slug: typeof OPEN_SLUG !== 'undefined' ? OPEN_SLUG : null }); };
    s.body.querySelector('#xi-go').onclick = go1; s.body.querySelector('#xi-q').addEventListener('keydown', e => { if (e.key === 'Enter') go1(); });
    if (prefill) go1();
  }

  /* ---------------- lesson ⋯ menu: regenerate · bake · images · corpus ---------------- */
  function lessonMenu() {
    const slug = typeof OPEN_SLUG !== 'undefined' ? OPEN_SLUG : null; if (!slug) return;
    const l = LESSONS.find(x => slugOf(x.id) === slug);
    const title = (document.getElementById('l-title') || {}).textContent || slug;
    const s = sheet(clipOf(title, 40));
    s.body.innerHTML = `<div class="xs-row" style="margin-top:2px"><button class="xs-btn" data-a="bake">🔊 Bake / rebake audio</button><button class="xs-btn ghost" data-a="img">🖼 Real images</button><button class="xs-btn ghost" data-a="corpus">⛁ Corpus</button><button class="xs-btn ghost" data-a="web">💻 Continua sul web</button></div>
      <div style="font-family:var(--fh);font-weight:700;font-size:13px;margin:18px 0 6px">Regenerate this lesson</div>
      <textarea class="xs-ta" id="rg-note" placeholder="Reviewer note (optional) — what should change? e.g. “more on the discriminating features”"></textarea>
      <div class="xs-row"><button class="xs-btn warn" data-a="regen">↻ Regenerate</button></div>`;
    s.body.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
      const a = b.dataset.a;
      if (a === 'bake') { s.close(); bakeSlugs([slug], 'Bake audio for this lesson — pick an engine:'); }
      else if (a === 'img') { s.close(); imagesSheet(l ? (l.subject || l.topic || title) : title); }
      else if (a === 'corpus') { s.close(); corpusSheet(); }
      else if (a === 'web') { s.close(); if (window.ChironHandoff) ChironHandoff.toWeb(); }
      else if (a === 'regen') {
        const note = s.body.querySelector('#rg-note').value.trim();
        if (!(await ask('Regenerate this lesson?', 'It runs the whole generation again (uses model tokens) and replaces the current text.', 'Regenerate', true))) return;
        try { const r = await api('/regenerate/' + encodeURIComponent(slug), { method: 'POST', json: { note } }); s.close(); toast('Regenerating — ' + (r.status || 'queued')); if (typeof pollActive === 'function') pollActive(); }
        catch (e) { toast('Regenerate failed: ' + e.message); } } });
  }
  (function wireMore() { const b = document.getElementById('l-more'); if (b) b.onclick = lessonMenu; })();

  window.ChironX = { api, sheet, ask, chooseEngine, tutorBase, esc: e2, renderMcqs, renderTrain, renderCards, imageWidget, imagesSheet, renderCaptures, afterActivity,
    selAction, afterRows, bakeSlugs, get selMode() { return X.selMode; } };
})();
