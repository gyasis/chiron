# Chiron — Vendored Libraries

All assets here are vendored (not loaded from CDN at runtime) so Chiron lessons remain offline-capable and self-contained.

## MathJax + mhchem

- **Path:** `mathjax/tex-mml-chtml.js`, `mathjax/mhchem.js`
- **Version:** MathJax 3.2.2
- **Source:** https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-mml-chtml.js
- **mhchem source:** https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/input/tex/extensions/mhchem.js
- **License:** Apache-2.0

Used for math rendering across all domains; mhchem extension renders chemistry equations (medicine domain).

## Mermaid

- **Path:** `mermaid/mermaid.min.js`
- **Version:** Mermaid 11.4.0
- **Source:** https://cdn.jsdelivr.net/npm/mermaid@11.4.0/dist/mermaid.min.js
- **License:** MIT

Used for sequence diagrams, flowcharts, ER diagrams (concept maps, causal chains).

## Forest Plot

- **Path:** `forest-plot/forest-plot.js`, `forest-plot/forest-plot.css`
- **Version:** Chiron-internal (unversioned, see git history)
- **License:** project-internal (Chiron)

Custom vanilla JS / SVG forest-plot mini-lib for medicine-domain meta-analysis widgets. See `forest-plot/README.md` for usage.

## Update procedure

When updating a vendor library:
1. Re-download to a temp location, verify size + sha256 are reasonable
2. Replace the file in this directory
3. Update the version + source URL in this README
4. Test all lessons that consume that library before committing
