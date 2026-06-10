// Persona-pack loader for ~/.chiron/packs/<id>/persona.md
//
// loadPersona(id)   — parse YAML frontmatter + register body from the pack file.
// activePersonaFor(domain) — look up the active persona id for a domain from
//                            ~/.chiron/packs/active.json.
//
// Both functions are null-safe: missing files → null, never throw.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface Persona {
  id: string;
  name: string;
  learnerName?: string;
  voices: { it: string; en: string };
  domains: string[];
  extends?: string;
  medicalProxy?: boolean;
  active?: boolean;
  registerText: string;
}

// ---------------------------------------------------------------------------
// Minimal frontmatter parser (no external dep — package.json has no yaml lib)
//
// Handles:
//   - scalar:  key: value
//   - nested:  voices:\n  it: x\n  en: y
//   - inline array:  domains: [a, b]
//   - booleans:  true / false
// Returns a plain Record; caller casts the fields it needs.
// ---------------------------------------------------------------------------
function parseFrontmatter(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = raw.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Skip blank lines at top-level
    if (!line.trim()) { i++; continue; }
    // Top-level key (no leading spaces)
    const topMatch = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!topMatch) { i++; continue; }
    const key = topMatch[1];
    const rest = topMatch[2].trim();
    // Inline array: domains: [a, b]
    if (rest.startsWith('[') && rest.endsWith(']')) {
      const inner = rest.slice(1, -1);
      result[key] = inner.split(',').map((s) => s.trim()).filter(Boolean);
      i++;
      continue;
    }
    // No value on this line → look for indented children
    if (rest === '') {
      const nested: Record<string, string> = {};
      i++;
      while (i < lines.length && /^ {2}/.test(lines[i])) {
        const childMatch = /^ {2}([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(lines[i]);
        if (childMatch) {
          nested[childMatch[1]] = childMatch[2].trim();
        }
        i++;
      }
      result[key] = nested;
      continue;
    }
    // Scalar value
    result[key] = parseScalar(rest);
    i++;
  }
  return result;
}

function parseScalar(v: string): string | boolean | number {
  if (v === 'true') return true;
  if (v === 'false') return false;
  const n = Number(v);
  if (!Number.isNaN(n) && v !== '') return n;
  // Strip surrounding quotes if present
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function loadPersona(id: string): Persona | null {
  const packDir = path.join(os.homedir(), '.chiron', 'packs', id);
  const personaPath = path.join(packDir, 'persona.md');
  let raw: string;
  try {
    raw = fs.readFileSync(personaPath, 'utf8');
  } catch {
    return null;
  }

  // Split on the --- delimiters
  // File shape: ---\n<frontmatter>\n---\n<body>
  const parts = raw.split(/^---\s*$/m);
  // parts[0] may be empty (file starts with ---), parts[1] = frontmatter, parts[2+] = body
  let fmRaw = '';
  let bodyRaw = '';
  if (parts.length >= 3) {
    fmRaw = parts[1];
    bodyRaw = parts.slice(2).join('---').trim();
  } else if (parts.length === 2) {
    fmRaw = parts[1];
    bodyRaw = '';
  } else {
    // No delimiters at all — treat whole file as body
    bodyRaw = raw.trim();
  }

  const fm = parseFrontmatter(fmRaw);

  // Build voices object (nested under "voices" key)
  const voicesRaw = fm['voices'];
  const voices: { it: string; en: string } = {
    it: typeof voicesRaw === 'object' && voicesRaw !== null
      ? String((voicesRaw as Record<string, unknown>)['it'] ?? '')
      : '',
    en: typeof voicesRaw === 'object' && voicesRaw !== null
      ? String((voicesRaw as Record<string, unknown>)['en'] ?? '')
      : '',
  };

  // Build domains array
  const domainsRaw = fm['domains'];
  const domains: string[] = Array.isArray(domainsRaw)
    ? (domainsRaw as unknown[]).map(String)
    : typeof domainsRaw === 'string'
      ? [domainsRaw]
      : [];

  const persona: Persona = {
    id: typeof fm['id'] === 'string' ? fm['id'] : id,
    name: typeof fm['name'] === 'string' ? fm['name'] : id,
    voices,
    domains,
    registerText: bodyRaw,
  };

  if (typeof fm['learner_name'] === 'string') {
    persona.learnerName = fm['learner_name'];
  }
  if (typeof fm['extends'] === 'string') {
    persona.extends = fm['extends'];
  }
  if (typeof fm['medical_proxy'] === 'boolean') {
    persona.medicalProxy = fm['medical_proxy'];
  }
  if (typeof fm['active'] === 'boolean') {
    persona.active = fm['active'];
  }

  return persona;
}

export function activePersonaFor(domain: string): string | null {
  const activePath = path.join(os.homedir(), '.chiron', 'packs', 'active.json');
  let raw: string;
  try {
    raw = fs.readFileSync(activePath, 'utf8');
  } catch {
    return null;
  }
  let mapping: unknown;
  try {
    mapping = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof mapping !== 'object' || mapping === null) return null;
  const id = (mapping as Record<string, unknown>)[domain];
  return typeof id === 'string' ? id : null;
}
