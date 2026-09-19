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
- `auto` provider tries VWorld `F_FAC_BUILDING` first and falls back to OpenStreetMap.
- both providers normalize Polygon/MultiPolygon features into the same GeoJSON contract.
- height uses explicit height fields first, then floor-count × 3.2 m, then a 9 m fallback.
- exact VWorld building-layer runtime compatibility is not accepted until observed with a valid production key.

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

## RE0-07 Restored editing parity
- custom free-polygon drawing works through MapLibre map clicks and draft GeoJSON.
- scenario clone/selection is restored.
- A/B comparison renders both planned masses in the same MapLibre canvas.
- the time slider synchronizes active and compare scenario analysis time.
- compact A/B height, estimated GFA, and direct-sun values are visible.

## Known gaps before merge
- VWorld-first building adapter is connected but its exact `F_FAC_BUILDING` runtime compatibility is still unverified; `auto` falls back to OSM.
- View Impact and WebMCP parity still need restoration on the new renderer.
- package lock should be regenerated once the Next dependency set is finalized.
- Vercel runtime acceptance still needs an authenticated deployment target.

## Verification
```bash
npm install --no-audit --no-fund
npm run typecheck
npm run build
git diff --check
```
