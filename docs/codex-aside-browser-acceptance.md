# Codex Aside Browser acceptance — SpaceLab RE0

## Responsibility

This document is the browser-only acceptance task for Codex.

Codex owns only the checks that require a real supported browser host:

- rendered UI interaction
- browser-visible MapLibre state
- Site Tools / WebMCP discovery through the host-provided `document.modelContext`
- representative WebMCP read/write calls against the live page

Codex must not:

- change repository code unless an acceptance failure clearly requires a fix
- merge PR #15
- change Railway variables or deployment configuration
- trigger Concept View image generation
- create paid external browser sessions
- treat a `manual-point` fallback as a real cadastral parcel

If code changes are required, stop after making the smallest coherent fix on `codex/next-maplibre-v1`, run the repository verification commands, and report the commit SHA. Deployment and PR/runtime bookkeeping remain outside this task.

## Target

- URL: `https://spacelab-mobile-preview-production.up.railway.app/`
- repository: `sionchu/spacelab-ai`
- branch under review: `codex/next-maplibre-v1`
- PR: #15
- accepted deployed code baseline before this browser pass: `78b4237a31e3e32235ba1b08fd0c91ec97794c56`

The public runtime may use provider fallbacks because VWorld was returning upstream errors during server-side acceptance.

## Browser UI acceptance

Use the Codex Aside browser, not a paid external browser provider.

1. Open the target URL.
2. Confirm the rendered shell shows:
   - `SpaceLab`
   - `MapLibre 3D`
   - navigation for `부지 / 건물 / 분석 / 대안`
3. In the site search field submit `서울시청`.
4. Confirm at least one Korean search result is returned.
5. Select the first result.
6. Confirm the selected site changes away from the demo site.
7. Check site provenance:
   - if cadastral VWorld data succeeds, the site may be a real selected parcel;
   - if fallback is used, the UI must clearly show `임시 위치 경계` and must not present it as a real cadastral parcel.
8. Wait for surrounding buildings to load.
9. Confirm the map shows surrounding 3D building extrusions and the source/count indicator is non-empty.
10. Open `건물`.
11. Create one mass using the first available preset.
12. Confirm:
    - a planned 3D mass appears;
    - height control appears;
    - floor control appears;
    - rotation control appears.
13. Move or edit the mass once and confirm the rendered mass updates.
14. Open `대안`.
15. Create or clone a second scenario if the UI supports it, then select A/B comparison and confirm both alternatives are represented.
16. Open `분석`.
17. Confirm:
    - viewpoint selection control exists;
    - eye-height control appears after setting a viewpoint;
    - View Impact result/readout appears when building context is available;
    - `컨셉 보기` button exists.
18. Do not click the final Concept View image-generation action.

Record pass/fail plus a short note for every numbered step. Capture screenshots for any failure.

## Site Tools / WebMCP discovery

This is the key browser-host acceptance that cannot be proven by a normal public browser.

1. Confirm the host exposes `document.modelContext` on the SpaceLab page.
2. Confirm SpaceLab registers the following tools:
   - `get_spatial_workspace`
   - `search_location`
   - `select_site`
   - `create_building_mass`
   - `clone_scenario`
   - `delete_scenario`
   - `edit_building_mass`
   - `set_mass_footprint`
   - `set_sun_study_point`
   - `set_viewpoint`
   - `set_shadow_time`
   - `compare_scenarios`
   - `run_direct_sun_study`
   - `run_view_impact`

If the host provides a Site Tools UI rather than direct JavaScript inspection, use that UI as the source of truth.

## Representative WebMCP calls

Run these against the same live page. Keep changes small and disposable.

### Read baseline

Call `get_spatial_workspace`.

Pass criteria:

- returns current Site / Scenario workspace;
- no separate renderer-owned design state appears;
- planning metrics are included for scenarios.

### Search

Call `search_location` with:

```json
{"query":"서울시청"}
```

Pass criteria:

- returns Korean location results;
- no raw provider key or secret appears.

### Site selection

Use coordinates from the first returned search result with `select_site`.

Pass criteria:

- canonical workspace site changes;
- previous scenarios are cleared;
- if VWorld cadastral data is unavailable, returned site source is `manual-point` and UI says `임시 위치 경계`.

### Create + edit

Call `create_building_mass` with a small conceptual rectangle, for example:

```json
{
  "name":"Codex Acceptance Mass",
  "intent":"browser acceptance only",
  "heightM":18,
  "floors":5,
  "rotationDeg":0,
  "position":{"eastM":0,"northM":0},
  "footprint":{"kind":"rectangle","widthM":20,"depthM":14}
}
```

Then call `edit_building_mass` on the created scenario:

```json
{
  "scenarioId":"<created id>",
  "heightM":21,
  "rotationDeg":12
}
```

Pass criteria:

- tool result reflects the canonical reducer change;
- UI updates without reload;
- map mass updates consistently.

### Clone + compare

Clone the created scenario and call `compare_scenarios` with the original as primary and clone as compare.

Pass criteria:

- both scenario IDs exist;
- active/compare IDs match the request;
- comparison is visible in the UI/map.

### Direct Sun

Set a sun-study point near the selected site and call `run_direct_sun_study`.

Pass criteria:

- result contains `scope: planned-mass-only`;
- sample totals/durations are returned;
- result is not framed as a legal sunlight-right conclusion.

### View Impact

Set a viewpoint outside the planned mass with `set_viewpoint`, then call `run_view_impact`.

Pass criteria:

- result source is `context-building-geojson` when context is available;
- result scope is `surrounding-buildings-only`;
- visible sample counts and classification are returned;
- no terrain/window/legal view-right claim is made.

## Concept View boundary

Do not generate an image.

Confirm only that:

- the `컨셉 보기` UI entry exists;
- generated imagery is described as presentation-only;
- no Concept View output is used by PlanningMetrics, Direct Sun, View Impact, Site, Scenario, or BuildingMass state.

## Evidence to return

Return one concise acceptance report containing:

- browser + host used
- target URL
- UI steps: PASS/FAIL
- whether `document.modelContext` exists
- discovered tool names
- each representative tool call: PASS/FAIL
- any console/runtime errors
- screenshots for failures
- if a code fix was necessary: files changed, commit SHA, verification results

Do not merge PR #15. The next repository/deployment decision is handled after this report.
