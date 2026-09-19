# Codex Aside Browser acceptance — pass 1 — 2026-09-19

## Result

Production acceptance was blocked at site selection before the fix.

Browser/host: Codex Aside Browser  
Target: `https://spacelab-mobile-preview-production.up.railway.app/`

## UI observations

- SpaceLab / MapLibre 3D shell loaded.
- `서울시청` search succeeded and returned two Korean results.
- Selecting the first result failed to update the site.
- Production `POST /api/vworld/parcel` returned HTTP 500 with `Maximum call stack size exceeded`.
- Massing, scenario, analysis and View Impact UI checks were blocked by the failed site-selection prerequisite.
- Concept View generation was not triggered.

## Root cause

`lib/vworld/server.ts` contained a recursive fallback:

```ts
function manualSite(pointValue: GeoPoint, label?: string): Site {
  return manualSite(pointValue, label);
}
```

The error only occurred when VWorld parcel resolution fell back to `manual-point`, which is why address search could succeed while result selection failed.

## Resolution

The canonical branch fix is commit:

`4208dbc46d2aa277272f853a7baed764cbf9ad00`

The fix restores deterministic four-point approximate fallback geometry and removes the recursive call.

Verification:

- `npm install`: PASS
- `npm run typecheck`: PASS
- `npm run build`: PASS
- `git diff --check`: PASS

Production:

- active Railway deployment after fix: `1961365c-0bb4-41fd-8b92-ebc70391d495`
- deployed commit: `4208dbc46d2aa277272f853a7baed764cbf9ad00`
- Railway status: `SUCCESS`

## WebMCP host result

The Codex Aside Browser reported:

```js
typeof document.modelContext === "undefined"
```

Therefore Site Tools discovery and representative WebMCP calls could not run in that host.

This is classified as a **host capability blocker**, not a SpaceLab registration-code failure. SpaceLab keeps WebMCP registration optional and only registers when the host supplies `document.modelContext.registerTool`.

Do not add a browser polyfill or duplicate tool state solely to make a normal/unsupported browser expose WebMCP.

## Next browser check

Re-run the UI acceptance on the fixed production deployment.

Required focus:

1. search `서울시청`;
2. select the first result;
3. confirm selected site changes;
4. confirm fallback shows `임시 위치 경계` if VWorld cadastral resolution is still unavailable;
5. continue surrounding buildings, mass creation/editing, scenario compare, viewpoint and View Impact UI checks.

For WebMCP, only record whether `document.modelContext` exists. If it remains undefined, mark the WebMCP section `BLOCKED_BY_HOST` and do not treat it as an application-code regression.
