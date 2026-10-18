/* lang-switch.js — ONE language switch for every lesson: "IT · IT+EN · EN".
 *
 * Mode lives on <html> as lang-it | lang-both | lang-en and in localStorage "chiron.lang" (default: both = as before).
 *   lang-it   hides the English blocks          lang-en   hides the Italian blocks, English in normal colour/size
 *   lang-both shows both
 *
 * Markup it understands (selector list EN_SEL below = the English markup the lessons already carry):
 *   data-lang="it" / data-lang="en"   the convention for new pairs
 *   .storydesc .qe .oe .pen .o-en .titolo-en .en .chiron-en-block .lt-en     English siblings / chips
 *   [data-en="…"]                      an element carrying its English in an attribute (Pimsleur cold-open / turns);
 *                                      the lesson's own "🇬🇧 English" chip is hidden, the text is shown by the switch
 *   a JSON script element with id "chiron-lang-en" holding {"<key>":"English"}
 *                                      PRE-GENERATED English for Italian blocks that had none (written by
 *                                      skill/shell/lang-embed.py; key = hash of the Italian text). Rendered instantly,
 *                                      no network. Tables: an "English" column is tagged as a whole.
 * The Italian text is never edited: English is always a tagged sibling/child, Italian is only tagged.
 * Server-injected into /lessons/**\/lesson.html (server/app.py); scope lessons also carry an inline copy for offline use.
 * window.__chironLang: {mode, set(m), units(), report()} — the audit/extraction surface (machine-readable).
 */
