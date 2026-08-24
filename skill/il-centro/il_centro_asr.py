#!/usr/bin/env python3
"""il-centro ASR + diarization on Modal — the lane that replaces the Studio sidecars.

    modal deploy il_centro_asr.py          # once, from razer
    python3 modal_ingest.py ~/Downloads/Day_6.m4a --day 6

whisper :8766 and pyannote :8767 live on the Mac Studio. When the Studio is off the network,
Day N's recording cannot be ingested at all — which is the state that left Day 6 with no
transcript, no Registrazione section and no "I miei errori". This puts BOTH models on an L4
alongside the TTS lane, so a recording can be processed with nothing but razer and internet.

The Studio sidecars stay the preferred path when they are reachable: they are warm, free, and
already hold the weights. This is the fallback, and it is deliberately API-compatible with
them so `ingest_recording.py` does not care which one answered.

BOUNDARY: this is an il-centro file. It does not modify chiron, and it does not touch the
Studio sidecar code — it reimplements their two endpoints against the same upstream models.

Two things here are not the naive implementation, and both were learned the hard way:

  1. PER-TURN ASR. Whisper detects language once, from the opening ~30s, and applies it to the
     whole file. A 55-minute bilingual lesson decoded that way comes back with the losing
     language mangled — Day 3 produced Italian written in Spanish orthography ("Exato, sim")
     and hallucinated tokens ("KORON!") across 21% of turns. Diarization already cuts the file
     into short single-language turns, so each turn is decoded on its own.

  2. FORCED TWO-WAY DECODE. Even per-turn, auto-detect drifts to a third language on short
     or accented speech. Every turn is decoded twice — once as `it`, once as `en` — and the
     higher `avg_logprob` wins. That is a de-facto two-language model and it is cheap: the
     turns are seconds long.
"""
import modal

app = modal.App("il-centro-asr")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "faster-whisper==1.1.0",
        "pyannote.audio==3.3.2",
        "torch==2.5.1",
        "torchaudio==2.5.1",
        "numpy<2",
        # huggingface_hub 1.0 REMOVED the `use_auth_token` kwarg. pyannote 3.3.2 still passes
        # it down into hf_hub_download, so an unpinned install resolves to 1.27 and dies with
        # `TypeError: hf_hub_download() got an unexpected keyword argument 'use_auth_token'`
        # at from_pretrained — after the image builds and the GPU is already warm.
        "huggingface_hub<1.0",
    )
)

# Weights are baked into a Volume rather than re-downloaded per call: pyannote 3.1 plus
# whisper large-v3 is ~4 GB, and a cold pull on every invocation would dominate the runtime.
cache = modal.Volume.from_name("il-centro-asr-cache", create_if_missing=True)
CACHE = "/cache"

WHISPER = "large-v3"          # NOT turbo — turbo is distilled and measurably weaker on
                              # code-switching and accented speech, both present here.
DIARIZE = "pyannote/speaker-diarization-3.1"


@app.function(
    image=image, gpu="L4", volumes={CACHE: cache},
    secrets=[modal.Secret.from_name("huggingface")],   # HF_TOKEN — 3.1 is a gated repo
    timeout=60 * 60, scaledown_window=120,
)
def transcribe_diarize(audio: bytes, num_speakers: int = 2, ext: str = "m4a") -> dict:
    """Diarize, then transcribe each turn. Returns the sidecars' merged shape.

    {"segments": [{start, end, speaker, text, lang, avg_logprob}],
     "embeddings": {speaker: [float, ...]},
     "meta": {duration_s, n_turns, lang_split}}
    """
    import os, subprocess, tempfile, time
    import numpy as np
    import torch

    os.environ.setdefault("HF_HOME", CACHE)
    t0 = time.perf_counter()
    d = tempfile.mkdtemp()
    src, wav = f"{d}/in.{ext}", f"{d}/in.wav"
    open(src, "wb").write(audio)
    # 16k mono is what both models want; doing it once here avoids each of them resampling.
    subprocess.run(["ffmpeg", "-y", "-i", src, "-ac", "1", "-ar", "16000", wav],
                   check=True, capture_output=True)

    from pyannote.audio import Pipeline
    pipe = Pipeline.from_pretrained(DIARIZE, use_auth_token=os.environ["HF_TOKEN"])
    pipe.to(torch.device("cuda"))

    # num_speakers is EXACT, not a hint. For this series it is always two people, and letting
    # the clusterer guess is how you get Barbara split across three phantom speakers.
    diar, embeddings = pipe(wav, num_speakers=num_speakers, return_embeddings=True)

    turns = [{"start": float(t.start), "end": float(t.end), "speaker": str(spk)}
             for t, _, spk in diar.itertracks(yield_label=True) if t.end - t.start >= 0.35]

    from faster_whisper import WhisperModel
    asr = WhisperModel(WHISPER, device="cuda", compute_type="float16", download_root=CACHE)

    import torchaudio
    sig, sr = torchaudio.load(wav)
    sig = sig[0].numpy()

    out = []
    for t in turns:
        a, b = int(t["start"] * sr), int(min(t["end"], len(sig) / sr) * sr)
        chunk = sig[a:b]
        if len(chunk) < sr * 0.3:
            continue
        best = None
        for lang in ("it", "en"):                       # forced two-way decode — see header
            segs, _info = asr.transcribe(chunk, language=lang, beam_size=5,
                                         vad_filter=False, condition_on_previous_text=False)
            segs = list(segs)
            if not segs:
                continue
            text = " ".join(s.text for s in segs).strip()
            if not text:
                continue
            lp = float(np.mean([s.avg_logprob for s in segs]))
            if best is None or lp > best["avg_logprob"]:
                best = {"text": text, "lang": lang, "avg_logprob": round(lp, 3)}
        if best:
            out.append({**t, **best})

    emb = {}
    try:
        labels = diar.labels()
        for i, lab in enumerate(labels):
            if i < len(embeddings):
                emb[str(lab)] = [float(x) for x in np.asarray(embeddings[i]).ravel()]
    except Exception:
        pass                                            # embeddings are optional; names can
                                                        # still be confirmed in the review form

    n_it = sum(1 for s in out if s["lang"] == "it")
    return {"segments": out, "embeddings": emb,
            "meta": {"duration_s": round(len(sig) / sr, 1), "n_turns": len(out),
                     "lang_split": {"it": n_it, "en": len(out) - n_it},
                     "asr_s": round(time.perf_counter() - t0, 1),
                     "model": WHISPER, "diarizer": DIARIZE}}


@app.local_entrypoint()
def smoke(path: str, num_speakers: int = 2):
    r = transcribe_diarize.remote(open(path, "rb").read(), num_speakers,
                                  path.rsplit(".", 1)[-1])
    m = r["meta"]
    print(f"{m['n_turns']} turns · {m['duration_s']}s audio · {m['asr_s']}s compute")
    print(f"speakers: {sorted(r['embeddings'])} · lang split: {m['lang_split']}")
    for s in r["segments"][:8]:
        print(f"  [{s['start']:7.1f}] {s['speaker']:12} ({s['lang']}) {s['text'][:70]}")
