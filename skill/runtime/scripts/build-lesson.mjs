#!/usr/bin/env node
// Per-lesson build: reads a lesson.json file, injects it as a global,
// runs `vite build` to produce the lesson runtime as a single HTML,
// then writes the output as <lesson-output-dir>/lesson.html.
//
// Usage:
//   node scripts/build-lesson.mjs <path-to-lesson.json> <output-dir>
//
// Example:
//   node scripts/build-lesson.mjs \
//     ../../lessons/klinefelter-syndrome-2026-05-03/lesson.json \
//     ../../lessons/klinefelter-syndrome-2026-05-03/

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNTIME_ROOT = resolve(__dirname, '..');

const [, , lessonJsonArg, outDirArg] = process.argv;
if (!lessonJsonArg || !outDirArg) {
  console.error('Usage: build-lesson.mjs <lesson.json> <output-dir>');
  process.exit(1);
}

const lessonJsonPath = resolve(process.cwd(), lessonJsonArg);
const outDir = resolve(process.cwd(), outDirArg);

if (!existsSync(lessonJsonPath)) {
  console.error(`lesson.json not found: ${lessonJsonPath}`);
  process.exit(1);
}

console.log(`▸ Building lesson from ${lessonJsonPath}`);
console.log(`▸ Output directory: ${outDir}`);

// Read the lesson and validate basic shape (full Zod validation TBD)
const lesson = JSON.parse(readFileSync(lessonJsonPath, 'utf8'));
if (!lesson.meta?.id || !Array.isArray(lesson.chapters)) {
  console.error('Invalid lesson.json — missing meta.id or chapters[]');
  process.exit(1);
}
console.log(`▸ Lesson: ${lesson.meta.title} (${lesson.chapters.length} chapters)`);

// Run Vite build for lesson entry only.
console.log('▸ Running vite build (lesson entry)...');
execSync('npm run build', {
  cwd: RUNTIME_ROOT,
  stdio: 'inherit',
  env: { ...process.env, VITE_ENTRY: 'lesson' },
});

const distLesson = resolve(RUNTIME_ROOT, 'dist/lesson.html');
if (!existsSync(distLesson)) {
  console.error(`vite build did not produce ${distLesson}`);
  process.exit(1);
}

// Inject the lesson as window.__CHIRON_LESSON__ at the head of <body>
const html = readFileSync(distLesson, 'utf8');
const inject = `<script>window.__CHIRON_LESSON__=${JSON.stringify(lesson)};</script>`;
const finalHtml = html.replace('<body>', `<body>${inject}`);

const outFile = resolve(outDir, 'lesson.html');
writeFileSync(outFile, finalHtml);
console.log(`▸ Wrote ${outFile} (${(finalHtml.length / 1024).toFixed(1)} KB)`);
console.log('✓ Lesson build complete');
