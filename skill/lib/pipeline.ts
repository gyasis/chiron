// Pipeline orchestrator — 5 stages per contracts/pipeline-stages.md.
// Per Q8: text-LLM stages (1-4) hand control to the parent Claude Code agent
// by loading a prompt template and emitting it. No SDK call is made here.
//
// FR-006 retry: Stage 3 may re-invoke Stages 1/2 with structured issue feedback
// up to 3 attempts before aborting.
// FR-029: deep-research is opt-in only, ≤1 invocation per lesson.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as progress from './progress.js';
import { validateBrief, validateSyllabus, type ConceptDag } from './validator.js';
import { assembleLesson } from './assemble.js';
import { bakeAudio, type AudioClipResult, type LectureArtifact, type VoiceRef } from './audio-bake.js';
import type { Brief } from './schemas/brief.js';
import type { ChapterSyllabus } from './schemas/chapter-syllabus.js';
import type { TriggerContext } from './trigger-context.js';
import { detectMode } from './mode-heuristic.js';

// Mode B (case-study) delegation per FR-003 / contracts/skill-triggers.md.
// Chiron does NOT run its own pipeline for Mode B; the case-study sibling skill
// (~/.claude/skills/case-study.md) owns the entire output.

export interface PipelineContext {
  lessonOutputDir: string;
  promptsDir: string; // <skill>/prompts/
  domain: 'code' | 'medicine' | 'language-it' | 'research-paper' | 'concepts';
  conceptDag: ConceptDag;
}

export interface PipelinePromptHandoff {
  stage: 0 | 1 | 2 | 3 | 4 | 5;
  templatePath: string;
  templateText: string;
  slots: Record<string, unknown>;
  // Slot the parent agent's reply into this filename to resume.
  expectedResponsePath: string;
}

const MAX_VALIDATOR_RETRIES = 3; // FR-006

function loadTemplate(promptsDir: string, name: string): { p: string; t: string } {
  const p = path.join(promptsDir, name);
  return { p, t: fs.readFileSync(p, 'utf8') };
}

// FR-016 / FR-035 / SC-016 — Stage 0 refusal checkpoint. Runs BEFORE the LLM hand-off so we
// never burn a Claude call on a brief that lacks source-grounding or (in medicine) is grounded
// only on agent-generated reports. Caller must check the return-type discriminator.

export interface Stage0RefusalReport {
  reason: 'no-source-grounding' | 'medicine-agent-report-sole-source';
  details: string;
  remediation: string;
}

export function stage0Preflight(
  ctx: PipelineContext,
  brief: Brief,
): Stage0RefusalReport | null {
  const manifest = (brief as unknown as { sourceManifest?: Array<{ role?: string; extractor?: string }> })
    .sourceManifest;
  const hasManifestEntry =
    Array.isArray(manifest) &&
    manifest.some((m) => typeof m?.extractor === 'string' && m.extractor.trim().length > 0);
  const extractedText = typeof brief.extractedText === 'string' ? brief.extractedText : '';

  if (extractedText.trim().length === 0 && !hasManifestEntry) {
    return {
      reason: 'no-source-grounding',
      details:
        'Brief has no extracted text and no manifest entries; cannot ground a lesson without source material.',
      remediation: 'Provide a source file (PDF, code repo, vocab CSV, etc.) before invoking Chiron.',
    };
  }

  if (ctx.domain === 'medicine') {
    const sourceTypeIsAgentReport = brief.sourceType === 'agent-report';
    const allManifestAgentReport =
      Array.isArray(manifest) && manifest.length > 0 && manifest.every((m) => m?.role === 'agent-report');
    if (sourceTypeIsAgentReport || allManifestAgentReport) {
      return {
        reason: 'medicine-agent-report-sole-source',
        details:
          'Medicine domain requires a primary source (textbook PDF, clinical guideline, journal article); agent-generated reports cannot be the sole grounding for medical content.',
        remediation: 'Add a primary medical source to the bundle, or use a non-medicine domain.',
      };
    }
  }

  return null;
}

