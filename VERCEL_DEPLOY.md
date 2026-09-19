# Vercel deployment

SpaceLab RE0 is a native Next.js application and requires no custom Vercel framework configuration.

## Environment variables

Set these in the Vercel project:

```bash
VWORLD_API_KEY=...
VWORLD_DOMAIN=<production host if required by the VWorld key policy>
NEXT_PUBLIC_DEM_TILEJSON=https://demotiles.maplibre.org/terrain-tiles/tiles.json
NEXT_PUBLIC_BUILDING_CONTEXT_RADIUS_M=350
SPACELAB_BUILDING_PROVIDER=auto
```

`VWORLD_API_KEY` is server-side only. Do not rename it to a `NEXT_PUBLIC_*` variable.

## Build

Vercel should detect Next.js automatically.

```bash
npm install
npm run build
```

## Runtime checks

1. Search a Korean address.
2. Confirm the parcel boundary loads.
3. Confirm terrain pitch/rotation works.
4. Confirm nearby building context extrudes.
5. Create a preset mass.
6. Scrub the 09:00–18:00 timeline and confirm building light, hillshade, and planned shadow all move consistently.
