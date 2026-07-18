"""OmniVoice (k2-fsa/OmniVoice) synth benchmark on Modal cloud GPUs — the CUDA side of the
Mac-MPS-vs-NVIDIA comparison. Mirrors the Mac sidecar's exact generate() call so the numbers
are apples-to-apples with bench_mac.py.

SETUP (one-time, YOURS — needs a browser):
    modal setup                     # auth against your existing Modal account (radiogen/maisi)

RUN:
    modal run modal_bench.py                 # L4 + A100, all segments, num_step=48
    modal run modal_bench.py --gpus L4       # just one
    modal run modal_bench.py --limit 20 --num-step 32

Prints per-segment timing + total + sec/char + the 1000-question extrapolation, same as the Mac run.
The model + refs + payload are baked/mounted; only the GPU synth is timed (warmup excluded)."""
import json
import modal

app = modal.App("omnivoice-bench")

# CUDA torch + the omnivoice package (same one the Mac sidecar uses). k2-fsa/OmniVoice, Apache-2.0.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libsndfile1", "ffmpeg")
    .pip_install("torch", "omnivoice", "huggingface_hub", "soundfile", "numpy")
    .add_local_file("/home/gyasis/Documents/code/chiron/bench/omnivoice-modal/payload.json", "/root/payload.json")
    .add_local_dir("/home/gyasis/Documents/code/chiron/bench/omnivoice-modal/refs", "/root/refs")
)
# HF cache on a Volume → the ~model downloads once, reused across runs/GPUs.
hf_cache = modal.Volume.from_name("hf-cache", create_if_missing=True)

REF = {
    "en": {"wav": "/root/refs/lucrezia_english_ref.wav", "txt": "Hi everyone, and welcome back to my channel!"},
    "it": {"wav": "/root/refs/lucrezia_italian_ref.wav",
           "txt": "Ciao a tutti e bentornati sul mio canale, oppure benvenuti se questo è il primo video che guardate qui sul mio canale."},
}


def _run(gpu_label: str, num_step: int, limit: int) -> dict:
    """Load OmniVoice on this GPU, warm up (excluded), time synth of each segment (mirrors the Mac)."""
    import os, time, torch
    os.environ.setdefault("HF_HOME", "/cache/huggingface")
    from omnivoice import OmniVoice, OmniVoiceGenerationConfig

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    gpu_name = torch.cuda.get_device_name(0) if dev == "cuda" else "cpu"
    print(f"[{gpu_label}] device={dev} ({gpu_name}) — loading k2-fsa/OmniVoice…", flush=True)
    t0 = time.perf_counter()
    model = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map=dev, dtype=torch.float16, load_asr=False)
    print(f"[{gpu_label}] loaded in {time.perf_counter()-t0:.1f}s", flush=True)

    def synth(text, lang):
        ref = REF.get(lang, REF["en"])
        cfg = OmniVoiceGenerationConfig(num_step=num_step, guidance_scale=2.0, class_temperature=0.3)
        t = time.perf_counter()
        model.generate(text=text, language=lang, speed=1.0, generation_config=cfg,
                        ref_audio=ref["wav"], ref_text=ref["txt"])
        return time.perf_counter() - t

    synth("warm up the model please.", "en")            # warmup (excluded)

    pl = json.load(open("/root/payload.json"))
    segs = pl["segments"][:limit] if limit else pl["segments"]
    full_chars = pl["total_chars"]
    tot, chars = 0.0, 0
    for i, s in enumerate(segs, 1):
        dt = synth(s["text"], s["lang"]); tot += dt; chars += len(s["text"])
        print(f"[{gpu_label}] [{i:>3}/{len(segs)}] {s['lang']} {len(s['text']):>3}c → {dt:6.2f}s", flush=True)

    spc = tot / max(1, chars)
    q_time = spc * full_chars
    res = {"gpu": gpu_label, "gpu_name": gpu_name, "num_step": num_step, "segments": len(segs),
           "chars": chars, "total_s": round(tot, 2), "s_per_char": round(spc, 5),
           "q_time_s": round(q_time, 1)}
    print(f"\n[{gpu_label}] ── RESULT ── total {tot:.1f}s · {tot/len(segs):.2f}s/seg · "
          f"1 question ≈ {q_time:.0f}s ({q_time/60:.1f} min) · "
          f"1000 serial ≈ {q_time*1000/3600:.0f}h · 1000@25workers ≈ {q_time*1000/25/3600:.1f}h", flush=True)
    return res


@app.function(image=image, gpu="L4", volumes={"/cache/huggingface": hf_cache}, timeout=3600)
def bench_l4(num_step: int = 48, limit: int = 0):
    return _run("L4", num_step, limit)


@app.function(image=image, gpu="A100", volumes={"/cache/huggingface": hf_cache}, timeout=3600)
def bench_a100(num_step: int = 48, limit: int = 0):
    return _run("A100", num_step, limit)


