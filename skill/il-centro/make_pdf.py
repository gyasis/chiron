#!/usr/bin/env python3
"""Wrap the artifact HTML in a print-ready document and render it to PDF via headless Chrome."""

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "barbara-lezione.html")
PRINT_HTML = os.path.join(HERE, "_print.html")
PDF = os.path.join(HERE, "Lezione-Barbara-2026-08-03.pdf")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

PRINT_CSS = """
<style>
  html { color-scheme: light; }

  /* Chrome paints the page background only inside the @page content box, so any
     non-zero page margin prints white. Zero the margins to get true full bleed and
     rebuild the inset as padding on .wrap. */
  @page {
    size: A4;
    margin: 0;
  }

  html, body {
    background: var(--ground) !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  body {
    font-size: 10.5pt;
    line-height: 1.55;
    margin: 0;
  }

  .wrap {
    max-width: none;
    padding: 16mm 14mm 18mm;
    gap: 9mm;
  }

  /* .wrap's top/bottom padding only applies to the first and last page. Give every
     block its own vertical breathing room so a mid-list page break can never drop
     content flush against the trimmed edge. */
  section { padding-block: 5mm; }
  .key, .trap, .scaffold, .clocks { margin-block: 1mm; }

  /* Keep atomic blocks whole across page breaks */
  .key, .trap, .scaffold, .clocks, .key-row,
  dl.phrases > div, ol.check li {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  /* A heading must never be stranded at the foot of a page */
  section > h2, h3, .eyebrow {
    break-after: avoid;
    page-break-after: avoid;
  }
  section { break-before: auto; }

  .board { break-after: avoid; }
  .board h1 { font-size: 24pt; }
  section > h2 { font-size: 15pt; }
  h3 { font-size: 11.5pt; }

  dl.phrases .why { font-size: 8.5pt; line-height: 1.45; }
  .key-row .ex { font-size: 8.5pt; }
  .scaffold pre { font-size: 8.5pt; line-height: 1.75; white-space: pre-wrap; }

  footer { break-inside: avoid; }
</style>
"""


def main():
    body = open(SRC, encoding="utf-8").read()

    # The artifact file is a fragment (no doctype/head/body) — supply them, and pin
    # the light theme so the PDF never renders the dark palette.
    doc = (
        '<!doctype html>\n<html lang="it" data-theme="light">\n<head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"{body}\n{PRINT_CSS}\n</head>\n<body>\n"
        # everything after the </style> of the source fragment is the markup
        "</body>\n</html>\n"
    )
    # Simpler and safer: split the fragment at the end of its own <style> block.
    marker = "</style>"
    idx = body.index(marker) + len(marker)
    head_part, markup = body[:idx], body[idx:]
    doc = (
        '<!doctype html>\n<html lang="it" data-theme="light">\n<head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"{head_part}\n{PRINT_CSS}\n</head>\n<body>\n{markup}\n</body>\n</html>\n"
    )

    with open(PRINT_HTML, "w", encoding="utf-8") as f:
        f.write(doc)

    if os.path.exists(PDF):
        os.remove(PDF)

    subprocess.run([
        CHROME,
        "--headless",
        "--disable-gpu",
        "--no-pdf-header-footer",
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=6000",
        f"--print-to-pdf={PDF}",
        f"file://{PRINT_HTML}",
    ], check=True, capture_output=True)

    size = os.path.getsize(PDF)
    print(f"PDF: {PDF} ({size/1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
