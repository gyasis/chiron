#!/usr/bin/env python3
"""GPU embedding service — ollama-compatible, PyTorch underneath.

WHY THIS EXISTS
---------------
ollama cannot run bge-m3 on this GPU. Its llama.cpp CUDA backend produces NaN
embeddings, and when that happens ollama SILENTLY FALLS BACK TO CPU — the API
keeps working, just 24x slower, while the log still claims "offloaded 25/25
layers to GPU". Measured on an RTX 2060:

    ollama   GPU -> NaN -> silent CPU fallback -> 0.65/sec -> 11.0 hours
    torch    GPU -> 0 NaNs                     -> 12.9/sec -> 28 minutes

Same card, same model. So the embedding path bypasses llama.cpp entirely.

WHY A SERVICE RATHER THAN A SCRIPT
----------------------------------
Embedder parity is the constraint that shapes this. A corpus embedded with one
model and queried with another produces meaningless similarity — silently, since
cosine still returns plausible numbers. GGUF and HF weights of the SAME model
differ enough to matter. One service therefore answers BOTH the corpus build
(build-library-vectors.mjs) and query time (/ask/embed), so the two cannot drift
apart by construction rather than by discipline.

It speaks ollama's /api/embed contract exactly, so nothing calling it needs to
know it changed.

    embed_server.py [--port 8913] [--model BAAI/bge-m3] [--device cuda]
                    [--idle-unload 600] [--preload]

    POST /api/embed  {"model": "...", "input": "..." | [...]}
                  -> {"embeddings": [[...]], "model": ..., "device": ...}
    POST /api/load   {"pin": true}  load now; a pinned model stays until /api/unload
    POST /api/unload               free the GPU now; the next call loads again
    GET  /healthz -> loaded, pinned, idle seconds, GPU MiB, device, dim, counters

WHY ON DEMAND
-------------
The GPU on this box is small and shared. The server starts without the model.
It loads the model on the first call (about 20 s cold). It unloads the model
after --idle-unload seconds without use, so other work can use the GPU. `chiron-embed on|off|status` (~/.local/bin) is the manual switch.
"""
import argparse, json, os, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=int(os.environ.get("CHIRON_EMBED_PORT", 8913)))
ap.add_argument("--model", default=os.environ.get("CHIRON_EMBED_MODEL", "BAAI/bge-m3"))
ap.add_argument("--device", default=os.environ.get("CHIRON_EMBED_DEVICE", "cuda"))
ap.add_argument("--batch", type=int, default=int(os.environ.get("CHIRON_EMBED_BATCH", 16)))
# fp16 is the useful precision step on this class of card. NOT fp8/fp4: those
# need Ada (SM89) / Blackwell tensor cores; on Turing they are emulated and end
# up SLOWER. int8 is Turing's real low-precision path if fp16 is ever not enough.
ap.add_argument("--dtype", default=os.environ.get("CHIRON_EMBED_DTYPE", "float16"),
                choices=["float32", "float16", "bfloat16"])
# The model sits in GPU memory only while it is in use. It loads on the first
# call (or POST /api/load) and unloads after this many idle seconds, so other
# work can use the GPU. 0 keeps it loaded. A pinned load ignores the timer.
ap.add_argument("--idle-unload", type=int, default=int(os.environ.get("CHIRON_EMBED_IDLE_UNLOAD", 600)))
ap.add_argument("--preload", action="store_true", help="load the model at startup (pinned)")
args = ap.parse_args()

import torch
from sentence_transformers import SentenceTransformer

if args.device == "cuda" and not torch.cuda.is_available():
    # Fail loudly rather than quietly running 24x slower — the silent CPU
    # fallback is the exact failure this service exists to avoid repeating.
    sys.stderr.write("cuda requested but torch.cuda.is_available() is False.\n"
                     "Refusing to fall back silently. Pass --device cpu to accept it.\n")
    sys.exit(2)

