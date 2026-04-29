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

export function stage1Brief(
  ctx: PipelineContext,
  partialBrief: Pick<Brief, 'domain' | 'mode' | 'sourceType' | 'sourcePath' | 'extractedText' | 'metadata'>,
): PipelinePromptHandoff {
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
): { ok: boolean; issuesByChapter: Record<number, ReturnType<typeof validateSyllabus>['issues']> } {
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
  return { ok: allOk, issuesByChapter };
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
