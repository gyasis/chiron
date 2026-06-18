// Integration tests for the G6 capture sidecar (scripts/capture-server.mjs).
// Run: node --test skill/tests/capture-server.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCaptureServer } from '../scripts/capture-server.mjs';

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
