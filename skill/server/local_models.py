"""Live discovery of the chat-capable LOCAL models on the Mac Studio (Atelier governor).

    GET  {GOVERNOR}/api/tags  -> every tag the Mac can serve
    POST {GOVERNOR}/api/show  -> per-tag `capabilities` (never inferred from the name — R-TM1)

Used by the tutor (tutor_chain.MODELS) and the mock oral (mock_oral.EXAMINERS) so the picker follows
what the Mac really has instead of a list frozen at build time.

- Cached CACHE_TTL seconds; a failed discovery is cached NEG_TTL seconds (the governor being down must
  not add a connect timeout to every request) and falls back to FALLBACK, the entries that used to be static.
- Bounded: at most MAX_MODELS tags are probed, at most WORKERS /api/show calls in flight.
- Excluded: embedding-only / non-completion models, `*cloud` proxy tags (not local), OCR models.
- Ids are stable: `local:<ollama tag>`, e.g. `local:gemma4:12b`.
- Thinking models: thinking_off(tag) tells the caller whether to send "think": false. Unknown capabilities
  (show failed) -> False: the flag is only sent when the server said the model thinks (a non-thinking
  model rejects it), and the gap is logged with the model id.
"""
from __future__ import annotations
import json, os, re, sys, threading, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

GOVERNOR = os.environ.get("ATELIER_GOVERNOR", "http://192.168.0.159:8799/llm/ollama")
CACHE_TTL = 600
NEG_TTL = 60
MAX_MODELS = 80
WORKERS = 4
TAGS_TIMEOUT = 4
SHOW_TIMEOUT = 8
GROUP = "Mac (local)"

# What the picker offered before discovery existed — used only when the governor is unreachable.
FALLBACK = [
    {"id": "local:qwen3:32b", "model": "qwen3:32b", "label": "Qwen3 32B · Mac (local)", "caps": []},
    {"id": "local:gemma3:27b", "model": "gemma3:27b", "label": "Gemma3 27B · Mac (local)", "caps": []},
]
# Ids the picker used before discovery; a saved selection keeps working.
LEGACY_IDS = {"qwen_local": "local:qwen3:32b", "gemma_local": "local:gemma3:27b"}

_lock = threading.Lock()
_state = {"at": 0.0, "ttl": 0.0, "models": None, "source": "none", "error": None}
_caps: dict = {}          # tag -> capabilities; rebuilt on each discovery, so bounded by MAX_MODELS


def _log(msg: str) -> None:
    sys.stderr.write(f"[local_models] {msg}\n")
    sys.stderr.flush()


def _http(path: str, body, timeout: float) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(GOVERNOR + path, data=data, headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read())


def label_for(tag: str) -> str:
    """'gemma4:12b' -> 'Gemma 4 12B · Mac (local)'; hf tags keep the quant: '... 27B · UD-Q4_K_XL · Mac (local)'."""
    base = tag.rsplit("/", 1)[-1]
    name, _, ver = base.partition(":")
    name = re.sub(r"-?gguf$", "", name, flags=re.I)
    name = re.sub(r"(?<=[A-Za-z])(?=\d)", " ", name.replace("-", " "))
    words = [w.upper() if re.fullmatch(r"\d+[bm]", w, re.I) else (w if w[:1].isdigit() else w[:1].upper() + w[1:])
             for w in name.split()]
    out = " ".join(words)
    if ver and ver != "latest":
        out += " · " + ver if tag.startswith("hf.co/") else " " + (ver.upper() if re.fullmatch(r"\d+(\.\d+)?[bm]", ver, re.I) else ver)
    return f"{out} · {GROUP}"


def is_chat_model(tag: str, caps: list) -> bool:
    t = tag.lower()
    if "completion" not in caps or "embedding" in caps:
        return False
    return not (t.endswith("cloud") or "-cloud" in t or ":cloud" in t or "ocr" in t)


def _discover() -> list:
    tags = [m["name"] for m in _http("/api/tags", None, TAGS_TIMEOUT).get("models", [])][:MAX_MODELS]

    def show(tag):
        try:
            return tag, _http("/api/show", {"model": tag}, SHOW_TIMEOUT).get("capabilities") or []
        except Exception as e:
            _log(f"/api/show failed for {tag}: {type(e).__name__}: {e}")
            return tag, None

    out, caps_map = [], {}
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for tag, caps in ex.map(show, tags):
            if caps is None:
                continue                      # capabilities unknown -> do not guess it is chat-capable
            caps_map[tag] = caps
            if is_chat_model(tag, caps):
                out.append({"id": "local:" + tag, "model": tag, "label": label_for(tag), "caps": caps})
    if not out:
        raise RuntimeError("governor returned no chat-capable models")
    _caps.clear()
    _caps.update(caps_map)
    out.sort(key=lambda m: m["label"].lower())
    return out


def models(force: bool = False) -> list:
    """Chat-capable local models (cached). Never raises: falls back to FALLBACK and records why."""
    with _lock:
        now = time.time()
        if not force and _state["models"] is not None and now - _state["at"] < _state["ttl"]:
            return _state["models"]
        try:
            _state.update(models=_discover(), source="governor", error=None, ttl=CACHE_TTL)
        except Exception as e:
            msg = f"{type(e).__name__}: {e}"
            _log(f"discovery failed ({GOVERNOR}) — using static fallback: {msg}")
            _state.update(models=list(FALLBACK), source="fallback", error=msg, ttl=NEG_TTL)
        _state["at"] = now
        return _state["models"]


def info() -> dict:
    """Machine-readable discovery state — for /tutor-models and /api/oral/status."""
    ms = models()
    return {"source": _state["source"], "error": _state["error"], "governor": GOVERNOR,
            "age_s": round(time.time() - _state["at"], 1), "count": len(ms), "ids": [m["id"] for m in ms]}


def thinking_off(tag: str) -> bool:
    """True when the server reported `thinking` for this tag, i.e. the caller should send "think": false."""
    models()
    if tag not in _caps:
        _log(f"capabilities unknown for {tag} — not sending think:false")
        return False
    return "thinking" in _caps[tag]
