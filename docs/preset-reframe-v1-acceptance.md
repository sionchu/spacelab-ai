# Preset + Reframe v1 acceptance

## PR scope
- text-only SpaceLab wordmark
- selected-site camera reframe
- workspace overview camera reframe
- building creation split into preset / custom

## PR-01 Branding
- top-left has no boxed single-letter logo
- SpaceLab is rendered as a text wordmark
- desktop subtitle reads `부지·일조·조망 검토`

## PR-02 Site reframe
- selecting a new cadastral parcel automatically frames that parcel
- `선택 부지로 복귀` frames the selected parcel again after manual camera movement
- `전체 보기` includes the selected parcel, active/compare mass footprints, and saved viewpoint when present

## PR-03 Presets
Preset tab exposes:
- 단독주택 — 2층 / 7.2m
- 저층 상가 — 3층 / 12m
- 업무시설 — 6층 / 24m
- 공장동 — 1층 / 12m
- 창고동 — 1층 / 10m
- 농가 시설 — 1층 / 8m

Selecting a preset creates the normal canonical `BuildingMass`; no preset-specific state remains afterward.

## PR-04 Custom
Custom tab exposes:
- 사각형
- 자유형

After creation, existing height / floors / rotation / position / footprint editing remains unchanged.

## Boundaries
Preset dimensions are starting assumptions for early massing only. They do not represent code-compliant or project-specific design standards.

## Verification
```bash
npm ci
npm run typecheck
npm run build
git diff --check
```
