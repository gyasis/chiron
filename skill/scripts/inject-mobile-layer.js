#!/usr/bin/env node
/**
 * inject-mobile-layer.js
 * Idempotent injector: adds the mobile CSS + JS layer to each ward lesson.html
 * Guard string: CHIRON_MOBILE_LAYER_INJECTED — if present, skip that file.
 *
 * Usage: node inject-mobile-layer.js
 */

'use strict';
const fs   = require('fs');
const path = require('path');

const WARDS_DIR = '/home/gyasis/Documents/generated/chiron-medicina-italiana/wards';
const GUARD     = '<!-- CHIRON_MOBILE_LAYER_INJECTED -->';

// ── Mobile CSS block (tokens remapped to --chiron-*, coherent with ward lessons) ──
const MOBILE_CSS = `
    ${GUARD}
    /* ── MOBILE LAYER — from language-lesson-skeleton.html (2026-06-12)
       Source: skill/shell/styles.css @media≤768px + main.js MOBILE RESPONSIVE LAYER
       Tokens remapped to --chiron-* namespace.
    ────────────────────────────────────────────────────────────────── */

    .chiron-hamburger { display: none; }
    .chiron-drawer-backdrop { display: none; }
    .chiron-bottom-bar { display: none; }
    .chiron-fs-overlay { display: none; }

    @media (max-width: 768px) {

      .chiron-hamburger {
        display: flex; align-items: center; justify-content: center;
        position: fixed; top: var(--chiron-space-3, 0.75rem); left: var(--chiron-space-3, 0.75rem);
        z-index: 10100; width: 44px; height: 44px;
        background: var(--chiron-surface, #fff); border: 1px solid var(--chiron-border, #e0dbd3);
        border-radius: var(--chiron-radius-sm, 4px); box-shadow: var(--chiron-shadow-md, 0 4px 6px rgba(0,0,0,.07));
        cursor: pointer; font-size: 1.25rem; color: var(--chiron-fg, #1a1a1a);
        transition: background 0.15s; padding: 0; font-family: inherit;
      }
      .chiron-hamburger:hover { background: var(--chiron-elevated, #f0ebe4); }

      .chiron-drawer-backdrop {
        display: block; position: fixed; inset: 0; z-index: 10050;
        background: rgba(0,0,0,0.4); opacity: 0; pointer-events: none;
        transition: opacity 0.25s ease-out;
      }
      .chiron-drawer-backdrop.open { opacity: 1; pointer-events: auto; }

      body { display: block !important; padding-top: 0; }
      aside.side {
        position: fixed !important; top: 0; left: 0;
        height: 100dvh !important; height: 100vh !important;
        width: min(280px, 85vw) !important; z-index: 10060;
        transform: translateX(-110%); transition: transform 0.25s ease-out;
        border-right: 1px solid var(--chiron-border, #e0dbd3) !important;
        border-bottom: none !important; overflow-y: auto; display: block !important;
      }
      aside.side.drawer-open { transform: translateX(0); }

      main.main { height: auto !important; overflow-y: visible !important; padding-top: 56px; }

      body.drawer-scroll-lock,
      body.chiron-fs-lock { overflow: hidden !important; padding-right: 0; }

      .chiron-listen { display: none !important; }

      .chiron-bottom-bar {
        display: flex; flex-direction: column;
        position: fixed; bottom: 0; left: 0; right: 0; z-index: 9998;
        background: var(--chiron-surface, #fff);
        border-top: 1px solid var(--chiron-border, #e0dbd3);
        box-shadow: 0 -4px 20px rgba(0,0,0,0.12);
        max-height: 70px; transition: max-height 0.25s ease-out; overflow: hidden;
      }
      .chiron-bottom-bar.sheet-open { max-height: min(70vh, 540px); }

      .chiron-bar-progress-line {
        height: 3px; width: 0%; background: var(--chiron-accent, #1e3a5f);
        transition: width 200ms linear; flex-shrink: 0;
      }

      .chiron-bar-row {
        display: flex; align-items: center; gap: var(--chiron-space-2, 0.5rem);
        padding: 0 var(--chiron-space-3, 0.75rem); height: 64px;
        flex-shrink: 0; cursor: default; touch-action: none; overflow: hidden;
      }

      .chiron-bar-prev-btn, .chiron-bar-next-btn,
      .chiron-bar-expand-btn, .chiron-bar-fs-btn {
        flex-shrink: 0; width: 36px; height: 36px; border: none;
        background: transparent; color: var(--chiron-fg-secondary, #4a4a4a);
        font-size: 1rem; cursor: pointer; display: flex; align-items: center;
        justify-content: center; border-radius: var(--chiron-radius-sm, 4px);
        -webkit-tap-highlight-color: transparent; font-family: inherit;
        transition: color 0.15s, background 0.15s;
      }
      .chiron-bar-prev-btn:hover, .chiron-bar-next-btn:hover,
      .chiron-bar-expand-btn:hover, .chiron-bar-fs-btn:hover {
        background: var(--chiron-elevated, #f0ebe4); color: var(--chiron-fg, #1a1a1a);
      }
      .chiron-bar-prev-btn:disabled, .chiron-bar-next-btn:disabled { opacity: 0.3; pointer-events: none; }

      .chiron-bar-play-btn {
        flex-shrink: 0; width: 44px; height: 44px; border-radius: 50%;
        background: var(--chiron-accent, #1e3a5f); color: white; border: none;
        display: flex; align-items: center; justify-content: center;
        font-size: 1.1rem; cursor: pointer;
        transition: background 0.15s, transform 0.15s;
        font-family: inherit; -webkit-tap-highlight-color: transparent;
      }
      .chiron-bar-play-btn:active { transform: scale(0.92); }
      .chiron-bar-play-btn.idle {
        background: var(--chiron-border, #e0dbd3);
        color: var(--chiron-fg-secondary, #4a4a4a);
      }

      .chiron-bar-clip-name {
        flex: 1; font-size: 0.875rem; font-weight: 600;
        color: var(--chiron-fg, #1a1a1a); white-space: nowrap;
        overflow: hidden; text-overflow: ellipsis; min-width: 0;
      }
      .chiron-bar-clip-name.idle { color: var(--chiron-muted, #7a7a7a); font-weight: 400; }

      .chiron-bar-countdown {
        flex-shrink: 0; font-family: var(--chiron-font-mono, monospace);
        font-size: 0.75rem; color: var(--chiron-muted, #7a7a7a);
        min-width: 32px; text-align: right;
      }

      .chiron-bar-sheet {
        overflow-y: auto; flex: 1;
        padding: var(--chiron-space-2, 0.5rem) var(--chiron-space-3, 0.75rem) var(--chiron-space-4, 1rem);
        border-top: 1px solid var(--chiron-divider, #ede8df);
      }
      .chiron-bar-sheet-title {
        font-family: var(--chiron-font-mono, monospace); font-size: 0.75rem;
        text-transform: uppercase; letter-spacing: 0.08em;
        color: var(--chiron-muted, #7a7a7a);
        padding: var(--chiron-space-2, 0.5rem) var(--chiron-space-2, 0.5rem) var(--chiron-space-3, 0.75rem);
      }

      .chiron-bar-clip-btn {
        display: flex; align-items: center; gap: var(--chiron-space-3, 0.75rem);
        width: 100%; text-align: left; background: transparent; border: 0;
        border-radius: var(--chiron-radius-sm, 4px);
        padding: var(--chiron-space-3, 0.75rem) var(--chiron-space-2, 0.5rem);
        font: inherit; font-size: 0.875rem; color: var(--chiron-fg, #1a1a1a);
        cursor: pointer; min-height: 44px; -webkit-tap-highlight-color: transparent;
        transition: background 0.15s;
      }
      .chiron-bar-clip-btn:hover,
      .chiron-bar-clip-btn:active { background: var(--chiron-elevated, #f0ebe4); }
      .chiron-bar-clip-btn.playing {
        background: color-mix(in srgb, var(--chiron-accent, #1e3a5f) 15%, transparent);
        color: var(--chiron-accent, #1e3a5f); font-weight: 600;
      }
      .chiron-bar-clip-btn .ico {
        flex-shrink: 0; width: 20px; height: 20px;
        display: grid; place-items: center; font-size: 10px;
        color: var(--chiron-accent, #1e3a5f);
      }

      main.main { padding-bottom: 80px; }

      .chiron-fs-overlay {
        display: flex; flex-direction: column; position: fixed; inset: 0;
        z-index: 10200; background: var(--chiron-surface, #fff);
        transform: translateY(100%); transition: transform 0.25s ease-out; overflow: hidden;
      }
      .chiron-fs-overlay.open { transform: translateY(0); }

      .chiron-fs-header {
        display: flex; align-items: center; justify-content: center;
        padding: var(--chiron-space-3, 0.75rem) var(--chiron-space-4, 1rem);
        flex-shrink: 0; border-bottom: 1px solid var(--chiron-divider, #ede8df);
      }
      .chiron-fs-close {
        width: 44px; height: 44px; border: none; background: transparent;
        color: var(--chiron-muted, #7a7a7a); font-size: 1.5rem; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        border-radius: 100px; -webkit-tap-highlight-color: transparent; font-family: inherit;
      }
      .chiron-fs-close:hover { background: var(--chiron-elevated, #f0ebe4); }

      .chiron-fs-title {
        font-family: var(--chiron-font-heading, Georgia, serif); font-size: 1.25rem;
        font-weight: 700; color: var(--chiron-fg, #1a1a1a);
        padding: var(--chiron-space-6, 1.5rem) var(--chiron-space-6, 1.5rem) var(--chiron-space-4, 1rem);
        text-align: center; flex-shrink: 0; line-height: 1.35;
      }

      .chiron-fs-scrub-wrap {
        display: flex; align-items: center; gap: var(--chiron-space-3, 0.75rem);
        padding: 0 var(--chiron-space-5, 1.25rem) var(--chiron-space-4, 1rem); flex-shrink: 0;
      }
      .chiron-fs-time {
        font-family: var(--chiron-font-mono, monospace); font-size: 0.75rem;
        color: var(--chiron-muted, #7a7a7a); min-width: 38px; flex-shrink: 0;
      }
      .chiron-fs-remaining { text-align: right; }

      .chiron-fs-scrub-track {
        flex: 1; height: 6px; border-radius: 100px;
        position: relative; cursor: pointer; touch-action: none;
        background: linear-gradient(
          to right,
          var(--chiron-accent, #1e3a5f) 0%,
          var(--chiron-accent, #1e3a5f) var(--fs-progress, 0%),
          var(--chiron-border, #e0dbd3) var(--fs-progress, 0%),
          var(--chiron-border, #e0dbd3) 100%
        );
      }
      .chiron-fs-scrub-thumb {
        position: absolute; top: 50%; left: 0%;
        transform: translate(-50%, -50%);
        width: 16px; height: 16px; border-radius: 50%;
        background: var(--chiron-accent, #1e3a5f);
        box-shadow: 0 1px 4px rgba(0,0,0,0.2); pointer-events: none;
      }

      .chiron-fs-transport {
        display: flex; align-items: center; justify-content: center;
        gap: var(--chiron-space-8, 2rem);
        padding: var(--chiron-space-4, 1rem) var(--chiron-space-6, 1.5rem) var(--chiron-space-6, 1.5rem);
        flex-shrink: 0;
      }
      .chiron-fs-prev, .chiron-fs-next {
        width: 52px; height: 52px; border: none;
        background: var(--chiron-elevated, #f0ebe4); color: var(--chiron-fg, #1a1a1a);
        font-size: 1.25rem; border-radius: 50%; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        -webkit-tap-highlight-color: transparent; font-family: inherit;
        transition: background 0.15s, transform 0.15s;
      }
      .chiron-fs-prev:hover, .chiron-fs-next:hover { background: var(--chiron-border, #e0dbd3); }
      .chiron-fs-prev:active, .chiron-fs-next:active { transform: scale(0.92); }
      .chiron-fs-prev:disabled, .chiron-fs-next:disabled { opacity: 0.3; pointer-events: none; }

      .chiron-fs-play {
        width: 68px; height: 68px; border: none;
        background: var(--chiron-accent, #1e3a5f); color: white;
        font-size: 1.5rem; border-radius: 50%; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 4px 16px rgba(0,0,0,0.25);
        -webkit-tap-highlight-color: transparent; font-family: inherit;
        transition: background 0.15s, transform 0.15s;
      }
      .chiron-fs-play:hover { background: var(--chiron-accent-light, #2d5986); }
      .chiron-fs-play:active { transform: scale(0.94); }

      .chiron-fs-list-hdr {
        font-family: var(--chiron-font-mono, monospace); font-size: 0.75rem;
        text-transform: uppercase; letter-spacing: 0.08em;
        color: var(--chiron-muted, #7a7a7a);
        padding: var(--chiron-space-2, 0.5rem) var(--chiron-space-5, 1.25rem) var(--chiron-space-2, 0.5rem);
        flex-shrink: 0; border-top: 1px solid var(--chiron-divider, #ede8df);
      }
      .chiron-fs-clip-list {
        flex: 1; overflow-y: auto;
        padding: 0 var(--chiron-space-4, 1rem) var(--chiron-space-6, 1.5rem);
      }
    }
    /* ── END MOBILE LAYER ── */`;

