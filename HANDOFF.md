# SpaceLab RE0 handoff

## Baseline

Branch: `re0/next-maplibre-core`

The old Vite + VWorld WebGL rendering shell has been removed on this branch. Canonical spatial state and analysis remain.

## KEEP

- `Site`
- `BuildingMass`
- `Scenario`
- `SpatialWorkspace`
- reducer + application actions
- planning metrics
- direct-sun study
- building presets

## RE0

- Vite application shell
- VWorld WebGL/Cesium renderer ownership
- old monolithic `App.tsx`
- old 50k-line accumulated stylesheet
- browser-side VWorld key injection
- stale Sites deployment boundary
- old WebMCP rendering bridge

## Current first slice

- Next.js app router
- MapLibre 3D terrain
- GeoJSON parcel / building / mass / shadow layers
- VWorld server-side address + parcel routes
- OSM building context adapter
- SunCalc solar SSOT
- shadcn Button / Tabs / Slider
- map-first responsive workstation

## Verification

Latest branch CI must pass:

- install
- typecheck
- Next build
- diff-check

## Next best action

Replace temporary OSM building context with the Korean GIS building integrated information adapter while keeping the same GeoJSON contract.
