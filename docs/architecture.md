# SpaceLab architecture

## Canonical state

`Site`, `BuildingMass`, and `Scenario` are the domain objects. `Site` owns the selected real-world parcel center, VWorld cadastral boundary, optional PNU/address provenance, and is the georeference for all local mass geometry. Selecting a new site clears the previous scenario graph rather than silently reusing geometry on another parcel.

`BuildingMass` and `Scenario` remain the design objects. A `BuildingMass` contains a local-coordinate footprint, height, floors, position offset, rotation, and site center. A `Scenario` owns one mass plus its branch parent, intent, provenance, and analysis date/time. `SpatialWorkspace` holds the scenario collection and active/compare selections.

The reducer in `src/model.ts` is pure and owns state transitions. It normalizes numeric ranges and deep-clones footprints when branching so a branch cannot mutate its parent by reference.

## Shared application actions

`src/actions.ts` exposes `selectScenario`, `compareScenarios`, `cloneScenario`, `editBuildingMass`, `setMassFootprint`, and `setShadowTime`. React handlers and WebMCP tool executions call these same functions. This keeps human edits and agent edits on one state path.

## Adapters

- `src/vworld.ts` converts canonical local footprint points into geographic coordinates and renders Cesium/VWorld entities. It is optional and is never the source of scenario state.
- The fallback canvas is a UI rendering adapter for local development without an API key.
- `src/webmcp.ts` registers tools only when `document.modelContext` exists. It reports the same workspace and dispatches the same application actions.

## Deliberate V0 boundary

The shadow helper is a qualitative deterministic preview for comparing alternatives. It does not model legal criteria, neighboring parcel rights, detailed terrain, structural systems, or BIM semantics.


## Real-site adapter

`src/vworld-api.ts` keeps external data outside canonical state transitions:

1. VWorld Search API resolves a Korean address to EPSG:4326 coordinates.
2. VWorld Data API queries `LP_PA_CBND_BUBUN` with a point geometry filter.
3. The resulting parcel polygon is normalized into canonical `Site`.
4. UI and WebMCP both call `setSite`; neither mutates renderer state directly.

The VWorld/Cesium canvas also exposes point picking for parcel selection, free-polygon drawing, and click-to-move mass placement. These interactions convert geographic clicks into the site's local meter coordinates before dispatching canonical application actions.


## Analysis Pack v1

`src/analysis.ts` is a deterministic analysis layer over canonical `Site` and `BuildingMass` data.

- `planningMetrics` derives parcel area, footprint, estimated GFA, planned coverage, and planned FAR. These are plan metrics, not legal allowances.
- `directSunStudy` is the deterministic planned-mass layer: it samples solar geometry from 09:00–18:00 and checks whether a selected ground point falls inside the current planned mass shadow.
- `sampleSceneSunContext` in the VWorld adapter samples the loaded Cesium/VWorld 3D scene along each sun vector with `sampleHeightMostDetailed`. Existing 3D Tiles and terrain can therefore block direct sun. SpaceLab-owned mass/shadow/site entities are excluded from scene sampling so the deterministic planned-mass layer is not double-counted.
- `sunStudyPoint` and `viewpoint` are canonical workspace state so Human UI and WebMCP operate on the same analysis targets.
- VWorld/Cesium remains an adapter: it renders analysis markers and moves the camera to a saved viewpoint, but does not own analysis state.

This phase intentionally does not implement zoning/legal compliance or statutory sunlight-right determination. City-context direct-sun results are runtime geometric estimates that depend on the VWorld 3D scene and available scene-height sampling.


## View Impact v1

View Impact reuses the canonical `viewpoint`, `Site`, and `BuildingMass` state.

- `viewTargetSamples` creates deterministic target samples across the planned mass footprint and vertical levels.
- `sampleViewImpact` samples the VWorld/Cesium scene height between the saved viewpoint and each target sample. SpaceLab-owned entities are excluded, so existing VWorld city/terrain context acts as the occluder.
- The result reports visible sample count, total sample count, an estimated visibility ratio, and a coarse visibility classification.
- UI and WebMCP call the same runtime scene-analysis function.

This is a geometric comparison aid. The visibility percentage is a sampled estimate, not facade-area measurement, legal view-right determination, or planning approval.


## Analysis Visualization v1

`src/analysis-visuals.tsx` is presentation-only.

- Direct-sun samples are rendered as a shared 09:00–18:00 exposure strip.
- Planned-mass shadow and VWorld city-context obstruction remain visually distinct.
- Compare mode renders A/B exposure rows on the same time scale.
- View Impact uses a simple 0–100% visibility bar backed by the existing sampled runtime result.

This layer does not recalculate or reinterpret analysis results and introduces no charting dependency.


## Concept View v1

Concept View is deliberately separated from deterministic spatial analysis.

- `src/concept-view.ts` builds a provider-neutral request from canonical `Site`, one `Scenario`, the saved `viewpoint`, and the current VWorld camera.
- `captureVWorldSnapshot` is a best-effort rendering-adapter helper. A runtime may refuse or return no canvas image; Concept View still exports the structured brief in that case.
- `src/concept-view-provider.ts` contains only the browser-to-server contract. It never receives a provider API key.
- `VITE_CONCEPT_VIEW_ENDPOINT` is an optional public endpoint URL. The endpoint, if configured, owns provider authentication and returns a generated image URL or base64 payload.
- Generated imagery is presentation material. It does not mutate `Site`, `BuildingMass`, `Scenario`, solar results, or View Impact results.

A future server implementation can use an image-edit/generation model with the captured VWorld view as reference while preserving the mass envelope and camera composition.
