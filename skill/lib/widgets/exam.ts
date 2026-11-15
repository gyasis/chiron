/**
 * Exam and simulation widgets for medicine lessons.
 *
 *  - `exam-mtf`: a timed written exam in the "multiple true/false" format. Each question has a
 *    stem plus statements the candidate marks true or false; one widget holds the whole exam.
 *  - `castest`: a staged cardiac-arrest simulation where the candidate picks the team-leader
 *    action at each stage and is scored on a checklist.
 *
 * Each renderer emits a root element carrying the spec as JSON plus an inline IIFE that builds
 * and drives the UI. The inline scripts avoid asterisks and backticks because the medicine
 * assembler runs an inline-markdown pass over widget HTML. All colours come from `--chiron-*` tokens (see shell/clinical-widgets.css).
 */
import type { WidgetSpec } from '../schemas/widget-spec.js';

type ExamMtfWidget = Extract<WidgetSpec, { type: 'exam-mtf' }>;
type CastestWidget = Extract<WidgetSpec, { type: 'castest' }>;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** JSON safe to embed inside a <script> element. */
function jsonForScript(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

/** Stable short hash for deriving a storage key when the spec has no id. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// ---------------------------------------------------------------------------
// exam-mtf
// ---------------------------------------------------------------------------

const EXAM_JS = String.raw`
(function () {
  var root = document.getElementById(__ROOT__);
  if (!root) return;
  var data;
  try { data = JSON.parse(document.getElementById(__ROOT__ + '-data').textContent); } catch (e) { return; }
  var LABELS = {
    it: { t: 'Vero', f: 'Falso', start: "Inizia l'esame", submit: 'Consegna', left: 'Tempo rimasto',
      pass: 'Superato', fail: 'Non superato', qOf: 'Domanda {n} di {m}', review: 'Rivedi', retry: "Ripeti l'esame",
      prev: 'Indietro', next: 'Avanti', unans: 'Affermazioni senza risposta: {n}', score: 'Punteggio', pct: 'Percentuale',
      used: 'Tempo usato', topics: 'Per argomento', topic: 'Argomento', confirm: 'Ci sono {n} affermazioni senza risposta, contate come errate. Consegnare comunque?',
      yes: 'Consegna', no: 'Annulla', mine: 'La tua risposta', answer: 'Risposta corretta', none: 'nessuna', right: 'Corretto', wrong: 'Errato',
      jump: 'Vai alla domanda', en: 'English', noTime: 'Nessun limite di tempo', timeUp: 'Tempo scaduto: esame consegnato.', started: 'Cronometro avviato' },
    en: { t: 'True', f: 'False', start: 'Start exam', submit: 'Submit', left: 'Time left',
      pass: 'Passed', fail: 'Not passed', qOf: 'Question {n} of {m}', review: 'Review', retry: 'Retake exam',
      prev: 'Previous', next: 'Next', unans: 'Unanswered statements: {n}', score: 'Score', pct: 'Percentage',
      used: 'Time used', topics: 'By topic', topic: 'Topic', confirm: '{n} statements are unanswered and count as wrong. Submit anyway?',
      yes: 'Submit', no: 'Cancel', mine: 'Your answer', answer: 'Correct answer', none: 'none', right: 'Correct', wrong: 'Wrong',
      jump: 'Go to question', en: 'English', noTime: 'No time limit', timeUp: 'Time is up: exam submitted.', started: 'Timer started' }
  };
  var L = LABELS[data.lang] || LABELS.it;
  var Q = data.questions;
  var KEY = 'chiron-exam:' + data.key;
  var limitSec = data.limitSec, limitMs = data.limitMs;
  function fmt(s) { s = Math.max(0, Math.round(s)); var m = Math.floor(s / 60), r = s % 60; return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r; }
  function tpl(s, o) { return s.replace(/\{(\w+)\}/g, function (_, k) { return o[k]; }); }
  function h(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function blank() {
    var a = Q.map(function (q) { return q.statements.map(function () { return null; }); });
    return { answers: a, cur: 0, startedAt: null, endedAt: null, submitted: false, timeUp: false };
  }
  var st = blank();
  var showEn = {}, confirming = false, focusKey = null, tick = null;

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (o && o.answers && o.answers.length === Q.length) st = o;
    } catch (e) { void 0; }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { void 0; } }

  function counts() {
    var total = 0, right = 0, unanswered = 0, byTopic = {}, order = [];
    Q.forEach(function (q, qi) {
      var t = q.topic || '—';
      if (!byTopic[t]) { byTopic[t] = { right: 0, total: 0 }; order.push(t); }
      q.statements.forEach(function (s, si) {
        total++; byTopic[t].total++;
        var a = st.answers[qi][si];
        if (a === null) unanswered++;
        if (a === s.correct) { right++; byTopic[t].right++; }
      });
    });
    return { total: total, right: right, unanswered: unanswered, byTopic: byTopic, order: order };
  }
  function qUnanswered(qi) { return st.answers[qi].filter(function (a) { return a === null; }).length; }
  function elapsed() {
    if (!st.startedAt) return 0;
    return ((st.endedAt || Date.now()) - st.startedAt) / 1000;
  }

  function submit(auto) {
    if (st.submitted) return;
    st.submitted = true; st.timeUp = !!auto; confirming = false;
    st.endedAt = limitMs ? Math.min(Date.now(), st.startedAt + limitMs) : Date.now();
    if (tick) { clearInterval(tick); tick = null; }
    save(); render();
    var res = root.querySelector('.emtf-results');
    if (res && res.scrollIntoView) res.scrollIntoView({ block: 'nearest' });
  }
  function startTimer() {
    if (tick || st.submitted || !st.startedAt || !limitSec) return;
    tick = setInterval(function () {
      var left = limitSec - elapsed();
      var el = root.querySelector('.emtf-time');
      if (el) el.textContent = fmt(left);
      if (left <= 0) submit(true);
    }, 1000);
  }

  function statementHtml(qi, si) {
    var q = Q[qi], s = q.statements[si], a = st.answers[qi][si], done = st.submitted;
    var ok = a === s.correct;
    function btn(v, label) {
      var cls = 'emtf-btn';
      if (a === v) cls += ' is-mine';
      if (done && s.correct === v) cls += ' is-key';
      if (done && a === v && !ok) cls += ' is-miss';
      return '<button type="button" class="' + cls + '" data-qi="' + qi + '" data-si="' + si + '" data-v="' + (v ? 1 : 0) +
        '" aria-pressed="' + (a === v) + '"' + (done ? ' disabled' : '') + ' data-fk="s' + si + (v ? 't' : 'f') + '">' + h(label) + '</button>';
    }
    var out = '<li class="emtf-stmt' + (done ? (ok ? ' is-right' : ' is-wrong') : '') + '">' +
      '<p class="emtf-stmt-text"><span class="emtf-letter">' + String.fromCharCode(65 + si) + '</span> ' + h(s.text) + '</p>' +
      '<div class="emtf-tf" role="group" aria-label="' + h(String.fromCharCode(65 + si) + ': ' + s.text) + '">' + btn(true, L.t) + btn(false, L.f) + '</div>';
    if (done) {
      out += '<div class="emtf-result"><p class="emtf-verdict">' + (ok ? L.right : L.wrong) + ' · ' + L.mine + ': ' +
        (a === null ? L.none : (a ? L.t : L.f)) + ' · ' + L.answer + ': ' + (s.correct ? L.t : L.f) + '</p>';
      if (s.explanation) out += '<p class="emtf-expl">' + h(s.explanation) + '</p>';
      if (s.explanationEn) {
        var k = qi + '-' + si, on = !!showEn[k];
        out += '<button type="button" class="emtf-link" data-en="' + k + '" aria-expanded="' + on + '">' + L.en + '</button>';
        if (on) out += '<p class="emtf-expl emtf-expl-en" lang="en">' + h(s.explanationEn) + '</p>';
      }
      out += '</div>';
    }
    return out + '</li>';
  }

  function render() {
    var c = counts(), q = Q[st.cur], qi = st.cur, pct = c.total ? Number((c.right / c.total / 0.01).toFixed(6)) : 0;
    var passed = pct >= data.passPct;
    var html = '';
    html += '<div class="emtf-bar">';
    if (!st.submitted) {
      if (!st.startedAt) html += '<button type="button" class="emtf-primary" data-act="start">' + L.start + '</button>';
      html += '<span class="emtf-timer" role="timer">' + L.left + ': <b class="emtf-time">' +
        (limitSec ? fmt(limitSec - elapsed()) : '—') + '</b>' + (limitSec ? '' : ' (' + L.noTime + ')') + '</span>';
    }
    html += '<span class="emtf-unans" aria-live="polite">' + tpl(L.unans, { n: c.unanswered }) + '</span></div>';

    if (st.submitted) {
      html += '<div class="emtf-results" tabindex="-1"><div class="emtf-score">' +
        '<span class="emtf-badge ' + (passed ? 'is-pass' : 'is-fail') + '">' + (passed ? L.pass : L.fail) + '</span>' +
        '<dl class="emtf-stats"><div><dt>' + L.score + '</dt><dd>' + c.right + ' / ' + c.total + '</dd></div>' +
        '<div><dt>' + L.pct + '</dt><dd>' + pct.toFixed(1) + '% <small>(≥ ' + data.passPct + '%)</small></dd></div>' +
        '<div><dt>' + L.used + '</dt><dd>' + (st.startedAt ? fmt(elapsed()) : '—') + '</dd></div></dl></div>';
      if (st.timeUp) html += '<p class="emtf-note">' + L.timeUp + '</p>';
      html += '<table class="emtf-topics"><thead><tr><th>' + L.topic + '</th><th>' + L.score + '</th><th>%</th></tr></thead><tbody>';
      c.order.forEach(function (t) {
        var b = c.byTopic[t];
        html += '<tr><td>' + h(t) + '</td><td>' + b.right + ' / ' + b.total + '</td><td>' + (b.total ? Math.round(b.right / b.total / 0.01) : 0) + '%</td></tr>';
      });
      html += '</tbody></table><div class="emtf-actions"><button type="button" class="emtf-primary" data-act="review">' + L.review +
        '</button><button type="button" class="emtf-secondary" data-act="retry">' + L.retry + '</button></div></div>';
    }

    html += '<nav class="emtf-grid" aria-label="' + h(L.jump) + '">';
    Q.forEach(function (_, i) {
      var cls = 'emtf-num';
      if (i === qi) cls += ' is-cur';
      if (st.submitted) {
        var wrong = Q[i].statements.some(function (s, si) { return st.answers[i][si] !== s.correct; });
        cls += wrong ? ' is-wrong' : ' is-right';
      } else if (qUnanswered(i) === 0) cls += ' is-done';
      html += '<button type="button" class="' + cls + '" data-act="jump" data-i="' + i + '" aria-label="' + h(L.jump + ' ' + (i + 1)) +
        '"' + (i === qi ? ' aria-current="true"' : '') + ' data-fk="n' + i + '">' + (i + 1) + '</button>';
    });
    html += '</nav>';

    html += '<section class="emtf-q" aria-labelledby="' + __ROOT__ + '-qh"><header class="emtf-qhead"><h4 id="' + __ROOT__ + '-qh" class="emtf-qno">' +
      tpl(L.qOf, { n: qi + 1, m: Q.length }) + '</h4>' + (q.topic ? '<span class="emtf-topic">' + h(q.topic) + '</span>' : '') + '</header>' +
      '<p class="emtf-stem">' + h(q.stem) + '</p><ol class="emtf-stmts">';
    q.statements.forEach(function (_, si) { html += statementHtml(qi, si); });
    html += '</ol></section>';

    html += '<div class="emtf-actions"><button type="button" class="emtf-secondary" data-act="prev"' + (qi === 0 ? ' disabled' : '') + ' data-fk="prev">' + L.prev +
      '</button><button type="button" class="emtf-secondary" data-act="next"' + (qi === Q.length - 1 ? ' disabled' : '') + ' data-fk="next">' + L.next + '</button>';
    if (!st.submitted) html += '<button type="button" class="emtf-primary" data-act="submit">' + L.submit + '</button>';
    html += '</div>';

    if (confirming && !st.submitted) {
      html += '<div class="emtf-confirm" role="alertdialog" aria-label="' + h(L.submit) + '"><p>' + tpl(L.confirm, { n: c.unanswered }) +
        '</p><div class="emtf-actions"><button type="button" class="emtf-primary" data-act="confirm-yes" data-fk="cy">' + L.yes +
        '</button><button type="button" class="emtf-secondary" data-act="confirm-no">' + L.no + '</button></div></div>';
    }
    root.innerHTML = html;
    if (focusKey) {
      var f = root.querySelector('[data-fk="' + focusKey + '"]');
      if (f && !f.disabled) f.focus();
      focusKey = null;
    }
  }

  root.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var b = t.closest('button');
    if (!b || !root.contains(b)) return;
    if (b.hasAttribute('data-en')) { var k = b.getAttribute('data-en'); showEn[k] = !showEn[k]; focusKey = null; render(); return; }
    if (b.hasAttribute('data-qi')) {
      if (st.submitted) return;
      var qi = +b.getAttribute('data-qi'), si = +b.getAttribute('data-si'), v = b.getAttribute('data-v') === '1';
      st.answers[qi][si] = st.answers[qi][si] === v ? null : v;
      focusKey = b.getAttribute('data-fk'); save(); render(); return;
    }
    var act = b.getAttribute('data-act');
    if (act === 'start') { st.startedAt = Date.now(); save(); startTimer(); render(); }
    else if (act === 'prev') { st.cur = Math.max(0, st.cur - 1); save(); render(); }
    else if (act === 'next') { st.cur = Math.min(Q.length - 1, st.cur + 1); save(); render(); }
    else if (act === 'jump') { st.cur = +b.getAttribute('data-i'); focusKey = b.getAttribute('data-fk'); save(); render(); }
    else if (act === 'submit') { if (counts().unanswered > 0) { confirming = true; focusKey = 'cy'; render(); } else submit(false); }
    else if (act === 'confirm-yes') submit(false);
    else if (act === 'confirm-no') { confirming = false; render(); }
    else if (act === 'review') { st.cur = 0; render(); var qs = root.querySelector('.emtf-q'); if (qs && qs.scrollIntoView) qs.scrollIntoView({ block: 'nearest' }); }
    else if (act === 'retry') {
      st = blank(); showEn = {}; confirming = false;
      if (tick) { clearInterval(tick); tick = null; }
      try { localStorage.removeItem(KEY); } catch (e) { void 0; }
      render();
    }
  });

  load();
  if (st.startedAt && !st.submitted && limitSec && elapsed() >= limitSec) { st.submitted = true; st.timeUp = true; st.endedAt = st.startedAt + limitMs; }
  render();
  startTimer();
})();
`;

/** exam-mtf — whole written exam with timer, navigation, scoring and review. */
export function renderExamMtf(spec: ExamMtfWidget): string {
  const id = nextId('emtf');
  const key = spec.id ?? hash(JSON.stringify(spec));
  const data = {
    key,
    lang: spec.lang ?? 'it',
    limitSec: spec.timeLimitMin ? Math.round(spec.timeLimitMin * 60) : 0,
    limitMs: spec.timeLimitMin ? Math.round(spec.timeLimitMin * 60000) : 0,
    passPct: spec.passPct ?? 75,
    questions: spec.questions.map((q) => ({
      topic: q.topic ?? '',
      stem: q.stem,
      statements: q.statements.map((s) => ({
        text: s.text,
        correct: s.correct,
        explanation: s.explanation ?? '',
        explanationEn: s.explanationEn ?? '',
      })),
    })),
  };
  return [
    `<section class="chiron-widget emtf-widget" data-widget="exam-mtf" data-widget-type="exam-mtf" lang="${spec.lang ?? 'it'}">`,
    spec.title ? `<h3 class="emtf-title">${esc(spec.title)}</h3>` : '',
    spec.instructions ? `<p class="emtf-instr">${esc(spec.instructions)}</p>` : '',
    `<div class="emtf-root" id="${id}"></div>`,
    `<script type="application/json" id="${id}-data">${jsonForScript(data)}</script>`,
    `<script>${EXAM_JS.replace(/__ROOT__/g, JSON.stringify(id))}</script>`,
    `</section>`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// castest
// ---------------------------------------------------------------------------

const CAST_JS = String.raw`
(function () {
  var root = document.getElementById(__ROOT__);
  if (!root) return;
  var data;
  try { data = JSON.parse(document.getElementById(__ROOT__ + '-data').textContent); } catch (e) { return; }
  var LABELS = {
    it: { start: 'Inizia la simulazione', stage: 'Fase {n} di {m}', next: 'Prossima fase', finish: 'Vedi esito', correct: 'Corretto', wrong: 'Errato',
      critical: 'Errore critico', key: 'Azione corretta', setting: 'Scenario', briefing: 'Briefing', checklist: 'Checklist', item: 'Voce', met: 'Raggiunta',
      yes: 'Sì', no: 'No', crit: 'Errori critici', score: 'Voci raggiunte', pass: 'Superato', fail: 'Non superato', rule: 'Criterio', debrief: 'Debriefing', retry: 'Ripeti',
      rhythm: 'Ritmo', hr: 'FC', bp: 'PA', spo2: 'SpO2', etco2: 'EtCO2', monitor: 'Monitor' },
    en: { start: 'Start simulation', stage: 'Stage {n} of {m}', next: 'Next stage', finish: 'See result', correct: 'Correct', wrong: 'Incorrect',
      critical: 'Critical error', key: 'Correct action', setting: 'Setting', briefing: 'Briefing', checklist: 'Checklist', item: 'Item', met: 'Met',
      yes: 'Yes', no: 'No', crit: 'Critical errors', score: 'Items met', pass: 'Passed', fail: 'Not passed', rule: 'Rule', debrief: 'Debrief', retry: 'Retry',
      rhythm: 'Rhythm', hr: 'HR', bp: 'BP', spo2: 'SpO2', etco2: 'EtCO2', monitor: 'Monitor' }
  };
  var L = LABELS[data.lang] || LABELS.it;
  var S = data.stages;
  function h(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function tpl(s, o) { return s.replace(/\{(\w+)\}/g, function (_, k) { return o[k]; }); }
  var phase = 'brief', i = 0, picks = S.map(function () { return null; }), focusKey = null;

  function monitorHtml(m) {
    if (!m) return '';
    var cells = '';
    ['rhythm', 'hr', 'bp', 'spo2', 'etco2'].forEach(function (k) {
      if (m[k] == null || m[k] === '') return;
      cells += '<div class="cast-cell cast-' + k + '"><dt>' + L[k] + '</dt><dd>' + h(m[k]) + '</dd></div>';
    });
    return cells ? '<dl class="cast-monitor" aria-label="' + h(L.monitor) + '">' + cells + '</dl>' : '';
  }
  function itemLabel(k) { return S[k].checklist || S[k].prompt || tpl(L.stage, { n: k + 1, m: S.length }); }
  function result() {
    var met = 0, crit = 0;
    S.forEach(function (s, k) {
      var p = picks[k];
      if (p === null) return;
      if (s.options[p].correct) met++;
      if (s.options[p].critical) crit++;
    });
    var pct = S.length ? met / S.length : 0;
    return { met: met, crit: crit, pct: pct, pass: crit === 0 && pct >= 0.8 };
  }

  function render() {
    var out = '';
    if (phase === 'brief') {
      if (data.setting) out += '<p class="cast-setting"><b>' + L.setting + ':</b> ' + h(data.setting) + '</p>';
      if (data.briefing) out += '<p class="cast-briefing"><b>' + L.briefing + ':</b> ' + h(data.briefing) + '</p>';
      out += '<div class="cast-actions"><button type="button" class="cast-primary" data-act="start" data-fk="go">' + L.start + '</button></div>';
    } else if (phase === 'stage') {
      var s = S[i], p = picks[i], done = p !== null;
      out += '<header class="cast-head"><span class="cast-stageno">' + tpl(L.stage, { n: i + 1, m: S.length }) + '</span>' +
        (s.time ? '<span class="cast-clock">' + h(s.time) + '</span>' : '') + '</header>';
      out += monitorHtml(s.monitor);
      out += '<p class="cast-situation">' + h(s.situation) + '</p>';
      if (s.prompt) out += '<p class="cast-prompt">' + h(s.prompt) + '</p>';
      out += '<ul class="cast-options">';
      s.options.forEach(function (o, k) {
        var cls = 'cast-opt';
        if (done && k === p) cls += o.correct ? ' is-right' : ' is-wrong';
        if (done && o.correct && !s.options[p].correct) cls += ' is-key';
        out += '<li><button type="button" class="' + cls + '" data-act="pick" data-k="' + k + '"' + (done ? ' disabled' : '') +
          ' aria-pressed="' + (done && k === p) + '"><span class="cast-letter">' + String.fromCharCode(65 + k) + '</span> ' + h(o.text) + '</button></li>';
      });
      out += '</ul>';
      if (done) {
        var po = s.options[p];
        out += '<div class="cast-feedback" role="status"><p class="cast-verdict ' + (po.correct ? 'is-right' : 'is-wrong') + '">' + (po.correct ? L.correct : L.wrong) +
          (po.critical ? ' · ' + L.critical : '') + '</p>' + (po.feedback ? '<p>' + h(po.feedback) + '</p>' : '');
        if (!po.correct) {
          s.options.forEach(function (o) {
            if (o.correct) out += '<p class="cast-keyline"><b>' + L.key + ':</b> ' + h(o.text) + (o.feedback ? ' — ' + h(o.feedback) : '') + '</p>';
          });
        }
        out += '</div><div class="cast-actions"><button type="button" class="cast-primary" data-act="next" data-fk="nx">' +
          (i === S.length - 1 ? L.finish : L.next) + '</button></div>';
      }
    } else {
      var r = result();
      out += '<div class="cast-end"><span class="cast-badge ' + (r.pass ? 'is-pass' : 'is-fail') + '">' + (r.pass ? L.pass : L.fail) + '</span>' +
        '<dl class="cast-stats"><div><dt>' + L.score + '</dt><dd>' + r.met + ' / ' + S.length + ' (' + Math.round(r.pct / 0.01) + '%)</dd></div>' +
        '<div><dt>' + L.crit + '</dt><dd>' + r.crit + '</dd></div></dl></div>';
      if (data.passRule) out += '<p class="cast-rule"><b>' + L.rule + ':</b> ' + h(data.passRule) + '</p>';
      out += '<table class="cast-table"><thead><tr><th>' + L.item + '</th><th>' + L.met + '</th></tr></thead><tbody>';
      S.forEach(function (s, k) {
        var p = picks[k], met = p !== null && s.options[p].correct, crit = p !== null && s.options[p].critical;
        out += '<tr><td>' + h(itemLabel(k)) + (crit ? ' <span class="cast-flag">' + L.critical + '</span>' : '') + '</td><td class="' + (met ? 'is-right' : 'is-wrong') + '">' +
          (met ? L.yes : L.no) + '</td></tr>';
      });
      out += '</tbody></table>';
      if (data.debrief) out += '<div class="cast-debrief"><h4>' + L.debrief + '</h4><p>' + h(data.debrief) + '</p></div>';
      out += '<div class="cast-actions"><button type="button" class="cast-secondary" data-act="retry" data-fk="rt">' + L.retry + '</button></div>';
    }
    root.innerHTML = out;
    if (focusKey) {
      var f = root.querySelector('[data-fk="' + focusKey + '"]');
      if (f) f.focus();
      focusKey = null;
    }
  }

  root.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var b = t.closest('button');
    if (!b || !root.contains(b)) return;
    var act = b.getAttribute('data-act');
    if (act === 'start') { phase = 'stage'; i = 0; render(); }
    else if (act === 'pick') { if (picks[i] === null) { picks[i] = +b.getAttribute('data-k'); focusKey = 'nx'; render(); } }
    else if (act === 'next') { if (i === S.length - 1) { phase = 'end'; focusKey = 'rt'; } else i++; render(); }
    else if (act === 'retry') { phase = 'brief'; i = 0; picks = S.map(function () { return null; }); focusKey = 'go'; render(); }
  });
  render();
})();
`;

/** castest — staged cardiac-arrest simulation scored on a checklist. */
export function renderCastest(spec: CastestWidget): string {
  const id = nextId('cast');
  const data = {
    lang: spec.lang ?? 'it',
    setting: spec.setting ?? '',
    briefing: spec.briefing ?? '',
    debrief: spec.debrief ?? '',
    passRule: spec.passRule ?? '',
    stages: spec.stages.map((s) => ({
      time: s.time ?? '',
      situation: s.situation,
      monitor: s.monitor ?? null,
      prompt: s.prompt ?? '',
      checklist: s.checklist ?? '',
      options: s.options.map((o) => ({
        text: o.text,
        correct: o.correct,
        critical: o.critical === true,
        feedback: o.feedback ?? '',
      })),
    })),
  };
  return [
    `<section class="chiron-widget cast-widget" data-widget="castest" data-widget-type="castest" lang="${spec.lang ?? 'it'}">`,
    spec.title ? `<h3 class="cast-title">${esc(spec.title)}</h3>` : '',
    `<div class="cast-root" id="${id}"></div>`,
    `<script type="application/json" id="${id}-data">${jsonForScript(data)}</script>`,
    `<script>${CAST_JS.replace(/__ROOT__/g, JSON.stringify(id))}</script>`,
    `</section>`,
  ].join('\n');
}
