// FR-031: abstract MoleculeRenderer interface + concrete RDKit-JS impl.
// v1 default: RDKit-JS (selected per R-02 / Phase 5 rubric: smaller bundle than Kekule.js, simpler API surface).
// Vendor file expected at skill/shell/vendor/molecule-renderer/RDKit_minimal.js — vendor README documents which version is pinned.

export interface MoleculeRenderer {
  render(
    smiles: string,
    container: HTMLElement,
    options?: { width?: number; height?: number },
  ): Promise<void>;
  readonly impl: 'kekule' | 'rdkit-js';
}

interface MathJaxGlobal {
  tex2chtmlPromise?: (input: string) => Promise<HTMLElement>;
  typesetPromise?: (elements?: HTMLElement[]) => Promise<void>;
  typeset?: (elements?: HTMLElement[]) => void;
}

interface RDKitMol {
  get_svg(width?: number, height?: number): string;
  delete(): void;
}

interface RDKitModule {
  get_mol(smiles: string): RDKitMol;
}

interface RDKitGlobal {
  RDKit?: RDKitModule;
  initRDKitModule?: () => Promise<RDKitModule>;
}

declare global {
  // eslint-disable-next-line no-var
  var MathJax: MathJaxGlobal | undefined;
}

export function renderChemicalReaction(equation: string, container: HTMLElement): void {
  const trimmed = equation.trim();
  const wrapped =
    trimmed.startsWith('\\(') || trimmed.startsWith('$') || trimmed.startsWith('\\[')
      ? trimmed
      : `\\(\\ce{${trimmed.replace(/^\\ce\{/, '').replace(/\}$/, '')}}\\)`;

  container.textContent = wrapped;

  const mj = globalThis.MathJax;
  if (!mj) {
    throw new Error(
      'renderChemicalReaction: global MathJax not found. Ensure vendored skill/shell/vendor/mathjax/tex-mml-chtml.js and mhchem.js are loaded before this call.',
    );
  }
  if (typeof mj.typesetPromise === 'function') {
    void mj.typesetPromise([container]);
  } else if (typeof mj.typeset === 'function') {
    mj.typeset([container]);
  } else {
    throw new Error('renderChemicalReaction: MathJax present but neither typesetPromise nor typeset is available.');
  }
}

/**
 * T165 — Strip active content from RDKit-produced SVG before DOM injection.
 *
 * RDKit's `get_svg` output is normally inert, but the SMILES that produced it is
 * learner/LLM-supplied, so we defend in depth: parse the SVG and remove
 * `<script>` elements, any `on*` event-handler attributes, and `javascript:`
 * URLs on `href`/`xlink:href`. If a DOM parser is unavailable (non-browser) or
 * the SVG fails to parse, fall back to HTML-escaping so nothing can execute.
 */
function sanitizeSvg(svg: string): string {
  const escape = (s: string): string =>
    s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!);

  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    return escape(svg);
  }

  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) return escape(svg);

  const root = parsed.documentElement;
  for (const el of Array.from(root.querySelectorAll('script'))) el.remove();
  const elements = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of elements) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
      } else if (name.endsWith('href') && /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return new XMLSerializer().serializeToString(root);
}

// v1 default: RDKit-JS chosen over Kekule.js — smaller minified bundle (~3MB vs ~5MB), cleaner SMILES API (get_mol/get_svg).
class RdkitMoleculeRenderer implements MoleculeRenderer {
  readonly impl = 'rdkit-js' as const;
  private _module: RDKitModule | null = null;
  private _loadPromise: Promise<RDKitModule | null> | null = null;

  private async _ensureLoaded(): Promise<RDKitModule | null> {
    if (this._module) return this._module;
    if (this._loadPromise) return this._loadPromise;

    this._loadPromise = (async () => {
      const w = globalThis as unknown as RDKitGlobal & { document?: Document };

      if (w.RDKit) {
        this._module = w.RDKit;
        return this._module;
      }

      // Lazy-load via script tag injection (works in browser + inlined-vendor build).
      if (typeof w.document !== 'undefined') {
        await new Promise<void>((resolve, reject) => {
          const doc = w.document!;
          const existing = doc.querySelector('script[data-chiron-rdkit]') as HTMLScriptElement | null;
          if (existing) {
            existing.addEventListener('load', () => resolve());
            existing.addEventListener('error', () => reject(new Error('RDKit script failed to load')));
            return;
          }
          const script = doc.createElement('script');
          script.src = 'vendor/molecule-renderer/RDKit_minimal.js';
          script.setAttribute('data-chiron-rdkit', '1');
          script.addEventListener('load', () => resolve());
          script.addEventListener('error', () => reject(new Error('RDKit script failed to load')));
          doc.head.appendChild(script);
        }).catch(() => {
          /* swallow; handled by null-check below */
        });

        if (w.initRDKitModule) {
          try {
            this._module = await w.initRDKitModule();
            w.RDKit = this._module;
          } catch {
            this._module = null;
          }
        } else if (w.RDKit) {
          this._module = w.RDKit;
        }
      }

      return this._module;
    })();

    return this._loadPromise;
  }

  async render(
    smiles: string,
    container: HTMLElement,
    options?: { width?: number; height?: number },
  ): Promise<void> {
    const mod = await this._ensureLoaded();
    if (!mod) {
      container.innerHTML =
        '<div class="chiron-molecule-fallback" style="padding:1em;border:1px dashed #999;color:#666;font-family:sans-serif;">' +
        'Molecule rendering library not vendored — run skill/shell/vendor/molecule-renderer/install.sh' +
        `<br><small>SMILES: <code>${smiles.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!)}</code></small>` +
        '</div>';
      return;
    }
    let mol: RDKitMol | null = null;
    try {
      mol = mod.get_mol(smiles);
    } catch {
      mol = null;
    }
    if (!mol) {
      container.textContent = `[invalid SMILES: ${smiles}]`;
      return;
    }
    try {
      const svg = mol.get_svg(options?.width ?? 300, options?.height ?? 200);
      container.innerHTML = sanitizeSvg(svg); // T165: strip <script>/on*/javascript: before injection
    } finally {
      mol.delete?.();
    }
  }
}

let _singleton: RdkitMoleculeRenderer | null = null;

export function getMoleculeRenderer(): MoleculeRenderer {
  if (!_singleton) _singleton = new RdkitMoleculeRenderer();
  return _singleton;
}