DT = {"float32": torch.float32, "float16": torch.float16, "bfloat16": torch.bfloat16}[args.dtype]
# fp16 vs fp32 changes a vector by ~1e-3, an order of magnitude BELOW the int8
# storage step (1/127 ~ 8e-3) the sidecar already applies. So vectors embedded
# at either precision stay mutually comparable — this is not a parity break.
MODEL = None
DIM = None
PINNED = False
LAST_USE = 0.0
LOAD_SECONDS = None
LOCK = threading.Lock()          # one GPU, one batch at a time; also guards load/unload


def _load_locked():
    """Load the model. Caller holds LOCK."""
    global MODEL, DIM, LOAD_SECONDS
    if MODEL is not None:
        return
    t0 = time.time()
    sys.stderr.write(f"loading {args.model} on {args.device} …\n")
    MODEL = SentenceTransformer(args.model, device=args.device,
                                model_kwargs={"torch_dtype": DT} if args.device == "cuda" else None)
    DIM = MODEL.get_sentence_embedding_dimension()
    LOAD_SECONDS = round(time.time() - t0, 1)
    sys.stderr.write(f"ready in {LOAD_SECONDS}s · dim={DIM} · batch={args.batch} · {args.dtype}\n")


def _unload_locked(reason):
    """Drop the model and return its GPU memory. Caller holds LOCK."""
    global MODEL, PINNED
    if MODEL is None:
        return False
    MODEL = None
    PINNED = False
    import gc
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    sys.stderr.write(f"unloaded ({reason})\n")
    return True


def _idle_watch():
    while True:
        time.sleep(30)
        if args.idle_unload <= 0:
            continue
        with LOCK:
            if MODEL is not None and not PINNED and time.time() - LAST_USE > args.idle_unload:
                _unload_locked(f"idle {args.idle_unload}s")


def _vram_mib():
    if not torch.cuda.is_available():
        return 0
    return round(torch.cuda.memory_reserved() / 2**20)

# E5-family models are trained with ASYMMETRIC prefixes and lose several points
# without them: a question must be prefixed "query: " and a document "passage: ".
# Omitting them does not error -- it just quietly retrieves worse, which would
# make a small model look worse than it is and corrupt an A/B comparison.
# BGE-family models do NOT want a passage prefix, so this is per-model.
E5 = "e5" in args.model.lower()
PREFIX = {"query": "query: ", "passage": "passage: "} if E5 else {"query": "", "passage": ""}
sys.stderr.write(f"prefixes: {'e5-style (query:/passage:)' if E5 else 'none (bge-style)'}\n")

# ── whole-corpus search, server-side ────────────────────────────────────────
# The browser searches a DOMAIN shard locally (fast, no round trip). It cannot
# do that for "Everything": that is 21.8 MB of vectors, too much to ship for one
# question — so that scope used to fall back to keyword search.
#
# That was the worst possible place for a fallback, because "Everything" is the
# DEFAULT. A first question like "give me 5 irregular verbs" returned clitic
# lessons and the model then said the irregular-verb lessons did not exist —
# they did, and dense retrieval ranks them 1-2-3-4-5. `irregular` simply is not
# the token `irregolari`.
#
# So the search moves to where the vectors already are. Nothing is shipped.
import glob as _glob
CORPUS_DIR = os.path.expanduser("~/Documents/generated/chiron-library")
SHARDS = {}                      # domain -> (ids, int8 matrix)

PASSAGES = {}                    # id -> {title, text, meta} for search results

