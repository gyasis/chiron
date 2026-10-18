/* inapp-boot — Sessione / Ascolto / Mazzi inside the phone app's studio overlay (?inapp=1).
 * Same bridge as Ask (ask/inapp.js): target=_blank links and links to other pages are posted to the app instead of
 * replacing the WebView; the app's theme wins over the stored one. Inert unless ?inapp=1, so the web pages are unchanged. */
(function () {
  try {
    var q = new URLSearchParams(location.search);
    if (q.get('inapp') !== '1') return;
    var h = document.documentElement; h.setAttribute('data-inapp', '');
    var t = q.get('theme'); if (t === 'light' || t === 'dark') h.setAttribute('data-theme', t);
    import('/ask/inapp.js').then(function (m) { m.installInAppBridge(window); }, function (e) { console.warn('[chiron] inapp bridge not loaded', e); });
  } catch (e) { console.warn('[chiron] inapp boot', e); }
})();
