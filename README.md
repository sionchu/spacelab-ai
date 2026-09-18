# SpaceLab AI

**현실 공간 위에서 초기 건축 massing 대안을 만들고 비교하는 Spatial Decision Canvas.**

SpaceLab is a small browser-native V0 for non-specialists. It places conceptual building masses on a VWorld 3D context, keeps scenario branches in one canonical state, and exposes the same application actions to the human UI and WebMCP.

## V0 scope

- VWorld address search and real cadastral parcel selection (`LP_PA_CBND_BUBUN`)
- Empty-site start with direct rectangle / free-polygon mass creation
- Rectangular and free-polygon `BuildingMass` footprints
- Height, floors, footprint, position, and rotation editing
- Canvas parcel pick, polygon drawing, and click-to-move mass placement
- Scenario clone/branch with parent relationships
- A/B comparison with GFA, height, solar-geometry shadow deltas, and direct-sun duration
- Geolocation/date/time solar position and ground shadow polygon preview
- Selectable ground-point Direct Sun Hours pre-check with planned-mass shadow plus VWorld 3D scene/terrain occlusion when supported
- Repeatable VWorld viewpoint for scenario viewing and sampled View Impact estimation
- Planned site coverage/FAR metrics from parcel area and current mass
- VWorld WebGL adapter with a no-key fallback geometry canvas
- WebMCP tools that call the same application action surface as the UI

This is early-stage massing exploration. It is not a legal sunlight-right determination, building-permit advice, full CAD/BIM system, structural analysis, or a replacement for licensed professional review.

## Architecture

```text
Human UI ───────┐
                ├─ application actions → canonical SpatialWorkspace
WebMCP adapter ─┘             │
                              ├─ Site (real parcel + boundary)
                              ├─ BuildingMass
                              ├─ Scenario branches
                              └─ analysis selectors
                                    ↓
                         VWorld / fallback rendering adapter
```

`src/types.ts` defines the canonical `BuildingMass`, `Scenario`, and workspace types. `src/model.ts` contains pure state transitions and analysis helpers. `src/actions.ts` is the shared application action surface. `src/vworld.ts` is a rendering adapter; it does not own scenario state. `src/webmcp.ts` registers tools against the same actions used by React event handlers.

## Local setup

```bash
npm install
npm run dev
```

The Vite config reads `VITE_VWORLD_API_KEY` from the process/hosted environment first, then supports the local `C:\Users\<you>\.codex\.env` variables `VITE_VWORLD_API_KEY` or `VWORLD_API_KEY`. `VITE_VWORLD_DOMAIN` controls the VWorld service-domain parameter and should match the deployed Site host. The key is only injected into the browser bundle for the VWorld adapter; it is never stored in this repository. Without a key, the fallback geometry remains fully interactive.

For a local project `.env`, copy `.env.example` to `.env` and set `VITE_VWORLD_API_KEY`. `.env` files are ignored by Git.

## WebMCP tools

- `get_spatial_workspace`
- `search_location`
- `select_site`
- `create_building_mass`
- `delete_scenario`
- `clone_scenario`
- `edit_building_mass`
- `set_mass_footprint`
- `set_shadow_time`
- `set_sun_study_point`
- `set_viewpoint`
- `run_direct_sun_study`
- `run_view_impact`
- `compare_scenarios`

WebMCP is optional. The site remains usable without a Site Tools-capable host.

## Sites deployment

See [`SITES_DEPLOY.md`](./SITES_DEPLOY.md). Configure `VITE_VWORLD_API_KEY` as a hosted build environment variable, deploy the Vite app, then allowlist the final public Site origin in the VWorld console.

## License

MIT for repository-authored source. VWorld, Cesium, and any provider data remain subject to their own terms.
