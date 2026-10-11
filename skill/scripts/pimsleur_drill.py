#!/usr/bin/env python3
"""pimsleur_drill — turn a lesson's item bank (pimsleur.json) into a Pimsleur-style drill MP3 in the lesson player.

    pimsleur_drill.py validate <lesson-dir>          check pimsleur.json, print the problems, exit 1 on any
    pimsleur_drill.py plan     <lesson-dir>          print the running order (no audio)
    pimsleur_drill.py build    <lesson-dir> [--qc]   bake audio/pimsleur.mp3 + timeline, upsert the manifest clip
    pimsleur_drill.py listen   <lesson-dir>          Gemini listens to the finished MP3 -> audio/pimsleur.listen.md
                                                    (needs GEMINI_API_KEY: run under `cred checkout gemini --exec`)

WHAT PIMSLEUR IS, AND WHERE EACH PRINCIPLE LIVES HERE
-----------------------------------------------------
  anticipation   the pause comes BEFORE the answer: a cue, silence sized to the answer, then the model answer
  back-chaining  long phrases are built up from their END (informato -> consenso informato), item.build
  graduated      every new item is recalled again after 1, 2 and 4 further new items, then in a final round,
  recall         and items carried over from earlier lessons (review) are interleaved between new ones
  talk-about-it  open prompts get a long free-speech pause, framed by a soft tone at start and end (a bare 25 s
                 silence reads as "playback stopped" — Gemini review 2026-10-10), then one model answer

The model only AUTHORS pimsleur.json. Everything here is deterministic: the running order, the pause lengths,
the loudness. Those are exactly where the 2026-10-10 prototype had its bugs.

ITEM BANK — <lesson-dir>/pimsleur.json
  { "title": str, "album": str?, "track": int?, "intro": [str]?, "outro": str?,
    "voices": {"cue": "pauls_tutor", "target": "lucrezia_italian"}?,
    "items":  [ITEM], "review": [ITEM]? }
  ITEM = { "id": str, "it": str, "en": str, "kind": "phrase"|"question"|"talk",
           "build": [str]?,   # back-chain pieces, shortest first, each a word-suffix of "it"
           "secs": int? }     # talk only: free-speech pause (default 20)
  For "talk", "en" is the prompt and "it" is the model answer.

AUDIO TRAPS (measured 2026-10-10, see memory finding-pimsleur-audio-builder)
  * raw OmniVoice voices sit ~26 dB apart -> every clip is levelled (cue -18 LUFS, target -20 LUFS)
  * a one-word English line synthesizes as garbage -> cue lines always carry a carrier phrase
  * whisper locks one language on a mixed file -> --qc checks each clip alone, language forced
"""
from __future__ import annotations

import argparse, difflib, hashlib, json, os, re, subprocess, sys, tempfile, unicodedata, urllib.request

OV_URL = os.environ.get("CHIRON_OMNIVOICE_URL", "http://192.168.0.159:8770")
ASR_URL = os.environ.get("CHIRON_WHISPER_URL", "http://192.168.0.159:8766")
QC_FAILED = 3
MODAL_SYNTH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "modal", "modal_synth.py")
VOICES_FILE = os.path.expanduser("~/.chiron/voices.json")
DEFAULT_VOICES = {"cue": "pauls_tutor", "target": "lucrezia_italian"}
LUFS = {"cue": "-18", "target": "-20"}   # the cue voice reads ~2 dB quieter at equal LUFS
RATE = 24000
GAP_AFTER_SPEECH = 0.5
REPEAT_GAP = 2.0
TALK_DEFAULT = 20
RECALL_AFTER = (1, 2, 4)                  # recall a new item after this many further new items
QC_MIN_RATIO = 0.75

CUES = ["How do you say: {en}?", "Say: {en}.", "Do you remember how to say: {en}?", "Now say: {en}."]
QUESTION_CUES = ["How do you ask: {en}?", "Ask: {en}", "Do you remember how to ask: {en}?"]


# ---------------------------------------------------------------- validation

