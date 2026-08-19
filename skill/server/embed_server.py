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

    POST /api/embed  {"model": "...", "input": "..." | [...]}
                  -> {"embeddings": [[...]], "model": ..., "device": ...}
    GET  /healthz -> readiness, device, dim, and whether CUDA is really in use
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
args = ap.parse_args()

import torch
from sentence_transformers import SentenceTransformer

if args.device == "cuda" and not torch.cuda.is_available():
    # Fail loudly rather than quietly running 24x slower — the silent CPU
    # fallback is the exact failure this service exists to avoid repeating.
    sys.stderr.write("cuda requested but torch.cuda.is_available() is False.\n"
                     "Refusing to fall back silently. Pass --device cpu to accept it.\n")
    sys.exit(2)

t0 = time.time()
sys.stderr.write(f"loading {args.model} on {args.device} …\n")
DT = {"float32": torch.float32, "float16": torch.float16, "bfloat16": torch.bfloat16}[args.dtype]
# fp16 vs fp32 changes a vector by ~1e-3, an order of magnitude BELOW the int8
# storage step (1/127 ~ 8e-3) the sidecar already applies. So vectors embedded
# at either precision stay mutually comparable — this is not a parity break.
MODEL = SentenceTransformer(args.model, device=args.device,
                            model_kwargs={"torch_dtype": DT} if args.device == "cuda" else None)
DIM = MODEL.get_sentence_embedding_dimension()
sys.stderr.write(f"ready in {time.time()-t0:.0f}s · dim={DIM} · batch={args.batch} · {args.dtype}\n")

# E5-family models are trained with ASYMMETRIC prefixes and lose several points
# without them: a question must be prefixed "query: " and a document "passage: ".
# Omitting them does not error -- it just quietly retrieves worse, which would
# make a small model look worse than it is and corrupt an A/B comparison.
# BGE-family models do NOT want a passage prefix, so this is per-model.
E5 = "e5" in args.model.lower()
PREFIX = {"query": "query: ", "passage": "passage: "} if E5 else {"query": "", "passage": ""}
sys.stderr.write(f"prefixes: {'e5-style (query:/passage:)' if E5 else 'none (bge-style)'}\n")

LOCK = threading.Lock()          # one GPU, one batch at a time
STATS = {"requests": 0, "vectors": 0, "nan_rejected": 0}


def embed(texts, kind="passage"):
    pre = PREFIX.get(kind, "")
    if pre:
        texts = [pre + t for t in texts]
    with LOCK:
        v = MODEL.encode(texts, batch_size=args.batch,
                         normalize_embeddings=True, show_progress_bar=False)
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
            return self._send(200, {
                "ok": True, "model": args.model, "dim": DIM, "device": args.device, "dtype": args.dtype,
                "cuda_in_use": args.device == "cuda" and torch.cuda.is_available(),
                "prefixes": PREFIX,
                "vram_mib": round(torch.cuda.max_memory_allocated() / 2**20) if torch.cuda.is_available() else 0,
                **STATS,
            })
        self._send(404, {"error": "not found"})

    def do_POST(self):
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


srv = ThreadingHTTPServer(("127.0.0.1", args.port), H)
sys.stderr.write(f"listening on http://127.0.0.1:{args.port}  (POST /api/embed, GET /healthz)\n")
srv.serve_forever()
