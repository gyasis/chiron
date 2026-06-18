import { z } from 'zod';

// SourceFileEntry — per-file provenance for multi-source ingest (FR-034)
export const SourceFileEntrySchema = z.object({
  path: z.string(),
  role: z.enum(['primary', 'supplement', 'figure', 'appendix', 'agent-report']),
  extractor: z.enum([
    'text-pdf',
    'vision-pdf',
    'vision-image',
    'vision-video', // G5 — video/YouTube via mcp__gemini-mcp__watch_video
    'whisper-audio', // G5 — audio via the Atelier whisper sidecar (mlx-whisper)
    'html',
    'transcript',
    'agent-report',
    'code',
  ]),
  tokenCount: z.number().int().nonnegative(),
  extractedAt: z.number().int().nonnegative(),
});

export type SourceFileEntry = z.infer<typeof SourceFileEntrySchema>;

// All 12 sourceType values from FR-032 (a-l)
export const SourceTypeSchema = z.enum([
  'code-repo',
  'pdf-text',
  'pdf-scanned',
  'image',
  'image-folder',
  'multi-pdf',
  'vocab-list',
  'transcript',
  'url',
  'html-file',
  'agent-report',
  'bundle',
  // 2026-05-23 — plain markdown/text brief, hand-written or extracted.
  // Common case when a brief is composed directly rather than ingested
  // from a PDF, repo, etc.
  'text',
  'markdown',
  // 2026-06-18 — G5 rich-media: a single video file OR a YouTube URL,
  // read by mcp__gemini-mcp__watch_video (transcript + visual analysis).
  'video',
  // 2026-06-18 — G5 rich-media: a single audio file, transcribed locally by
  // the Atelier whisper sidecar (mlx-whisper, large-v3) — no LLM/MCP.
  'audio',
]);

export type SourceType = z.infer<typeof SourceTypeSchema>;

export const DomainSchema = z.enum([
  'code',           // software — vibe-coder audience, code reading
  'medicine',       // clinical — USMLE/AMBOSS pedagogy
  'language-it',    // L2 Italian
  'research-paper', // paper-shaped academic content (IMRaD)
  // 2026-05-23 — 5th domain: rigorous-learner content that isn't code,
  // medicine, language, or paper-shaped. Math primers, formal logic,
  // signal processing, statistics, law, finance, music theory, quant
  // trading. Audience: rigorous learner who wants the derivation, the
  // model, the case-law, the proof — not a vibe-coder, not a clinician.
  // Inherits all universal widgets; leans heavily on mathjax +
  // reactive-math + step-cards + pattern-cards.
  'concepts',
]);
export type Domain = z.infer<typeof DomainSchema>;

export const ModeSchema = z.enum(['A', 'B']);
export type Mode = z.infer<typeof ModeSchema>;

// ── Medicine-specific domain enums (2026-05-23) ───────────────
// Specialty + level shape the AMBOSS-style chapter layout for medicine
// lessons. Specialty axis drives which clinical-atlas units are in scope;
// level axis drives which canonical sections get emphasised + which
// widget mix the chapter-write prompt prefers.
export const MedicalSpecialtySchema = z.enum([
  'internal-med', 'family-med', 'peds', 'ob-gyn', 'surgery', 'psych',
  'neurology', 'emergency-med', 'anesthesia', 'radiology', 'derm',
  'ophthalmology', 'ent', 'urology', 'orthopedics', 'pathology',
  'public-health',
]);
export type MedicalSpecialty = z.infer<typeof MedicalSpecialtySchema>;

export const MedicalLevelSchema = z.enum([
  'step-1', 'step-2-ck', 'step-2-cs', 'step-3',
  'shelf-medicine', 'shelf-peds', 'shelf-surgery', 'shelf-ob-gyn',
  'shelf-psych', 'shelf-family-med',
  'attending-ce',          // continuing education for practicing physicians
  'intern', 'resident', 'fellow',
]);
export type MedicalLevel = z.infer<typeof MedicalLevelSchema>;

// Brief — Stage 1 output, persisted as <lesson-output-dir>/brief.json
export const BriefSchema = z
  .object({
    domain: DomainSchema,
    mode: ModeSchema,
    sourceType: SourceTypeSchema,
    sourcePath: z.string().min(1),
    sourceCopiedTo: z.string().nullable(),
    extractedText: z.string(),
    sourceManifest: z.array(SourceFileEntrySchema).optional(),
    agentSourceProvenance: z.string().nullable().optional(),
    // ── 2026-05-23 universal: chapter-count override ───────────
    // Soft target: Stage 2 plans within ±1 of this (existing behavior).
    chapterCountTarget: z.number().int().min(1).max(50).optional(),
    // Hard lock: Stage 2 MUST plan exactly this many — no ±1 latitude.
    // Validator fails if syllabus.length !== chapterCountExact.
    // When BOTH are set, chapterCountExact wins.
    chapterCountExact: z.number().int().min(1).max(50).optional(),
    // ── 2026-05-23 medicine-specific layout fields ─────────────
    // When domain='medicine', these drive the canonical AMBOSS-style
    // chapter structure (specialty + level + atlas of disease entities).
    medicalSpecialty: MedicalSpecialtySchema.optional(),
    medicalLevel: MedicalLevelSchema.optional(),
    // List of disease-entity slugs this lesson covers. When set, lesson
    // chapter count is bound to clinicalAtlasUnits.length (one chapter
    // per entity). chapterCountTarget/Exact are ignored if this is set.
    clinicalAtlasUnits: z.array(z.string().min(1)).optional(),
    metadata: z.record(z.unknown()),
    briefSchemaVersion: z.string(),
  })
  .superRefine((b, ctx) => {
    // FR-034: sourceManifest required for multi-source types
    const multiSource: SourceType[] = ['multi-pdf', 'image-folder', 'bundle'];
    if (multiSource.includes(b.sourceType)) {
      if (!b.sourceManifest || b.sourceManifest.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sourceManifest'],
          message: `sourceManifest required for sourceType '${b.sourceType}' (FR-034)`,
        });
      }
    }
    // FR-035: agentSourceProvenance required for agent-report
    if (b.sourceType === 'agent-report' && !b.agentSourceProvenance) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['agentSourceProvenance'],
        message: 'agentSourceProvenance required for agent-report sources (FR-035)',
      });
    }
    // FR-035 / SC-016: medicine refuses agent-report-only sources
    if (b.domain === 'medicine' && b.sourceType === 'agent-report') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceType'],
        message: 'medicine domain forbids agent-report as sole source (SC-016)',
      });
    }
  });

export type Brief = z.infer<typeof BriefSchema>;
