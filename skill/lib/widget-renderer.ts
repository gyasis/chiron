/**
 * Chiron — Widget renderer dispatcher (T020).
 *
 * Maps `WidgetSpec.type` → render function. Wave-2 ships only the dispatcher
 * skeleton; concrete renderers are filled in by later waves:
 *   - T038, T040          (mcq, true-false, mathjax, mermaid universal)
 *   - T055-T058           (medicine: vignette, agreement-matrix, molecule, forest-plot)
 *   - T077-T079           (language: fill-blank, matching-pair, audio-tts)
 *   - T101-T102           (code: spot-the-bug, code-runner)
 *
 * Every unimplemented kind throws `NotImplemented: <kind>` so the build fails
 * loudly rather than silently emitting blank HTML — easier for later waves
 * to debug.
 *
 * Renderers are registered via `registerRenderer(kind, fn)` so later waves
 * can extend without editing this file (open/closed).
 */

import type { WidgetKind, WidgetSpec } from './schemas/widget-spec.js';
import { WIDGET_KINDS } from './schemas/widget-spec.js';

/** Function signature every renderer must satisfy. */
export type WidgetRenderer = (widget: WidgetSpec) => string;

const REGISTRY: Map<WidgetKind, WidgetRenderer> = new Map();

/** Register (or replace) a renderer for a given widget kind. */
export function registerRenderer(kind: string, fn: WidgetRenderer): void {
  REGISTRY.set(kind as WidgetKind, fn);
}

/** Look up the renderer (or `undefined`). */
export function getRenderer(kind: string): WidgetRenderer | undefined {
  return REGISTRY.get(kind as WidgetKind);
}

/** Render a single widget. Throws if no renderer is registered for `widget.type`. */
export function renderWidget(widget: WidgetSpec): string {
  const fn = REGISTRY.get(widget.type);
  if (!fn) throw new Error(`NotImplemented: ${widget.type}`);
  return fn(widget);
}

// ---------------------------------------------------------------------------
// Wave-2 stub registrations — every kind throws until a later wave overrides.
// ---------------------------------------------------------------------------
for (const kind of WIDGET_KINDS) {
  REGISTRY.set(kind, () => {
    throw new Error(`NotImplemented: ${kind}`);
  });
}

/** List the kinds currently registered. Useful for sanity tests. */
export function registeredKinds(): WidgetKind[] {
  return Array.from(REGISTRY.keys());
}
