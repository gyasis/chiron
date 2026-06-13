/* Mobile flashcard reveal: on ≤768px, vocab cards show ONLY the Italian (first)
 * cell; tap the card to reveal the English translation + note (active recall).
 * Tapping the inline audio ▶ (.chiron-play-inline) still plays audio, not flip.
 * Mobile only; desktop tables unchanged. Idempotent. */
import { readFileSync, writeFileSync } from 'node:fs';

const CSS_MARKER = 'FLASHCARD-REVEAL';
const CSS_BLOCK = `
    /* ${CSS_MARKER} (2026-06-13): vocab cards hide everything after the first
       (Italian) cell behind a tap — tap to reveal the translation + note.
       Mobile only; desktop unchanged. Every row's first <td> is .it (Italian). */
    @media (max-width: 768px) {
      .v-table tr { cursor: pointer; }
      .v-table tr > td:not(:first-child) { display: none; }
      .v-table tr.revealed > td:not(:first-child) { display: block; }
      .v-table tr:not(.revealed)::after {
        content: "Tocca per la traduzione ▾";
        display: block;
        margin-top: var(--chiron-space-2);
        font-size: 0.7rem;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--chiron-muted);
      }
      .v-table tr.revealed::after { content: none; }
    }
`;

const JS_MARKER = 'flashcard-reveal';
const JS_BLOCK = `
  <script>
  /* ${JS_MARKER} (2026-06-13): tap a vocab card to reveal its translation.
     Excludes the inline audio ▶ control so playback still works. CSS gates the
     hide/reveal to ≤768px, so toggling on desktop is a harmless no-op. */
  (function () {
    function init() {
      var rows = document.querySelectorAll('.v-table tr');
      for (var i = 0; i < rows.length; i++) {
        (function (tr) {
          if (tr.__flip) return; tr.__flip = true;
          tr.addEventListener('click', function (e) {
            if (e.target.closest &&
                e.target.closest('.chiron-play-inline, button, a, audio, input')) return;
            tr.classList.toggle('revealed');
          });
        })(rows[i]);
      }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
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
  if (!html.includes('/* ' + JS_MARKER)) {
    const i = html.lastIndexOf('</body>');
    if (i !== -1) { html = html.slice(0, i) + JS_BLOCK + html.slice(i); changed = true; }
  }
  if (changed) { writeFileSync(f, html); console.log('patched  ' + f); }
  else console.log('skipped  ' + f + ' (already current)');
}
