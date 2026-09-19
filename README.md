# SpaceLab AI

**실제 공간정보 위에서 건물·시설의 배치 대안을 만들고 주변 영향을 비교하는 공간계획 서비스.**

SpaceLab is an early-stage spatial planning workstation. The application keeps site, building mass and scenario data in one canonical model while rendering the current plan over an interactive 3D web map.

## Current stack

- Next.js 16 + TypeScript
- MapLibre GL JS
- shadcn-compatible UI primitives
- SunCalc v2
- Turf.js + GeoJSON
- raster DEM terrain
- VWorld Search/Data APIs behind Next.js Route Handlers
- Vercel-compatible application structure

## Current V0 capabilities

- Korean address search and cadastral parcel selection
- selected parcel rendered as GeoJSON
- building mass presets and editable height/floors/rotation/position
- active and compare scenarios
- MapLibre fill-extrusion 3D planned buildings
- DEM-backed terrain and hillshade
- 09:00–18:00 time slider
- SunCalc solar azimuth/altitude driving MapLibre light and terrain illumination
- deterministic SpaceLab ground-shadow polygon
- responsive desktop/mobile planning UI

## Architecture

```text
Next.js UI
   │
   ├─ application actions → canonical SpatialWorkspace
   │                         ├─ Site
   │                         ├─ BuildingMass
   │                         └─ Scenario
   │
   ├─ MapLibre adapter
   │    ├─ GeoJSON parcel
   │    ├─ fill-extrusion masses
   │    ├─ DEM terrain
   │    └─ SunCalc light
   │
   └─ Next.js Route Handlers
        └─ VWorld address / cadastral APIs
```

MapLibre is a renderer, not the state owner. `src/types.ts`, `src/model.ts`, `src/actions.ts`, and `src/analysis.ts` remain the canonical domain/analysis layer.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set server-only VWorld configuration:

```bash
VWORLD_API_KEY=...
VWORLD_DOMAIN=localhost
```

Do not expose the VWorld key through `NEXT_PUBLIC_*`.

## Deployment

The project is structured for Vercel/Next.js deployment. Configure the same server-side environment variables in the deployment environment.

## Boundaries

SpaceLab is for early spatial planning and alternative comparison. It is not a legal zoning or sunlight-right determination, permit engine, CAD/BIM replacement, structural analysis tool, or substitute for licensed professional review.

## License

MIT for repository-authored source. Map data and provider data remain subject to their own licenses and terms.
