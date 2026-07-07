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
    document.getElementById('w-images').addEventListener('change', e=>{
      document.getElementById('w-imglist').innerHTML=[...e.target.files].map(f=>`<span class="chip">🖼 ${f.name}</span>`).join(''); }); }
  document.getElementById('themebtn').textContent = document.documentElement.getAttribute('data-theme')==='dark'?'☀️':'🌙';
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
  const rowHtml = l =>{
    const cat = l.scope==='system' ? `<span class="tag sys">${l.system}</span><span class="tag">${l.exam_pct}% of exam · ${l.total_q}Q · ${l.n_classes} classes</span>`
              : l.subject ? `<span class="tag sys">${l.system}</span><span class="tag subj">${l.subject}</span>`
              : l.topic ? `<span class="tag topic">${l.topic}</span>` : '';
    const lvl = l.level ? `<span class="tag">${l.level}</span>` : '';
    const tr = l.trend ? `<span class="trend ${l.trend}">▲ ${l.trend}</span>` : '';
    const sc = l.scope ? `<span class="scope${l.scope==='system'?' sysscope':''}">${l.scope==='system'?'organ system':l.scope==='subject'?'class survey':'deep-dive'}</span>` : '';
    const bk = l.bankable>0 ? `<span class="bank" title="${l.bankable} recurring exam repeats — high-yield, generate first">💰 ${l.bankable}</span>` : '';
    const slug = l.ready ? slugOf(l.id) : null;
    const dl = slug && DL[slug];
    // SAFETY: storage management (Download / Remove-from-device) is PHONE-ONLY.
    // Desktop gets NO remove/delete affordance — only Open — so nothing can be mistakenly deleted.
    const isPhone = matchMedia('(max-width:760px)').matches;
    const size = l.sizeMB ? ` ${l.sizeMB}MB` : '';
    const status = !l.ready
      ? `<span class="queued">not generated</span><span class="gen on" onclick="event.stopPropagation();LIB.genFor('${cssq(l.subject||l.system||l.topic||l.title)}','${l.domain}')">✦ Generate</span>`
      : isPhone
        ? `<span class="ready">▸ ${l.clips}</span>` + (dl
            ? `<span class="ready" title="cached on this device">✓ offline</span><span class="open" onclick="event.stopPropagation();LIB.remove('${slug}')">Remove</span>`
            : l.bundle
              ? `<span class="open" onclick="event.stopPropagation();LIB.download('${slug}')">⬇ Download${size}</span>`
              : `<span class="open" onclick="event.stopPropagation();LIB.open('${slug}')">Open →</span>`)
        : `<span class="ready">▸ ${l.clips} audio</span>`
          + (l.bundle ? `<span class="open" title="download the .chiron bundle (install / share)" onclick="event.stopPropagation();LIB.dlfile('${slug}')">⬇${size}</span>` : '')
          + `<span class="open">Open →</span>`;
    const onclick = l.ready ? ` onclick="LIB.open('${slug}')"` : '';
    const stagedActions = (l.ready && l.status==='staged')
      ? `<button class="sendback" onclick="event.stopPropagation();LIB.sendback('${slug}')">Send back</button><button class="accept" onclick="event.stopPropagation();LIB.accept('${slug}')">✓ Accept</button>` : '';
    return `<div class="row${l.bankable>0?' bank':''}${l.scope==='system'?' sys-overview':''}"${onclick} style="cursor:${l.ready ? 'pointer' : 'default'}">
      <div class="dbadge ${l.domain}"></div>
      <div class="rinfo"><div class="rtitle">${l.title}</div>
        <div class="rmeta"><span class="tag ${domCls(l.domain)}">${domLabel(l.domain)}</span>${l.status==='staged'?'<span class="tag" style="background:#fde68a;color:#713f12;font-weight:700">🟡 REVIEW</span>':''}${cat}${lvl}${sc}${bk}${tr}</div></div>
      <div class="rstatus">${status}${stagedActions}</div></div>`;
  };
  // STAGING: newly-generated lessons (status==='staged') surface in a "Needs Review" band
  // at the top, separate from the published library, until the user reviews + accepts them.
  const staged = list.filter(l=>l.ready && l.status==='staged');
  const rest   = list.filter(l=>!(l.ready && l.status==='staged'));
  const banner = staged.length
    ? `<div style="grid-column:1/-1;padding:11px 14px;margin:6px 0 10px;background:#fef9c3;border:1px solid #eab308;border-radius:10px;color:#713f12;font-weight:600">🟡 Needs Review — ${staged.length} newly generated lesson${staged.length===1?'':'s'}, not yet published. Open to review; say &ldquo;accept&rdquo; to publish.</div>`
    : '';
  const rows = banner + staged.map(rowHtml).join('') + rest.slice(0,600).map(rowHtml).join('');
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

  /* ---- theme (single 🌙/☀️ toggle) ---- */
  theme(){ const dark=document.documentElement.getAttribute('data-theme')==='dark', nx=dark?'light':'dark';
    document.documentElement.setAttribute('data-theme',nx);
    try{localStorage.setItem('chiron.theme',nx);}catch(e){}
    document.getElementById('themebtn').textContent=nx==='dark'?'☀️':'🌙'; },

  /* ---- Wizard ---- */
  wizard(open){ document.getElementById('wizback').classList.toggle('show',open);
    if(open){ document.getElementById('wizform').style.display=''; document.getElementById('wizprog').style.display='none';
      setTimeout(()=>document.getElementById('w-subject').focus(),50); } },
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
      let images=null; const files=document.getElementById('w-images').files;
      if(files && files.length){ const fd=new FormData(); [...files].forEach(f=>fd.append('files',f));
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