def _words(s: str) -> list[str]:
    return re.findall(r"[\wÀ-ÿ']+", s.lower())


def validate(bank: dict) -> list[str]:
    """Return every problem found; empty means the bank can be scheduled."""
    errs: list[str] = []
    items = bank.get("items")
    if not isinstance(items, list) or not items:
        return ["items: must be a non-empty list"]
    seen: set[str] = set()
    for where, lst in (("items", items), ("review", bank.get("review") or [])):
        for i, it in enumerate(lst):
            tag = f"{where}[{i}] {it.get('id', '?')}"
            for k in ("id", "it", "en"):
                if not isinstance(it.get(k), str) or not it[k].strip():
                    errs.append(f"{tag}: missing '{k}'")
            if it.get("id") in seen:
                errs.append(f"{tag}: duplicate id")
            seen.add(it.get("id"))
            kind = it.get("kind", "phrase")
            if kind not in ("phrase", "question", "talk"):
                errs.append(f"{tag}: kind must be phrase|question|talk, got {kind!r}")
            if kind == "talk" and where == "review":
                errs.append(f"{tag}: talk prompts cannot be review items")
            full = _words(it.get("it", ""))
            prev = 0
            for piece in it.get("build") or []:
                pw = _words(piece)
                if not pw or full[-len(pw):] != pw:
                    errs.append(f"{tag}: build piece {piece!r} is not a word-suffix of {it.get('it')!r}")
                elif len(pw) <= prev:
                    errs.append(f"{tag}: build pieces must grow, shortest first ({piece!r})")
                else:
                    prev = len(pw)
    return errs


# ---------------------------------------------------------------- scheduling

def _en(text: str) -> str:
    """English cue text inside a carrier: keep a question mark, drop a closing period."""
    return text.rstrip(".! ")


def _cue(item: dict, n: int) -> str:
    pool = QUESTION_CUES if item.get("kind") == "question" else CUES
    line = pool[n % len(pool)].format(en=_en(item["en"]))
    return re.sub(r"\?([.?])$", "?", line)


def schedule(bank: dict) -> list[tuple]:
    """Deterministic running order. Steps:
         ("cue", text)          English line
         ("target", text)       Italian line
         ("answer_pause", text) silence sized to that Italian answer
         ("repeat_pause",)      fixed silence after a model answer
         ("talk_pause", secs)   free-speech silence
    """
    s: list[tuple] = []
    n = 0                                   # rotates cue phrasings

    def recall(item):
        nonlocal n
        s.extend([("cue", _cue(item, n)), ("answer_pause", item["it"]), ("target", item["it"]), ("repeat_pause",)])
        n += 1

    for line in bank.get("intro") or []:
        s.append(("cue", line))
    review = list(bank.get("review") or [])
    due: list[tuple[int, dict]] = []        # (new-item count at which it is due, item)
    introduced = 0
    for item in bank["items"]:
        if item.get("kind") == "talk":
            s.extend([("cue", item["en"]), ("talk_pause", int(item.get("secs", TALK_DEFAULT))),
                      ("cue", "One possible answer:"), ("target", item["it"]), ("repeat_pause",)])
            continue
        verb = "ask" if item.get("kind") == "question" else "say"
        s.extend([("cue", re.sub(r"\?\.$", "?", f"Here is how to {verb}: {_en(item['en'])}.")), ("target", item["it"]), ("repeat_pause",),
                  ("target", item["it"]), ("repeat_pause",)])
        if item.get("build"):
            s.append(("cue", "Listen and repeat, from the end."))
            for piece in item["build"]:
                if _words(piece) != _words(item["it"]):
                    s.extend([("target", piece), ("repeat_pause",)])
            s.extend([("target", item["it"]), ("repeat_pause",)])
        recall(item)
        introduced += 1
        due += [(introduced + k, item) for k in RECALL_AFTER]
        for d in sorted([x for x in due if x[0] <= introduced], key=lambda x: x[0]):
            if d[1] is not item:
                recall(d[1])
        due = [x for x in due if x[0] > introduced]
        if review:
            recall(review.pop(0))
    final = [i for i in bank["items"] if i.get("kind") != "talk"] + list(bank.get("review") or [])
    if final:
        s.append(("cue", "Let's review everything from this lesson."))
        for k, item in enumerate(final[1::2] + final[0::2]):  # interleaved, never in teaching order
            recall(item)
    s.append(("cue", bank.get("outro") or "Well done. That's the end of this lesson."))
    return s


