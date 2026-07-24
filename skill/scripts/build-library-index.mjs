#!/usr/bin/env node
/*
 * Chiron Library index builder.
 *  1. parse skill/library/library.yaml  → <out>/library.config.json   (the menu)
 *  2. scan ~/Documents/generated for real lessons → tag each per library.yaml's domain facets
 *  3. merge the SSM taxonomy.json disease-classes as QUEUED lessons (the generation pipeline at scale)
 *  4. write <out>/library.index.json + copy the app (index.html, library.js)
 * Tags prefer chiron.json.tags if present (forward path: the generator stamps them);
 * otherwise inferred here from path/title (seed for the already-generated lessons).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const yaml = createRequire(import.meta.url)('js-yaml');

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL = resolve(__dirname, '..');
const LIB_DIR = join(SKILL, 'library');
const GEN = join(homedir(), 'Documents', 'generated');
const OUT = join(GEN, 'chiron-library');
const TAX = join(homedir(), 'Documents', 'code', 'ssm_essame', 'specializzando', 'ner-lab', 'taxonomy.json');

mkdirSync(OUT, { recursive: true });

// ---------- 1. config from yaml ----------
const config = yaml.load(readFileSync(join(LIB_DIR, 'library.yaml'), 'utf8'));
// runtime source-map (the "back to source" link targets) — lives OUTSIDE the repo so no external
// app name / LAN URL is ever committed to chiron. ~/.chiron/library.sources.json wins, else env.
try {
  const srcFile = join(homedir(), '.chiron', 'library.sources.json');
  if (existsSync(srcFile)) config.sources = JSON.parse(readFileSync(srcFile, 'utf8'));
  else if (process.env.CHIRON_LIBRARY_SOURCES) config.sources = JSON.parse(process.env.CHIRON_LIBRARY_SOURCES);
} catch (e) { process.stderr.write('sources map skipped: ' + e.message + '\n'); }
writeFileSync(join(OUT, 'library.config.json'), JSON.stringify(config, null, 2));

// ---------- helpers: tag inference ----------
const SUBJ = config.facets.subject.valuesBySystem;
function subjFor(text, sys) {
  const m = text.toLowerCase();
  if (/pericard|tamponade/.test(m)) return 'Pericardial Disease';
  if (/fibrillation|arrhythm|tachycard|\bblock\b|brugada|bradycard/.test(m)) return 'Cardiac Arrhythmias';
  if (/aort|embolism|dissection|aneurysm|thrombo|peripheral arter|fattore v|factor v/.test(m)) return 'Vascular & Aortic Disease';
  if (/heart failure|cardiomyopath|myocarditis/.test(m)) return 'Heart Failure & Cardiomyopathy';
  if (/stenosis|regurgitation|valv/.test(m)) return 'Valvular Disease';
  if (/coronary|infarction|\bstemi\b|\bnstemi\b/.test(m)) return 'Coronary Artery Disease';
  if (/bleed/.test(m)) return 'GI Bleeding';
  if (/pancreatitis|cirrhosis|hepato|wilson|biliary/.test(m)) return 'Hepatobiliary & Pancreatic';
  if (/bowel|colitis|crohn/.test(m)) return 'Inflammatory Bowel Disease';
  if (/(cancer|carcinoma|adenocarcinoma).*(gastr|colo|pancrea|hepat|esoph)|gastric|colorectal/.test(m)) return 'GI Oncology';
  if (/copd|asthma/.test(m)) return 'Obstructive Lung Disease';
  if (/pneumothorax|pleural/.test(m)) return 'Pleural Disease';
  if (/interstitial/.test(m)) return 'Interstitial Lung Disease';
  if (/pneumonia|tuberc/.test(m) && sys === 'Respiratory') return 'Respiratory Infection';
  if (/hyperkalemia|hyponatremia|siadh|electrolyte|blood chemistry|chemistry/.test(m)) return 'Electrolyte Disorders';
  if (/kidney injury|\baki\b/.test(m)) return 'Acute Kidney Injury';
  if (/glomerulo|nephrotic|nephritic/.test(m)) return 'Glomerular Disease';
  if (/diabet|ketoacidosis/.test(m)) return 'Diabetes';
  if (/thyroid/.test(m)) return 'Thyroid Disease';
  if (/adrenal|cushing|pheochromo/.test(m)) return 'Adrenal Disease';
  if (/klinefelter|sex chromosome|pituitary|turner/.test(m)) return 'Pituitary & Sex Chromosome';
  if (/stroke|subarachnoid|cerebrovasc/.test(m)) return 'Cerebrovascular';
  if (/epilep|seizure/.test(m)) return 'Seizure Disorders';
  if (/guillain|neuromusc/.test(m)) return 'Neuromuscular';
  if (/meningitis|encephalitis/.test(m)) return 'CNS Infection';
  if (/leukemia|lymphoma/.test(m)) return 'Leukemia & Lymphoma';
  if (/sarcoma/.test(m)) return 'Soft-tissue Sarcoma';
  if (/myeloma/.test(m)) return 'Plasma Cell Disorders';
  if (/anemia|anaemia/.test(m)) return 'Anemias';
  if (/sepsis|endocarditis/.test(m)) return 'Sepsis';
  if (/\bhiv\b/.test(m)) return 'HIV';
  if (/malaria|covid|tropical/.test(m)) return 'Tropical Disease';
  if (/lupus|connective/.test(m)) return 'Connective Tissue Disease';
  if (/vasculitis|arteritis/.test(m)) return 'Vasculitis';
  if (/rheumatoid|arthritis/.test(m)) return 'Inflammatory Arthritis';
  if (/psoriasis|dermatitis|eczema/.test(m)) return 'Inflammatory Dermatoses';
  if (/melanoma/.test(m)) return 'Skin Oncology';
  return (SUBJ[sys] || ['General'])[0];
}
function sysFor(subject) {
  for (const [s, arr] of Object.entries(SUBJ)) if (arr.includes(subject)) return s;
  return 'Emergency';
}
function topicFor(text) {
  const m = text.toLowerCase();
  if (/grammar|tense|azione|subjunctive|verb|past|future/.test(m)) return 'Grammar';
  if (/bar|caf|restaurant|conto|ordering|food|conto/.test(m)) return 'Everyday';
  if (/conversation|small talk|phone/.test(m)) return 'Conversation';
  if (/travel|directions/.test(m)) return 'Travel';
  return 'Everyday';
}
// explicit overrides for the known generated lessons (slug fragment → tags)
const OVERRIDE = {
  'chiron-acute-pericarditis-amboss': { dom: 'medicine', sys: 'Cardiovascular', subj: 'Pericardial Disease', scope: 'disease' },
  'chiron-pericardial-diseases-amboss': { dom: 'medicine', sys: 'Cardiovascular', subj: 'Pericardial Disease', scope: 'subject' },
  'chiron-blood-chemistry-amboss': { dom: 'medicine', sys: 'Renal', subj: 'Electrolyte Disorders', scope: 'subject' },
  'chiron-klinefelter-amboss': { dom: 'medicine', sys: 'Endocrine', subj: 'Pituitary & Sex Chromosome', scope: 'disease' },
  'chiron-sarcoma-of-the-chest-amboss': { dom: 'medicine', sys: 'Hematology/Oncology', subj: 'Soft-tissue Sarcoma', scope: 'disease' },
  'chiron-sarcoma-of-the-chest': { dom: 'medicine', sys: 'Hematology/Oncology', subj: 'Soft-tissue Sarcoma', scope: 'disease' },
  'chiron-passage-aneurisma': { dom: 'medical-italian', sys: 'Cardiovascular', subj: 'Vascular & Aortic Disease', level: 'B1' },
  'chiron-ssm-fattore-v': { dom: 'medical-italian', sys: 'Cardiovascular', subj: 'Vascular & Aortic Disease', level: 'B1' },
  'chiron-italian-cafe': { dom: 'language-it', topic: 'Everyday', level: 'A2' },
  'chiron-italian-lesson': { dom: 'language-it', topic: 'Everyday', level: 'A2' },
  'chiron-italian-past-future': { dom: 'language-it', topic: 'Grammar', level: 'B1' },
  'patologie/pericardite-acuta': { dom: 'medical-italian', sys: 'Cardiovascular', subj: 'Pericardial Disease', level: 'B1' },
  'patologie/diabete-tipo-2': { dom: 'medical-italian', sys: 'Endocrine', subj: 'Diabetes', level: 'B1' },
  'grammatica/fasi-azione': { dom: 'language-it', topic: 'Grammar', level: 'B1' },
};
const WARD_SYS = { cardiologia: 'Cardiovascular', 'pronto-soccorso': 'Emergency', 'medicina-interna': 'Emergency', chirurgia: 'Emergency', pediatria: 'Emergency', radiologia: 'Emergency', 'terapia-intensiva': 'Emergency', ambulatorio: 'Emergency' };

// ---------- 2. scan generated lessons ----------
function walk(dir, depth = 0, acc = []) {
  if (depth > 4) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = join(dir, e.name);
    if (p === OUT) continue;
    if (existsSync(join(p, 'lesson.html'))) acc.push(p);
    else walk(p, depth + 1, acc);
  }
  return acc;
}
const dirs = walk(GEN);
const lessons = [];
for (const d of dirs) {
  const rel = relative(GEN, d);                       // e.g. chiron-acute-pericarditis-amboss
  let cj = {}; try { cj = JSON.parse(readFileSync(join(d, 'chiron.json'), 'utf8')); } catch {}
  const title = (cj.title || rel).replace(/^Chiron\s*·\s*/, '');
  const clips = cj.audioClips ?? 0;
  // tags: prefer chiron.json.tags (future), else override map, else infer
  let tags = cj.tags || OVERRIDE[rel] || OVERRIDE[rel.replace(/^chiron-medicina-italiana\//, '')] || null;
  if (!tags) {
    const rawDom = cj.domain || (/medicina-italiana/.test(rel) ? 'language-it' : 'medicine');
    if (rawDom === 'medicine') {
      const subj = subjFor(title, ''); tags = { dom: 'medicine', sys: sysFor(subj), subj };
    } else { // language-it → medical-italian (wards/patologie) vs italian (general)
      const ward = (rel.match(/wards\/([a-z-]+)/) || [])[1];
      if (ward) tags = { dom: 'medical-italian', sys: WARD_SYS[ward] || 'Emergency', subj: 'Ward Italian', level: 'B1' };
      else if (/patologie/.test(rel)) { const subj = subjFor(title, ''); tags = { dom: 'medical-italian', sys: sysFor(subj), subj, level: 'B1' }; }
      else tags = { dom: 'language-it', topic: topicFor(title), level: 'A2' };
    }
  }
  const mtime = statSync(join(d, 'lesson.html')).mtimeMs;
  // download-availability = disk truth: is there a packaged .chiron for this lesson?
  const slug = rel.replace(/[\/]/g, '-');
  const chironPath = join(OUT, 'lessons', slug + '.chiron');
  const hasBundle = existsSync(chironPath);
  // provenance: prefer chiron.json (forward path — server stamps it). Else backfill GENERICALLY from the
  // runtime source-map keys: a slug `chiron-<key>-<rest>` belongs to source <key>; ref = <rest> (trailing
  // numeric group restored to '_' since the slugifier turned it to '-'). No source name is hard-coded here.
  let source = cj.source || null, sourceRef = cj.source_ref || null;
  if (!source) {
    for (const key of Object.keys(config.sources || {})) {
      const pfx = `chiron-${key}-`;
      if (slug.startsWith(pfx)) { source = key; sourceRef = slug.slice(pfx.length).replace(/-(\d+)$/, '_$1'); break; }
    }
  }
  lessons.push({
    id: rel, title, path: join(rel, cj.entry || 'lesson.html'), domain: tags.dom,
    system: tags.sys || null, subject: tags.subj || null, topic: tags.topic || null,
    level: tags.level || null, scope: tags.scope || (tags.subj && /diseases|disorders/i.test(title) ? 'subject' : 'disease'),
    trend: tags.trend || null, status: cj.status || 'published', clips, ready: true, mtime,
    bundle: hasBundle, sizeMB: hasBundle ? +(statSync(chironPath).size / 1048576).toFixed(1) : null,
    source, source_ref: sourceRef,
  });
}

// ---------- 3. merge SSM taxonomy classes as QUEUED lessons ----------
// AMBOSS-style display labels for the generalized year-2 organ systems (taxonomy system → label).
const SYS_LABEL = {
  'Cardiovascular': 'Cardiovascular', 'Respiratory': 'Respiratory', 'Gastrointestinal': 'Gastrointestinal',
  'Renal/Urinary': 'Renal & Urinary', 'Endocrine/Metabolic': 'Endocrine & Metabolic', 'Reproductive': 'Reproductive',
  'Musculoskeletal': 'Musculoskeletal', 'Nervous/CNS': 'Nervous System & Special Senses',
  'Psychiatric/Behavioral': 'Behavioral Health & Psychiatry', 'Skin/Integumentary': 'Skin & Subcutaneous',
  'Hematologic/Lymphatic': 'Blood & Lymphoreticular', 'Immune/Rheumatologic': 'Immune',
  'Infectious Disease': 'Infectious Disease', 'Multisystem/General': 'Multisystem & General Principles',
};
let queued = [], systemLessons = [];
try {
  const tax = JSON.parse(readFileSync(TAX, 'utf8'));
  // A generated subject-lesson has subject="General" but its TITLE (and slug) carries the real subject
  // (e.g. title "Biostatistics & Clinical Research", id "chiron-biostatistics-clinical-research-systematic").
  // Match on a normalized key across subject + title + depth-stripped id, or we emit a phantom
  // "to-generate" twin for every already-generated subject (the "says not generated" bug).
  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const stripDepth = k => k.replace(/^chiron-/, '').replace(/-(systematic|atlas|primer|amboss|deep-dive|clinical)$/, '');
  const haveKeys = new Set();
  for (const l of lessons) {
    if (l.subject) haveKeys.add(norm(l.subject));
    if (l.title)   haveKeys.add(norm(l.title));
    if (l.id)      haveKeys.add(stripDepth(norm(l.id)));
  }
  const corpusTotal = tax.reduce((s, c) => s + (c.total_q || 0), 0) || 1;
  for (const c of tax) {
    const subject = (c.disease_class || '').replace(/ and /g, ' & ');
    const system = c.system || 'Emergency';
    if (!subject) continue;
    if (haveKeys.has(norm(subject))) continue;  // already a generated lesson (matched by title/slug, not the mis-tagged subject field)
    queued.push({
      id: 'queued:' + subject, title: subject, path: null, domain: 'medicine',
      system, subject, topic: null, level: null, scope: 'subject',
      trend: c.trend || 'PERENNIAL', difficulty: c.avg_difficulty ?? null, priority: c.priority ?? 0,
      bankable: c.bankable ?? 0,  // # recurring "gimme" repeats — the do-first signal
      per_year: c.per_year || null, clips: 0, ready: false, mtime: 0,
    });
  }

  // 3b. generalized ORGAN-SYSTEM overview lessons (AMBOSS year-2 scaffold) — one per system,
  // aggregated from its disease-classes: exam weight + common disease-classes + top diseases.
  const bySys = {};
  for (const c of tax) {
    const g = (bySys[c.system] ??= { total_q: 0, priority: 0, bankable: 0, classes: [], members: [] });
    g.total_q += c.total_q || 0; g.priority += c.priority || 0; g.bankable += c.bankable || 0;
    g.classes.push({ name: c.disease_class, q: c.total_q || 0 });
    for (const m of (c.members || [])) g.members.push({ concept: m.concept, count: m.count || 0 });
  }
  // same normalization for organ-system overviews: a generated "<System> — Atlas" (id
  // chiron-<system>-atlas) fills the system slot, but its `system`/`scope` may not match — so also
  // key on the depth-stripped slug (chiron-gastrointestinal-atlas → gastrointestinal).
  const haveSys = new Set();
  for (const l of lessons) {
    if (l.system) haveSys.add(norm(l.system));
    if (l.id)     haveSys.add(stripDepth(norm(l.id)));
  }
  for (const [sys, g] of Object.entries(bySys)) {
    if (haveSys.has(norm(sys))) continue;
    const label = SYS_LABEL[sys] || sys;
    systemLessons.push({
      id: 'system:' + sys, title: label, path: null, domain: 'medicine',
      system: sys, subject: null, topic: null, level: null, scope: 'system',
      trend: null, difficulty: null, priority: g.priority, bankable: 0,
      exam_pct: Math.round(1000 * g.total_q / corpusTotal) / 10, total_q: g.total_q,
      n_classes: g.classes.length, system_bankable: g.bankable,
      classes: g.classes.sort((a, b) => b.q - a.q).map(x => x.name),
      diseases: g.members.sort((a, b) => b.count - a.count).slice(0, 12).map(x => x.concept),
      per_year: null, clips: 0, ready: false, mtime: 0,
    });
  }
} catch (e) { process.stderr.write('taxonomy merge skipped: ' + e.message + '\n'); }

const index = { generatedAt: new Date().toISOString(), counts: { ready: lessons.length, systems: systemLessons.length, queued: queued.length }, lessons: [...lessons, ...systemLessons, ...queued] };
writeFileSync(join(OUT, 'library.index.json'), JSON.stringify(index, null, 2));

// ---------- 4. copy app ----------
for (const f of ['index.html', 'library.js', 'manifest.webmanifest', 'sw.js', 'library.yaml']) {
  const src = join(LIB_DIR, f);
  if (existsSync(src)) copyFileSync(src, join(OUT, f));
}
for (const dir of ['icons', 'vendor']) {
  const s = join(LIB_DIR, dir), o = join(OUT, dir);
  if (existsSync(s)) { mkdirSync(o, { recursive: true }); for (const fn of readdirSync(s)) { try { copyFileSync(join(s, fn), join(o, fn)); } catch {} } }
}

console.log(`Library built → ${OUT}`);
console.log(`  ready lessons: ${lessons.length}   organ-system overviews: ${systemLessons.length}   queued classes: ${queued.length}`);
console.log(`  config: library.config.json   index: library.index.json`);
