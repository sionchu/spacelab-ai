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
- VWorld/OSM surrounding-building GeoJSON with normalized height extrusion
- saved viewpoint and deterministic surrounding-building View Impact comparison
- presentation-only Concept View from the current MapLibre snapshot and active mass
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
   │    ├─ SunCalc light
   │    └─ surrounding-building GeoJSON
   │
   └─ Next.js Route Handlers
        ├─ VWorld address / cadastral / building APIs
        └─ server-only Concept View image generation
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

PlaySafe can additionally merge the Ministry of the Interior and Safety SafeMap
children's playground registry when a server-only SafeMap key is configured:

```bash
SAFEMAP_API_KEY=...
```

The integration reads official `IF_0007` facility records, keeps operating
outdoor urban-park / housing-complex / mixed-use playgrounds, and merges nearby
duplicates with OSM/VWorld candidates while preserving OSM polygon geometry
when available. Never expose this key through `NEXT_PUBLIC_*`.

Concept View is optional and requires a server-only OpenAI key:

```bash
OPENAI_API_KEY=...
OPENAI_IMAGE_MODEL=gpt-image-2.5-sunburst
OPENAI_IMAGE_SIZE=1536x1024
OPENAI_IMAGE_QUALITY=medium
```

The generated image is presentation-only and never mutates the canonical site, scenario, mass, sunlight, or View Impact geometry.

## Site Tools / WebMCP

SpaceLab registers top-level WebMCP tools when `document.modelContext.registerTool` is available. The tools reuse the same canonical application actions and analysis functions as the human UI.

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

Concept View generation is intentionally not exposed as a WebMCP tool because it is a user-triggered, potentially billable presentation operation.

## Deployment

The project is structured for Vercel/Next.js deployment. Configure the same server-side environment variables in the deployment environment.

## Boundaries

SpaceLab is for early spatial planning and alternative comparison. It is not a legal zoning, sunlight-right, or view-right determination, permit engine, CAD/BIM replacement, structural analysis tool, or substitute for licensed professional review. Concept View images are illustrative, not analysis evidence.

## License

MIT for repository-authored source. Map data and provider data remain subject to their own licenses and terms.
