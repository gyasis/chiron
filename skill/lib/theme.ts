/**
 * Chiron — Theme registry (T019).
 *
 * Wraps the five CSS files shipped under `skill/shell/themes/` and chooses a
 * default theme per domain (FR-024). The CSS files are still the source of
 * truth for visual tokens; this registry is the in-process index used by the
 * pipeline (Stage 2 prompt-injection, Stage 5 assembly) to know which file to
 * inline into `lesson.html`.
 */

export type Domain = 'medicine' | 'language' | 'code' | 'research-paper';

export interface Theme {
  /** Stable id — matches `[data-theme="<id>"]` selector in the CSS files. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Path to the theme stylesheet, relative to `skill/shell/`. */
  cssFile: string;
  /** Domain this theme is the default for, if any. */
  defaultFor?: Domain | null;
}

export const THEMES: Record<string, Theme> = {
  'warm-paper': {
    id: 'warm-paper',
    name: 'Warm Paper',
    cssFile: 'themes/warm-paper.css',
    defaultFor: 'research-paper',
  },
  midnight: {
    id: 'midnight',
    name: 'Midnight',
    cssFile: 'themes/midnight.css',
    defaultFor: 'code',
  },
  ocean: {
    id: 'ocean',
    name: 'Ocean',
    cssFile: 'themes/ocean.css',
    defaultFor: null,
  },
  clinical: {
    id: 'clinical',
    name: 'Clinical',
    cssFile: 'themes/clinical.css',
    defaultFor: 'medicine',
  },
  linguistic: {
    id: 'linguistic',
    name: 'Linguistic',
    cssFile: 'themes/linguistic.css',
    defaultFor: 'language',
  },
};

/** Default theme used when no domain-specific match is found. */
export const DEFAULT_THEME: Theme = THEMES['warm-paper'];

/**
 * Pick a theme for a domain. Medicine → clinical, language → linguistic,
 * code → midnight, anything else (or unknown) → warm-paper.
 */
export function getThemeForDomain(domain: string): Theme {
  for (const t of Object.values(THEMES)) {
    if (t.defaultFor && t.defaultFor === (domain as Domain)) return t;
  }
  return DEFAULT_THEME;
}

/** List all themes (handy for UI / tests). */
export function listThemes(): Theme[] {
  return Object.values(THEMES);
}
