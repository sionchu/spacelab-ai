# Next + MapLibre v1 acceptance

## Goal
Replace the Vite/VWorld viewer shell with a Next.js + MapLibre renderer while retaining the canonical SpaceLab domain and deterministic analysis model.

## NM-01 Application shell
- Next.js 16 App Router
- TypeScript strict mode
- shadcn-compatible component configuration
- Vercel-compatible scripts: dev/build/start

## NM-02 Map renderer
- MapLibre GL JS is the state-free rendering adapter.
- OpenStreetMap raster is the temporary basemap.
- Mapzen Terrarium DEM is loaded as raster-dem terrain.
- pitch/bearing/zoom gestures and MapLibre navigation controls remain native.

## NM-03 Canonical spatial data
- Site, BuildingMass, Scenario, actions and reducer remain canonical.
- selected Site renders as GeoJSON fill + line.
- active/compare BuildingMass renders as GeoJSON fill-extrusion.
- renderer never owns application state.

## NM-04 Solar time
- SunCalc v2 supplies north-clockwise azimuth and apparent altitude.
- 09:00–18:00 slider updates MapLibre global light and DEM hillshade illumination.
- deterministic SpaceLab shadow polygon remains the ground-shadow analysis source.

## NM-05 Korea site selection
- VWorld key moves behind Next.js Route Handlers.
- browser calls /api/vworld/search and /api/vworld/parcel.
- VWorld key is not required in client-side build variables.

## NM-06 RE0
Remove the old Vite entry shell, VWorld WebGL renderer, static Sites hosting config and browser-side VWorld JSONP adapter.

## Next milestone
Add Korean surrounding-building footprints/attributes as GeoJSON or vector tiles, extrude them in MapLibre, then reconnect View Impact and Concept View on the new renderer.
