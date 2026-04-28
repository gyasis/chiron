# Chiron forest-plot

Tiny vanilla-JS / SVG forest plot for meta-analysis widgets in the medicine domain. No external dependencies.

## Files

- `forest-plot.js` — ES module exporting `renderForestPlot(container, opts)`
- `forest-plot.css` — Minimal styling driven by `--chiron-*` theme tokens

## API

```js
import { renderForestPlot } from './forest-plot.js';

renderForestPlot(document.getElementById('mp'), {
  title: 'Drug X vs placebo — 28-day mortality',
  effectLabel: 'Risk Ratio',
  studies: [
    { label: 'Smith 2018',  effect: 0.82, ci: [0.65, 1.04] },
    { label: 'Jones 2020',  effect: 0.71, ci: [0.55, 0.92] },
    { label: 'Hassan 2022', effect: 0.79, ci: [0.62, 1.01] },
  ],
  summary: { effect: 0.77, ci: [0.68, 0.87] },
  nullLine: 1,
  logScale: false,
});
```

## Options

| Option | Type | Default | Notes |
|---|---|---|---|
| `studies` | `Array<{label, effect, ci: [low, high]}>` | required | One row per study |
| `summary` | `{effect, ci: [low, high]}` | none | Optional diamond at the bottom |
| `title` | `string` | none | Plot title |
| `effectLabel` | `string` | `'Effect'` | X-axis label (e.g. `'Risk Ratio'`, `'Odds Ratio'`) |
| `nullLine` | `number` | `1` | X-value where the dashed reference line sits (`1` for ratios, `0` for diffs) |
| `logScale` | `boolean` | `false` | Use log-x scale (recommended for ratio metrics) |

## Shape match

Designed to consume the `forest-plot` widget shape from
`specs/001-chiron-v1/contracts/widget-spec.ts`:

```ts
type: 'forest-plot';
studies: Array<{ label: string; effect: number; ci: [number, number] }>;
```
