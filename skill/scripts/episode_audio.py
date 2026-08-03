#!/usr/bin/env python3
"""Chiron VIDEO-EPISODE — Phase-3 DUAL-SURFACE Lucrezia bake (author → fast-bake → splice → player).

Turns the enriched transcript.json into the audio layer for BOTH surfaces from ONE per-scene timeline:
  scene.audio_timeline = [ {type:"tts",role,text,seg}     ← Lucrezia (baked, lucrezia_italian)
                           {type:"clip",line_i,start,end,repeat?}  ← the REAL scene audio
                           {type:"pause",ms} ]
- VIDEO surface: the player renders the timeline as a PLAYLIST — play the TTS mp3, then SEEK the <video>
  to a clip's [start,end] and play it live, then continue. No clip is baked (the video has it).
- AUDIO-PODCAST surface (screen off): the clip audio is CUT from the episode and SPLICED between the TTS
  into one continuous per-scene mp3 (+ a whole-episode podcast). This is the only path that cuts clips.

FAST bake = the Modal L4 lane (bucketed, concurrent — the rolling-window of workers), byte-identical to the
Mac omnivoice sidecar, -16 LUFS. Slow/overnight = the Mac sidecar (not used here). Stages are independent +
resumable (scene-level). Radio-D: difficulty scales scaffolding; key lines are REPLAYED (heard twice).

Run:  ~/miniconda3/bin/python3 episode_audio.py <episode_dir> --video-src <mkv> \
        [--stage author|bake|splice|player|all] [--scenes N] [--engine modal|mac] [--force]
"""
from __future__ import annotations
import argparse, asyncio, json, os, re, subprocess, sys, tempfile
from pathlib import Path

sys.stdout.reconfigure(line_buffering=True)
sys.path.insert(0, str(Path(__file__).resolve().parent))
import episode_enrich as EN

HOME = Path(os.path.expanduser("~"))
SKILL = Path(os.environ.get("CHIRON_SKILL", HOME / "Documents/code/chiron/skill"))
MODAL_SYNTH = SKILL / "modal" / "modal_synth.py"
VOICES = json.loads((HOME / ".chiron/voices.json").read_text())
VOICE_EN = "lucrezia_italian"           # English narration → her Italian voice too (EN ref retired; she code-switches EN/IT in one voice)
VOICE_IT = "lucrezia_italian"           # cited Italian words → the ITALIAN voice (correct pronunciation)
LUFS = -16                               # R-CH1 podcast/audiobook loudness
WHISPER = os.environ.get("CHIRON_WHISPER_URL", "http://192.168.0.159:8766").rstrip("/")  # Mac ASR sidecar
QC_MODEL = os.environ.get("CHIRON_AUDIO_QC_MODEL", "gemini-flash-latest")                # content QC (survivors)


def voice_for(lang: str) -> str:
    return VOICE_IT if (lang or "en").lower().startswith("it") else VOICE_EN


# Pre-rendered short-word library (built by build_audio_library.py) — clitics/function words a TTS can't voice
# solo. The normalize stage SPLICES these in when a run synthesizes near-silent (self-healing).
AUDIO_LIB = HOME / ".chiron" / "audio-library"


def library_clip(voice: str, text: str) -> Path | None:
    slug = re.sub(r"[^a-z0-9']+", "", (text or "").strip().lower())
    if not slug:
        return None
    p = AUDIO_LIB / voice / f"{slug}.wav"
    return p if p.is_file() else None


# EXACT canonical values from lib/schemas/lecture-script.ts `GAP_MS` — DO NOT invent; this is what every
# Chiron language lesson uses (PRD chiron_audio_lecture_2026-06-09). word=60ms is a tight, near-imperceptible
# micro-gap so an Italian word inside an English clause flows; only real boundaries get an audible pause.
GAP_MS = {"word": 60, "clause": 400, "sentence": 900, "paragraph": 1800}

# ── Bilingual SAFETY-NET splitter ─────────────────────────────────────────────
# The author is TOLD to give every Italian word its own `it` run, but the LLM is imperfect and leaves cited
# Italian inside `en` runs → mispronounced in the English voice + shown English-colored in the read-along.
# This deterministically pulls cited Italian OUT of `en` runs (accented word · apostrophe-truncation ·
# a lowercase word that appears in THIS scene's Italian dialogue). Names/English stay `en` (Capitalized skip).
_ACCENT = re.compile(r"[àèéìòùáéíóúÀÈÉÌÒÙ]")
_IT_TRUNC = re.compile(r"^'(st[oaie]|sta|ste|nfami|na|no|sti)$|^(po|mo|be|va)'$", re.I)  # 'sto, po', va'…
_EN_SAFE = {"the","and","for","but","she","says","just","like","that","this","with","word","very","real",
            "here","them","idiom","idea","name","command","informal","means","meaning","dead","fine","note",
            "come","done","pane","male","dire","sole","tale","time","some","made","case","base","dose","role"}
# Italian discourse words/greetings Lucrezia says in her narration (not in the dialogue, un-accented, so nothing
# else catches them) — VERIFIED leaking into en runs: "ciao" ×49, "a presto" ×32 across E01+E02. Unambiguously
# Italian (never English), so retag to the Italian voice even sentence-initial (Capitalized). Extend as needed.
_IT_DISCOURSE = {"ciao","presto","allora","figurati","figurate","scusa","scusi","prego","magari","boh","davvero",
                 "comunque","insomma","cioè","dai","ecco","senti","senta","guarda","proprio","benissimo","bravo",
                 "brava","grazie","salve","buongiorno","buonasera","arrivederci","perfetto","esatto","certo","allora"}
# NEUTRAL words that flow in EITHER voice (the learner's name — sounds the same IT/EN) → they inherit the
# language of the run they sit in, so "Ciao Gyasi" / "a presto Gyasi" stays ONE fluid Italian phrase (no
# mid-greeting voice switch), while "So, Gyasi, listen…" stays English. Sourced from the persona LEARNER name.
_NEUTRAL_NAMES = {"gyasi", "giasi"}

