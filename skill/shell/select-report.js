/* select-report.js — tells whoever is hosting a lesson WHICH TEXT the learner has selected, so the phone app's
 * tutor panel can turn it into numbered highlights (⭐ capture, cards, images …). A streamed lesson runs in a
 * cross-origin iframe, so the parent cannot read its selection; this posts it instead. Injected into every
 * lesson.html at serve time (server/app.py), next to scene-report.js. Harmless in a normal browser tab.
 *   postMessage({type:'chiron-select', text, context}) to the parent on every selection change (debounced);
 *   text '' = the selection was cleared. context = the enclosing block's text (capture provenance). */
(function () {
  'use strict';
  if (window.parent === window) return;            // top-level tab: nobody to tell
  var timer = 0, lastText = null;
  function block(node) {
    var el = node && (node.nodeType === 1 ? node : node.parentElement);
    while (el && el !== document.body && !/^(P|LI|TD|TH|DIV|SECTION|ARTICLE|BLOCKQUOTE|H[1-6])$/.test(el.tagName)) el = el.parentElement;
    return el && el !== document.body ? (el.innerText || '').trim().slice(0, 1500) : '';
  }
  function report() {
    var s = window.getSelection ? window.getSelection() : null;
    var text = s ? String(s).replace(/\s+/g, ' ').trim().slice(0, 400) : '';
    if (text === lastText) return;
    lastText = text;
    try {
      parent.postMessage({ type: 'chiron-select', text: text, context: text && s.rangeCount ? block(s.getRangeAt(0).commonAncestorContainer) : '' }, '*');
    } catch (e) { console.warn('chiron select-report: postMessage failed', e); }
  }
  document.addEventListener('selectionchange', function () { clearTimeout(timer); timer = setTimeout(report, 250); });
})();
