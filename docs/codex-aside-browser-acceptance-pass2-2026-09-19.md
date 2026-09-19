# Codex Aside Browser acceptance — pass 2 — 2026-09-19

## Result

Production application acceptance: **PASS**

Browser/host: Codex Aside Browser fresh session  
Target: `https://spacelab-mobile-preview-production.up.railway.app/`  
Production fix commit: `4208dbc46d2aa277272f853a7baed764cbf9ad00`

## Production verification

- production `POST /api/vworld/parcel`: HTTP 200
- previous `Maximum call stack size exceeded` defect did not recur
- selected site updated successfully
- selected site source: `manual-point`
- fallback boundary: 4 points
- UI provenance explicitly warned that VWorld cadastral API was unstable and an approximate temporary boundary was being used

## UI acceptance

| Step | Result | Observation |
| --- | --- | --- |
| 1 | PASS | SpaceLab / MapLibre 3D shell and map loaded |
| 2 | BLOCKED_BY_HOST | Desktop viewport hid navigation. DOM contained `부지 / 건물 / 분석 / 대안`; Aside host did not expose responsive resize |
| 3 | PASS | Searched `서울시청` |
| 4 | PASS | Two Korean results returned |
| 5 | PASS | First result selection succeeded |
| 6 | PASS | Selected site changed to the returned address |
| 7 | PASS | `임시 위치 경계` / `manual-point` provenance displayed |
| 8 | PASS | Building panel rendered |
| 9 | PASS | Created first preset `단독주택` |
| 10 | PASS | Planned mass and shadow updated in MapLibre 3D |
| 11 | PASS | Height / floors / rotation controls rendered |
| 12 | PASS | Height 7.2→7.5 m, floors 2→3, rotation 0→0.5°, shadow 8.7→9.1 m |
| 13 | PASS | Scenario panel rendered |
| 14 | PASS | Created second preset as B scenario |
| 15 | PASS | A/B represented as A `단독주택`, B `저층 상가`; comparison selection worked |
| 16 | PASS | Analysis panel rendered |
| 17 | PASS | Viewpoint selected |
| 18 | PASS | Eye height changed 1.7→2.2 m |
| 19 | PASS | View Impact rendered for A/B using OpenStreetMap context: mostly visible, 100%, 20/20 |
| 20 | PASS | `컨셉 보기` entry exists |
| 21 | PASS | Concept View image generation was not triggered |

## Surrounding context

- source: `OpenStreetMap`
- feature count observed by browser flow: 348
- API response type: `FeatureCollection`
- API status: HTTP 200

## WebMCP / Site Tools

Codex Aside Browser reported:

```js
typeof document.modelContext === "undefined"
```

Result: **BLOCKED_BY_HOST**

Site Tools discovery and representative WebMCP calls were therefore not run, per acceptance instructions.

This is not classified as an application regression. SpaceLab registration remains conditional on a host-provided `document.modelContext.registerTool`.

Do not add a polyfill, duplicate action state, or renderer-owned tool state to work around a browser host that does not provide the API.

## Host-only limitations

Two acceptance items remain untestable in this host:

1. responsive viewport switching;
2. WebMCP host discovery because `document.modelContext` is absent.

The first is partially evidenced by the navigation buttons existing in the DOM. The second is an external host capability.

Neither is an application blocker for PR #15.

## Conclusion

The production application blocker from pass 1 is resolved.

SpaceLab RE0 application acceptance is **PASS**, subject only to host-capability limitations that do not require application-code changes.
