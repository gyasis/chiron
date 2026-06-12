/* Mobile wide-table solution v3: STACKED CARDS for vocab/sentence tables.
 * The swipe box still required horizontal scrolling to read the 3rd column.
 * Per user ("I don't want to scroll horizontally"), .v-table rows become
 * stacked cards on mobile — Italian leads, English + note stack under it.
 * NO horizontal scrolling. (.sr-conj-table, if any, keeps the swipe box — a
 * matrix must stay aligned.) Later block wins over the swipe CSS. Idempotent. */
import { readFileSync, writeFileSync } from 'node:fs';

const MARKER = 'RESPONSIVE-TABLE-CARDS';
const BLOCK = `
    /* ${MARKER} (2026-06-12): vocab/sentence tables (.v-table) become STACKED
       CARDS on mobile — no horizontal scrolling. Each row is a card; Italian
       leads, English + note stack under it. Supersedes the swipe box for
       .v-table (later block wins); .sr-conj-table keeps the swipe box. */
    @media (max-width: 768px) {
      /* neutralise the swipe wrapper when it holds a vocab table */
      .chiron-table-scroll:has(> .v-table) {
        overflow: visible; background: none;
      }
      .v-table { display: block; min-width: 0 !important; width: 100%; }
      .v-table thead { display: none; }
      .v-table tbody { display: block; }
      .v-table tr {
        display: block;
        border: 1px solid var(--chiron-border);
        border-radius: var(--chiron-radius-sm);
        background: var(--chiron-surface);
        padding: var(--chiron-space-3) var(--chiron-space-4);
        margin-bottom: var(--chiron-space-3);
      }
      .v-table td {
        display: block;
        width: 100%;
        border: none !important;
        padding: 1px 0 !important;
        white-space: normal !important;
      }
      .v-table td.it { font-size: 1.05rem; line-height: 1.4; }
      .v-table td:not(.it):not(.ex) { color: var(--chiron-fg-secondary); margin-top: 2px; }
      .v-table td.ex { margin-top: 4px; }
    }
`;

for (const f of process.argv.slice(2)) {
  let html = readFileSync(f, 'utf8');
  if (html.includes(MARKER)) { console.log('skipped  ' + f + ' (already current)'); continue; }
  const i = html.lastIndexOf('</style>');
  if (i === -1) { console.log('no </style>  ' + f); continue; }
  html = html.slice(0, i) + BLOCK + '\n  ' + html.slice(i);
  writeFileSync(f, html);
  console.log('patched  ' + f);
}