export interface CaseStudyHandoff {
  kind: 'case-study-delegation';
  siblingSkillPath: string;
  sourcePath: string;
  sourceExcerpt: string;
  modeReason: string;
  metadata: Record<string, unknown>;
}

export interface ModeDecision {
  mode: 'A' | 'B';
  reason: string;
  modeForcedBy: 'user-flag' | 'slash-command' | 'heuristic' | null;
}

export function decideMode(
  _ctx: PipelineContext,
  triggerCtx: TriggerContext,
  extractedText: string,
): ModeDecision {
  if ((triggerCtx.mode === 'A' || triggerCtx.mode === 'B') && triggerCtx.modeForcedBy) {
    return {
      mode: triggerCtx.mode,
      reason: `Mode ${triggerCtx.mode} forced via ${triggerCtx.modeForcedBy}.`,
      modeForcedBy: triggerCtx.modeForcedBy,
    };
  }
  // 'auto' (or unforced) → run heuristic
  const h = detectMode(extractedText);
  return {
    mode: h.mode,
    reason: h.reason,
    modeForcedBy: 'heuristic',
  };
}

export function delegateToCaseStudy(
  ctx: PipelineContext,
  _triggerCtx: TriggerContext,
  brief: Brief,
): CaseStudyHandoff {
  const decision = _triggerCtx
    ? decideMode(ctx, _triggerCtx, brief.extractedText ?? '')
    : { mode: 'B' as const, reason: 'caller-resolved', modeForcedBy: null };
  return {
    kind: 'case-study-delegation',
    siblingSkillPath: '~/.claude/skills/case-study.md',
    sourcePath: (brief as unknown as { sourcePath?: string }).sourcePath ?? '',
    sourceExcerpt: brief.extractedText ?? '',
    modeReason: decision.reason,
    metadata: {
      domain: ctx.domain,
      sourceType: brief.sourceType,
      briefSchemaVersion: (brief as unknown as { briefSchemaVersion?: string }).briefSchemaVersion,
    },
  };
}

// FR-028 / R-10 — image-extraction count announced up front BEFORE first
// interpret_image MCP call. See contracts/pipeline-stages.md.
export function announceImageExtraction(
  brief: Pick<Brief, 'sourceType' | 'metadata'> & { sourceManifest?: unknown },
  lessonOutputDir: string,
): void {
  const sourceType = brief.sourceType;
  const metadata = (brief.metadata ?? {}) as Record<string, unknown>;

  // Read the .scratch/vision-handoffs.json sidecar if present (single-source ingests).
  type Sidecar = { handoffs?: unknown[]; pageCount?: number; sourceType?: string };
  let sidecar: Sidecar | null = null;
  const sidecarPath = path.join(lessonOutputDir, '.scratch', 'vision-handoffs.json');
  try {
    if (fs.existsSync(sidecarPath)) {
      sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8')) as Sidecar;
    }
  } catch {
    sidecar = null;
  }
  const sidecarCount = Array.isArray(sidecar?.handoffs) ? (sidecar!.handoffs as unknown[]).length : 0;

  switch (sourceType) {
    case 'pdf-scanned': {
      const n = sidecarCount > 0 ? sidecarCount : (typeof metadata.pageCount === 'number' ? metadata.pageCount : 0);
      progress.stage(0, 5, `ingest: scanned-PDF (${n} pages — ${n} interpret_image calls follow)`);
      return;
    }
    case 'image': {
      progress.stage(0, 5, 'ingest: image (1 image — 1 interpret_image call follows)');
      return;
    }
    case 'image-folder': {
      const n = sidecarCount > 0 ? sidecarCount : 0;
      progress.stage(0, 5, `ingest: image-folder (${n} images — ${n} interpret_image calls follow)`);
      return;
    }
    case 'multi-pdf': {
      const pdfCount = typeof metadata.pdfCount === 'number' ? metadata.pdfCount : 0;
      const hasAnyVision = metadata.hasAnyVisionExtraction === true;
      if (!hasAnyVision) {
        progress.stage(0, 5, `ingest: multi-pdf (${pdfCount} PDFs, all-text)`);
        return;
      }
      // Sum vision pages across per-PDF metadata where extraction was vision-driven.
      const perPdf = Array.isArray(metadata.perPdfMetadata) ? (metadata.perPdfMetadata as unknown[]) : [];
      let visionPages = 0;
      let unknown = false;
      for (const md of perPdf) {
        const m = (md ?? {}) as Record<string, unknown>;
        // A scanned-PDF leg sets hasTextLayer=false; vision pages == pageCount of that leg.
        if (m.hasTextLayer === false) {
          if (typeof m.pageCount === 'number') {
            visionPages += m.pageCount;
          } else {
            unknown = true;
          }
        }
      }
      if (unknown || (visionPages === 0 && hasAnyVision)) {
        progress.stage(
          0,
          5,
          `ingest: multi-pdf (${pdfCount} PDFs, M = unknown total pages — interpret_image calls follow) [warning: per-PDF page counts unavailable]`,
        );
        return;
      }
      progress.stage(
        0,
        5,
        `ingest: multi-pdf (${pdfCount} PDFs, ${visionPages} total pages — ${visionPages} interpret_image calls follow)`,
      );
      return;
    }
    case 'bundle': {
      const fileCount = typeof metadata.fileCount === 'number' ? metadata.fileCount : 0;
      const manifest = (brief as unknown as { sourceManifest?: Array<{ extractor?: string }> }).sourceManifest;
      let imageCount = 0;
      if (Array.isArray(manifest)) {
        for (const entry of manifest) {
          const ex = entry?.extractor;
          if (ex === 'vision-image' || ex === 'vision-pdf') imageCount++;
        }
      }
      if (imageCount === 0) {
        progress.stage(0, 5, `ingest: bundle (${fileCount} files, no images)`);
        return;
      }
      progress.stage(
        0,
        5,
        `ingest: bundle (${fileCount} files, ${imageCount} images — ${imageCount} interpret_image calls follow)`,
      );
      return;
    }
    default: {
      // text-PDF, code-repo, vocab-list, transcript, url, html-file, agent-report, etc.
      progress.stage(0, 5, `ingest: ${sourceType}`);
      return;
    }
  }
}

