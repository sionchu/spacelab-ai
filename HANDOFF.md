# SpaceLab AI handoff

## Current checkpoint

SpaceLab RE0 has been merged to `main` as Next.js + MapLibre.

Canonical branch: `main`
Merged PR: #15
Merge commit: `06a54fe01dc2010cc7ff3b858bab5b54bd79aabc`

## Completed in this checkpoint

- Next.js 16 App Router shell
- TypeScript strict configuration
- shadcn-compatible UI primitives
- MapLibre GL JS renderer
- OSM temporary basemap
- raster DEM terrain + hillshade
- selected parcel GeoJSON
- planned building `fill-extrusion`
- SunCalc v2 time-of-day light
- 09:00–18:00 slider
- deterministic SpaceLab shadow polygon retained
- VWorld address/parcel requests moved behind Next.js Route Handlers
- VWorld `F_FAC_BUILDING` surrounding-building GeoJSON with OSM fallback
- surrounding building height normalization and MapLibre fill-extrusion
- shared surrounding-building GeoJSON context for renderer and analysis
- deterministic View Impact from a saved viewpoint against surrounding building footprints/heights
- active/compare View Impact readout with viewpoint marker and eye-height control
- Concept View request model derived from canonical site/scenario plus current MapLibre camera
- MapLibre snapshot capture with presentation-only reference image flow
- server-only `/api/concept-view` image route; OpenAI key is never exposed to the browser
- Concept View panel for project type/style, context preview and generated result
- top-level WebMCP registration through `document.modelContext.registerTool`
- WebMCP reads and mutations reuse the same canonical application actions as the UI
- read-only WebMCP direct-sun and GeoJSON View Impact analysis tools restored
- WebMCP mutations wait for canonical workspace change before returning verification output
- VWorld-first provider access now degrades to rate-limited Nominatim search, explicit manual-point parcel fallback, and mirrored Overpass building context during upstream outages
- old Vite entrypoint, VWorld WebGL renderer, static Sites hosting config and browser-side JSONP VWorld adapter removed
- canonical Site / BuildingMass / Scenario / actions / analysis retained

## Verification

Latest branch verification passes:

```bash
npm install
npm run typecheck
npm run build
git diff --check
```

## Deployment note

The code is Vercel-compatible. The existing Railway preview service requires the Next.js `npm start` command rather than the old static Vite server.

## Boundaries

- do not expose VWorld or provider API keys through public build variables
- MapLibre is renderer-only
- do not move design state into GeoJSON/map sources
- no legal zoning/permit/sunlight-right conclusions
- no generated Concept View image may feed back into analysis geometry
- image generation remains user-triggered and may incur provider usage cost

## Responsibility split

### Codex Aside browser

Browser-only acceptance is defined in `docs/codex-aside-browser-acceptance.md`.

Codex owns:

- rendered UI click-through
- MapLibre visual interaction checks
- `document.modelContext` / Site Tools discovery
- representative WebMCP read/write calls against the live page

Codex does not own Railway configuration, deployment bookkeeping, PR merge, or Concept View image generation.

### ChatGPT project workflow

This workflow owns:

- repository audit and smallest-scope fixes
- GitHub CI/type/build/diff verification
- exact-commit Railway deployment
- provider/runtime log diagnosis
- public HTTP/API acceptance
- canonical acceptance/HANDOFF/PR documentation
- deciding the next technical action from Codex acceptance evidence

Railway note: the staged SpaceLab source points to the merged `main` commit `06a54fe01dc2010cc7ff3b858bab5b54bd79aabc`. A separate staged deletion for the legacy `vworld-diagnostic` service remains because Railway does not expose an individual unstage action through the available API. It does not affect the current SpaceLab runtime unless the environment patch is explicitly applied.

## Accepted RE0 checkpoint

Codex Aside Browser pass 2 is recorded in `docs/codex-aside-browser-acceptance-pass2-2026-09-19.md`.

Application acceptance is PASS:

- production site selection fixed
- manual-point provenance is explicit
- surrounding-building context loads
- mass create/edit works
- A/B scenario comparison works
- viewpoint / View Impact works
- Concept View entry exists without invoking image generation

Host-only limitations are not application blockers:

- Aside Browser cannot switch responsive viewport;
- Aside Browser does not expose `document.modelContext`, so WebMCP is `BLOCKED_BY_HOST`.

PR #15 was squash-merged into `main`.

Post-merge `main` CI passed:

```bash
npm install
npm run typecheck
npm run build
git diff --check
```

Production was then redeployed from merged `main` and verified through the public root, address search and surrounding-building context routes.

Next work should start from `main`; do not continue feature work on `codex/next-maplibre-v1`.