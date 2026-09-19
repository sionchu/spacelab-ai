# SpaceLab AI handoff

## Current checkpoint

SpaceLab is migrating from the original Vite + VWorld WebGL viewer to a Next.js + MapLibre architecture.

Branch: `codex/next-maplibre-v1`

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

## Next concrete action

Runtime acceptance is recorded in `docs/re0-runtime-acceptance-2026-09-19.md`. The remaining gate is Site Tools discovery plus representative read/write analysis calls in a supported ChatGPT desktop built-in browser before replacing main.
