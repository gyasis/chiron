"""Chiron fast-bake lane on Modal — the CUDA/parallel SYNTH half of the audio bake.

Only SYNTH moves to Modal; the local pipeline still does tts-normalize → tts-splice → tts-normalize →
mp3 (byte-identical to a Mac bake). This function synthesizes ALL of a lesson's segments on one L4,
length-BUCKETED (group similar-length → no padding tax, measured 1.52x + quality-safe), and returns
the raw per-segment WAVs keyed by section so the caller splices them exactly as today.

Deploy (from a box with ~/.modal.toml):   modal deploy chiron_bake.py
Then the chiron server looks it up:        modal.Function.from_name("chiron-bake", "bake_lesson")

Benchmarked: L4 == A100 (use L4), 3.4x vs Mac MPS, ~2.1 min/question with bucketing; 1000 lessons on
50 L4 workers ≈ 41 min / ~$28. Voice = same k2-fsa/OmniVoice weights + same refs → same persona.
"""
import modal

app = modal.App("chiron-bake")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libsndfile1", "ffmpeg")
    .pip_install("torch", "omnivoice", "huggingface_hub", "soundfile", "numpy")
    .add_local_dir("/home/gyasis/Documents/code/chiron/bench/omnivoice-modal/refs", "/root/refs")
)
hf_cache = modal.Volume.from_name("hf-cache", create_if_missing=True)

_MODEL = None


def _load():
    global _MODEL
    if _MODEL is None:
        import os, torch
        os.environ.setdefault("HF_HOME", "/cache/huggingface")
        from omnivoice import OmniVoice
        _MODEL = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map="cuda",
                                           dtype=torch.float16, load_asr=False)
    return _MODEL


@app.function(image=image, gpu="L4", volumes={"/cache/huggingface": hf_cache},
              timeout=1800, max_containers=50)
def bake_lesson(job: dict) -> dict:
    """One lesson's SYNTH. `job` = {
        slug, num_step,
        refs: {lang: {"wav": "<filename in /root/refs>", "txt": "<ref transcript>"}},
        sections: {section_id: [{"lang","text"}, …]}   # segment order preserved
      }
    Returns {slug, sections: {section_id: [<wav bytes b64>, …]}, synth_s}."""
    import base64, io, time, torch, numpy as np, soundfile as sf
    from omnivoice import OmniVoiceGenerationConfig
    model = _load()
    refs = job["refs"]
    ns = int(job.get("num_step", 48))
    cfg = OmniVoiceGenerationConfig(num_step=ns, guidance_scale=2.0, class_temperature=0.3)

    # flatten → (section, index, seg); bucket by (lang, len) so each batch is ~uniform length
    flat = []
    for sid, segs in job["sections"].items():
        for i, s in enumerate(segs):
            flat.append((sid, i, s))
    order = sorted(range(len(flat)), key=lambda k: (flat[k][2]["lang"], len(flat[k][2]["text"])))
    result = {sid: [None] * len(segs) for sid, segs in job["sections"].items()}

    def refpath(seg):
        # ref keyed by the segment's VOICE (dialogues have persona-a/persona-b), falling back to lang
        # then en — so multi-voice lessons clone the right voice per clip.
        r = refs.get(seg.get("voice")) or refs.get(seg.get("lang")) or refs.get("en")
        if not r:   # F5: clear error instead of a None["wav"] TypeError that kills the lesson mid-bucket
            raise ValueError(f"no voice ref for voice={seg.get('voice')!r} lang={seg.get('lang')!r} "
                             f"(available: {sorted(refs)})")
        return "/root/refs/" + r["wav"], r["txt"]

    t0 = time.perf_counter()
    BUCKET = int(job.get("bucket", 8))
    for b in range(0, len(order), BUCKET):
        grp = order[b:b + BUCKET]
        chunk = [flat[k][2] for k in grp]
        wavs, txts = zip(*(refpath(c) for c in chunk))
        arrs = model.generate(
            text=[c["text"] for c in chunk], language=[c["lang"] for c in chunk],
            ref_audio=list(wavs), ref_text=list(txts), generation_config=cfg)
        for k, a in zip(grp, arrs):
            sid, i, _ = flat[k]
            buf = io.BytesIO()
            sf.write(buf, np.asarray(a, dtype=np.float32).reshape(-1), 24000, format="WAV")
            result[sid][i] = base64.b64encode(buf.getvalue()).decode()
    return {"slug": job["slug"], "sections": result, "synth_s": round(time.perf_counter() - t0, 1)}


@app.local_entrypoint()
def smoke():
    """Quick deploy smoke-test on a tiny synthetic lesson."""
    job = {"slug": "smoke", "num_step": 48,
           "refs": {"it": {"wav": "lucrezia_italian_ref.wav", "txt": "Ciao a tutti"},
                    "en": {"wav": "lucrezia_english_ref.wav", "txt": "Hi everyone"}},
           "sections": {"s1": [{"lang": "en", "text": "Hello, this is a test."},
                               {"lang": "it", "text": "Questo è un test."}]}}
    r = bake_lesson.remote(job)
    print("smoke:", r["slug"], "synth_s=", r["synth_s"],
          "clips=", {k: len(v) for k, v in r["sections"].items()})
