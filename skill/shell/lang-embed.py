#!/usr/bin/env python3
"""lang-embed — store pre-generated English in a lesson and make its IT · IT+EN · EN switch work offline.

    lang-embed.py <lesson-dir> [<lesson-dir> ...] --map english-map.json [--units units.json --lesson-id ID]

For each lesson dir (give the source folder AND its library mirror, so the two stay identical):
  * backs up lesson.html to lesson.html.bak-lang-<ts> (first time only per run);
  * writes <dir>/lang-en.json   {key: {it, en}}  (the readable store: Italian text hash -> English);
  * replaces the block between <!--chiron-lang--> and <!--/chiron-lang--> before </body> with
      <script type="application/json" id="chiron-lang-en">{key: English}</script>
      <script id="chiron-lang-switch">… inline copy of shell/lang-switch.js …</script>
    (the server skips its own injection when it sees id="chiron-lang-switch").
The Italian text of the lesson is never touched. --map is {key: english}; --units is the extraction dump
(lang-audit extract) used to keep only the keys the lesson actually needs and to record the Italian next to them.
"""
import argparse, json, os, re, shutil, sys, time

SHELL = os.path.dirname(os.path.abspath(__file__))
BEGIN, END = "<!--chiron-lang-->", "<!--/chiron-lang-->"


def block(map_en: dict, js: str) -> str:
    data = json.dumps(map_en, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    return (f'{BEGIN}<script type="application/json" id="chiron-lang-en">{data}</script>'
            f'<script id="chiron-lang-switch">{js}</script>{END}')


def embed(d: str, keys_it: dict, map_en: dict, js: str, ts: str) -> str:
    p = os.path.join(d, "lesson.html")
    html = open(p, encoding="utf-8").read()
    need = {k: map_en[k] for k in keys_it if k in map_en} if keys_it else dict(map_en)
    html2 = re.sub(re.escape(BEGIN) + r".*?" + re.escape(END), "", html, flags=re.S)
    new = block(need, js)
    i = html2.rfind("</body>")
    html2 = html2[:i] + new + html2[i:] if i >= 0 else html2 + new
    if html2 != html:
        shutil.copy2(p, f"{p}.bak-lang-{ts}")
        open(p, "w", encoding="utf-8").write(html2)
    json.dump({k: {"it": keys_it.get(k, ""), "en": v} for k, v in need.items()},
              open(os.path.join(d, "lang-en.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return f"{d}: {len(need)} English blocks embedded" + ("" if html2 != html else " (lesson.html unchanged)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dirs", nargs="+")
    ap.add_argument("--map", required=True)
    ap.add_argument("--units")
    ap.add_argument("--lesson-id")
    a = ap.parse_args()
    map_en = json.load(open(a.map, encoding="utf-8"))
    keys_it = {}
    if a.units and a.lesson_id:
        keys_it = {u["key"]: u["it"] for u in json.load(open(a.units, encoding="utf-8"))[a.lesson_id]["units"]}
    js = open(os.path.join(SHELL, "lang-switch.js"), encoding="utf-8").read()
    if "</script" in js:
        sys.exit("lang-switch.js contains </script — cannot inline")
    ts = str(int(time.time()))
    for d in a.dirs:
        print(embed(d, keys_it, map_en, js, ts))
    return 0


if __name__ == "__main__":
    sys.exit(main())
