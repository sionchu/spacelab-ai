# Concept View v2 acceptance

## CV-01 Entry
- active scenario가 있으면 데스크톱 지도 유틸리티와 모바일 `분석` 메뉴에서 `컨셉 보기`에 접근할 수 있다.
- active scenario가 없으면 진입 버튼은 비활성화된다.

## CV-02 Context capture
- `현재 화면 준비` 실행 시 현재 VWorld 카메라 상태와 canonical scenario mass를 request에 포함한다.
- VWorld canvas 캡처가 가능하면 현재 3D 화면을 reference image로 사용한다.
- 캡처가 불가능해도 mass/site/camera brief는 유지된다.

## CV-03 Presentation boundary
- Concept View는 presentation-only 기능이다.
- 생성된 이미지는 PlanningMetrics, Direct Sun, View Impact, canonical BuildingMass에 어떠한 값도 되돌려 쓰지 않는다.
- 건물 위치, 방향, 대략적 envelope와 주변 공간 맥락을 유지하도록 prompt에 명시한다.

## CV-04 Provider boundary
- 브라우저에는 `OPENAI_API_KEY`를 저장하지 않는다.
- 브라우저에는 `VITE_CONCEPT_VIEW_ENDPOINT`만 전달한다.
- provider service가 OpenAI API key를 서버에서 보관한다.
- endpoint 미설정 상태에서도 context/brief 준비 UI는 동작하고 이미지 생성 버튼은 비활성화된다.

## CV-05 Mobile
- 모바일에서는 기존 `부지 / 건물 / 분석 / 대안` 구조를 유지한다.
- `분석 → 컨셉 보기`에서 별도 bottom sheet로 열린다.
- 기존 지도/일조/조망 상태는 변경하지 않는다.

## Verification
```bash
npm ci
npm run typecheck
npm run build
node --check examples/concept-view-provider/server.mjs
git diff --check
```
