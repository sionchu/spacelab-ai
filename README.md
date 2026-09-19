# SpaceLab

**실제 공간정보 위에서 건물·시설의 배치 대안을 만들고 주변 영향을 비교하는 공간계획 서비스.**

## Current RE0 stack

- Next.js + TypeScript
- shadcn/ui primitives
- MapLibre GL JS
- SunCalc
- Turf.js
- GeoJSON
- raster DEM terrain
- VWorld address + cadastral parcel API
- Vercel-ready Next.js route handlers

## First vertical slice

The current RE0 branch intentionally proves one complete map-first workflow before restoring every V0 feature:

1. Search a Korean address with VWorld.
2. Resolve the real cadastral parcel.
3. Render the parcel as GeoJSON.
4. Render 3D terrain from raster DEM.
5. Load nearby building footprints as GeoJSON context and extrude them.
6. Place a canonical SpaceLab `BuildingMass` preset on the parcel.
7. Move the planned mass by clicking the map.
8. Scrub 09:00–18:00 and update:
   - SunCalc solar azimuth / altitude
   - MapLibre global light
   - DEM hillshade direction / altitude
   - SpaceLab planned-mass shadow polygon
   - direct-sun duration

The canonical domain remains in `src/types.ts`, `src/model.ts`, `src/actions.ts`, and `src/analysis.ts`.

## Architecture

```text
Next.js UI
   │
   ├─ shadcn/ui controls
   ├─ canonical SpatialWorkspace / actions
   └─ MapLibre adapter
         ├─ OSM raster basemap
         ├─ raster DEM terrain
         ├─ nearby building GeoJSON
         ├─ selected parcel GeoJSON
         ├─ planned BuildingMass GeoJSON
         └─ shadow GeoJSON

Next.js route handlers
   ├─ VWorld address search
   ├─ VWorld cadastral parcel
   └─ nearby building context
```

MapLibre owns rendering and camera interaction only. It does not own scenario state.

## Data boundaries

- **VWorld**: Korean address search + cadastral parcel.
- **DEM**: defaults to MapLibre demo terrain and is replaceable with `NEXT_PUBLIC_DEM_TILEJSON`.
- **Nearby buildings**: first RE0 slice uses OpenStreetMap building footprints via a server route. This is explicitly temporary context, not the final Korean building source.
- **Planned geometry**: canonical SpaceLab state converted to GeoJSON.
- **Solar state**: SunCalc is the single solar-position source used by lighting and shadow analysis.

The next data adapter replaces the temporary OSM building context with VWorld / Ministry of Land GIS building integrated information without changing the MapLibre layers.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Required:

```bash
VWORLD_API_KEY=...
```

Optional:

```bash
VWORLD_DOMAIN=localhost
NEXT_PUBLIC_DEM_TILEJSON=https://demotiles.maplibre.org/terrain-tiles/tiles.json
NEXT_PUBLIC_BUILDING_CONTEXT_RADIUS_M=350
```

Never commit `.env.local` or API keys.

## Verification

```bash
npm install --no-audit --no-fund
npm run typecheck
npm run build
git diff --check
```

## Product boundary

SpaceLab is an early planning and scenario-comparison tool. It is not permit advice, a statutory sunlight-right determination, detailed CAD/BIM, structural analysis, or a replacement for licensed professional review.

## License

MIT for repository-authored source. MapLibre, OpenStreetMap, VWorld, DEM providers, and public spatial datasets remain subject to their own terms and attribution requirements.