// ── Mobile JS block (identical to skeleton) ──
const MOBILE_JS = `
  <!-- CHIRON_MOBILE_LAYER_INJECTED_JS -->
  <script>
(function () {
  'use strict';
  var MQL = window.matchMedia && window.matchMedia('(max-width: 768px)');
  var hamburger=null,backdrop=null,sidebar=null,bottomBar=null;
  var barPlayBtn=null,barPrevBtn=null,barNextBtn=null,barClipName=null;
  var barCountdown=null,barProgress=null,barSheet=null,barExpandBtn=null;
  var fsOverlay=null,fsTitle=null,fsElapsed=null,fsRemaining=null;
  var fsScrubTrack=null,fsScrubThumb=null,fsPlayBtn=null,fsPrevBtn=null,fsNextBtn=null,fsClipList=null;
  var mobileAudio=null,activeClip=null,mobileClips=[],barTimer=null,sheetOpen=false,drawerOpen_=false,fsOpen=false;

  function openDrawer(){if(!sidebar)return;drawerOpen_=true;sidebar.classList.add('drawer-open');backdrop.classList.add('open');document.body.classList.add('drawer-scroll-lock');hamburger.setAttribute('aria-expanded','true');hamburger.textContent='✕';}
  function closeDrawer(){if(!sidebar)return;drawerOpen_=false;sidebar.classList.remove('drawer-open');backdrop.classList.remove('open');document.body.classList.remove('drawer-scroll-lock');hamburger.setAttribute('aria-expanded','false');hamburger.textContent='☰';}
  function toggleDrawer(){drawerOpen_?closeDrawer():openDrawer();}
  function injectHamburger(){
    if(hamburger)return;
    sidebar=document.querySelector('aside.side');if(!sidebar)return;
    backdrop=document.createElement('div');backdrop.className='chiron-drawer-backdrop';backdrop.setAttribute('aria-hidden','true');document.body.appendChild(backdrop);backdrop.addEventListener('click',closeDrawer);
    hamburger=document.createElement('button');hamburger.type='button';hamburger.className='chiron-hamburger';hamburger.textContent='☰';hamburger.setAttribute('aria-label','Open chapter list');hamburger.setAttribute('aria-expanded','false');hamburger.setAttribute('aria-controls','side-drawer');hamburger.addEventListener('click',toggleDrawer);document.body.appendChild(hamburger);
    sidebar.setAttribute('id','side-drawer');sidebar.setAttribute('role','dialog');sidebar.setAttribute('aria-label','Chapter list');
    sidebar.querySelectorAll('a').forEach(function(a){a.addEventListener('click',function(){if(drawerOpen_)closeDrawer();});});
  }
  function fmtTime(s){if(!isFinite(s)||s<0)return'0:00';s=Math.ceil(s);var m=Math.floor(s/60),ss=s%60;return m+':'+(ss<10?'0':'')+ss;}
  function setBarProgress(f){if(barProgress)barProgress.style.width=(Math.min(1,Math.max(0,f))*100)+'%';}
  function updateFsScrubber(f){if(!fsScrubTrack)return;var p=Math.min(1,Math.max(0,f))*100;fsScrubTrack.style.setProperty('--fs-progress',p+'%');if(fsScrubThumb)fsScrubThumb.style.left=p+'%';}
  function updateAllDisplays(){
    if(!mobileAudio||!activeClip)return;
    var dur=mobileAudio.duration,ct=mobileAudio.currentTime,frac=(isFinite(dur)&&dur>0)?ct/dur:0;
    setBarProgress(frac);
    if(barCountdown)barCountdown.textContent=(isFinite(dur)&&dur>0)?fmtTime(dur-ct):'';
    updateFsScrubber(frac);
    if(fsElapsed)fsElapsed.textContent=fmtTime(ct);
    if(fsRemaining)fsRemaining.textContent=(isFinite(dur)&&dur>0)?'-'+fmtTime(dur-ct):'';
    mobileClips.forEach(function(c,i){var btn=barSheet&&barSheet.querySelector('[data-clip-idx="'+i+'"]');if(!btn)return;var pl=activeClip&&activeClip.idx===i&&!mobileAudio.paused;btn.classList.toggle('playing',pl);var ico=btn.querySelector('.ico');if(ico)ico.textContent=pl?'⏸':'▶';});
    if(fsClipList)fsClipList.querySelectorAll('[data-clip-idx]').forEach(function(btn){var i=parseInt(btn.getAttribute('data-clip-idx'),10),pl=activeClip&&activeClip.idx===i&&!mobileAudio.paused;btn.classList.toggle('playing',pl);var ico=btn.querySelector('.ico');if(ico)ico.textContent=pl?'⏸':'▶';});
    var idx=activeClip?activeClip.idx:-1;
    if(barPrevBtn)barPrevBtn.disabled=idx<=0;if(barNextBtn)barNextBtn.disabled=idx<0||idx>=mobileClips.length-1;
    if(fsPrevBtn)fsPrevBtn.disabled=idx<=0;if(fsNextBtn)fsNextBtn.disabled=idx<0||idx>=mobileClips.length-1;
  }
  function startBarTimer(){if(barTimer)clearInterval(barTimer);barTimer=setInterval(updateAllDisplays,200);}
  function stopBarTimer(){if(barTimer){clearInterval(barTimer);barTimer=null;}}
  function playClipAt(idx){
    if(!mobileAudio||idx<0||idx>=mobileClips.length)return;
    var clip=mobileClips[idx];
    if(activeClip&&activeClip.idx===idx){if(mobileAudio.paused)mobileAudio.play().catch(function(){});else mobileAudio.pause();return;}
    activeClip={clip:clip,idx:idx};mobileAudio.src=clip.audioPath;
    mobileAudio.play().then(function(){syncBarToActive();}).catch(function(){activeClip=null;});
  }
  function syncBarToActive(){
    if(!activeClip)return;var clip=activeClip.clip;
    if(barClipName){barClipName.textContent=clip._label||'Playing';barClipName.classList.remove('idle');}
    if(fsTitle)fsTitle.textContent=clip._label||'Playing';
    if(barPlayBtn){barPlayBtn.textContent='⏸';barPlayBtn.classList.remove('idle');}
    if(fsPlayBtn)fsPlayBtn.textContent='⏸';
    updateAllDisplays();
  }
  function playBarClip(clip){var idx=mobileClips.indexOf(clip);if(idx>=0)playClipAt(idx);}
  function stopBarAudio(){
    if(!mobileAudio)return;mobileAudio.pause();mobileAudio.currentTime=0;stopBarTimer();activeClip=null;
    if(barPlayBtn){barPlayBtn.textContent='▶';barPlayBtn.classList.add('idle');}
    if(barClipName){barClipName.textContent='Tap to browse · double-tap to zoom';barClipName.classList.add('idle');}
    if(barCountdown)barCountdown.textContent='';setBarProgress(0);updateFsScrubber(0);
    if(fsElapsed)fsElapsed.textContent='0:00';if(fsRemaining)fsRemaining.textContent='';
    if(fsPlayBtn)fsPlayBtn.textContent='▶';if(fsTitle)fsTitle.textContent='Choose a clip below';
    updateAllDisplays();
  }
  function openSheet(){if(!bottomBar||!barSheet)return;sheetOpen=true;bottomBar.classList.add('sheet-open');if(barExpandBtn)barExpandBtn.textContent='▼';}
  function closeSheet(){if(!bottomBar)return;sheetOpen=false;bottomBar.classList.remove('sheet-open');if(barExpandBtn)barExpandBtn.textContent='▲';}
  function openFullScreen(){if(!fsOverlay)return;fsOpen=true;fsOverlay.classList.add('open');document.body.classList.add('chiron-fs-lock');if(activeClip){if(fsTitle)fsTitle.textContent=activeClip.clip._label||'Playing';}else{if(fsTitle)fsTitle.textContent='Choose a clip below';}updateAllDisplays();}
  function closeFullScreen(){fsOpen=false;if(fsOverlay)fsOverlay.classList.remove('open');document.body.classList.remove('chiron-fs-lock');}
  function buildOrderedClips(r){return r.filter(function(c){return c.artifact==='summary'||c.artifact==='shortened';}).concat(r.filter(function(c){return c.artifact==='section';}));}
  function labelClips(clips){clips.forEach(function(c){if(c.artifact==='summary'){c._label='Summary';return;}if(c.artifact==='shortened'){c._label='Full lecture';return;}if(c.sectionId){var el=document.getElementById(c.sectionId),h=el&&el.querySelector('h1,h2,h3,[data-section-title]');c._label=h&&h.textContent.trim()?h.textContent.trim().replace(/^\\s*\\d+[\\.)\\s]*/,''):(c.sectionId||'Section');return;}c._label='Clip';});}
  function buildClipRows(container,clips,onPick){container.innerHTML='';clips.forEach(function(c,i){var btn=document.createElement('button');btn.type='button';btn.className='chiron-bar-clip-btn';btn.setAttribute('data-clip-idx',i);var ico=document.createElement('span');ico.className='ico';ico.textContent='▶';var lbl=document.createElement('span');lbl.textContent=c._label||c.sectionId||'Clip';btn.appendChild(ico);btn.appendChild(lbl);btn.addEventListener('click',function(){onPick(c,i);});container.appendChild(btn);});}
  function seekAudioTo(f){if(!mobileAudio||!activeClip)return;var dur=mobileAudio.duration;if(!isFinite(dur)||dur<=0)return;mobileAudio.currentTime=Math.max(0,Math.min(1,f))*dur;updateAllDisplays();}
  function wireSeekOn(el,fn){var d=false;el.addEventListener('pointerdown',function(e){if(!activeClip)return;d=true;el.setPointerCapture(e.pointerId);seekAudioTo(fn(e,el));e.preventDefault();});el.addEventListener('pointermove',function(e){if(!d)return;seekAudioTo(fn(e,el));e.preventDefault();});function onUp(e){if(!d)return;d=false;seekAudioTo(fn(e,el));el.releasePointerCapture(e.pointerId);}el.addEventListener('pointerup',onUp);el.addEventListener('pointercancel',function(){d=false;});}
  function frH(e,el){var r=el.getBoundingClientRect();return r.width<=0?0:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));}
  function buildFsOverlay(){
    if(fsOverlay)return;
    fsOverlay=document.createElement('div');fsOverlay.className='chiron-fs-overlay';fsOverlay.setAttribute('role','dialog');fsOverlay.setAttribute('aria-modal','true');fsOverlay.setAttribute('aria-label','Now playing');
    var hdr=document.createElement('div');hdr.className='chiron-fs-header';var cb=document.createElement('button');cb.type='button';cb.className='chiron-fs-close';cb.setAttribute('aria-label','Collapse');cb.innerHTML='&#8964;';cb.addEventListener('click',closeFullScreen);hdr.appendChild(cb);fsOverlay.appendChild(hdr);
    fsTitle=document.createElement('div');fsTitle.className='chiron-fs-title';fsTitle.textContent='Choose a clip below';fsOverlay.appendChild(fsTitle);
    var sw=document.createElement('div');sw.className='chiron-fs-scrub-wrap';
    fsElapsed=document.createElement('span');fsElapsed.className='chiron-fs-time chiron-fs-elapsed';fsElapsed.textContent='0:00';
    fsScrubTrack=document.createElement('div');fsScrubTrack.className='chiron-fs-scrub-track';fsScrubTrack.setAttribute('role','slider');fsScrubTrack.setAttribute('aria-valuemin','0');fsScrubTrack.setAttribute('aria-valuemax','100');fsScrubTrack.setAttribute('aria-valuenow','0');fsScrubTrack.setAttribute('tabindex','0');
    fsScrubThumb=document.createElement('div');fsScrubThumb.className='chiron-fs-scrub-thumb';fsScrubTrack.appendChild(fsScrubThumb);wireSeekOn(fsScrubTrack,frH);
    fsRemaining=document.createElement('span');fsRemaining.className='chiron-fs-time chiron-fs-remaining';fsRemaining.textContent='';
    sw.appendChild(fsElapsed);sw.appendChild(fsScrubTrack);sw.appendChild(fsRemaining);fsOverlay.appendChild(sw);
    var tr=document.createElement('div');tr.className='chiron-fs-transport';
    fsPrevBtn=document.createElement('button');fsPrevBtn.type='button';fsPrevBtn.className='chiron-fs-prev';fsPrevBtn.setAttribute('aria-label','Previous chapter');fsPrevBtn.textContent='⏮';fsPrevBtn.addEventListener('click',function(){if(activeClip&&activeClip.idx>0)playClipAt(activeClip.idx-1);});
    fsPlayBtn=document.createElement('button');fsPlayBtn.type='button';fsPlayBtn.className='chiron-fs-play';fsPlayBtn.setAttribute('aria-label','Play/Pause');fsPlayBtn.textContent='▶';fsPlayBtn.addEventListener('click',function(){if(!activeClip)return;if(mobileAudio.paused)mobileAudio.play().catch(function(){});else mobileAudio.pause();});
    fsNextBtn=document.createElement('button');fsNextBtn.type='button';fsNextBtn.className='chiron-fs-next';fsNextBtn.setAttribute('aria-label','Next chapter');fsNextBtn.textContent='⏭';fsNextBtn.addEventListener('click',function(){if(activeClip&&activeClip.idx<mobileClips.length-1)playClipAt(activeClip.idx+1);});
    tr.appendChild(fsPrevBtn);tr.appendChild(fsPlayBtn);tr.appendChild(fsNextBtn);fsOverlay.appendChild(tr);
    var lh=document.createElement('div');lh.className='chiron-fs-list-hdr';lh.textContent='Chapters';fsOverlay.appendChild(lh);
    fsClipList=document.createElement('div');fsClipList.className='chiron-fs-clip-list';fsOverlay.appendChild(fsClipList);
    document.body.appendChild(fsOverlay);
  }
  function populateFsClipList(){if(!fsClipList)return;buildClipRows(fsClipList,mobileClips,function(c,i){playClipAt(i);});}
  function injectBottomBar(){
    if(bottomBar)return;mobileAudio=new Audio();
    bottomBar=document.createElement('div');bottomBar.className='chiron-bottom-bar';bottomBar.setAttribute('role','region');bottomBar.setAttribute('aria-label','Audio player');
    barProgress=document.createElement('div');barProgress.className='chiron-bar-progress-line';barProgress.setAttribute('role','progressbar');barProgress.setAttribute('aria-valuemin','0');barProgress.setAttribute('aria-valuemax','100');barProgress.setAttribute('aria-valuenow','0');
    var row=document.createElement('div');row.className='chiron-bar-row';
    barPrevBtn=document.createElement('button');barPrevBtn.type='button';barPrevBtn.className='chiron-bar-prev-btn';barPrevBtn.setAttribute('aria-label','Previous chapter');barPrevBtn.textContent='⏮';barPrevBtn.disabled=true;barPrevBtn.addEventListener('click',function(e){e.stopPropagation();if(activeClip&&activeClip.idx>0)playClipAt(activeClip.idx-1);});
    barPlayBtn=document.createElement('button');barPlayBtn.type='button';barPlayBtn.className='chiron-bar-play-btn idle';barPlayBtn.textContent='▶';barPlayBtn.setAttribute('aria-label','Play/Pause');barPlayBtn.addEventListener('click',function(e){e.stopPropagation();if(!activeClip){openSheet();return;}if(mobileAudio.paused)mobileAudio.play().catch(function(){});else mobileAudio.pause();});
    barClipName=document.createElement('div');barClipName.className='chiron-bar-clip-name idle';barClipName.textContent='Tap to browse · double-tap to zoom';
    barCountdown=document.createElement('div');barCountdown.className='chiron-bar-countdown';
    barNextBtn=document.createElement('button');barNextBtn.type='button';barNextBtn.className='chiron-bar-next-btn';barNextBtn.setAttribute('aria-label','Next chapter');barNextBtn.textContent='⏭';barNextBtn.disabled=true;barNextBtn.addEventListener('click',function(e){e.stopPropagation();if(activeClip&&activeClip.idx<mobileClips.length-1)playClipAt(activeClip.idx+1);});
    barExpandBtn=document.createElement('button');barExpandBtn.type='button';barExpandBtn.className='chiron-bar-expand-btn';barExpandBtn.textContent='▲';barExpandBtn.setAttribute('aria-label','Show clip list');barExpandBtn.addEventListener('click',function(e){e.stopPropagation();sheetOpen?closeSheet():openSheet();});
    row.appendChild(barPrevBtn);row.appendChild(barPlayBtn);row.appendChild(barClipName);row.appendChild(barCountdown);row.appendChild(barNextBtn);row.appendChild(barExpandBtn);
    barSheet=document.createElement('div');barSheet.className='chiron-bar-sheet';barSheet.setAttribute('aria-label','Clip list');var st=document.createElement('div');st.className='chiron-bar-sheet-title';st.textContent='Choose a clip';barSheet.appendChild(st);
    bottomBar.appendChild(barProgress);bottomBar.appendChild(row);bottomBar.appendChild(barSheet);document.body.appendChild(bottomBar);
    var _tt=null;row.addEventListener('click',function(e){if(e.target.closest&&e.target.closest('button'))return;if(_tt){clearTimeout(_tt);_tt=null;if(sheetOpen)closeSheet();openFullScreen();}else{_tt=setTimeout(function(){_tt=null;sheetOpen?closeSheet():openSheet();},280);}});
    document.addEventListener('click',function(e){if(!sheetOpen||!bottomBar)return;if(!bottomBar.contains(e.target))closeSheet();});
    mobileAudio.addEventListener('ended',function(){stopBarTimer();if(activeClip&&activeClip.idx<mobileClips.length-1){var ni=activeClip.idx+1;activeClip=null;playClipAt(ni);var nc=mobileClips[ni];if(nc&&nc.sectionId){var el=document.getElementById(nc.sectionId);if(el)el.scrollIntoView({behavior:'smooth',block:'start'});}}else{stopBarAudio();if(barClipName)barClipName.textContent='Finished — tap to replay';}});
    mobileAudio.addEventListener('pause',function(){stopBarTimer();if(barPlayBtn)barPlayBtn.textContent='▶';if(fsPlayBtn)fsPlayBtn.textContent='▶';updateAllDisplays();});
    mobileAudio.addEventListener('play',function(){if(barPlayBtn){barPlayBtn.textContent='⏸';barPlayBtn.classList.remove('idle');}if(fsPlayBtn)fsPlayBtn.textContent='⏸';startBarTimer();syncBarToActive();});
    buildFsOverlay();
  }
  function loadClips(raw){
    var ordered=buildOrderedClips(raw);labelClips(ordered);mobileClips=ordered;
    if(barSheet){var tn=barSheet.querySelector('.chiron-bar-sheet-title');barSheet.innerHTML='';if(tn)barSheet.appendChild(tn);buildClipRows(barSheet,ordered,function(c){playBarClip(c);closeSheet();});}
    populateFsClipList();updateAllDisplays();
  }
  function initMobile(){
    injectHamburger();injectBottomBar();
    if(window.__chironAudioManifest){var r=(window.__chironAudioManifest.clips||[]).filter(function(c){return c.status==='done'&&c.audioPath;});if(r.length)loadClips(r);return;}
    fetch('audio/manifest.json',{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).then(function(m){if(!m||!m.clips)return;var r=m.clips.filter(function(c){return c.status==='done'&&c.audioPath;});if(r.length)loadClips(r);}).catch(function(){});
  }
  function onMqlChange(mq){
    if(mq.matches){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initMobile);else initMobile();}
    else{if(hamburger)hamburger.style.display='none';if(backdrop)backdrop.style.display='none';if(bottomBar)bottomBar.style.display='none';if(fsOverlay)fsOverlay.classList.remove('open');if(sidebar){sidebar.classList.remove('drawer-open');sidebar.style.removeProperty('display');}document.body.classList.remove('drawer-scroll-lock','chiron-fs-lock');drawerOpen_=false;}
  }
  if(MQL){if(MQL.addEventListener)MQL.addEventListener('change',onMqlChange);else if(MQL.addListener)MQL.addListener(onMqlChange);onMqlChange(MQL);}
})();
  </script>`;