export function stage1Brief(
  ctx: PipelineContext,
  partialBrief: Pick<Brief, 'domain' | 'mode' | 'sourceType' | 'sourcePath' | 'extractedText' | 'metadata'>,
  triggerCtx?: TriggerContext,
  extractedText?: string,
): PipelinePromptHandoff | Stage0RefusalReport | CaseStudyHandoff {
  // FR-016 / FR-035 / SC-016 preflight runs FIRST — refusal beats Mode-B delegation.
  const refusal = stage0Preflight(ctx, partialBrief as unknown as Brief);
  if (refusal) {
    progress.stage(1, 5, `brief refused: ${refusal.reason}`);
    return refusal;
  }

  // FR-028 / R-10 — Stage-0 image-extraction announcement (parent-level, before first MCP call).
  announceImageExtraction(partialBrief as unknown as Brief, ctx.lessonOutputDir);

  // Mode-B delegation per FR-003 — only runs if trigger context is provided.
  if (triggerCtx) {
    const text = extractedText ?? partialBrief.extractedText ?? '';
    const decision = decideMode(ctx, triggerCtx, text);
    if (decision.mode === 'B') {
      progress.stage(0, 5, 'Mode B detected — delegating to case-study skill');
      return {
        kind: 'case-study-delegation',
        siblingSkillPath: '~/.claude/skills/case-study.md',
        sourcePath: partialBrief.sourcePath ?? '',
        sourceExcerpt: text,
        modeReason: decision.reason,
        metadata: {
          domain: ctx.domain,
          sourceType: partialBrief.sourceType,
          briefSchemaVersion: (partialBrief as unknown as { briefSchemaVersion?: string }).briefSchemaVersion,
        },
      };
    }
  }

  progress.stage(1, 5, `brief: ${partialBrief.sourceType}`);
  const { p, t } = loadTemplate(ctx.promptsDir, '01-brief.md');
  return {
    stage: 1,
    templatePath: p,
    templateText: t,
    slots: { ...partialBrief },
    expectedResponsePath: path.join(ctx.lessonOutputDir, 'brief.json'),
  };
}

