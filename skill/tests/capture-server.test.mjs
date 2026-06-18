// Integration tests for the G6 capture sidecar (scripts/capture-server.mjs).
// Run: node --test skill/tests/capture-server.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCaptureServer,
  ingestInbox,
  makeAutoIngest,
} from '../scripts/capture-server.mjs';

let handle, base, inbox;

before(async () => {
  inbox = mkdtempSync(join(tmpdir(), 'chiron-capture-inbox-'));
  handle = createCaptureServer({ inboxDir: inbox, maxBytes: 1024 }); // 1KB cap for the oversize test
  await new Promise((res) => handle.server.listen(0, '127.0.0.1', res));
  base = `http://127.0.0.1:${handle.server.address().port}`;
});

after(() => handle?.server.close());

test('GET / serves the mobile capture page', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /capture="environment"/); // the phone-camera input
  assert.match(html, /Chiron Capture/);
});

test('POST /capture saves an image to the inbox and increments count', async () => {
  const r = await fetch(base + '/capture', {
    method: 'POST',
    headers: { 'content-type': 'image/png', 'x-filename': 'page 1.png' },
    body: Buffer.from('fake-png-bytes'),
  });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.ok(j.ok);
  assert.equal(j.count, 1);
  assert.match(j.saved, /\.png$/);
  assert.match(j.saved, /^[^ ]+$/); // spaces sanitized out of the filename
  const files = readdirSync(inbox);
  assert.equal(files.length, 1);
});

test('GET /list reports the captured files', async () => {
  const r = await fetch(base + '/list');
  const j = await r.json();
  assert.ok(j.ok);
  assert.equal(j.count, 1);
  assert.equal(j.files[0].bytes, 'fake-png-bytes'.length);
});

test('non-image mime is rejected (415)', async () => {
  const r = await fetch(base + '/capture', {
    method: 'POST',
    headers: { 'content-type': 'text/plain', 'x-filename': 'note.txt' },
    body: Buffer.from('hello'),
  });
  assert.equal(r.status, 415);
  const j = await r.json();
  assert.equal(j.ok, false);
});

test('oversize upload is rejected (413)', async () => {
  const r = await fetch(base + '/capture', {
    method: 'POST',
    headers: { 'content-type': 'image/png', 'x-filename': 'big.png' },
    body: Buffer.alloc(2048, 1), // 2KB > 1KB cap
  }).catch((e) => ({ _err: e })); // connection may reset on abort
  if (!r._err) {
    assert.equal(r.status, 413);
  }
  // Either way, the oversized file must NOT have landed in the inbox.
  const pngs = readdirSync(inbox).filter((f) => f.includes('big'));
  assert.equal(pngs.length, 0);
});

test('health endpoint', async () => {
  const r = await fetch(base + '/health');
  const j = await r.json();
  assert.ok(j.ok);
});

// ---------- auto-ingest ----------

test('ingestInbox runs the (injected) image adapter and writes brief.json', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chiron-autoingest-'));
  const lessonDir = join(dir, 'lesson');
  let calledWith = null;
  const stub = async (opts) => {
    calledWith = opts;
    return {
      domain: opts.domain, mode: opts.mode, sourceType: 'image-folder',
      sourcePath: opts.sourcePath, sourceCopiedTo: 'source/inbox',
      extractedText: '<PENDING-VISION-HANDOFF>',
      sourceManifest: [{ path: 'source/inbox/a.png', role: 'primary', extractor: 'vision-image', tokenCount: 0, extractedAt: 1 }],
      metadata: { imageCount: 2 }, briefSchemaVersion: '1',
    };
  };
  const brief = await ingestInbox({ inboxDir: dir, lessonDir, domain: 'medicine', mode: 'A' }, stub);
  assert.equal(calledWith.sourcePath, dir);          // inbox passed as the source folder
  assert.equal(calledWith.lessonOutputDir, lessonDir);
  assert.equal(brief.sourceType, 'image-folder');
  const onDisk = JSON.parse(readFileSync(join(lessonDir, 'brief.json'), 'utf8'));
  assert.equal(onDisk.metadata.imageCount, 2);
});

test('ingestInbox requires a domain', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chiron-autoingest-'));
  await assert.rejects(ingestInbox({ inboxDir: dir, lessonDir: join(dir, 'l') }, async () => ({})), /domain is required/);
});

test('makeAutoIngest debounces bursts into a single ingest', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chiron-autoingest-'));
  let calls = 0;
  const stub = async (opts) => { calls += 1; return { ...opts, sourceType: 'image-folder', metadata: { imageCount: calls } }; };
  let ready = null;
  const trigger = makeAutoIngest(
    { inboxDir: dir, lessonDir: join(dir, 'lesson'), domain: 'code', mode: 'A', ingestImageFn: stub },
    { delayMs: 25, onReady: (r) => { ready = r; } },
  );
  trigger(); trigger(); trigger();                   // burst of 3 captures
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(calls, 1, 'burst should collapse to one ingest');
  assert.equal(ready.imageCount, 1);
});

test('end-to-end with the REAL G1 adapter (if dist is built)', async (t) => {
  const adapter = new URL('../dist/ingest-adapters/image.js', import.meta.url);
  if (!existsSync(adapter)) { t.skip('dist not built (run npx tsc)'); return; }
  const dir = mkdtempSync(join(tmpdir(), 'chiron-autoingest-real-'));
  // a real-ish PNG header so the extension/mime path is sane
  writeFileSync(join(dir, 'page-001.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  const lessonDir = join(dir, 'lesson');
  const brief = await ingestInbox({ inboxDir: dir, lessonDir, domain: 'medicine', mode: 'A' });
  assert.equal(brief.sourceType, 'image-folder');
  assert.equal(brief.extractedText, '<PENDING-VISION-HANDOFF>'); // vision still pending (agent's job)
  assert.ok(existsSync(join(lessonDir, 'brief.json')));
  assert.ok(existsSync(join(lessonDir, '.scratch', 'vision-handoffs.json')));
});
