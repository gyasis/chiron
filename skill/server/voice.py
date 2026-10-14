"""voice — an Italian voice says a line, as an Anki-ready mp3.

Voices rotate across the "italian-listening" pool in ~/.chiron/voices.json (Lucrezia + 7 voices chosen
by ear on 2026-10-14: 3 female, 4 male) at varied speeds, so listening practice trains on many speakers,
not one. OmniVoice on the Mac (num_step 32) -> tts-normalize -16 LUFS (never ffmpeg loudnorm, R-CH1)
-> mono mp3 64k -> cached locally by text hash -> stored in Anki's media folder.
"""
import hashlib, json, os, shutil, subprocess, sys, tempfile, urllib.request
from pathlib import Path

SKILL = Path(os.environ.get("CHIRON_SKILL", Path.home() / "Documents/code/chiron/skill"))
CACHE = SKILL / "server" / "state" / "voice"
STEPS = 32
sys.path.insert(0, str(SKILL / "scripts"))
import pimsleur_drill  # noqa: E402  OV_URL + VOICES_FILE shared with the drills
import anki  # noqa: E402


class VoiceUnavailable(RuntimeError):
    """OmniVoice (or the post-processing tools) cannot produce audio."""


def _log(msg: str) -> None:
    sys.stderr.write(f"[voice] {msg}\n")


DEFAULT_VOICE = "lucrezia_italian"
SPEEDS = (0.9, 1.0, 1.0, 1.1)          # mostly natural pace, some slower / faster


def pool() -> list[str]:
    """Voice ids in the Italian listening pool (falls back to Lucrezia alone)."""
    try:
        v = json.load(open(pimsleur_drill.VOICES_FILE))
    except Exception:
        return [DEFAULT_VOICE]
    ids = sorted(k for k, x in v.items() if isinstance(x, dict) and x.get("pool") == "italian-listening")
    return ids or [DEFAULT_VOICE]


def pick(i: int, seed: str = "") -> tuple[str, float]:
    """The i-th (voice, speed) of a batch: consecutive items never share a voice."""
    ids = pool()
    off = int(hashlib.sha1(seed.encode()).hexdigest(), 16) % len(ids) if seed else 0
    return ids[(off + i) % len(ids)], SPEEDS[(i * 3 + off) % len(SPEEDS)]


def filename_for(text: str, voice: str = DEFAULT_VOICE, speed: float = 1.0) -> str:
    key = text if (voice == DEFAULT_VOICE and speed == 1.0) else f"{voice}|{speed}|{text}"
    return "chiron_" + hashlib.sha1(key.encode()).hexdigest()[:12] + ".mp3"


def _synth_wav(text: str, voice: str = DEFAULT_VOICE, speed: float = 1.0) -> bytes:
    voices = json.load(open(pimsleur_drill.VOICES_FILE))
    if voice not in voices:
        raise VoiceUnavailable(f"voice {voice!r} is not in {pimsleur_drill.VOICES_FILE}")
    ref = voices[voice]
    body = json.dumps({"text": text, "ref_audio": ref["refAudio"], "ref_text": ref["refText"],
                       "language": "it", "num_step": STEPS, "guidance_scale": 2.0,
                       "class_temperature": 0.3, "pitch_semitones": 0, "speed": speed}).encode()
    req = urllib.request.Request(f"{pimsleur_drill.OV_URL}/tts", body, {"content-type": "application/json"})
    try:
        data = urllib.request.urlopen(req, timeout=180).read()
    except Exception as e:
        raise VoiceUnavailable(f"OmniVoice unreachable at {pimsleur_drill.OV_URL}: {type(e).__name__}: {e}") from e
    if len(data) < 2000:
        raise VoiceUnavailable(f"OmniVoice returned {len(data)} bytes for {text!r}")
    return data


def _run(cmd: list[str]) -> None:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        raise VoiceUnavailable(f"{cmd[0]} failed: {(r.stderr or r.stdout)[-300:]}")


def say(text: str, voice: str = DEFAULT_VOICE, speed: float = 1.0) -> str:
    """Voice `text` with `voice` at `speed`, store it in Anki, return the media filename."""
    text = (text or "").strip()
    if not text:
        raise ValueError("say: empty text")
    name = filename_for(text, voice, speed)
    path = CACHE / name
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        _log(f"synth {name} voice={voice} speed={speed} {text[:60]!r}")
        with tempfile.TemporaryDirectory() as d:
            raw, norm = Path(d, "raw.wav"), Path(d, "norm.wav")
            raw.write_bytes(_synth_wav(text, voice, speed))
            # run under the server's own interpreter: the script's `env python3` shebang can resolve to an env
            # without pyloudnorm (it did, in the deeplake_new conda env).
            tool = shutil.which("tts-normalize") or str(Path.home() / ".local/bin/tts-normalize")
            _run([sys.executable, tool, str(raw), str(norm), "-16"])
            tmp = path.with_suffix(".tmp.mp3")
            _run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(norm), "-ac", "1", "-b:a", "64k", str(tmp)])
            tmp.replace(path)
    else:
        _log(f"cache hit {name}")
    anki.store_media(name, path.read_bytes())
    return name


def say_many(texts: list[str]) -> list[str]:
    """Sequential — the Mac TTS cannot take parallel requests."""
    return [say(t) for t in texts]
