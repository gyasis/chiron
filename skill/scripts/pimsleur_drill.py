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

import argparse, difflib, hashlib, json, os, re, subprocess, sys, tempfile, time, unicodedata, urllib.request

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


_TENS = {"it": "venti trenta quaranta cinquanta sessanta settanta ottanta novanta".split(),
         "en": "twenty thirty forty fifty sixty seventy eighty ninety".split()}
# Whisper writes doses as "500 mg"; the script says "cinquecento milligrammi" (2026-10-11, Ordine prescription lesson).
UNITS = {"it": {"mg": "milligrammi", "ml": "millilitri", "g": "grammi", "kg": "chili", "mcg": "microgrammi"},
         "en": {"mg": "milligrams", "ml": "milliliters", "g": "grams", "kg": "kilos", "mcg": "micrograms"}}
UNIT_ONE = {"it": {"mg": "un milligrammo", "ml": "un millilitro", "g": "un grammo", "kg": "un chilo", "mcg": "un microgrammo"},
            "en": {"mg": "one milligram", "ml": "one milliliter", "g": "one gram", "kg": "one kilo", "mcg": "one microgram"}}


def _num_word(n: int, lang: str) -> str | None:
    """0..999 as spoken words (Italian elides: ventuno, ventotto), else None."""
    small = NUMBER_WORDS.get(lang)
    if not small or not 0 <= n <= 999:
        return None
    if n < len(small):
        return small[n]
    if n < 100:
        t, u = _TENS[lang][n // 10 - 2], n % 10
        if not u:
            return t
        if lang == "it":
            return (t[:-1] if u in (1, 8) else t) + small[u]
        return f"{t}-{small[u]}"
    h, r = divmod(n, 100)
    head = ("cento" if h == 1 else small[h] + "cento") if lang == "it" else f"{small[h]} hundred"
    if not r:
        return head
    tail = _num_word(r, lang)
    return head + tail if lang == "it" else f"{head} {tail}"


def _spell_numbers(s: str, lang: str) -> str:
    def unit(m):
        if m[1] == "1" and m[2] in UNIT_ONE.get(lang, {}):
            return UNIT_ONE[lang][m[2]]
        return f"{m[1]} {UNITS.get(lang, {}).get(m[2], m[2])}"
    s = re.sub(r"\b(\d+)\s*(mg|ml|mcg|kg|g)\b", unit, s)
    return re.sub(r"\b\d+\b", lambda m: _num_word(int(m[0]), lang) or m[0], s)


def qc_clip(path: str, text: str, lang: str) -> tuple[float, str]:
    """Transcribe one clip with its language forced; return (similarity, heard)."""
    # The Mac sidecars self-restart to reclaim memory (exit 42) — an empty reply mid-restart is normal: retry.
    for wait in (5, 15, 30, None):
        out = subprocess.run(["curl", "-s", "--max-time", "90", "-F", f"file=@{path}", "-F", f"language={lang}",
                              f"{ASR_URL}/transcribe"], capture_output=True, text=True).stdout
        try:
            segs = json.loads(out).get("segments", [])
            break
        except ValueError:
            if wait is None:
                raise RuntimeError(f"ASR unreachable at {ASR_URL} after 4 tries (last reply {out[:80]!r})")
            print(f"  asr: no answer (sidecar restarting?) — retry in {wait}s", flush=True)
            time.sleep(wait)
    heard = " ".join(seg.get("text", "").strip() for seg in segs)
    return difflib.SequenceMatcher(None, _norm(text), _norm(_spell_numbers(heard, lang))).ratio(), heard


def synth_modal(baker: Baker, lines: list, slug: str):
    """Fill the raw cache for every uncached line in ONE job on the deployed chiron-bake Modal lane (L4,
    length-bucketed). Same OmniVoice weights + refs as the Mac, so the voices match; levelling stays local."""
    todo = [(r, t) for r, t in lines if not os.path.exists(baker.raw(r, t))]
    if not todo:
        return 0, 0.0
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
    return res["clips"], float(res.get("synth_s") or 0)


def synth(baker: Baker, lines: list, engine: str, slug: str, report: dict | None = None):
    """Synthesize every line; Modal usage is added to report["modal"] (clips, gpu_s) for the run report."""
    if engine == "modal":
        clips, gpu_s = synth_modal(baker, lines, slug)
        if report is not None and clips:
            m = report.setdefault("modal", {"clips": 0, "gpu_s": 0.0})
            m["clips"], m["gpu_s"] = m["clips"] + clips, round(m["gpu_s"] + gpu_s, 1)
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
    report = {"checked": 0, "resynth": [], "failed": []}
    synth(baker, sorted(lines), engine, os.path.basename(os.path.normpath(lesson_dir)), report)
    if qc:
        bad = []
        for role, text in sorted(lines):
            ratio, heard = qc_clip(baker.raw(role, text), text, "en" if role == "cue" else "it")
            report["checked"] += 1
            if ratio < QC_MIN_RATIO:
                bad.append((role, text))
                baker.forget(role, text)
                report["resynth"].append({"text": text, "heard": heard, "ratio": round(ratio, 2)})
        synth(baker, bad, engine, "qc-" + os.path.basename(os.path.normpath(lesson_dir)), report)
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
    json.dump({**(resp.get("usageMetadata") or {}), "modelVersion": resp.get("modelVersion")},
              open(os.path.join(audio_dir, "pimsleur.listen.usage.json"), "w"), indent=1)
    text = "".join(p.get("text", "") for p in resp["candidates"][0]["content"]["parts"])
    open(os.path.join(audio_dir, "pimsleur.listen.md"), "w").write(text + "\n")
    return text


# ---------------------------------------------------------------- re-check a FIX verdict
# The listen review is ONE model's opinion and sometimes hears a glitch that isn't there (2026-10-11: congiuntivo
# L2 "bene così" flagged as cut off; the clip fades out naturally and ASR hears every word; the same audio had
# passed an hour earlier). So a FIX whose complaints are all timestamped CLIP glitches is re-measured; anything
# else (pronunciation, pauses, loudness, untimed complaints) keeps FIX — measurement can't overrule those.
GLITCH = re.compile(r"cut[ -]?off|\bcut\b|clipp|garbl|artifact|artefact|truncat|stray|syllable|glitch|"
                    r"missing word|wrong word|skipped", re.I)
NOT_MEASURABLE = re.compile(r"pronunc|pause|loud|volume|balance|speed|too fast|too slow", re.I)
TAIL_MAX_DB = -28.0      # last voiced 50 ms must have decayed below this — a hard cut ends loud


def flagged(text: str) -> tuple[list[tuple[float, float]], list[str]]:
    """(time ranges of clip-glitch complaints, complaint lines measurement can't settle)."""
    ranges, other = [], []
    for line in text.splitlines():
        ts = [int(m) * 60 + int(s) for m, s in re.findall(r"\b(\d{1,2}):(\d{2})\b", line)]
        if not ts or "VERDICT" in line:
            continue
        if NOT_MEASURABLE.search(line) or not GLITCH.search(line):
            other.append(line.strip())
        else:
            ranges.append((min(ts), max(ts)))
    return ranges, other


def clips_at(timeline: list[dict], a: float, b: float, dur=None, slack: float = 1.5) -> list[dict]:
    """Speech entries whose AUDIBLE span [t, t + dur(e)) overlaps [a - slack, b + slack]
    (without dur: up to the next entry, which over-reaches into the silence after a clip)."""
    out = []
    for i, e in enumerate(timeline):
        if e.get("who") not in ("cue", "target"):
            continue
        end = e["t"] + dur(e) if dur else (timeline[i + 1]["t"] if i + 1 < len(timeline) else e["t"] + 10)
        if e["t"] <= b + slack and end >= a - slack:
            out.append(e)
    return out


def tail_db(path: str) -> float:
    """dBFS of the last voiced 50 ms window (16-bit mono wav)."""
    import math, struct, wave
    w = wave.open(path)
    n, sr = w.getnframes(), w.getframerate()
    x = struct.unpack(f"<{n}h", w.readframes(n))
    win = max(1, int(0.05 * sr))
    for i in range(n - win, -1, -win):
        seg = x[i:i + win]
        db = 20 * math.log10(max(1e-9, math.sqrt(sum(v * v for v in seg) / len(seg)) / 32768))
        if db > -50:
            return db
    return -180.0


def recheck(lesson_dir: str, text: str) -> tuple[bool, list[str]]:
    """Measure every clip a FIX verdict flags. True only if all complaints were clip glitches AND every
    flagged clip passes strict ASR (same words, nothing extra) and fades out (no hard cut)."""
    ranges, other = flagged(text)
    if not ranges:
        return False, ["no timestamped clip-glitch complaint to measure — FIX stands"]
    notes = [f"not measurable, FIX stands: {o[:140]}" for o in other]
    bank = json.load(open(os.path.join(lesson_dir, "pimsleur.json")))
    baker = Baker(os.path.join(lesson_dir, "audio", "pimsleur-cache"), bank.get("voices"))
    timeline = json.load(open(os.path.join(lesson_dir, "audio", "pimsleur.timeline.json")))["timeline"]
    ok, seen = not other, set()
    for a, b in ranges:
        hits = clips_at(timeline, a, b, dur=lambda e: _dur(baker.clip(e["who"], e["text"])))
        if not hits:
            ok = False
            notes.append(f"{a // 60:02d}:{a % 60:02d}: no clip at that time — FIX stands")
        for e in hits:
            key = (e["who"], e["text"])
            if key in seen:
                continue
            seen.add(key)
            lang = "en" if e["who"] == "cue" else "it"
            ratio, heard = qc_clip(baker.raw(*key), e["text"], lang)
            same = _words(_norm(_spell_numbers(heard, lang))) == _words(_norm(e["text"]))
            db = tail_db(baker.clip(*key))
            good = same and db <= TAIL_MAX_DB
            ok = ok and good
            notes.append(f"{e['t'] // 60:02.0f}:{e['t'] % 60:02.0f} {e['text']!r}: ASR heard {heard!r} "
                         f"({'same words' if same else 'WORDS DIFFER'}) · ends at {db:.0f} dBFS "
                         f"({'fades out' if db <= TAIL_MAX_DB else 'HARD CUT'}) -> {'clean' if good else 'CONFIRMED'}")
    return ok, notes


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("cmd", choices=["validate", "plan", "build", "listen", "recheck"])
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
    if a.cmd in ("listen", "recheck"):
        text = listen(a.lesson_dir) if a.cmd == "listen" else open(os.path.join(a.lesson_dir, "audio", "pimsleur.listen.md")).read()
        print(text)
        if "VERDICT: PASS" in text:
            sys.exit(0)
        ok, notes = recheck(a.lesson_dir, text)
        print("\n".join(notes))
        with open(os.path.join(a.lesson_dir, "audio", "pimsleur.listen.md"), "a") as f:
            f.write("\n## Auto re-check (measured)\n" + "\n".join(f"- {n}" for n in notes) + "\n"
                    + ("VERDICT: PASS (re-checked: every flagged clip measured clean)\n" if ok else ""))
        sys.exit(0 if ok else 1)
    report = build(a.lesson_dir, a.qc, a.engine)
    sys.exit(QC_FAILED if report["failed"] else 0)   # a crash exits 1, so the chain can tell the two apart


if __name__ == "__main__":
    main()
