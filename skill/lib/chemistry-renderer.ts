// FR-031: abstract MoleculeRenderer interface; concrete impl (Kekule.js or RDKit-JS) deferred to US3 Phase 5.

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

export function getMoleculeRenderer(): MoleculeRenderer {
  throw new Error(
    'getMoleculeRenderer: concrete MoleculeRenderer impl deferred to US3 Phase 5 (FR-031). Pick Kekule.js or RDKit-JS during prototype phase, then wire here.',
  );
}
