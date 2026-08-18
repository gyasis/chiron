#!/usr/bin/env node
/*
 * Chiron Library VECTOR sidecar — the semantic half of hybrid retrieval.
 *
 * BM25 cannot match "shortness of breath" to "dispnea": they share no tokens.
 * That is synonymy, and only embeddings reach it. This writes dense vectors for
 * every passage so the Ask page can fuse semantic and lexical ranks (RRF).
 *
 * ADDITIVE BY DESIGN. library.corpus.json is never touched. The vectors ship
 * beside it, and the page falls back to BM25-only when they are absent — so a
 * missing/stale sidecar degrades quality, never availability.
 *
 *   build-library-vectors.mjs                  embed what changed, write sidecars
 *   build-library-vectors.mjs --limit 50       smoke-test the plumbing on 50
 *   build-library-vectors.mjs --domain medical-italian
 *   build-library-vectors.mjs --force          re-embed everything
 *   build-library-vectors.mjs --check          report coverage, embed nothing
 *
 *   CHIRON_EMBED_URL    ollama-compatible base (default http://127.0.0.1:11434)
 *   CHIRON_EMBED_MODEL  default bge-m3
 *
 * FORMAT: vectors are L2-normalised then int8-quantised (q = round(v*127)), so
 * cosine similarity is a plain dot product and the payload is 1 byte per
 * dimension — 21,312 x 1024 = 21.8 MB for the whole corpus, which a browser can
 * hold. Normalising first is what makes a single global scale safe; without it
 * each vector would need its own scale factor.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GEN = join(homedir(), 'Documents', 'generated');
const OUT = join(GEN, 'chiron-library');
const CORPUS = join(OUT, 'library.corpus.json');
const CACHE = join(OUT, '.vector-cache.json');

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? (argv[i + 1] ?? true) : d; };
const FORCE = argv.includes('--force');
const CHECK = argv.includes('--check');
const LIMIT = Number(flag('--limit', 0)) || 0;
const DOMAIN = flag('--domain', null);

const BASE = (process.env.CHIRON_EMBED_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const MODEL = process.env.CHIRON_EMBED_MODEL || 'bge-m3';
const BATCH = Number(process.env.CHIRON_EMBED_BATCH || 16);

const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 16);

/* ---------- embedding ---------- */

async function embed(texts) {
  const r = await fetch(`${BASE}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: texts }),
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${(await r.text()).slice(0, 160)}`);
  const d = await r.json();
  const out = d.embeddings || (d.embedding ? [d.embedding] : []);
  if (out.length !== texts.length) throw new Error(`asked for ${texts.length} vectors, got ${out.length}`);
  return out;
}

/** L2-normalise, then quantise to int8. Cosine on unit vectors is a dot product,
 *  so the client needs no norms and no per-vector scale. */
function quantise(vec) {
  let n = 0;
  for (const v of vec) n += v * v;
  n = Math.sqrt(n) || 1;
  const q = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    q[i] = Math.max(-127, Math.min(127, Math.round((vec[i] / n) * 127)));
  }
  return q;
}

/* ---------- main ---------- */

if (!existsSync(CORPUS)) {
  process.stderr.write('library.corpus.json missing — run build-library-corpus.mjs first\n');
  process.exit(1);
}
const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'));
let cache = {};
if (!FORCE && existsSync(CACHE)) {
  try { cache = JSON.parse(readFileSync(CACHE, 'utf8')); } catch { cache = {}; }
}
// A cache built with a DIFFERENT model is worthless and dangerous: mixing
// embedders puts vectors in incomparable spaces, so similarity becomes noise.
if (cache.model && cache.model !== MODEL) {
  process.stderr.write(`cache was built with ${cache.model}, now using ${MODEL} — discarding (embedder parity)\n`);
  cache = {};
}
const vecs = cache.vectors || {};

let work = corpus.filter(p => DOMAIN ? p.meta.domain === DOMAIN : true);
const todo = work.filter(p => !vecs[sha(p.text)]);