@app.function(image=image, gpu="L4", volumes={"/cache/huggingface": hf_cache}, timeout=3600)
def bucket_ab(n: int = 24, bucket: int = 8, num_step: int = 48):
    """Length-BUCKETED batching (group similar-length segments → no padding waste) vs SEQUENTIAL,
    over the same passage. Returns timings + a stitched WAV of EACH method so we can A/B-listen for
    consistency (does batched sound any more disjointed than sequential?)."""
    import os, io, time, torch, numpy as np, soundfile as sf
    os.environ.setdefault("HF_HOME", "/cache/huggingface")
    from omnivoice import OmniVoice, OmniVoiceGenerationConfig
    model = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map="cuda", dtype=torch.float16, load_asr=False)
    cfg = OmniVoiceGenerationConfig(num_step=num_step, guidance_scale=2.0, class_temperature=0.3)
    pl = json.load(open("/root/payload.json"))
    segs = pl["segments"][:n]
    R = lambda s: (REF[s["lang"]]["wav"], REF[s["lang"]]["txt"])
    model.generate(text="warm up please", language="en", ref_audio=REF["en"]["wav"], ref_text=REF["en"]["txt"], generation_config=cfg)  # warmup

    # SEQUENTIAL — one call per segment (what the Mac does today)
    t0 = time.perf_counter(); seq = []
    for s in segs:
        w, tx = R(s); a = model.generate(text=s["text"], language=s["lang"], ref_audio=w, ref_text=tx, generation_config=cfg)
        seq.append(a[0] if isinstance(a, list) else a)
    seq_s = time.perf_counter() - t0

    # BUCKETED — group by (lang, length) so each batch has ~uniform length (min padding), then reassemble by orig index
    order = sorted(range(len(segs)), key=lambda i: (segs[i]["lang"], len(segs[i]["text"])))
    got = {}
    t0 = time.perf_counter()
    for i in range(0, len(order), bucket):
        grp = order[i:i + bucket]; ch = [segs[j] for j in grp]
        arrs = model.generate(text=[c["text"] for c in ch], language=[c["lang"] for c in ch],
                              ref_audio=[REF[c["lang"]]["wav"] for c in ch], ref_text=[REF[c["lang"]]["txt"] for c in ch],
                              generation_config=cfg)
        for j, a in zip(grp, arrs):
            got[j] = a
    bat_s = time.perf_counter() - t0
    bat = [got[i] for i in range(len(segs))]

    sil = np.zeros(int(0.15 * 24000), dtype=np.float32)   # 150 ms gap between clips
    def stitch(arrs):
        return np.concatenate([np.concatenate([np.asarray(a, dtype=np.float32).reshape(-1), sil]) for a in arrs])
    def wav(arr):
        b = io.BytesIO(); sf.write(b, arr, 24000, format="WAV"); return b.getvalue()

    print(f"[AB] n={len(segs)} · sequential {seq_s:.1f}s · bucketed(bs={bucket}) {bat_s:.1f}s · "
          f"speedup {seq_s/bat_s:.2f}x", flush=True)
    return {"n": len(segs), "seq_s": round(seq_s, 1), "bat_s": round(bat_s, 1),
            "speedup": round(seq_s / bat_s, 2), "seq_wav": wav(stitch(seq)), "bat_wav": wav(stitch(bat))}


@app.function(image=image, gpu="L4", volumes={"/cache/huggingface": hf_cache}, timeout=3600)
def bench_batch(batch_sizes: str = "1,8,16,32", num_step: int = 48):
    """BATCHED synth: pass many segments as lists in ONE generate() call → the GPU processes them
    together. Measures the within-question speedup (and lower GPU-seconds → lower $) at each batch size."""
    import os, time, torch
    os.environ.setdefault("HF_HOME", "/cache/huggingface")
    from omnivoice import OmniVoice, OmniVoiceGenerationConfig
    model = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map="cuda", dtype=torch.float16, load_asr=False)
    pl = json.load(open("/root/payload.json"))
    segs = pl["segments"]
    cfg = OmniVoiceGenerationConfig(num_step=num_step, guidance_scale=2.0, class_temperature=0.3)
    model.generate(text="warm up please", language="en",                       # warmup (excluded)
                   ref_audio=REF["en"]["wav"], ref_text=REF["en"]["txt"], generation_config=cfg)

    out = []
    for bs in [int(x) for x in batch_sizes.split(",")]:
        t0 = time.perf_counter()
        for i in range(0, len(segs), bs):
            chunk = segs[i:i + bs]
            if bs == 1:
                s = chunk[0]
                model.generate(text=s["text"], language=s["lang"],
                               ref_audio=REF[s["lang"]]["wav"], ref_text=REF[s["lang"]]["txt"],
                               generation_config=cfg)
            else:
                model.generate(
                    text=[s["text"] for s in chunk],
                    language=[s["lang"] for s in chunk],
                    ref_audio=[REF[s["lang"]]["wav"] for s in chunk],
                    ref_text=[REF[s["lang"]]["txt"] for s in chunk],
                    generation_config=cfg)
        tot = time.perf_counter() - t0
        r = {"batch": bs, "total_s": round(tot, 1), "per_seg": round(tot / len(segs), 3),
             "q_min": round(tot / 60, 2)}
        out.append(r)
        print(f"[batch={bs:>2}] full question ({len(segs)} segs): {tot:.1f}s = {tot/60:.2f} min "
              f"({tot/len(segs):.3f}s/seg)", flush=True)
    base = next((r["total_s"] for r in out if r["batch"] == 1), out[0]["total_s"])
    print("\n== BATCH SPEEDUP (vs serial) ==", flush=True)
    for r in out:
        sp = base / r["total_s"]
        cost_1000 = r["total_s"] * 1000 / 3600 * 0.80
        print(f"  batch {r['batch']:>2}: {r['q_min']:.2f} min/question · {sp:.1f}x vs serial · "
              f"1000q on 50 L4 ≈ {r['total_s']*1000/50/60:.0f} min, ~${cost_1000:.0f}", flush=True)
    return out


