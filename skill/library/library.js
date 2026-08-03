/* Chiron Library — data-driven from library.config.json (menu) + library.index.json (lessons).
 * Adding a facet to library.yaml → rebuild → it appears here. Lessons open their own lesson.html
 * (served over http, where audio + nav work). */
'use strict';
const FIELD = { system:'system', subject:'subject', series:'subject', topic:'topic', trend:'trend', lang_level:'level', source:'source' }; // facet → lesson field (series reuses the subject field = the series name)
let CONFIG, LESSONS;
const F = { q:'', sort:'priority', domain:new Set(), facets:{}, hiddenDom:new Set(), hiddenSys:new Set(), selectMode:false, selected:new Set(), showSSM:false };
/* stable selection key for a lesson (ready lessons have id; to-generate slots keyed by domain+descriptor) */
function keyOf(l){ return l.id || (l.domain+'::'+(l.subject||l.system||l.topic||l.title)); }
/* ---- W1 hide-filters: persist which domains/systems are hidden across reloads ---- */
try{ const H=JSON.parse(localStorage.getItem('chiron.hide')||'{}'); (H.dom||[]).forEach(d=>F.hiddenDom.add(d)); (H.sys||[]).forEach(s=>F.hiddenSys.add(s)); }catch(e){}
const saveHide = () => { try{ localStorage.setItem('chiron.hide', JSON.stringify({dom:[...F.hiddenDom], sys:[...F.hiddenSys]})); }catch(e){} };
/* ---- SSM exam questions default OUT of the corpus (they flood the important Chiron subjects); a sidebar switch filters them in ---- */
try{ F.showSSM = JSON.parse(localStorage.getItem('chiron.showSSM')||'false'); }catch(e){}
const saveSSM = () => { try{ localStorage.setItem('chiron.showSSM', JSON.stringify(F.showSSM)); }catch(e){} };
const isSSM = l => l.source==='ssm';
/* ---- offline engine (lifted from the player): Download → cache, Remove → local-only ---- */
const LCACHE = 'chiron-lib-lessons-v1';
const DL = JSON.parse(localStorage.getItem('chiron.dl') || '{}');   // slug → {id, entry}
const DLPROG = {};   // slug → percent while a download is in flight (-1 = unzipping/caching). Not persisted.
const LMAP = {};                                                     // slug → lesson (ready only)
const saveDL = () => localStorage.setItem('chiron.dl', JSON.stringify(DL));
const slugOf = id => id.replace(/\//g, '-');
const mimeFor = p => ({html:'text/html',css:'text/css',js:'text/javascript',mjs:'text/javascript',json:'application/json',mp3:'audio/mpeg',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',svg:'image/svg+xml',wav:'audio/wav',webp:'image/webp',woff2:'font/woff2'}[p.split('.').pop().toLowerCase()] || 'application/octet-stream');
function commonPrefix(ns){ if(ns.length<2) return ''; let p=ns[0]; for(const n of ns){ while(p&&!n.startsWith(p)) p=p.slice(0,-1); if(!p) return ''; } const i=p.lastIndexOf('/'); return i>=0?p.slice(0,i+1):''; }
function pickEntry(rel){ return rel.find(n=>n==='lesson.html') || rel.find(n=>n.endsWith('/lesson.html')) || rel.find(n=>n.endsWith('.html')) || rel[0]; }
const unzip = u8 => new Promise((res,rej)=> fflate.unzip(u8,(e,f)=> e?rej(e):res(f)));

/* ---- Phase 2: the generate-server (:8911) — Wizard + Staging wiring ---- */
const APP_VERSION = '1.1';   // ← bump on every user-facing fix so you can confirm the phone has the latest (shown on the ⚙ button)
// Configurable SERVER ADDRESS (the "⚙ Server" setting). An INSTALLED PWA loads its shell from cache but
// its data fetches resolve to the INSTALL origin — which breaks when the box's LAN IP changes (DHCP).
// Setting a HOST (e.g. http://192.168.0.146:8911) redirects every data/asset fetch to the current box.
const HOST = (localStorage.getItem('chiron.host') || '').replace(/\/+$/, '');
const U = p => HOST ? HOST + '/' + String(p).replace(/^\/+/, '') : p;   // prefix a relative path with HOST (no-op when unset)
const API = HOST || ((location.port === '8911') ? '' : 'http://127.0.0.1:8911');   // same-origin when served by the box; else HOST or localhost (CORS on)
// The ⚙ Server prompt — set/clear the address, then reload so every fetch re-targets it.
window.chironSetServer = function () {
  const cur = HOST || (location.origin.includes('8911') ? location.origin : '');
  const v = prompt('Chiron server address\n(e.g. http://192.168.0.146:8911 — the box’s current LAN IP).\nLeave blank to use this page’s own address.', cur);
  if (v === null) return;
  const clean = v.trim().replace(/\/+$/, '');
  try { if (clean) localStorage.setItem('chiron.host', clean); else localStorage.removeItem('chiron.host'); } catch (e) {}
  location.reload();
};
// Always-present ⚙ button (bottom-right) so you can set the address EVEN IF the library failed to load —
// which is exactly when the box's IP changed. Added on DOMContentLoaded, independent of any data fetch.
addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('chiron-server-btn')) return;
  const b = document.createElement('button');
  b.id = 'chiron-server-btn'; b.innerHTML = '⚙<span style="display:block;font-size:8px;line-height:1;margin-top:1px;opacity:.7">v' + APP_VERSION + '</span>';
  b.title = 'Chiron v' + APP_VERSION + ' — set server address' + (HOST ? ' (now ' + HOST + ')' : '');
  b.setAttribute('style', 'position:fixed;right:10px;bottom:10px;z-index:99999;width:44px;height:44px;border-radius:50%;border:1px solid #ccc;background:#fff;color:#333;font-size:17px;box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center');
  b.onclick = window.chironSetServer;
  document.body.appendChild(b);
});
const DEPTHS = {
  medicine: [['','Auto (detect from subject)'],['primer','Primer — quick, grouped'],['atlas','Atlas — organ-system survey'],['systematic','Systematic — 11-section deep-dive'],['amboss','AMBOSS — clinical']],
  'medical-italian': [['ward','Ward — clinical scene'],['passage','Passage — SSM question']],
  'language-it': [['lesson','Lesson']],
};
const ATLAS_SYSTEMS = ['cardiovascular','respiratory','gastrointestinal','renal','genitourinary','endocrine','metabolic','hematolog','oncolog','neurolog','psychiatr','musculoskeletal','rheumatolog','dermatolog','infectious','immunolog','ent','ophthalmolog','reproductive','obstetric','gynaecolog','gynecolog','geriatric'];
function detectDepthHint(subject, domain){
  if(domain!=='medicine') return '';
  const s=(subject||'').toLowerCase().trim(); if(!s) return '';
  if(s.includes('geriatr')) return 'primer';
  if(ATLAS_SYSTEMS.some(k=>s===k||s.includes(k))) return 'atlas';
  return 'systematic';
}
let GENJOB=null;
let WIZ_IMAGES=[];   // accumulated page captures (File[]) — camera adds one at a time, gallery adds many
function wizRenderImgs(){
  const el=document.getElementById('w-imglist'); if(!el) return;
  el.innerHTML=WIZ_IMAGES.map((f,i)=>`<span class="thumb"><img src="${URL.createObjectURL(f)}" alt=""><button onclick="LIB.wizRmImg(${i})" title="remove">×</button></span>`).join('');
  const c=document.getElementById('w-imgcount'); if(c) c.textContent=WIZ_IMAGES.length?`${WIZ_IMAGES.length} page${WIZ_IMAGES.length>1?'s':''} · OCR'd on generate`:'';
}

async function boot(){
  try {
    CONFIG = await (await fetch(U('library.config.json'))).json();
    LESSONS = (await (await fetch(U('library.index.json?'+Date.now()))).json()).lessons;
  } catch (e) {
    // Can't reach the server (most often: the box's LAN IP changed). Tell the user + point at ⚙ Server.
    const where = HOST || location.origin;
    document.body.insertAdjacentHTML('afterbegin',
      '<div style="margin:14vh auto 0;max-width:340px;text-align:center;font-family:system-ui,sans-serif;color:#333;padding:0 20px">'
      + '<div style="font-size:40px">📡</div><h2 style="margin:8px 0">Can’t reach the library</h2>'
      + '<p style="color:#666;line-height:1.5">Tried <b>' + where + '</b>. The box’s address probably changed.</p>'
      + '<button onclick="window.chironSetServer()" style="margin-top:6px;padding:11px 20px;border:0;border-radius:10px;background:#D94F30;color:#fff;font-size:15px;cursor:pointer">⚙ Set server address</button>'
      + '<p style="color:#999;font-size:12px;margin-top:14px">e.g. http://192.168.0.146:8911<br>Chiron v' + APP_VERSION + '</p></div>');
    return;
  }
  LESSONS.forEach(l => { if (l.ready) LMAP[slugOf(l.id)] = l; });
  F.sort = (CONFIG.sorts[0]||{key:'priority'}).key;
  for (const k of Object.keys(CONFIG.facets)) F.facets[k] = new Set();
  // sort dropdown
  document.getElementById('sort').innerHTML = CONFIG.sorts.map(s=>`<option value="${s.key}">${s.label}</option>`).join('');
  document.getElementById('sort').addEventListener('change', e=>{F.sort=e.target.value;renderRows();});
  document.getElementById('q').addEventListener('input', e=>{F.q=e.target.value;renderRows();});
  matchMedia('(max-width:760px)').addEventListener('change', ()=>renderRows());   // desktop↔phone: toggle storage controls
  // wizard controls
  const wd=document.getElementById('w-domain');
  if(wd){ wd.innerHTML=Object.keys(DEPTHS).map(d=>`<option value="${d}">${domLabel(d)}</option>`).join(''); LIB.wizDepth();
    document.getElementById('w-cam').addEventListener('change', e=>LIB.wizAddImgs(e.target));
    document.getElementById('w-gal').addEventListener('change', e=>LIB.wizAddImgs(e.target)); }
  document.getElementById('themebtn').textContent = document.documentElement.getAttribute('data-theme')==='dark'?'☀️':'🌙';
  const imp=document.getElementById('importfile'); if(imp) imp.addEventListener('change', e=>LIB.importChiron(e.target));
  renderAll();
}
const domCls = d => 'dom-'+d;
const domLabel = d => (CONFIG.domains[d]||{}).label || d;
const count = pred => LESSONS.filter(l => (F.showSSM || !isSSM(l)) && pred(l)).length;