# ---------------------------------------------------------------- audio

def _run(*a):
    subprocess.run(a, check=True, capture_output=True)


def _dur(p: str) -> float:
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                          "-of", "csv=p=0", p]).decode())


class Baker:
    def __init__(self, cache: str, voices: dict):
        self.cache, self.voices = cache, {**DEFAULT_VOICES, **(voices or {})}
        self.refs = json.load(open(VOICES_FILE))
        os.makedirs(cache, exist_ok=True)
        for role in ("cue", "target"):
            if self.voices[role] not in self.refs:
                sys.exit(f"voice {self.voices[role]!r} ({role}) not in {VOICES_FILE}")

    def key(self, role: str, text: str) -> str:
        return hashlib.sha256(f"{self.voices[role]}|{text}".encode()).hexdigest()[:16]

    def raw(self, role: str, text: str) -> str:
        return f"{self.cache}/{self.key(role, text)}.wav"

    def clip(self, role: str, text: str) -> str:
        """Synthesized, cached, levelled clip for one line."""
        raw, lev = self.raw(role, text), f"{self.cache}/{self.key(role, text)}.lev{LUFS[role]}.wav"
        if not os.path.exists(raw):
            ref = self.refs[self.voices[role]]
            lang = "en" if role == "cue" else "it"
            body = json.dumps({"text": text, "ref_audio": ref["refAudio"], "ref_text": ref["refText"],
                               "language": lang, "num_step": 48, "guidance_scale": 2.0,
                               "class_temperature": 0.3, "pitch_semitones": 0}).encode()
            req = urllib.request.Request(f"{OV_URL}/tts", body, {"content-type": "application/json"})
            data = urllib.request.urlopen(req, timeout=240).read()
            if len(data) < 2000:
                raise RuntimeError(f"OmniVoice returned {len(data)} bytes for {text!r}")
            open(raw + ".in", "wb").write(data)
            _run("ffmpeg", "-y", "-loglevel", "error", "-i", raw + ".in", "-ar", str(RATE), "-ac", "1", raw)
            os.remove(raw + ".in")
            print(f"  synth {role:6} {_dur(raw):5.2f}s  {text}", flush=True)
        if not os.path.exists(lev):
            _run("tts-normalize", raw, lev, LUFS[role])
            _run("ffmpeg", "-y", "-loglevel", "error", "-i", lev, "-ar", str(RATE), "-ac", "1", lev + ".tmp.wav")
            os.replace(lev + ".tmp.wav", lev)
        return lev

    def forget(self, role: str, text: str):
        for p in (self.raw(role, text), f"{self.cache}/{self.key(role, text)}.lev{LUFS[role]}.wav"):
            if os.path.exists(p):
                os.remove(p)

    def tone(self, hz: int) -> str:
        """A soft 0.15 s tone that frames the free-speech pause: high = start talking, low = time is up."""
        p = f"{self.cache}/tone_{hz}.wav"
        if not os.path.exists(p):
            _run("ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"sine=frequency={hz}:duration=0.15",
                 "-af", "volume=0.2,afade=t=in:d=0.02,afade=t=out:st=0.1:d=0.05", "-ar", str(RATE), "-ac", "1", p)
        return p

    def silence(self, secs: float) -> str:
        p = f"{self.cache}/sil_{secs:.2f}.wav"
        if not os.path.exists(p):
            _run("ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"anullsrc=r={RATE}:cl=mono",
                 "-t", f"{secs:.2f}", p)
        return p