@app.function(image=image, gpu="L4", volumes={"/cache/huggingface": hf_cache}, timeout=1200)
def voice_check(num_step: int = 48):
    """Synthesize a few Lucrezia lines on Modal-CUDA and return the WAV bytes — so we can HEAR that
    the cloned voice survives MPS→CUDA (same k2-fsa/OmniVoice weights + same lucrezia ref)."""
    import io, os, torch, numpy as np, soundfile as sf
    os.environ.setdefault("HF_HOME", "/cache/huggingface")
    from omnivoice import OmniVoice, OmniVoiceGenerationConfig
    model = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map="cuda", dtype=torch.float16, load_asr=False)
    lines = [
        ("lucrezia_it", "it", "Ciao a tutti! Oggi parliamo di un caso clinico di medicina interna molto interessante."),
        ("lucrezia_en", "en", "Hi everyone, welcome back — let's break down this clinical vignette together."),
    ]
    out = []
    for name, lang, text in lines:
        ref = REF[lang]
        cfg = OmniVoiceGenerationConfig(num_step=num_step, guidance_scale=2.0, class_temperature=0.3)
        audio = model.generate(text=text, language=lang, speed=1.0, generation_config=cfg,
                               ref_audio=ref["wav"], ref_text=ref["txt"])
        samples = audio[0] if isinstance(audio, list) else audio
        buf = io.BytesIO(); sf.write(buf, np.asarray(samples, dtype=np.float32), 24000, format="WAV")
        out.append((name, buf.getvalue()))
    return out


@app.local_entrypoint()
def main(gpus: str = "L4,A100", num_step: int = 48, limit: int = 0, sample: bool = False,
         batch: bool = False, batch_sizes: str = "1,8,16,32",
         ab: bool = False, ab_n: int = 24, ab_bucket: int = 8):
    if batch:                                       # within-question BATCHING speedup on L4
        bench_batch.remote(batch_sizes, num_step)
        return
    if ab:                                          # length-bucketed vs sequential + A/B audio
        import os
        r = bucket_ab.remote(ab_n, ab_bucket, num_step)
        d = "/home/gyasis/Documents/code/chiron/bench/omnivoice-modal/samples"; os.makedirs(d, exist_ok=True)
        open(f"{d}/ab_sequential.wav", "wb").write(r.pop("seq_wav"))
        open(f"{d}/ab_bucketed.wav", "wb").write(r.pop("bat_wav"))
        print(f"  {r}")
        print(f"  → A/B listen: {d}/ab_sequential.wav  vs  {d}/ab_bucketed.wav")
        return
    if sample:                                      # voice-fidelity check: hear Lucrezia from Modal-CUDA
        import os
        d = "/home/gyasis/Documents/code/chiron/bench/omnivoice-modal/samples"
        os.makedirs(d, exist_ok=True)
        for name, data in voice_check.remote(num_step):
            p = f"{d}/modal_{name}.wav"; open(p, "wb").write(data)
            print(f"  saved {p}  ({len(data)//1024} KB)")
        print("  → play these to confirm the Modal-CUDA voice IS Lucrezia")
        return
    want = [g.strip().upper() for g in gpus.split(",")]
    results = []
    if "L4" in want:
        results.append(bench_l4.remote(num_step, limit))
    if "A100" in want:
        results.append(bench_a100.remote(num_step, limit))
    print("\n==== BENCHMARK SUMMARY (synth-only) ====")
    for r in results:
        q = r["q_time_s"]
        print(f"  {r['gpu']:5} ({r['gpu_name']}): {r['total_s']}s total · 1 question ≈ {q/60:.1f} min · "
              f"1000 serial ≈ {q*1000/3600:.0f}h · 1000@25 ≈ {q*1000/25/3600:.1f}h")
    with open("result_modal.json", "w") as f:
        json.dump(results, f, indent=1)
    print("  saved → result_modal.json  (compare vs result_mac_mps_ns48.json)")
