/* Chiron Library — data-driven from library.config.json (menu) + library.index.json (lessons).
 * Adding a facet to library.yaml → rebuild → it appears here. Lessons open their own lesson.html
 * (served over http, where audio + nav work). */
'use strict';
const FIELD = { system:'system', subject:'subject', topic:'topic', trend:'trend', lang_level:'level', source:'source' }; // facet → lesson field
let CONFIG, LESSONS;
const F = { q:'', sort:'priority', domain:new Set(), facets:{}, hiddenDom:new Set(), hiddenSys:new Set() };
/* ---- W1 hide-filters: persist which domains/systems are hidden across reloads ---- */
try{ const H=JSON.parse(localStorage.getItem('chiron.hide')||'{}'); (H.dom||[]).forEach(d=>F.hiddenDom.add(d)); (H.sys||[]).forEach(s=>F.hiddenSys.add(s)); }catch(e){}
const saveHide = () => { try{ localStorage.setItem('chiron.hide', JSON.stringify({dom:[...F.hiddenDom], sys:[...F.hiddenSys]})); }catch(e){} };
/* ---- offline engine (lifted from the player): Download → cache, Remove → local-only ---- */
const LCACHE = 'chiron-lib-lessons-v1';
const DL = JSON.parse(localStorage.getItem('chiron.dl') || '{}');   // slug → {id, entry}
const LMAP = {};                                                     // slug → lesson (ready only)
const saveDL = () => localStorage.setItem('chiron.dl', JSON.stringify(DL));
const slugOf = id => id.replace(/\//g, '-');
const mimeFor = p => ({html:'text/html',css:'text/css',js:'text/javascript',mjs:'text/javascript',json:'application/json',mp3:'audio/mpeg',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',svg:'image/svg+xml',wav:'audio/wav',webp:'image/webp',woff2:'font/woff2'}[p.split('.').pop().toLowerCase()] || 'application/octet-stream');
function commonPrefix(ns){ if(ns.length<2) return ''; let p=ns[0]; for(const n of ns){ while(p&&!n.startsWith(p)) p=p.slice(0,-1); if(!p) return ''; } const i=p.lastIndexOf('/'); return i>=0?p.slice(0,i+1):''; }
function pickEntry(rel){ return rel.find(n=>n==='lesson.html') || rel.find(n=>n.endsWith('/lesson.html')) || rel.find(n=>n.endsWith('.html')) || rel[0]; }
const unzip = u8 => new Promise((res,rej)=> fflate.unzip(u8,(e,f)=> e?rej(e):res(f)));

/* ---- Phase 2: the generate-server (:8911) — Wizard + Staging wiring ---- */
const API = (location.port === '8911') ? '' : 'http://127.0.0.1:8911';   // same-origin when served by the server, else cross-origin (CORS on)
const DEPTHS = {
  medicine: [['','Auto (detect from subject)'],['primer','Primer — quick, grouped'],['atlas','Atlas — organ-system survey'],['systematic','Systematic — 11-section deep-dive'],['amboss','AMBOSS — clinical']],
  'medical-italian': [['ward','Ward — clinical scene'],['passage','Passage — SSM question']],
  italian: [['lesson','Lesson']],
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
  CONFIG = await (await fetch('library.config.json')).json();
  LESSONS = (await (await fetch('library.index.json')).json()).lessons;
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
const count = pred => LESSONS.filter(pred).length;

function match(l){
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
const domCode = d => ({medicine:'m','medical-italian':'mi',italian:'l',code:'l'}[d] || 'm');
function railSystems(){ return [...new Set(LESSONS.map(l=>l.system).filter(Boolean))]
  .map(s=>[s, LESSONS.filter(l=>l.system===s).length]).sort((a,b)=>b[1]-a[1]); }
function renderFacets(){                                        // (id="facets" kept; now the hide-rail)
  const doms = Object.keys(CONFIG.domains).map(d=>[d, count(l=>l.domain===d)]).filter(([,n])=>n);
  const anyDomHidden = [...F.hiddenDom].some(d=>doms.some(([k])=>k===d));
  const anySysHidden = F.hiddenSys.size>0;
  let h = `<div class="hgrp">Domain <span class="unhide ${anyDomHidden?'':'dim'}" onclick="LIB.unhideDoms()">Unhide all</span></div>`;
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
const cssq = s => String(s).replace(/'/g,"\\'");
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
  let action;
  if(!l.ready) action = `<span class="taction gen" onclick="event.stopPropagation();LIB.genFor('${cssq(l.subject||l.system||l.topic||l.title)}','${l.domain}')">✦ Generate</span>`;
  else if(staged) action = `<span class="taction open">👁 Preview</span><span class="taction acc" onclick="event.stopPropagation();LIB.accept('${slug}')">✓ Accept</span>`;
  else if(isPhone) action = dl ? `<span class="taction dl">✓ offline</span>`
      : (l.bundle ? `<span class="taction dl" onclick="event.stopPropagation();LIB.download('${slug}')">⬇ Get</span>`
                  : `<span class="taction open" onclick="event.stopPropagation();LIB.open('${slug}')">Open →</span>`);
  else action = (l.bundle ? `<span class="taction dl" title="download .chiron bundle" onclick="event.stopPropagation();LIB.dlfile('${slug}')">⬇</span>` : '')
              + `<span class="taction open">Open →</span>`;
  const badges = (staged?`<span class="treview">🟡 REVIEW</span>`:'') + (l.bankable>0?`<span class="tbank">💰 ${l.bankable}</span>`:'')
    + (l.scope==='system'?`<span class="tag sys">organ system</span>`:'');
  const onclick = l.ready ? ` onclick="LIB.open('${slug}')"` : '';
  return `<div class="tcard ${l.domain}${l.ready?'':' queued'}${l.bankable>0?' bankq':''}"${onclick}>
    <div class="tb"><div class="tt">${l.title}</div><div class="ts">${subtagOf(l)}</div>${badges?`<div class="tbadges">${badges}</div>`:''}</div>
    <div class="tf"><span class="db">${domLabel(l.domain)}</span>${l.ready?`<span class="tclips">🔊 ${l.clips||0}</span>`:'<span class="tclips">not generated</span>'}${action}</div>
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
  const ordered = [...staged, ...ready, ...queued];
  const parts = [ hideChips() ];
  if (staged.length) parts.push(`<div class="reviewband">🟡 Needs Review — ${staged.length} newly generated lesson${staged.length===1?'':'s'}, not yet published. Open to review, then Accept to publish.</div>`);
  parts.push(ordered.length
    ? `<div class="twall"><div class="tgrid">${ordered.slice(0,800).map(tileHtml).join('')}</div></div>`
    : `<div class="empty">No lessons match — ${F.hiddenDom.size||F.hiddenSys.size?'unhide a facet in the sidebar':'try a different search'}.</div>`);
  document.getElementById('rows').innerHTML = parts.join('');
}
function renderAll(){ renderPills(); renderFacets(); renderRows(); }
const LIB = {
  togDom(d){ F.domain.has(d)?F.domain.delete(d):F.domain.add(d); renderAll(); },
  /* ---- W1 hide-filters ---- */
  hideDom(d){ F.hiddenDom.has(d)?F.hiddenDom.delete(d):F.hiddenDom.add(d); saveHide(); renderAll(); },
  hideSys(s){ F.hiddenSys.has(s)?F.hiddenSys.delete(s):F.hiddenSys.add(s); saveHide(); renderAll(); },
  unhideDoms(){ F.hiddenDom.clear(); saveHide(); renderAll(); },
  unhideSys(){ F.hiddenSys.clear(); saveHide(); renderAll(); },
  unhideOne(t,k){ (t==='dom'?F.hiddenDom:F.hiddenSys).delete(k); saveHide(); renderAll(); },
  unhideAll(){ F.hiddenDom.clear(); F.hiddenSys.clear(); saveHide(); renderAll(); },
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
      url=(location.port==='8911') ? (API+'/lessons/'+l.id+'/'+entry) : ('../'+l.path); }
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
    ov.querySelector('.lov-frame').src = url;
    ov.classList.add('show');
    try{ history.pushState({lov:1}, ''); }catch(e){}   // so hardware/browser Back closes the lesson, not the app
  },
  _overClose(fromPop){
    const ov=document.getElementById('lessonOverlay'); if(!ov) return;
    ov.classList.remove('show'); ov.querySelector('.lov-frame').src='about:blank';
    if(!fromPop){ try{ history.back(); }catch(e){} }   // keep history in sync when closed via the button
  },
  genFor(subject,domain){ LIB.wizard(true);
    document.getElementById('w-subject').value=subject||'';
    if(domain && DEPTHS[domain]){ document.getElementById('w-domain').value=domain; LIB.wizDepth(); }
    LIB.wizHint(); },
  dlfile(slug){ const a=document.createElement('a'); a.href='lessons/'+slug+'.chiron'; a.download=slug+'.chiron';
    document.body.appendChild(a); a.click(); a.remove(); },
  async download(slug){ const l=LMAP[slug]; if(!l || DL[slug]) return;
    try{
      const u8 = new Uint8Array(await (await fetch('lessons/'+slug+'.chiron')).arrayBuffer());
      const files = await unzip(u8);
      const names = Object.keys(files).filter(n=>!n.endsWith('/') && !n.includes('__MACOSX'));
      const prefix = commonPrefix(names), rel = n => prefix && n.startsWith(prefix) ? n.slice(prefix.length) : n;
      const id = 'dl-'+slug, cache = await caches.open(LCACHE);
      for(const n of names){ const path=rel(n), bytes=files[n];
        await cache.put(new Request(new URL('lessons/'+id+'/'+path, location.href)), new Response(bytes, {headers:{'Content-Type':mimeFor(path)}})); }
      DL[slug] = { id, entry: pickEntry(names.map(rel)) }; saveDL(); renderRows();
    } catch(e){ alert('Download failed: '+e.message); } },
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
    const stage=document.getElementById('w-nobake').checked?'assemble':'all';
    const btn=document.querySelector('.btn-gen'); btn.disabled=true; btn.textContent='Starting…';
    try{
      let images=null;
      if(WIZ_IMAGES.length){ const fd=new FormData(); WIZ_IMAGES.forEach((f,i)=>fd.append('files',f,f.name||`page-${i+1}.jpg`));
        images=(await (await fetch(API+'/upload',{method:'POST',body:fd})).json()).paths; }
      const r=await (await fetch(API+'/generate',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({domain,subject,depth,grounding,images,stage})})).json();
      if(!r.job_id) throw new Error(r.detail||'generate failed');
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
  async reload(){ try{ LESSONS=(await (await fetch('library.index.json?'+Date.now())).json()).lessons;
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
    if(open){ LIB._loadJobs(); LIB._jobsTimer=setInterval(()=>LIB._loadJobs(), 4000); }
  },
  async _loadJobs(){
    const el=document.getElementById('jobslist'); if(!el) return;
    let d; try{ d=await (await fetch(API+'/activity?'+Date.now())).json(); }
    catch(e){ el.innerHTML='<div class="hint">Server unreachable — is the Chiron server up?</div>'; return; }
    const active=d.active||[];
    const hist=(d.history||[]).slice().sort((a,b)=>(b.started||'').localeCompare(a.started||''));
    const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;');
    const lbl=x=> esc(x.domain==='medical-italian' ? (x.source_ref||x.subject) : x.subject);
    const mins=x=> x.elapsed_seconds!=null ? Math.round(x.elapsed_seconds/60)+'m' : '';
    const eta=x=> x.eta_seconds ? ' · ~'+Math.max(1,Math.round(x.eta_seconds/60))+'m left' : '';
    const when=s=>{ if(!s) return ''; const t=new Date(s); return isNaN(t)?'':t.toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); };
    LIB._open = LIB._open || new Set();
    let h='';
    if(active.length){
      h+='<div class="jhead">🔴 Generating now · '+active.length+'</div>';
      for(const x of active){ const sl=x.slug||x.id; LIB._open.add(sl);   // active is always expanded
        h+=`<div class="jrow gen"><span class="jdot"></span><div class="jmeta"><b>${lbl(x)}</b>${x.depth?`<span class="jdepth ${x.domain||''}">${esc(x.depth)}</span>`:''}<span class="jsub">${esc(x.phase||x.status)} · ${mins(x)}${eta(x)}</span></div>
             <button class="jexp" title="full live event stream" onclick="LIB.rawSteps('${sl}')">⤢</button><button class="jcancel" title="stop this job (keeps the lesson text)" onclick="LIB.cancel('${x.id}')">✕ Cancel</button></div>
           <div class="rail" data-slug="${sl}"></div>`; }
    } else h+='<div class="jhead">Nothing generating right now</div>';
    const ids=new Set(active.map(a=>a.id));
    // Accepted/promoted lessons live in the library → drop them from the activity list. Keep the
    // un-accepted (staged 'ready') + failed ones here, so you can review/accept or retry them.
    // ONE row per lesson (dedupe the retry/rebake duplicates); drop accepted; prefer ready > audio-failed > error, newest
    const _rank=s=> s==='ready'?3 : s==='audio-failed'?2 : s==='error'?1 : 0;
    const _bySlug=new Map();
    for(const x of hist){ if(ids.has(x.id) || x.status==='published') continue;
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
    const bakeAll=(active.length===0 && nbake>0)
      ? `<div class="jbakebtns"><button class="jbakeall" title="queue audio bakes for all ${nbake} viewable-but-unbaked lessons on the Mac (free, one at a time)" onclick="LIB.bakeAll(${nbake})">🐢 Bake all (Mac)</button>`
        +`<button class="jbakefast" title="fast-bake all ${nbake} lessons on Modal L4 (cloud, concurrent, small $ cost)" onclick="LIB.bakeAllFast(${nbake})">⚡ Fast (Modal)</button></div>` : '';
    h+=`<div class="jhead jhead-row"><span>Needs review · ${nr} to accept · ${ne} failed</span>${bakeAll}</div>`;
    LIB._rec = LIB._rec || {};
    for(const x of recent){ const sl=x.slug||x.id;
      const st=x.status; const r=LIB._rec[sl]||{};
      const missTip=`text ${r.text?'✓':'✗'}${r.clips_total?` · ${r.clips_done}/${r.clips_total} clips${(r.missing&&r.missing.length)?' · missing: '+r.missing.join(', '):''}`:''}`;
      let pill='';
      if(r.needs_rebake && r.text) pill=`<span class="jpill rebake" title="${missTip}">🔥 needs rebaking</span>`;
      else if(st==='error') pill=`<span class="jpill fail">✗ failed</span>`;
      let act='';
      if(st==='ready'){
        if(x.lesson_url){ const u=(location.port==='8911'?API:'')+x.lesson_url; act+=`<button class="jopen" onclick="LIB._overlay('${u}','${lbl(x)}')">Open →</button>`; }
        if(r.needs_rebake) act+=`<button class="jrebake" title="reuse ${r.clips_done}/${r.clips_total} clips, bake the rest — no text redo" onclick="LIB.rebake('${sl}')">🔥 Rebake</button>`;
        act+=`<button class="jaccept" onclick="LIB.acceptJob('${sl}')">✓ Accept</button>`;   // promote → into the library, removes it from here
      }
      // smart retry: if the text already exists, only re-bake the audio (never redo the lesson)
      else if(st==='error'||st==='audio-failed'){
        if(r.text){   // text exists → let it be OPENED (see the lesson + hear the clips already baked)
          const u=(location.port==='8911'?API:'')+'/lessons/'+sl+'/lesson.html';
          act=`<button class="jopen" onclick="LIB._overlay('${u}','${lbl(x).replace(/'/g,'')}')">Open →</button>`
             +`<button class="jrebake" title="${missTip} — bake the rest, no redo" onclick="LIB.rebake('${sl}')">🔥 Rebake audio</button>`;
        } else act=`<button class="jretry" onclick="LIB.retry('${x.id}')">↻ Retry (full)</button>`;
      }
      const open=LIB._open.has(sl);
      const depth=x.depth?`<span class="jdepth ${x.domain||''}">${esc(x.depth)}</span>`:'';
      const dismiss=(st==='error'||st==='audio-failed')?`<button class="jdismiss" title="dismiss — remove from the list (doesn't delete the lesson)" onclick="LIB.dismiss('${sl}','${x.started||''}')">✕</button>`:'';
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
      if(LIB._rec[sl]) continue;
      try{ LIB._rec[sl]=await (await fetch(API+'/jobs/'+encodeURIComponent(sl)+'/recovery?'+Date.now())).json(); got=true; }
      catch(e){ LIB._rec[sl]={}; }
    }
    if(got) LIB._loadJobs();   // re-render with the now-cached recovery (cached → no re-fetch loop)
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
  // re-bake ONLY the audio (reuses the clips already done) — never redoes the lesson text
  async rebake(sl){ try{ await fetch(API+'/bake/'+encodeURIComponent(sl),{method:'POST'}); if(LIB._rec)delete LIB._rec[sl]; (LIB._open=LIB._open||new Set()).add(sl); LIB._loadJobs(); }catch(e){ alert('Rebake failed: '+e.message); } },
  // batch: queue audio for ALL text-only lessons — server refuses while text is still generating (Mac path, default, free)
  async bakeAll(n,engine='mac'){
    if(!confirm(`Queue audio bakes for ${n} lesson${n===1?'':'s'} that have text but no audio yet? They'll bake one at a time.`)) return;
    try{ const r=await (await fetch(API+'/bake-all?engine='+engine,{method:'POST'})).json();
      if(r && r.ok===false){ alert('Can’t bake now — '+(r.reason||'try again later')); return; }
      if(r && r.slugs && LIB._rec) r.slugs.forEach(s=>delete LIB._rec[s]);
      LIB._loadJobs();
    }catch(e){ alert('Bake all failed: '+e.message); } },
  // batch: fast-bake ALL text-only lessons on Modal L4 — concurrent, cloud, small $ cost. Cost-transparent: shows
  // an estimate (from /bake-estimate) before spending real money, then fans out via /bake-batch.
  async bakeAllFast(n){
    const slugs=LIB._needsRebakeSlugs||[];
    if(!slugs.length){ alert('Nothing to fast-bake right now.'); return; }
    let est={};
    try{ est=await (await fetch(API+'/bake-estimate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slugs})})).json(); }
    catch(e){ alert('Could not get a cost estimate: '+e.message); return; }
    const usd=(est.est_usd||0).toFixed(2);
    if(!confirm(`⚡ Fast rebake ${n} lesson${n===1?'':'s'} on Modal L4 ≈ ~$${usd}, ~${est.est_wall_min_modal||'?'} min (vs ~${est.est_wall_min_mac||'?'} min on the Mac, free). Continue?`)) return;
    try{ const r=await (await fetch(API+'/bake-batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slugs,engine:'modal'})})).json();
      if(r && r.ok===false){ alert('Can’t fast-bake now — '+(r.reason||'try again later')); return; }
      if(r && r.slugs && LIB._rec) r.slugs.forEach(s=>delete LIB._rec[s]);
      LIB._loadJobs();
    }catch(e){ alert('Fast bake failed: '+e.message); } },
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
