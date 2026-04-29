/**
 * Chiron — Zod schema for ChapterSyllabus (T016).
 *
 * Stage 2 (SYLLABUS) emits an array of these; Stage 3 (VALIDATE) runs this
 * schema before any concept-DAG / rubric checks. Mirrors `data-model.md` §1.2.
 *
 * Refinements at this layer:
 *   - `scienceAnnotations.length >= 3`             (FR-022)
 *   - `keyConcepts.length >= 1`                    (data-model)
 *   - `widgets.length >= 1`                        (FR-018)
 *   - chapter ≥ 8 ⇒ `spacingConnections.length` in [2..4]  (FR-022)
 *
 * Quiz-variant non-emptiness (FR-021) is enforced by the WidgetSpec schema
 * itself rather than re-checked here.
 */

import { z } from 'zod';
import { WidgetSchema } from './widget-spec.js';

export const SciencePrincipleSchema = z.enum([
  'spacing', 'interleaving', 'retrieval', 'examples', 'dual-coding',
]);
export type SciencePrinciple = z.infer<typeof SciencePrincipleSchema>;

export const ScienceAnnotationSchema = z.object({
  principle: SciencePrincipleSchema,
  description: z.string(),
  relatedChapters: z.array(z.number().int()).optional(),
});
export type ScienceAnnotation = z.infer<typeof ScienceAnnotationSchema>;

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const ChapterSyllabusSchema = z
  .object({
    chapterId: z.string().regex(KEBAB_CASE, 'chapterId must be kebab-case'),
    chapterNumber: z.number().int().min(1),
    title: z.string().min(1),
    narrative: z.string().min(1),
    keyConcepts: z.array(z.string()).min(1),
    widgets: z.array(WidgetSchema).min(1),
    scienceAnnotations: z.array(ScienceAnnotationSchema).min(3, {
      message: 'FR-022: each chapter requires at least 3 scienceAnnotations',
    }),
    spacingConnections: z.array(z.number().int()).optional(),
    personaTriggers: z.array(z.string()).optional(),
    priorChapterStruggleSummary: z.array(z.string()).nullable().optional(),
    estWordCount: z.number().int().nonnegative().optional(),
    dependencies: z.array(z.string()).optional(),
  })
  .superRefine((val, ctx) => {
    // FR-022: chapters 8 and later must carry 2-4 spacing connections.
    if (val.chapterNumber >= 8) {
      const sc = val.spacingConnections ?? [];
      if (sc.length < 2 || sc.length > 4) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['spacingConnections'],
          message:
            `FR-022: chapter ${val.chapterNumber} requires 2-4 spacingConnections (got ${sc.length})`,
        });
      }
    }
    // FR-023: chapter 2+ should carry a priorChapterStruggleSummary (3 bullets) or null.
    if (val.chapterNumber >= 2 && val.priorChapterStruggleSummary === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priorChapterStruggleSummary'],
        message:
          'FR-023: chapter 2+ must include priorChapterStruggleSummary (string[3] or null)',
      });
    }
    if (
      Array.isArray(val.priorChapterStruggleSummary) &&
      val.priorChapterStruggleSummary.length !== 3
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priorChapterStruggleSummary'],
        message: 'priorChapterStruggleSummary, when present, must be exactly 3 bullets',
      });
    }
  });

export type ChapterSyllabus = z.infer<typeof ChapterSyllabusSchema>;