def _dialogue_it_tokens(scene: dict) -> set:
    """Italian words actually SPOKEN in this scene (ground truth), FILTERED through lingua so English that
    leaks into a dialogue line (song lyrics, English phrases) doesn't pollute the set. A dialogue token counts
    as Italian evidence only if it's accented OR lingua confirms Italian ≥0.80."""
    toks = set()
    for l in (scene.get("lines") or []):
        for w in re.findall(r"[a-zA-Zàèéìòùáéíóú']+", (l.get("italian_text") or "").lower()):
            if len(w) >= 4:
                toks.add(w)
    toks -= _EN_SAFE
    d = _lingua()
    if not d:
        return toks
    keep = set()
    for w in toks:
        if _ACCENT.search(w):
            keep.add(w); continue
        try:
            c = d.compute_language_confidence_values(w)
            if c and c[0].language.name == "ITALIAN" and c[0].value >= 0.80:
                keep.add(w)
        except Exception:
            keep.add(w)
    return keep

# lingua: contextual language-ID over MIXED text (catches Italian Lucrezia introduces that isn't in the
# dialogue — "a presto", "figurati"). Per-word LID is too noisy on short words; its detect_multiple_languages_of
# reads whole-run CONTEXT and never false-flags pure English. Lazy-loaded once; graceful no-op if absent.
_LID = False
def _lingua():
    global _LID
    if _LID is False:
        try:
            from lingua import Language, LanguageDetectorBuilder
            _LID = LanguageDetectorBuilder.from_languages(Language.ENGLISH, Language.ITALIAN)\
                .with_preloaded_language_models().build()
        except Exception as e:
            print(f"[audio] lingua unavailable ({e}); using heuristic-only bilingual split", flush=True)
            _LID = None
    return _LID

def _lingua_it_word(word: str) -> bool:
    """PRECISION-first: only a long, lowercase word that lingua is VERY sure is Italian (≥0.90). Short/ambiguous
    words (where per-word LID is noisy — 'idiom'→IT 0.74, 'come'→IT 0.51) are excluded by the length gate."""
    d = _lingua()
    if not d or len(word) < 5 or not word.islower():
        return False
    try:
        c = d.compute_language_confidence_values(word)
        return bool(c) and c[0].language.name == "ITALIAN" and c[0].value >= 0.90
    except Exception:
        return False

def split_cited_italian(runs: list[dict], itset: set) -> list[dict]:
    """Word-level: within each `en` run, retag cited-Italian words as `it` and coalesce back into runs."""
    out: list[dict] = []
    for r in runs:
        if r.get("lang") != "en":
            out.append(r); continue
        gap = r.get("gapAfter", "sentence")
        cur = None; buf = []
        def flush():
            if buf:
                out.append({"lang": cur, "text": " ".join(buf), "gapAfter": "word"})
        for w in r["text"].split(" "):
            if not w:
                continue
            core = re.sub(r"^[«»\"'“”‘’(–—\-]+|[«»\"'“”‘’.,;:!?)…–—\-]+$", "", w)
            lc = core.lower()
            # Italian only when CERTAIN: an Italian discourse word (allowlist, even Capitalized) · accented ·
            # apostrophe-truncation · a dialogue-grounded+lingua-confirmed token. No free-floating per-word LID
            # (verified: it mislabels English — "have"/"alone"/"idiom" — at this granularity).
            certain = bool(_ACCENT.search(core)) or bool(_IT_TRUNC.match(core)) or (len(lc) >= 4 and lc in itset)
            is_it = bool(core) and (lc in _IT_DISCOURSE or (certain and not core[:1].isupper()))
            if lc in _NEUTRAL_NAMES:
                lang = "it" if cur == "it" else "en"   # the name flows in whatever run it sits in
            else:
                lang = "it" if is_it else "en"
            if lang != cur and buf:
                flush(); buf = []
            cur = lang
            buf.append(core if lang == "it" else w)   # it → cleaned word (no quotes) so TTS says just it
        flush()
        if out:
            out[-1]["gapAfter"] = gap                  # last piece keeps the run's original boundary
    return _absorb_tiny_it(out)


def _absorb_tiny_it(runs: list[dict]) -> list[dict]:
    """BACKSTOP for the phrase-level rule: a TTS can't voice a lone tiny clitic (lo/ti/ci/'sto/che) — it comes
    out silent/cut-off/robotic. So never let a single short Italian word stand alone: merge it INTO an adjacent
    Italian phrase (keeps it Italian + voiceable), or if it's surrounded by English, demote it to English (the
    English narration is what explains it anyway). Discourse words (ciao/presto) and the learner name are exempt."""
    CLITIC_MAX = 4
    def tiny(r):
        lc = (r.get("text") or "").strip().lower()
        return (r.get("lang") == "it" and len(lc.split()) == 1 and len(lc) <= CLITIC_MAX
                and lc not in _IT_DISCOURSE and lc not in _NEUTRAL_NAMES)
    src = [dict(r) for r in runs]
    result: list[dict] = []
    for idx, r in enumerate(src):
        if tiny(r):
            if result and result[-1]["lang"] == "it":                      # glue onto the previous Italian phrase
                result[-1]["text"] += " " + r["text"]; result[-1]["gapAfter"] = r.get("gapAfter", "word"); continue
            if idx + 1 < len(src) and src[idx + 1]["lang"] == "it":         # glue onto the next Italian phrase
                src[idx + 1]["text"] = r["text"] + " " + src[idx + 1]["text"]; continue
            r = dict(r); r["lang"] = "en"                                   # isolated → let English carry it
        if result and result[-1]["lang"] == r["lang"]:                     # coalesce same-language neighbors
            result[-1]["text"] += " " + r["text"]; result[-1]["gapAfter"] = r.get("gapAfter", "word")
        else:
            result.append(dict(r))
    return _join_lead_prep(result)


_PULL_A = {"presto", "dopo", "domani", "proposito", "casa", "posto"}   # fixed IT expressions: "a presto", "a dopo"…
def _join_lead_prep(runs: list[dict]) -> list[dict]:
    """Keep fixed Italian expressions whole: if an `it` run starts with 'presto'/'dopo'… and the previous `en`
    run ENDS in a lone 'a'/'ad', pull that preposition into the Italian run so 'a presto' is one clean phrase
    (not en 'a' + it 'presto' — which the TTS glitches into 'tresto' / drops the 'a')."""
    for i in range(1, len(runs)):
        prev, cur = runs[i - 1], runs[i]
        if cur["lang"] != "it" or prev["lang"] != "en":
            continue
        cw = cur["text"].split()
        first = cw[0].strip(",.;:!?«»\"'").lower() if cw else ""
        pw = prev["text"].split()
        last = pw[-1].strip(",.;:!?—-«»\"'").lower() if pw else ""
        if first in _PULL_A and last in ("a", "ad"):
            cur["text"] = pw[-1].strip(",.;:!?—-«»\"'") + " " + cur["text"]
            prev["text"] = " ".join(pw[:-1]).rstrip(" —-,")
    return [r for r in runs if r["text"].strip()]


