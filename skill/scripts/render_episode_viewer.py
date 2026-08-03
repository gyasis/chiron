#!/usr/bin/env python3
"""
Render a self-contained HTML PLAYER from an episode transcript.json (scene→line):
a real <video> + click-a-line-seeks-the-video + click-a-chapter-seeks + the transcript
highlights the current line as it plays (the Language-Reactor/asbplayer interaction).
Data is INLINED (opens via file://). Needs a browser-playable video sibling (episode.mp4).

  render_episode_viewer.py transcript.json --out viewer.html [--video episode.mp4] [--title "..."]
"""
from __future__ import annotations
import argparse, json, html
from pathlib import Path

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("transcript")
    ap.add_argument("--out", default="")
    ap.add_argument("--video", default="", help="video file (sibling of the html); default: auto-pick the "
                                                "lightest streamable sibling (stream → mobile → original)")
    ap.add_argument("--title", default="Chiron — Episode Lesson")
    args = ap.parse_args()
    tpath = Path(args.transcript).expanduser().resolve()
    data = json.loads(tpath.read_text(encoding="utf-8"))
    out = Path(args.out).expanduser() if args.out else tpath.with_name("viewer.html")
    # VIDEO: prefer the lightest streamable sibling. The raw episode.mp4 is the 720p ~320 MB source; the
    # shipped lessons all point at episode.stream.mp4, so hardcoding the original made a fresh render
    # silently regress to the heavy file. Auto-pick unless --video says otherwise.
    video = args.video or next((n for n in ("episode.stream.mp4", "episode.mobile.mp4", "episode.mp4")
                                if (out.parent / n).exists()), "episode.mp4")
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    htmlpage = (TEMPLATE.replace("__TITLE__", html.escape(args.title))
                        .replace("__VIDEO__", html.escape(video))
                        .replace("__DATA__", payload))
    out.write_text(htmlpage, encoding="utf-8")
    # POSTER: a still shown before play (not a black box). Seek to the FIRST SPOKEN LINE — that's guaranteed
    # real content (a character on screen), skipping the black fade-in AND the abstract intro credits.
    vid = out.parent / args.video
    poster = out.parent / "poster.jpg"
    if vid.exists() and not poster.exists():
        import subprocess
        # Probe several offsets and KEEP THE FIRST NON-BLACK frame (a black fade-in / intro-credits frame
        # encodes to a tiny jpg; a real scene is larger). Timestamp-based seeking landed on black intros.
        for off in ("25", "35", "45", "15", "60", "90", "8"):
            try:
                subprocess.run(["ffmpeg", "-y", "-ss", off, "-i", str(vid), "-frames:v", "1", "-q:v", "3",
                                "-vf", "scale=854:-2", str(poster)], capture_output=True, timeout=120)
                if poster.exists() and poster.stat().st_size > 9000:   # >9KB ⇒ real (non-black) frame
                    break
            except Exception:
                pass
    # copy the tutor widget (self-contained siblings, R-CH-PIPELINE) so the "ask Lucrezia" tab is available
    shell = Path(__file__).resolve().parent.parent / "shell"
    for fn in ("tutor.js", "tutor.css"):
        src = shell / fn
        if src.exists():
            (out.parent / fn).write_bytes(src.read_bytes())
    print(f"wrote {out}")