def _load_shards():
    import numpy as np
    man_p = os.path.join(CORPUS_DIR, "library.corpus.vec.manifest.json")
    if not os.path.exists(man_p):
        return
    man = json.load(open(man_p))
    slug, dim = man.get("slug", ""), man["dim"]
    if man.get("model") != args.model:
        # Serving a query embedder that did not build these vectors would return
        # confident nonsense. Refuse the shortcut rather than mis-answer.
        sys.stderr.write(f"search DISABLED: sidecars built with {man.get('model')}, serving {args.model}\n")
        return
    for dom in man.get("domains", {}):
        b = os.path.join(CORPUS_DIR, f"library.corpus.vec.{slug}.{dom}.bin")
        i = os.path.join(CORPUS_DIR, f"library.corpus.vec.{slug}.{dom}.ids.json")
        if not (os.path.exists(b) and os.path.exists(i)):
            continue
        ids = json.load(open(i))
        m = np.fromfile(b, dtype=np.int8)
        if m.size != len(ids) * dim:
            sys.stderr.write(f"search: {dom} sidecar size mismatch, skipping\n")
            continue
        SHARDS[dom] = (ids, m.reshape(len(ids), dim).astype(np.float32) / 127.0)
    # Results carry their own text. The browser cannot resolve ids for the
    # whole corpus without downloading all 29 MB of it — which is the cost this
    # endpoint exists to avoid.
    cp = os.path.join(CORPUS_DIR, "library.corpus.json")
    if os.path.exists(cp):
        for p in json.load(open(cp)):
            PASSAGES[p["id"]] = {"title": p.get("title", ""), "text": p.get("text", ""),
                                 "meta": p.get("meta", {})}
    if SHARDS:
        sys.stderr.write(f"search ready: {sum(len(v[0]) for v in SHARDS.values()):,} vectors "
                         f"across {len(SHARDS)} domains · {len(PASSAGES):,} passages\n")

STATS = {"requests": 0, "vectors": 0, "nan_rejected": 0, "loads": 0}