export function persistBrief(ctx: PipelineContext, brief: Brief): void {
  const v = validateBrief(brief);
  if (!v.ok) {
    throw new Error(`Brief validation failed: ${JSON.stringify(v.issues)}`);
  }
  fs.writeFileSync(
    path.join(ctx.lessonOutputDir, 'brief.json'),
    JSON.stringify(brief, null, 2),
  );
}

export function stage2Syllabus(
  ctx: PipelineContext,
  brief: Brief,
  themeBlock: string,
): PipelinePromptHandoff {
  progress.stage(2, 5, 'syllabus: planning chapters…');
  const { p, t } = loadTemplate(ctx.promptsDir, '02-syllabus.md');
  return {
    stage: 2,
    templatePath: p,
    templateText: t,
    slots: { brief, themeBlock },
    expectedResponsePath: path.join(ctx.lessonOutputDir, 'syllabus.json'),
  };
}

export function stage3Validate(
  ctx: PipelineContext,
  syllabus: ChapterSyllabus[],
): {
  ok: boolean;
  issuesByChapter: Record<number, ReturnType<typeof validateSyllabus>['issues']>;
  verifierRequired: boolean;
} {
  const issuesByChapter: Record<number, ReturnType<typeof validateSyllabus>['issues']> = {};
  let allOk = true;
  for (const ch of syllabus) {
    const v = validateSyllabus(ch, ctx.conceptDag);
    if (!v.ok) {
      issuesByChapter[ch.chapterNumber] = v.issues;
      allOk = false;
    }
    progress.chapter(3, ch.chapterNumber, syllabus.length, v.ok ? 'ok' : `${v.issues.length} issue(s)`);
  }
  // FR-007 / SC-011 — medicine domain MUST also run the QUEST-AI verifier loop on each
  // chapter's clinical claims (vignettes especially). Non-medicine domains skip this.
  const verifierRequired = ctx.domain === 'medicine';
  return { ok: allOk, issuesByChapter, verifierRequired };
}

export function stage3Retry(
  ctx: PipelineContext,
  attempt: number,
  issues: Record<number, ReturnType<typeof validateSyllabus>['issues']>,
): PipelinePromptHandoff {
  if (attempt > MAX_VALIDATOR_RETRIES) {
    throw new Error(`Validator exceeded ${MAX_VALIDATOR_RETRIES} retries (FR-006) — aborting`);
  }
  const { p, t } = loadTemplate(ctx.promptsDir, '03-validate-rubric.md');
  return {
    stage: 3,
    templatePath: p,
    templateText: t,
    slots: { attempt, issuesByChapter: issues },
    expectedResponsePath: path.join(ctx.lessonOutputDir, `syllabus.retry-${attempt}.json`),
  };
}

export function stage4ChapterWrite(
  ctx: PipelineContext,
  chapter: ChapterSyllabus,
  totalChapters: number,
  priorChapterStruggleSummary: string[] | null,
): PipelinePromptHandoff {
  progress.chapter(4, chapter.chapterNumber, totalChapters, 'writing…');
  const { p, t } = loadTemplate(ctx.promptsDir, '04a-chapter-write.md');
  return {
    stage: 4,
    templatePath: p,
    templateText: t,
    slots: { chapterSyllabus: chapter, priorChapterStruggleSummary },
    expectedResponsePath: path.join(
      ctx.lessonOutputDir,
      `chapter-${chapter.chapterNumber}.json`,
    ),
  };
}

export function stage4AnswerBalancer(
  ctx: PipelineContext,
  chapterNumber: number,
  totalChapters: number,
  draftWidgets: unknown[],
): PipelinePromptHandoff {
  progress.chapter(4, chapterNumber, totalChapters, 'answer-balancer post-pass');
  // T173: medicine balancer output should re-run Stage-2 verifier on new distractors
  // to catch length-balancing edits that introduce unsourced clinical claims.
  const { p, t } = loadTemplate(ctx.promptsDir, '05-answer-balancer.md');
  return {
    stage: 4,
    templatePath: p,
    templateText: t,
    slots: { chapterNumber, widgets: draftWidgets },
    expectedResponsePath: path.join(
      ctx.lessonOutputDir,
      `chapter-${chapterNumber}.balanced.json`,
    ),
  };
}

