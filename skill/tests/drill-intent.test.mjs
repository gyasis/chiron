// The Pimsleur drill intent: the three outcomes, voice-dictation misspellings, and the drill source order.
// Run: node --test skill/tests/drill-intent.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDrillIntent as c, splitSpeak, composerLines, pickSource } from '../ask/drill-intent.js';

test('drill: play / practise / drill / convert / do it as Pimsleur', () => {
  for (const t of [
    'play these as pimsleur live', 'Pimsleur live', 'drill me', 'drill these', 'drill these phrases please',
    'practise these', 'practice them aloud', 'do it as pimsleur', 'convert these to pimsleur', 'play these',
    'can you drill these for me?', "let's do pimsleur with these", 'switch to pimsleur live', 'pimsleur', 'drill',
    'run through these', 'quiz me on these', 'play them back',
  ]) assert.equal(c(t), 'drill', t);
});

test('drill: dictation misspellings of the name', () => {
  for (const t of ['do these as pimsler live', 'play these in pimsleer style', 'pims layer live', 'drill with pimslur',
    'start pimsler', 'Pimsleur-live', 'play it as Pimsleur Live']) assert.equal(c(t), 'drill', t);
});

test('lesson: a full saved lesson or season', () => {
  for (const t of ['make a pimsleur lesson from these', 'make a pimsler lesson', 'create a pimsleur season from my basket',
    'add these to my library', 'save these as a lesson', 'generate a pimsleur lesson', 'turn these into a pimsleur course',
    'put them in my library', 'convert these into a pimsleur lesson']) assert.equal(c(t), 'lesson', t);
});

test('none: ordinary messages, including questions that mention Pimsleur', () => {
  for (const t of ['how does pimsleur work?', 'What is the pimsleur method', 'how do I say I am late', 'dove si trova la stazione?',
    'why do you use graduated intervals', 'tell me about pimsleur', 'Is pimsleur live free?', 'explain the drill', '',
    'hello', 'what does play mean in Italian']) assert.equal(c(t), 'none', t);
});

test('a live request wins over a lesson noun; an explanation question never matches', () => {
  assert.equal(c('play this pimsleur live lesson'), 'drill');
  assert.equal(c('how do I make a pimsleur lesson?'), 'none');
});

test('splitSpeak: lines, else sentences; list markers dropped', () => {
  assert.deepEqual(splitSpeak('Dove è la stazione?\nSono qui per lavoro.'), ['Dove è la stazione?', 'Sono qui per lavoro.']);
  assert.deepEqual(splitSpeak('Buongiorno. Come sta?'), ['Buongiorno.', 'Come sta?']);
  assert.deepEqual(splitSpeak('1. Ciao\n2) Grazie'), ['Ciao', 'Grazie']);
  assert.deepEqual(splitSpeak(''), []);
});

test('composerLines: one sentence per line', () => {
  assert.deepEqual(composerLines('Ciao\n\n  Grazie mille \n'), [{ it: 'Ciao', en: '' }, { it: 'Grazie mille', en: '' }]);
});

test('pickSource: composer, then newest reply with phrases, then the basket', () => {
  const replies = [{ speak: '' , phrases: [] }, { phrases: [{ it: 'Buongiorno', en: 'Good morning' }, { it: 'buongiorno', en: '' }] }, { speak: 'Altro.' }];
  const basket = [{ it: 'Dov\'è?', en: 'Where is it?' }];
  assert.deepEqual(pickSource({ composer: 'Ciao\nGrazie', replies, basket }), [{ it: 'Ciao', en: '' }, { it: 'Grazie', en: '' }]);
  assert.deepEqual(pickSource({ replies, basket }), [{ it: 'Buongiorno', en: 'Good morning' }]);
  assert.deepEqual(pickSource({ replies: [{ speak: 'Ciao. Grazie.' }], basket }), [{ it: 'Ciao.', en: '' }, { it: 'Grazie.', en: '' }]);
  assert.deepEqual(pickSource({ replies: [], basket }), basket);
  assert.deepEqual(pickSource({}), []);
});
