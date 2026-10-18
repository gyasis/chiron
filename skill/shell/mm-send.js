/* mm-send.js — "🎮 Gioca in Match Madness": send THIS lesson's Match Madness pairs to the Match Madness phone app and
 * start a session there. The in-lesson mini-game is unreliable on the phone; the app is the real thing.
 * Injected into every lesson.html at serve time (server/app.py, next to lesson-nav.js). Does nothing on a lesson with no
 * #match-madness section.
 *
 *   click -> POST /api/collections/from-lesson {lesson}   (server reads the pairs out of the lesson file and upserts ONE
 *            collection named after the lesson: a re-send updates it, never duplicates it)
 *         -> matchmadness://raccolta?id=<id>&chiron=<this server>
 *   in the Chiron phone app (?inapp=1, framed): the link goes to the app via postMessage {type:'chiron-ask:open'}, which opens
 *            it with the opener plugin (a WebView cannot launch another app's scheme itself).
 *   on the web / a phone browser: no app to launch from a desktop tab, so say which collection was made and where to find it
 *            (Match Madness > Le mie raccolte), with the link for a phone browser to follow.
 */
(function () {
  'use strict';
  var sec = document.getElementById('match-madness');
  var m = location.pathname.match(/^\/lessons\/(.+)\/lesson\.html$/);
  if (!sec || !m) return;
  var lesson = m[1].split('/').map(decodeURIComponent).join('/');
  var inapp = /[?&]inapp=1\b/.test(location.search) && window.parent !== window;

  var css = document.createElement('style');
  css.textContent =
    '.mm-send{margin:0 0 var(--chiron-space-4,16px);display:flex;flex-direction:column;gap:6px;align-items:flex-start}' +
    '.mm-send button{font:inherit;font-weight:700;padding:12px 18px;min-height:44px;border-radius:var(--chiron-radius-md,10px);' +
    'border:1.5px solid var(--chiron-accent,#2a6);background:var(--chiron-accent,#2a6);color:var(--chiron-bg,#fff);cursor:pointer}' +
    '.mm-send button[disabled]{opacity:.6;cursor:progress}' +
    '.mm-send-note{font-size:.9em;color:var(--chiron-fg-secondary,#555);line-height:1.45}' +
    '.mm-send-note a{color:var(--chiron-accent,#2a6)}.mm-send-note.err{color:#b3261e}';
  document.head.appendChild(css);

  var box = document.createElement('div'); box.className = 'mm-send';
  var btn = document.createElement('button'); btn.type = 'button'; btn.id = 'mm-send-btn';
  btn.textContent = '🎮 Gioca in Match Madness';
  var note = document.createElement('div'); note.className = 'mm-send-note'; note.setAttribute('role', 'status');
  box.appendChild(btn); box.appendChild(note);
  var h = sec.querySelector('h2');
  if (h && h.nextSibling) h.parentNode.insertBefore(box, h.nextSibling); else sec.insertBefore(box, sec.firstChild);

  function say(t, err) { note.textContent = t; note.className = 'mm-send-note' + (err ? ' err' : ''); }

  btn.addEventListener('click', function () {
    btn.disabled = true; say('Preparo le parole…');
    fetch('/api/collections/from-lesson', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                             body: JSON.stringify({ lesson: lesson }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.detail || ('HTTP ' + r.status)); return j; }); })
      .then(function (j) {
        var url = 'matchmadness://raccolta?id=' + encodeURIComponent(j.id) +
          (location.protocol === 'http:' ? '&chiron=' + encodeURIComponent(location.origin) : '');
        if (inapp) {
          say('«' + j.name + '»: ' + j.count + ' coppie. Apro Match Madness…');
          try { parent.postMessage({ type: 'chiron-ask:open', url: url }, '*'); }
          catch (e) { console.warn('chiron mm-send: postMessage failed', e); say('Impossibile aprire Match Madness: ' + e.message, true); }
        } else {
          note.textContent = '';
          note.appendChild(document.createTextNode('«' + j.name + '»: ' + j.count + ' coppie salvate. Aprila in Match Madness › Le mie raccolte — oppure '));
          var a = document.createElement('a'); a.href = url; a.textContent = 'aprila direttamente (sul telefono)';
          note.appendChild(a); note.appendChild(document.createTextNode('.'));
        }
      })
      .catch(function (e) { console.warn('chiron mm-send:', e); say('Non riesco a inviare le coppie: ' + e.message, true); })
      .then(function () { btn.disabled = false; });
  });
})();
