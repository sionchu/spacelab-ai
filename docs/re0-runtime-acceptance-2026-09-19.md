# RE0 runtime acceptance — 2026-09-19

## Accepted runtime

- Railway project: `spacelab-mobile-preview`
- Service: `spacelab-mobile-preview`
- Public origin: `https://spacelab-mobile-preview-production.up.railway.app`
- Deployed application commit: `06a54fe01dc2010cc7ff3b858bab5b54bd79aabc`
- Deployment: `9a7a8754-88f5-439d-a0eb-b796d5f98d65`
- Railway status: `SUCCESS`
- Runtime: Next.js 16.3.3 via `npm start`

## Build gates

GitHub Actions passed on the deployed branch head before deployment:

- `npm install`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

## Public runtime checks

### Application shell

The public root returned SpaceLab successfully and exposed the Korean MapLibre workstation shell:

- title: `SpaceLab`
- renderer status: `MapLibre 3D`
- site/building/analysis/scenario task navigation present

### Address search

VWorld was configured in the Railway runtime but its upstream search endpoint returned HTTP 502 during acceptance.

SpaceLab degraded to the server-side Nominatim fallback and returned two Korean address results for `서울시청`, including `서울특별시청`.

The fallback is intentionally constrained:

- submit-based search, not autocomplete
- serialized to approximately one public Nominatim request per second
- identifying application User-Agent / Referer
- server-side caching
- Korea-only search scope

### Parcel selection

VWorld cadastral selection remains the preferred path. If the VWorld cadastral endpoint is unavailable, SpaceLab now returns a `manual-point` fallback boundary instead of failing the workspace.

The UI and WebMCP surface explicitly identify this as an approximate temporary boundary rather than presenting it as a real cadastral parcel.

### Surrounding buildings

VWorld `F_FAC_BUILDING` remains first choice. During acceptance its upstream request was unavailable, so SpaceLab used the OSM/Overpass fallback.

For a test centered near Seoul City Hall:

- radius: 201 m
- returned building features: 115
- cold-path observed latency after mirror ordering fix: approximately 1.2 s
- features include normalized `heightM` values
- response feeds both MapLibre fill-extrusion and deterministic View Impact

The operational Overpass order is:

1. `overpass-api.de`
2. `overpass.private.coffee`
3. `overpass.osm.jp`

The primary mirror was moved first after live logs showed it was the working endpoint while the other mirrors were failing or timing out.

## Analysis boundaries

- Direct Sun remains an early geometric pre-check.
- View Impact uses surrounding-building footprints/heights and excludes terrain, vegetation, window semantics, and legal view-right conclusions.
- Concept View imagery is presentation-only and never mutates canonical spatial/analysis state.
- Concept View image generation remains unavailable on Railway until a server-side `OPENAI_API_KEY` is intentionally configured.

## WebMCP / Site Tools

The code registers top-level tools through `document.modelContext.registerTool` and shares the same canonical actions as the human UI.

Static/type/build verification is complete. Final Site Tools discovery and representative tool-call acceptance requires a supported ChatGPT desktop built-in browser because ordinary public browsers do not expose `document.modelContext`.

## Acceptance conclusion

RE0 application acceptance is complete and PR #15 has been squash-merged to `main`.

Codex Aside Browser does not expose `document.modelContext`, so Site Tools/WebMCP discovery remains `BLOCKED_BY_HOST`. This is a host-capability limitation, not a SpaceLab application blocker.


## Codex browser pass 1

The first Codex Aside Browser run found a production-only fallback defect after address search:

- search: PASS
- first-result selection: FAIL
- `POST /api/vworld/parcel`: HTTP 500
- error: `Maximum call stack size exceeded`

Root cause was a recursive `manualSite()` fallback. It was fixed in `4208dbc46d2aa277272f853a7baed764cbf9ad00`, verified by CI and deployed successfully.

Evidence: `docs/codex-aside-browser-acceptance-pass1-2026-09-19.md`

The same browser host did not expose `document.modelContext`, so WebMCP discovery was blocked by host capability rather than by the SpaceLab tool-registration code.


## Codex browser pass 2

Production application acceptance passed after the parcel fallback fix.

Highlights:

- `POST /api/vworld/parcel`: HTTP 200
- site selection: PASS
- `manual-point` fallback provenance: PASS
- surrounding OpenStreetMap context: PASS
- planned mass create/edit: PASS
- A/B scenario comparison: PASS
- viewpoint and eye-height controls: PASS
- View Impact for A/B: PASS
- Concept View entry exists; image generation not invoked
- previous stack-overflow defect did not recur

Host-only limitations:

- responsive resize was not available in Codex Aside Browser, although navigation buttons were present in the DOM;
- `document.modelContext` was undefined, so Site Tools/WebMCP discovery remains `BLOCKED_BY_HOST`.

These are not classified as SpaceLab application blockers.

Evidence: `docs/codex-aside-browser-acceptance-pass2-2026-09-19.md`


## Post-merge production alignment

After PR #15 was squash-merged, merged `main` commit `06a54fe01dc2010cc7ff3b858bab5b54bd79aabc` was deployed directly to the existing Railway service without applying the staged environment patch.

Post-merge checks:

- root application shell: PASS
- `MapLibre 3D` marker: PASS
- `서울시청` search: PASS, 2 results
- surrounding building context: PASS, 115 features at the 201 m acceptance radius
- observed building-context retry latency: approximately 3.4 s
- latest Railway deployment status: `SUCCESS`

Production and merged `main` were aligned at this checkpoint.
