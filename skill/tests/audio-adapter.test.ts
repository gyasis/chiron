/**
 * Tests for the G5 audio ingest adapter (ingest-adapters/audio.ts).
 * Stage 0 is deterministic (no network) — we assert the transcription handoff +
 * Brief shape, and the recordAudioResult fold-in. The actual whisper call is the
 * driver's job (prompts/00-ingest/audio.md).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ingestAudio, recordAudioResult } from '../ingest-adapters/audio.js';

function freshLessonDir(): string {
  return mkdtempSync(join(tmpdir(), 'chiron-audio-test-'));
}

test('local audio: copied into source/ and handoff names the whisper sidecar', async () => {
  const dir = freshLessonDir();
  const src = join(dir, 'lecture.mp3');
  writeFileSync(src, 'fake-mp3-bytes'); // content irrelevant for Stage 0

  const brief = await ingestAudio({
    sourcePath: src,
    lessonOutputDir: dir,
    mode: 'A',
    domain: 'medicine',
  });

  assert.equal(brief.sourceType, 'audio');
  assert.ok(brief.sourceCopiedTo && brief.sourceCopiedTo.startsWith('source/'));
  assert.ok(existsSync(join(dir, 'source', 'lecture.mp3')));
  assert.equal(brief.extractedText, '<PENDING-VISION-HANDOFF>');

  const sidecar = JSON.parse(
    readFileSync(join(dir, '.scratch', 'vision-handoffs.json'), 'utf8'),
  );
  assert.equal(sidecar.sourceType, 'audio');
  assert.equal(sidecar.handoffs.length, 1);
  const h = sidecar.handoffs[0];
  assert.equal(h.transcriber, 'atelier-whisper');
  assert.ok(h.source.endsWith('source/lecture.mp3'));
  assert.ok(h.endpoint.startsWith('http')); // default LAN endpoint or env override
  assert.ok(h.model.length > 0);            // 'large-v3' by default
});

test('heaviest model by default (large-v3), endpoint overridable via env', async () => {
  const dir = freshLessonDir();
  const src = join(dir, 'a.wav');
  writeFileSync(src, 'x');
  const brief = await ingestAudio({ sourcePath: src, lessonOutputDir: dir, mode: 'A', domain: 'code' });
  // default model is the heaviest unless CHIRON_WHISPER_MODEL overrides it
  const expected = process.env.CHIRON_WHISPER_MODEL ?? 'large-v3';
  assert.equal((brief.metadata as Record<string, unknown>).whisperModel, expected);
});

test('unsupported extension throws', async () => {
  const dir = freshLessonDir();
  const src = join(dir, 'notaudio.txt');
  writeFileSync(src, 'hi');
  await assert.rejects(
    ingestAudio({ sourcePath: src, lessonOutputDir: dir, mode: 'A', domain: 'code' }),
    /unsupported audio extension/,
  );
});

test('recordAudioResult clears the pending token and records language', async () => {
  const dir = freshLessonDir();
  mkdirSync(dir, { recursive: true });
  const briefPath = join(dir, 'brief.json');
  writeFileSync(briefPath, JSON.stringify({
    sourceType: 'audio',
    extractedText: '<PENDING-VISION-HANDOFF>',
    metadata: { whisperModel: 'large-v3' },
  }));

  recordAudioResult(briefPath, '  Buongiorno, oggi parliamo di...  ', 'it');

  const brief = JSON.parse(readFileSync(briefPath, 'utf8'));
  assert.equal(brief.extractedText, 'Buongiorno, oggi parliamo di...');
  assert.equal(brief.metadata.transcriptLanguage, 'it');
});
