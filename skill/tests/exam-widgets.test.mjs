// Render tests for the exam-mtf and castest widgets.
// Run: node --test tests/exam-widgets.test.mjs   (needs `npm run build`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderWidget } from '../dist/lib/widget-renderer.js';
import { WidgetSchema } from '../dist/lib/schemas/widget-spec.js';
import { normaliseWidget } from '../scripts/widget-normalize.mjs';

const exam = {
  type: 'exam-mtf', id: 'ex-1', title: 'Esame </script><b>x', lang: 'it', timeLimitMin: 60, passPct: 75,
  questions: [{ id: 'q1', topic: 'ALS', stem: 'Stem?', statements: [
    { text: 'A', correct: true, explanation: 'e', explanationEn: 'en' },
    { text: 'B', correct: false },
  ] }],
};
const cast = {
  type: 'castest', id: 'c-1', title: 'CAST', lang: 'en', setting: 's', briefing: 'b', passRule: 'rule',
  stages: [{ id: 's1', time: '00:00', situation: 'sit', monitor: { rhythm: 'FV' }, prompt: 'p', checklist: 'c',
    options: [{ text: 'o1', correct: true, feedback: 'f' }, { text: 'o2', correct: false, critical: true }] }],
  debrief: 'd',
};

test('exam-mtf validates, survives normalisation and renders', () => {
  assert.ok(WidgetSchema.safeParse(exam).success);
  const html = renderWidget(normaliseWidget(exam));
  assert.match(html, /data-widget="exam-mtf"/);
  assert.match(html, /class="emtf-root"/);
  assert.match(html, /type="application\/json"/);
  assert.match(html, /Inizia l'esame/);
  assert.doesNotMatch(html, /<\/script><b>/, 'title/data must not break out of the script element');
});

test('castest validates, survives normalisation and renders', () => {
  assert.ok(WidgetSchema.safeParse(cast).success);
  const html = renderWidget(normaliseWidget(cast));
  assert.match(html, /data-widget="castest"/);
  assert.match(html, /class="cast-root"/);
  assert.match(html, /Next stage/);
  assert.match(html, /"critical":true/);
});

test('exam-mtf rejects an empty question list', () => {
  assert.equal(WidgetSchema.safeParse({ ...exam, questions: [] }).success, false);
});