// ── Find all ward lesson.html files ──
const wards = fs.readdirSync(WARDS_DIR);
let patched = 0, skipped = 0;

for (const ward of wards) {
  const lessonPath = path.join(WARDS_DIR, ward, 'lesson.html');
  if (!fs.existsSync(lessonPath)) { console.log(`SKIP (no file): ${ward}`); skipped++; continue; }

  let html = fs.readFileSync(lessonPath, 'utf8');

  // Idempotency guard
  if (html.includes(GUARD)) { console.log(`SKIP (already patched): ${ward}`); skipped++; continue; }

  // Inject CSS before </style> (last </style> in the file)
  const styleEnd = html.lastIndexOf('</style>');
  if (styleEnd === -1) { console.log(`SKIP (no </style>): ${ward}`); skipped++; continue; }
  html = html.slice(0, styleEnd) + MOBILE_CSS + '\n  ' + html.slice(styleEnd);

  // Inject JS before </body>
  const bodyEnd = html.lastIndexOf('</body>');
  if (bodyEnd === -1) { console.log(`SKIP (no </body>): ${ward}`); skipped++; continue; }
  html = html.slice(0, bodyEnd) + MOBILE_JS + '\n</body>' + html.slice(bodyEnd + 7);

  fs.writeFileSync(lessonPath, html, 'utf8');
  console.log(`PATCHED: ${ward}`);
  patched++;
}

console.log(`\nDone: ${patched} patched, ${skipped} skipped.`);
