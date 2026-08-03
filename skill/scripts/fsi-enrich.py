#!/usr/bin/env python3
"""fsi-enrich — skeleton -> a complete fsi.json, authoring only what the book lacks.

    python3 fsi-enrich.py --lesson 2 [--model qwen2.5:32b] [--force]

fsi-extract is TRANSCRIPTION: it carries across everything FSI actually prints. This
file is AUTHORSHIP, and it is deliberately narrow — it writes only the things the 1992
book cannot give a solo learner:

    * English glosses for the dialog turns   (FSI prints Italian only)
    * grammar pearls                          (the book's usage notes are one terse line)
    * three practice situations               ("create your own situation" needs a partner)
    * the live-conversation scene             (role + goal for the agent)
    * a Listening Comprehension narrative     (it was on the tape, which we do not have)
    * usage notes on the key vocabulary       (the book gives a bare gloss)

Anything the book DOES state is passed through untouched. Where a lesson genuinely has
no new material for a section, the section is dropped rather than padded — an invented
section is worse than an absent one.

Runs on the Atelier governor (memory-governed Mac ollama). Resumable: each lesson's
enrichment is cached, so a re-run costs nothing unless --force.
"""
from __future__ import annotations
import argparse, json, os, re, sys, urllib.request
from pathlib import Path

GEN  = Path.home() / "Documents/generated"
SK   = GEN / "fsi-course/skeletons"
# Ollama Cloud. Two lanes were tried and rejected first, both for documented reasons:
#   * the governed Mac lane WEDGED on a 32B load — escalating model size to chase quality
#     is exactly the failure mode the Atelier rules warn about (R-AG7);
#   * the chiron tutor service works but routes long prompts through a draft+search+
#     reconcile chain, which is right for a learner's question and far too slow for ~110
#     scripted authoring calls.
# Cloud answers this shape in ~1.5s and costs no local memory. Key: OLLAMA_API_KEY.
CLOUD = "https://ollama.com/api/chat"


def _key() -> str:
    k = os.environ.get("OLLAMA_API_KEY", "")
    if k:
        return k
    for f in (Path.home() / ".config/environment.d/ollama-cloud.conf", Path.home() / "dev/.env"):
        try:
            for line in f.read_text().splitlines():
                line = re.sub(r"^export\s+", "", line.strip())
                if line.startswith("OLLAMA_API_KEY="):
                    return line.split("=", 1)[1].strip().strip("\"'")
        except Exception:
            pass
    sys.exit("OLLAMA_API_KEY not found (see credentials-and-model-calling rules)")


