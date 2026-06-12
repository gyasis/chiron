/* Mobile wide-table solution: SWIPE (horizontal scroll).
 * Wraps each lesson table in a .chiron-table-scroll box so the TABLE scrolls
 * sideways (grid stays intact) instead of cramming columns or widening the page.
 * Supersedes the earlier "table-layout:fixed" cram. Idempotent; desktop untouched
 * (all rules + the wrapper's effect are scoped to @media ≤768px).
 * Run on the skeleton + any built lesson HTML files passed as args. */
import { readFileSync, writeFileSync } from 'node:fs';

const CSS_MARKER = 'RESPONSIVE-TABLE-SWIPE';
const CSS_BLOCK = `
    /* ${CSS_MARKER} (2026-06-12): wide tables scroll horizontally inside their
       own box on mobile — columns stay aligned, the page never widens. A wrapper
       .chiron-table-scroll is placed around each table by the swipe script below.
       This SUPERSEDES the earlier table-layout:fixed cram (later block wins). */
    @media (max-width: 768px) {
      .v-table, .sr-conj-table { table-layout: auto; }
      .v-table th, .v-table td,
      .sr-conj-table th, .sr-conj-table td { word-break: normal; white-space: normal; }

      .chiron-table-scroll {
        max-width: 100%;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        margin: var(--chiron-space-3) 0;
        border-radius: var(--chiron-radius-sm);
        /* CSS scroll-shadows (Lea Verou): a right-edge shadow appears while more
           table is off-screen and fades out once you've scrolled to the end. */
        background:
          linear-gradient(to right,  var(--chiron-surface) 30%, rgba(255,255,255,0)) 0 0,
          linear-gradient(to left,   var(--chiron-surface) 30%, rgba(255,255,255,0)) 100% 0,
          radial-gradient(farthest-side at 0 50%,   rgba(0,0,0,0.14), rgba(0,0,0,0)) 0 0,
          radial-gradient(farthest-side at 100% 50%, rgba(0,0,0,0.14), rgba(0,0,0,0)) 100% 0;
        background-repeat: no-repeat;
        background-size: 28px 100%, 28px 100%, 12px 100%, 12px 100%;
        background-attachment: local, local, scroll, scroll;
      }
      .chiron-table-scroll > table { margin: 0; }
      /* keep columns comfortable (not crushed); the wrapper provides the scroll.
         min-width > max-width:100%, so columns get real room and you swipe. */
      .chiron-table-scroll > .v-table      { min-width: 30rem; }
      .chiron-table-scroll > .sr-conj-table { min-width: 22rem; }
    }
`;

const JS_MARKER = 'table-swipe-wrap';
const JS_BLOCK = `
  <script>
  /* ${JS_MARKER} (2026-06-12): wrap every lesson table in a horizontal-scroll box.
     Unconditional (works after a resize too); the box only scrolls at ≤768px via CSS. */
  (function () {
    function wrap() {
      var tables = document.querySelectorAll('.v-table, .sr-conj-table');
      for (var i = 0; i < tables.length; i++) {
        var t = tables[i], p = t.parentNode;
        if (p && p.classList && p.classList.contains('chiron-table-scroll')) continue;
        var box = document.createElement('div');
        box.className = 'chiron-table-scroll';
        p.insertBefore(box, t);
        box.appendChild(t);
      }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wrap);
    else wrap();
  })();
  </script>
`;

for (const f of process.argv.slice(2)) {
  let html = readFileSync(f, 'utf8');
  let changed = false;
  if (!html.includes(CSS_MARKER)) {
    const i = html.lastIndexOf('</style>');
    if (i !== -1) { html = html.slice(0, i) + CSS_BLOCK + '\n  ' + html.slice(i); changed = true; }
  }
  if (!html.includes(JS_MARKER)) {
    const i = html.lastIndexOf('</body>');
    if (i !== -1) { html = html.slice(0, i) + JS_BLOCK + html.slice(i); changed = true; }
  }
  if (changed) { writeFileSync(f, html); console.log('patched  ' + f); }
  else console.log('skipped  ' + f + ' (already current)');
}
