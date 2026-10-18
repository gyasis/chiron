'use strict';
/* Overlay back-stack + the Chiedi (Ask) message bridge. Loaded before app.js.
 *
 * Android back: WryActivity calls webView.goBack() when it can, else finishes the activity. So each overlay pushes a
 * history entry when it opens and popstate closes it — back closes the overlay, and with none open, back leaves the
 * app as before. The ‹ button goes through history.back() so the entry is consumed either way. */
(function (root) {
  function overlayStack(win, doc) {
    const stack = [];   // ids of open overlays, in the order their history entries were pushed
    const el = id => doc.getElementById(id);
    const isOpen = id => el(id).classList.contains('open');
    function open(id) {
      if (!isOpen(id)) el(id).classList.add('open');
      if (stack[stack.length - 1] === id) return;   // already the top entry (e.g. a second lesson replacing the first)
      stack.push(id); win.history.pushState({ chironOverlay: id, depth: stack.length }, '');
    }
    function close(id) {
      if (stack[stack.length - 1] === id) { win.history.back(); return; }   // popstate does the closing
      const i = stack.indexOf(id); if (i >= 0) stack.splice(i, 1);
      el(id).classList.remove('open');
    }
    win.addEventListener('popstate', ev => {
      const depth = (ev.state && ev.state.depth) || 0;
      while (stack.length > depth) el(stack.pop()).classList.remove('open');
    });
    return { open, close, isOpen, stack };
  }

  /* Ask (and the studio pages: Sessione / Ascolto / Mazzi) post {type:'chiron-ask:open', url} for anything that would
   * leave them (a new window would replace the app's WebView). Accept it only from one of OUR frames, at the origin it
   * was loaded from. `frames` lists them all; `frame` (one) is kept for the single-frame form. */
  function askBridge(win, { frame, frames, origin, openLesson, openStudio, openExternal, currentTheme }) {
    const all = () => frames ? frames() : [frame()];
    win.addEventListener('message', ev => {
      const fr = all().find(f => f && f.contentWindow && ev.source === f.contentWindow);
      if (!fr || ev.origin !== origin()) return;
      const d = ev.data || {};
      if (d.type === 'chiron-ask:ready') { api.theme(currentTheme(), fr); return; }   // a theme change made while Ask was loading
      if (d.type !== 'chiron-ask:open' || typeof d.url !== 'string') return;
      let u; try { u = new URL(d.url); } catch (e) { return; }
      /* matchmadness:// is the one custom scheme a page may ask for: the lesson's "Gioca in Match Madness" button hands its
       * collection to the Match Madness app. Anything else that is not http(s) stays refused. */
      if (u.protocol === 'matchmadness:') { openExternal(u.href); return; }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') { console.warn('chiron ask: refused to open', d.url); return; }
      const m = u.origin === ev.origin && u.pathname.match(/^\/lessons\/(.+)\/lesson\.html$/);
      if (m) openLesson(m[1].split('/').map(decodeURIComponent).join('/'), u.hash);
      else if (u.origin === ev.origin && openStudio && openStudio(u)) return;   // another in-app page (Sessione ↔ Ascolto, Mazzi → drill)
      else openExternal(u.href);
    });
    const api = {
      theme(t, only) { (only ? [only] : all()).forEach(fr => { if (fr && fr.contentWindow && fr.dataset.src) fr.contentWindow.postMessage({ type: 'chiron-app:theme', theme: t }, origin()); }); },
    };
    return api;
  }

  /* Point a frame at a new page WITHOUT a history entry. Re-setting an already-loaded iframe's src pushes one, and back
   * would then rewind the hidden frame instead of closing the overlay; a fresh iframe's first load replaces about:blank. */
  function loadFrame(doc, id, url) {
    const old = doc.getElementById(id);
    if (!old.getAttribute('src')) { old.src = url; return old; }
    const fr = old.cloneNode(false); fr.src = url; old.replaceWith(fr); return fr;
  }

  root.ChironNav = { overlayStack, askBridge, loadFrame };
})(typeof window !== 'undefined' ? window : globalThis);
