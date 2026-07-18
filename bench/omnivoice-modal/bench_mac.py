#!/usr/bin/env python3
"""Mac (M1 Max / MPS) OmniVoice synth baseline — times the /tts calls for one real SSM question.
Synth-only timing (no post/QC), so it's an apples-to-apples number vs the Modal-CUDA runner.

  python3 bench_mac.py [--limit N] [--num-step 48] [--url http://192.168.0.159:8770]

Reports total synth seconds, sec/char, and extrapolation to 1 question + 1000 questions."""
import argparse, json, os, time, urllib.request

REF = {
    "en": {"wav": "/Users/gyasisutton/models/voice-refs/lucrezia_english_ref.wav",
           "txt": "Hi everyone, and welcome back to my channel!"},
    "it": {"wav": "/Users/gyasisutton/models/voice-refs/lucrezia_italian_ref.wav",
           "txt": "Ciao a tutti e bentornati sul mio canale, oppure benvenuti se questo è il primo video che guardate qui sul mio canale."},
}
HERE = os.path.dirname(os.path.abspath(__file__))


def synth(url, seg, num_step, timeout=600):
    ref = REF.get(seg["lang"], REF["en"])
    body = json.dumps({
        "text": seg["text"], "language": seg["lang"],
        "ref_audio": ref["wav"], "ref_text": ref["txt"],
        "num_step": num_step, "guidance_scale": 2.0, "class_temperature": 0.3, "speed": 1.0,
    }).encode()
    req = urllib.request.Request(url + "/tts", data=body, headers={"Content-Type": "application/json"})
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        n = len(r.read())
    return time.perf_counter() - t0, n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="0 = all segments")
    ap.add_argument("--num-step", type=int, default=48)
    ap.add_argument("--url", default="http://192.168.0.159:8770")
    a = ap.parse_args()

    pl = json.load(open(os.path.join(HERE, "payload.json")))
    segs = pl["segments"][: a.limit] if a.limit else pl["segments"]
    full_chars = pl["total_chars"]

    print(f"== Mac OmniVoice baseline · device=mps · num_step={a.num_step} · {len(segs)} segments ==")
    print("warming up model (excluded from timing)…")
    synth(a.url, {"lang": "en", "text": "warm up the model please."}, a.num_step)

    tot, chars, per = 0.0, 0, []
    for i, s in enumerate(segs, 1):
        dt, nbytes = synth(a.url, s, a.num_step)
        tot += dt; chars += len(s["text"]); per.append(dt)
        print(f"  [{i:>3}/{len(segs)}] {s['lang']} {len(s['text']):>3}c → {dt:6.2f}s  ({nbytes//1024}KB)", flush=True)

    spc = tot / max(1, chars)
    q_time = spc * full_chars                       # full one-question synth (extrapolated to all chars)
    print("\n── RESULT (synth-only) ──")
    print(f"  segments timed : {len(segs)}  ({chars} chars)")
    print(f"  total synth    : {tot:.1f}s   ({tot/60:.1f} min)")
    print(f"  per segment    : {tot/len(segs):.2f}s avg   ·   per char: {spc*1000:.1f} ms/1000… ({spc:.4f}s/char)")
    print(f"  → 1 SSM question ({full_chars} chars) ≈ {q_time:.0f}s ({q_time/60:.1f} min)  [synth only, +post/QC on top]")
    print(f"  → 1000 questions SERIAL ≈ {q_time*1000/3600:.0f} hrs ({q_time*1000/3600/24:.1f} days)")
    for w in (10, 25, 50):
        print(f"  → 1000 questions on {w:>2} parallel workers ≈ {q_time*1000/w/3600:.1f} hrs")
    out = os.path.join(HERE, f"result_mac_mps_ns{a.num_step}.json")
    json.dump({"device": "mps", "num_step": a.num_step, "segments": len(segs), "chars": chars,
               "total_s": tot, "s_per_char": spc, "q_time_s": q_time}, open(out, "w"), indent=1)
    print(f"  saved → {out}")


if __name__ == "__main__":
    main()
