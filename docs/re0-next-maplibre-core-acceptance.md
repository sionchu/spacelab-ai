# RE0 Next + MapLibre core acceptance

## RE0-01 Runtime shell
- Next.js App Router replaces Vite entry/runtime.
- shadcn/ui primitives are present for Button, Tabs and Slider.
- old Vite entry, old VWorld WebGL renderer, old browser VWorld API adapter and old WebMCP rendering bridge are removed from this branch.

## RE0-02 Real Korean parcel
- VWorld address search runs through a Next.js server route.
- parcel selection resolves `LP_PA_CBND_BUBUN`.
- selected parcel becomes canonical `Site`.
- browser does not receive `VWORLD_API_KEY`.

## RE0-03 MapLibre 3D
- OSM raster basemap renders in MapLibre.
- raster DEM terrain is enabled.
- hillshade is enabled.
- native pan / zoom / pitch / rotate remain available.
- selected parcel is rendered as GeoJSON.
- planned `BuildingMass` is rendered as a fill extrusion.

## RE0-04 Building context
- nearby context buildings are returned as GeoJSON.
- first slice uses OpenStreetMap building footprints with explicit source labeling.
- height uses explicit OSM height, then building levels, then a 9 m fallback.
- this adapter is temporary and must be replaced by Korean GIS building integrated information without changing the GeoJSON rendering contract.

## RE0-05 Solar SSOT
- SunCalc powers canonical solar azimuth / altitude.
- MapLibre global light uses the same solar state.
- DEM hillshade direction / altitude uses the same solar state.
- SpaceLab planned shadow polygon uses the same `solarPosition` function.
- 09:00–18:00 slider updates all of the above.

## RE0-06 Existing domain
- `Site`, `BuildingMass`, `Scenario`, `SpatialWorkspace` stay canonical.
- presets still resolve to ordinary `CreateMassInput`.
- MapLibre sources never become state owners.

## Known gaps before merge
- VWorld / 국토부 GIS건물통합정보 adapter not yet connected; OSM context is temporary.
- free-polygon drawing, A/B UI, View Impact and WebMCP parity must be restored on the new renderer before this branch replaces main.
- package lock should be regenerated once the Next dependency set is finalized.

## Verification
```bash
npm install --no-audit --no-fund
npm run typecheck
npm run build
git diff --check
```
