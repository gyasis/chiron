/* scene-report.js — tells whoever is hosting a video lesson WHAT is playing, so the tutor can ground on the
 * current scene. Injected into every lesson.html at serve time (server/app.py). Harmless on lessons without a <video>.
 *   window.CHIRON_NOW() -> {scene (1-based, 0 unknown), time (seconds)}   for the in-page web tutor
 *   postMessage({type:'chiron-scene', scene, time}) to the parent (≤1/s while playing, and on seek) for the phone app */
(function () {
  'use strict';
  var v = null, last = 0;
  function now() {
    var sc = 0;
    try { sc = (typeof cur === 'number' && cur >= 0) ? cur + 1 : 0; } catch (e) {}   // the video page's `let cur` (scene index)
    return { scene: sc, time: v ? v.currentTime : 0 };
  }
  window.CHIRON_NOW = now;
  function post() { try { parent.postMessage(Object.assign({ type: 'chiron-scene' }, now()), '*'); } catch (e) { console.warn('chiron scene-report: postMessage failed', e); } }
  function bind() {
    v = document.querySelector('video');
    if (!v) return;
    v.addEventListener('timeupdate', function () { var n = Date.now(); if (n - last > 1000) { last = n; post(); } });
    v.addEventListener('seeked', post);
    post();
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', bind); else bind();
})();
