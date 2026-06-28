/* Chiron Library — data-driven from library.config.json (menu) + library.index.json (lessons).
 * Adding a facet to library.yaml → rebuild → it appears here. Lessons open their own lesson.html
 * (served over http, where audio + nav work). */
'use strict';
const FIELD = { system:'system', subject:'subject', topic:'topic', trend:'trend', lang_level:'level' }; // facet → lesson field
let CONFIG, LESSONS;
const F = { q:'', sort:'priority', domain:new Set(), facets:{} };
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
  renderAll();
}
const domCls = d => 'dom-'+d;
const domLabel = d => (CONFIG.domains[d]||{}).label || d;
const count = pred => LESSONS.filter(pred).length;

function match(l){
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
  if (F.sort==='priority') a.sort((x,y)=>(y.priority??(y.ready?500:0)+ (y.clips||0)) - (x.priority??(x.ready?500:0)+(x.clips||0)));
  if (F.sort==='recent')   a.sort((x,y)=>(y.ready-x.ready)|| (y.mtime||0)-(x.mtime||0));
  if (F.sort==='title')    a.sort((x,y)=>x.title.localeCompare(y.title));
  if (F.sort==='clips')    a.sort((x,y)=>(y.clips||0)-(x.clips||0));
  return a;
}
/* ---- pills: domain (from config.domains) + any facet of type 'pills' ---- */
function renderPills(){
  let h = '<span class="pgl">Domain</span>';
  for (const d of Object.keys(CONFIG.domains)){ const n=count(l=>l.domain===d); if(!n) continue;
    h += `<button class="pill ${domCls(d)} ${F.domain.has(d)?'on':''}" onclick="LIB.togDom('${d}')">${domLabel(d)}<span class="ct">${n}</span></button>`; }
  for (const [k,f] of Object.entries(CONFIG.facets)){
    if (f.type!=='pills' || !FIELD[k]) continue;
    h += `<span class="sep"></span><span class="pgl">${f.label}</span>`;
    for (const v of (f.values||[])){ const n=count(l=>l[FIELD[k]]===v); if(!n) continue;
      h += `<button class="pill ${F.facets[k].has(v)?'on':''}" onclick="LIB.tog('${k}','${v}')">${v[0]+v.slice(1).toLowerCase()}<span class="ct">${n}</span></button>`; }
  }
  document.getElementById('pills').innerHTML = h;
}
/* ---- facet rails: type 'rail' (system with nestUnder subject, topic) ---- */
function renderFacets(){
  let h='';
  for (const [k,f] of Object.entries(CONFIG.facets)){
    if (f.type!=='rail') continue;
    h += `<h4>${f.label}</h4>`;
    if (k==='subject'){ continue; } // rendered nested under system
    const vals = f.values || [];
    let any=false;
    for (const v of vals){ const n=count(l=>l[FIELD[k]]===v); if(!n) continue; any=true;
      const on=F.facets[k].has(v);
      h += `<div class="frow ${on?'on':''}" onclick="LIB.tog('${k}','${cssq(v)}')"><span>${on&&f.nestUnderChildren?'▾ ':''}${v}</span><span class="fct">${n}</span></div>`;
      // nest: if a child facet declares nestUnder this facet, render its members for selected parent
      const child = childFacetOf(k);
      if (child && on){
        const map = CONFIG.facets[child].valuesBySystem?.[v] || [];
        for (const sv of map){ const m=count(l=>l[FIELD[child]]===sv && l[FIELD[k]]===v); if(!m) continue;
          h += `<div class="frow sub ${F.facets[child].has(sv)?'on':''}" onclick="event.stopPropagation();LIB.tog('${child}','${cssq(sv)}')"><span>${sv}</span><span class="fct">${m}</span></div>`; }
      }
    }
    if (!any) h += `<div class="fhint">—</div>`;
    if (childFacetOf(k) && !F.facets[k].size) h += `<div class="fhint">▸ pick a ${f.label.toLowerCase()} to drill into ${CONFIG.facets[childFacetOf(k)].label.toLowerCase()}s</div>`;
  }
  h += `<div class="sheet-apply"><button onclick="LIB.sheet(false)">Show results</button></div>`;
  document.getElementById('facets').innerHTML = h;
}
function childFacetOf(parentKey){ for (const [k,f] of Object.entries(CONFIG.facets)) if (f.nestUnder===parentKey) return k; return null; }
const cssq = s => String(s).replace(/'/g,"\\'");
function crumb(){ const p=[];
  if (F.domain.size) p.push([...F.domain].map(domLabel).join('/'));
  for (const [k,set] of Object.entries(F.facets)){ if(!set.size) continue; const t=[...set].join('/'); p.push(k==='subject'?'<b>'+t+'</b>':t); }
  return p.length?'· '+p.join(' › '):''; }
function renderRows(){
  const list = sortLessons(LESSONS.filter(match));
  const nReady = list.filter(l=>l.ready).length, nQueued = list.length - nReady;
  document.getElementById('rcount').textContent = nQueued
    ? `${nReady} ready · ${nQueued} to generate`
    : `${nReady} lesson${nReady===1?'':'s'} ready`;
  document.getElementById('crumb').innerHTML = crumb();
  const rows = list.slice(0,600).map(l=>{
    const cat = l.subject ? `<span class="tag sys">${l.system}</span><span class="tag subj">${l.subject}</span>`
              : l.topic ? `<span class="tag topic">${l.topic}</span>` : '';
    const lvl = l.level ? `<span class="tag">${l.level}</span>` : '';
    const tr = l.trend ? `<span class="trend ${l.trend}">▲ ${l.trend}</span>` : '';
    const sc = l.scope ? `<span class="scope">${l.scope==='subject'?'class survey':'deep-dive'}</span>` : '';
    const slug = l.ready ? slugOf(l.id) : null;
    const dl = slug && DL[slug];
    // SAFETY: storage management (Download / Remove-from-device) is PHONE-ONLY.
    // Desktop gets NO remove/delete affordance — only Open — so nothing can be mistakenly deleted.
    const isPhone = matchMedia('(max-width:760px)').matches;
    const status = !l.ready
      ? `<span class="queued">not generated</span><span class="gen">Generate</span>`
      : isPhone
        ? `<span class="ready">▸ ${l.clips}</span>` + (dl
            ? `<span class="ready" title="cached on this device">✓ offline</span><span class="open" onclick="event.stopPropagation();LIB.remove('${slug}')">Remove</span>`
            : `<span class="open" onclick="event.stopPropagation();LIB.download('${slug}')">Download</span>`)
        : `<span class="ready">▸ ${l.clips} audio</span><span class="open">Open →</span>`;
    const onclick = l.ready ? ` onclick="LIB.open('${slug}')"` : '';
    return `<div class="row"${onclick} style="cursor:${l.ready ? 'pointer' : 'default'}">
      <div class="dbadge ${l.domain}"></div>
      <div class="rinfo"><div class="rtitle">${l.title}</div>
        <div class="rmeta"><span class="tag ${domCls(l.domain)}">${domLabel(l.domain)}</span>${cat}${lvl}${sc}${tr}</div></div>
      <div class="rstatus">${status}</div></div>`;
  }).join('');
  document.getElementById('rows').innerHTML = rows || `<div class="empty">No lessons match these filters.</div>`;
}
function renderAll(){ renderPills(); renderFacets(); renderRows(); }
const LIB = {
  togDom(d){ F.domain.has(d)?F.domain.delete(d):F.domain.add(d); renderAll(); },
  tog(k,v){ const s=F.facets[k]; s.has(v)?s.delete(v):s.add(v);
    // deselecting a parent clears its nested children
    const child=childFacetOf(k); if(child && !s.has(v)){ const map=CONFIG.facets[child].valuesBySystem?.[v]||[]; map.forEach(sv=>F.facets[child].delete(sv)); }
    renderAll(); },
  clearAll(){ F.q=''; F.domain.clear(); Object.values(F.facets).forEach(s=>s.clear()); document.getElementById('q').value=''; renderAll(); },
  sheet(open){ document.getElementById('facets').classList.toggle('open',open); document.getElementById('backdrop').classList.toggle('show',open); },
  open(slug){ const l=LMAP[slug]; if(!l) return; const dl=DL[slug];
    window.open(dl ? ('lessons/'+dl.id+'/'+dl.entry) : ('../'+l.path), '_blank'); },
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
};
window.LIB = LIB;
boot().catch(e=>{ document.getElementById('rows').innerHTML = `<div class="empty">Failed to load library: ${e.message}<br>Run the index builder + serve over http.</div>`; });
