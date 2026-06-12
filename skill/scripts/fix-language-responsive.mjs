import { readFileSync, writeFileSync } from 'node:fs';

const MARKER = 'RESPONSIVE-CONTENT-FIX';
const RESP_BLOCK = `
    /* ${MARKER} (2026-06-12): true mobile responsiveness — tables and wide
       content must never exceed the viewport (was: .v-table forced 473px wide,
       pushing the page to 498px on a 390px screen). */
    @media (max-width: 768px) {
      .v-table, .sr-conj-table { table-layout: fixed; }
      .v-table th, .v-table td,
      .sr-conj-table th, .sr-conj-table td { word-break: break-word; overflow-wrap: anywhere; }
      .lesson-shell, .lesson-section, .vocab-arc, .turn { max-width: 100%; overflow-wrap: anywhere; }
      img, pre, code, table, video, iframe { max-width: 100% !important; }
      /* belt-and-suspenders: clip any last stray px so nothing spills off-screen */
      html, body { overflow-x: hidden; }
    }
`;

const files = process.argv.slice(2);
for (const f of files) {
  let html = readFileSync(f, 'utf8');
  let changed = false;

  // FIX 1 — scope the 880px top-strip so it no longer fires at phone width
  const before = '@media (max-width: 880px) {';
  const after  = '@media (min-width: 769px) and (max-width: 880px) {';
  if (html.includes(before)) { html = html.replace(before, after); changed = true; }

  // FIX 2 — inject the responsive-content block before </style> (idempotent)
  if (!html.includes(MARKER)) {
    const idx = html.lastIndexOf('</style>');
    if (idx !== -1) {
      html = html.slice(0, idx) + RESP_BLOCK + '\n  ' + html.slice(idx);
      changed = true;
    }
  }

  if (changed) { writeFileSync(f, html); console.log('patched  ' + f); }
  else console.log('skipped  ' + f + ' (already current)');
}