# ── Stage AUTHOR (LLM → per-scene script, then deterministic timeline assembly) ──
def _author_prompt(scene: dict) -> str:
    band = (scene.get("difficulty") or {}).get("band", "medium")
    n_key = {"easy": 2, "medium": 3, "hard": 4}.get(band, 3)
    vs = scene.get("visual_situation") or {}
    lines = [{"i": i, "who": l.get("character", "?"), "it": l.get("italian_text", ""),
              "en": l.get("en_gloss", ""), "note": l.get("teaching_note") or ""}
             for i, l in enumerate(scene.get("lines") or [])]
    ctx = {"title": scene.get("title"), "situation": scene.get("situation"),
           "on_screen": vs.get("en"), "difficulty": band,
           "target_structures": scene.get("target_structures"),
           "speech_acts": [a.get("function") for a in (scene.get("speech_acts") or [])]}
    return (
        f"You are Lucrezia — a warm, fond Italian tutor teaching {EN.LEARNER} (native English). Author the "
        "SPOKEN lesson for ONE scene of an Italian TV episode. Your audio must work SCREEN-OFF (a listener who "
        "cannot see the video), so DESCRIBE what happens on screen, then teach the Italian of the key lines.\n\n"
        "## SCENE\n" + json.dumps(ctx, ensure_ascii=False) + "\n## LINES\n" + json.dumps(lines, ensure_ascii=False) + "\n\n"
        f"This is a **{band}** scene → author about {n_key} key lines (harder scene = more scaffolding).\n\n"
        "## BILINGUAL SPLIT — the SAME rule every Chiron language lesson uses (this is what makes pronunciation right):\n"
        "Each spoken field is an ARRAY of segments "
        '[{"lang":"en"|"it","text":"...","gapAfter":"word"|"clause"|"sentence"}]. English is the medium (`en`); '
        "cited Italian goes in `it` segments so it gets the Italian voice — NEVER leave Italian inside an `en` "
        "segment (it'd be mispronounced in the English accent).\n"
        "★ CITE ITALIAN AS WHOLE PHRASES, NEVER A LONE TINY WORD (critical — this is what makes the audio clean):\n"
        "  • An `it` segment must be a REAL PHRASE — at least 2-3 words, ideally the actual line or clause. A bare "
        "one- or two-letter grammatical word (a clitic/article/pronoun like lo, la, ti, ci, ne, gli, 'sto, che, un) "
        "on its OWN cannot be voiced cleanly — it comes out silent, cut-off, or robotic. So NEVER put a lone clitic "
        "in its own `it` segment.\n"
        "  • To teach one of those small words, say the WHOLE Italian phrase once (in an `it` segment), then in "
        "ENGLISH name the little word and point to where it sits — the English carries the grammar, the Italian "
        "stays a natural phrase. E.g. teach 'lo' like this:\n"
        '    [{"lang":"en","text":"She says","gapAfter":"word"},{"lang":"it","text":"te lo recupero io","gapAfter":"clause"},'
        '{"lang":"en","text":"— I\'ll get it back for you. That little","gapAfter":"word"},'
        '{"lang":"it","text":"lo","gapAfter":"word"},'          # only ever as a QUICK pointer, and even better: don't isolate it
        '{"lang":"en","text":"is \'it\' — the scooter.","gapAfter":"sentence"}]\n'
        "  Prefer NOT isolating the clitic at all — just say the phrase in Italian and explain the word in English "
        "(\"the te-lo there means she'll get IT back\"). Isolated Italian words are the #1 cause of broken audio.\n"
        "FLOW: the English↔Italian switch must sound like ONE natural sentence. Tag a mid-phrase switch "
        '`gapAfter:"word"` (a tight 60ms micro-gap); a comma gets `"clause"`, a true sentence end `"sentence"`.\n'
        "NO REPETITION: the learner ALSO hears the real clip's authentic Italian, so do NOT mechanically "
        "re-translate every word or echo English-Italian-English. Teach each key phrase ONCE, conversationally.\n"
        "★ ORDER (critical — stops the 'she says it twice before the clip' problem): the ACTOR delivers each line "
        "first, THEN Lucrezia repeats + teaches it in `explain`. So a line's Italian is voiced exactly TWICE total "
        "— once by the actor (the clip), once in `explain`. NEVER voice that line's Italian in its `intro` (an "
        "`intro` that says the Italian makes the learner hear it before the clip AND in explain = three times), and "
        "do NOT re-voice it again in `debrief`. `intro` and `prebrief` are ENGLISH-only.\n\n"
        "## OUTPUT — return ONLY this JSON (segments = what Lucrezia SAYS, warm, spoken aloud):\n"
        "{\n"
        '  "prebrief": [<segments: greet '+EN.LEARNER+' briefly, set the scene from on_screen (who/where/what '
        'happens), name 1-2 things to listen for; works eyes-closed>],\n'
        '  "key_lines": [{"line_i": <index from LINES>, "intro": [<ONE short ENGLISH-ONLY hand-off to the clip, e.g. '
        '"Listen:" or "Watch how she answers" — do NOT say the line\'s Italian here (the actor says it next) and do '
        'NOT repeat what prebrief already framed>], '
        '"explain": [<segments: meaning + the ONE teaching point (word/grammar/register/speech-act); each cited '
        'Italian as its own it segment, flowing>]}],\n'
        '  "debrief": [<segments: what happened + the 1-2 phrases worth keeping; warm sign-off>]\n'
        "}\n"
        "Pick the MOST teachable lines by index. Real, grounded, conversational. Return ONLY the JSON object."
    )


def _valid_runs(v):
    if not isinstance(v, list) or not v:
        return False
    for r in v:
        if not isinstance(r, dict) or (r.get("lang") not in ("en", "it")) or not (r.get("text") or "").strip():
            return False
    return True


