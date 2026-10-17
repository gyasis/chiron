/*
 * inapp — Ask embedded in the phone app's Chiedi overlay (?inapp=1).
 *
 * The app's WebView never enables multiple windows, so a window.open() or a
 * target=_blank link inside the Ask iframe can replace the WHOLE app. In-app,
 * every link that would leave Ask is posted to the parent instead, which opens
 * lessons in its own lesson overlay and anything else in the system browser.
 * Messages go only to, and are only accepted from, the app's own origins.
 */

/** Origins the Tauri app's main webview can have (Android/Windows, macOS/iOS/Linux). */
export const APP_ORIGINS = ['http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost'];

/** In-app only when ?inapp=1 exactly — any other value is the plain web page. */
export const isInApp = search => {
  try { return new URLSearchParams(search).get('inapp') === '1'; } catch { return false; }
};

/** The app origin to talk to: the embedder, if it is one of APP_ORIGINS. */
export function appOrigin(win, origins = APP_ORIGINS) {
  if (win.parent === win) return null;          // opened directly, not framed
  let o = '';
  try { o = (win.location.ancestorOrigins && win.location.ancestorOrigins[0]) || new URL(win.document.referrer).origin; } catch {}
  return origins.includes(o) ? o : null;
}

/** Wire the bridge. Returns `open(url)` (posts to the app), or null when not in-app. */
export function installInAppBridge(win, { origins = APP_ORIGINS, onTheme } = {}) {
  if (!isInApp(win.location.search)) return null;
  const target = appOrigin(win, origins);
  if (!target) { console.warn('[chiron] ask: ?inapp=1 but the embedder is not the app — links stay normal'); return null; }
  const doc = win.document;
  const open = url => {
    const abs = new URL(url, win.location.href).href;
    win.parent.postMessage({ type: 'chiron-ask:open', url: abs }, target);
  };
  // Safety net for anything that calls window.open directly.
  win.open = url => { if (url) open(String(url)); return null; };
  // Links that would leave Ask: a new window, or a page outside /ask/ (which would nest the app inside the frame).
  doc.addEventListener('click', ev => {
    const a = ev.target && ev.target.closest && ev.target.closest('a[href]');
    if (!a || ev.defaultPrevented) return;
    const u = new URL(a.getAttribute('href'), win.location.href);
    if (u.href.split('#')[0] === win.location.href.split('#')[0]) return;   // in-page anchor
    if (a.target !== '_blank' && u.origin === win.location.origin && u.pathname.startsWith('/ask/')) return;
    ev.preventDefault();
    open(u.href);
  }, true);
  // Theme comes from the app — accepted only from the app origin, only from the parent frame.
  win.addEventListener('message', ev => {
    if (ev.origin !== target || ev.source !== win.parent) return;
    const d = ev.data || {};
    if (d.type !== 'chiron-app:theme' || (d.theme !== 'light' && d.theme !== 'dark')) return;
    if (onTheme) onTheme(d.theme); else doc.documentElement.setAttribute('data-theme', d.theme);
  });
  win.parent.postMessage({ type: 'chiron-ask:ready' }, target);
  console.info('[chiron] ask: in-app bridge to', target);
  return open;
}
