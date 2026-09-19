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

## Next concrete action

Add Korean surrounding-building footprints and height attributes to the MapLibre scene, then reconnect View Impact and Concept View to the new renderer.