def llm(prompt: str, model: str, timeout: int = 180) -> str:
    body = json.dumps({"model": model, "stream": False,
                       "messages": [{"role": "user", "content": prompt}]}).encode()
    req = urllib.request.Request(CLOUD, data=body, headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {_key()}"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d = json.loads(r.read().decode())
        return (d.get("message") or {}).get("content", "")


def as_json(text: str):
    """Models fence, prefix and editorialise. Pull the first balanced JSON value."""
    t = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
    for opener, closer in (("{", "}"), ("[", "]")):
        i = t.find(opener)
        if i < 0: continue
        depth, instr, esc = 0, False, False
        for j in range(i, len(t)):
            c = t[j]
            if instr:
                if esc: esc = False
                elif c == "\\": esc = True
                elif c == '"': instr = False
                continue
            if c == '"': instr = True
            elif c == opener: depth += 1
            elif c == closer:
                depth -= 1
                if depth == 0:
                    try: return json.loads(t[i:j + 1])
                    except Exception: break
    return None


def ask_json(prompt: str, model: str, tries: int = 3):
    for k in range(tries):
        out = as_json(llm(prompt + ("\n\nReturn ONLY valid JSON. No prose, no code fence."
                                    if k else ""), model))
        if out is not None:
            return out
        print("      (bad JSON — retrying)", flush=True)
    return None


# ── the authoring prompts ─────────────────────────────────────────────────────

def p_glosses(sk):
    lines = "\n".join(f'{i}. {t["it"]}' for i, t in enumerate(sk["dialog"]))
    return (f'Italian dialog from an FSI lesson ("{sk["title"]}"). For EACH numbered line give a '
            f'natural English translation — not word-for-word, what an English speaker would '
            f'actually say.\n\n{lines}\n\n'
            'JSON: {"en": ["<line 0>", "<line 1>", ...]} — same count and order.')


def p_pearls(sk):
    usage = sk["blocks"]["usageNotes"][:1200]
    lines = "\n".join(t["it"] for t in sk["dialog"][:12])
    return (f'You are Lucrezia, an Italian tutor. From this FSI dialog and the book\'s terse usage '
            f'note, write 2-3 GRAMMAR PEARLS for an English speaker.\n\nDIALOG:\n{lines}\n\n'
            f'BOOK NOTE:\n{usage}\n\nEach pearl: open by <strong>-defining the term, cite Italian in '
            f'<em>, end on the mistake an English speaker actually makes. 2-3 sentences. Ground them '
            f'in THIS dialog, do not teach generic grammar.\n\n'
            'JSON: {"pearls":[{"it":"<rich English teaching text with <strong>/<em>>","en":"<one-line summary>"}]}')


def p_vocab_notes(sk):
    items = [v["it"] for v in sk["vocab"][:14]]
    return (f'Italian vocabulary from an FSI lesson ("{sk["title"]}"): {json.dumps(items, ensure_ascii=False)}\n\n'
            'For the 8 most USEFUL of these, write a one-sentence usage micro-lesson — when/why an '
            'Italian actually reaches for it, or the trap for an English speaker. Wrap Italian in <em>. '
            'Skip anything obvious.\n\n'
            'JSON: {"notes":[{"it":"<the exact item>","note":"<one sentence>"}]}')


def p_situations(sk):
    lines = "\n".join(f'{t["label"]}: {t["it"]}' for t in sk["dialog"][:10])
    return (f'FSI lesson "{sk["title"]}". The book says "create your own situation" — which assumes a '
            f'classroom partner. Write THREE practice scenes instead, increasing in difficulty.\n\n'
            f'BASE DIALOG:\n{lines}\n\nEach scene: 6-8 alternating turns. The other speaker is "a"; the '
            f'learner is "learner" and every learner turn needs a short English "cue" telling them what '
            f'to say WITHOUT giving the Italian. Natural spoken Italian, same vocabulary as the lesson. '
            f'Scene 3 should go off-script (a complication: wrong information, a correction to make).\n\n'
            'JSON: {"situations":[{"id":"sit1","title":"<italian title>","level":"facile|media|difficile",'
            '"setup":"<1-2 sentences of English scene-setting>","turns":[{"who":"a|learner","label":"<speaker>",'
            '"it":"<italian>","en":"<english>","cue":"<only on learner turns>"}]}]}')


def p_live(sk):
    return (f'FSI lesson "{sk["title"]}". Configure a live role-play agent for it.\n\n'
            'JSON: {"role":"<who the agent plays, in Italian, e.g. un cameriere in un ristorante romano>",'
            '"goal":"<what the scene must accomplish, in Italian>",'
            '"setup":"<2 sentences in English telling the learner what to expect>"}')


def p_lc(sk, has_options):
    lines = "\n".join(t["it"] for t in sk["dialog"][:10])
    if has_options:
        return (f'FSI Listening Comprehension. The book prints these options but its narrative was on a '
                f'tape we do not have. Write a SHORT Italian narrative (3-4 sentences) that makes exactly '
                f'ONE option per question correct.\n\nDIALOG CONTEXT:\n{lines}\n\n'
                f'QUESTIONS:\n{json.dumps([q["options"] for q in sk["mcq"]], ensure_ascii=False, indent=1)}\n\n'
                'JSON: {"text":"<italian narrative>","en":"<english>","answers":[<0-based index per question>]}')
    return (f'FSI lesson "{sk["title"]}" has no Listening Comprehension section. Write one.\n\n'
            f'DIALOG CONTEXT:\n{lines}\n\nA short Italian narrative (3-4 sentences) about someone in this '
            f'situation, then 4 comprehension questions. Keep the OPTIONS IN ENGLISH — FSI does this on '
            f'purpose, to test understanding rather than production. Exactly one correct option each, the '
            f'distractors plausible (wrong tense, wrong person, wrong number).\n\n'
            'JSON: {"text":"<italian narrative>","en":"<english>","questions":[{"stem":"<short italian stem>",'
            '"options":["<a>","<b>","<c>","<d>"],"answer":<0-3>,"why":["<why a>","<why b>","<why c>","<why d>"]}]}')


def p_prose(sk):
    return (f'FSI lesson "{sk["title"]}".\n\nCULTURAL NOTE (scanned, OCR-damaged):\n'
            f'{sk["blocks"]["cultural"][:1500]}\n\nREGION SECTION (scanned):\n{sk["blocks"]["region"][:1200]}\n\n'
            'Rewrite BOTH as clean HTML paragraphs, repairing the scan damage. Keep the book\'s facts; do '
            'not invent new ones. If a section is empty, return "" for it. Italian words in <em>, key terms '
            'in <strong>. Also give the Italian title of the lesson.\n\n'
            'JSON: {"titleIt":"<italian lesson title>","cultural":"<html or empty>","culturalTitle":"<short title>",'
            '"region":"<html or empty>","regionTitle":"<region name>"}')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lesson", type=int, required=True)
    ap.add_argument("--model", default="gemma4:31b")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()

    sk_path = SK / f"lesson-{a.lesson:02d}.skeleton.json"
    if not sk_path.exists():
        sys.exit(f"no skeleton — run fsi-extract.py --lesson {a.lesson}")
    sk = json.loads(sk_path.read_text())
    cache = SK / f"lesson-{a.lesson:02d}.enrich.json"
    E = json.loads(cache.read_text()) if cache.exists() and not a.force else {}

    steps = [("prose", p_prose(sk)), ("glosses", p_glosses(sk)), ("pearls", p_pearls(sk)),
             ("vocabNotes", p_vocab_notes(sk)), ("situations", p_situations(sk)),
             ("live", p_live(sk)), ("lc", p_lc(sk, bool(sk["mcq"])))]
    for name, prompt in steps:
        if name in E:
            print(f"   {name}: cached", flush=True); continue
        print(f"   {name}: …", end="", flush=True)
        out = ask_json(prompt, a.model)
        if out is None:
            print(" FAILED (section will be omitted)", flush=True); continue
        E[name] = out
        cache.write_text(json.dumps(E, ensure_ascii=False, indent=2), encoding="utf-8")
        print(" ok", flush=True)

    print(f"   -> {cache}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
