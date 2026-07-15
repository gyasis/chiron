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
  else if(isPhone) action = dl ? `<span class="taction dl">✓ offline</span>`
      : (l.bundle ? `<span class="taction dl" onclick="event.stopPropagation();LIB.download('${slug}')">⬇ Get</span>`
                  : `<span class="taction open" onclick="event.stopPropagation();LIB.open('${slug}')">Open →</span>`);
  else action = (l.bundle ? `<span class="taction dl" title="download .chiron bundle" onclick="event.stopPropagation();LIB.dlfile('${slug}')">⬇</span>` : '')
              + `<span class="taction open">Open →</span>`;
  const badges = (staged?`<span class="treview">🟡 REVIEW</span>`:'') + (l.bankable>0?`<span class="tbank">💰 ${l.bankable}</span>`:'')
    + (l.scope==='system'?`<span class="tag sys">organ system</span>`:'');
  const onclick = l.ready ? ` onclick="LIB.open('${slug}')"` : '';
  return `<div class="tcard ${l.domain}${l.ready?'':' queued'}${l.bankable>0?' bankq':''}"${onclick}>
    <div class="strip"></div>
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
    if(dl){ window.open('lessons/'+dl.id+'/'+dl.entry, '_blank'); return; }         // offline cache (SW)
    const entry=(l.path||'lesson.html').split('/').pop();
    // served by the generate-server → its /lessons mount (=generated/); else ../ (page sits in generated/chiron-library)
    const url=(location.port==='8911') ? (API+'/lessons/'+l.id+'/'+entry) : ('../'+l.path);
    window.open(url, '_blank'); },
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
};
window.LIB = LIB;
boot().catch(e=>{ document.getElementById('rows').innerHTML = `<div class="empty">Failed to load library: ${e.message}<br>Run the index builder + serve over http.</div>`; });