function match(l){
  // SSM exam questions are OUT by default (they'd bury the curated Chiron subjects) — the sidebar switch flips them in.
  if (isSSM(l) && !F.showSSM) return false;
  // W1 hide-filters take precedence — a hidden domain/system is removed everywhere, incl. search.
  if (F.hiddenDom.has(l.domain)) return false;
  if (l.system && F.hiddenSys.has(l.system)) return false;
  if (F.q){ const s=(l.title+' '+(l.system||'')+' '+(l.subject||'')+' '+(l.topic||'')).toLowerCase(); if(!s.includes(F.q.toLowerCase())) return false; }
  if (F.domain.size && !F.domain.has(l.domain)) return false;
  for (const [k,set] of Object.entries(F.facets)){
    if (!set.size) continue;
    const fld = FIELD[k]; if (!fld) continue;          // range/sparkline facets: not filterable yet
    if (!(l[fld] && set.has(l[fld]))) return false;
  }
  return true;
}
function sortLessons(a){ a=[...a];
  // priority score: queued classes ranked by exam priority + a do-first bankable bonus
  // (mirrors study_plan.py's fused score, priority + 4×gimme-repeats); ready lessons float on 500+clips
  const pri = l => l.priority!=null ? l.priority + 4*(l.bankable||0) : (l.ready?500:0)+(l.clips||0);
  if (F.sort==='priority') a.sort((x,y)=>pri(y)-pri(x));
  if (F.sort==='bankable') a.sort((x,y)=>(y.bankable||0)-(x.bankable||0) || (y.priority||0)-(x.priority||0));
  if (F.sort==='recent')   a.sort((x,y)=>(y.ready-x.ready)|| (y.mtime||0)-(x.mtime||0));
  if (F.sort==='title')    a.sort((x,y)=>x.title.localeCompare(y.title));
  if (F.sort==='clips')    a.sort((x,y)=>(y.clips||0)-(x.clips||0));
  return a;
}
/* ---- pills: secondary facets of type 'pills' (domain + system now live in the hide-rail) ---- */
function renderPills(){
  let h = '';
  for (const [k,f] of Object.entries(CONFIG.facets)){
    if (f.type!=='pills' || !FIELD[k]) continue;
    // 'source: derived' facets discover their values from the lessons at runtime (keeps external
    // source names out of the committed config); others use the fixed vocab in library.yaml.
    const vals = (f.source==='derived') ? [...new Set(LESSONS.map(l=>l[FIELD[k]]).filter(Boolean))].sort() : (f.values||[]);
    if (!vals.length) continue;
    h += `<span class="sep"></span><span class="pgl">${f.label}</span>`;
    for (const v of vals){ const n=count(l=>l[FIELD[k]]===v); if(!n) continue;
      const disp = (CONFIG.sources && CONFIG.sources[v] && CONFIG.sources[v].label) || (v[0]+v.slice(1).toLowerCase());
      h += `<button class="pill ${F.facets[k].has(v)?'on':''}" onclick="LIB.tog('${k}','${cssq(v)}')">${disp}<span class="ct">${n}</span></button>`; }
  }
  const pel = document.getElementById('pills');
  pel.innerHTML = h; pel.style.display = h.trim() ? '' : 'none';
}
/* ---- W1 hide-rail: domain + system, click a row to gray it out & drop it from the wall ---- */
const CHK = '<span class="box"><svg viewBox="0 0 12 12"><path d="M2 6l3 3 5-6"/></svg></span>';
const domCode = d => ({medicine:'m','medical-italian':'mi','language-it':'l',italian:'l','video-it':'l',code:'l'}[d] || 'm');
function railSystems(){ const L=LESSONS.filter(l=>F.showSSM||!isSSM(l)); return [...new Set(L.map(l=>l.system).filter(Boolean))]
  .map(s=>[s, L.filter(l=>l.system===s).length]).sort((a,b)=>b[1]-a[1]); }
function renderFacets(){                                        // (id="facets" kept; now the hide-rail)
  const doms = Object.keys(CONFIG.domains).map(d=>[d, count(l=>l.domain===d)]).filter(([,n])=>n);
  const anyDomHidden = [...F.hiddenDom].some(d=>doms.some(([k])=>k===d));
  const anySysHidden = F.hiddenSys.size>0;
  const nssm = LESSONS.filter(isSSM).length;
  let h = `<div class="hgrp">SSM exam questions</div>`
    + `<div class="ssmrow ${F.showSSM?'on':''}" onclick="LIB.toggleSSM()" title="${F.showSSM?'Hide':'Show'} the ${nssm} SSM exam-question lessons">`
      + `<span class="ssmsw"><span class="ssmknob"></span></span><span class="hn">🎯 SSM questions</span><span class="hc">${nssm}</span></div>`
    + `<div class="fhint" style="padding:2px 16px 6px">${F.showSSM?'Shown — mixed in with their subjects.':'Hidden by default so they don’t bury the other Chiron subjects.'}</div>`
    + `<a class="ssmgen" href="${location.protocol}//${location.hostname}:5191" target="_blank" rel="noopener" title="SSM questions are generated in the SSM app → Batch Lessons → 📝 Exam (they land here as SSM lessons)">＋ Generate SSM questions →</a>`
    + `<div class="hgrp">Domain <span class="unhide ${anyDomHidden?'':'dim'}" onclick="LIB.unhideDoms()">Unhide all</span></div>`;
  for (const [d,n] of doms){ const c=domCode(d), off=F.hiddenDom.has(d);
    h += `<div class="hrow ${c} ${off?'off':'vis'}" onclick="LIB.hideDom('${d}')" title="${off?'Show':'Hide'} ${domLabel(d)}">${CHK}<span class="hn">${domLabel(d)}</span><span class="hc">${n}</span></div>`; }
  h += `<div class="hgrp">System <span class="unhide ${anySysHidden?'':'dim'}" onclick="LIB.unhideSys()">Unhide all</span></div>`;
  for (const [s,n] of railSystems()){ const off=F.hiddenSys.has(s);
    // color the system dot by the dominant domain that carries it
    const dom = (LESSONS.find(l=>l.system===s)||{}).domain || 'medicine', c=domCode(dom);
    h += `<div class="hrow ${c} ${off?'off':'vis'}" onclick="LIB.hideSys('${cssq(s)}')" title="${off?'Show':'Hide'} ${s}">${CHK}<span class="hn">${s}</span><span class="hc">${n}</span></div>`; }
  h += `<div class="fhint" style="padding:10px 16px">Tap a row to hide it. A lesson shows only when both its domain and its system are visible.</div>`;
  h += `<div class="sheet-apply"><button onclick="LIB.sheet(false)">Show results</button></div>`;
  document.getElementById('facets').innerHTML = h;
}
function childFacetOf(parentKey){ for (const [k,f] of Object.entries(CONFIG.facets)) if (f.nestUnder===parentKey) return k; return null; }
// escape ANY free text for a single-quoted JS arg inside a double-quoted onclick="" attr.
// order matters: backslash first, then ' -> \' (survives HTML-attr decoding, unlike &#39;),
// " -> &quot; (else it closes the attr), < -> &lt;, newlines -> space. Apostrophes are KEPT
// (Italian l'/c'/un' etc. display correctly) — never stripped. Used for EVERY onclick free-text arg.
const cssq = s => String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/[\r\n]+/g,' ');
function crumb(){ const p=[];
  if (F.domain.size) p.push([...F.domain].map(domLabel).join('/'));
  for (const [k,set] of Object.entries(F.facets)){ if(!set.size) continue; const t=[...set].join('/'); p.push(k==='subject'?'<b>'+t+'</b>':t); }
  return p.length?'· '+p.join(' › '):''; }
/* ---- W1 tile wall (replaces the list rows) ---- */
function subtagOf(l){ return (l.scope==='system' && l.system) ? l.system
  : (l.subject || l.system || l.topic || l.level || 'General'); }
