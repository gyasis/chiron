/* say-shim — window.speechSynthesis for WebViews that have none (the Android app's Chiedi overlay).
 * Ask reads answers aloud through the Web Speech API; Android's WebView does not implement it, so 🔊 did nothing.
 * Where speechSynthesis is missing or is a WebView stub, speak() goes to Chiron's POST /api/oral/say {text, lang} (Lucrezia, her English
 * voice for English) and plays the returned audio. Browsers that have Web Speech keep their own engine. */
(function () {
  'use strict';
  // In the app (?inapp=1) always take over: Android's WebView exposes a speechSynthesis object that has no voices and
  // speaks nothing, so "is it defined?" is not enough (seen on the Pixel Fold 2026-10-18).
  var inApp = /[?&]inapp=1\b/.test(location.search), wv = /; wv\)/.test(navigator.userAgent);
  if (!inApp && !wv && typeof window.speechSynthesis !== 'undefined') return;
  var queue = [], cur = null, busy = false;

  function guessLang(t, hint) {
    if (hint) return /^en/i.test(hint) ? 'en' : 'it';
    var it = (t.match(/\b(il|lo|la|le|gli|di|che|è|per|con|una|un|del|della|non|sono|nel|alla|come|anche|dei|delle)\b/gi) || []).length;
    var en = (t.match(/\b(the|and|of|is|are|to|with|for|that|this|in|on|as|it|you|can|what)\b/gi) || []).length;
    return it > en ? 'it' : 'en';
  }
  /* OmniVoice fails (HTTP 500) on a whole multi-paragraph answer, so speak one sentence-sized chunk at a time:
     markdown stripped, chunks of at most ~220 chars, the next chunk fetched while the current one plays. */
  function chunks(t) {
    t = String(t || '').replace(/```[\s\S]*?```/g, ' ').replace(/[*_#>`|~]+/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
    var out = [], cur = '';
    (t.match(/[^.!?;:]+[.!?;:]*\s*/g) || [t]).forEach(function (s) {
      s = s.trim(); if (!s) return;
      while (s.length > 220) { var cut = s.lastIndexOf(' ', 220); if (cut < 80) cut = 220; out.push(s.slice(0, cut)); s = s.slice(cut).trim(); }
      if ((cur + ' ' + s).trim().length > 220) { if (cur) out.push(cur); cur = s; } else cur = (cur + ' ' + s).trim();
    });
    if (cur) out.push(cur);
    return out;
  }
  function fetchAudio(text, lang) {
    return fetch('/api/oral/say', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text, lang: lang }) })
      .then(function (r) { if (!r.ok) throw new Error('TTS HTTP ' + r.status); return r.blob(); });
  }
  function fire(u, name, ev) { try { if (typeof u['on' + name] === 'function') u['on' + name](ev || { utterance: u }); } catch (e) { console.warn('chiron say-shim: handler', name, e); } }

  function next() {
    if (busy || !queue.length) return;
    var job = queue[0]; busy = true;
    if (!job.audio) job.audio = fetchAudio(job.text, job.lang);
    if (queue[1] && !queue[1].audio) queue[1].audio = fetchAudio(queue[1].text, queue[1].lang);   // prefetch
    job.audio.then(function (b) {
      if (queue[0] !== job) return;                    // cancelled meanwhile
      var url = URL.createObjectURL(b), a = new Audio(url);
      cur = a; a.playbackRate = job.u.rate || 1;
      var done = function (err) {
        URL.revokeObjectURL(url); if (cur === a) cur = null;
        if (queue[0] === job) queue.shift();
        busy = false;
        if (err) { fire(job.u, 'error', { utterance: job.u, error: err }); queue = queue.filter(function (j) { return j.u !== job.u; }); }
        else if (job.last) fire(job.u, 'end');
        next();
      };
      a.onended = function () { done(); };
      a.onerror = function () { done('audio playback failed'); };
      if (job.first) fire(job.u, 'start');
      return a.play();
    }).catch(function (e) {
      if (queue[0] !== job) { console.warn('chiron say-shim: cancelled utterance failed, ignored —', e.message); return; }
      console.warn('chiron say-shim: could not speak —', e.message);
      if (queue[0] === job) queue.shift();
      busy = false; fire(job.u, 'error', { utterance: job.u, error: e.message });
      queue = queue.filter(function (j) { return j.u !== job.u; });
      next();
    });
  }

  function Utterance(text) {
    this.text = text || ''; this.lang = ''; this.rate = 1; this.pitch = 1; this.volume = 1; this.voice = null;
    this.onstart = this.onend = this.onerror = this.onboundary = null;
  }
  Utterance.prototype.addEventListener = function (n, f) { this['on' + n] = f; };

  var VOICES = [{ name: 'Lucrezia', lang: 'it-IT', default: true, localService: false, voiceURI: 'chiron-lucrezia-it' },
                { name: 'Lucrezia (English)', lang: 'en-US', default: false, localService: false, voiceURI: 'chiron-lucrezia-en' }];
  window.SpeechSynthesisUtterance = Utterance;
  try { Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    speak: function (u) {
      var lang = guessLang(u.text, u.lang), cs = chunks(u.text);
      cs.forEach(function (c, i) { queue.push({ u: u, text: c, lang: lang, first: i === 0, last: i === cs.length - 1 }); });
      if (!cs.length) fire(u, 'end');
      next();
    },
    cancel: function () { queue = []; if (cur) { cur.pause(); cur = null; } busy = false; },
    pause: function () { if (cur) cur.pause(); },
    resume: function () { if (cur) cur.play(); },
    getVoices: function () { return VOICES.slice(); },
    get speaking() { return busy; }, get pending() { return queue.length > 0; }, get paused() { return !!(cur && cur.paused); },
    onvoiceschanged: null, addEventListener: function () {}, removeEventListener: function () {}
  } }); } catch (e) { console.warn('chiron say-shim: cannot replace speechSynthesis —', e.message); }
})();