TEMPLATE = r"""<meta charset="utf-8"><title>__TITLE__</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
@import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&family=JetBrains+Mono&display=swap');
:root{--bg:#fbf5ec;--surface:#fff;--elev:#f3e9d8;--fg:#2b1d12;--fg2:#5b4632;--muted:#8a7560;
--accent:#b3522e;--accentL:#d97a4f;--sage:#6b8e4e;--info:#386b8a;--border:#e6d5b8;--divider:#efe2c9;
--serif:'Lora','Georgia',serif;--mono:'JetBrains Mono',monospace}
*{box-sizing:border-box}html,body{margin:0;overflow-x:clip}
body{background:var(--bg);color:var(--fg);font-family:var(--serif);line-height:1.5}
h1,h2,h3{margin:0;font-family:var(--serif)}.mono{font-family:var(--mono)}.muted{color:var(--muted)}
.bar{position:sticky;top:0;z-index:20;background:rgba(251,245,236,.96);backdrop-filter:blur(6px);
border-bottom:1px solid var(--border);padding:10px 18px}
.bar .in{max-width:1240px;margin:0 auto;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.bar b{font-size:15px}.pill{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#fff;background:var(--sage);padding:3px 9px;border-radius:999px}
.wrap{max-width:1240px;margin:0 auto;padding:14px 18px 40px}
.summary{font-size:13px;color:var(--muted);margin-bottom:12px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,.05);overflow:hidden}
.card>h3{font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:var(--fg2);padding:9px 13px;border-bottom:1px solid var(--divider);background:var(--elev);display:flex;justify-content:space-between}
.main{display:grid;grid-template-columns:1.5fr 300px;gap:16px}
@media(max-width:900px){.main{grid-template-columns:1fr}}
.playerpin{position:sticky;top:var(--barh,52px);z-index:5;background:var(--bg)}   /* --barh = real header height (mobile wraps taller) so the video never slides UNDER the bar */
.vidwrap{position:relative}
video{width:100%;display:block;background:#000;border-radius:12px 12px 0 0;aspect-ratio:16/9}
.subs{position:absolute;left:0;right:0;bottom:12px;text-align:center;pointer-events:none;padding:0 4%}
.sub-it{display:inline-block;background:rgba(0,0,0,.74);color:#fff;font-size:19px;padding:3px 12px;border-radius:6px;margin:2px 0;line-height:1.3}
.sub-en{display:inline-block;background:rgba(0,0,0,.74);color:#ffeede;font-size:15.5px;font-style:italic;padding:3px 12px;border-radius:6px;margin:2px 0;line-height:1.3}
.subsbar{display:flex;align-items:center;gap:8px;padding:8px 13px;border-bottom:1px solid var(--divider);flex-wrap:wrap}
.sb-lbl{font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)}
.subtog{font-family:var(--mono);font-size:11px;border:1px solid var(--border);background:var(--surface);color:var(--fg2);border-radius:6px;padding:3px 11px;cursor:pointer}
.subtog.on{background:var(--accent);color:#fff;border-color:var(--accent)}
.sithdr{padding:11px 13px;border-top:1px solid var(--divider)}
.sithdr .loc{font-family:var(--mono);font-size:11px;color:var(--info);text-transform:uppercase;letter-spacing:.5px}
.sithdr h2{font-size:18px;margin:2px 0 4px}.sithdr .sm{font-size:13px;color:var(--fg2)}
.chars{margin-top:7px;display:flex;gap:6px;flex-wrap:wrap}
.chip{font-size:11px;font-family:var(--mono);color:#fff;padding:2px 9px;border-radius:999px}
.rail{position:sticky;top:calc(var(--barh,52px) + 12px);align-self:start;max-height:calc(100vh - var(--barh,52px) - 30px);overflow:auto}
.chap{display:flex;gap:9px;align-items:baseline;padding:9px 12px;border-bottom:1px solid var(--divider);cursor:pointer;font-size:13px}
.chap:hover{background:var(--elev)}.chap.cur{background:#fbecdf;border-left:3px solid var(--accent);padding-left:9px}
.chap .n{font-family:var(--mono);font-size:10px;color:var(--muted);width:20px;flex:none}
.chap .nm{font-weight:600}.chap .lc{margin-left:8px;font-family:var(--mono);font-size:10px;color:var(--muted)}
.cues{max-height:none}
.cue{display:grid;grid-template-columns:82px 1fr;column-gap:10px;row-gap:2px;padding:7px 12px;border-bottom:1px solid var(--divider);cursor:pointer}
.cue .who-c{grid-column:1;grid-row:1}
.cue .it-c{grid-column:2;grid-row:1}
.cue .en-c{grid-column:2;grid-row:2}
.cue:hover{background:var(--elev)}
.cue.now{background:#fbecdf;border-left:3px solid var(--accent);padding-left:9px}
.cue .who{font-family:var(--mono);font-size:11px;text-transform:uppercase;text-align:right;padding-top:2px;overflow:hidden;text-overflow:ellipsis}
.cue .t{font-family:var(--mono);font-size:9px;color:var(--muted)}
.cue .it{font-size:15.5px}.cue .en{font-size:12.5px;color:var(--muted);font-style:italic}
.cue .tn{display:block;font-size:11.5px;color:var(--sage);margin-top:3px;line-height:1.35}
.cue .tn em{font-style:normal;font-weight:600;color:var(--accent)}
.ts{margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.ts .lbl{font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)}
.ts .s{font-size:11px;background:var(--elev);border:1px solid var(--border);border-radius:6px;padding:2px 8px;color:var(--fg2)}
.diff{font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:.5px;padding:1px 8px;border-radius:999px;color:#fff;margin-left:8px}
.diff.easy{background:var(--sage)}.diff.medium{background:#b48309}.diff.hard{background:var(--accent)}
.sa{margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.sa .lbl{font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)}
.sa .s{font-size:11px;background:#f3ede0;border:1px solid var(--border);border-radius:6px;padding:2px 8px;color:var(--info);cursor:pointer}
.sa .s:hover{background:#ece2cf}.sa .s.on{background:var(--info);color:#fff;border-color:var(--info)}
.sa-detail{display:none;margin-top:7px;font-size:13px;line-height:1.4;background:var(--elev);border-left:3px solid var(--info);border-radius:0 8px 8px 0;padding:8px 12px}
.sa-detail.show{display:block}
.sa-detail .sa-fn{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--info);display:block;margin-bottom:3px}
.sa-detail .sa-it{font-weight:600;color:var(--accent)}.sa-detail .sa-en{color:var(--muted);font-style:italic}
.ddot{margin-left:auto;width:8px;height:8px;border-radius:50%;flex:none;align-self:center;background:var(--border)}
.ddot.easy{background:var(--sage)}.ddot.medium{background:#b48309}.ddot.hard{background:var(--accent)}
.vs{margin-top:8px;font-size:12.5px;color:var(--fg2);line-height:1.45;display:flex;gap:7px}
.vs .lbl{font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:var(--info);flex:none;padding-top:3px}
.vs .vtxt{font-style:italic}
.vs .vit{display:block;font-style:normal;color:var(--fg);margin-top:3px;font-size:13px}
.hint{font-family:var(--mono);font-size:10px;color:var(--muted);text-transform:none;letter-spacing:0}
/* read-along — ONE treatment: her narration as a flowing PARAGRAPH (title-card serif), a highlight that follows
   the current word, the clip's subtitle inline «quoted». Compact by default with a ⤢ Maximize to read it all. */
#lucreziaText{display:none;margin:0;padding:0 13px 8px;font-family:var(--serif);font-size:16.5px;line-height:1.95;color:var(--fg);max-height:200px;overflow:auto;border-top:1px solid var(--divider)}
#lucreziaText.show{display:block}
#lucreziaText.big{max-height:76vh}
.lt-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;margin:0 -13px 8px;padding:10px 13px 8px;background:var(--surface);border-bottom:1px solid var(--divider)}
.lt-lbl{font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)}
.lt-max{border:none;background:var(--elev);border-radius:6px;font-size:12px;padding:3px 10px;cursor:pointer;color:var(--fg2)}
.lt-max:hover{background:var(--border)}
.lt-body .lt-w{transition:background .1s ease;cursor:pointer}
.lt-body .lt-w:hover,.lt-body .lt-clip:hover{background:var(--elev);border-radius:4px}
.lt-body .lt-w.it{color:var(--accent);font-weight:600}
.lt-body .lt-w.on{background:#fbe08a;color:var(--fg);border-radius:4px;padding:0 3px}
.lt-body .lt-clip{color:var(--info);font-style:italic;cursor:pointer}
.lt-body .lt-clip::before{content:"«"}.lt-body .lt-clip::after{content:"»"}
.lt-body .lt-clip.on{background:#fbe08a;color:var(--fg);border-radius:4px;padding:0 3px;font-style:normal}
.listen{font-family:var(--serif);font-size:13px;background:var(--accent);color:#fff;border:none;border-radius:8px;padding:7px 14px;cursor:pointer;font-weight:600}
.listen:hover{background:var(--accentL)}.listen.on{background:var(--info)}
.seg-now{outline:2px solid var(--accent);outline-offset:2px}
.warn{background:#fff6e9;border:1px solid #e6c98a;color:#7a5a1e;font-size:12.5px;padding:9px 12px;border-radius:8px;margin-bottom:12px}
.listenbar{padding:8px 13px}
.modes{display:flex;gap:2px;background:var(--elev);border:1px solid var(--border);border-radius:8px;padding:2px}
.mbtn{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.5px;border:none;background:transparent;color:var(--fg2);padding:4px 11px;border-radius:6px;cursor:pointer}
.mbtn.on{background:var(--accent);color:#fff}
/* CINEMA — focus the video: hide rail + scene-teaching, IT-only subtitles under a big pinned video */
body.mode-cinema .main{grid-template-columns:1fr}
body.mode-cinema .rail{display:none}
/* CINEMA keeps the video PINNED (playerpin stays sticky) + the Lucrezia FOLLOW-ALONG — hide only the teaching
   header (.sithdr), keep the read-along (#lucreziaText) so you watch the pinned video AND read along. */
body.mode-cinema .sithdr{display:none}
body.mode-cinema .sitcard{border:none;box-shadow:none;background:transparent;padding:0;margin-top:6px}
body.mode-cinema #lucreziaText{max-height:34vh}   /* roomier read-along in cinema (no teaching card above it) */
body.mode-cinema .cue .en,body.mode-cinema .cue .tn,body.mode-cinema .en-c{display:none}
body.mode-cinema .cue{grid-template-columns:70px 1fr}
body.mode-cinema .cue .it{font-size:17px}
/* BILINGUAL — SIDE-BY-SIDE parallel text: speaker · Italian · English in columns, small scrolling video */
body.mode-bilingual .playerpin{position:static}
body.mode-bilingual .playerpin video{max-height:300px;object-fit:contain}
body.mode-bilingual .cue{grid-template-columns:70px minmax(0,1.08fr) minmax(0,1fr);column-gap:16px}
body.mode-bilingual .cue .en-c{grid-column:3;grid-row:1;border-left:1px solid var(--border);padding-left:14px}
body.mode-bilingual .cue .it{font-size:16px}
body.mode-bilingual .cue .en{font-size:14px;color:var(--fg2);font-style:normal}
body.mode-bilingual .cue .tn{margin-top:5px}
body.mode-bilingual #cueHdr{display:grid}
#cueHdr{display:none;grid-template-columns:70px minmax(0,1.08fr) minmax(0,1fr);column-gap:16px;padding:6px 12px;border-bottom:1px solid var(--border);font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)}
#cueHdr .en-h{border-left:1px solid var(--border);padding-left:14px}
/* PODCAST — audio-first / mobile: hide the video, big scrollable dialogue, fixed bottom player */
body.mode-podcast .playerpin,body.mode-podcast .rail,body.mode-podcast .sitcard{display:none}
body.mode-podcast .main{grid-template-columns:1fr}
body.mode-podcast .wrap{padding-bottom:96px}
body.mode-podcast .cue .it{font-size:16px}
/* bottom mini-player */
#podbar{display:none}
body.mode-podcast #podbar{display:block;position:fixed;left:0;right:0;bottom:0;z-index:40;
  background:var(--surface);border-top:1px solid var(--border);box-shadow:0 -4px 16px rgba(0,0,0,.08)}
#podSeek{width:100%;display:block;margin:0;height:4px;accent-color:var(--accent);cursor:pointer}
.pod-row{display:flex;align-items:center;gap:10px;padding:8px 14px;max-width:1240px;margin:0 auto}
.pod-btn{border:none;background:transparent;color:var(--fg);font-size:20px;cursor:pointer;padding:4px;line-height:1}
.pod-play{background:var(--accent);color:#fff;border-radius:50%;width:40px;height:40px;font-size:16px;flex:none}
.pod-meta{flex:1;min-width:0;cursor:pointer}
.pod-title{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pod-time{font-family:var(--mono);font-size:10px;color:var(--muted)}
/* maximize sheet */
#podsheet{position:fixed;inset:0;z-index:50;background:var(--bg);transform:translateY(102%);
  transition:transform .28s ease;display:flex;flex-direction:column}
#podsheet.open{transform:none}
.ps-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border);flex:none}
.ps-head button{border:none;background:var(--elev);border-radius:8px;font-size:16px;padding:6px 12px;cursor:pointer}
.ps-head b{font-size:16px}
.ps-controls{padding:16px 18px;border-bottom:1px solid var(--border);text-align:center;flex:none}
.ps-now{font-weight:600;font-size:16px;margin-bottom:12px}
#psSeek{width:100%;display:block;accent-color:var(--accent);cursor:pointer;height:5px}
.ps-time{font-family:var(--mono);font-size:11px;color:var(--muted);margin:8px 0 14px}
.ps-buttons{display:flex;align-items:center;justify-content:center;gap:34px}
.ps-nav{border:none;background:transparent;font-size:28px;cursor:pointer;color:var(--fg);line-height:1}
.ps-bigplay{border:none;background:var(--accent);color:#fff;width:66px;height:66px;border-radius:50%;font-size:26px;cursor:pointer;box-shadow:0 4px 14px rgba(179,82,46,.3)}
.ps-bigplay:hover{background:var(--accentL)}
.ps-body{flex:1;overflow:auto;padding:14px 16px 120px}
.ps-list .psi{display:flex;gap:10px;align-items:center;padding:11px 10px;border-bottom:1px solid var(--divider);cursor:pointer;border-radius:8px}
.ps-list .psi.cur{background:#fbecdf}
.ps-list .psi .n{font-family:var(--mono);font-size:11px;color:var(--muted);width:22px;flex:none}
.ps-list .psi .t{flex:1;font-weight:600;font-size:14px}
.ps-list .psi .d{font-family:var(--mono);font-size:10px;color:var(--muted)}
.ps-dlg{margin-top:18px;border-top:1px solid var(--border);padding-top:14px}
.ps-dlg .l{padding:6px 0;border-bottom:1px solid var(--divider)}
.ps-dlg .who{font-family:var(--mono);font-size:10px;text-transform:uppercase;color:var(--info)}
.ps-dlg .it{font-size:15px}.ps-dlg .en{font-size:12.5px;color:var(--muted);font-style:italic}
</style>
<link rel="stylesheet" href="tutor.css">
<div class="bar"><div class="in"><b>__TITLE__</b><span class="pill">player · click a line → seek</span>
  <span class="modes" id="modes" style="margin-left:auto"><button class="mbtn on" data-m="reader">Reader</button><button class="mbtn" data-m="cinema">Cinema</button><button class="mbtn" data-m="bilingual">Bilingual</button><button class="mbtn" data-m="podcast">Podcast</button></span>
  <span class="muted" style="font-size:12px" id="clock"></span></div></div>
<div class="wrap">
  <div class="summary" id="summary"></div>
  <div id="vidwarn" class="warn" style="display:none">Video <code>__VIDEO__</code> not found next to this page — click-to-seek needs it. (Transcode still running? Reopen when it finishes.)</div>
  <div class="main">
    <div class="leftcol">
      <div class="card playerpin">
        <div class="vidwrap"><video id="vid" src="__VIDEO__" controls preload="metadata" poster="poster.jpg" playsinline></video><div class="subs" id="subs"></div></div>
        <div class="subsbar"><span class="sb-lbl">subtitles on video</span><button class="subtog" id="subIt">Italiano</button><button class="subtog" id="subEn">English</button><button class="subtog on" id="subOff">Off</button></div>
        <div class="listenbar" id="listenbar"></div>
        <audio id="tts" preload="none"></audio>
      </div>
      <section class="chapter" id="sceneSec">
      <div class="card sitcard" style="margin-top:14px"><div class="sithdr" id="sithdr"></div><div id="lucreziaText"></div></div>
      <div class="card" style="margin-top:14px"><h3>Dialogue <span class="hint">click any line → jumps the video here</span></h3><div id="cueHdr"><span></span><span>Italiano</span><span class="en-h">English</span></div><div class="cues" id="cues"></div></div>
      </section>
    </div>
    <div class="rail"><div class="card"><h3 id="chapH">Scenes</h3><div id="chaps"></div></div></div>
  </div>
</div>
<div id="podbar">
  <input type="range" id="podSeek" min="0" max="1000" value="0">
  <div class="pod-row">
    <button class="pod-btn pod-play" id="podPlay">▶</button>
    <button class="pod-btn" id="podPrev">⏮</button>
    <button class="pod-btn" id="podNext">⏭</button>
    <div class="pod-meta" id="podMax"><div class="pod-title" id="podTitle">—</div><div class="pod-time" id="podTime">0:00 / 0:00</div></div>
    <button class="pod-btn" id="podExpand">⤢</button>
  </div>
</div>
<div id="podsheet">
  <div class="ps-head"><button id="podMin">⌄ Close</button><b>Podcast · listen scene-by-scene</b></div>
  <div class="ps-controls">
    <div class="ps-now" id="psNow">—</div>
    <input type="range" id="psSeek" min="0" max="1000" value="0">
    <div class="ps-time" id="psTime">0:00 / 0:00</div>
    <div class="ps-buttons">
      <button class="ps-nav" id="psPrev" title="previous scene">⏮</button>
      <button class="ps-bigplay" id="psPlay">▶</button>
      <button class="ps-nav" id="psNext" title="next scene">⏭</button>
    </div>
  </div>
  <div class="ps-body"><div class="ps-list" id="psList"></div><div class="ps-dlg" id="psDlg"></div></div>
</div>
<audio id="pod" preload="none"></audio>
<script>
const DATA = __DATA__, scenes = DATA.scenes || [];
const vid = document.getElementById('vid');
// The episode audio is mastered ~-27 LUFS (TV/Netflix) — quiet even at max HTML volume, and ~10dB under
// Lucrezia's -16 LUFS narration. HTML volume caps at 1.0, so boost via WebAudio (+~11dB) with a limiter.
const VIDEO_GAIN = 3.6;
let AC=null, vGain=null;
// TOUCH/MOBILE: never route <video> through WebAudio. createMediaElementSource() breaks native <video>
// playback + controls on iOS/Android — the element freezes after the first pause and shows no play button.
// Play natively instead (a bit quieter, but it WORKS). The +11dB boost stays for desktop where WebAudio is safe.
const IS_TOUCH = (navigator.maxTouchPoints||0) > 0 || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent||'');
function boostVideo(){
  if(IS_TOUCH) return;
  if(AC) { if(AC.state!=='running') AC.resume(); return; }
  try{
    AC = new (window.AudioContext||window.webkitAudioContext)();
    const src = AC.createMediaElementSource(vid);
    vGain = AC.createGain(); vGain.gain.value = VIDEO_GAIN;
    const lim = AC.createDynamicsCompressor();
    lim.threshold.value=-3; lim.knee.value=6; lim.ratio.value=14; lim.attack.value=0.003; lim.release.value=0.12;
    src.connect(vGain); vGain.connect(lim); lim.connect(AC.destination);
    if(AC.state!=='running') AC.resume();
  }catch(e){ /* WebAudio unavailable — video stays at native level */ }
}
vid.addEventListener('play', boostVideo);
document.getElementById('summary').textContent = DATA.video_summary ? ('Episode: ' + DATA.video_summary) : '';
document.getElementById('chapH').innerHTML = 'Scenes · ' + scenes.length;
const COLORS=['#b3522e','#386b8a','#6b8e4e','#8a5a83','#b48309','#3f7a6a','#a93423','#5b6bb4','#7a7560'];
const cmap={}; let ci=0;
function color(n){ if(!n||n.startsWith('Voce')||n==='?')return '#8a7560'; if(!(n in cmap))cmap[n]=COLORS[ci++%COLORS.length]; return cmap[n]; }
function fmt(t){t=Math.max(0,Math.round(t));return (t/60|0)+':'+String(t%60).padStart(2,'0');}
function showSA(i){ const s=scenes[cur]; const a=(s.speech_acts||[])[i]; if(!a)return;
  const d=document.getElementById('saDetail'); if(!d)return;
  const on=d.classList.contains('show') && d.dataset.i==i;
  if(on){ d.classList.remove('show'); document.querySelectorAll('.sa .s').forEach(el=>el.classList.remove('on')); return; }
  d.dataset.i=i;
  d.innerHTML=`<span class="sa-fn">${a.function}</span><span class="sa-it">${a.example_it||''}</span>${a.example_en?` <span class="sa-en">— ${a.example_en}</span>`:''}`;
  d.classList.add('show');
  document.querySelectorAll('.sa .s').forEach((el,j)=>el.classList.toggle('on',j===i)); }
let cur=-1;
const chaps=document.getElementById('chaps'), cues=document.getElementById('cues');
chaps.innerHTML=scenes.map((s,i)=>`<div class="chap" data-i="${i}"><span class="n">${s.scene}</span><span class="nm">${s.title||'(scene)'}</span><span class="ddot ${s.difficulty?s.difficulty.band:''}" title="${s.difficulty?('difficulty: '+s.difficulty.band):''}"></span><span class="lc">${s.lines.length}</span></div>`).join('');
chaps.querySelectorAll('.chap').forEach(el=>el.onclick=()=>{const i=+el.dataset.i; selectScene(i); seek(scenes[i].start);});
function selectScene(i){
  if(i===cur) return; if(TL.playing) stopTimeline(); cur=i; lastNow=-1;
  chaps.querySelectorAll('.chap').forEach(x=>x.classList.toggle('cur',+x.dataset.i===i));
  const s=scenes[i];
  document.getElementById('sithdr').innerHTML=`<div class="loc">${s.location||''} · ${fmt(s.start)}–${fmt(s.end)}${s.difficulty?`<span class="diff ${s.difficulty.band}">${s.difficulty.band}</span>`:''}</div>
    <h2>${s.title||'Scene '+s.scene}</h2><div class="sm">${s.situation||''}</div>
    <div class="chars">${(s.characters_present||[]).map(c=>`<span class="chip" style="background:${color(c)}">${c}</span>`).join('')}</div>
    ${s.visual_situation?`<div class="vs"><span class="lbl">on screen</span><span class="vtxt">${s.visual_situation.en||''}${s.visual_situation.it?`<span class="vit">${s.visual_situation.it}</span>`:''}</span></div>`:''}
    ${(s.target_structures&&s.target_structures.length)?`<div class="ts"><span class="lbl">listen for</span>${s.target_structures.map(t=>`<span class="s">${t}</span>`).join('')}</div>`:''}
    ${(s.speech_acts&&s.speech_acts.length)?`<div class="sa"><span class="lbl">how to</span>${s.speech_acts.map((a,i)=>`<span class="s" role="button" onclick="showSA(${i})">${a.function}</span>`).join('')}</div><div class="sa-detail" id="saDetail"></div>`:''}`;
  cues.innerHTML=s.lines.map((l,li)=>`<div class="cue" data-li="${li}" data-t="${l.start}">
    <span class="who-c"><span class="who" style="color:${color(l.character)}">${l.character}</span><br><span class="t">${fmt(l.start)}</span></span>
    <span class="it-c"><span class="it">${l.italian_text}</span>${l.teaching_note?`<span class="tn">${l.teaching_note}</span>`:''}</span>
    <span class="en-c">${l.en_gloss?`<span class="en">${l.en_gloss}</span>`:''}</span></div>`).join('');
  cues.querySelectorAll('.cue').forEach(el=>el.onclick=()=>seek(+el.dataset.t));
  const tl=s.audio_timeline||[]; const baked=tl.some(x=>x.type==='tts'&&x.seg);
  document.getElementById('listenbar').innerHTML = tl.length
    ? `<button id="listenBtn" class="listen">▶ Listen with Lucrezia</button> <span class="hint">${baked?'Lucrezia narrates + the real clips play in sequence':'timeline authored — audio not baked yet'}</span>`
    : '';
  const lb=document.getElementById('listenBtn'); if(lb){ lb.disabled=!baked; lb.onclick=toggleTimeline; }
  // update the tutor's grounding section to THIS scene (it reads section.chapter id+text on scroll)
  const sec=document.querySelector('section.chapter'); if(sec){ sec.id='scene-'+s.scene; try{window.dispatchEvent(new Event('scroll'));}catch(e){} }
  const ch=chaps.querySelector('.chap.cur'); if(ch) ch.scrollIntoView({block:'nearest'});
}
let TL={playing:false,stop:false,gen:0,scene:-1}, _ltHandler=null, LT=null;
function ltClear(){ const a=document.getElementById('tts'); if(_ltHandler&&a){a.removeEventListener('timeupdate',_ltHandler);} _ltHandler=null; }
// build the WHOLE scene sequence: every Lucrezia word (per run's lang) + every clip's subtitle line, in order
function buildTranscript(s){
  const words=[], segStart=[]; const tl=s.audio_timeline||[];
  tl.forEach((seg,si)=>{ segStart[si]=words.length;
    if(seg.type==='tts'){ (seg.runs||[]).forEach(r=>{ (r.text||'').split(/\s+/).filter(Boolean).forEach(w=>words.push({w:w,lang:r.lang,type:'tts'})); }); }
    else if(seg.type==='clip'){ const l=(s.lines||[])[seg.line_i]||{}; words.push({w:(l.italian_text||'…'),lang:'clip',type:'clip'}); }
  });
  segStart[tl.length]=words.length;
  return {words:words, segStart:segStart};
}
function renderTranscript(){ const box=document.getElementById('lucreziaText'); if(!box||!LT)return;
  box.innerHTML='<div class="lt-head"><span class="lt-lbl">Lucrezia — read along</span><button class="lt-max" onclick="toggleLtBig(event)">⤢ Maximize</button></div>'
    +'<div class="lt-body">'+LT.words.map((x,i)=>
      x.type==='clip'?`<span class="lt-clip" data-w="${i}" onclick="ltSeekTo(${i})">${x.w}</span> `:`<span class="lt-w ${x.lang}" data-w="${i}" onclick="ltSeekTo(${i})">${x.w}</span> `).join('')+'</div>';
  box.classList.add('show'); box.scrollTop=0; }
function toggleLtBig(e){ if(e)e.stopPropagation(); const b=document.getElementById('lucreziaText'); if(!b)return;
  b.classList.toggle('big'); const btn=b.querySelector('.lt-max'); if(btn) btn.textContent=b.classList.contains('big')?'⤡ Minimize':'⤢ Maximize'; }
function ltHighlight(gi){ const box=document.getElementById('lucreziaText'); if(!box)return;
  box.querySelectorAll('[data-w]').forEach(el=>el.classList.toggle('on',+el.dataset.w===gi));
  const act=box.querySelector('[data-w].on'); if(act) act.scrollIntoView({block:'nearest'}); }
function showLucreziaSeg(seg,a,si){ if(!LT)return; ltClear();
  const start=LT.segStart[si], end=LT.segStart[si+1]||LT.words.length, words=LT.words.slice(start,end);
  const total=words.reduce((s,x)=>s+(x.w.length||1),0)||1;
  _ltHandler=()=>{ const d=a.duration||0; if(!d){ltHighlight(start);return;} const frac=a.currentTime/d; let acc=0,cur=0;
    for(let j=0;j<words.length;j++){ acc+=(words[j].w.length||1)/total; if(frac<=acc){cur=j;break;} cur=j; }
    ltHighlight(start+cur); };
  a.addEventListener('timeupdate',_ltHandler); ltHighlight(start); }
function showLucreziaClip(si){ ltClear(); if(LT) ltHighlight(LT.segStart[si]); }
function stopTimeline(){ TL.stop=true; TL.playing=false; TL.gen++; const a=document.getElementById('tts'); if(a)a.pause(); vid.pause(); ltClear();
  const box=document.getElementById('lucreziaText'); if(box) box.classList.remove('show');
  const b=document.getElementById('listenBtn'); if(b){b.textContent='▶ Listen with Lucrezia';b.classList.remove('on');} }
function toggleTimeline(){ boostVideo(); if(TL.playing){stopTimeline();return;}
  // BLESS the <video> inside this user gesture so later programmatic vid.play() during 'clip' segments
  // is allowed on mobile (autoplay policy blocks play() reached async after narration → frozen/blank video).
  try{ vid.muted=true; vid.play().catch(()=>{}); vid.pause(); vid.muted=false; }catch(e){}
  playTimeline(cur,0); }
// click a read-along word/clip → jump Lucrezia's narration (and the video) to that segment (Coursera-style seek)
function ltSeekTo(gi){
  if(!LT) return; boostVideo();
  let si=0; for(let k=0;k<LT.segStart.length-1;k++){ if(gi>=LT.segStart[k]) si=k; else break; }
  // APPROX word-level seek (no per-word timestamps baked): jump to (letters-before-word / letters-in-segment)
  // × segment duration — the reverse of the char-proportion the live highlight already uses. Lands within a
  // word or two of the click. (Exact per-word seek needs forced alignment — tracked as a separate issue.)
  const s0=LT.segStart[si], s1=LT.segStart[si+1]||LT.words.length, ws=LT.words.slice(s0,s1);
  const total=ws.reduce((a,x)=>a+(x.w.length||1),0)||1; let before=0;
  for(let j=0;j<gi-s0 && j<ws.length;j++) before+=(ws[j].w.length||1);
  // seek within the scene the READ-ALONG belongs to (TL.scene), NOT `cur` (the video's timeupdate drifts `cur`).
  playTimeline(TL.scene>=0?TL.scene:cur, si, Math.min(0.97, before/total));
}
function playTimeline(i, startSeg, seekFrac){
  const s=scenes[i], tl=s.audio_timeline||[]; if(!tl.length)return;
  const cont = TL.playing && TL.scene===i && LT;          // jumping within a live scene — keep the rendered transcript
  const a=document.getElementById('tts'); if(a)a.pause(); vid.pause();
  TL.playing=true; TL.stop=false; TL.scene=i; const gen=++TL.gen;
  if(!cont){ LT=buildTranscript(s); renderTranscript(); }
  const btn=document.getElementById('listenBtn'); if(btn){btn.textContent='⏹ Stop';btn.classList.add('on');}
  let idx=startSeg||0, firstSeek=seekFrac||0;
  function next(){
    if(gen!==TL.gen) return;                              // a newer play/jump/stop superseded us
    if(idx>=tl.length){stopTimeline();return;}
    const si=idx; const seg=tl[idx++];
    if(seg.type==='pause'){ setTimeout(()=>{ if(gen===TL.gen) next(); }, seg.ms||300); }
    else if(seg.type==='tts'){ if(!seg.seg){next();return;} a.src=seg.seg; showLucreziaSeg(seg,a,si);
      const sf=firstSeek; firstSeek=0;   // the word-offset seek applies ONLY to the first tts of a click-jump
      const applySeek=()=>{ if(sf>0){ try{ a.currentTime=sf*(a.duration||0); }catch(e){} } };
      if(sf>0) a.addEventListener('loadedmetadata', applySeek, {once:true});
      a.onended=()=>{if(gen===TL.gen)next();}; a.onerror=()=>{if(gen===TL.gen)next();};
      a.play().then(()=>{ if(sf>0 && a.duration) applySeek(); }).catch(()=>{if(gen===TL.gen)next();}); }
    else if(seg.type==='clip'){ showLucreziaClip(si); vid.currentTime=seg.start+0.01; vid.play().catch(()=>{});
      const chk=()=>{ if(gen!==TL.gen){ vid.removeEventListener('timeupdate',chk); return; }
        if(vid.currentTime>=seg.end-0.05){ vid.pause(); vid.removeEventListener('timeupdate',chk); next(); } };
      vid.addEventListener('timeupdate',chk); }
    else next();
  }
  next();
}
function seek(t){ vid.currentTime=t+0.01; vid.play().catch(()=>{}); }
vid.addEventListener('timeupdate',()=>{
  const t=vid.currentTime;
  document.getElementById('clock').textContent=fmt(t)+' / '+fmt(vid.duration||0);
  let si=scenes.findIndex(s=>t>=s.start && t<s.end); if(si<0) si=cur<0?0:cur;
  if(si!==cur) selectScene(si);
  const s=scenes[cur]; let now=-1;
  for(let i=0;i<s.lines.length;i++){ if(t>=s.lines[i].start-0.05) now=i; else break; }
  cues.querySelectorAll('.cue').forEach(el=>{ el.classList.toggle('now',+el.dataset.li===now); });
  updateSubs(now>=0 ? s.lines[now] : null);
  if(now>=0 && now!==lastNow){
    lastNow=now;
    const el=cues.querySelector('.cue.now');
    if(el){
      // READER: pin the CURRENT line to the top (just under the pinned video) — scroll UP as it advances,
      // upcoming lines below; never chase the newest at the bottom. Other modes: keep it minimally in view.
      if(document.body.classList.contains('mode-reader')) cueToTop(el);
      else el.scrollIntoView({block:'nearest'});
    }
  }
});
let lastNow=-1;
function cueToTop(el){
  const pin=document.querySelector('.playerpin');
  const pinBottom=(pin && getComputedStyle(pin).position==='sticky')?pin.getBoundingClientRect().bottom:56;
  const delta=el.getBoundingClientRect().top - pinBottom - 8;
  if(Math.abs(delta)>2) window.scrollBy({top:delta, behavior:'smooth'});
}
vid.addEventListener('error',()=>{document.getElementById('vidwarn').style.display='block';});
// ── on-video subtitle toggle: IT / EN / Off (the scaffolding dial) ──
let subIT=false, subEN=false;
function updateSubs(line){
  const el=document.getElementById('subs'); if(!el) return;
  if(!line || (!subIT&&!subEN)){ el.innerHTML=''; return; }
  el.innerHTML=(subIT&&line.italian_text?`<div class="sub-it">${line.italian_text}</div>`:'')
             +(subEN&&line.en_gloss?`<div class="sub-en">${line.en_gloss}</div>`:'');
}
function refreshSubs(){ const s=scenes[cur]; if(!s){updateSubs(null);return;}
  const t=vid.currentTime; let now=-1;
  for(let i=0;i<s.lines.length;i++){ if(t>=s.lines[i].start-0.05) now=i; else break; }
  updateSubs(now>=0?s.lines[now]:null); }
function setSubBtns(){ document.getElementById('subIt').classList.toggle('on',subIT);
  document.getElementById('subEn').classList.toggle('on',subEN);
  document.getElementById('subOff').classList.toggle('on',!subIT&&!subEN);
  try{localStorage.setItem('chiron_subs',(subIT?'i':'')+(subEN?'e':''));}catch(e){} }
document.getElementById('subIt').onclick=()=>{ subIT=!subIT; setSubBtns(); refreshSubs(); };
document.getElementById('subEn').onclick=()=>{ subEN=!subEN; setSubBtns(); refreshSubs(); };
document.getElementById('subOff').onclick=()=>{ subIT=false; subEN=false; setSubBtns(); refreshSubs(); };
(()=>{ let v=''; try{v=localStorage.getItem('chiron_subs')||'';}catch(e){} subIT=v.includes('i'); subEN=v.includes('e'); setSubBtns(); })();
// ── Podcast mini-player (audio-first / mobile): plays the spliced per-scene podcasts, auto-advances ──
const pod=document.getElementById('pod'); let podI=0;
const $=id=>document.getElementById(id);
function fmtT(t){t=Math.max(0,t||0);return (t/60|0)+':'+String(Math.round(t%60)).padStart(2,'0');}
function setAll(ids,fn){ ids.forEach(id=>{const el=$(id); if(el) fn(el);}); }
function updatePodPlay(){ const s=pod.paused?'▶':'⏸'; setAll(['podPlay','psPlay'],el=>el.textContent=s); }
function renderPsList(){
  const el=$('psList'); if(!el) return;
  el.innerHTML=scenes.map((s,i)=>`<div class="psi ${i===podI?'cur':''}" data-i="${i}"><span class="n">${s.scene}</span><span class="t">${s.title||'Scene'}</span><span class="d">${s.difficulty?s.difficulty.band:''}</span></div>`).join('');
  el.querySelectorAll('.psi').forEach(x=>x.onclick=()=>{ podLoad(+x.dataset.i,true); renderPsDlg(); });
}
function renderPsDlg(){ const s=scenes[podI]; if(!s||!$('psDlg'))return;
  $('psDlg').innerHTML='<h3 style="margin-bottom:8px">'+(s.title||'Scene')+'</h3>'+
    (s.lines||[]).map(l=>`<div class="l"><span class="who" style="color:${color(l.character)}">${l.character}</span> <span class="it">${l.italian_text}</span>${l.en_gloss?`<br><span class="en">${l.en_gloss}</span>`:''}</div>`).join(''); }
function podLoad(i,autoplay){
  if(i<0||i>=scenes.length) return;
  const s=scenes[i]; const title=s.scene+'. '+(s.title||'Scene');
  if(!s.podcast_audio){ setAll(['podTitle','psNow'],el=>el.textContent=title+' — (no audio yet)'); return; }
  podI=i; pod.src=s.podcast_audio;
  setAll(['podTitle','psNow'],el=>el.textContent=title);
  renderPsList(); if($('podsheet').classList.contains('open')) renderPsDlg();
  if(autoplay) pod.play().catch(()=>{}); updatePodPlay();
}
function podToggle(){ if(!pod.src) podLoad(Math.max(0,cur),true); else if(pod.paused) pod.play(); else pod.pause(); }
// the mini-bar AND the maximized sheet share the same controls
setAll(['podPlay','psPlay'],el=>el.onclick=podToggle);
setAll(['podPrev','psPrev'],el=>el.onclick=()=>podLoad(podI-1,true));
setAll(['podNext','psNext'],el=>el.onclick=()=>podLoad(podI+1,true));
setAll(['podSeek','psSeek'],el=>el.oninput=e=>{ if(pod.duration) pod.currentTime=e.target.value/1000*pod.duration; });
pod.addEventListener('play',updatePodPlay); pod.addEventListener('pause',updatePodPlay);
pod.addEventListener('ended',()=>podLoad(podI+1,true));
pod.addEventListener('timeupdate',()=>{ const d=pod.duration||0; const tt=fmtT(pod.currentTime)+' / '+fmtT(d);
  setAll(['podTime','psTime'],el=>el.textContent=tt);
  if(d){ const v=Math.round(pod.currentTime/d*1000); setAll(['podSeek','psSeek'],el=>el.value=v); } });
const podsheet=$('podsheet');
function openSheet(){ renderPsList(); renderPsDlg(); podsheet.classList.add('open'); }
$('podExpand').onclick=openSheet;
$('podMax').onclick=openSheet;
$('podMin').onclick=()=>podsheet.classList.remove('open');
function setMode(m){ document.body.className='mode-'+m;
  document.querySelectorAll('.mbtn').forEach(b=>b.classList.toggle('on',b.dataset.m===m));
  if(m==='podcast' && !pod.src) podLoad(Math.max(0,cur),false);
  if(m!=='podcast') podsheet.classList.remove('open');
  try{localStorage.setItem('chiron_mode',m);}catch(e){} }
document.querySelectorAll('.mbtn').forEach(b=>b.onclick=()=>setMode(b.dataset.m));
// keep sticky offsets in sync with the REAL header height (mobile wraps the mode-bar taller than 52px)
const _setBarH=()=>{const b=document.querySelector('.bar');if(b)document.documentElement.style.setProperty('--barh',b.offsetHeight+'px');};
_setBarH(); addEventListener('resize',_setBarH); addEventListener('orientationchange',()=>setTimeout(_setBarH,100));
setMode((()=>{try{return localStorage.getItem('chiron_mode')||'reader';}catch(e){return 'reader';}})());
_setBarH();   // re-measure after setMode (mode can change bar layout)
selectScene(0);
</script>
<script src="tutor.js"></script>
"""

if __name__ == "__main__":
    main()
