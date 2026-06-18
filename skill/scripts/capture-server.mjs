#!/usr/bin/env node
// Chiron — G6 phone-camera capture sidecar.
//
// A tiny, dependency-free LAN server: open the printed URL on your phone, snap a
// book page / whiteboard / slide with the camera, and it lands in an inbox dir.
// Point chiron's image adapter (G1) at that inbox to generate a lesson/quiz.
//
//   node skill/scripts/capture-server.mjs [--port 8788] [--inbox <dir>]
//                                         [--host 0.0.0.0] [--max-mb 25]
//
// Deliberately LAN-only + no auth (single learner = Gyasi; FR-G6-003). Captures
// are raw-body uploads (no multipart parsing, no deps). If the optional `qrcode`
// package is installed, a terminal QR is printed for one-scan phone pairing;
// otherwise the URL is printed to type in.
//
// This server does NOT run the TS pipeline — it fills the inbox and prints the
// exact `chiron` command to ingest, keeping it decoupled + observable.

import http from 'node:http';
import { createWriteStream, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { networkInterfaces } from 'node:os';

const IMAGE_MIME = /^image\//;
const EXT_BY_MIME = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
  'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif',
};

function lanIPv4s() {
  const out = [];
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  // Rank real home-LAN addresses (192.168.0/1.x, 10.x) ahead of docker/VM
  // bridge ranges (172.16–31.x and the 192.168.<big>.1 virtual gateways) so the
  // first URL — used for the QR — is the one a phone can actually reach.
  const rank = (ip) => {
    if (/^192\.168\.[01]\./.test(ip) || /^10\./.test(ip)) return 0;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;        // docker default range
    if (/^192\.168\.\d+\.1$/.test(ip)) return 2;                // virtual-bridge gateways
    return 1;
  };
  return out.sort((a, b) => rank(a) - rank(b));
}

function safeName(raw, mime, ts) {
  const base = basename(String(raw || 'capture')).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60) || 'capture';
  const hasExt = /\.[A-Za-z0-9]{2,5}$/.test(base);
  const ext = EXT_BY_MIME[mime] ?? 'jpg';
  return hasExt ? `${ts}-${base}` : `${ts}-${base}.${ext}`;
}

