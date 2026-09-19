# RE0 runtime acceptance — 2026-09-19

## Accepted runtime

- Railway project: `spacelab-mobile-preview`
- Service: `spacelab-mobile-preview`
- Public origin: `https://spacelab-mobile-preview-production.up.railway.app`
- Deployed application commit: `78b4237a31e3e32235ba1b08fd0c91ec97794c56`
- Deployment: `08ea9940-b797-44be-a2e3-831ed2c144ba`
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

## Remaining acceptance item

Run Site Tools discovery plus representative read/write calls in a supported ChatGPT desktop built-in browser. Do not merge the RE0 branch into `main` solely on the basis of a normal-browser check.
