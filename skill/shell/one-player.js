/* one-player.js — one audio at a time across every Chiron page.
 * Starting any <audio>/<video>/new Audio() pauses every other one in this page, and tells every other
 * open Chiron page on the same origin to pause its own (BroadcastChannel, with a localStorage event as
 * the fallback for browsers or file:// pages without it). Load it before any player starts. */
(function () {
  if (window.__chironOnePlayer) return;
  window.__chironOnePlayer = true;
  var me = Math.random().toString(36).slice(2), live = new Set(), bc = null, KEY = 'chiron-one-player';
  try { bc = new BroadcastChannel(KEY); } catch (e) {}
  function stopAll(keep) { live.forEach(function (m) { if (m !== keep && !m.paused) m.pause(); }); }
  function announce() {
    var msg = { from: me, t: Date.now() };
    if (bc) bc.postMessage(msg);
    try { localStorage.setItem(KEY, JSON.stringify(msg)); } catch (e) {}
  }
  function claim(m) { live.add(m); stopAll(m); announce(); }
  var play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { claim(this); return play.apply(this, arguments); };
  document.addEventListener('play', function (e) {
    if (e.target instanceof HTMLMediaElement && !live.has(e.target)) claim(e.target);
  }, true);
  function remote(m) { if (m && m.from !== me) stopAll(null); }
  if (bc) bc.onmessage = function (e) { remote(e.data); };
  addEventListener('storage', function (e) {
    if (e.key === KEY && e.newValue) { try { remote(JSON.parse(e.newValue)); } catch (x) {} }
  });
})();
