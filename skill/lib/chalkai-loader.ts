// v1 stub for ChalkAI lazy loader — PRD §3 #11 (reactive-math widgets); real CDN/vendor wiring deferred.

export interface ReactiveMathSpec {
  type: 'reactive-math';
  id?: string;
  expression?: string;
  variables?: Record<string, number>;
  [key: string]: unknown;
}

export interface ChalkAIRuntime {
  mount(container: HTMLElement, spec: ReactiveMathSpec): void;
  unmount(container: HTMLElement): void;
}

let cachedRuntime: ChalkAIRuntime | null = null;
let pendingLoad: Promise<ChalkAIRuntime> | null = null;

function createStubRuntime(): ChalkAIRuntime {
  const mounted = new WeakMap<HTMLElement, HTMLElement>();
  return {
    mount(container: HTMLElement, spec: ReactiveMathSpec): void {
      const stub = container.ownerDocument.createElement('div');
      stub.className = 'chalkai-stub';
      const idLabel = spec.id ? ` (spec id: ${spec.id})` : '';
      stub.textContent = `[reactive-math placeholder — ChalkAI not yet wired in v1]${idLabel}`;
      container.appendChild(stub);
      mounted.set(container, stub);
    },
    unmount(container: HTMLElement): void {
      const node = mounted.get(container);
      if (node && node.parentNode === container) {
        container.removeChild(node);
      }
      mounted.delete(container);
    },
  };
}

export function loadChalkAI(): Promise<ChalkAIRuntime> {
  if (cachedRuntime) return Promise.resolve(cachedRuntime);
  if (pendingLoad) return pendingLoad;
  pendingLoad = (async () => {
    try {
      // v1: no real CDN/vendor import. Future: dynamic import of ChalkAI bundle here.
      const runtime = createStubRuntime();
      cachedRuntime = runtime;
      return runtime;
    } catch (e) {
      pendingLoad = null; // T177: clear cached rejection so retry is possible
      throw e;
    }
  })();
  return pendingLoad;
}

export function hasReactiveMathWidget(widgets: Array<{ type: string }>): boolean {
  return Array.isArray(widgets) && widgets.some((w) => w && w.type === 'reactive-math');
}
