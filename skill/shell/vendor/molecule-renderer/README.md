# Molecule Renderer (placeholder)

This directory will hold the concrete 2D molecule rendering library used by
the `molecule-2d` widget (per `contracts/widget-spec.ts`). The concrete
library is **deliberately not chosen yet** — selection happens during
US3 (medicine domain) Phase 4 prototyping per FR-031 / R-02.

## Candidate libraries

Two candidates are under consideration. A prototype in Phase 4 will pick one
based on bundle size, SMILES coverage, render fidelity, and license.

### 1. Kekule.js
- **Repo:** https://github.com/partridgejiang/Kekule.js
- **License:** MIT
- **Strengths:** Mature, full chemistry toolkit (also handles reactions,
  spectra). Pure-JS — no WebAssembly download.
- **Weaknesses:** Larger surface than we need; ~1MB minified.

### 2. RDKit-JS
- **Repo:** https://github.com/rdkit/rdkit-js
- **License:** BSD-3-Clause
- **Strengths:** Industry-standard SMILES parsing/rendering parity with the
  Python RDKit. Excellent edge-case coverage.
- **Weaknesses:** WebAssembly-based — larger initial download (~3-5MB wasm),
  asynchronous init.

## Version pinning template

When the library is selected, update this README with:

```
- **Path:** molecule-renderer/<file>.js (and .wasm if applicable)
- **Version:** <semver>
- **Source URL:** <permalink to exact version>
- **SHA256:** <hash of every shipped file>
- **License:** <MIT | BSD-3-Clause | ...>
- **Selected on:** <YYYY-MM-DD>
- **Selected because:** <one-line rationale from Phase 4 prototype>
```

## Contract that the chosen library must satisfy

The vendored implementation MUST conform to the abstract interface in
`skill/lib/chemistry-renderer.ts` (see `data-model.md` §1.4):

```ts
interface MoleculeRenderer {
  render(
    smiles: string,
    container: HTMLElement,
    options?: { width?: number; height?: number }
  ): Promise<void>;
  readonly impl: 'kekule' | 'rdkit-js';
}
```

The render method MUST be idempotent on repeat calls and the implementation
MAY load its underlying library lazily (recommended, to keep `lesson.html`
small for non-medicine lessons).

## Inlining (FR-037)

Like every other vendor subdirectory, files placed here will be inlined into
`lesson.html` by `shell/build.sh` at Stage 5 — no CDN calls at view time.
WebAssembly assets (if RDKit-JS is chosen) will need a base64 inline-and-decode
shim, designed in Phase 4.

## Status

🚧 **Empty until Phase 4.** Do not download a library here speculatively.
