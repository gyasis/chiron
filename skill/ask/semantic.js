/*
 * Chiron semantic retrieval — the dense half of the hybrid.
 *
 * BM25 cannot match "shortness of breath" to "dispnea"; they share no tokens.
 * This adds a cosine channel over the precomputed vector sidecar so the two
 * can be fused.
 *
 * IT DOES NOT IMPLEMENT FUSION. Acolyte already fuses a pre-scored plugin
 * source with its own BM25 hits using Reciprocal Rank Fusion at K=60
 * (widget.ts buildContextBlock) — the same algorithm paperlake uses. A source
 * whose sections all carry `meta.score` is treated as pre-ranked and trusted,
 * rather than being re-ranked lexically. So this file's whole job is: embed the
 * query, dot-product it against the shard, and hand back scored passages.
 *
 * DEGRADES, NEVER BREAKS. If the sidecar is missing, the manifest's model does
 * not match the query embedder, or the embed endpoint is down, fetch() returns
 * [] and the page runs on BM25 alone — which is exactly the state it shipped in.
 */

// The manifest is a POINTER: it names which model the page serves. Sidecars are
// model-scoped, so a better embedder can be built alongside the live one and
// only becomes active when its eval justifies the switch — never because it
// happened to finish last.
const MANIFEST = '/library/library.corpus.vec.manifest.json';
const VEC = (slug, dom) => `/library/library.corpus.vec.${slug}.${dom}.bin`;
const IDS = (slug, dom) => `/library/library.corpus.vec.${slug}.${dom}.ids.json`;

/* Below this fraction of a shard embedded, the semantic channel STAYS SILENT.
 * Measured the hard way: with 24 of 229 passages vectorised, fusion scored 0%
 * where dense alone scored 25% — three passages that happened to appear in both
 * top-6 lists accumulated ~0.032 under RRF and outranked the correct answer
 * sitting at 0.0156 from a single list. Reciprocal Rank Fusion rewards
 * AGREEMENT, so a channel that can only see part of the corpus does not merely
 * contribute less, it actively displaces the other channel's good hits. Partial
 * coverage is worse than no coverage. */
const MIN_COVERAGE = 0.95;