(function () {
  'use strict';
  if (window.__chironLang) return;
  if (document.querySelector('.subsbar')) return;     // video episodes carry their own Italiano/English subtitle control
  var KEY = 'chiron.lang', MODES = ['it', 'both', 'en'];
  var root = document.documentElement;
  // <meta name="chiron-lang" content="manual">: the lesson tags its own pairs (the exam simulator must not reveal English early)
  var MANUAL = !!document.querySelector('meta[name="chiron-lang"][content="manual"]');

  function lsGet() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function lsSet(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* private window: the switch still works */ } }
  var mode = MODES.indexOf(lsGet()) >= 0 ? lsGet() : 'both';

  var EN_CLS = '.gloss,.storydesc,.qe,.oe,.pen,.o-en,.s-en,.d-en,.t-en,.titolo-en,.en,.chiron-en-block';   // the English markup the lessons already carry
  var EN_SEL = '[data-lang="en"]';
  var SKIP_SEL = 'script,style,noscript,svg,textarea,input,select,option,code,aside.side,nav,.cl-lang,.cl-nav-btn,.cl-nav-sheet,' +
    '.chiron-widget,.chiron-listen-head,.audio-box,.theme-bar,.theme-section,.chiron-hamburger,.sr-rating,.mm-section,' +
    '.eyebrow,footer,#reviewBtn,[id^="tutor"],[class*="tutor-"],[class^="tp-"],.no-lang,[data-lt-own],.chiron-qc-pop,.chiron-reveal-en,.filter-bar,.star-tag,.upd-tag';
  var BLOCK = { P: 1, LI: 1, TD: 1, TH: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, DIV: 1, BLOCKQUOTE: 1, FIGCAPTION: 1,
    SUMMARY: 1, DT: 1, DD: 1, CAPTION: 1, BUTTON: 1, LABEL: 1, PRE: 1, SECTION: 1, ARTICLE: 1, HEADER: 1, FOOTER: 1 };
  var CLONE = { P: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, BLOCKQUOTE: 1, DD: 1, FIGCAPTION: 1, DIV: 1 };

  var IT = ('il lo la gli le un una uno di del della dei delle degli dello dell nel nella nei nelle nello sul sulla sui sulle al alla ai alle allo ' +
    'che non per con su tra fra da dal dalla dai dalle è sono sei siamo siete ha ho hai hanno abbiamo avete si mi ti ci vi ' +
    'come più anche se ma però perché quando dopo prima mentre dove quale quali questo questa questi queste quello quella ' +
    'suo sua suoi sue loro essere avere fare può possono deve devono lei lui noi voi io tu molto tutto tutti tutte ogni ' +
    'sempre già ancora solo senza sotto sopra durante oggi ieri domani qui lì cioè quindi infatti oppure entro dopo ' +
    'medico paziente articolo legge esame lezione ricetta frase frasi dottore dottoressa signor signora ogni').split(' ');
  var EN = ('the of and to is are was were be been being that this these those for with on as by or it its from at an not have has had will ' +
    'can your you he she his her they their which when if we our who what where how there here than then so but into out about ' +
    'must should would could may might do does did done any each every all no yes also only more most other such very').split(' ');
  var ITs = {}, ENs = {};
  IT.forEach(function (w) { ITs[w] = 1; }); EN.forEach(function (w) { ENs[w] = 1; });

  // 'it' | 'en' | '' (neither, e.g. numbers, codes, names)
  function langOf(t) {
    var w = t.toLowerCase().match(/[a-zàèéìíòóùú']+/g) || [];
    if (!w.length) return '';
    var it = 0, en = 0, i;
    for (i = 0; i < w.length; i++) { var x = w[i].replace(/^'|'$/g, ''); if (ITs[x]) it++; if (ENs[x]) en++; }
    if (/[àèéìòù]/i.test(t)) it += 1;
    if (/(zione|zioni|mente|ità|aggio|oso|osa|ato|ata|ire|are)\b/i.test(t)) it += 0.5;
    if (/\b\w+(tion|ing|ly|ness|ment)\b/i.test(t)) en += 0.5;
    if (en >= 1 && en > it * 1.5 && (w.length > 3 ? en >= 2 : true)) return 'en';
    if (it >= 1 && it >= en) return 'it';
    if (w.length >= 3 && en === 0) {                // an Italian lesson: an unknown 3+ word block is Italian if most words end in a vowel
      var v = 0; w.forEach(function (x) { if (/[aeiouàèéìòù]$/.test(x)) v++; });
      if (v / w.length >= 0.7) return 'it';
    }
    return '';
  }

  // for blocks the lesson itself marks as English (.gloss, .chiron-en-block …): English unless clearly Italian (they quote Italian examples)
  function clsLang(t, el) {
    if (!el.classList.contains('gloss')) return 'en';   // .storydesc/.qe/.oe/.pen/.chiron-en-block … are English by construction
    var w = t.toLowerCase().match(/[a-zàèéìòù']+/g) || [], it = 0, en = 0;   // .gloss also carries Italian source citations
    w.forEach(function (x) { x = x.replace(/^'|'$/g, ''); if (ITs[x]) it++; if (ENs[x]) en++; });
    return it >= 2 && en === 0 ? 'it' : 'en';
  }
  function norm(t) { return t.replace(/[ \t\r\f\v]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim(); }
  function hash(t) {                                  // two FNV-1a 32-bit passes -> 13 base36 chars; collisions ignorable
    var a = 0x811c9dc5, b = 0x01000193 ^ t.length, i, c;
    for (i = 0; i < t.length; i++) { c = t.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b + c, 2246822519) ^ (b >>> 13); }
    return (a >>> 0).toString(36) + (b >>> 0).toString(36);
  }

  var MAP = {};
  (function () { try { var s = document.getElementById('chiron-lang-en'); if (s) MAP = JSON.parse(s.textContent) || {}; } catch (e) { MAP = {}; } })();

  var css = document.createElement('style');
  css.setAttribute('data-lt-own', '1');
  css.textContent =
    '.cl-lang{position:fixed;top:10px;right:10px;z-index:10050;display:flex;border:1px solid var(--chiron-border,#cfcfcf);border-radius:99px;' +
    'background:var(--chiron-surface,#fff);box-shadow:0 2px 10px rgba(0,0,0,.15);overflow:hidden;' +
    'font:600 12px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
    '.cl-lang button{border:0;background:transparent;color:var(--chiron-fg,#222);padding:0 12px;height:34px;min-width:44px;cursor:pointer;font:inherit}' +
    '.cl-lang button[aria-pressed="true"]{background:var(--chiron-accent,#1e3a5f);color:#fff}' +
    '.cl-lang .cl-chip{display:none}' +
    '@media (max-width:560px){.cl-lang:not(.open) button[data-m]{display:none}.cl-lang:not(.open) .cl-chip{display:block;padding:0 10px;min-width:0;font-size:11px}' +
    '.cl-lang.open .cl-chip{display:none}.cl-lang{top:8px;right:8px}}' +
    'html.lang-it [data-lang="en"],html.lang-it .chiron-reveal-en,' +
    'html.lang-en [data-lang="it"],html.lang-en .chiron-reveal-en,html.lang-both .chiron-reveal-en{display:none!important}' +
    'html.lang-en .chiron-en-block[data-lang="en"],html.lang-both .chiron-en-block[data-lang="en"]{display:block!important}' +
    'html.lang-en [data-lang="en"]{color:inherit!important;font-size:inherit!important;font-style:normal!important;opacity:1!important}' +
    '.lt-en{display:block}' +
    'html.lang-both .lt-en{color:var(--chiron-muted,#666);font-size:.93em;margin-top:2px}' +
    'html.lang-both h1.lt-en,html.lang-both h2.lt-en,html.lang-both h3.lt-en,html.lang-both h4.lt-en{font-size:.95rem;font-weight:500}' +
    'td.lt-cell>.lt-en,th.lt-cell>.lt-en{display:block}';
  document.head.appendChild(css);

  // ---- tag the English markup the lesson already has ---------------------------------------------------------
  function isEN(el) { return el.nodeType === 1 && (el.matches(EN_SEL) || el.getAttribute('data-lang') === 'en'); }
  function hasEN(el) { return isEN(el) || !!el.querySelector(EN_SEL); }

  function tagExisting(scope) {
    var cq = scope.querySelectorAll ? scope.querySelectorAll(EN_CLS) : [];
    for (var c = 0; c < cq.length; c++) {            // class markup -> data-lang (an Italian citation inside .gloss stays Italian)
      var ce = cq[c]; if (ce.hasAttribute('data-lang') || ce.closest(SKIP_SEL)) continue;
      ce.setAttribute('data-lang', clsLang(ce.textContent, ce));
    }
    var q = scope.querySelectorAll ? scope.querySelectorAll('[data-en]') : [];
    for (var i = 0; i < q.length; i++) {              // an element that carries its English in an attribute
      var el = q[i]; if (el.closest(SKIP_SEL) || el.hasAttribute('data-lt-en')) continue;
      var en = el.getAttribute('data-en'); if (!en || !en.trim()) continue;
      el.setAttribute('data-lt-en', '1');
      if (el.querySelector('.chiron-en-block,.lt-en')) continue;      // the lesson's own script already built it
      var b = document.createElement('div'); b.className = 'lt-en'; b.setAttribute('data-lang', 'en'); b.setAttribute('data-lt-own', '1');
      b.textContent = en; el.appendChild(b);
    }
    var ts = scope.querySelectorAll ? scope.querySelectorAll('table') : [];
    for (var j = 0; j < ts.length; j++) tagTable(ts[j]);
  }
  // an "English"/"Inglese" column is English as a whole; an "Italiano" column Italian
  function tagTable(t) {
    var hr = t.querySelector('thead tr') || t.rows[0]; if (!hr || t.hasAttribute('data-lt-tbl')) return;
    t.setAttribute('data-lt-tbl', '1');
    for (var c = 0; c < hr.cells.length; c++) {
      var h = hr.cells[c].textContent.trim().toLowerCase(), lang = /^(english|inglese)\b/.test(h) ? 'en' : /^(italiano|italian)\b/.test(h) ? 'it' : '';
      if (!lang) continue;
      for (var r = 0; r < t.rows.length; r++) { var cell = t.rows[r].cells[c]; if (cell && !cell.getAttribute('data-lang')) cell.setAttribute('data-lang', lang); }
    }
  }

  // ---- find Italian blocks ----------------------------------------------------------------------------------
  function unitOf(tn) {
    var el = tn.parentElement;
    while (el && el !== document.body && !BLOCK[el.tagName]) el = el.parentElement;
    return el && el !== document.body ? el : null;
  }
  function itChildren(u) {                            // the child nodes of u that are Italian (not already English)
    var out = [], n;
    for (n = u.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { if (n.nodeValue.trim()) out.push(n); }
      else if (n.nodeType === 1 && !isEN(n) && !n.querySelector(EN_SEL) && !n.hasAttribute('data-lt-own') && !/^(SCRIPT|STYLE|BR)$/.test(n.tagName) && !n.classList.contains('chiron-reveal-en')) out.push(n);
    }
    return out;
  }
  function textOf(nodes) { return nodes.map(function (n) { return n.nodeType === 3 ? n.nodeValue : n.textContent; }).join(' '); }

  function collect(scope) {
    var units = [], seen = new Set();
    var tw = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null), tn;
    while ((tn = tw.nextNode())) {
      if (!tn.nodeValue.trim()) continue;
      var p = tn.parentElement; if (!p || p.closest(SKIP_SEL)) continue;
      var u = unitOf(tn); if (!u || seen.has(u) || u.closest(SKIP_SEL)) continue;
      seen.add(u);
      if (isEN(u) || u.closest(EN_SEL)) continue;
      // a unit that contains block children is only the unit for its own direct text
      var kids = itChildren(u), nodes = [];
      kids.forEach(function (k) { if (k.nodeType === 3 || !hasBlockDesc(k)) nodes.push(k); });
      if (!nodes.length) continue;
      var segs = [];                                  // a block that mixes an Italian run and an English run (IT quote + inline gloss): split them
      nodes.forEach(function (n) { var t = norm(n.nodeType === 3 ? n.nodeValue : n.textContent); if (t.split(/\s+/).length >= 3) segs.push({ n: n, t: t, l: langOf(t) }); });
      if (segs.length >= 2 && segs.some(function (g) { return g.l === 'it'; }) && segs.some(function (g) { return g.l === 'en'; })) {
        segs.forEach(function (g) {
          if (g.l !== 'it' && g.l !== 'en') return;
          var se = g.n;
          if (se.nodeType === 3) { var w = document.createElement('span'); w.setAttribute('data-lt-seg', '1'); se.parentNode.insertBefore(w, se); w.appendChild(se); se = w; }
          if (se.getAttribute('data-lang') && se.getAttribute('data-lang') !== g.l) return;
          units.push(g.l === 'en' ? { el: se, nodes: [se], text: g.t, lang: 'en' } : { el: se, nodes: [se], text: g.t, key: hash(g.t), lang: 'it' });
        });
        continue;
      }
      var text = norm(textOf(nodes));
      if (!/[a-zàèéìòù]{2}/i.test(text)) continue;
      var tag = u.tagName, small = tag === 'TD' || tag === 'TH' || /^H[1-6]$/.test(tag) || tag === 'SUMMARY' || tag === 'DT' || tag === 'LI' || tag === 'BUTTON' || tag === 'LABEL';
      var words = text.split(/\s+/).length;
      var lang = u.getAttribute('data-lang') || (u.closest('[lang]') && /^it/i.test(u.closest('[lang]').getAttribute('lang')) && u.hasAttribute('lang') ? 'it' : '') || langOf(text);
      if (tag === 'BUTTON' && !u.matches('.opt,[class*="choice"],[class*="option"]') && words < 5) continue;   // UI buttons are not lesson text
      if (!lang && /^H[1-6]$/.test(tag) && /[a-zàèéìòù]{3}/i.test(text)) lang = 'it';   // a heading with no English evidence in an Italian lesson is Italian ("I certificati")
      if (lang === 'en') { if (words >= 3 && !u.getAttribute('data-lang')) units.push({ el: u, nodes: nodes, text: text, lang: 'en' }); continue; }
      if (lang !== 'it') continue;
      if (words < (small ? (/^H[1-6]$/.test(tag) ? 1 : 2) : 3)) continue;
      units.push({ el: u, nodes: nodes, text: text, key: hash(text), lang: 'it' });
    }
    return units;
  }
  function hasBlockDesc(el) { return !!(el.querySelector && el.querySelector('p,li,td,th,h1,h2,h3,h4,h5,h6,div,blockquote,summary,button,pre')); }

  function paired(u) {
    var el = u.el;
    if (hasEN(el) && (isEN(el) ? false : !!el.querySelector(EN_SEL))) return true;           // an English chip/span inside it
    var n = el.nextElementSibling, pv = el.previousElementSibling;
    var head = /^H[1-6]$/.test(el.tagName), short = function (x) { return x.textContent.trim().split(/\s+/).length <= 16; };
    if (n && isEN(n) && (!head || short(n)) || pv && isEN(pv) && (!head || short(pv))) return true;   // a heading's translation is short, not the next paragraph
    if (head) return false;                                                                      // a heading is only ever paired by an adjacent short English line
    if (el.tagName === 'TD' || el.tagName === 'TH') {                                            // table row with an English cell
      var tr = el.parentElement, cells = tr ? tr.cells : [], hasE = false, first = null, i;
      for (i = 0; i < cells.length; i++) { if (cells[i].getAttribute('data-lang') === 'en' || cells[i].querySelector(EN_SEL)) hasE = true; }
      if (hasE) {
        for (i = 0; i < cells.length; i++) { var c = cells[i]; if (c.getAttribute('data-lang') === 'it' || (!c.getAttribute('data-lang') && langOf(c.textContent) === 'it')) { first = c; break; } }
        return first === el;
      }
    }
    var w = el.parentElement, k = 0;                                                              // inside a quote/box whose English sits next to the box: the box's FIRST Italian block is paired
    while (w && k < 2 && w !== document.body && !/^(SECTION|MAIN|BODY)$/.test(w.tagName)) {
      var wn = w.nextElementSibling, wp = w.previousElementSibling;
      if ((wn && isEN(wn)) || (wp && isEN(wp))) { var f = collect(w).filter(function (x) { return x.lang === 'it'; })[0]; return !!f && f.el === el; }
      w = w.parentElement; k++;
    }
    var a = el.parentElement, d = 0;
    while (a && d < 3 && a !== document.body) {                                                  // the wrapper owns exactly one Italian block + an English one
      if (a.querySelector(EN_SEL)) { return countIt(a) === 1; }
      a = a.parentElement; d++;
    }
    return false;
  }
  function countIt(a) { var n = 0; collect(a).forEach(function (x) { if (x.lang === 'it' && !x.el.closest(EN_SEL)) n++; }); return n; }

  // ---- apply -----------------------------------------------------------------------------------------------
  function tagIt(u) {
    var el = u.el;
    if (u.nodes.length === 1 && u.nodes[0].nodeType === 1 && u.nodes.every(function () { return true; }) && itChildren(el).length === 1 && !el.firstChild.nodeValue) {
      u.nodes[0].setAttribute('data-lang', 'it'); return;
    }
    if (u.nodes.length === 1 && u.nodes[0].nodeType === 1) { u.nodes[0].setAttribute('data-lang', 'it'); return; }
    var w = document.createElement('span'); w.setAttribute('data-lang', 'it'); w.setAttribute('data-lt-own', '1');
    el.insertBefore(w, u.nodes[0]);
    u.nodes.forEach(function (n) { w.appendChild(n); });
  }
  function addEN(u, en) {
    var el = u.el, tag = el.tagName, b;
    if (CLONE[tag] && !el.querySelector('p,li,td,th,h1,h2,h3,h4,h5,h6,div,blockquote,button')) {
      b = document.createElement(tag.toLowerCase());
      if (el.className) b.className = el.className.replace(/\b(active|open|show-en)\b/g, '').trim();
      b.classList.add('lt-en'); if (/^H[1-6]$/.test(tag)) b.classList.add('lt-h');
      el.setAttribute('data-lang', 'it');
      b.setAttribute('data-lang', 'en'); b.setAttribute('data-lt-own', '1'); b.textContent = en;
      el.parentNode.insertBefore(b, el.nextSibling);
    } else {
      tagIt(u);
      b = document.createElement('span'); b.className = 'lt-en'; b.setAttribute('data-lang', 'en'); b.setAttribute('data-lt-own', '1'); b.textContent = en;
      el.appendChild(b); el.classList.add('lt-cell');
    }
  }

  var stats = { autoEn: 0 }, state = new Map();   // Italian block element -> 'p' paired | 'f' filled from the map | 'm' missing
  function scan(scope) {
    if (MANUAL) return;
    tagExisting(scope);
    var us = collect(scope);
    us.forEach(function (u) {                         // English first, so an Italian block sees its English sibling whatever the order
      if (u.lang === 'en' && !u.el.hasAttribute('data-lt-done')) { u.el.setAttribute('data-lang', 'en'); u.el.setAttribute('data-lt-done', '1'); stats.autoEn++; }
    });
    us.forEach(function (u) {
      if (u.lang === 'en' || u.el.hasAttribute('data-lt-done')) return;
      var el = u.el;
      if (paired(u)) { state.set(el, { s: 'p' }); el.setAttribute('data-lt-done', 'p'); tagIt(u); return; }
      var en = MAP[u.key];
      if (en) { state.set(el, { s: 'f' }); el.setAttribute('data-lt-done', 'f'); addEN(u, en); }
      else state.set(el, { s: 'm', key: u.key, text: u.text });
    });
  }

  function set(m) {
    if (MODES.indexOf(m) < 0) return;
    mode = m; lsSet(m);
    root.classList.remove('lang-it', 'lang-both', 'lang-en'); root.classList.add('lang-' + m);
    if (bar && bar.firstChild) bar.firstChild.textContent = { it: 'IT', both: 'IT+EN', en: 'EN' }[m];
    if (bar) Array.prototype.forEach.call(bar.querySelectorAll('button[data-m]'), function (b) { b.setAttribute('aria-pressed', b.dataset.m === m ? 'true' : 'false'); });
  }
  var bar = null;
  function build() {
    bar = document.createElement('div'); bar.className = 'cl-lang'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Lingua / Language');
    bar.setAttribute('data-lt-own', '1');
    [['it', 'IT'], ['both', 'IT+EN'], ['en', 'EN']].forEach(function (x) {
      var b = document.createElement('button'); b.type = 'button'; b.dataset.m = x[0]; b.textContent = x[1];
      b.addEventListener('click', function () { set(x[0]); }); bar.appendChild(b);
    });
    var chip = document.createElement('button'); chip.type = 'button'; chip.className = 'cl-chip'; chip.setAttribute('aria-label', 'Lingua / Language');
    chip.addEventListener('click', function () { bar.classList.add('open'); });
    bar.insertBefore(chip, bar.firstChild);
    Array.prototype.forEach.call(bar.querySelectorAll('button[data-m]'), function (b) { b.addEventListener('click', function () { bar.classList.remove('open'); }); });
    document.body.appendChild(bar);
    set(mode);
  }

  root.classList.add('lang-' + mode);                 // before first paint of anything that loads after us
  window.__chironLang = {
    stats: stats,
    missingList: function () { var o = []; state.forEach(function (v, el) { if (v.s === 'm' && el.isConnected) o.push(el.tagName + '.' + el.className + ' | ' + el.textContent.trim().slice(0, 100)); }); return o; },
    get mode() { return mode; }, set: set,
    units: function () {                              // Italian blocks still without English: the work list for translation
      scan(document.body); var o = [];
      state.forEach(function (v, el) { if (v.s === 'm' && el.isConnected) o.push({ key: v.key, it: v.text, tag: el.tagName, sec: (el.closest('section[id],.lesson-section') || {}).id || '' }); });
      return o;
    },
    report: function () {                             // blocks still in the DOM (a re-rendering lesson drops and recreates them)
      scan(document.body);
      var c = { p: 0, f: 0, m: 0 };
      state.forEach(function (v, el) { if (el.isConnected) c[v.s]++; else state.delete(el); });
      var it = c.p + c.f + c.m;
      return { mode: mode, italianBlocks: it, existingEnglish: c.p, filledFromMap: c.f, missing: c.m, autoTaggedEnglish: stats.autoEn, coverage: it ? +((c.p + c.f) / it).toFixed(4) : 1 };
    }
  };

  var pending = false;
  function later() { if (pending) return; pending = true; requestAnimationFrame(function () { pending = false; scan(document.body); }); }
  function start() {
    build(); scan(document.body);
    if (MANUAL) return;
    try {
      new MutationObserver(function (ms) {            // JS-rendered content (quiz explanations, exam review): scan again
        for (var i = 0; i < ms.length; i++) for (var j = 0; j < ms[i].addedNodes.length; j++) {
          var n = ms[i].addedNodes[j]; if (n.nodeType === 1 && !n.hasAttribute('data-lt-own') && !n.closest('[data-lt-own]')) { later(); return; }
        }
      }).observe(document.body, { childList: true, subtree: true });
    } catch (e) { /* no observer: static lessons still fully work */ }
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
