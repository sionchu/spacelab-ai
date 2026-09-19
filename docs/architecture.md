# SpaceLab architecture

## Canonical state

`Site`, `BuildingMass`, `Scenario`, and `SpatialWorkspace` remain the domain SSOT.

- `Site` owns the selected real-world parcel center, cadastral boundary, optional PNU/address provenance.
- `BuildingMass` owns conceptual footprint, height, floors, position offset and rotation.
- `Scenario` owns one mass plus branch/provenance and analysis time.
- `src/model.ts` owns pure reducer transitions and deterministic geometry helpers.
- `src/actions.ts` is the application action surface.

Rendering libraries never own canonical design state.

## Next.js application boundary

The app shell is Next.js 16 App Router.

- `app/page.tsx` hosts the workspace.
- `components/workspace/workspace-client.tsx` binds UI events to canonical actions.
- `app/api/vworld/*` are server Route Handlers.
- VWorld credentials remain server-side.

This replaces the previous Vite + browser-side VWorld WebGL shell.

## MapLibre rendering adapter

`components/map/spatial-map.tsx` consumes canonical state and produces render-only GeoJSON.

Current layers:

1. temporary OSM raster basemap
2. Mapzen Terrarium raster-dem terrain
3. DEM hillshade
4. selected parcel fill + line
5. deterministic ground-shadow polygons
6. planned active/compare buildings using `fill-extrusion`

The renderer accepts map interaction events and converts selected geographic points back into canonical application actions. It does not persist independent building/site state.

## Solar visualization

SunCalc v2 supplies:

- azimuth in degrees clockwise from north
- apparent solar altitude in degrees

The 09:00–18:00 slider updates:

- MapLibre global light
- DEM hillshade illumination
- the deterministic SpaceLab building-shadow polygon

The ground-shadow analysis remains a SpaceLab geometry result rather than relying on a visual-only renderer shadow.

## GeoJSON and Turf

Canonical geometry is converted at the adapter boundary.

- parcel boundary → GeoJSON Polygon
- building footprint → GeoJSON Polygon with height properties
- analysis shadow → GeoJSON Polygon
- Turf.js handles bounds and feature collections used by the renderer

## Korea data boundary

VWorld remains a spatial data provider rather than the map engine.

- `GET /api/vworld/search` resolves addresses
- `POST /api/vworld/parcel` resolves `LP_PA_CBND_BUBUN` cadastral polygons
- browser clients never receive the VWorld API key

The next milestone adds surrounding Korean building footprints/attributes as GeoJSON/vector tiles and extrudes them in MapLibre.

## Deliberate boundaries

- planning metrics are not legal maxima
- direct-sun/shadow results are geometric planning aids
- Concept View is presentation-only when reintroduced on the Next.js renderer
- no CAD/BIM or permit/legal compliance claims
