# View Impact v1 runtime acceptance

Branch: `codex/view-impact-v1`

Status: NOT RUN

This gate validates the VWorld runtime behavior of sampled visibility from a saved viewpoint. CI only proves type/build/diff integrity.

## VI-01 Viewpoint reuse

- Set a viewpoint and eye height.
- Open the view for scenario A.
- Switch to scenario B and reopen the same viewpoint.
- Camera origin must remain repeatable.

Result: NOT RUN

## VI-02 Visibility analysis support

- With VWorld Live, click `Analyze view`.
- Result must report VWorld scene support.
- visible samples / total samples must be non-zero.

Result: NOT RUN

## VI-03 Existing-city occlusion

Choose a viewpoint where an existing VWorld building or terrain feature sits between the viewpoint and the planned mass.

- View Impact should report at least one blocked target sample.
- Moving the viewpoint to a clear location should increase the visible sample ratio.

Result: NOT RUN

## VI-04 A/B scenario difference

Create A/B scenarios with meaningfully different height, footprint, or placement.

- Run View Impact from the same saved viewpoint.
- Confirm the estimated visibility ratio can differ between A and B.
- Compare mode must show the same sampled A/B visibility values.

Result: NOT RUN

## VI-05 Planned entity exclusion

SpaceLab's own planned mass must not be treated as a city-context occluder while checking visibility to its target samples.

Result: NOT RUN

## VI-06 WebMCP parity

If Site Tools is available:

- `run_view_impact`

The tool result must match the UI result for the same scenario and saved viewpoint.

Result: NOT RUN / BLOCKED if Site Tools is unavailable

## Boundary

View Impact v1 is a sampled geometric visibility estimate against the loaded VWorld/Cesium 3D scene.

It is not:
- a legal view-right determination,
- a facade-area visibility measurement,
- a planning approval,
- a photorealistic concept rendering.

## Verification

After any runtime fix:

```bash
npm run typecheck
npm run build
git diff --check
```

Do not merge until VI-01 through VI-05 pass. VI-06 may remain BLOCKED only when Site Tools itself is unavailable.