def answer_pause(answer_secs: float) -> float:
    """Time for the learner to say the answer aloud before hearing it (accepted 2026-10-10)."""
    return max(3.5, 2.0 * answer_secs + 1.0)


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.lower())
    return " ".join(_words("".join(c for c in s if not unicodedata.combining(c))))


# Whisper writes small numbers as digits ("Alle 9." for "alle nove"); spell them back before comparing.
NUMBER_WORDS = {
    "it": "zero uno due tre quattro cinque sei sette otto nove dieci undici dodici tredici quattordici quindici "
          "sedici diciassette diciotto diciannove venti".split(),
    "en": "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen "
          "sixteen seventeen eighteen nineteen twenty".split(),
}


def _spell_numbers(s: str, lang: str) -> str:
    words = NUMBER_WORDS.get(lang, [])
    return re.sub(r"\b\d+\b", lambda m: words[int(m[0])] if int(m[0]) < len(words) else m[0], s)


def qc_clip(path: str, text: str, lang: str) -> tuple[float, str]:
    """Transcribe one clip with its language forced; return (similarity, heard)."""
    out = subprocess.run(["curl", "-s", "--max-time", "90", "-F", f"file=@{path}", "-F", f"language={lang}",
                          f"{ASR_URL}/transcribe"], capture_output=True, text=True).stdout
    heard = " ".join(seg.get("text", "").strip() for seg in json.loads(out).get("segments", []))
    return difflib.SequenceMatcher(None, _norm(text), _norm(_spell_numbers(heard, lang))).ratio(), heard


def synth_modal(baker: Baker, lines: list, slug: str):
    """Fill the raw cache for every uncached line in ONE job on the deployed chiron-bake Modal lane (L4,
    length-bucketed). Same OmniVoice weights + refs as the Mac, so the voices match; levelling stays local."""
    todo = [(r, t) for r, t in lines if not os.path.exists(baker.raw(r, t))]
    if not todo:
        return
    segs = [{"voice": baker.voices[r], "lang": "en" if r == "cue" else "it", "text": t} for r, t in todo]
    refs = {v: {"wav": os.path.basename(baker.refs[v]["refAudio"]), "txt": baker.refs[v]["refText"]}
            for v in {s["voice"] for s in segs}}
    with tempfile.TemporaryDirectory(prefix="pimsleur-modal-") as td:
        jp, pref = os.path.join(td, "job.json"), os.path.join(td, "pref")
        json.dump({"slug": slug, "num_step": 48, "bucket": 8, "refs": refs, "sections": {"all": segs}}, open(jp, "w"))
        print(f"  modal: {len(todo)} clips -> chiron-bake", flush=True)
        r = subprocess.run(["python3", MODAL_SYNTH, jp, pref], capture_output=True, text=True,
                           timeout=max(1800, len(todo) * 5 + 600))
        out = (r.stdout.strip().splitlines() or ["{}"])[-1]
        res = json.loads(out) if out.startswith("{") else {}
        if res.get("error") or not res.get("clips"):
            sys.exit(f"Modal synth failed: {res.get('error') or r.stderr[-300:]}")
        print(f"  modal: {res['clips']} clips back, {res.get('synth_s')}s GPU", flush=True)
        for i, (role, text) in enumerate(todo):
            src = os.path.join(pref, "all", f"{i}.wav")
            # a missing or empty one (Modal once returned a 78-byte header for 'farLe') falls through to the Mac
            if os.path.exists(src) and os.path.getsize(src) > 2000:
                _run("ffmpeg", "-y", "-loglevel", "error", "-i", src, "-ar", str(RATE), "-ac", "1", baker.raw(role, text))


def synth(baker: Baker, lines: list, engine: str, slug: str):
    if engine == "modal":
        synth_modal(baker, lines, slug)
    for role, text in lines:
        baker.clip(role, text)