def embed(texts, kind="passage"):
    global LAST_USE
    pre = PREFIX.get(kind, "")
    if pre:
        texts = [pre + t for t in texts]
    with LOCK:
        if MODEL is None:
            _load_locked()
            STATS["loads"] += 1
        v = MODEL.encode(texts, batch_size=args.batch,
                         normalize_embeddings=True, show_progress_bar=False)
        LAST_USE = time.time()
    out = v.tolist()
    # NaN is exactly how the ollama path failed. Catch it here rather than
    # letting a poisoned vector reach the corpus, where it would silently
    # corrupt every similarity it takes part in.
    bad = [i for i, row in enumerate(out) if any(x != x for x in row)]
    if bad:
        STATS["nan_rejected"] += len(bad)
        raise ValueError(f"model produced NaN for {len(bad)} of {len(out)} inputs")
    STATS["requests"] += 1
    STATS["vectors"] += len(out)
    return out


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/healthz"):
            return self._send(200, self._state())
        self._send(404, {"error": "not found"})

    def _state(self):
        loaded = MODEL is not None
        return {
            "ok": True, "model": args.model, "dim": DIM, "device": args.device, "dtype": args.dtype,
            "loaded": loaded, "pinned": PINNED,
            "idle_s": round(time.time() - LAST_USE) if loaded and LAST_USE else None,
            "idle_unload_s": args.idle_unload, "load_seconds": LOAD_SECONDS,
            "cuda_in_use": loaded and args.device == "cuda" and torch.cuda.is_available(),
            "prefixes": PREFIX,
            "search_domains": {d: len(v[0]) for d, v in SHARDS.items()},
            "vram_mib": _vram_mib(),
            **STATS,
        }

    def do_POST(self):
        global PINNED, LAST_USE
        if self.path.startswith("/api/load"):
            # The "on" button: load now and keep it loaded until /api/unload.
            try:
                n = int(self.headers.get("content-length", 0))
                req = json.loads(self.rfile.read(n) or b"{}")
                with LOCK:
                    if MODEL is None:
                        _load_locked()
                        STATS["loads"] += 1
                    PINNED = bool(req.get("pin", True))
                    LAST_USE = time.time()
                return self._send(200, self._state())
            except Exception as e:
                return self._send(500, {"error": f"{type(e).__name__}: {e}"})
        if self.path.startswith("/api/unload"):
            # The "off" button: free the GPU now. The next call loads it again.
            with LOCK:
                _unload_locked("requested")
            return self._send(200, self._state())
        if self.path.startswith("/api/search"):
            try:
                import numpy as np
                n = int(self.headers.get("content-length", 0))
                req = json.loads(self.rfile.read(n) or b"{}")
                q = (req.get("query") or "").strip()
                if not q:
                    return self._send(400, {"error": "no query"})
                if not SHARDS:
                    return self._send(503, {"error": "no vector shards loaded"})
                scope = req.get("scope") or "all"
                k = int(req.get("k", 8))
                # A FOCUS narrows the search to specific lessons — how "go deeper"
                # is implemented. It is derived from what an answer actually cited,
                # so it works regardless of how a lesson was labelled; the subject
                # facet cannot carry this (242 of 338 lessons are "General").
                focus = set(req.get("lessons") or [])
                doms = list(SHARDS) if scope == "all" else [scope]
                doms = [d for d in doms if d in SHARDS]
                if not doms:
                    return self._send(404, {"error": f"no vectors for scope {scope}"})
                qv = np.asarray(embed([q], "query")[0], dtype=np.float32)
                hits = []
                for d in doms:
                    ids, mat = SHARDS[d]
                    sims = mat @ qv           # vectors are L2-normalised -> cosine
                    if focus:
                        # Score everything, then mask. Masking by -inf keeps the
                        # row indices aligned with `ids`, which slicing would not.
                        keep = np.fromiter(
                            (PASSAGES.get(i, {}).get("meta", {}).get("lessonId") in focus for i in ids),
                            dtype=bool, count=len(ids))
                        if not keep.any():
                            continue
                        sims = np.where(keep, sims, -np.inf)
                    n = int(min(k, max(1, (sims > -np.inf).sum())))
                    top = np.argpartition(-sims, min(n, len(ids) - 1))[:n]
                    for i in top:
                        if sims[int(i)] == -np.inf:
                            continue
                        pid = ids[int(i)]
                        rec = PASSAGES.get(pid, {})
                        hits.append({"id": pid, "score": float(sims[int(i)]), "domain": d,
                                     "title": rec.get("title", ""), "text": rec.get("text", ""),
                                     "meta": rec.get("meta", {})})
                hits.sort(key=lambda h: -h["score"])
                return self._send(200, {"hits": hits[:k], "scope": scope, "searched": doms,
                                        "focused": sorted(focus) if focus else None})
            except Exception as e:
                return self._send(500, {"error": f"{type(e).__name__}: {e}"})
        if not self.path.startswith("/api/embed"):
            return self._send(404, {"error": "not found"})
        try:
            n = int(self.headers.get("content-length", 0))
            req = json.loads(self.rfile.read(n) or b"{}")
            texts = req.get("input")
            if isinstance(texts, str):
                texts = [texts]
            if not texts:
                return self._send(400, {"error": "no input"})
            # input_type lets the caller say whether this is a question or a
            # document. Defaults to "passage" -- the corpus build is the bulk of
            # the traffic; /ask/embed passes "query".
            kind = req.get("input_type", "passage")
            return self._send(200, {"embeddings": embed(texts, kind),
                                    "model": args.model, "device": args.device,
                                    "input_type": kind})
        except ValueError as e:
            self._send(500, {"error": str(e)})
        except Exception as e:
            self._send(500, {"error": f"{type(e).__name__}: {e}"})

    def log_message(self, *a):
        pass                      # the access log is noise; /healthz has the counters


try:
    _load_shards()
except Exception as e:
    sys.stderr.write(f"search unavailable ({type(e).__name__}: {e}) — /api/embed still works\n")

if args.preload:
    with LOCK:
        _load_locked()
        STATS["loads"] += 1
        PINNED = True
threading.Thread(target=_idle_watch, daemon=True).start()

srv = ThreadingHTTPServer(("127.0.0.1", args.port), H)
sys.stderr.write(f"listening on http://127.0.0.1:{args.port}  (POST /api/embed /api/search /api/load "
                 f"/api/unload, GET /healthz) · model {'loaded' if MODEL is not None else 'loads on demand'}"
                 f" · idle unload {args.idle_unload}s\n")
srv.serve_forever()
