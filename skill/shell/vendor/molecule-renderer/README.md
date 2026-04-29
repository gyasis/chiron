# Molecule Renderer

This directory holds the concrete 2D molecule rendering library used by the
`molecule-2d` widget (per `contracts/widget-spec.ts`). The v1 selection
follows R-02 / FR-031 Phase 5 prototype rubric.

## v1 default: RDKit-JS

**Selected on:** 2026-04-29 (T080 / Phase 5 structural commitment)
**Selected because:** smaller minified bundle than Kekule.js (~3 MB vs ~5 MB),
cleaner SMILES API (`get_mol(smiles)` + `mol.get_svg(w, h)` returns SVG string
directly), and Kekule's richer drawing controls aren't needed for v1 (chemical
equations use mhchem; molecule rendering is just for clarity).

Kekule.js was the alternate candidate and is dropped in v1. If a future
constraint (e.g. WASM-free build, reaction-arrow rendering) flips the
trade-off, swap the concrete class behind `getMoleculeRenderer()` in
`skill/lib/chemistry-renderer.ts`. The interface stays stable.

## Pinned version

- **Package:** `@rdkit/rdkit`
- **Version:** `2024.03.5-1.0.0` (pin to a known-stable release; bump only
  with a Phase-5 re-prototype)
- **Source URL:** https://unpkg.com/@rdkit/rdkit@2024.03.5-1.0.0/dist/RDKit_minimal.js
- **Companion WASM:** `RDKit_minimal.wasm` (same directory on unpkg)
- **License:** BSD-3-Clause
- **Path at runtime:** `vendor/molecule-renderer/RDKit_minimal.js` (+ `.wasm`)

The actual `.js` / `.wasm` files are **not committed** to the repo by default
— they are downloaded by the build step. If a project wants a fully offline
clone, they can commit the files locally and `.gitignore` is overridden.

## Setup script (suggested)

Create `install.sh` in this directory:

```bash
#!/usr/bin/env bash
# install.sh — fetch pinned RDKit-JS into this vendor dir.
set -euo pipefail
VERSION="2024.03.5-1.0.0"
BASE="https://unpkg.com/@rdkit/rdkit@${VERSION}/dist"
HERE="$(cd "$(dirname "$0")" && pwd)"
curl -fsSL "${BASE}/RDKit_minimal.js"   -o "${HERE}/RDKit_minimal.js"
curl -fsSL "${BASE}/RDKit_minimal.wasm" -o "${HERE}/RDKit_minimal.wasm"
echo "RDKit-JS ${VERSION} vendored into ${HERE}"
```

If the files are missing at runtime, `RdkitMoleculeRenderer.render()` falls
back to a polite "Molecule rendering library not vendored — run
skill/shell/vendor/molecule-renderer/install.sh" message in the container.

## Contract

The vendored implementation MUST satisfy the abstract interface in
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

`render()` is idempotent — repeat calls reuse the loaded WASM module via the
internal singleton.

## Inlining (FR-037)

Files placed here are inlined into `lesson.html` by `shell/build.sh` at
Stage 5 — no CDN calls at view time. The `.wasm` asset needs a base64
inline-and-decode shim (designed alongside Stage-5 inliner work).

## Status

v1 structural commitment landed (T080). Vendor files are not yet downloaded
in this checkout — `install.sh` is the deferred step before US3 ships.