export function stage5Assemble(
  ctx: PipelineContext,
  opts?: { skillRoot?: string; chapter1SrCards?: Array<{ front: string; back: string; tags?: string[] }> },
): { dbPath: string; lessonHtmlPath: string } {
  progress.stage(5, 5, 'assemble: build.sh + sqlite-init + open');
  // T132: actually invoke assembleLesson (which runs build.sh out-of-process,
  // initializes SQLite, seeds chapter-1 SR cards + bookmark, opens browser).
  // assembleLesson handles FR-009 / FR-037 / Stage-5 contract end-to-end.
  // skillRoot defaults to two levels up from this file (skill/lib → skill/),
  // so callers don't have to pass it for the standard install layout.
  const skillRoot = opts?.skillRoot
    ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  return assembleLesson({
    lessonOutputDir: ctx.lessonOutputDir,
    skillRoot,
    chapter1SrCards: opts?.chapter1SrCards ?? [],
  });
}

/** Stage-6 (post-assemble) "Listen mode" audio-bake options. */
export interface Stage6AudioOpts {
  /** Lecture artifacts authored by the Stage-04s Gemini handoff. Omit to skip audio (opt-in). */
  artifacts?: LectureArtifact[];
  /** Registered voice name → its OmniVoice ref (from the Atelier registry). Required when artifacts present. */
  voices?: Record<string, VoiceRef>;
  /** Override OmniVoice base URL (default: the Atelier sidecar). */
  omnivoiceUrl?: string;
  /** Override playback loudness target in LUFS (default −30). */
  playbackTarget?: number;
}

/**
 * Stage 6 — bake the "Listen mode" lecture audio. NON-BLOCKING for the user:
 * Stage 5 has already built + opened `lesson.html`, so this fills in the
 * `audio/` sidecar + `audio_clips` manifest while the user reads. Opt-in per
 * lesson — a no-op when no lecture artifacts are supplied.
 *
 * Never throws on synthesis failure (per-clip status is recorded in
 * `audio_clips`); if Atelier OmniVoice is unreachable, clips are marked
 * `pending` and the lesson still works.
 */
export async function stage6BakeAudio(
  ctx: PipelineContext,
  opts: Stage6AudioOpts = {},
): Promise<AudioClipResult[]> {
  const artifacts = opts.artifacts ?? [];
  if (artifacts.length === 0) {
    progress.stage(6, 6, 'audio: no lecture script supplied — skipping bake (opt-in)');
    return [];
  }
  if (!opts.voices || Object.keys(opts.voices).length === 0) {
    throw new Error('stage6BakeAudio: lecture artifacts supplied but no `voices` registry given');
  }
  progress.stage(6, 6, `audio: baking ${artifacts.length} lecture artifact(s) async — lesson already open`);
  return bakeAudio({
    lessonOutputDir: ctx.lessonOutputDir,
    courseId: path.basename(ctx.lessonOutputDir),
    artifacts,
    voices: opts.voices,
    omnivoiceUrl: opts.omnivoiceUrl,
    playbackTarget: opts.playbackTarget,
  });
}

// ─── Medicine-only QUEST-AI verifier loop per FR-007 / SC-011 ────────────────
// Non-medicine domains skip this entirely. Up to 3 attempts; abort with structured report on failure.

const MAX_VERIFIER_ATTEMPTS = 3; // SC-011

export interface VerifierState {
  attempt: number;
  latestDraft: string;
  latestVerification: unknown | null;
  readyForApproval: boolean;
}

export interface VerifierAbortReport {
  reason: string;
  lastState: VerifierState;
}

export interface VerifierStage1Opts {
  contentType: 'vignette' | 'chapter-narrative' | 'drug-class';
  condition: string;
  sourceExcerpt: string;
  audience: 'board-exam' | 'point-of-care';
  difficulty: 'intro' | 'advanced';
}

export interface VerifierStage2Opts {
  stage1Output: unknown;
  sourceExcerpt: string;
}

