/* lesson-actions.js — an inline block under the lesson's first heading with three states for an Italian lesson:
 * Anki cards, a Pimsleur season, and Match Madness on the lesson's newest Anki words.
 * Injected at serve time (server/app.py) for Italian lessons only.
 *
 *   GET  /api/lesson-status/<slug>        the three states and the Match Madness links
 *   POST /api/lesson/<slug>/anki          add the lesson's word pairs as Anki notes (only when it has none)
 *   POST /api/lesson/<slug>/pimsleur      {confirm:true} start a season from 5-10 phrases (only after confirm())
 * <slug> is the lesson path with "/" written as "~".
 */
(function () {
  'use strict';
  var m = location.pathname.match(/^\/lessons\/(.+)\/lesson\.html$/);
  if (!m || document.getElementById('lesson-actions')) return;
  var slug = m[1].split('/').map(decodeURIComponent).join('~');
  var inapp = /[?&]inapp=1\b/.test(location.search) && window.parent !== window;

  var css = document.createElement('style');
  css.textContent =
    '#lesson-actions{margin:12px 0 18px;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;' +
    'font:inherit;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
    '#lesson-actions .la-cell{border:1px solid var(--chiron-border,rgba(128,128,128,.35));border-radius:var(--chiron-radius-md,10px);' +
    'background:var(--chiron-surface,rgba(128,128,128,.08));padding:10px 12px;display:flex;flex-direction:column;gap:6px;min-width:0}' +
    '#lesson-actions .la-h{font-size:.78em;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--chiron-fg-secondary,#666)}' +
    '#lesson-actions .la-s{font-size:.95em;color:var(--chiron-fg,inherit);line-height:1.35;overflow-wrap:anywhere}' +
    '#lesson-actions .la-s.err{color:var(--chiron-error,#b3261e)}' +
    '#lesson-actions .la-b{font:inherit;font-weight:600;min-height:44px;padding:8px 12px;border-radius:var(--chiron-radius-md,10px);' +
    'border:1px solid var(--chiron-border,rgba(128,128,128,.5));background:var(--chiron-elevated,transparent);color:var(--chiron-fg,inherit);' +
    'cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;text-align:center}' +
    '#lesson-actions .la-b.go{background:var(--chiron-accent,#2a6);border-color:var(--chiron-accent,#2a6);color:var(--chiron-bg,#fff)}' +
    '#lesson-actions .la-b[disabled],#lesson-actions .la-b[aria-disabled="true"]{opacity:.55;cursor:default}';
  document.head.appendChild(css);

  var box = document.createElement('div'); box.id = 'lesson-actions'; box.setAttribute('aria-label', 'Lesson companion');
  function cell(title) {
    var c = document.createElement('div'); c.className = 'la-cell';
    var h = document.createElement('div'); h.className = 'la-h'; h.textContent = title;
    var s = document.createElement('div'); s.className = 'la-s'; s.setAttribute('role', 'status'); s.textContent = '…';
    var a = document.createElement('div');
    c.appendChild(h); c.appendChild(s); c.appendChild(a); box.appendChild(c);
    return { s: s, a: a };
  }
  var ca = cell('Anki'), cp = cell('Pimsleur'), cm = cell('Match Madness');

  var h1 = document.querySelector('h1');
  if (h1 && h1.parentNode) h1.parentNode.insertBefore(box, h1.nextSibling);
  else (document.querySelector('main') || document.body).insertBefore(box, (document.querySelector('main') || document.body).firstChild);

  function setText(c, t, err) { c.s.textContent = t; c.s.className = 'la-s' + (err ? ' err' : ''); }
  function btn(c, label, go, onclick) {
    c.a.textContent = '';
    var b = document.createElement('button'); b.type = 'button'; b.className = 'la-b' + (go ? ' go' : ''); b.textContent = label;
    if (onclick) b.addEventListener('click', function () { onclick(b); }); else b.disabled = true;
    c.a.appendChild(b); return b;
  }
  function link(c, label, href, go) {
    c.a.textContent = '';
    var a = document.createElement('a'); a.className = 'la-b' + (go ? ' go' : ''); a.textContent = label; a.href = href;
    c.a.appendChild(a); return a;
  }
  function api(method, path, body) {
    return fetch(path, { method: method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || j.detail || ('HTTP ' + r.status)); return j; }); });
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  var timer = null;
  function render(st) {
    var a = st.anki || {}, p = st.pimsleur || {}, mm = st.mm || {};
    if (a.status === 'cards') { setText(ca, plural(a.count, 'card', 'cards') + ' in Anki'); ca.a.textContent = ''; }
    else if (a.status === 'none') { setText(ca, 'No cards yet'); btn(ca, 'Add to Anki', true, addAnki); }
    else { setText(ca, 'Anki is not reachable' + (a.detail ? ': ' + a.detail : ''), true); btn(ca, 'Add to Anki', false, null); }

    if (p.state === 'ready') { setText(cp, 'A season exists'); link(cp, 'Open season', p.url || '/library/', false); }
    else if (p.state === 'generating') { setText(cp, 'Generating…'); btn(cp, 'Generating…', false, null); }
    else if (p.state === 'is_pimsleur') { setText(cp, 'This lesson is a Pimsleur season'); cp.a.textContent = ''; }
    else { setText(cp, 'No season yet'); btn(cp, 'Generate Pimsleur (5-10 phrases)', true, genPimsleur); }

    var links = mm.links;
    if (links) {
      setText(cm, 'Newest words of this lesson');
      var href = (inapp || /Android|iPhone|iPad/i.test(navigator.userAgent)) ? links.phone : (links.web || links.phone);
      var l = link(cm, 'Play newest words', href, false);
      if (inapp) l.addEventListener('click', function (e) { e.preventDefault(); try { parent.postMessage({ type: 'chiron-ask:open', url: links.phone }, '*'); } catch (x) { console.warn('lesson-actions: postMessage failed', x); } });
    } else {
      setText(cm, a.status === 'none' ? 'Add the lesson to Anki first' : 'Needs the lesson’s Anki cards');
      btn(cm, 'Play newest words', false, null);
    }
    clearTimeout(timer);
    if (p.state === 'generating') timer = setTimeout(load, 15000);
  }
  function load() {
    api('GET', '/api/lesson-status/' + encodeURIComponent(slug)).then(render).catch(function (e) {
      console.warn('lesson-actions:', e); setText(ca, 'Status unavailable: ' + e.message, true); setText(cp, '', false); setText(cm, '', false);
    });
  }
  function addAnki(b) {
    b.disabled = true; setText(ca, 'Adding…');
    api('POST', '/api/lesson/' + encodeURIComponent(slug) + '/anki', {}).then(load)
      .catch(function (e) { setText(ca, 'Could not add: ' + e.message, true); b.disabled = false; });
  }
  function genPimsleur(b) {
    if (!window.confirm('Generate a Pimsleur season from 5-10 phrases of this lesson? It runs a generation job and an audio bake.')) return;
    b.disabled = true; setText(cp, 'Starting…');
    api('POST', '/api/lesson/' + encodeURIComponent(slug) + '/pimsleur', { confirm: true }).then(load)
      .catch(function (e) { setText(cp, 'Could not start: ' + e.message, true); b.disabled = false; });
  }
  load();
})();
