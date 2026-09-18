# Concept View v1 runtime acceptance

Branch: `codex/concept-view-v1`

Status: NOT RUN

This gate validates Concept View preparation/export only. Image-provider generation is optional and requires a separately configured server endpoint.

## CV-01 Concept request

- Select a real site and active scenario.
- Choose project type and visual direction.
- Click `Prepare context`.
- Confirm a versioned Concept View request is created.
- Request must include site, scenario/mass, current camera, optional viewpoint, and prompt.

Result: NOT RUN

## CV-02 Camera + mass fidelity

Inspect the exported brief.

- camera coordinates/orientation reflect the current VWorld view when available
- mass height/floors/rotation/footprint match canonical scenario state
- prompt explicitly preserves parcel, mass envelope, orientation, and camera composition

Result: NOT RUN

## CV-03 VWorld context capture

With VWorld Live:

- Prepare context.
- If the runtime permits WebGL canvas export, the captured 16:9-ish context preview should match the current VWorld scene.
- If the runtime blocks canvas export, Concept View must remain usable and clearly report that no reference image was captured.

Do not treat a blocked canvas capture as an application failure if brief export still works.

Result: NOT RUN

## CV-04 Export

- Download brief produces valid JSON.
- Download context produces PNG only when a reference image exists.
- No API key, token, or secret appears in either artifact.

Result: NOT RUN

## CV-05 Static Sites security boundary

Without `VITE_CONCEPT_VIEW_ENDPOINT`:

- Generate image button is disabled.
- UI stays in BRIEF MODE.
- No provider secret is requested or stored in browser state.

Result: NOT RUN

## CV-06 Optional provider endpoint

Only run when a server-side endpoint is intentionally configured.

Expected request:

- POST multipart/form-data
- `metadata`: ConceptViewRequest JSON
- `prompt`: generated prompt
- `referenceImage`: optional PNG

Expected response contains either `imageUrl` or `imageBase64`.

Result: NOT RUN / BLOCKED when no endpoint is configured

## Boundary

Concept View output is an architectural concept visualization, not:

- approved design,
- CAD/BIM geometry,
- legal/planning evidence,
- analysis data,
- construction documentation.

Generated imagery must never mutate canonical spatial analysis state.

## Verification

```bash
npm run typecheck
npm run build
git diff --check
```