function hideChips(){
  const chips = [...[...F.hiddenDom].map(d=>({t:'dom',k:d,label:domLabel(d)})),
                 ...[...F.hiddenSys].map(s=>({t:'sys',k:s,label:s}))];
  if(!chips.length) return '';
  return `<div class="hidechips">${chips.map(c=>`<span class="hchip" onclick="LIB.unhideOne('${c.t}','${cssq(c.k)}')" title="show ${c.label}">${c.label} <b>✕</b></span>`).join('')}
    <span class="hchip" onclick="LIB.unhideAll()" style="border-color:var(--chiron-accent);color:var(--chiron-accent)">↺ Unhide all</span></div>`;
}
function tileHtml(l){
  const slug = l.ready ? slugOf(l.id) : null;
  const isPhone = matchMedia('(max-width:760px)').matches;
  const dl = slug && DL[slug];
  const staged = l.ready && l.status==='staged';
  const selectable = (F.selectMode && !l.ready) || (F.bakeMode && l.ready && (l.clips||0)===0);
  const isSel = selectable && F.selected.has(keyOf(l));
  let action;
  if(!l.ready) action = selectable ? '' : `<span class="taction gen" onclick="event.stopPropagation();LIB.genFor('${cssq(l.subject||l.system||l.topic||l.title)}','${l.domain}')">✦ Generate</span>`;
  else if(staged) action = `<span class="taction open">👁 Preview</span><span class="taction acc" onclick="event.stopPropagation();LIB.accept('${slug}')">✓ Accept</span>`;
  else if(isPhone) action = dl ? `<span class="taction dl">✓ offline</span>`
      : (DLPROG[slug]!==undefined
          ? `<span class="taction dling" data-dlprog="${slug}">⏳ ${DLPROG[slug]<0?'unzipping…':(DLPROG[slug]+'%')}</span>`
          : (l.bundle ? `<span class="taction dl" onclick="event.stopPropagation();LIB.download('${slug}')">⬇ Get</span>`
                      : `<span class="taction open" onclick="event.stopPropagation();LIB.open('${slug}')">Open →</span>`));
  else action = (l.bundle ? `<span class="taction dl" title="download .chiron bundle" onclick="event.stopPropagation();LIB.dlfile('${slug}')">⬇</span>` : '')
              + `<span class="taction open">Open →</span>`;
  const badges = (staged?`<span class="treview">🟡 REVIEW</span>`:'') + (l.bankable>0?`<span class="tbank">💰 ${l.bankable}</span>`:'')
    + (l.scope==='system'?`<span class="tag sys">organ system</span>`:'');
  const onclick = selectable ? ` onclick="LIB.togSel('${cssq(keyOf(l))}')"` : (l.ready ? ` onclick="LIB.open('${slug}')"` : '');
  const selCls = selectable ? ' selectable' + (isSel?' selected':'') : '';
  return `<div class="tcard ${l.domain}${l.ready?'':' queued'}${l.bankable>0?' bankq':''}${selCls}"${onclick}>
    ${selectable?`<span class="selmark${isSel?' on':''}">${isSel?'✓':''}</span>`:''}
    <div class="tb"><div class="tt">${l.title}</div><div class="ts">${subtagOf(l)}</div>${badges?`<div class="tbadges">${badges}</div>`:''}</div>
    <div class="tf"><span class="db">${domLabel(l.domain)}</span>${l.ready?(l.clips>0?`<span class="tclips baked" title="audio baked (${l.clips} clips) · click to re-bake (⚡Fast / 🐢Mac)" onclick="event.stopPropagation();LIB.rebake('${slug}')">🔊 ${l.clips}</span>`:`<button class="tbake" title="text-only — bake the audio now (⚡Fast / 🐢Mac)" onclick="event.stopPropagation();LIB.rebake('${slug}')">🔊 Bake audio</button>`):'<span class="tclips">not generated</span>'}${action}</div>
  </div>`;
}
function renderRows(){
  const list = sortLessons(LESSONS.filter(match));
  const nReady = list.filter(l=>l.ready).length, nQueued = list.length - nReady;
  document.getElementById('rcount').textContent = nQueued
    ? `${nReady} ready · ${nQueued} to generate`
    : `${nReady} lesson${nReady===1?'':'s'} ready`;
  document.getElementById('crumb').innerHTML = crumb();
  const staged = list.filter(l=>l.ready && l.status==='staged');
  const ready  = list.filter(l=>l.ready && l.status!=='staged');
  const queued = list.filter(l=>!l.ready);
  // Bake-audio mode: generated lessons that have NO audio yet (text-only), so you can batch-bake them.
  const bakeable = [...staged, ...ready].filter(l=>(l.clips||0)===0);
  // Select mode shows ONLY the to-generate cards; Bake mode shows ONLY generated lessons without audio.
  const ordered = F.selectMode ? queued : F.bakeMode ? bakeable : [...staged, ...ready, ...queued];
  const parts = [ hideChips() ];
  if (F.selectMode) parts.push(`<div class="selband">☑ <b>Select mode</b> — tap the specific lessons you want to generate (text only). <b>${F.selected.size}</b> selected · showing the ${queued.length} still to generate. Then hit <b>Generate</b> in the bar at the bottom.</div>`);
  else if (F.bakeMode) parts.push(`<div class="selband bake">🔊 <b>Bake-audio mode</b> — tap the generated lessons you want to add AUDIO to (text-only, no audio baked yet). <b>${F.selected.size}</b> selected · ${bakeable.length} still need audio. Then hit <b>Bake audio</b> (⚡Fast / 🐢Mac) in the bar at the bottom.</div>`);
  else if (staged.length) parts.push(`<div class="reviewband">🟡 Needs Review — ${staged.length} newly generated lesson${staged.length===1?'':'s'}, not yet published. Open to review, then Accept to publish.</div>`);
  parts.push(ordered.length
    ? `<div class="twall"><div class="tgrid">${ordered.slice(0,800).map(tileHtml).join('')}</div></div>`
    : `<div class="empty">No lessons match — ${F.hiddenDom.size||F.hiddenSys.size?'unhide a facet in the sidebar':'try a different search'}.</div>`);
  document.getElementById('rows').innerHTML = parts.join('');
  // ---- select-mode: reflect the toggle + render the floating batch bar ----
  const sb=document.getElementById('selbtn'); if(sb) sb.classList.toggle('on', F.selectMode);
  const kb=document.getElementById('bakebtn'); if(kb) kb.classList.toggle('on', F.bakeMode);
  let bb=document.getElementById('batchbar');
  if(F.selectMode || F.bakeMode){
    if(!bb){ bb=document.createElement('div'); bb.id='batchbar'; bb.className='batchbar'; document.body.appendChild(bb); }
    const nsel=F.selected.size;
    if(F.selectMode){
      bb.innerHTML=`<span>${nsel} selected</span>`
        +`<button class="ball" onclick="LIB.selectAllVisible()">Select all visible (${queued.length})</button>`
        +`<button class="bclr" onclick="LIB.clearSel()">Clear</button>`
        +`<button class="bgen" ${nsel?'':'disabled'} onclick="LIB.genBatch()">✦ Generate ${nsel} → (text only)</button>`
        +`<button class="bclr" onclick="LIB.toggleSelectMode()">✕ Exit</button>`;
    } else {
      bb.innerHTML=`<span>${nsel} selected · no audio yet</span>`
        +`<button class="ball" onclick="LIB.selectAllVisibleBake()">Select all visible (${bakeable.length})</button>`
        +`<button class="bclr" onclick="LIB.clearSel()">Clear</button>`
        +`<button class="bgen" ${nsel?'':'disabled'} onclick="LIB.bakeBatch()">🔊 Bake audio ${nsel} → (⚡Fast / 🐢Mac)</button>`
        +`<button class="bclr" onclick="LIB.toggleBakeMode()">✕ Exit</button>`;
    }
  } else if(bb){ bb.remove(); }
}
function renderAll(){ renderPills(); renderFacets(); renderRows(); }
const LIB = {
  // Provider-rotation toggle labels for the jobs-panel override (R-PROVIDER-OVERRIDE) — value must
  // match a model string the server's CH_PRIMARY_ROTATION / _PRIMARY_POOL understands.
  PROVIDERS: [
    {label:'🏠 Local (Mac)', value:'local/qwen2.5:7b', title:'Mac governor — ZERO cloud tokens (slower). Value auto-syncs to the server\'s CH_LOCAL_MODEL.'},
    {label:'🐢 Ollama Cloud', value:'glm-5.1', title:'Ollama Cloud (glm-5.1) — free tier'},
    {label:'⚡ Gemini', value:'gemini/gemini-flash-latest', title:'Gemini flash — cheap'},
    {label:'💲 GPT-5-mini', value:'gpt-5-mini', title:'paid — untick to save tokens'},
  ],
  togDom(d){ F.domain.has(d)?F.domain.delete(d):F.domain.add(d); renderAll(); },
  /* ---- W1 hide-filters ---- */
  hideDom(d){ F.hiddenDom.has(d)?F.hiddenDom.delete(d):F.hiddenDom.add(d); saveHide(); renderAll(); },
  hideSys(s){ F.hiddenSys.has(s)?F.hiddenSys.delete(s):F.hiddenSys.add(s); saveHide(); renderAll(); },
  unhideDoms(){ F.hiddenDom.clear(); saveHide(); renderAll(); },
  unhideSys(){ F.hiddenSys.clear(); saveHide(); renderAll(); },
  unhideOne(t,k){ (t==='dom'?F.hiddenDom:F.hiddenSys).delete(k); saveHide(); renderAll(); },
  unhideAll(){ F.hiddenDom.clear(); F.hiddenSys.clear(); saveHide(); renderAll(); },
  toggleSSM(){ F.showSSM=!F.showSSM; saveSSM(); if(!F.showSSM){ F.selected.clear(); } renderAll(); },
  tog(k,v){ const s=F.facets[k]; s.has(v)?s.delete(v):s.add(v);
    // deselecting a parent clears its nested children
    const child=childFacetOf(k); if(child && !s.has(v)){ const map=CONFIG.facets[child].valuesBySystem?.[v]||[]; map.forEach(sv=>F.facets[child].delete(sv)); }
    renderAll(); },
  clearAll(){ F.q=''; F.domain.clear(); Object.values(F.facets).forEach(s=>s.clear()); F.hiddenDom.clear(); F.hiddenSys.clear(); saveHide(); document.getElementById('q').value=''; renderAll(); },
  sheet(open){ document.getElementById('facets').classList.toggle('open',open); document.getElementById('backdrop').classList.toggle('show',open); },
  open(slug){ const l=LMAP[slug]; if(!l) return; const dl=DL[slug];
    let url;
    if(dl){ url='lessons/'+dl.id+'/'+dl.entry; }                                     // offline cache (SW)
    else { const entry=(l.path||'lesson.html').split('/').pop();
      // served by the generate-server → its /lessons mount (=generated/); else ../ (page sits in generated/chiron-library)
      url=(API || location.port==='8911') ? (API+'/lessons/'+l.id+'/'+entry) : ('../'+l.path); }   // API=HOST when the ⚙ Server address is set
    LIB._overlay(url, l.title || slug); },
  // open a lesson INSIDE the library (iframe overlay) with a persistent "← Library" bar, so you can
  // always get home — works for every existing lesson + on the phone (no browser chrome needed).
  _overlay(url, title){
    let ov=document.getElementById('lessonOverlay');
    if(!ov){
      ov=document.createElement('div'); ov.id='lessonOverlay';
      ov.innerHTML='<div class="lov-bar"><button class="lov-back" onclick="LIB._overClose()">← Library</button>'
        +'<span class="lov-title"></span><a class="lov-ext" target="_blank" title="open in new tab">↗</a></div>'
        +'<iframe class="lov-frame" referrerpolicy="no-referrer"></iframe>';
      document.body.appendChild(ov);
      const st=document.createElement('style'); st.textContent=
        '#lessonOverlay{position:fixed;inset:0;z-index:99999;display:none;flex-direction:column;background:#0c1117}'
        +'#lessonOverlay.show{display:flex}'
        +'.lov-bar{display:flex;align-items:center;gap:12px;padding:10px 14px;background:#0f172a;color:#e5e7eb;border-bottom:1px solid #1f2a37;flex:none;padding-top:calc(10px + env(safe-area-inset-top))}'
        +'.lov-back{background:#14b8a6;color:#04211d;border:0;border-radius:9px;padding:8px 14px;font:700 14px system-ui;cursor:pointer;white-space:nowrap}'
        +'.lov-back:hover{background:#2dd4bf}'
        +'.lov-title{flex:1;min-width:0;font:600 14px system-ui;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
        +'.lov-ext{color:#94a3b8;text-decoration:none;font-size:18px;padding:2px 6px}'
        +'.lov-frame{flex:1;border:0;width:100%;background:#fff}';
      document.head.appendChild(st);
      window.addEventListener('popstate', ()=>{ const o=document.getElementById('lessonOverlay'); if(o && o.classList.contains('show')) LIB._overClose(true); });
    }
    ov.querySelector('.lov-title').textContent = title || '';
    ov.querySelector('.lov-ext').href = url;
    // CACHE-BUST every lesson open: a unique ?ts= means Safari/iOS can never serve a stale cached lesson page
    // (the recurring "works on desktop, stale on the phone" bug — no-cache headers don't reach an already-cached copy).
    ov.querySelector('.lov-frame').src = url + (url.includes('?') ? '&' : '?') + 'ts=' + Date.now();
    ov.classList.add('show');
    try{ history.pushState({lov:1}, ''); }catch(e){}   // so hardware/browser Back closes the lesson, not the app
  },
  _overClose(fromPop){
    const ov=document.getElementById('lessonOverlay'); if(!ov) return;
    ov.classList.remove('show'); ov.querySelector('.lov-frame').src='about:blank';
    if(!fromPop){ try{ history.back(); }catch(e){} }   // keep history in sync when closed via the button
  },
  // ---- batch generation: multi-select OR "generate next N" → push TEXT-ONLY jobs (audio baked later) ----
  toggleSelectMode(){ F.selectMode=!F.selectMode; F.bakeMode=false; if(!F.selectMode) F.selected.clear(); renderAll(); },
  toggleBakeMode(){ F.bakeMode=!F.bakeMode; F.selectMode=false; F.selected.clear(); renderAll(); },
  togSel(k){ F.selected.has(k)?F.selected.delete(k):F.selected.add(k); renderRows(); },
  selectAllVisible(){ sortLessons(LESSONS.filter(match)).filter(l=>!l.ready).forEach(l=>F.selected.add(keyOf(l))); renderRows(); },
  selectAllVisibleBake(){ sortLessons(LESSONS.filter(match)).filter(l=>l.ready && (l.clips||0)===0).forEach(l=>F.selected.add(keyOf(l))); renderRows(); },
  // Batch-bake AUDIO for the selected generated-but-audio-less lessons (⚡Fast / 🐢Mac at click time).
  async bakeBatch(){
    const sel=LESSONS.filter(l=>l.ready && (l.clips||0)===0 && F.selected.has(keyOf(l)));
    if(!sel.length){ alert('Pick at least one generated lesson that has no audio yet.'); return; }
    const slugs=sel.map(l=>slugOf(l.id));
    const engine=await this._chooseEngine(`Bake audio for ${slugs.length} lesson${slugs.length===1?'':'s'} — pick an engine:`, slugs);
    if(!engine) return;
    try{ const r=await (await fetch(API+'/bake-batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slugs,engine})})).json();
      if(r&&r.ok===false){ alert('Can’t bake now — '+(r.reason||'try again later')); return; }
      if(r&&r.slugs&&LIB._rec) r.slugs.forEach(s=>delete LIB._rec[s]);
      const n=(r&&r.queued!=null)?r.queued:slugs.length;
      alert(`Queued audio bake for ${n} lesson${n===1?'':'s'} on ${engine==='modal'?'⚡ Modal (fast)':'🐢 Mac'}. Watch the 🔊 Rebake lane in the Jobs tray.`);
      F.selected.clear(); F.bakeMode=false; renderAll(); if(LIB._loadJobs) LIB._loadJobs();
    }catch(e){ alert('Bake failed: '+e.message); } },
  clearSel(){ F.selected.clear(); renderRows(); },
  genBatch(){ const sel=LESSONS.filter(l=>!l.ready && F.selected.has(keyOf(l))); LIB._pushGen(sel); },
  genNext(){ const n=Math.max(1,parseInt(document.getElementById('gennextN').value)||10);
    const list=sortLessons(LESSONS.filter(match)).filter(l=>!l.ready).slice(0,n); LIB._pushGen(list); },
  async _pushGen(lessons){
    if(!lessons.length){ alert('Nothing to generate here.'); return; }
    const n=lessons.length;
    if(!confirm(`Queue ${n} lesson${n===1?'':'s'} for TEXT generation?\n\nThey run 2 at a time; audio is NOT baked (rebake later from the jobs tray — ⚡Fast or 🐢Mac). Large batches take a while.`)) return;
    const rc=document.getElementById('rcount'); let ok=0, fail=0;
    for(const l of lessons){
      const subject=l.subject||l.system||l.topic||l.title, domain=l.domain;
      try{ const r=await (await fetch(API+'/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({domain,subject,depth:null,stage:'audio'})})).json();  // 'audio' = text page + narration TRANSCRIPTS (no synth) → bakeable later. 'assemble' skips the transcript phase.
        (r&&r.job_id)?ok++:fail++;
      }catch(e){ fail++; }
      if(rc) rc.textContent=`queuing… ${ok+fail}/${n}`;
    }
    alert(`Queued ${ok}/${n} for text generation${fail?` (${fail} failed)`:''}.\nThey generate 2 at a time — watch the Jobs tray. Bake audio later with the ⚡/🐢 rebake buttons.`);
    F.selected.clear(); F.selectMode=false; renderAll();
    if(LIB._loadJobs) LIB._loadJobs();
  },
  genFor(subject,domain){ LIB.wizard(true);
    document.getElementById('w-subject').value=subject||'';
    if(domain && DEPTHS[domain]){ document.getElementById('w-domain').value=domain; LIB.wizDepth(); }
    LIB.wizHint(); },
  dlfile(slug){ const a=document.createElement('a'); a.href='lessons/'+slug+'.chiron'; a.download=slug+'.chiron';
    document.body.appendChild(a); a.click(); a.remove(); },
  async download(slug){ const l=LMAP[slug]; if(!l || DL[slug] || DLPROG[slug]!==undefined) return;
    // live progress (these bundles are big — video + audio), so it never looks like a flat freeze.
    DLPROG[slug]=0; renderRows();
    const setPct=(p)=>{ DLPROG[slug]=p; const el=document.querySelector('[data-dlprog="'+slug+'"]');
      if(el) el.textContent = '⏳ ' + (p<0?'unzipping…':(p+'%')); };
    try{
      const resp = await fetch(U('lessons/'+slug+'.chiron'));
      if(!resp.ok) throw new Error('HTTP '+resp.status);
      const total = +(resp.headers.get('Content-Length')||0);
      let u8;
      if(resp.body && resp.body.getReader && total){          // stream → real % as bytes arrive
        const reader=resp.body.getReader(); const chunks=[]; let recv=0;
        for(;;){ const {done,value}=await reader.read(); if(done) break; chunks.push(value); recv+=value.length; setPct(Math.min(99, Math.floor(recv/total*100))); }
        u8=new Uint8Array(recv); let o=0; for(const c of chunks){ u8.set(c,o); o+=c.length; }
      } else { u8=new Uint8Array(await resp.arrayBuffer()); }  // fallback: no stream/length → indeterminate
      setPct(-1);                                              // downloaded → unzipping + caching
      const files = await unzip(u8);
      const names = Object.keys(files).filter(n=>!n.endsWith('/') && !n.includes('__MACOSX'));
      const prefix = commonPrefix(names), rel = n => prefix && n.startsWith(prefix) ? n.slice(prefix.length) : n;
      const id = 'dl-'+slug, cache = await caches.open(LCACHE);
      for(const n of names){ const path=rel(n), bytes=files[n];
        await cache.put(new Request(new URL('lessons/'+id+'/'+path, location.href)), new Response(bytes, {headers:{'Content-Type':mimeFor(path)}})); }
      delete DLPROG[slug];
      DL[slug] = { id, entry: pickEntry(names.map(rel)) }; saveDL(); renderRows();
    } catch(e){ delete DLPROG[slug]; renderRows(); alert('Download failed: '+e.message); } },
  async remove(slug){ const dl=DL[slug]; if(!dl) return; const cache=await caches.open(LCACHE);
    const keys=await cache.keys();
    await Promise.all(keys.filter(r=>new URL(r.url).pathname.includes('/lessons/'+dl.id+'/')).map(r=>cache.delete(r)));
    delete DL[slug]; saveDL(); renderRows(); },
  /* ---- import a shared .chiron file → unzip into the offline cache (sideload) ---- */
  async importChiron(input){ const f=input.files&&input.files[0]; if(!f) return; input.value='';
    try{
      const slug=(f.name||'imported').replace(/\.(chiron|zip)$/i,'');
      const files=await unzip(new Uint8Array(await f.arrayBuffer()));
      const names=Object.keys(files).filter(n=>!n.endsWith('/') && !n.includes('__MACOSX'));
      if(!names.some(n=>/\.html$/.test(n))) throw new Error('no lesson HTML in this bundle');
      const prefix=commonPrefix(names), rel=n=>prefix && n.startsWith(prefix)?n.slice(prefix.length):n;
      const id='dl-'+slug, cache=await caches.open(LCACHE);
      for(const n of names){ const path=rel(n);
        await cache.put(new Request(new URL('lessons/'+id+'/'+path, location.href)), new Response(files[n],{headers:{'Content-Type':mimeFor(path)}})); }
      DL[slug]={ id, entry: pickEntry(names.map(rel)) }; saveDL();
      // sideloaded lesson not in the index → synthesize a minimal entry so it lists + opens
      if(!LMAP[slug]){
        let title=slug, dom='medicine';
        try{ const cjn=names.find(n=>/(^|\/)chiron\.json$/.test(n));
          if(cjn){ const cj=JSON.parse(new TextDecoder().decode(files[cjn])); title=cj.title||slug;
            dom=(cj.domain==='language-it')?'medical-italian':(cj.domain||'medicine'); } }catch(e){}
        const clips=names.filter(n=>/\.mp3$/.test(n)).length;
        LESSONS.push({id:slug,title,domain:dom,system:null,subject:null,topic:null,level:null,scope:'disease',trend:null,status:'published',clips,ready:true,mtime:0,bundle:false,imported:true});
        LMAP[slug]=LESSONS[LESSONS.length-1];
      }
      renderRows();
      alert('Imported "'+(LMAP[slug]?LMAP[slug].title:slug)+'" — now available offline on this device.');
    }catch(e){ alert('Import failed: '+e.message); } },

  /* ---- theme (single 🌙/☀️ toggle) ---- */
  theme(){ const dark=document.documentElement.getAttribute('data-theme')==='dark', nx=dark?'light':'dark';
    document.documentElement.setAttribute('data-theme',nx);
    try{localStorage.setItem('chiron.theme',nx);}catch(e){}
    document.getElementById('themebtn').textContent=nx==='dark'?'☀️':'🌙'; },

  /* ---- Wizard ---- */
  wizard(open){ document.getElementById('wizback').classList.toggle('show',open);
    if(open){ document.getElementById('wizform').style.display=''; document.getElementById('wizprog').style.display='none';
      WIZ_IMAGES=[]; wizRenderImgs(); setTimeout(()=>document.getElementById('w-subject').focus(),50); } },
  wizAddImgs(input){ [...input.files].forEach(f=>WIZ_IMAGES.push(f)); input.value=''; wizRenderImgs(); },
  wizRmImg(i){ WIZ_IMAGES.splice(i,1); wizRenderImgs(); },
  wizDepth(){ const d=document.getElementById('w-domain').value;
    document.getElementById('w-depth').innerHTML=(DEPTHS[d]||[]).map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
    LIB.wizHint(); },
  wizHint(){ const subj=document.getElementById('w-subject').value, dom=document.getElementById('w-domain').value, dep=document.getElementById('w-depth').value, h=document.getElementById('w-hint');
    if(dom==='medicine' && !dep){ const det=detectDepthHint(subj,dom); h.innerHTML=det?`Auto → <b>${det}</b> lesson`:'Type a subject — depth auto-detects (system→atlas · disease→systematic · geriatrics→primer)'; }
    else h.innerHTML=''; },
  async genSubmit(){
    const subject=document.getElementById('w-subject').value.trim();
    if(!subject){ document.getElementById('w-subject').focus(); return; }
    const domain=document.getElementById('w-domain').value;
    const depth=document.getElementById('w-depth').value || null;
    const grounding=document.getElementById('w-grounding').value.trim() || null;
    const stage=document.getElementById('w-nobake').checked?'audio':'all';  // 'audio' = page + transcripts, no synth (bakeable later); NOT 'assemble' (which skips the transcript phase)
    const btn=document.querySelector('.btn-gen'); btn.disabled=true; btn.textContent='Starting…';
    try{
      let images=null;
      if(WIZ_IMAGES.length){ const fd=new FormData(); WIZ_IMAGES.forEach((f,i)=>fd.append('files',f,f.name||`page-${i+1}.jpg`));
        images=(await (await fetch(API+'/upload',{method:'POST',body:fd})).json()).paths; }
      let r=await (await fetch(API+'/generate',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({domain,subject,depth,grounding,images,stage})})).json();
      // Atlas pre-validation: the subject isn't an organ-system overview → offer to switch to systematic.
      if(r && r.needs_switch){
        if(confirm(`${r.reason}`)){
          r=await (await fetch(API+'/generate',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({domain,subject,depth:r.suggested_depth||'systematic',grounding,images,stage})})).json();
        } else { btn.disabled=false; btn.textContent='✦ Generate'; return; }
      }
      if(!r.job_id) throw new Error(r.detail||r.reason||'generate failed');
      GENJOB=r.job_id; LIB._showProg(r); LIB._poll(r.job_id);
    }catch(e){ alert('Generate failed: '+e.message); }
    btn.disabled=false; btn.textContent='✦ Generate';
  },
  _showProg(r){ document.getElementById('wizform').style.display='none';
    const pg=document.getElementById('wizprog'); pg.style.display='';
    document.getElementById('p-title').textContent=`Generating: ${r.slug||''}${r.depth?' ('+r.depth+')':''}`;
    document.getElementById('p-open').style.display='none'; document.getElementById('p-log').textContent='';
    LIB._renderSteps('queued'); },
  _renderSteps(phase){
    const order=['grounding','planning','writing','assembling','baking','ready'];
    const labels={grounding:'Grounding (Harrison / atlas)',planning:'Planning chapters',writing:'Writing chapters',assembling:'Assembling lesson',baking:'Baking audio (Mac)',ready:'Ready'};
    let ci=order.indexOf(phase); if(phase==='queued'||ci<0) ci=(phase==='ready')?order.length-1:0;
    document.getElementById('p-steps').innerHTML=order.map(s=>{ const i=order.indexOf(s), cls=i<ci?'done':i===ci?'active':'';
      return `<div class="step ${cls}"><span class="dot">${i<ci?'✓':''}</span>${labels[s]}</div>`; }).join(''); },
  async _poll(jid){
    try{ const d=await (await fetch(API+'/jobs/'+jid)).json();
      LIB._renderSteps(d.phase||d.status);
      if(d.log_tail) document.getElementById('p-log').textContent=d.log_tail;
      if(d.status==='ready'||d.status==='published'){
        document.getElementById('p-title').textContent='✓ Lesson ready — staged for review';
        const ob=document.getElementById('p-open'); ob.style.display=''; ob.onclick=()=>window.open(API+(d.lesson_url||''),'_blank');
        LIB.reload(); return; }
      if(d.status==='error'){ document.getElementById('p-title').textContent='✗ Generation failed — see log'; return; }
      setTimeout(()=>LIB._poll(jid), 2500);
    }catch(e){ setTimeout(()=>LIB._poll(jid), 4000); } },

  /* ---- Staging: accept → publish, send-back → regenerate ---- */
  async reload(){ try{ LESSONS=(await (await fetch(U('library.index.json?'+Date.now()))).json()).lessons;
    Object.keys(LMAP).forEach(k=>delete LMAP[k]); LESSONS.forEach(l=>{ if(l.ready) LMAP[slugOf(l.id)]=l; }); renderAll(); }catch(e){} },
  async accept(slug){ try{ const r=await (await fetch(API+'/accept/'+slug,{method:'POST'})).json();
    if(r.ok) LIB.reload(); else alert('Accept failed'); }catch(e){ alert('Accept failed: '+e.message); } },
  async sendback(slug){ const note=prompt('What needs fixing? (sent to regenerate)'); if(note===null) return;
    try{ const r=await (await fetch(API+'/regenerate/'+slug,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({note})})).json();
      if(r.job_id){ LIB.wizard(true); GENJOB=r.job_id; LIB._showProg({slug:r.slug}); LIB._poll(r.job_id); }
    }catch(e){ alert('Regenerate failed: '+e.message); } },

  /* ---- Jobs / generation activity (reads /activity) — so you always know what's baking ---- */
  jobs(open){
    document.getElementById('jobsback').classList.toggle('show', open);
    clearInterval(LIB._jobsTimer);
    if(open){ fetch(API+'/jobs/reap',{method:'POST'}).catch(()=>{}).finally(()=>LIB._loadJobs()); LIB._jobsTimer=setInterval(()=>LIB._loadJobs(), 4000); }
  },
  async _loadJobs(){
    const el=document.getElementById('jobslist'); if(!el) return;
    const seq=(LIB._jobsSeq=(LIB._jobsSeq||0)+1);   // A6: newest-poll-wins — drop a stale response that
    let d; try{ d=await (await fetch(API+'/activity?'+Date.now())).json(); }   // resolves after a newer poll started
    catch(e){ if(seq===LIB._jobsSeq) el.innerHTML='<div class="hint">Server unreachable — is the Chiron server up?</div>'; return; }
    if(seq!==LIB._jobsSeq) return;                  // a fresher _loadJobs already ran → this response is stale
    const active=d.active||[];
    LIB._genPaused=!!d.paused;
    LIB._genPool=d.pool||[];
    LIB._bake=d.bake||{};   // rebake lane: {mac_queued, modal_pending, running:[{slug,engine}]}
    // Keep the "🏠 Local (Mac)" pill's value in lockstep with the server's CH_LOCAL_MODEL (e.g. if the
    // governor model is bumped) so toggling it posts a model the server's rotation actually understands.
    if(d.local_model){ const lp=LIB.PROVIDERS.find(p=>p.value.startsWith('local/')); if(lp) lp.value=d.local_model; }
    const hist=(d.history||[]).slice().sort((a,b)=>(b.started||'').localeCompare(a.started||''));
    const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;');
    const lbl=x=> esc(x.domain==='medical-italian' ? (x.source_ref||x.subject) : x.subject);
    const mins=x=> x.elapsed_seconds!=null ? Math.round(x.elapsed_seconds/60)+'m' : '';
    const eta=x=> x.eta_seconds ? ' · ~'+Math.max(1,Math.round(x.eta_seconds/60))+'m left' : '';
    const when=s=>{ if(!s) return ''; const t=new Date(s); return isNaN(t)?'':t.toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); };
    LIB._open = LIB._open || new Set();
    let h='';
    const pauseBtn=LIB._genPaused
      ? `<button class="jpause resumed" title="new lessons stay queued until you resume" onclick="LIB.resumeGen()">▶ Resume generation</button>`
      : `<button class="jpause" title="finish in-flight lessons, hold everything else in the queue" onclick="LIB.pauseGen()">⏸ Pause generation</button>`;
    const provPills=LIB.PROVIDERS.map(p=>`<button class="provpill ${LIB._genPool.includes(p.value)?'on':''}" title="${esc(p.title)}" onclick="LIB.togProvider('${p.value}')">${p.label}</button>`).join('');
    const provBtns=`<span class="jprov" title="which models the batch rotates across — untick the paid ones to save tokens">${provPills}</span>`;
    // "Generating now" is TEXT generation only. Audio bakes also live in active (status queued/baking) but
    // belong to the Rebake lane below — never render them here (they showed as phantom "generating" rows).
    const activeGen=active.filter(x=>(x.lane||'text')!=='bake');
    const nRun=activeGen.filter(x=>x.status==='running').length, nHeld=activeGen.length-nRun;
    if(activeGen.length){
      // Honest header: only RUNNING jobs are "generating"; the rest are queued/held (esp. while paused).
      const head = LIB._genPaused
        ? `⏸ Paused · ${nRun} finishing · ${nHeld} held — hit Resume to run`
        : `🔴 Generating now · ${nRun}${nHeld?` · ${nHeld} queued`:''}`;
      h+=`<div class="jhead jhead-row"><span>${head}</span><span class="jbakebtns">${provBtns}${pauseBtn}</span></div>`;
      for(const x of activeGen){ const sl=x.slug||x.id; const isRun=x.status==='running';
        if(isRun) LIB._open.add(sl);   // expand ONLY a RUNNING job's LIVE steps. A queued/held job's rail shows
                                       // OLD steps from a prior attempt (the red "✗ failed" that looked like current
                                       // failures) — keep it collapsed; it's history, the job just hasn't re-run yet.
        const sub = isRun ? `${esc(x.phase||x.status)} · ${mins(x)}${eta(x)}`
                          : `${LIB._genPaused?'⏸ held — resumes when you hit Resume':'queued — waiting for a slot'} · ${mins(x)}`;
        h+=`<div class="jrow ${isRun?'gen':'genq'}"><span class="jdot"></span><div class="jmeta"><b>${lbl(x)}</b>${x.depth?`<span class="jdepth ${x.domain||''}">${esc(x.depth)}</span>`:''}<span class="jsub">${sub}</span></div>
             <button class="jexp" title="full live event stream" onclick="LIB.rawSteps('${sl}')">⤢</button><button class="jcancel" title="stop this job (keeps the lesson text)" onclick="LIB.cancel('${x.id}')">✕ Cancel</button></div>
           <div class="rail" data-slug="${sl}" ${isRun?'':'style="display:none"'}></div>`; }
    } else h+=`<div class="jhead jhead-row"><span>Nothing generating right now</span><span class="jbakebtns">${provBtns}${pauseBtn}</span></div>`;
    // REBAKE LANE — its own queue/worker, independent of text generation above. Always shown so the
    // two-lane setup is visible; muted when idle.
    const bk=LIB._bake||{}, bkRun=bk.running||[];
    const bkMac=bkRun.filter(r=>r.engine!=='modal').length, bkModal=bkRun.filter(r=>r.engine==='modal').length;
    const bkQ=(bk.mac_queued||0)+(bk.modal_pending||0);
    const bkBusy=bkRun.length||bkQ;
    const bkChips=[
      bkModal?`<span class="blchip modal" title="baking on Modal cloud GPU (fast)">⚡ ${bkModal}</span>`:'',
      bkMac?`<span class="blchip mac" title="baking on the Mac TTS sidecar (serial)">🐢 ${bkMac}</span>`:'',
      bk.mac_queued?`<span class="blchip q" title="waiting in the serial Mac bake queue">🐢 queue ${bk.mac_queued}</span>`:'',
      bk.modal_pending?`<span class="blchip q" title="submitted to the Modal pool, not started">⚡ queue ${bk.modal_pending}</span>`:'',
    ].join('');
    h+=`<div class="jhead jbakelane ${bkBusy?'busy':'idle'}" title="Audio rebake runs in a SEPARATE queue from text generation — the two lanes don't block each other.">`
      +`<span>🔊 Rebake lane · ${bkBusy?`${bkRun.length} baking${bkQ?` · ${bkQ} queued`:''}`:'idle'}</span>`
      +`<span class="blchips">${bkChips}</span></div>`;
    // LIST the active bakes so they're actually visible — not just a count. Each running bake = a row;
    // then a one-line "+N more queued". This is why the panel looked empty: 100 bakes hid behind one summary line.
    for(const r of bkRun){
      const nm=(r.slug||'').replace(/^chiron-/,'').replace(/-/g,' ');
      h+=`<div class="jrow ${r.engine==='modal'?'gen':'genq'}"><span class="jdot"></span><div class="jmeta"><b>${esc(nm)}</b><span class="jsub">🔊 baking audio · ${r.engine==='modal'?'⚡ Modal (fast)':'🐢 Mac'}</span></div></div>`;
    }
    // LIST every queued bake (server now sends the full list) — a queued lesson must always be visible, never hidden behind a count.
    for(const q of (bk.queued||[])){
      const nm=(q.slug||'').replace(/^chiron-/,'').replace(/-/g,' ');
      h+=`<div class="jrow genq"><span class="jdot"></span><div class="jmeta"><b>${esc(nm)}</b><span class="jsub">🔊 queued for audio · ${q.engine==='modal'?'⚡ Modal (fast)':'🐢 Mac'}</span></div>`
        +`<button class="jrebake" title="bake now — pick ⚡Fast / 🐢Mac when you click" onclick="LIB.rebake('${q.slug}')">🔥 Rebake</button>`
        +(q.id?`<button class="jcancel" title="remove from the bake queue (keeps the lesson text)" onclick="LIB.cancel('${q.id}')">✕ Cancel</button>`:'')
        +`</div>`;
    }
    // fallback for an old server that only sent a count (no list yet)
    if(bkQ && !(bk.queued||[]).length) h+=`<div class="jrow genq"><span class="jdot"></span><div class="jmeta"><span class="jsub" style="color:#94a3b8">… + ${bkQ} more queued for audio bake (update server to list them)</span></div></div>`;
    const ids=new Set(active.map(a=>a.id));
    const activeSlugs=new Set(active.map(a=>a.slug));   // slugs currently queued/running/baking
    // Accepted/promoted lessons live in the library → drop them from the activity list. Keep the
    // un-accepted (staged 'ready') + failed ones here, so you can review/accept or retry them.
    // ONE row per lesson (dedupe the retry/rebake duplicates); drop accepted; prefer ready > audio-failed > error, newest
    const _rank=s=> s==='ready'?3 : s==='audio-failed'?2 : s==='error'?1 : 0;
    const _bySlug=new Map();
    // Suppress a STALE terminal row (a past error/failure) whenever that slug is ACTIVELY being re-run —
    // otherwise the tray shows "✗ failed" for a lesson that is right now regenerating ("says error but
    // goes through everything"). The live active row is the truth; the old terminal row is history.
    for(const x of hist){ if(ids.has(x.id) || activeSlugs.has(x.slug) || x.status==='published') continue;
      const sl=x.slug||x.id; const p=_bySlug.get(sl);
      if(!p || _rank(x.status)>_rank(p.status) || (_rank(x.status)===_rank(p.status) && (x.started||'')>(p.started||''))) _bySlug.set(sl,x);
    }
    LIB._dismissed = LIB._dismissed || (()=>{try{return JSON.parse(localStorage.getItem('chiron.dismissed')||'{}')}catch{return{}}})();
    const recent=[..._bySlug.values()]
      .filter(x=>{ const dz=LIB._dismissed[x.slug||x.id]; return !dz || (x.started||'')>dz; })   // hide dismissed (a newer regen reappears)
      .sort((a,b)=>(b.started||'').localeCompare(a.started||'')).slice(0,30);
    const nr=recent.filter(x=>x.status==='ready').length, ne=recent.filter(x=>x.status==='error').length;
    { const cf=document.getElementById('jclearfail'); if(cf) cf.style.display = hist.some(x=>x.status==='error'||x.status==='cancelled') ? '' : 'none'; }
    // "Bake all" — queue audio for every text-only lesson, but ONLY when nothing is generating text
    const rebakeRows=recent.filter(x=>{const r=(LIB._rec||{})[x.slug||x.id]; return r&&r.text&&r.needs_rebake;});
    const nbake=rebakeRows.length;
    LIB._needsRebakeSlugs=rebakeRows.map(x=>x.slug||x.id);
    const bakeAll=(activeGen.length===0 && nbake>0)
      ? `<button class="jbakeall" title="rebake all ${nbake} viewable-but-unbaked lessons — pick ⚡Fast / 🐢Mac when you click" onclick="LIB.bakeAll(${nbake})">Bake all (${nbake})</button>` : '';
    h+=`<div class="jhead jhead-row"><span>Needs review · ${nr} to accept · ${ne} failed</span><span class="jbakebtns">${bakeAll}</span></div>`;
    LIB._rec = LIB._rec || {};
    for(const x of recent){ const sl=x.slug||x.id;
      const st=x.status; const r=LIB._rec[sl]||{};
      const missTip=`text ${r.text?'✓':'✗'}${r.clips_total?` · ${r.clips_done}/${r.clips_total} clips${(r.missing&&r.missing.length)?' · missing: '+r.missing.join(', '):''}`:''}`;
      let pill='';
      // 🔥 "needs rebaking" ONLY when audio was actually baked (clips_total>0) and came out incomplete.
      // A text-first / never-baked lesson (clips_total==0) is NOT broken — it just hasn't been baked yet,
      // so show a calm "audio not baked" pill (not the alarming 🔥) but STILL offer a Bake button below.
      if(r.needs_rebake && r.text && r.clips_total>0) pill=`<span class="jpill rebake" title="${missTip}">🔥 needs rebaking</span>`;
      else if(st==='ready' && r.text && (r.clips_total||0)===0) pill=`<span class="jpill pending" title="text ready — audio not baked yet">🔊 audio not baked</span>`;
      else if(st==='error') pill=`<span class="jpill fail">✗ failed</span>`;
      let act='';
      if(st==='ready'){
        if(x.lesson_url){ const u=(location.port==='8911'?API:'')+x.lesson_url; act+=`<button class="jopen" onclick="LIB._overlay('${u}','${cssq(x.subject||x.source_ref||x.slug||"")}')">Open →</button>`; }
        if(r.needs_rebake && r.clips_total>0) act+=`<button class="jrebake" title="reuse ${r.clips_done}/${r.clips_total} clips, bake the rest — pick ⚡Fast / 🐢Mac when you click" onclick="LIB.rebake('${sl}')">🔥 Rebake</button>`;
        else if((r.clips_total||0)===0) act+=`<button class="jrebake" title="text-only — bake the audio now (⚡Fast / 🐢Mac)" onclick="LIB.rebake('${sl}')">🔊 Bake audio</button>`;   // never baked → offer the FIRST bake
        act+=`<button class="jaccept" onclick="LIB.acceptJob('${sl}')">✓ Accept</button>`;   // promote → into the library, removes it from here
      }
      // smart retry: if the text already exists, only re-bake the audio (never redo the lesson)
      else if(st==='error'||st==='audio-failed'||st==='cancelled'){
        if(r.text){   // text exists → let it be OPENED (see the lesson + hear the clips already baked)
          const u=(location.port==='8911'?API:'')+'/lessons/'+sl+'/lesson.html';
          act=`<button class="jopen" onclick="LIB._overlay('${u}','${cssq(x.subject||x.source_ref||x.slug||"")}')">Open →</button>`
             +`<button class="jrebake" title="${missTip} — bake the rest, pick ⚡Fast / 🐢Mac when you click" onclick="LIB.rebake('${sl}')">🔥 Rebake audio</button>`;
        } else act=`<button class="jretry" onclick="LIB.retry('${x.id}')">↻ Retry (full)</button>`;
      }
      const open=LIB._open.has(sl);
      const depth=x.depth?`<span class="jdepth ${x.domain||''}">${esc(x.depth)}</span>`:'';
      const dismiss=(st==='error'||st==='audio-failed'||st==='cancelled')?`<button class="jdismiss" title="dismiss — remove from the list (doesn't delete the lesson)" onclick="LIB.dismiss('${sl}','${x.started||''}')">✕</button>`:'';
      h+=`<div class="jrow ${st}"><span class="jdot"></span><div class="jmeta"><b>${lbl(x)}</b>${depth}${pill}<span class="jsub">${st} · ${when(x.started)}${r.clips_total?` · ${r.clips_done}/${r.clips_total} clips`:''}</span></div>
           <button class="jexp" onclick="LIB.toggleSteps('${sl}')">${open?'▾':'▸'} steps</button>${act}${dismiss}</div>
           <div class="rail" data-slug="${sl}" ${open?'':'style="display:none"'}></div>`;
    }
    if(h!==LIB._lastHTML){ LIB._lastHTML=h; el.innerHTML=h; }   // skip the full re-render when nothing changed → kills the 4s-poll flicker/reflow
    LIB._fillRails();
    LIB._fetchRecovery(recent);
    const dot=document.getElementById('jobsdot'); if(dot) dot.style.display=active.length?'inline-block':'none';
  },
  // lazily fetch recovery (text?/clips) per pill-relevant row, ONCE, cached — keeps /activity fast
  async _fetchRecovery(recent){
    let got=false;
    for(const x of (recent||[])){ const sl=x.slug||x.id;
      if(!['ready','error','audio-failed'].includes(x.status)) continue;
      const cached=LIB._rec[sl];
      if(cached && !cached.needs_rebake) continue;   // settled → cache forever; keep re-polling ONLY flagged rows
      try{ const fresh=await (await fetch(API+'/jobs/'+encodeURIComponent(sl)+'/recovery?'+Date.now())).json();
           const changed = !cached || cached.needs_rebake!==fresh.needs_rebake || cached.clips_done!==fresh.clips_done;
           LIB._rec[sl]=fresh; if(changed) got=true; }   // re-render only on real change → no tight poll loop
      catch(e){ if(!cached) LIB._rec[sl]={}; }
    }
    if(got) LIB._loadJobs();   // re-render with fresh recovery (only when something actually changed)
  },
  toggleSteps(sl){ LIB._open=LIB._open||new Set(); LIB._open.has(sl)?LIB._open.delete(sl):LIB._open.add(sl); LIB._loadJobs(); },
  async _fillRails(){
    for(const el of document.querySelectorAll('#jobslist .rail')){
      if(el.style.display==='none') continue;
      try{ const d=await (await fetch(API+'/jobs/'+encodeURIComponent(el.dataset.slug)+'/steps?'+Date.now())).json();
        const html=LIB._railHTML(d); if(el._lastRail!==html){ el._lastRail=html; el.innerHTML=html; } }   // per-rail guard: only repaint the rail whose steps actually changed (the baking one), not every row
      catch(e){ if(el._lastRail!=='__err'){ el._lastRail='__err'; el.innerHTML='<div class="rail-empty">no steps yet…</div>'; } }
    }
  },
  _railHTML(d){
    const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
    const secs=n=> n==null?'':(n>=60?Math.floor(n/60)+'m'+String(n%60).padStart(2,'0')+'s':n+'s');
    const P=d.phases||[]; if(!P.length) return '<div class="rail-empty">no steps yet…</div>';
    return '<div class="tlrail">'+P.map(p=>{
      let subs='';
      if(p.status==='running' && p.events && p.events.length){
        subs='<div class="tlsubs">'+p.events.filter(ev=>(ev.event_type||'')!=='PROGRESS').slice(-10).map(ev=>{ const et=ev.event_type||'';
          if(et.indexOf('MODEL_CALL')===0) return `<div class="tls"><span class="tchip mod">MODEL</span> ${esc(ev.model||'')} ${ev.tokens?`· <span class="tok">${ev.tokens} tok</span>`:''} ${et==='MODEL_CALL_END'?'✓':'<span class="tspin"></span>'}</div>`;
          if(et.indexOf('TOOL_CALL')===0) return `<div class="tls"><span class="tchip tool">TOOL</span> ${esc(ev.instruction||'')} ${et==='TOOL_CALL_END'?'✓':'<span class="tspin"></span>'}</div>`;
          if(et==='STEP_ERROR') return `<div class="tls err">⚠ ${esc(ev.instruction||ev.error||'')}</div>`;
          if(et==='CLIP') return `<div class="tls ${/⚠/.test(ev.instruction||'')?'err':''}">${esc(ev.instruction||'')}</div>`;
          if(et==='RECOVERY') return `<div class="tls" style="color:var(--lang)">♻ ${esc(ev.instruction||'')}</div>`;
          return `<div class="tls">${esc(et)}</div>`; }).join('')+'</div>';
      }
      // tqdm-style counter+ETA on a running phase header (Baking audio → "4/12 clips · ~3m left")
      const prog=(p.events||[]).filter(ev=>(ev.event_type||'')==='PROGRESS').slice(-1)[0];
      const meta = p.status==='done'?'✓ '+secs(p.seconds) : p.status==='error'?'✗ failed' : p.status==='running'?('running'+(p.seconds?' · '+secs(p.seconds):'')+((prog&&prog.instruction)?' · '+esc(prog.instruction):(p.events&&p.events.length?' · '+p.events.length+' events':''))):'pending';
      return `<div class="tln ${p.status}"><span class="tldot"></span><div class="tlnm">${esc(p.name)}</div><div class="tlm">${meta}</div>${subs}</div>`;
    }).join('')+'</div>';
  },
  async rawSteps(sl){
    document.getElementById('rawback').classList.add('show');
    document.getElementById('rawpre').textContent='loading…';
    try{ const d=await (await fetch(API+'/jobs/'+encodeURIComponent(sl)+'/steps?'+Date.now())).json();
      const evs=(d.phases||[]).flatMap(p=>(p.events||[]).map(e=>({...e,phase:p.name})));
      const lines=(d.phases||[]).flatMap(p=>[`▸ ${p.name}  [${p.status}${p.seconds!=null?' '+p.seconds+'s':''}]`,
        ...(p.events||[]).map(e=>`   ${(e.ts||'').slice(11,19)}  ${e.event_type}${e.model?' model='+e.model:''}${e.tokens?' tokens='+e.tokens:''}${e.ms?' time_ms='+e.ms:''}${e.error?' · '+e.error:''}`)]);
      document.getElementById('rawpre').textContent = lines.join('\n') || '(no events yet)';
    }catch(e){ document.getElementById('rawpre').textContent='unavailable'; }
  },
  closeRaw(){ document.getElementById('rawback').classList.remove('show'); },
  async pauseGen(){ try{ await fetch(API+'/gen/pause',{method:'POST'}); LIB._loadJobs(); }catch(e){ alert('Pause failed: '+e.message); } },
  async resumeGen(){ try{ await fetch(API+'/gen/resume',{method:'POST'}); LIB._loadJobs(); }catch(e){ alert('Resume failed: '+e.message); } },
  async togProvider(value){
    // Toggle one provider in/out of the primary-rotation pool (runtime override, no restart — R-PROVIDER-OVERRIDE).
    // Always leave at least one on, so generation never has zero providers to round-robin across.
    const cur=LIB._genPool||[];
    const pool=cur.includes(value) ? cur.filter(v=>v!==value) : [...cur, value];
    if(pool.length===0) return;   // refuse to empty the pool
    LIB._genPool=pool;   // optimistic render
    try{ await fetch(API+'/gen/rotation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pool})}); }
    catch(e){ alert('Provider update failed: '+e.message); }
    LIB._loadJobs();
  },
  async retry(id){ try{ await fetch(API+'/retry/'+id,{method:'POST'}); LIB._loadJobs(); }catch(e){ alert('Retry failed: '+e.message); } },
  // stop a queued/baking/generating job — kills the subprocess (or de-queues it); lesson TEXT is kept → still viewable + rebakeable
  async cancel(id){ if(!confirm('Cancel this job? The lesson text is kept — you can rebake the audio later.')) return;
    try{ const r=await (await fetch(API+'/cancel/'+encodeURIComponent(id),{method:'POST'})).json();
      if(r && r.ok===false) alert('Nothing to cancel: '+(r.error||'no active job')); LIB._loadJobs(); }
    catch(e){ alert('Cancel failed: '+e.message); } },
  // hide a dead/unwanted row from the activity (client-side; does NOT delete the lesson). A newer regen reappears.
  dismiss(sl, started){ LIB._dismissed=LIB._dismissed||{}; LIB._dismissed[sl]=started||new Date().toISOString();
    try{ localStorage.setItem('chiron.dismissed', JSON.stringify(LIB._dismissed)); }catch(e){} LIB._loadJobs(); },
  async clearFailed(){ try{ const r=await (await fetch(API+'/jobs/clear-failed',{method:'POST'})).json();
      LIB._loadJobs(); }catch(e){ alert('Clear failed: '+e.message); } },
  async acceptJob(sl){ try{ await fetch(API+'/accept/'+encodeURIComponent(sl),{method:'POST'}); if(LIB._rec)delete LIB._rec[sl]; LIB._loadJobs(); LIB.reload(); }catch(e){ alert('Accept failed: '+e.message); } },
  // ---- CLICK-TIME engine chooser: pops ⚡ Fast / 🐢 Mac (with live cost) THE MOMENT you click Rebake ----
  // Returns 'modal' | 'mac' | null (cancel). Fetches a cost estimate first so the choice is informed.
  async _chooseEngine(title, slugs){
    let est=null; try{ est=await (await fetch(API+'/bake-estimate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slugs})})).json(); }catch(e){}
    const usd=est&&est.est_usd!=null?('~$'+Number(est.est_usd).toFixed(2)):'small $';
    const fm=est&&est.est_wall_min_modal?('~'+est.est_wall_min_modal+' min'):'~min';
    const mm=est&&est.est_wall_min_mac?('~'+est.est_wall_min_mac+' min'):'slow';
    return new Promise(resolve=>{
      const ov=document.createElement('div'); ov.className='engchoose';
      ov.innerHTML=`<div class="ecbox"><div class="ectitle">${title}</div>
        <div class="ecbtns">
          <button class="ecbtn ecfast">⚡ Fast — Modal<small>${usd} · ${fm} · cloud</small></button>
          <button class="ecbtn ecmac">🐢 Mac<small>free · ${mm}</small></button>
        </div><button class="eccancel">Cancel</button></div>`;
      document.body.appendChild(ov);
      const done=v=>{ ov.remove(); document.removeEventListener('keydown',onKey); resolve(v); };
      const onKey=e=>{ if(e.key==='Escape') done(null); };
      document.addEventListener('keydown',onKey);
      ov.querySelector('.ecfast').onclick=()=>done('modal');
      ov.querySelector('.ecmac').onclick=()=>done('mac');
      ov.querySelector('.eccancel').onclick=()=>done(null);
      ov.onclick=e=>{ if(e.target===ov) done(null); };
    });
  },
  // re-bake ONLY the audio (reuses clips already done) — asks Fast/Mac at click time, then runs the chosen engine
  async rebake(sl){
    const engine=await this._chooseEngine('Rebake this lesson — pick an engine:',[sl]);
    if(!engine) return;
    try{ await fetch(API+'/bake/'+encodeURIComponent(sl)+'?engine='+engine,{method:'POST'}); if(LIB._rec)delete LIB._rec[sl]; (LIB._open=LIB._open||new Set()).add(sl); LIB._loadJobs(); }catch(e){ alert('Rebake failed: '+e.message); } },
  // batch rebake — asks Fast/Mac at click time. Mac → /bake-all (server-scanned, refuses during text-gen). Modal → /bake-batch.
  async bakeAll(n){
    const slugs=LIB._needsRebakeSlugs||[];
    const engine=await this._chooseEngine(`Rebake all ${n} lesson${n===1?'':'s'} — pick an engine:`, slugs);
    if(!engine) return;
    if(engine==='modal'){
      if(!slugs.length){ alert('Nothing to rebake right now.'); return; }
      try{ const r=await (await fetch(API+'/bake-batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slugs,engine:'modal'})})).json();
        if(r && r.ok===false){ alert('Can’t fast-bake now — '+(r.reason||'try again later')); return; }
        if(r && r.slugs && LIB._rec) r.slugs.forEach(s=>delete LIB._rec[s]); LIB._loadJobs();
      }catch(e){ alert('Fast bake failed: '+e.message); }
      return;
    }
    try{ const r=await (await fetch(API+'/bake-all?engine=mac',{method:'POST'})).json();
      if(r && r.ok===false){ alert('Can’t bake now — '+(r.reason||'try again later')); return; }
      if(r && r.slugs && LIB._rec) r.slugs.forEach(s=>delete LIB._rec[s]); LIB._loadJobs();
    }catch(e){ alert('Bake all failed: '+e.message); } },
  async _jobsHeartbeat(){
    try{ const d=await (await fetch(API+'/activity?'+Date.now())).json();
      const dot=document.getElementById('jobsdot'); if(dot) dot.style.display=(d.active&&d.active.length)?'inline-block':'none';
    }catch(e){}
  },

  /* ---- Captures browser — inbox for ⭐-flagged terms/answers/notes; select → dispatch into cards/mcqs/train/lesson ---- */
  captures(open){
    document.getElementById('capback').classList.toggle('show', open);
    clearInterval(LIB._capTimer);
    if(open){ LIB._capSel=LIB._capSel||new Set(); LIB._capOpen=LIB._capOpen||new Set();
      LIB._loadCaptures(); LIB._capTimer=setInterval(()=>LIB._loadCaptures(), 8000); }
  },
  capSearch(){ clearTimeout(LIB._capSearchT); LIB._capSearchT=setTimeout(()=>LIB._loadCaptures(), 300); },
  async _loadCaptures(){
    const el=document.getElementById('caplist'); if(!el) return;
    const q=(document.getElementById('cap-q')||{}).value||'';
    const unproc=(document.getElementById('cap-unproc')||{}).checked;
    let d;
    try{ d=await (await fetch(API+'/captures?'+new URLSearchParams({q, unprocessed: unproc?'true':'false', limit:100}))).json(); }
    catch(e){ el.innerHTML='<div class="hint">Server unreachable — is the Chiron server up?</div>'; return; }
    const items=d.items||[];
    LIB._capItems=new Map(items.map(x=>[x.id,x]));
    LIB._capSel=LIB._capSel||new Set(); LIB._capOpen=LIB._capOpen||new Set();
    [...LIB._capSel].forEach(id=>{ if(!LIB._capItems.has(id)) LIB._capSel.delete(id); });
    const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;');
    const when=s=>{ if(!s) return ''; const t=new Date(s); return isNaN(t)?'':t.toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); };
    const summary=document.getElementById('capsummary'); if(summary) summary.textContent=`${d.count||0} total · ${d.unprocessed||0} unprocessed`;
    const dot=document.getElementById('capdot'); if(dot) dot.style.display=d.unprocessed?'inline-block':'none';
    if(!items.length){ el.innerHTML=`<div class="hint">No captures${unproc?' — everything is processed':''}.</div>`; LIB._renderCapDispatch(); return; }
    el.innerHTML=items.map(x=>{
      const unprocX=!x.processed_at, sel=LIB._capSel.has(x.id), expanded=LIB._capOpen.has(x.id);
      return `<div class="cap-row ${unprocX?'unproc':''} ${sel?'cap-sel':''}" data-id="${x.id}">
        <input type="checkbox" ${sel?'checked':''} onclick="event.stopPropagation();LIB.capToggleSel(${x.id})">
        <div class="cap-main" onclick="LIB.capToggleExpand(${x.id})">
          <div class="cap-row-top"><span class="cap-kind ${esc(x.kind)}">${esc(x.kind)}</span><b class="cap-text">${esc(x.text)}</b>${x.processed_at?'<span class="cap-done">✓</span>':''}</div>
          <div class="cap-meta">${x.concept?esc(x.concept)+' · ':''}${x.lesson_slug?esc(x.lesson_slug)+' · ':''}${when(x.created_at)}</div>
          ${expanded?`<div class="cap-expand" id="cap-exp-${x.id}"><div class="hint">Loading…</div></div>`:''}
        </div>
      </div>`;
    }).join('');
    LIB._renderCapDispatch();
    LIB._capOpen.forEach(id=>LIB._fillCapExpand(id));
  },
  capToggleSel(id){
    LIB._capSel=LIB._capSel||new Set(); LIB._capSel.has(id)?LIB._capSel.delete(id):LIB._capSel.add(id);
    const row=document.querySelector(`.cap-row[data-id="${id}"]`);
    if(row){ row.classList.toggle('cap-sel', LIB._capSel.has(id)); const cb=row.querySelector('input[type=checkbox]'); if(cb) cb.checked=LIB._capSel.has(id); }
    LIB._renderCapDispatch();
  },
  capToggleExpand(id){
    LIB._capOpen=LIB._capOpen||new Set();
    LIB._capOpen.has(id) ? LIB._capOpen.delete(id) : LIB._capOpen.add(id);
    LIB._loadCaptures();
  },
  async _fillCapExpand(id){
    const el=document.getElementById('cap-exp-'+id); if(!el) return;
    const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
    try{ const d=await (await fetch(API+'/captures/'+id)).json();
      el.innerHTML=(d.question?`<div class="cap-asked">Asked: ${esc(d.question)}</div>`:'')
        +`<div class="cap-answer">${esc(d.source_answer||d.text||'')}</div>`
        +`<button class="jdismiss" onclick="event.stopPropagation();LIB.capDismiss(${id})">🗑 Dismiss</button>`;
    }catch(e){ el.innerHTML='<div class="hint">Failed to load.</div>'; }
  },
  async capDismiss(id){
    if(!confirm('Dismiss this capture? This deletes it permanently.')) return;
    try{ await fetch(API+'/captures/'+id,{method:'DELETE'});
      if(LIB._capSel) LIB._capSel.delete(id); if(LIB._capOpen) LIB._capOpen.delete(id);
      LIB._loadCaptures();
    }catch(e){ alert('Dismiss failed: '+e.message); }
  },
  _renderCapDispatch(){
    const bar=document.getElementById('capdispatch'); if(!bar || LIB._capBusy) return;
    const n=(LIB._capSel||new Set()).size;
    if(!n){ bar.style.display='none'; bar.innerHTML=''; return; }
    bar.style.display='flex';
    bar.innerHTML=`<span class="cap-selcount">${n} selected</span>
      <button class="jopen" onclick="LIB.capDispatch('cards')">🎴 Cards</button>
      <button class="jopen" onclick="LIB.capDispatch('mcqs')">❓ MCQs</button>
      <button class="jopen" onclick="LIB.capDispatch('train')">🎓 Train</button>
      <button class="jopen" onclick="LIB.capDispatch('lesson')">📚 Lesson</button>
      <button class="jretry" onclick="LIB.capClearSel()">✕ Clear</button>`;
  },
  capClearSel(){
    LIB._capSel=new Set(); LIB._renderCapDispatch();
    document.querySelectorAll('.cap-row.cap-sel').forEach(r=>r.classList.remove('cap-sel'));
    document.querySelectorAll('#caplist input[type=checkbox]').forEach(cb=>cb.checked=false);
  },
  async capDispatch(kind){
    const ids=[...(LIB._capSel||new Set())]; if(!ids.length) return;
    LIB._capBusy=true;
    const bar=document.getElementById('capdispatch');
    const buttons=[...bar.querySelectorAll('button')]; buttons.forEach(b=>b.disabled=true);
    const cc=bar.querySelector('.cap-selcount'); if(cc) cc.textContent='🧬 generating…';
    try{
      const r=await (await fetch(API+'/captures/cards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids,kind})})).json();
      let msg='✓ done';
      if(kind==='cards') msg=`✓ ${(r.cards||[]).length||r.written_to_sr||0} cards → SR`;
      else if(kind==='mcqs') msg=`✓ ${(r.mcqs||[]).length||0} practice questions`;
      else if(kind==='train') msg=`✓ drill ready`;
      else if(kind==='lesson') msg=`✓ lesson queued — ${(r.lesson_job&&r.lesson_job.slug)||''}`;
      if(cc) cc.textContent=msg;
    }catch(e){ if(cc) cc.textContent='⚠ '+e.message; }
    buttons.forEach(b=>b.disabled=false);
    setTimeout(()=>{ LIB._capBusy=false; LIB.capClearSel(); LIB._loadCaptures(); }, 6000);
  },

  /* ---- SSM connection indicator: holds the Specializzando base address (LAN IP, never
     localhost) so the tutor's ?qid= practice links build correctly, + shows reachability ---- */
  ssm: {
    _live:false,
    base(){ try{ return localStorage.getItem('chiron.ssmBase')||''; }catch(e){ return ''; } },
    isSet(){ return !!this.base(); },
    // effective base: explicit override, else same host this page was loaded from on :5191
    // (location.hostname is the real LAN IP when opened over the network — never localhost)
    eff(){ const b=this.base(); return b ? b.replace(/\/+$/,'') : (location.protocol+'//'+location.hostname+':5191'); },
    async init(){ this.render('idle'); await this.check(); setInterval(()=>this.check(), 30000); },
    render(state){ const b=document.getElementById('ssmbadge'); if(!b) return;
      b.classList.remove('ok','down','idle'); b.classList.add(state);
      const t={ok:'SSM connected · '+this.eff(), down:'SSM offline · '+this.eff(), idle:'SSM address not set (using auto)'};
      b.title=t[state]||''; },
    async check(){ const url=this.eff(), c=new AbortController(), to=setTimeout(()=>c.abort(),3500);
      try{ await fetch(url+'/?ping='+Date.now(), {mode:'no-cors', signal:c.signal}); clearTimeout(to); this._live=true; this.render('ok'); }
      catch(e){ clearTimeout(to); this._live=false; this.render(this.isSet()?'down':'idle'); }
      this._refresh(); return this._live; },
    pop(ev){ if(ev) ev.stopPropagation(); const p=document.getElementById('ssmpop'); if(!p) return;
      const open=p.classList.toggle('open');
      if(open){ this._refresh(); const inp=document.getElementById('ssm-url'); if(inp) inp.value=this.base()||this.eff();
        const off=(e)=>{ if(!p.contains(e.target) && (e.target.closest?!e.target.closest('#ssmbadge'):true)){ p.classList.remove('open'); document.removeEventListener('click',off); } };
        setTimeout(()=>document.addEventListener('click',off),0); } },
    _refresh(){ const st=document.getElementById('ssm-state');
      if(st) st.textContent = this._live ? ('🟢 Connected · '+this.eff()) : (this.isSet()?('🔴 Unreachable · '+this.eff()):'⚪ Using auto address · '+this.eff());
      const a=document.getElementById('ssm-auto'); if(a) a.textContent=this.isSet()?'override':('auto: '+location.hostname+':5191'); },
    async test(){ const st=document.getElementById('ssm-state'); if(st) st.textContent='↻ testing…';
      const ok=await this.check(); if(st) st.textContent = ok?('🟢 Reachable · '+this.eff()):('🔴 No response · '+this.eff()); },
    save(){ const inp=document.getElementById('ssm-url'); if(!inp) return; let v=(inp.value||'').trim();
      if(v){ if(!/^https?:\/\//.test(v)) v='http://'+v; try{ localStorage.setItem('chiron.ssmBase', v.replace(/\/+$/,'')); }catch(e){} }
      else { try{ localStorage.removeItem('chiron.ssmBase'); }catch(e){} }
      this.check(); },
    clear(){ try{ localStorage.removeItem('chiron.ssmBase'); }catch(e){} const inp=document.getElementById('ssm-url'); if(inp) inp.value=this.eff(); this.check(); },
    open(){ window.open(this.eff(), '_blank'); },
  },
};
window.LIB = LIB;
LIB.ssm.init();   // SSM connection indicator: discover base address + reachability
LIB._jobsHeartbeat(); setInterval(()=>LIB._jobsHeartbeat(), 15000);   // light the ⚡Jobs dot when something's baking
boot().catch(e=>{ document.getElementById('rows').innerHTML = `<div class="empty">Failed to load library: ${e.message}<br>Run the index builder + serve over http.</div>`; });
