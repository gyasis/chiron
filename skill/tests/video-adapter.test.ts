/**
 * Tests for the G5 video/YouTube ingest adapter (ingest-adapters/video.ts).
 * Stage 0 is deterministic (no MCP calls) — we assert the handoff sidecar +
 * Brief shape, and the recordVideoResult fold-in.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ingestVideo,
  recordVideoResult,
  isYouTubeUrl,
} from '../ingest-adapters/video.js';

function freshLessonDir(): string {
  return mkdtempSync(join(tmpdir(), 'chiron-video-test-'));
}

test('isYouTubeUrl detects watch + short URLs, rejects non-YT', () => {
  assert.ok(isYouTubeUrl('https://www.youtube.com/watch?v=abc'));
  assert.ok(isYouTubeUrl('https://youtu.be/abc'));
  assert.ok(!isYouTubeUrl('https://vimeo.com/123'));
  assert.ok(!isYouTubeUrl('/local/file.mp4'));
});

test('YouTube URL: Brief + handoff name watch_video, nothing copied', async () => {
  const dir = freshLessonDir();
  const brief = await ingestVideo({
    sourcePath: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    lessonOutputDir: dir,
    mode: 'A',
    domain: 'medicine',
  });

  assert.equal(brief.sourceType, 'video');
  assert.equal(brief.sourceCopiedTo, null); // YT not downloaded
  assert.equal(brief.extractedText, '<PENDING-VISION-HANDOFF>');

  const sidecar = JSON.parse(
    readFileSync(join(dir, '.scratch', 'vision-handoffs.json'), 'utf8'),
  );
  assert.equal(sidecar.sourceType, 'video');
  assert.equal(sidecar.handoffs.length, 1);
  assert.equal(sidecar.handoffs[0].mcpTool, 'mcp__gemini-mcp__watch_video');
  assert.equal(sidecar.handoffs[0].isYouTube, true);
  assert.equal(sidecar.handoffs[0].source, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('local file: copied into source/ and handoff points at the copy', async () => {
  const dir = freshLessonDir();
  const src = join(dir, 'lecture.mp4');
  writeFileSync(src, 'fake-mp4-bytes'); // content irrelevant for Stage 0

  const brief = await ingestVideo({
    sourcePath: src,
    lessonOutputDir: dir,
    mode: 'A',
    domain: 'code',
  });

  assert.equal(brief.sourceType, 'video');
  assert.ok(brief.sourceCopiedTo && brief.sourceCopiedTo.startsWith('source/'));
  assert.ok(existsSync(join(dir, 'source', 'lecture.mp4')));

  const sidecar = JSON.parse(
    readFileSync(join(dir, '.scratch', 'vision-handoffs.json'), 'utf8'),
  );
  assert.equal(sidecar.handoffs[0].isYouTube, false);
  assert.ok(sidecar.handoffs[0].source.endsWith('source/lecture.mp4'));
});

test('unsupported extension throws', async () => {
  const dir = freshLessonDir();
  const src = join(dir, 'notavideo.txt');
  writeFileSync(src, 'hi');
  await assert.rejects(
    ingestVideo({ sourcePath: src, lessonOutputDir: dir, mode: 'A', domain: 'code' }),
    /unsupported video extension/,
  );
});

test('recordVideoResult clears the pending token and stores raw result', async () => {
  const dir = freshLessonDir();
  mkdirSync(dir, { recursive: true });
  const briefPath = join(dir, 'brief.json');
  writeFileSync(briefPath, JSON.stringify({
    sourceType: 'video',
    extractedText: '<PENDING-VISION-HANDOFF>',
    metadata: {},
  }));

  recordVideoResult(briefPath, '  Transcript: hello world\nSUBJECT: greetings  ');

  const brief = JSON.parse(readFileSync(briefPath, 'utf8'));
  assert.equal(brief.extractedText, 'Transcript: hello world\nSUBJECT: greetings');
  assert.ok(brief.metadata.videoResult.includes('hello world'));
});
