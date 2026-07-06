/**
 * Widget RENDER-CHECK gate (Pharos lint_runtime rung, adapted to widgets).
 * Given a chapter JSON, tries to render EVERY widget through the real renderer (after
 * deterministic normalization) and reports which render vs fail + the error. The chain's
 * repair loop calls this to prove "valid JSON → actually renders", and to re-prompt only
 * for widgets that fail for a REAL reason (missing data), not a fixable field-alias.
 *
 * Usage:  node render-check.mjs <chapterN.json>
 * Output (stdout, JSON): { total, ok, failed, failures:[{index,type,id,error}] }
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderWidget } from '../dist/lib/widget-renderer.js';
import { normaliseWidget } from './widget-normalize.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2];
if (!file) { console.error('usage: node render-check.mjs <chapter.json>'); process.exit(2); }

const ch = JSON.parse(readFileSync(resolve(file), 'utf8'));
const widgets = Array.isArray(ch.widgets) ? ch.widgets : [];
const failures = [];
let ok = 0;
widgets.forEach((w, i) => {
  try {
    const html = renderWidget(normaliseWidget(w));
    if (typeof html !== 'string' || html.length === 0) throw new Error('empty render');
    ok++;
  } catch (err) {
    failures.push({ index: i, type: w?.type ?? 'unknown', id: w?.id ?? null,
                    error: err instanceof Error ? err.message : String(err) });
  }
});
console.log(JSON.stringify({ total: widgets.length, ok, failed: failures.length, failures }, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