def build(lesson_dir: str, qc: bool, engine: str = "mac") -> dict:
    bank = json.load(open(os.path.join(lesson_dir, "pimsleur.json")))
    errs = validate(bank)
    if errs:
        sys.exit("pimsleur.json invalid:\n  " + "\n  ".join(errs))
    steps = schedule(bank)
    audio_dir = os.path.join(lesson_dir, "audio")
    baker = Baker(os.path.join(audio_dir, "pimsleur-cache"), bank.get("voices"))

    lines = {(st[0], st[1]) for st in steps if st[0] in ("cue", "target")}
    lines |= {("target", st[1]) for st in steps if st[0] == "answer_pause"}
    synth(baker, sorted(lines), engine, os.path.basename(os.path.normpath(lesson_dir)))

    report = {"checked": 0, "resynth": [], "failed": []}
    if qc:
        bad = []
        for role, text in sorted(lines):
            ratio, heard = qc_clip(baker.raw(role, text), text, "en" if role == "cue" else "it")
            report["checked"] += 1
            if ratio < QC_MIN_RATIO:
                bad.append((role, text))
                baker.forget(role, text)
                report["resynth"].append({"text": text, "heard": heard, "ratio": round(ratio, 2)})
        synth(baker, bad, engine, "qc-" + os.path.basename(os.path.normpath(lesson_dir)))
        for role, text in bad:
            ratio2, heard2 = qc_clip(baker.raw(role, text), text, "en" if role == "cue" else "it")
            if ratio2 < QC_MIN_RATIO:
                report["failed"].append({"text": text, "heard": heard2, "ratio": round(ratio2, 2)})
        print(f"  qc: {report['checked']} clips, {len(report['resynth'])} re-synthesized, {len(report['failed'])} still failing")

    parts, timeline, t = [], [], 0.0
    for st in steps:
        kind = st[0]
        if kind in ("cue", "target"):
            p = baker.clip(kind, st[1])
            parts += [p, baker.silence(GAP_AFTER_SPEECH)]
            timeline.append({"t": round(t, 1), "who": kind, "text": st[1]})
            t += _dur(p) + GAP_AFTER_SPEECH
        elif kind == "answer_pause":
            d = answer_pause(_dur(baker.clip("target", st[1])))
            parts.append(baker.silence(d)); timeline.append({"t": round(t, 1), "who": "pause", "secs": round(d, 1)}); t += d
        elif kind == "repeat_pause":
            parts.append(baker.silence(REPEAT_GAP)); t += REPEAT_GAP
        elif kind == "talk_pause":
            secs = float(st[1])
            parts += [baker.tone(880), baker.silence(secs - 0.3), baker.tone(660)]
            timeline.append({"t": round(t, 1), "who": "talk", "secs": st[1]}); t += secs

    out = os.path.join(audio_dir, "pimsleur.mp3")
    lst = os.path.join(baker.cache, "concat.txt")
    open(lst, "w").write("".join(f"file '{os.path.abspath(p)}'\n" for p in parts))
    meta = ["-metadata", f"title={bank['title']}", "-metadata", f"album={bank.get('album') or bank['title']}",
            "-metadata", "artist=Chiron"]
    if bank.get("track"):
        meta += ["-metadata", f"track={bank['track']}"]
    _run("ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst,
         "-af", "loudnorm=I=-20:TP=-1.5:LRA=11", "-ar", "44100", "-codec:a", "libmp3lame", "-q:a", "3", *meta, out)
    secs = round(_dur(out), 2)
    json.dump({"title": bank["title"], "durationS": secs, "timeline": timeline, "qc": report},
              open(os.path.join(audio_dir, "pimsleur.timeline.json"), "w"), ensure_ascii=False, indent=1)

    man_path = os.path.join(audio_dir, "manifest.json")
    man = json.load(open(man_path)) if os.path.exists(man_path) else {"clips": []}
    man["clips"] = [c for c in man.get("clips", []) if c.get("artifact") != "pimsleur"]
    man["clips"].insert(0, {"artifact": "pimsleur", "sectionId": "", "audioPath": "audio/pimsleur.mp3",
                            "status": "done", "durationS": secs, "label": bank["title"]})
    json.dump(man, open(man_path, "w"), ensure_ascii=False, indent=2)
    # manifest.js mirrors it for file:// lessons, where the player cannot fetch() the JSON (same as lib/audio-bake.ts)
    open(os.path.join(audio_dir, "manifest.js"), "w").write(
        f"window.__chironAudioManifest = {json.dumps({'clips': man['clips']}, ensure_ascii=False)};\n")
    print(f"WROTE {out}  {secs:.0f}s  ({len(lines)} distinct lines)")
    return report