if (CHECK) {
  const have = work.length - todo.length;
  console.log(`model:    ${cache.model || '(none yet)'}   dim: ${cache.dim || '?'}`);
  console.log(`coverage: ${have.toLocaleString()} / ${work.length.toLocaleString()} passages embedded`
    + ` (${(100 * have / work.length).toFixed(1)}%)`);
  console.log(`missing:  ${todo.length.toLocaleString()}`);
  process.exit(todo.length ? 1 : 0);
}

const slice = LIMIT ? todo.slice(0, LIMIT) : todo;
console.log(`corpus ${corpus.length.toLocaleString()} · to embed ${slice.length.toLocaleString()}`
  + ` · model ${MODEL} · ${BASE}`);

if (slice.length) {
  // Fail fast and LOUD if the endpoint is not there: silently writing a partial
  // sidecar would leave the page semantically blind with no signal at all.
  try {
    const probe = await embed(['probe']);
    cache.dim = probe[0].length;
    console.log(`endpoint OK — ${MODEL} returns ${cache.dim} dims`);
  } catch (e) {
    process.stderr.write(`\nEMBEDDER UNREACHABLE at ${BASE} (${MODEL})\n  ${e.message}\n`
      + `  Nothing was written. The Ask page keeps working on BM25 alone.\n`
      + `  Start a local ollama, or set CHIRON_EMBED_URL to the Atelier governor.\n`);
    process.exit(2);
  }

  const t0 = Date.now();
  for (let i = 0; i < slice.length; i += BATCH) {
    const chunk = slice.slice(i, i + BATCH);
    let out;
    try {
      out = await embed(chunk.map(p => p.text.slice(0, 4000)));
    } catch (e) {
      process.stderr.write(`\nbatch at ${i} failed: ${e.message}\n`
        + `  Progress so far IS saved — re-run to resume.\n`);
      break;
    }
    chunk.forEach((p, j) => { vecs[sha(p.text)] = Array.from(quantise(out[j])); });

    const done = Math.min(i + BATCH, slice.length);
    const rate = done / ((Date.now() - t0) / 1000);
    const eta = (slice.length - done) / rate;
    process.stdout.write(`\r  ${done}/${slice.length}  ${rate.toFixed(1)}/s  eta ${(eta / 60).toFixed(0)}m   `);
    // Checkpoint often — an interrupted overnight run must not lose hours.
    if (done % (BATCH * 20) === 0) save();
  }
  process.stdout.write('\n');
}

function save() {
  writeFileSync(CACHE, JSON.stringify({ model: MODEL, dim: cache.dim, vectors: vecs }));
}
save();

/* ---------- emit the shards the browser loads ---------- */

const byDomain = {};
for (const p of corpus) (byDomain[p.meta.domain || 'other'] ||= []).push(p);

const manifest = { model: MODEL, dim: cache.dim, quantisation: 'int8-l2norm', domains: {} };
let wrote = 0;
for (const [dom, ps] of Object.entries(byDomain)) {
  const rows = ps.filter(p => vecs[sha(p.text)]);
  if (!rows.length) continue;
  const buf = Buffer.alloc(rows.length * cache.dim);
  rows.forEach((p, i) => Buffer.from(Int8Array.from(vecs[sha(p.text)]).buffer).copy(buf, i * cache.dim));
  writeFileSync(join(OUT, `library.corpus.vec.${dom}.bin`), buf);
  // ids, so the client can map row -> passage without re-deriving hashes
  writeFileSync(join(OUT, `library.corpus.vec.${dom}.ids.json`), JSON.stringify(rows.map(p => p.id)));
  manifest.domains[dom] = { rows: rows.length, of: ps.length, bytes: buf.length };
  wrote += rows.length;
}
writeFileSync(join(OUT, 'library.corpus.vec.manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`\nvectors → ${OUT}`);
console.log(`  model ${MODEL} · ${cache.dim} dims · int8 (l2-normalised)`);
for (const [d, m] of Object.entries(manifest.domains)) {
  console.log(`    ${d.padEnd(17)} ${String(m.rows).padStart(6)}/${String(m.of).padEnd(6)} ${(m.bytes / 1048576).toFixed(1)} MB`);
}
console.log(`  total ${wrote.toLocaleString()} / ${corpus.length.toLocaleString()} passages have vectors`);
if (wrote < corpus.length) console.log(`  (re-run to continue; coverage is partial and the page will use BM25 for the rest)`);
