// Pipeline orchestrator — 5 stages per contracts/pipeline-stages.md.
// Per Q8: text-LLM stages (1-4) hand control to the parent Claude Code agent
// by loading a prompt template and emitting it. No SDK call is made here.
//
// FR-006 retry: Stage 3 may re-invoke Stages 1/2 with structured issue feedback
// up to 3 attempts before aborting.
// FR-029: deep-research is opt-in only, ≤1 invocation per lesson.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { progress } from './progress.js';
import { validateBrief, validateSyllabus, type ConceptDag } from './validator.js';
import { initDb } from './sqlite-init.js';
import type { Brief } from './schemas/brief.js';
import type { ChapterSyllabus } from './schemas/chapter-syllabus.js';

export interface PipelineContext {
  lessonOutputDir: string;
  promptsDir: string; // <skill>/prompts/
  domain: 'code' | 'medicine' | 'language-it' | 'research-paper';
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

export function stage1Brief(
  ctx: PipelineContext,
  partialBrief: Pick<Brief, 'domain' | 'mode' | 'sourceType' | 'sourcePath' | 'extractedText' | 'metadata'>,
): PipelinePromptHandoff | Stage0RefusalReport {
  const refusal = stage0Preflight(ctx, partialBrief as unknown as Brief);
  if (refusal) {
    progress.stage(1, 5, `brief refused: ${refusal.reason}`);
    return refusal;
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

export function stage5Assemble(ctx: PipelineContext): { dbPath: string; lessonHtmlPath: string } {
  progress.stage(5, 5, 'assemble: build.sh + sqlite-init + open');
  // build.sh runs out-of-process (FR-009 — generation-time only).
  // sqlite-init applies the schema (no llm_* tables per Q8).
  const db = initDb(ctx.lessonOutputDir);
  const dbPath = (db as unknown as { name: string }).name;
  db.close();
  const lessonHtmlPath = path.join(ctx.lessonOutputDir, 'lesson.html');
  return { dbPath, lessonHtmlPath };
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