function pageHtml() {
  // Inline so the script is single-file. Mobile-first; camera + gallery + drag-drop + paste.
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<title>Chiron Capture</title>
<style>
  :root{--bg:#0f1117;--card:#1a1d27;--ink:#e8eaf0;--mut:#9aa0b4;--accent:#5b8cff;--ok:#3ecf8e}
  *{box-sizing:border-box}body{margin:0;font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
  .wrap{max-width:560px;margin:0 auto;padding:20px 16px 60px}
  h1{font-size:20px;margin:.2em 0 .1em}.sub{color:var(--mut);margin:0 0 18px;font-size:14px}
  .card{background:var(--card);border:1px solid #272b39;border-radius:14px;padding:18px;margin:14px 0}
  label.btn{display:block;text-align:center;background:var(--accent);color:#fff;font-weight:600;
    padding:16px;border-radius:12px;cursor:pointer;margin:8px 0;font-size:17px}
  label.ghost{background:transparent;border:1px dashed #3a3f52;color:var(--ink)}
  input[type=file]{display:none}
  #drop{border:2px dashed #3a3f52;border-radius:12px;padding:26px;text-align:center;color:var(--mut)}
  #drop.over{border-color:var(--accent);color:var(--ink)}
  #shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(86px,1fr));gap:8px;margin-top:8px}
  #shots .t{position:relative;border-radius:8px;overflow:hidden;aspect-ratio:1;background:#0a0c12}
  #shots img{width:100%;height:100%;object-fit:cover}
  #shots .b{position:absolute;inset:auto 0 0 0;font-size:10px;background:rgba(62,207,142,.9);color:#06210f;padding:1px 4px}
  .count{font-weight:700;color:var(--ok)} .err{color:#ff6b6b;font-size:13px;min-height:18px}
  .hint{color:var(--mut);font-size:13px}
</style></head><body><div class="wrap">
  <h1>📸 Chiron Capture</h1>
  <p class="sub">Snap a book page, whiteboard, or slide — it lands in your lesson inbox.</p>
  <div class="card">
    <label class="btn" for="cam">Take a photo</label>
    <input id="cam" type="file" accept="image/*" capture="environment" multiple>
    <label class="btn ghost" for="gal">Choose from gallery</label>
    <input id="gal" type="file" accept="image/*" multiple>
    <div id="drop" class="hint">…or drag &amp; drop / paste an image here (desktop)</div>
  </div>
  <p class="hint">Captured this session: <span id="n" class="count">0</span></p>
  <p id="err" class="err"></p>
  <div id="shots"></div>
</div><script>
const shots=document.getElementById('shots'),nEl=document.getElementById('n'),errEl=document.getElementById('err');
let n=0;
async function send(file){
  errEl.textContent='';
  if(!file||!/^image\\//.test(file.type)){errEl.textContent='Not an image: '+(file&&file.name||'?');return;}
  const tile=document.createElement('div');tile.className='t';
  const img=document.createElement('img');img.src=URL.createObjectURL(file);
  const tag=document.createElement('div');tag.className='b';tag.textContent='…';
  tile.append(img,tag);shots.prepend(tile);
  try{
    const r=await fetch('/capture',{method:'POST',headers:{'Content-Type':file.type,'X-Filename':file.name||'capture'},body:file});
    const j=await r.json();
    if(!r.ok||!j.ok){throw new Error(j.error||('HTTP '+r.status));}
    tag.textContent='saved';n=j.count;nEl.textContent=n;
  }catch(e){tag.textContent='fail';tag.style.background='rgba(255,107,107,.9)';errEl.textContent='Upload failed: '+e.message;}
}
function many(files){[...files].forEach(send);}
document.getElementById('cam').addEventListener('change',e=>many(e.target.files));
document.getElementById('gal').addEventListener('change',e=>many(e.target.files));
const drop=document.getElementById('drop');
['dragenter','dragover'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.add('over');}));
['dragleave','drop'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.remove('over');}));
drop.addEventListener('drop',e=>many(e.dataTransfer.files));
window.addEventListener('paste',e=>{const f=[...(e.clipboardData?.files||[])];if(f.length)many(f);});
</script></body></html>`;
}

export function createCaptureServer({ inboxDir, maxBytes = 25 * 1024 * 1024, onCapture } = {}) {
  if (!inboxDir) throw new Error('createCaptureServer: inboxDir is required');
  mkdirSync(inboxDir, { recursive: true });
  let count = 0;

  const server = http.createServer((req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };

    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(pageHtml());
      return;
    }
    if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, count });
    if (req.method === 'GET' && req.url === '/list') {
      let files = [];
      try {
        files = readdirSync(inboxDir)
          .filter((f) => !f.startsWith('.'))
          .map((f) => ({ name: f, bytes: statSync(join(inboxDir, f)).size }));
      } catch { /* empty */ }
      return send(200, { ok: true, inboxDir, count: files.length, files });
    }
    if (req.method === 'POST' && req.url === '/capture') {
      const mime = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!IMAGE_MIME.test(mime)) return send(415, { ok: false, error: `not an image mime: '${mime}'` });
      const capMb = Math.round(maxBytes / 1048576) || 1;
      // Early reject when the declared size already exceeds the cap — no file touched.
      const declared = Number(req.headers['content-length'] || 0);
      if (declared && declared > maxBytes) return send(413, { ok: false, error: `exceeds max ${capMb}MB` });

      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const name = safeName(req.headers['x-filename'], mime, ts);
      const dest = join(inboxDir, name);
      const out = createWriteStream(dest);
      let size = 0, done = false;
      const fail = (code, error) => {
        if (done) return; done = true;
        out.destroy();
        try { unlinkSync(dest); } catch { /* best-effort: remove the partial file */ }
        try { req.destroy(); } catch { /* noop */ }
        send(code, { ok: false, error });
      };
      out.on('error', () => fail(500, 'write failed'));
      req.on('error', () => fail(400, 'request error'));
      req.on('data', (chunk) => {
        if (done) return;
        size += chunk.length;
        if (size > maxBytes) { fail(413, `exceeds max ${capMb}MB`); return; } // backstop for chunked/no-length
        out.write(chunk);
      });
      req.on('end', () => {
        if (done) return; done = true;
        out.end(() => {
          count += 1;
          // eslint-disable-next-line no-console
          console.log(`  📥 capture ${count}: ${name} (${size} bytes) -> ${dest}`);
          if (typeof onCapture === 'function') { try { onCapture({ name, dest, size, mime }); } catch { /* noop */ } }
          send(200, { ok: true, saved: name, count });
        });
      });
      return;
    }
    send(404, { ok: false, error: 'not found' });
  });

  return { server, inboxDir, get count() { return count; } };
}

// ---------- CLI ----------

function parseArgs(argv) {
  const a = { host: '0.0.0.0', port: 8788, inbox: null, maxMb: 25 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--host') a.host = argv[++i];
    else if (k === '--port') a.port = Number(argv[++i]);
    else if (k === '--inbox') a.inbox = argv[++i];
    else if (k === '--max-mb') a.maxMb = Number(argv[++i]);
  }
  return a;
}

async function printPairing(urls) {
  for (const u of urls) console.log(`    ${u}`);
  try {
    const qrcode = await import('qrcode');
    const term = await qrcode.toString(urls[0], { type: 'terminal', small: true });
    console.log('\n  Scan to connect your phone:\n');
    console.log(term);
  } catch {
    console.log('\n  (install `qrcode` for a scannable QR; otherwise type the URL above on your phone)');
  }
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const inbox = a.inbox || join(process.cwd(), '.chiron-capture', 'inbox');
  const { server } = createCaptureServer({ inboxDir: inbox, maxBytes: a.maxMb * 1024 * 1024 });
  server.listen(a.port, a.host, async () => {
    const ips = lanIPv4s();
    const urls = (ips.length ? ips : ['127.0.0.1']).map((ip) => `http://${ip}:${a.port}/`);
    console.log('\n📸 Chiron capture sidecar — LAN-only, no auth (single learner).');
    console.log(`   Inbox: ${inbox}`);
    console.log('   Open on your phone (same Wi-Fi):');
    await printPairing(urls);
    console.log('\n   When done, ingest the inbox as an image-folder source, e.g.:');
    console.log(`     chiron --source "${inbox}" --domain medicine   # (image-folder via G1)`);
    console.log('\n   Ctrl-C to stop.\n');
  });
}

// Run as CLI only when invoked directly (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