export interface VerifierStage3Opts {
  stage1Draft: unknown;
  stage1Claims: unknown;
  stage2Report: unknown;
  sourceExcerpt: string;
  maxAttempts: number;
}

function assertMedicine(ctx: PipelineContext, fn: string): void {
  if (ctx.domain !== 'medicine') {
    throw new Error(`${fn} is medicine-only (FR-007); ctx.domain=${ctx.domain}`);
  }
}

export function verifierStage1(
  ctx: PipelineContext,
  opts: VerifierStage1Opts,
): PipelinePromptHandoff {
  assertMedicine(ctx, 'verifierStage1');
  const { p, t } = loadTemplate(ctx.promptsDir, 'medicine-only/verifier-stage1-generate.md');
  return {
    stage: 3,
    templatePath: p,
    templateText: t,
    slots: { ...opts },
    expectedResponsePath: path.join(ctx.lessonOutputDir, 'verifier-stage1.json'),
  };
}

export function verifierStage2(
  ctx: PipelineContext,
  opts: VerifierStage2Opts,
): PipelinePromptHandoff {
  assertMedicine(ctx, 'verifierStage2');
  const { p, t } = loadTemplate(ctx.promptsDir, 'medicine-only/verifier-stage2-verify.md');
  return {
    stage: 3,
    templatePath: p,
    templateText: t,
    slots: { ...opts },
    expectedResponsePath: path.join(ctx.lessonOutputDir, 'verifier-stage2.json'),
  };
}

export function verifierStage3(
  ctx: PipelineContext,
  opts: VerifierStage3Opts,
): PipelinePromptHandoff {
  assertMedicine(ctx, 'verifierStage3');
  const { p, t } = loadTemplate(ctx.promptsDir, 'medicine-only/verifier-stage3-refine.md');
  return {
    stage: 3,
    templatePath: p,
    templateText: t,
    slots: { ...opts },
    expectedResponsePath: path.join(ctx.lessonOutputDir, 'verifier-stage3.json'),
  };
}

export interface VerifierLoopResult {
  next: 'stage1' | 'stage2' | 'stage3' | 'done' | 'aborted';
  handoff?: PipelinePromptHandoff;
  abortReport?: VerifierAbortReport;
}

/**
 * State machine driving the QUEST-AI verifier loop.
 *
 * Action semantics:
 *   - 'start'    — begin loop. Sets attempt=1, returns Stage 1 handoff. payload = VerifierStage1Opts.
 *   - 'verified' — caller has run Stage 2 and supplies its parsed result as payload.
 *                  If overallVerdict==='approved' → done. Else, if attempt>=3 → aborted.
 *                  Else returns Stage 3 refine handoff.
 *   - 'refined'  — caller has run Stage 3 and supplies its parsed result as payload.
 *                  If readyForApproval===true → done. Else, if attempt>=3 → aborted.
 *                  Else attempt++, returns Stage 1 handoff (regenerate from refinedDraft).
 *
 * The caller owns the prompt round-trip; this function only emits handoffs and decisions.
 */