LISTEN_PROMPT = (
    "Pimsleur-style Italian drill for a learner who must SPEAK in each silence. English cue -> silence for the "
    "learner to answer aloud -> native Italian answer; soft tones frame the long free-speech pauses. Planned "
    "timeline (seconds):\n{timeline}\n\nListen to the whole file and report BRIEFLY with timestamps: 1) any clip "
    "garbled, cut off, wrong words or with artifacts; 2) Italian mispronunciation (stress, double consonants, names); "
    "3) loudness balance between the voices; 4) whether pauses are adequate; 5) anything that would confuse or annoy "
    "a learner. Say 'none' where nothing is wrong. End with one line: VERDICT: PASS or VERDICT: FIX.")


def listen(lesson_dir: str) -> str:
    """Gemini hears the finished MP3 — catches what per-clip ASR cannot (prosody, balance, pacing, artifacts)."""
    import base64
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        sys.exit("listen: no GEMINI_API_KEY — run under `cred checkout gemini --exec '...'`")
    audio_dir = os.path.join(lesson_dir, "audio")
    tl = json.load(open(os.path.join(audio_dir, "pimsleur.timeline.json")))["timeline"]
    body = {"contents": [{"parts": [
        {"inline_data": {"mime_type": "audio/mpeg",
                         "data": base64.b64encode(open(os.path.join(audio_dir, "pimsleur.mp3"), "rb").read()).decode()}},
        {"text": LISTEN_PROMPT.format(timeline=json.dumps(tl, ensure_ascii=False))}]}],
        # gemini-flash-latest is a thinking model (checked 2026-10-10): cap reasoning, this is a review not a puzzle
        "generationConfig": {"thinkingConfig": {"thinkingBudget": 1024}, "temperature": 0.3}}
    req = urllib.request.Request(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
        json.dumps(body).encode(), {"content-type": "application/json", "x-goog-api-key": key})
    resp = json.loads(urllib.request.urlopen(req, timeout=600).read())
    json.dump(resp.get("usageMetadata") or {}, open(os.path.join(audio_dir, "pimsleur.listen.usage.json"), "w"), indent=1)
    text = "".join(p.get("text", "") for p in resp["candidates"][0]["content"]["parts"])
    open(os.path.join(audio_dir, "pimsleur.listen.md"), "w").write(text + "\n")
    return text


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("cmd", choices=["validate", "plan", "build", "listen"])
    ap.add_argument("lesson_dir")
    ap.add_argument("--qc", action="store_true", help="check every clip with forced-language ASR, re-synth failures once")
    ap.add_argument("--engine", choices=["mac", "modal"], default=os.environ.get("CHIRON_PIMSLEUR_ENGINE", "mac"),
                    help="where OmniVoice runs: the Mac sidecar, or the chiron-bake Modal lane (L4, batched)")
    a = ap.parse_args()
    bank = json.load(open(os.path.join(a.lesson_dir, "pimsleur.json")))
    if a.cmd == "validate":
        errs = validate(bank)
        print("\n".join(errs) if errs else "ok")
        sys.exit(1 if errs else 0)
    if a.cmd == "plan":
        errs = validate(bank)
        if errs:
            sys.exit("\n".join(errs))
        for st in schedule(bank):
            print(f"{st[0]:13} {st[1] if len(st) > 1 else ''}")
        return
    if a.cmd == "listen":
        text = listen(a.lesson_dir)
        print(text)
        sys.exit(0 if "VERDICT: PASS" in text else 1)
    report = build(a.lesson_dir, a.qc, a.engine)
    sys.exit(QC_FAILED if report["failed"] else 0)   # a crash exits 1, so the chain can tell the two apart


if __name__ == "__main__":
    main()
