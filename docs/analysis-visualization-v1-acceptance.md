# Analysis Visualization v1 acceptance

Branch: `codex/analysis-viz-v1`

Status: NOT RUN

This gate validates presentation only. It must not change the underlying sun or view-analysis values.

## AV-01 Direct sun timeline

- Timeline renders from 09:00–18:00.
- Sun / planned-mass shadow / VWorld city-context shadow are visually distinct.
- Clicking an active-scenario segment changes the current shadow time to that sample.

Result: NOT RUN

## AV-02 A/B timeline comparison

- In Compare mode, A and B exposure rows use the same time scale.
- Differences caused by planned-mass geometry are visible without changing the underlying analysis result.

Result: NOT RUN

## AV-03 View visibility bar

- After View Impact analysis, the inspector shows the same visibility ratio returned by the runtime analysis.
- A/B visibility bars use the same 0–100% scale.
- Classification text remains a coarse sampled estimate.

Result: NOT RUN

## AV-04 Layout integrity

Verify at the primary desktop target (1440×900 or larger):

- 3D canvas remains dominant.
- analysis dock does not hide critical map controls.
- compare metrics do not overflow.
- inspector remains scrollable.

Result: NOT RUN

## Boundary

No new analysis algorithm is introduced in this branch.
No chart library is added.
No legal or compliance meaning is attached to the visualization.

## Verification

```bash
npm run typecheck
npm run build
git diff --check
```
