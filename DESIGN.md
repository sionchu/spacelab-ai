# SpaceLab Design System

## Intent

SpaceLab is a map-first spatial planning workstation. The real parcel, terrain, surrounding buildings, planned mass, and analysis state are always more important than application chrome.

## Principles

- Map first: preserve the largest possible uninterrupted spatial canvas.
- Professional before AI: no decorative AI gradients, badges, floating chatbot surfaces, or fake analytics.
- Evidence over decoration: parcel boundary, building geometry, sunlight, shadow, and scenario deltas lead the hierarchy.
- Mobile-native map interaction: pan, zoom, pitch, and rotate are delegated to MapLibre gestures instead of custom button grids.
- One canonical state: UI controls and future agent tools operate on the same `SpatialWorkspace` actions.
- Provider adapters are replaceable: VWorld, DEM, and building context must not own product state.

## Visual roles

- App chrome: deep navy / slate.
- Selected parcel: mint outline with low-opacity fill.
- Active planned mass: mint extrusion.
- Compare mass: restrained blue.
- Existing context buildings: neutral gray.
- Sunlight: warm amber.
- Shadow: neutral dark translucent fill.

## Layout

Desktop:
- compact header
- map occupies the full workspace
- small floating site/search panel
- small floating building panel
- sun timeline docked to the bottom

Mobile:
- map remains full-screen
- panels collapse over the map
- native MapLibre gestures remain available
- analysis controls stay within thumb reach

## Component boundary

- `src/components/map/spatial-map.tsx`: rendering/camera only.
- `src/components/workspace/spatial-workspace.tsx`: human interaction orchestration.
- `src/components/ui/*`: shadcn/ui primitives.
- `src/model.ts`, `src/actions.ts`, `src/analysis.ts`: canonical domain/analysis.
- `src/lib/geojson.ts`: adapter from canonical state to renderer data.
- `src/lib/server/vworld.ts`: VWorld server adapter.

Do not duplicate domain state inside MapLibre sources or React presentation components.