export function runVerifierLoop(
  ctx: PipelineContext,
  state: VerifierState,
  action: 'start' | 'verified' | 'refined',
  payload?: unknown,
): VerifierLoopResult {
  assertMedicine(ctx, 'runVerifierLoop');

  if (action === 'start') {
    state.attempt = 1;
    state.latestVerification = null;
    state.readyForApproval = false;
    const opts = (payload ?? {}) as VerifierStage1Opts;
    return { next: 'stage1', handoff: verifierStage1(ctx, opts) };
  }

  if (action === 'verified') {
    const verification = (payload ?? {}) as {
      overallVerdict?: string;
      stage1Draft?: unknown;
      stage1Claims?: unknown;
      sourceExcerpt?: string;
    };
    state.latestVerification = verification;
    if (verification.overallVerdict === 'approved') {
      state.readyForApproval = true;
      return { next: 'done' };
    }
    if (state.attempt >= MAX_VERIFIER_ATTEMPTS) {
      return {
        next: 'aborted',
        abortReport: {
          reason: `SC-011: verifier reached max attempts (${MAX_VERIFIER_ATTEMPTS}) without approved verdict`,
          lastState: { ...state },
        },
      };
    }
    return {
      next: 'stage3',
      handoff: verifierStage3(ctx, {
        stage1Draft: verification.stage1Draft ?? state.latestDraft,
        stage1Claims: verification.stage1Claims ?? null,
        stage2Report: verification,
        sourceExcerpt: verification.sourceExcerpt ?? '',
        maxAttempts: MAX_VERIFIER_ATTEMPTS,
      }),
    };
  }

  if (action === 'refined') {
    const refined = (payload ?? {}) as {
      readyForApproval?: boolean;
      refinedDraft?: string;
      stage1Opts?: VerifierStage1Opts;
    };
    if (refined.refinedDraft) state.latestDraft = refined.refinedDraft;
    if (refined.readyForApproval === true) {
      state.readyForApproval = true;
      return { next: 'done' };
    }
    if (state.attempt >= MAX_VERIFIER_ATTEMPTS) {
      return {
        next: 'aborted',
        abortReport: {
          reason: `SC-011: verifier loop exhausted ${MAX_VERIFIER_ATTEMPTS} attempts; refined draft still not approved`,
          lastState: { ...state },
        },
      };
    }
    state.attempt += 1;
    const nextOpts: VerifierStage1Opts = refined.stage1Opts ?? ({} as VerifierStage1Opts);
    return { next: 'stage1', handoff: verifierStage1(ctx, nextOpts) };
  }

  throw new Error(`runVerifierLoop: unknown action '${action as string}'`);
}

// ─── T166: programmatic source-span enforcement for Stage-3 refined output ──
/**
 * For every claim with action `corrected` or `replaced`, assert that its
 * `sourceSpan` is a verbatim substring of `sourceExcerpt`. Returns
 * `{ok: true}` if all spans verify; otherwise `{ok: false, offenders: [...]}`
 * with the list of offending claimIds. The orchestrator should reject the
 * refined draft (treat as `readyForApproval: false`) when `ok === false`.
 */
export function assertVerifierStage3SourceSpans(
  refinedOutput: { factualClaims: Array<{ action?: string; claimId: string; sourceSpan?: string }> },
  sourceExcerpt: string,
): { ok: boolean; offenders: string[] } {
  const offenders: string[] = [];
  const claims = Array.isArray(refinedOutput?.factualClaims) ? refinedOutput.factualClaims : [];
  for (const claim of claims) {
    const action = claim?.action;
    if (action !== 'corrected' && action !== 'replaced') continue;
    const span = typeof claim?.sourceSpan === 'string' ? claim.sourceSpan : '';
    if (span.length === 0 || !sourceExcerpt.includes(span)) {
      offenders.push(claim.claimId);
    }
  }
  return offenders.length === 0 ? { ok: true, offenders: [] } : { ok: false, offenders };
}

// ─── T167: anti-rubber-stamp programmatic check for Stage-2 verify output ──
/**
 * If Stage-2's `claimVerifications` array has ≥5 entries and every verdict is
 * `verified` (zero `unverifiable-from-source` and zero `contradicted`), the
 * orchestrator should REJECT and request a stricter second pass with bumped
 * temperature. Empirically a 0-issue verdict on a 5+-claim chapter strongly
 * indicates skipped verification.
 */
export function assertVerifierStage2NotRubberStamping(
  verifyOutput: { claimVerifications: Array<{ verdict: string }> },
): { ok: boolean; reason?: string } {
  const verifications = Array.isArray(verifyOutput?.claimVerifications)
    ? verifyOutput.claimVerifications
    : [];
  if (verifications.length < 5) {
    return { ok: true };
  }
  const allVerified = verifications.every((v) => v?.verdict === 'verified');
  if (allVerified) {
    return {
      ok: false,
      reason: `T167: rubber-stamp suspected — ${verifications.length} claims all verdict='verified' with 0 unverifiable-from-source and 0 contradicted entries. Re-run Stage-2 with bumped temperature.`,
    };
  }
  return { ok: true };
}
