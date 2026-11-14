/* one-player.js — one audio at a time across every Chiron page.
 * Starting any <audio>/<video>/new Audio() pauses every other one in this page, and tells every other
 * open Chiron page on the same origin to pause its own (BroadcastChannel, with a localStorage event as
 * the fallback for browsers or file:// pages without it). A page on another http port (the :8910 lesson
 * server) also embeds chiron-server's one-player-bridge.html, so the signal crosses ports too.
 * Load it before any player starts. */
(function () {
  if (window.__chironOnePlayer) return;
  window.__chironOnePlayer = true;
  var me = Math.random().toString(36).slice(2), live = new Set(), bc = null, KEY = 'chiron-one-player';
  try { bc = new BroadcastChannel(KEY); } catch (e) {}
  function stopAll(keep) { live.forEach(function (m) { if (m !== keep && !m.paused) m.pause(); }); }
  var BRIDGE_PORT = '8911', bridge = null;
  function announce() {
    var msg = { from: me, t: Date.now() };
    if (bc) bc.postMessage(msg);
    if (bridge && bridge.contentWindow) bridge.contentWindow.postMessage({ k: KEY, from: me, t: msg.t }, bridge.dataset.origin);
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
  if (location.protocol === 'http:' && location.port !== BRIDGE_PORT && window.top === window) {
    var origin = 'http://' + location.hostname + ':' + BRIDGE_PORT;
    var mount = function () {
      bridge = document.createElement('iframe');
      bridge.src = origin + '/shell/one-player-bridge.html';
      bridge.dataset.origin = origin;
      bridge.setAttribute('aria-hidden', 'true');
      bridge.tabIndex = -1;
      bridge.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none';
      document.documentElement.appendChild(bridge);
    };
    document.documentElement ? mount() : addEventListener('DOMContentLoaded', mount);
    addEventListener('message', function (e) {
      if (bridge && e.source === bridge.contentWindow && e.origin === origin && e.data && e.data.k === KEY) remote(e.data);
    });
  }
  addEventListener('storage', function (e) {
    if (e.key === KEY && e.newValue) { try { remote(JSON.parse(e.newValue)); } catch (x) {} }
  });
})();