def _author_valid(n_lines: int):
    def _v(o):
        iss = []
        if not _valid_runs(o.get("prebrief")): iss.append("prebrief must be a non-empty array of {lang:en|it,text} runs")
        if not _valid_runs(o.get("debrief")): iss.append("debrief must be a non-empty array of {lang:en|it,text} runs")
        kl = o.get("key_lines")
        if not isinstance(kl, list) or not kl: iss.append("key_lines must be a non-empty list")
        else:
            for k in kl:
                if not isinstance(k, dict): iss.append("each key_line is an object"); break
                li = k.get("line_i")
                if not isinstance(li, int) or not (0 <= li < n_lines):
                    iss.append(f"line_i {li} out of range 0..{n_lines-1}")
                if not _valid_runs(k.get("intro")) or not _valid_runs(k.get("explain")):
                    iss.append("each key_line needs intro + explain as {lang,text} run arrays")
        return iss or None
    return _v


def assemble_timeline(scene: dict, script: dict) -> list[dict]:
    """Deterministic: interleave Lucrezia TTS with the REAL clip time-ranges (accurate, not hallucinated)."""
    lines = scene.get("lines") or []
    band = (scene.get("difficulty") or {}).get("band", "medium")
    itset = _dialogue_it_tokens(scene)
    def _runs(v):   # normalize a runs array; DROP punctuation-only runs (a lone "." / "—" synths to silence + has no speech)
        out = []
        for r in (v or []):
            t = (r.get("text") or "").strip()
            if not t or not re.search(r"[a-zA-Zà-ùÀ-Ù]", t):   # no letters → pure punctuation, skip
                continue
            out.append({"lang": r["lang"], "text": t,
                        "gapAfter": r.get("gapAfter") if r.get("gapAfter") in GAP_MS else "sentence"})
        return split_cited_italian(out, itset)   # SAFETY NET: pull cited Italian out of en runs → it voice
    tl: list[dict] = [{"type": "tts", "role": "prebrief", "runs": _runs(script["prebrief"])},
                      {"type": "pause", "ms": 500}]
    for k in script.get("key_lines", []):
        li = k["line_i"]
        if not (0 <= li < len(lines)):
            continue
        l = lines[li]
        try:
            st, en = float(l["start"]), float(l["end"])
        except Exception:
            continue
        # DETERMINISTIC GUARD: the intro is an ENGLISH-only hand-off — strip any Italian the author slipped in
        # (voicing the line before the clip = the 'she says it twice before the clip' bug). Drop it if empty.
        intro_runs = [r for r in _runs(k["intro"]) if r.get("lang") != "it"]
        if intro_runs:
            tl.append({"type": "tts", "role": "intro", "runs": intro_runs})
            tl.append({"type": "pause", "ms": 250})
        tl.append({"type": "clip", "line_i": li, "start": round(st, 2), "end": round(en, 2)})
        tl.append({"type": "pause", "ms": 350})
        tl.append({"type": "tts", "role": "explain", "runs": _runs(k["explain"])})
        if band == "hard":     # Radio-D #3: replay the hard line, heard twice
            tl.append({"type": "pause", "ms": 300})
            tl.append({"type": "clip", "line_i": li, "start": round(st, 2), "end": round(en, 2), "repeat": True})
        tl.append({"type": "pause", "ms": 600})
    tl.append({"type": "tts", "role": "debrief", "runs": _runs(script["debrief"])})
    return tl


async def stage_author(data: dict, todo: list[dict]):
    done = 0
    for sc in todo:
        n = len(sc.get("lines") or [])
        if not n:
            continue
        script = await EN.json_with_repair(_author_prompt(sc), f"scene{sc['scene']}-audio",
                                           validate_fn=_author_valid(n))
        if script is None:
            print(f"[audio] scene {sc['scene']}: authoring exhausted — skipped", flush=True)
            continue
        sc["audio_timeline"] = assemble_timeline(sc, script)
        nt = sum(1 for s in sc["audio_timeline"] if s["type"] == "tts")
        nc = sum(1 for s in sc["audio_timeline"] if s["type"] == "clip")
        done += 1
        print(f"[audio] scene {sc['scene']} ✓ timeline: {nt} tts · {nc} clips", flush=True)
    return done