export function createSemanticSource({ scope, corpusById, embedUrl, topK = 8, focus = () => null }) {
  let loaded = null;      // { dom, dim, rows, ids, q }  — q is the Int8Array block
  let manifest = null;
  let disabled = false;   // set once we know this scope can never work
  const state = { status: 'idle', detail: '' };

  async function loadManifest() {
    if (manifest !== null) return manifest;
    try {
      const r = await fetch(MANIFEST);
      manifest = r.ok ? await r.json() : false;
    } catch { manifest = false; }
    return manifest;
  }

  async function load(dom) {
    if (loaded && loaded.dom === dom) return loaded;
    const m = await loadManifest();
    if (!m || !m.domains?.[dom]) {
      state.status = 'no-vectors';
      state.detail = `no sidecar for ${dom}`;
      return null;
    }
    const slug = m.slug || '';
    const [binRes, idsRes] = await Promise.all([fetch(VEC(slug, dom)), fetch(IDS(slug, dom))]);
    if (!binRes.ok || !idsRes.ok) { state.status = 'no-vectors'; return null; }
    const buf = new Int8Array(await binRes.arrayBuffer());
    const ids = await idsRes.json();
    const dim = m.dim;
    if (buf.length !== ids.length * dim) {
      // A truncated or half-written sidecar would silently mis-align every row
      // with the wrong passage — worse than having no vectors at all.
      state.status = 'corrupt';
      state.detail = `${buf.length} bytes ≠ ${ids.length} × ${dim}`;
      return null;
    }
    const cov = m.domains[dom].rows / m.domains[dom].of;
    if (cov < MIN_COVERAGE) {
      state.status = 'partial-coverage';
      state.detail = `${m.domains[dom].rows}/${m.domains[dom].of} embedded `
        + `(${(cov * 100).toFixed(0)}%) — staying silent; partial fusion is worse than none`;
      return null;
    }
    loaded = { dom, dim, rows: ids.length, ids, q: buf };
    state.status = 'ready';
    state.detail = `${ids.length} vectors · ${m.model} · ${dim}d`;
    return loaded;
  }

  /** Embed the query with the SAME model the corpus was built with. A mismatch
   *  is not a degradation, it is nonsense: the two vector spaces do not align,
   *  so similarity becomes noise. Refuse rather than return garbage. */
  async function embedQuery(text, model) {
    const r = await fetch(embedUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, input: [text] }),
    });
    if (!r.ok) throw new Error(`embed ${r.status}`);
    const d = await r.json();
    const v = (d.embeddings || [])[0];
    if (!v) throw new Error('no embedding returned');
    let n = 0;
    for (const x of v) n += x * x;
    n = Math.sqrt(n) || 1;
    return Float32Array.from(v, x => x / n);
  }

  async function fetchSections({ query }) {
    if (disabled || !query || query.length < 3) return [];
    const dom = scope();
    if (dom === 'all') {
      // "Everything" cannot search locally — 21.8 MB of vectors is too much to
      // ship for one question. It used to fall back to keyword search, which is
      // the worst place for a fallback because it is the DEFAULT scope: asking
      // "give me 5 irregular verbs" returned clitic lessons, and the model then
      // stated the irregular-verb lessons did not exist. They did — dense ranks
      // them 1 through 5. `irregular` is just not the token `irregolari`.
      // So the search happens where the vectors already are. Nothing is shipped.
      try {
        const r = await fetch('/ask/search', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query, scope: 'all', k: topK, lessons: focus()?.lessons || null }),
        });
        if (!r.ok) throw new Error(`search ${r.status}`);
        const { hits } = await r.json();
        const f = focus();
        state.status = 'ready';
        state.detail = f ? `${f.lessons.length} lesson${f.lessons.length === 1 ? '' : 's'} · server-side`
                         : 'whole corpus · server-side';
        // The server sends the text with the hit — the client has no corpus
        // loaded for 'all', and downloading 29 MB to resolve ids would defeat
        // the point of searching server-side in the first place.
        return hits.filter(h => h.text).map(h => ({
          id: h.id, title: h.title, text: h.text, meta: { ...(h.meta || {}), score: h.score },
        }));
      } catch (e) {
        state.status = 'search-down'; state.detail = String(e.message || e);
        return [];                      // BM25 carries it
      }
    }
    const L = await load(dom);
    if (!L) return [];

    let qv;
    try {
      qv = await embedQuery(query, manifest.model);
    } catch (e) {
      state.status = 'embedder-down';
      state.detail = String(e.message || e);
      return [];                       // BM25 carries the answer instead
    }
    if (qv.length !== L.dim) {
      state.status = 'dim-mismatch';
      state.detail = `query ${qv.length}d vs corpus ${L.dim}d — embedder parity broken`;
      disabled = true;
      return [];
    }

    // Brute force. At ~21k vectors this is tens of milliseconds and needs no
    // ANN index; an index would add a dependency and a build step to save time
    // nobody can perceive.
    const { q, dim, rows, ids } = L;
    // A focus restricts the search to specific lessons. Ids are
    // "<lessonId>#<section>", so membership is a prefix test — no second index.
    const f = focus();
    const keep = f ? new Set(f.lessons) : null;
    const inFocus = i => !keep || keep.has(String(ids[i]).split('#')[0]);
    const best = [];
    for (let i = 0; i < rows; i++) {
      if (!inFocus(i)) continue;
      let dot = 0;
      const off = i * dim;
      for (let d = 0; d < dim; d++) dot += qv[d] * q[off + d];
      dot /= 127;                      // int8 was stored as round(v * 127)
      if (best.length < topK) {
        best.push({ i, dot });
        if (best.length === topK) best.sort((a, b) => a.dot - b.dot);
      } else if (dot > best[0].dot) {
        best[0] = { i, dot };
        best.sort((a, b) => a.dot - b.dot);
      }
    }
    best.sort((a, b) => b.dot - a.dot);

    state.status = 'ready';
    if (f) state.detail = `${f.lessons.length} lesson${f.lessons.length === 1 ? '' : 's'}`;
    return best.map(({ i, dot }) => {
      const p = corpusById(ids[i]);
      if (!p) return null;
      return {
        id: p.id,
        title: p.title,
        text: p.text,
        // `score` is what marks this source pre-ranked, so acolyte trusts the
        // cosine instead of re-running BM25 over it.
        meta: { ...p.meta, score: dot },
      };
    }).filter(Boolean);
  }

  /** Is the dense channel actually usable for this scope? The host uses this to
   *  decide whether to run dense-ONLY or fall back to BM25. Measured on 29
   *  questions: dense 41.4% vs hybrid 31.0% vs bm25 20.7% — fusing a strong
   *  channel with a weaker one DRAGS IT DOWN, because RRF rewards agreement.
   *  So when dense is healthy it should answer alone, not be blended. */
  async function ready(dom) {
    if (dom === 'all') {
      // Ready when the SERVER can search — the browser holds nothing for this
      // scope. Probing health is cheap and avoids claiming dense is live when
      // the service is down.
      try {
        const r = await fetch('/ask/search', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: 'probe', scope: 'all', k: 1 }),
        });
        if (r.ok) { state.status = 'ready'; state.detail = 'whole corpus · server-side'; return true; }
      } catch { /* fall through */ }
      state.status = 'search-down';
      return false;
    }
    return !!(await load(dom));
  }

  return {
    status: () => ({ ...state }),
    ready,
    plugin: {
      name: 'chiron-semantic',
      version: '1.0.0',
      ragSources: [{
        name: 'Your lessons (semantic)',
        perQuery: true,
        fetch: fetchSections,
        pageUrl: s => s.meta?.href,
      }],
    },
  };
}