# ── Stage BAKE (Modal fast-bake the TTS segments) ─────────────────────────────
def _norm(src: Path, dst: Path, target: float = LUFS):
    """Normalize a TTS run to `target` LUFS by MEASURE-then-GAIN + limiter. Single-pass loudnorm mangles
    short TTS runs — verified crushing normal words to −31/−34/−38 LUFS at random ("some clips super low").
    Measure the integrated LUFS, apply the exact gain, cap peaks. Deterministic + length-independent."""
    i = _lufs(src)
    gain = (target - i) if i is not None else 0.0
    gain = max(-9.0, min(gain, 18.0))     # bound: never blow up a near-silent synth artifact
    subprocess.run(["ffmpeg", "-y", "-i", str(src), "-af",
                    f"volume={gain:.1f}dB,alimiter=limit=0.9:level=disabled", "-ar", "24000", "-ac", "1", str(dst)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _seg_hash(seg: dict) -> str:
    """Content hash of a TTS segment's runs (voice-determining lang + text). Re-baking skips a segment whose
    hash is unchanged AND whose raw wavs exist — economy-first: never re-pay Modal for identical audio."""
    import hashlib
    key = json.dumps([[r.get("lang"), r.get("text")] for r in (seg.get("runs") or [])], ensure_ascii=False)
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def stage_bake(data: dict, out: Path, engine: str, scenes: list[dict], force: bool = False):
    segdir = out / "audio" / "seg"; segdir.mkdir(parents=True, exist_ok=True)
    rawdir = out / "audio" / "raw"; rawdir.mkdir(parents=True, exist_ok=True)
    hp = rawdir / ".bakehash.json"                       # per-episode seg content hashes (incremental bake)
    prev = {}
    if hp.exists() and not force:
        try: prev = json.loads(hp.read_text())
        except Exception: prev = {}
    # each TTS segment = an ordered list of language RUNS; each run → one synth job with its own voice.
    sections: dict[str, list[dict]] = {}                 # sid → [{voice,lang,text}]  (Modal job)
    seg_runs: list[tuple[str, int, dict, list[int]]] = []  # (sid, seg_ordinal, seg, [run_i in section])
    used_voices = set(); curhash = {}; skipped = 0
    for sc in scenes:
        tl = sc.get("audio_timeline") or []
        sid = f"scene{sc['scene']}"; run_i = 0; seg_i = 0
        for seg in tl:
            if seg["type"] != "tts":
                continue
            nruns = len(seg.get("runs") or [])
            h = _seg_hash(seg); key = f"{sid}:{seg_i}"; curhash[key] = h
            raws_ok = nruns and all((rawdir / sid / f"s{seg_i}_r{k}.wav").is_file() for k in range(nruns))
            if not force and prev.get(key) == h and raws_ok:
                skipped += 1; seg_i += 1; continue        # UNCHANGED → keep existing raws, don't re-synth
            idxs = []
            for run in (seg.get("runs") or []):
                v = voice_for(run["lang"]); used_voices.add(v)
                sections.setdefault(sid, []).append({"voice": v, "lang": run["lang"], "text": run["text"]})
                idxs.append(run_i); run_i += 1
            seg_runs.append((sid, seg_i, seg, idxs)); seg_i += 1
    total = sum(len(v) for v in sections.values())
    if skipped:
        print(f"[audio] incremental: {skipped} segments unchanged (skip) · {len(seg_runs)} to (re)bake", flush=True)
    if not total:
        print("[audio] nothing to bake — all segments unchanged.", flush=True)
        hp.write_text(json.dumps(curhash)); return 0

    refs = {}
    for v in used_voices:
        vr = VOICES[v]; refs[v] = {"wav": os.path.basename(vr["refAudio"]), "txt": vr["refText"]}
    print(f"[audio] ⚡ {engine.upper()} bake: {total} runs · {len(seg_runs)} segments · voices={sorted(used_voices)}", flush=True)

    rawdir = out / "audio" / "raw"; rawdir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="epbake-") as td:
        pref = Path(td) / "pref"
        if engine == "modal":
            job = {"slug": out.name, "num_step": 48, "bucket": 8, "refs": refs, "sections": sections}
            jp = Path(td) / "job.json"; jp.write_text(json.dumps(job))
            # timeout SCALES with run count (a 32-scene episode ≈ 1300 runs blew the old fixed 1800s)
            _to = max(1800, total * 5 + 600)
            r = subprocess.run(["python3", str(MODAL_SYNTH), str(jp), str(pref)],
                               capture_output=True, text=True, timeout=_to)
            res = json.loads((r.stdout.strip().splitlines() or ["{}"])[-1]) if r.stdout.strip() else {}
            if res.get("error") or not res.get("clips"):
                sys.exit(f"[audio] Modal bake failed: {res.get('error') or r.stderr[-300:]}")
            print(f"[audio] ⚡ Modal returned {res['clips']} clips · {res.get('synth_s')}s GPU-synth", flush=True)
        else:
            _mac_bake(sections, pref)
        # persist the RAW (un-normalized) run wavs — normalize+splice is a SEPARATE re-runnable stage, so
        # re-leveling never re-synthesizes (no Modal). Named s<segOrdinal>_r<runInSeg>.wav per scene.
        saved = 0
        for sid, seg_i, seg, idxs in seg_runs:
            (rawdir / sid).mkdir(parents=True, exist_ok=True)
            for k_local, k in enumerate(idxs):
                raw = pref / sid / f"{k}.wav"
                if raw.is_file():
                    (rawdir / sid / f"s{seg_i}_r{k_local}.wav").write_bytes(raw.read_bytes()); saved += 1
    hp.write_text(json.dumps(curhash))   # persist current hashes so the NEXT bake/rebake is truly incremental
    print(f"[audio] saved {saved}/{total} raw run wavs → {rawdir} (next: --stage normalize)", flush=True)
    return saved


def stage_normalize(data: dict, out: Path, scenes: list[dict]):
    """DECOUPLED normalizer (re-runnable WITHOUT re-baking): level every raw run to -16 (measure→gain→limit)
    then splice a segment's runs into one flowing utterance. Reads audio/raw/, writes audio/seg/."""
    rawdir = out / "audio" / "raw"; segdir = out / "audio" / "seg"; segdir.mkdir(parents=True, exist_ok=True)
    done = 0; total = 0
    with tempfile.TemporaryDirectory(prefix="epnorm-") as td:
        for sc in scenes:
            sid = f"scene{sc['scene']}"; seg_i = 0
            for seg in (sc.get("audio_timeline") or []):
                if seg["type"] != "tts":
                    continue
                runs = seg.get("runs") or []; n = len(runs); total += 1
                raws = [rawdir / sid / f"s{seg_i}_r{k}.wav" for k in range(n)]
                if not (n and all(r.is_file() for r in raws)):
                    print(f"[audio] {sid} seg {seg_i}: missing raw run(s) — run --stage bake first", flush=True)
                    seg_i += 1; continue
                nwavs = []
                for k, r in enumerate(raws):
                    run = runs[k]
                    src = r
                    lv = _lufs(r)
                    if lv is not None and lv < -40:   # near-silent synth → rescue from the library, AUTO-GROWING it
                        v = voice_for(run.get("lang", "it")); txt = run.get("text", "")
                        lib = library_clip(v, txt)
                        if not lib:   # word not in the library yet → carrier-synth it ONCE, cache it, reuse forever
                            try:
                                import build_audio_library as BL
                                if BL.build_words(v, [txt]):
                                    lib = library_clip(v, txt)
                            except Exception as e:
                                print(f"[audio] library auto-grow failed for '{txt[:14]}' ({e})", flush=True)
                        if lib:
                            src = lib
                            print(f"[audio] {sid} seg{seg_i} run{k} '{txt[:14]}' near-silent "
                                  f"({round(lv,1)}) → LIBRARY clip", flush=True)
                    nw = Path(td) / f"{sid}_{seg_i}_{k}.n.wav"; _norm(src, nw); nwavs.append(nw)
                mp3 = segdir / f"{sid}_{seg_i}.mp3"
                if len(nwavs) == 1:
                    subprocess.run(["ffmpeg", "-y", "-i", str(nwavs[0]), "-b:a", "128k", str(mp3)],
                                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                else:   # flowing splice — word switches ~seamless (60ms), only real ends pause
                    lines = [f"{w}|{0 if kk == len(nwavs) - 1 else GAP_MS.get((runs[kk] or {}).get('gapAfter', 'word'), 60)}"
                             for kk, w in enumerate(nwavs)]
                    man = Path(td) / f"{sid}_{seg_i}.man"; man.write_text("\n".join(lines))
                    sp = Path(td) / f"{sid}_{seg_i}.sp.wav"
                    subprocess.run(["tts-splice", str(sp), "--manifest", str(man)],
                                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    subprocess.run(["ffmpeg", "-y", "-i", str(sp), "-b:a", "128k", str(mp3)],
                                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                seg["seg"] = f"audio/seg/{mp3.name}"; done += 1; seg_i += 1
    print(f"[audio] normalized+spliced {done}/{total} segments → {segdir}", flush=True)
    return done


def _mac_bake(sections, pref: Path):
    """Slow path: Mac omnivoice :8770, one run at a time (overnight), per-run voice+language."""
    import requests
    for sid, segs in sections.items():
        (pref / sid).mkdir(parents=True, exist_ok=True)
        for i, s in enumerate(segs):
            vr = VOICES[s["voice"]]
            r = requests.post("http://192.168.0.159:8770/tts",
                              json={"text": s["text"], "language": s["lang"],
                                    "ref_audio": vr["refAudio"], "ref_text": vr["refText"],
                                    "num_step": 48, "guidance_scale": 2.0}, timeout=300)
            r.raise_for_status()
            (pref / sid / f"{i}.wav").write_bytes(r.content)


# ── Stage SPLICE (audio-podcast: cut clips + splice per scene) ─────────────────
def _lufs(src: Path):
    """Integrated LUFS via loudnorm's measurement pass. Falls back to RMS mean_volume (dBFS ≈ LUFS for speech)
    for clips too SHORT for loudnorm's integrated gate (<~0.4s — the lone clitics), so measurement + gain work
    at any length instead of returning None (which silently disables normalization)."""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(src),
                        "-af", "loudnorm=print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True)
    m = re.search(r'"input_i"\s*:\s*"?(-?\d+\.?\d*)', r.stderr)
    if m:
        v = float(m.group(1))
        if v > -70:
            return v
    r2 = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(src), "-af", "volumedetect", "-f", "null", "-"],
                        capture_output=True, text=True)
    m2 = re.search(r"mean_volume:\s*(-?\d+\.?\d*) dB", r2.stderr)
    return float(m2.group(1)) if m2 else None


def _cut_clip(video: Path, start: float, end: float, dst: Path, target: float = LUFS):
    """Cut the clip, then MEASURE-then-GAIN to `target` LUFS + limit peaks. Single-pass loudnorm
    mis-normalizes short (2-4s) dialogue clips (measured −35 LUFS on a −27 source); this hits target
    reliably so the real dialogue sits at Lucrezia's level, not ~10 dB under it."""
    raw = dst.with_name(dst.stem + ".raw.wav")
    subprocess.run(["ffmpeg", "-y", "-ss", f"{max(0,start):.3f}", "-to", f"{end:.3f}", "-i", str(video),
                    "-vn", "-ar", "24000", "-ac", "1", str(raw)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    i = _lufs(raw)
    gain = target - i if i is not None else 9.0
    gain = max(-6.0, min(gain, 18.0))     # bound the boost (silent clips shouldn't blow up)
    subprocess.run(["ffmpeg", "-y", "-i", str(raw), "-af",
                    f"volume={gain:.1f}dB,alimiter=limit=0.9:level=disabled", "-ar", "24000", "-ac", "1", str(dst)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try: raw.unlink()
    except Exception: pass


def stage_splice(data: dict, out: Path, video: Path, scenes: list[dict]):
    pdir = out / "audio" / "podcast"; cdir = out / "audio" / "clip"
    pdir.mkdir(parents=True, exist_ok=True); cdir.mkdir(parents=True, exist_ok=True)
    scene_mp3s = []
    for sc in scenes:
        tl = sc.get("audio_timeline") or []
        if not tl:
            continue
        sid = f"scene{sc['scene']}"
        manifest = []   # lines for tts-splice: /abs/wav|gap_ms
        pending_gap = 0
        with tempfile.TemporaryDirectory(prefix="epsplice-") as td:
            for j, seg in enumerate(tl):
                if seg["type"] == "pause":
                    pending_gap += int(seg.get("ms", 300)); continue
                if seg["type"] == "tts":
                    if not seg.get("seg"):
                        continue
                    src = out / seg["seg"]
                    w = Path(td) / f"t{j}.wav"
                    subprocess.run(["ffmpeg", "-y", "-i", str(src), "-ar", "24000", "-ac", "1", str(w)],
                                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                elif seg["type"] == "clip":
                    w = cdir / f"{sid}_l{seg['line_i']}{'_r' if seg.get('repeat') else ''}.wav"
                    if not w.is_file():
                        _cut_clip(video, seg["start"], seg["end"], w)
                else:
                    continue
                manifest.append(f"{w}|{pending_gap}"); pending_gap = 0
            if not manifest:
                continue
            mpath = Path(td) / "manifest.txt"; mpath.write_text("\n".join(manifest))
            scene_wav = Path(td) / "scene.wav"
            subprocess.run(["tts-splice", str(scene_wav), "--manifest", str(mpath)],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            scene_mp3 = pdir / f"{sid}.mp3"
            subprocess.run(["ffmpeg", "-y", "-i", str(scene_wav), "-b:a", "128k", str(scene_mp3)],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            sc["podcast_audio"] = f"audio/podcast/{scene_mp3.name}"
            scene_mp3s.append(scene_mp3)
            dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                        "-of", "csv=p=0", str(scene_mp3)], capture_output=True, text=True).stdout or 0)
            print(f"[audio] scene {sc['scene']} podcast ✓ {scene_mp3.name} ({dur:.0f}s)", flush=True)
    # concat all scene podcasts → episode podcast
    if len(scene_mp3s) > 1:
        lst = pdir / "concat.txt"
        lst.write_text("\n".join(f"file '{p}'" for p in scene_mp3s))
        ep = pdir / "episode-podcast.mp3"
        subprocess.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(ep)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        data["podcast_episode"] = "audio/podcast/episode-podcast.mp3"
        print(f"[audio] episode podcast ✓ {ep}", flush=True)
    return len(scene_mp3s)


# ── main ──────────────────────────────────────────────────────────────────────
def stage_qc(data: dict, out: Path, scenes: list[dict], target: float = LUFS, tol: float = 2.0,
             silent_floor: float = -40.0):
    """LOUDNESS QC GATE (local, no model — a METER beats an LLM at levels). Measures every final segment's
    integrated LUFS and flags any off-target; separately flags RAW runs that synthesized near-SILENT (which
    gain CANNOT rescue — a real synthesis failure, e.g. a lone clitic). This is the check that was missing:
    Gemini audio-QC judges CONTENT, not loudness."""
    rawdir = out / "audio" / "raw"
    off_level, near_silent, measured = [], [], 0
    for sc in scenes:
        sid = f"scene{sc['scene']}"; seg_i = 0
        for seg in (sc.get("audio_timeline") or []):
            if seg["type"] != "tts":
                continue
            if seg.get("seg") and (out / seg["seg"]).is_file():
                lv = _lufs(out / seg["seg"]); measured += 1
                if lv is not None and abs(lv - target) > tol:
                    off_level.append((sid, seg_i, seg.get("role"), round(lv, 1)))
            for k, run in enumerate(seg.get("runs") or []):
                raw = rawdir / sid / f"s{seg_i}_r{k}.wav"
                if raw.is_file():
                    lv = _lufs(raw)
                    if lv is not None and lv < silent_floor:
                        near_silent.append((sid, seg_i, run.get("lang"), (run.get("text") or "")[:28], round(lv, 1)))
            seg_i += 1
    print(f"[audio] QC LOUDNESS: {measured} segments measured · {len(off_level)} OFF-TARGET (>{tol}dB from "
          f"{target}) · {len(near_silent)} near-silent raw runs (synth failures)", flush=True)
    for b in off_level[:25]:
        print(f"  ⚠ OFF-LEVEL {b[0]} seg{b[1]} [{b[2]}] = {b[3]} LUFS", flush=True)
    for s in near_silent[:25]:
        print(f"  ⚠ NEAR-SILENT {s[0]} seg{s[1]} [{s[2]}] '{s[3]}' = {s[4]} LUFS — gain can't rescue; re-synth/merge", flush=True)
    if not off_level and not near_silent:
        print("  ✓ all segments within tolerance, no silent runs.", flush=True)
    return {"off_level": off_level, "near_silent": near_silent}


# ── Stage CONTENT-QC (whisper re-ASR gate → Gemini on survivors → auto-rebake) ─────────────────────────────
def _seg_intended(seg: dict):
    """(full text, dominant lang, it_chars, en_chars) of a segment's runs."""
    runs = seg.get("runs") or []
    text = " ".join((r.get("text") or "") for r in runs)
    it_c = sum(len(r.get("text") or "") for r in runs if r.get("lang") == "it")
    en_c = sum(len(r.get("text") or "") for r in runs if r.get("lang") == "en")
    return text.strip(), ("it" if it_c > en_c else "en"), it_c, en_c


def _words(t: str):
    return [w for w in re.findall(r"[a-zA-Zàèéìòùáéíóú']+", (t or "").lower()) if len(w) >= 3]


def _whisper_asr(mp3: Path):
    """Re-transcribe a baked segment on the Mac whisper sidecar → (asr_text, detected_language)."""
    import requests
    with open(mp3, "rb") as f:
        r = requests.post(f"{WHISPER}/transcribe", files={"file": ("a.mp3", f, "audio/mpeg")},
                          data={"response_format": "verbose_json", "model": "large-v3"}, timeout=180)
    r.raise_for_status()
    j = r.json()
    text = (" ".join(s.get("text", "") for s in j.get("segments", [])) or j.get("text", "")).strip()
    return text, (j.get("language") or "").lower()


def _gemini_audio_verdict(mp3: Path, intended: str):
    """Second opinion on a survivor: is the audio clean + natural + right language? → dict|None (None=skip)."""
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        return None
    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=key)
        prompt = ("You are an audio-QC judge for an Italian-lesson narration clip. The intended script is:\n"
                  f"«{intended[:400]}»\n\nListen to the audio and answer ONLY JSON: "
                  '{"ok": true|false, "issue": "<glitch|artifact|robotic|wrong-language|mispronounced|cut-off|none>", '
                  '"note": "<≤12 words>"}. ok=false ONLY for a real defect a listener would notice.')
        resp = client.models.generate_content(
            model=QC_MODEL,
            contents=[types.Part.from_bytes(data=mp3.read_bytes(), mime_type="audio/mpeg"), prompt])
        m = re.search(r"\{.*\}", resp.text or "", re.S)
        return json.loads(m.group(0)) if m else None
    except Exception as e:
        print(f"[audio] gemini QC skipped ({str(e)[:80]})", flush=True)
        return None


def stage_content_qc(data: dict, out: Path, scenes: list[dict], gemini: bool = False, only: set | None = None):
    """CONTENT gate (not loudness): whisper re-ASR every seg (LOCAL :8766, FREE), flag low word-coverage
    (dropped/garbled) or Italian-voiced-as-English. `gemini` (OPT-IN, default OFF — it's a PAID cloud call
    ~per audio second) adds a naturalness/glitch second-opinion on the survivors. Default whisper-only keeps
    chiron gen off Gemini (cost). No free LOCAL model gives a clean naturalness verdict — Qwen2-Audio (:8768)
    only transcribes — so deep naturalness is Gemini-or-nothing, hence opt-in. Returns {failures:[...]}."""
    fails, checked, gem_checked = [], 0, 0
    for sc in scenes:
        sid = f"scene{sc['scene']}"; seg_i = 0
        for seg in (sc.get("audio_timeline") or []):
            if seg["type"] != "tts":
                continue
            key = f"{sid}:{seg_i}"
            if only is not None and key not in only:
                seg_i += 1; continue
            mp3 = out / (seg.get("seg") or "")
            if not (seg.get("seg") and mp3.is_file()):
                seg_i += 1; continue
            intended, dom, it_c, en_c = _seg_intended(seg)
            try:
                asr, lang_det = _whisper_asr(mp3)
            except Exception as e:
                print(f"[audio] whisper failed {key} ({str(e)[:60]})", flush=True); seg_i += 1; continue
            checked += 1
            iw = _words(intended); aw = set(_words(asr))
            cov = (sum(1 for w in iw if w in aw) / len(iw)) if iw else 1.0
            reason = None
            if cov < 0.45:
                reason = f"low-coverage {cov:.0%} (dropped/garbled)"
            elif dom == "it" and lang_det == "en" and it_c >= 12:
                reason = "italian voiced as english"
            if reason is None and gemini:                    # SURVIVOR → Gemini naturalness/artifact check
                v = _gemini_audio_verdict(mp3, intended)
                if v is not None:
                    gem_checked += 1
                    if v.get("ok") is False and (v.get("issue") or "none") != "none":
                        reason = f"gemini:{v.get('issue')} ({v.get('note','')[:40]})"
            if reason:
                fails.append((sid, seg_i, reason))
                print(f"  ⚠ CONTENT {key} [{seg.get('role')}] — {reason}", flush=True)
            seg_i += 1
    mode = f"whisper+GEMINI ({gem_checked} paid audio calls)" if gemini else "whisper-only (FREE/local, no Gemini)"
    print(f"[audio] QC CONTENT [{mode}]: {checked} segments re-ASR'd · {len(fails)} failed", flush=True)
    if not fails:
        print("  ✓ content clean (no dropped words / wrong-language / glitches).", flush=True)
    return {"failures": fails}


def _rebake_segments(data, out: Path, engine, video: Path, scenes, fail_keys: set):
    """Force a re-synth of ONLY the failing segments (clear their bakehash + raws), then bake→normalize→splice."""
    if not fail_keys:
        return 0
    rawdir = out / "audio" / "raw"; hp = rawdir / ".bakehash.json"
    try:
        h = json.loads(hp.read_text()) if hp.exists() else {}
    except Exception:
        h = {}
    for k in fail_keys:
        h.pop(k, None)                                   # forget the hash → stage_bake will re-synth it
        sid, si = k.split(":")
        for f in (rawdir / sid).glob(f"s{si}_r*.wav"):
            try: f.unlink()
            except Exception: pass
    hp.write_text(json.dumps(h))
    print(f"[audio] re-baking {len(fail_keys)} failed segments…", flush=True)
    stage_bake(data, out, engine, scenes)                # incremental → only the cleared segs re-synth
    stage_normalize(data, out, scenes)
    stage_splice(data, out, video, scenes)
    return len(fail_keys)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("target", help="episode dir OR transcript.json")
    ap.add_argument("--video-src", default="", help="video for clip cutting (episode.mp4 in the dir if omitted)")
    ap.add_argument("--stage", default="all",
                    choices=["author", "bake", "normalize", "splice", "qc", "content-qc", "player", "all"])
    ap.add_argument("--deep-qc", action="store_true",
                    help="content-qc: add the PAID Gemini naturalness pass on survivors (default = whisper-only, free/local)")
    ap.add_argument("--no-gemini", action="store_true", help="(deprecated no-op — Gemini is already off by default)")
    ap.add_argument("--no-rebake", action="store_true", help="content-qc: report failures but don't auto-rebake")
    ap.add_argument("--scenes", type=int, default=0, help="limit to first N scenes (0=all) — for a fast slice")
    ap.add_argument("--engine", default="modal", choices=["modal", "mac"])
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--ladder", default="")
    args = ap.parse_args()
    if args.ladder:
        EN._DEFAULT_LADDER = args.ladder

    tpath = Path(args.target).expanduser()
    if tpath.is_dir():
        tpath = tpath / "transcript.json"
    out = tpath.parent
    data = json.loads(tpath.read_text(encoding="utf-8"))
    scenes = [s for s in (data.get("scenes") or []) if s.get("lines")]
    if args.scenes:
        scenes = scenes[:args.scenes]
    video = Path(args.video_src).expanduser() if args.video_src else (out / "episode.mp4")

    def save():
        tpath.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.stage in ("author", "all"):
        todo = [s for s in scenes if args.force or not s.get("audio_timeline")]
        print(f"[audio] AUTHOR: {len(todo)}/{len(scenes)} scenes · ladder={'->'.join(EN._ladder())}", flush=True)
        asyncio.run(stage_author(data, todo)); save()
    if args.stage in ("bake", "all"):
        stage_bake(data, out, args.engine, scenes, force=args.force); save()
    if args.stage in ("normalize", "all"):
        stage_normalize(data, out, scenes); save()
    if args.stage in ("splice", "all"):
        if not video.is_file():
            sys.exit(f"[audio] video not found for splice: {video} (pass --video-src)")
        stage_splice(data, out, video, scenes); save()
    if args.stage in ("qc", "all"):
        stage_qc(data, out, scenes)
    if args.stage in ("content-qc", "all"):
        if not video.is_file() and not args.no_rebake:
            print(f"[audio] no video for rebake ({video}) — content-qc report only", flush=True)
        n_seg = sum(1 for sc in scenes for sg in (sc.get("audio_timeline") or []) if sg["type"] == "tts")
        deep = args.deep_qc or os.environ.get("CHIRON_AUDIO_QC_DEEP") == "1"   # PAID Gemini pass: OFF by default
        res = stage_content_qc(data, out, scenes, gemini=deep)
        fails = {f"{s}:{i}" for s, i, _ in res["failures"]}
        first_failed = len(fails); rounds = 0; MAX_ROUNDS = int(os.environ.get("CHIRON_MAX_REBAKE_ROUNDS", "2"))
        # RETRY LOOP: rebake failures, re-check ONLY them; stop when clean, stalled (no improvement), or capped
        while fails and not args.no_rebake and video.is_file() and rounds < MAX_ROUNDS:
            rounds += 1
            print(f"[audio] rebake round {rounds}/{MAX_ROUNDS}: {len(fails)} segments…", flush=True)
            _rebake_segments(data, out, args.engine, video, scenes, fails); save()
            still = {f"{s}:{i}" for s, i, _ in stage_content_qc(data, out, scenes,
                                                                gemini=deep, only=fails)["failures"]}
            if len(still) >= len(fails):                       # no improvement → further rebakes won't help
                fails = still; print(f"[audio] round {rounds} cleared nothing new — stopping (synth limit)", flush=True); break
            fails = still
        residual = len(fails)
        stats = {"segments": n_seg, "first_pass_failed": first_failed, "rebake_rounds": rounds,
                 "residual_failed": residual, "resolved_by_rebake": first_failed - residual,
                 "retry_rate": round(first_failed / n_seg, 3) if n_seg else 0.0,
                 "residual_rate": round(residual / n_seg, 3) if n_seg else 0.0,
                 "rebake_fix_rate": round((first_failed - residual) / first_failed, 3) if first_failed else 1.0}
        (out / "audio" / "qc-stats.json").write_text(json.dumps(stats, indent=2))
        print(f"[audio] ── RETRY REPORT ── {n_seg} segments · first-pass defects {first_failed} "
              f"({stats['retry_rate']:.0%} needed a retry) · {rounds} rebake round(s) fixed "
              f"{stats['resolved_by_rebake']} ({stats['rebake_fix_rate']:.0%}) · residual {residual} "
              f"({stats['residual_rate']:.0%}) → audio/qc-stats.json", flush=True)
    print("[audio] DONE.", flush=True)


if __name__ == "__main__":
    main()
