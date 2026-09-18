import { FormEvent, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createApplicationActions } from "./actions";
import { directSunStudy, planningMetrics } from "./analysis";
import { SunExposureLegend, SunExposureTimeline, ViewImpactBar } from "./analysis-visuals";
import { buildingPresets } from "./building-presets";
import type { BuildingPreset } from "./building-presets";
import { ConceptViewPanel } from "./concept-view-panel";
import {
  computeShadowPolygon,
  estimateGfa,
  footprintAreaM2,
  footprintPoints,
  geoPointToLocal,
  getScenario,
  initialState,
  reducer,
  rotatedFootprintPoints,
} from "./model";
import type { AddressSearchResult } from "./vworld-api";
import { getVWorldParcelAtPoint, searchVWorldAddress } from "./vworld-api";
import type { BuildingMass, Footprint, GeoPoint, LocalPoint } from "./types";
import { registerSpaceLabTools } from "./webmcp";
import {
  clearScenarioEntities,
  controlCamera,
  flyToSite,
  flyToViewpoint,
  frameSite,
  frameWorkspace,
  renderAnalysisMarkers,
  renderDraftFootprint,
  renderScenario,
  renderSite,
  sampleSceneSunContext,
  sampleViewImpact,
  setMapPointHandler,
  setShadowMode,
  setShadowTime,
  startVWorld,
} from "./vworld";
import "./styles.css";

const apiKey = import.meta.env.VITE_VWORLD_API_KEY as string | undefined;
const vworldDomain = import.meta.env.VITE_VWORLD_DOMAIN as string | undefined;
const conceptViewEndpoint = import.meta.env.VITE_CONCEPT_VIEW_ENDPOINT as string | undefined;

type CanvasMode = "inspect" | "pick-site" | "draw-polygon" | "move-mass" | "sun-point" | "viewpoint";

function Meter({ label, value, suffix = "" }: { label: string; value: string | number; suffix?: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}{suffix}</strong></div>;
}

type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
};

function Slider({ label, value, min, max, step = 1, suffix = "", onChange }: SliderProps) {
  return <label className="control">
    <div className="control-line"><span>{label}</span><span className="value-editor"><input aria-label={`${label} value`} type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />{suffix && <em>{suffix}</em>}</span></div>
    <input className="range-input" aria-label={`${label} slider`} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
  </label>;
}

function datePart(value: string) {
  return value.slice(0, 10);
}

function timePart(value: string) {
  return value.slice(11, 16);
}

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : 900;
}

function timeFromMinutes(value: number) {
  const minutes = Math.min(1_080, Math.max(540, value));
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function withDateAndTime(current: string, date: string, time: string) {
  return `${date || datePart(current)}T${time || timePart(current)}`;
}

function solarValue(value: number, suffix = "°") {
  return Number.isFinite(value) ? `${value.toFixed(1)}${suffix}` : "—";
}

function formatMinutesKo(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}분`;
  return rest ? `${hours}시간 ${rest}분` : `${hours}시간`;
}

function scenarioName(id: string, name: string) {
  return /^Option [A-Z]+$/.test(name) ? `대안 ${id}` : name;
}

function siteName(source: string, name: string) {
  return source === "demo" ? "부지를 선택하세요" : name;
}

function osmEmbedUrl(center: GeoPoint) {
  const lonSpan = 0.012;
  const latSpan = 0.008;
  const bbox = [
    center.lon - lonSpan,
    center.lat - latSpan,
    center.lon + lonSpan,
    center.lat + latSpan,
  ].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${center.lat}%2C${center.lon}`;
}

function clonePolygon(footprint: Footprint): Footprint {
  return footprint.kind === "polygon"
    ? { kind: "polygon", points: footprint.points.map((point) => ({ ...point })) }
    : { kind: "polygon", points: footprintPoints(footprint) };
}

function massLocalPoints(mass: BuildingMass) {
  return rotatedFootprintPoints(mass).map((point) => ({
    xM: point.xM + mass.position.eastM,
    yM: point.yM + mass.position.northM,
  }));
}

function svgPoints(points: LocalPoint[]) {
  return points.map(({ xM, yM }) => `${160 + xM * 1.15},${120 - yM * 1.15}`).join(" ");
}

function shadowBearing(shadow: ReturnType<typeof computeShadowPolygon>) {
  return shadow.solar.isDaylight ? Math.round((shadow.solar.azimuthDeg + 180) % 360) : "—";
}

function FootprintEditor({ footprint, onChange }: { footprint: Footprint; onChange: (next: Footprint) => void }) {
  const setRectangleDimension = (key: "widthM" | "depthM", value: number) => {
    const rectangle = footprint.kind === "rectangle"
      ? footprint
      : { kind: "rectangle" as const, widthM: 32, depthM: 24 };
    onChange({ ...rectangle, [key]: value });
  };

  const setPoint = (index: number, key: keyof LocalPoint, value: number) => {
    if (footprint.kind !== "polygon") return;
    onChange({
      kind: "polygon",
      points: footprint.points.map((point, pointIndex) => pointIndex === index ? { ...point, [key]: value } : point),
    });
  };

  const removePoint = (index: number) => {
    if (footprint.kind !== "polygon" || footprint.points.length <= 3) return;
    onChange({ kind: "polygon", points: footprint.points.filter((_, pointIndex) => pointIndex !== index) });
  };

  return <section className="inspector-section footprint-editor">
    <div className="section-heading"><span>평면 형상</span><b>{footprint.kind === "polygon" ? "자유형" : "사각형"}</b></div>
    <div className="segmented" role="group" aria-label="평면 형상 유형">
      <button className={footprint.kind === "rectangle" ? "selected" : ""} onClick={() => onChange(footprint.kind === "rectangle" ? footprint : { kind: "rectangle", widthM: 32, depthM: 24 })}>사각형</button>
      <button className={footprint.kind === "polygon" ? "selected" : ""} onClick={() => onChange(clonePolygon(footprint))}>자유형</button>
    </div>
    {footprint.kind === "rectangle" ? <div className="two-fields">
      <label><span>가로</span><input type="number" min={6} max={200} value={footprint.widthM} onChange={(event) => setRectangleDimension("widthM", Number(event.target.value))} /></label>
      <label><span>세로</span><input type="number" min={6} max={200} value={footprint.depthM} onChange={(event) => setRectangleDimension("depthM", Number(event.target.value))} /></label>
    </div> : <div className="polygon-editor">
      <div className="polygon-toolbar"><span>꼭짓점 {footprint.points.length}개 · 기준점 상대 좌표(m)</span></div>
      {footprint.points.map((point, index) => <div className="point-row" key={`point-${index}`}>
        <span>P{index + 1}</span>
        <input aria-label={`P${index + 1} east`} type="number" step="1" value={point.xM} onChange={(event) => setPoint(index, "xM", Number(event.target.value))} />
        <input aria-label={`P${index + 1} north`} type="number" step="1" value={point.yM} onChange={(event) => setPoint(index, "yM", Number(event.target.value))} />
        <button className="remove-point" aria-label={`P${index + 1} 삭제`} disabled={footprint.points.length <= 3} onClick={() => removePoint(index)}>×</button>
      </div>)}
    </div>}
  </section>;
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  const [vworldReady, setVworldReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [webMcp, setWebMcp] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<"design" | "compare">("design");
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [mobileToolPanel, setMobileToolPanel] = useState<"site" | "building" | "analysis" | "scenario" | null>(null);
  const [buildingCreateMode, setBuildingCreateMode] = useState<"preset" | "custom">("preset");
  const [desktopBuildingMenuOpen, setDesktopBuildingMenuOpen] = useState(false);
  const [conceptViewOpen, setConceptViewOpen] = useState(false);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("inspect");
  const [draftPoints, setDraftPoints] = useState<LocalPoint[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AddressSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [siteBusy, setSiteBusy] = useState(false);
  const [siteMessage, setSiteMessage] = useState<string | null>(null);
  const [sceneSunBusy, setSceneSunBusy] = useState(false);
  const [sceneSunContext, setSceneSunContext] = useState<{ supported: boolean; blockedTimes: string[]; source: string } | null>(null);
  const [viewImpactBusy, setViewImpactBusy] = useState(false);
  const [viewImpactResults, setViewImpactResults] = useState<Record<string, {
    supported: boolean;
    visibleRatioPct: number;
    visibleSamples: number;
    totalSamples: number;
    classification: string;
  }>>({});
  stateRef.current = state;

  const actions = useMemo(() => createApplicationActions((action) => {
    stateRef.current = reducer(stateRef.current, action);
    dispatch(action);
  }, () => stateRef.current), []);

  const active = state.activeScenarioId ? getScenario(state, state.activeScenarioId) : undefined;
  const compare = state.compareScenarioId ? getScenario(state, state.compareScenarioId) : undefined;
  const activeShadow = active
    ? computeShadowPolygon(active.mass, state.site.center, active.analysisTime, state.timeZoneOffsetMinutes)
    : undefined;
  const compareShadow = compare
    ? computeShadowPolygon(compare.mass, state.site.center, compare.analysisTime, state.timeZoneOffsetMinutes)
    : undefined;
  const activeDate = active ? datePart(active.analysisTime) : "2026-09-18";
  const activeTime = active ? timePart(active.analysisTime) : "15:00";
  const activeMinutes = minutesFromTime(activeTime);
  const sunStudyPoint = state.sunStudyPoint ?? state.site.center;
  const activeSunStudy = useMemo(() => active
    ? directSunStudy(active.mass, state.site, sunStudyPoint, activeDate, state.timeZoneOffsetMinutes)
    : undefined, [active, activeDate, state.site, state.timeZoneOffsetMinutes, sunStudyPoint]);
  const compareSunStudy = useMemo(() => compare
    ? directSunStudy(compare.mass, state.site, sunStudyPoint, activeDate, state.timeZoneOffsetMinutes)
    : undefined, [compare, activeDate, state.site, state.timeZoneOffsetMinutes, sunStudyPoint]);
  const activePlanning = useMemo(() => active ? planningMetrics(state.site, active.mass) : undefined, [active, state.site]);
  const sceneBlockedTimes = useMemo(() => new Set(sceneSunContext?.blockedTimes ?? []), [sceneSunContext]);
  const combinedDirectSunMinutes = (study: typeof activeSunStudy) => study
    ? study.samples.reduce((minutes, sample) => {
      if (sample.state !== "sun") return minutes;
      return minutes + (sceneBlockedTimes.has(sample.localDateTime) ? 0 : study.stepMinutes);
    }, 0)
    : 0;
  const activeContextSunMinutes = combinedDirectSunMinutes(activeSunStudy);
  const compareContextSunMinutes = combinedDirectSunMinutes(compareSunStudy);

  const searchLocation = useMemo(() => async (query: string) => {
    if (!apiKey) throw new Error("현재 미리보기에서는 VWorld 주소 검색을 사용할 수 없습니다.");
    return searchVWorldAddress(apiKey, query, vworldDomain);
  }, []);

  const selectSiteAtPoint = useMemo(() => async (point: GeoPoint, label?: string) => {
    if (!apiKey) throw new Error("현재 미리보기에서는 실제 지적 필지 선택을 사용할 수 없습니다.");
    return getVWorldParcelAtPoint(apiKey, point, vworldDomain, label);
  }, []);

  useEffect(() => {
    const registration = registerSpaceLabTools({
      ...actions,
      getState: () => stateRef.current,
      searchLocation,
      selectSiteAtPoint,
      sampleSunContext: (point, samples) => sampleSceneSunContext(point, samples),
      sampleViewImpact: (viewpoint, site, mass) => sampleViewImpact(viewpoint, site, mass),
    });
    setWebMcp(registration.supported);
    return registration.dispose;
  }, [actions, searchLocation, selectSiteAtPoint]);

  useEffect(() => {
    if (!apiKey) return undefined;
    let cancelled = false;
    startVWorld("vworld-map", apiKey, state.site.center.lon, state.site.center.lat)
      .then(() => { if (!cancelled) setVworldReady(true); })
      .catch((error) => { if (!cancelled) setMapError(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!vworldReady) return;
    clearScenarioEntities();
    renderSite(state.site);
    state.scenarios.forEach((scenario) => renderScenario(
      scenario,
      state.site,
      scenario.id === state.activeScenarioId,
      state.timeZoneOffsetMinutes,
    ));
    setShadowMode(true);
    if (active) setShadowTime(active.analysisTime, state.timeZoneOffsetMinutes);
  }, [active?.analysisTime, state.activeScenarioId, state.scenarios, state.site, state.timeZoneOffsetMinutes, vworldReady]);

  useEffect(() => {
    if (!vworldReady) return;
    frameSite(state.site);
  }, [state.site.id, vworldReady]);

  useEffect(() => {
    if (!vworldReady) return;
    renderDraftFootprint(state.site.center, draftPoints);
  }, [draftPoints, state.site.center, vworldReady]);

  useEffect(() => {
    if (!vworldReady) return;
    renderAnalysisMarkers(state.sunStudyPoint, state.viewpoint);
  }, [state.sunStudyPoint, state.viewpoint, vworldReady]);

  useEffect(() => {
    if (!vworldReady || !activeSunStudy) {
      setSceneSunContext(null);
      return;
    }
    let cancelled = false;
    setSceneSunBusy(true);
    void sampleSceneSunContext(sunStudyPoint, activeSunStudy.samples)
      .then((result) => {
        if (!cancelled) setSceneSunContext(result);
      })
      .catch(() => {
        if (!cancelled) setSceneSunContext({ supported: false, blockedTimes: [], source: "unsupported" });
      })
      .finally(() => {
        if (!cancelled) setSceneSunBusy(false);
      });
    return () => { cancelled = true; };
  }, [activeSunStudy, sunStudyPoint, vworldReady]);

  useEffect(() => {
    setViewImpactResults({});
  }, [state.viewpoint, state.site.id, active?.mass, compare?.mass]);

  useEffect(() => {
    if (!vworldReady || canvasMode === "inspect") return;
    const dispose = setMapPointHandler((point) => {
      if (canvasMode === "pick-site") {
        setSiteBusy(true);
        setSiteMessage("지적 필지를 불러오는 중…");
        void selectSiteAtPoint(point)
          .then((site) => {
            actions.setSite(site, "human");
            setDraftPoints([]);
            setCanvasMode("inspect");
            setSiteMessage(site.pnu ? `필지 선택 완료 · PNU ${site.pnu}` : "위치 선택 완료");
          })
          .catch((error) => setSiteMessage(error instanceof Error ? error.message : String(error)))
          .finally(() => setSiteBusy(false));
        return;
      }

      if (canvasMode === "move-mass" && active) {
        const local = geoPointToLocal(state.site.center, point);
        actions.editBuildingMass(active.id, { position: { eastM: local.xM, northM: local.yM } }, "human");
        setCanvasMode("inspect");
        return;
      }

      if (canvasMode === "sun-point" && active) {
        actions.setSunStudyPoint(point, "human");
        setCanvasMode("inspect");
        return;
      }

      if (canvasMode === "viewpoint") {
        const viewpoint = { point, eyeHeightM: state.viewpoint?.eyeHeightM ?? 1.7 };
        actions.setViewpoint(viewpoint, "human");
        if (vworldReady) flyToViewpoint(viewpoint, state.site, active?.mass);
        setCanvasMode("inspect");
        return;
      }

      if (canvasMode === "draw-polygon") {
        const local = geoPointToLocal(state.site.center, point);
        setDraftPoints((points) => [...points, local]);
      }
    });
    return dispose;
  }, [actions, active, canvasMode, selectSiteAtPoint, state.site, state.viewpoint, vworldReady]);

  async function runViewImpact() {
    if (!vworldReady || !state.viewpoint || !active) return;
    setViewImpactBusy(true);
    try {
      const scenarios = compare ? [active, compare] : [active];
      const entries = await Promise.all(scenarios.map(async (scenario) => {
        const result = await sampleViewImpact(state.viewpoint!, state.site, scenario.mass);
        return [scenario.id, result] as const;
      }));
      setViewImpactResults(Object.fromEntries(entries));
    } finally {
      setViewImpactBusy(false);
    }
  }

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSiteMessage(null);
    try {
      const results = await searchLocation(searchQuery);
      setSearchResults(results);
      if (!results.length) setSiteMessage("검색 결과가 없습니다.");
    } catch (error) {
      setSiteMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSearching(false);
    }
  }

  async function selectSearchResult(result: AddressSearchResult) {
    setSiteBusy(true);
    setSiteMessage("지적 필지를 불러오는 중…");
    try {
      const site = await selectSiteAtPoint(result.point, result.address);
      actions.setSite(site, "human");
      setSearchResults([]);
      setSearchQuery(result.address);
      setDraftPoints([]);
      setCanvasMode("inspect");
      setSiteMessage(site.pnu ? `필지 선택 완료 · PNU ${site.pnu}` : "위치 선택 완료");
    } catch (error) {
      setSiteMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSiteBusy(false);
    }
  }

  function createPreset(preset: BuildingPreset) {
    actions.createBuildingMass(preset.input, "human");
    setCanvasMode("inspect");
    setMobileToolPanel(null);
    setDesktopBuildingMenuOpen(false);
  }

  function createRectangle() {
    actions.createBuildingMass({
      name: "커스텀 건물",
      footprint: { kind: "rectangle", widthM: 32, depthM: 24 },
      heightM: 18,
      floors: 5,
      intent: "커스텀 사각형 매스",
    }, "human");
    setCanvasMode("inspect");
    setDesktopBuildingMenuOpen(false);
  }

  function startPolygon() {
    setDraftPoints([]);
    setCanvasMode("draw-polygon");
    setDesktopBuildingMenuOpen(false);
  }

  function frameCurrentWorkspace() {
    const scenarios = [active, compare].filter(Boolean) as typeof state.scenarios;
    frameWorkspace(state.site, scenarios, state.viewpoint);
  }

  function nudgeActiveMass(eastDeltaM: number, northDeltaM: number) {
    if (!active) return;
    actions.editBuildingMass(active.id, {
      position: {
        eastM: active.mass.position.eastM + eastDeltaM,
        northM: active.mass.position.northM + northDeltaM,
      },
    }, "human");
  }

  function finishPolygon() {
    if (draftPoints.length < 3) return;
    actions.createBuildingMass({
      footprint: { kind: "polygon", points: draftPoints },
      heightM: 18,
      floors: 5,
      intent: "지도에서 작성한 자유형 매스",
    }, "human");
    setDraftPoints([]);
    setCanvasMode("inspect");
  }

  function cancelCanvasTool() {
    setDraftPoints([]);
    setCanvasMode("inspect");
  }

  return <main className={`app-shell ${workspaceMode === "compare" ? "compare-mode" : ""}`}>
    <header className="topbar">
      <div className="brand"><div className="brand-copy"><strong>SpaceLab</strong><span>부지·일조·조망 검토</span></div></div>
      <button
        className="navigator-toggle"
        aria-label="대안 목록 열기"
        aria-expanded={navigatorOpen}
        onClick={() => {
          setNavigatorOpen((open) => !open);
          setInspectorOpen(false);
          setMobileToolPanel(null);
        }}
      >☰</button>
      <nav className="mode-switch" aria-label="작업 모드">
        <button className={workspaceMode === "design" ? "selected" : ""} onClick={() => setWorkspaceMode("design")}>설계</button>
        <button className={workspaceMode === "compare" ? "selected" : ""} onClick={() => setWorkspaceMode("compare")} disabled={!active || state.scenarios.length < 2}>비교</button>
      </nav>
      <div className="top-status">
        <span className={`runtime-status ${vworldReady ? "live" : mapError ? "attention" : ""}`}><i aria-hidden="true"></i>지도 <b>{vworldReady ? "3D 연결" : mapError ? "연결 오류" : "2D 미리보기"}</b></span>
        <span className={`runtime-status ${webMcp ? "live" : ""}`}><i aria-hidden="true"></i>AI 도구 <b>{webMcp ? "연결됨" : "선택"}</b></span>
      </div>
      <button
        className="inspector-toggle"
        aria-label="설정 열기"
        aria-expanded={inspectorOpen}
        onClick={() => {
          setInspectorOpen((open) => !open);
          setNavigatorOpen(false);
          setMobileToolPanel(null);
        }}
      >설정</button>
    </header>

    <section className="workspace">
      <button
        className={`mobile-scrim ${navigatorOpen || inspectorOpen || mobileToolPanel || conceptViewOpen ? "open" : ""}`}
        aria-label="패널 닫기"
        onClick={() => {
          setNavigatorOpen(false);
          setInspectorOpen(false);
          setMobileToolPanel(null);
          setDesktopBuildingMenuOpen(false);
          setConceptViewOpen(false);
        }}
      />
      <aside className={`left-panel panel ${navigatorOpen ? "open" : ""}`}>
        <div className="panel-heading"><div><div className="eyebrow">설계 대안</div><span className="panel-caption">변경 이력</span></div><span className="option-count">{state.scenarios.length}개</span></div>
        <div className="navigator-base site-summary"><strong>현재 부지</strong><span>{state.site.address || siteName(state.site.source, state.site.name)}</span>{state.site.pnu && <small>PNU {state.site.pnu}</small>}</div>
        <div className="scenario-navigator">
          {state.scenarios.length ? state.scenarios.map((scenario) => <button key={scenario.id} className={`scenario-row ${scenario.id === active?.id ? "active" : ""}`} data-scenario={scenario.id} onClick={() => { actions.selectScenario(scenario.id); setNavigatorOpen(false); }}>
            <span className="scenario-marker">{scenario.id}</span>
            <span className="scenario-copy"><strong>{scenarioName(scenario.id, scenario.name)}</strong><small>{scenario.mass.heightM}m · {scenario.mass.floors}층 <em>{scenario.createdBy === "agent" ? "✦" : "•"}</em></small></span>
            <span className="scenario-ancestry">{scenario.parentId ? `↳ ${scenario.parentId}` : "기준안"}</span>
          </button>) : <div className="navigator-empty">아직 설계 대안이 없습니다.<br />부지를 선택한 뒤 건물을 만들어보세요.</div>}
        </div>
        {active ? <button className="primary branch-button" onClick={() => actions.cloneScenario(active.id, undefined, "human")}>＋ 현재 안에서 새 대안 만들기</button> : <button className="primary branch-button" onClick={createRectangle}>＋ 첫 건물 만들기</button>}
      </aside>

      <section className={`canvas-wrap canvas-mode-${canvasMode}`}>
        <div id="vworld-map" className={`vworld-canvas ${vworldReady ? "ready" : ""}`}></div>
        {!vworldReady && <div className="fallback-world">
          <iframe
            className="fallback-map-frame"
            src={osmEmbedUrl(state.site.center)}
            title="OpenStreetMap 배경 지도"
            loading="eager"
            referrerPolicy="strict-origin-when-cross-origin"
          />
          <div className="fallback-map-shade"></div>
          {active && <svg className="analysis-overlay" viewBox="0 0 320 240" aria-label="그림자 분석 미리보기">
            {compareShadow && compareShadow.points.length >= 3 && <polygon className="fallback-shadow compare" points={svgPoints(compareShadow.points)} />}
            {activeShadow && activeShadow.points.length >= 3 && <polygon className="fallback-shadow active" points={svgPoints(activeShadow.points)} />}
            {compare && <polygon className="fallback-mass compare" points={svgPoints(massLocalPoints(compare.mass))} />}
            <polygon className="fallback-mass active" points={svgPoints(massLocalPoints(active.mass))} />
          </svg>}
          <div className="fallback-map-attribution">© OpenStreetMap contributors</div>
          <div className="fallback-note">{mapError ? "3D 지도 연결 오류 · 2D 배경지도로 표시 중" : apiKey ? "VWorld 3D 지도를 불러오는 중…" : "2D 배경지도 · VWorld 연결 시 3D 전환"}</div>
        </div>}

        <div className="site-toolbar">
          <form className="site-search" onSubmit={handleSearch}>
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={apiKey ? "주소나 지번을 검색하세요" : "VWorld 연결 후 주소 검색 가능"} aria-label="주소 검색" />
            <button type="submit" disabled={searching || !apiKey}>{searching ? "…" : "검색"}</button>
          </form>
          {searchResults.length > 0 && <div className="search-results">
            {searchResults.map((result) => <button key={result.id} onClick={() => void selectSearchResult(result)}><strong>{result.title}</strong><span>{result.address}</span></button>)}
          </div>}
        </div>

        <div className="model-toolbar" aria-label="건물 배치 도구">
          <button className={canvasMode === "pick-site" ? "selected" : ""} onClick={() => setCanvasMode("pick-site")}>필지 선택</button>
          <button className={desktopBuildingMenuOpen ? "selected" : ""} onClick={() => setDesktopBuildingMenuOpen((open) => !open)}>건물 추가</button>
          <button className={canvasMode === "move-mass" ? "selected" : ""} onClick={() => active && setCanvasMode("move-mass")} disabled={!active}>이동</button>
          <button className={canvasMode === "sun-point" ? "selected" : ""} onClick={() => active && setCanvasMode("sun-point")} disabled={!active}>일조</button>
          <button className={canvasMode === "viewpoint" ? "selected" : ""} onClick={() => setCanvasMode("viewpoint")}>조망</button>
          <button onClick={() => active && actions.deleteScenario(active.id, "human")} disabled={!active}>삭제</button>
        </div>

        {desktopBuildingMenuOpen && <div className="building-create-popover">
          <div className="create-mode-switch" role="group" aria-label="건물 생성 방식">
            <button className={buildingCreateMode === "preset" ? "selected" : ""} onClick={() => setBuildingCreateMode("preset")}>프리셋</button>
            <button className={buildingCreateMode === "custom" ? "selected" : ""} onClick={() => setBuildingCreateMode("custom")}>커스텀</button>
          </div>
          {buildingCreateMode === "preset" ? <div className="preset-grid desktop-presets">
            {buildingPresets.map((preset) => <button key={preset.id} className="preset-card" onClick={() => createPreset(preset)}>
              <span className={`preset-silhouette ${preset.silhouette}`} aria-hidden="true"><i></i></span>
              <span className="preset-copy"><strong>{preset.label}</strong><small>{preset.floorsLabel}</small></span>
            </button>)}
          </div> : <div className="custom-create-grid">
            <button onClick={createRectangle}><strong>사각형</strong><span>가로·세로를 직접 조절</span></button>
            <button onClick={startPolygon}><strong>자유형</strong><span>지도에서 외곽점을 직접 지정</span></button>
          </div>}
        </div>}

        <div className="map-utility-toolbar" aria-label="지도 조작">
          <button onClick={() => controlCamera("rotate-left")} disabled={!vworldReady}>좌회전</button>
          <button onClick={() => controlCamera("rotate-right")} disabled={!vworldReady}>우회전</button>
          <button onClick={() => controlCamera("zoom-out")} disabled={!vworldReady}>축소</button>
          <button onClick={() => controlCamera("zoom-in")} disabled={!vworldReady}>확대</button>
          <button onClick={() => frameSite(state.site)} disabled={!vworldReady}>선택 부지</button>
          <button onClick={frameCurrentWorkspace} disabled={!vworldReady}>전체 보기</button>
          <button className="concept-entry" onClick={() => active && setConceptViewOpen(true)} disabled={!active}>컨셉 보기</button>
        </div>

        {canvasMode !== "inspect" && <div className="canvas-tool-hint">
          {canvasMode === "pick-site" && "지도에서 검토할 필지를 선택하세요."}
          {canvasMode === "move-mass" && "건물을 옮길 위치를 지도에서 선택하세요."}
          {canvasMode === "draw-polygon" && <>{draftPoints.length < 3 ? `건물 외곽점을 찍어주세요 · ${draftPoints.length}개` : `꼭짓점 ${draftPoints.length}개 · 완료할 수 있습니다`} <button onClick={finishPolygon} disabled={draftPoints.length < 3}>완료</button></>}
          {canvasMode === "sun-point" && "일조 시간을 확인할 지점을 선택하세요."}
          {canvasMode === "viewpoint" && "건물을 바라볼 위치를 선택하세요."}
          <button onClick={cancelCanvasTool}>취소</button>
        </div>}

        {siteMessage && <div className={`site-message ${siteBusy ? "busy" : ""}`}>{siteMessage}</div>}
        {mapError && <div className="error-banner">{mapError}</div>}
        <div className="canvas-title"><span>{state.site.source === "vworld-cadastral" ? "실제 필지" : "부지 미리보기"}</span><strong>{active ? `${active.id} · ${scenarioName(active.id, active.name)}` : siteName(state.site.source, state.site.name)}</strong></div>
        {active && <div className="canvas-legend"><span><i className="legend-dot active-dot"></i>{active.id} 현재안</span>{compare && <span><i className="legend-dot compare-dot"></i>{compare.id} 비교안</span>}</div>}

        <section className="analysis-dock" aria-label="일조와 그림자 분석">
          {active && activeShadow ? <>
            <div className="analysis-topline">
              <div className="analysis-title"><div className="eyebrow">일조 · 그림자</div><strong>{activeTime} KST</strong><span>태양고도 {solarValue(activeShadow.solar.elevationDeg)} · 방위각 {solarValue(activeShadow.solar.azimuthDeg)} · 그림자 {activeShadow.solar.isDaylight ? `${activeShadow.lengthM.toFixed(1)}m` : "—"} · 일조 {activeSunStudy ? formatMinutesKo(sceneSunContext?.supported ? activeContextSunMinutes : activeSunStudy.sunMinutes) : "—"}</span></div>
              <div className="analysis-fields"><label>날짜<input aria-label="그림자 날짜" type="date" value={activeDate} onChange={(event) => actions.setShadowTime(active.id, withDateAndTime(active.analysisTime, event.target.value, activeTime))} /></label><label>시간<input aria-label="그림자 시간" type="time" value={activeTime} onChange={(event) => actions.setShadowTime(active.id, withDateAndTime(active.analysisTime, activeDate, event.target.value))} /></label></div>
            </div>
            <div className="timeline"><span>09:00</span><input aria-label="그림자 시간대" type="range" min={540} max={1080} step={15} value={Math.min(1080, Math.max(540, activeMinutes))} onChange={(event) => actions.setShadowTime(active.id, withDateAndTime(active.analysisTime, activeDate, timeFromMinutes(Number(event.target.value))))} /><span>18:00</span></div>
            {activeSunStudy && <div className="sun-viz-block">
              <SunExposureTimeline
                label={workspaceMode === "compare" ? `${active.id} · ${scenarioName(active.id, active.name)}` : "시간대별 일조"}
                samples={activeSunStudy.samples}
                cityBlockedTimes={sceneBlockedTimes}
                activeLocalDateTime={active.analysisTime}
                onSelect={(localDateTime) => actions.setShadowTime(active.id, localDateTime)}
              />
              {workspaceMode === "compare" && compare && compareSunStudy && <SunExposureTimeline
                label={`${compare.id} · ${scenarioName(compare.id, compare.name)}`}
                samples={compareSunStudy.samples}
                cityBlockedTimes={sceneBlockedTimes}
                activeLocalDateTime={active.analysisTime}
              />}
              <SunExposureLegend />
            </div>}
            {workspaceMode === "compare" && <div className="compare-drawer">
              <div className="compare-drawer-head"><div><div className="eyebrow">대안 비교</div><strong>주요 차이</strong></div><select aria-label="비교할 대안" value={state.compareScenarioId ?? ""} onChange={(event) => actions.compareScenarios(active.id, event.target.value || undefined)}><option value="">비교 안 함</option>{state.scenarios.filter((scenario) => scenario.id !== active.id).map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.id} · {scenario.name}</option>)}</select></div>
              {compare && compareShadow ? <div className="compare-grid"><Meter label="높이 A / B" value={`${active.mass.heightM} / ${compare.mass.heightM}`} suffix="m" /><Meter label="연면적 차이" value={(estimateGfa(active.mass) - estimateGfa(compare.mass)).toLocaleString()} suffix="㎡" /><Meter label="그림자 차이" value={(activeShadow.lengthM - compareShadow.lengthM).toFixed(1)} suffix="m" /><Meter label="일조 A / B" value={activeSunStudy && compareSunStudy ? `${formatMinutesKo(sceneSunContext?.supported ? activeContextSunMinutes : activeSunStudy.sunMinutes)} / ${formatMinutesKo(sceneSunContext?.supported ? compareContextSunMinutes : compareSunStudy.sunMinutes)}` : "—"} /><Meter label="가시율 A / B" value={viewImpactResults[active.id] && viewImpactResults[compare.id] ? `${viewImpactResults[active.id].visibleRatioPct.toFixed(0)} / ${viewImpactResults[compare.id].visibleRatioPct.toFixed(0)}` : "—"} suffix={viewImpactResults[active.id] && viewImpactResults[compare.id] ? "%" : ""} /></div> : <p className="muted">비교할 다른 대안을 선택하세요.</p>}
            </div>}
          </> : <div className="analysis-empty"><strong>먼저 부지를 선택해보세요.</strong><span>주소 검색 → 필지 선택 → 건물 배치 → 일조·조망 비교</span></div>}
        </section>
      </section>


      <section className={`mobile-tool-sheet ${mobileToolPanel ? "open" : ""}`} aria-label="모바일 작업 메뉴">
        <div className="mobile-tool-sheet-handle" aria-hidden="true"></div>
        {mobileToolPanel === "site" && <div className="mobile-tool-content">
          <div className="mobile-tool-head"><div><span>부지</span><strong>검토할 위치를 정하세요</strong></div><button onClick={() => setMobileToolPanel(null)} aria-label="닫기">×</button></div>
          <div className={`selected-site-card ${state.site.source === "vworld-cadastral" ? "selected" : ""}`}>
            <span>{state.site.source === "vworld-cadastral" ? "선택 필지" : "현재 위치"}</span>
            <strong>{state.site.address || siteName(state.site.source, state.site.name)}</strong>
            <small>{state.site.pnu ? `PNU ${state.site.pnu}` : state.site.source === "vworld-cadastral" ? "지적 필지 선택됨" : "실제 필지를 선택해주세요"}</small>
          </div>
          <form className="mobile-site-search" onSubmit={handleSearch}>
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={apiKey ? "주소나 지번 검색" : "VWorld 연결 필요"} aria-label="주소 검색" />
            <button type="submit" disabled={searching || !apiKey}>{searching ? "…" : "검색"}</button>
          </form>
          {searchResults.length > 0 && <div className="mobile-search-results">
            {searchResults.map((result) => <button key={result.id} onClick={() => { void selectSearchResult(result); setMobileToolPanel(null); }}><strong>{result.title}</strong><span>{result.address}</span></button>)}
          </div>}
          <button className="mobile-action primary-action" onClick={() => { setCanvasMode("pick-site"); setMobileToolPanel(null); }}>지도에서 필지 선택</button>
          <div className="mobile-reframe-actions">
            <button disabled={!vworldReady} onClick={() => { frameSite(state.site); setMobileToolPanel(null); }}>선택 부지로 복귀</button>
            <button disabled={!vworldReady} onClick={() => { frameCurrentWorkspace(); setMobileToolPanel(null); }}>전체 보기</button>
          </div>
          <div className="mobile-map-control-panel">
            <div className="mobile-map-control-head"><span>지도 조작</span><small>회전 · 이동 · 확대</small></div>
            <div className="mobile-map-control-grid">
              <button disabled={!vworldReady} onClick={() => controlCamera("rotate-left")}>좌회전</button>
              <button disabled={!vworldReady} onClick={() => controlCamera("pan-up")}>위로</button>
              <button disabled={!vworldReady} onClick={() => controlCamera("rotate-right")}>우회전</button>
              <button disabled={!vworldReady} onClick={() => controlCamera("pan-left")}>왼쪽</button>
              <button disabled={!vworldReady} onClick={() => frameSite(state.site)}>부지</button>
              <button disabled={!vworldReady} onClick={() => controlCamera("pan-right")}>오른쪽</button>
              <button disabled={!vworldReady} onClick={() => controlCamera("zoom-out")}>축소</button>
              <button disabled={!vworldReady} onClick={() => controlCamera("pan-down")}>아래로</button>
              <button disabled={!vworldReady} onClick={() => controlCamera("zoom-in")}>확대</button>
            </div>
          </div>
        </div>}

        {mobileToolPanel === "building" && <div className="mobile-tool-content">
          <div className="mobile-tool-head"><div><span>건물</span><strong>{active ? `${active.id}안 편집 · 새 건물 추가` : "건물을 만들어보세요"}</strong></div><button onClick={() => setMobileToolPanel(null)} aria-label="닫기">×</button></div>
          <div className="create-mode-switch" role="group" aria-label="건물 생성 방식">
            <button className={buildingCreateMode === "preset" ? "selected" : ""} onClick={() => setBuildingCreateMode("preset")}>프리셋</button>
            <button className={buildingCreateMode === "custom" ? "selected" : ""} onClick={() => setBuildingCreateMode("custom")}>커스텀</button>
          </div>
          {buildingCreateMode === "preset" ? <div className="preset-grid">
            {buildingPresets.map((preset) => <button key={preset.id} className="preset-card" onClick={() => createPreset(preset)}>
              <span className={`preset-silhouette ${preset.silhouette}`} aria-hidden="true"><i></i></span>
              <span className="preset-copy"><strong>{preset.label}</strong><small>{preset.floorsLabel}</small><em>{preset.description}</em></span>
            </button>)}
          </div> : <div className="custom-create-grid">
            <button onClick={() => { createRectangle(); setMobileToolPanel(null); }}><strong>사각형</strong><span>기본 매스를 만든 뒤 폭·깊이·높이를 직접 조절</span></button>
            <button onClick={() => { startPolygon(); setMobileToolPanel(null); }}><strong>자유형</strong><span>지도에서 원하는 건물 외곽점을 직접 지정</span></button>
          </div>}
          {active && <>
            <div className="mobile-edit-row">
              <button onClick={() => { setCanvasMode("move-mass"); setMobileToolPanel(null); }}>지도에서 이동</button>
              <button onClick={() => { setInspectorOpen(true); setMobileToolPanel(null); }}>상세 설정</button>
              <button className="danger" onClick={() => { actions.deleteScenario(active.id, "human"); setMobileToolPanel(null); }}>삭제</button>
            </div>
            <div className="mass-nudge-panel">
              <div className="mass-nudge-head"><span>배치 미세조정</span><small>1m 단위</small></div>
              <div className="mass-nudge-grid">
                <span></span>
                <button onClick={() => nudgeActiveMass(0, 1)}>북 +1m</button>
                <span></span>
                <button onClick={() => nudgeActiveMass(-1, 0)}>서 −1m</button>
                <div className="mass-offset-readout">
                  <strong>{active.mass.position.eastM.toFixed(0)}, {active.mass.position.northM.toFixed(0)}</strong>
                  <small>동 / 북 m</small>
                </div>
                <button onClick={() => nudgeActiveMass(1, 0)}>동 +1m</button>
                <span></span>
                <button onClick={() => nudgeActiveMass(0, -1)}>남 −1m</button>
                <span></span>
              </div>
            </div>
          </>}
        </div>}

        {mobileToolPanel === "analysis" && <div className="mobile-tool-content">
          <div className="mobile-tool-head"><div><span>분석</span><strong>일조와 조망을 확인하세요</strong></div><button onClick={() => setMobileToolPanel(null)} aria-label="닫기">×</button></div>
          <div className="mobile-analysis-actions">
            <button className="mobile-analysis-card" disabled={!active} onClick={() => { if (active) setCanvasMode("sun-point"); setMobileToolPanel(null); }}>
              <span className="mobile-analysis-icon">☀</span>
              <span><strong>일조 분석</strong><small>{activeSunStudy ? `현재 ${formatMinutesKo(sceneSunContext?.supported ? activeContextSunMinutes : activeSunStudy.sunMinutes)}` : "분석 지점을 선택하세요"}</small></span>
            </button>
            <button className="mobile-analysis-card" onClick={() => { setCanvasMode("viewpoint"); setMobileToolPanel(null); }}>
              <span className="mobile-analysis-icon">◉</span>
              <span><strong>조망 위치 선택</strong><small>{state.viewpoint ? `눈높이 ${state.viewpoint.eyeHeightM.toFixed(1)}m 설정됨` : "지도에서 관찰 위치를 찍으세요"}</small></span>
            </button>
            <button className="mobile-analysis-card concept-card" disabled={!active} onClick={() => { if (active) setConceptViewOpen(true); setMobileToolPanel(null); }}>
              <span className="mobile-analysis-icon concept">▧</span>
              <span><strong>컨셉 보기</strong><small>현재 배치와 3D 화면으로 건축 컨셉 이미지 준비</small></span>
            </button>
          </div>
          {state.viewpoint && active && <div className="mobile-viewpoint-summary">
            <div>
              <span>현재 조망점</span>
              <strong>{viewImpactResults[active.id] ? `예상 가시율 ${viewImpactResults[active.id].visibleRatioPct.toFixed(0)}%` : "분석 전"}</strong>
            </div>
            <div className="mobile-inline-actions">
              <button onClick={() => flyToViewpoint(state.viewpoint!, state.site, active.mass)}>이 위치에서 보기</button>
              <button className="accent" disabled={viewImpactBusy} onClick={() => void runViewImpact()}>{viewImpactBusy ? "분석 중…" : "조망 분석"}</button>
            </div>
          </div>}
        </div>}

        {mobileToolPanel === "scenario" && <div className="mobile-tool-content">
          <div className="mobile-tool-head"><div><span>대안</span><strong>{state.scenarios.length ? `${state.scenarios.length}개 대안` : "대안이 없습니다"}</strong></div><button onClick={() => setMobileToolPanel(null)} aria-label="닫기">×</button></div>
          <div className="mobile-scenario-summary">
            {active ? <><span className="mobile-scenario-id">{active.id}</span><div><strong>{scenarioName(active.id, active.name)}</strong><small>{active.mass.heightM}m · {active.mass.floors}층</small></div></> : <span>먼저 건물을 만들어보세요.</span>}
          </div>
          <div className="mobile-action-list">
            <button onClick={() => { setNavigatorOpen(true); setMobileToolPanel(null); }}>대안 목록 보기 <span>›</span></button>
            <button disabled={!active} onClick={() => { if (active) actions.cloneScenario(active.id, undefined, "human"); setMobileToolPanel(null); }}>현재 안에서 새 대안 만들기 <span>＋</span></button>
            <button disabled={!active || state.scenarios.length < 2} onClick={() => { setWorkspaceMode("compare"); setMobileToolPanel(null); }}>A/B 비교 열기 <span>↔</span></button>
          </div>
        </div>}
      </section>

      {conceptViewOpen && active && <ConceptViewPanel
        site={state.site}
        scenario={active}
        viewpoint={state.viewpoint}
        endpoint={conceptViewEndpoint}
        onClose={() => setConceptViewOpen(false)}
      />}

      <nav className="mobile-workbar" aria-label="주요 작업">
        <button className={mobileToolPanel === "site" ? "active" : ""} onClick={() => { setMobileToolPanel(mobileToolPanel === "site" ? null : "site"); setNavigatorOpen(false); setInspectorOpen(false); }}><span>⌖</span><b>부지</b></button>
        <button className={mobileToolPanel === "building" ? "active" : ""} onClick={() => { setMobileToolPanel(mobileToolPanel === "building" ? null : "building"); setNavigatorOpen(false); setInspectorOpen(false); }}><span>▱</span><b>건물</b></button>
        <button className={mobileToolPanel === "analysis" ? "active" : ""} onClick={() => { setMobileToolPanel(mobileToolPanel === "analysis" ? null : "analysis"); setNavigatorOpen(false); setInspectorOpen(false); }}><span>◎</span><b>분석</b></button>
        <button className={mobileToolPanel === "scenario" ? "active" : ""} onClick={() => { setMobileToolPanel(mobileToolPanel === "scenario" ? null : "scenario"); setNavigatorOpen(false); setInspectorOpen(false); }}><span>◇</span><b>대안</b></button>
      </nav>

      <aside className={`right-panel panel ${inspectorOpen ? "open" : ""}`}>
        {active && activeShadow ? <>
          <div className="inspector-heading"><span className="inspector-scenario" data-scenario={active.id}>{active.id}</span><div><div className="eyebrow">설계 설정</div><h2>{active.name}</h2></div></div>
          <section className="inspector-section"><div className="section-heading"><span>건물 규모</span><b>{active.mass.footprint.kind === "polygon" ? "자유형" : "사각형"}</b></div>
            <Slider label="높이" value={active.mass.heightM} min={3} max={80} suffix="m" onChange={(heightM) => actions.editBuildingMass(active.id, { heightM })} />
            <Slider label="회전" value={active.mass.rotationDeg} min={-180} max={180} suffix="°" onChange={(rotationDeg) => actions.editBuildingMass(active.id, { rotationDeg })} />
            <label className="control"><div className="control-line"><span>층수</span><span className="value-editor"><input aria-label="층수" type="number" min={1} max={40} value={active.mass.floors} onChange={(event) => actions.editBuildingMass(active.id, { floors: Number(event.target.value) })} /></span></div></label>
          </section>
          <section className="inspector-section"><div className="section-heading"><span>배치 위치</span><b>기준점 상대(m)</b></div>
            <Slider label="동쪽" value={active.mass.position.eastM} min={-120} max={120} suffix="m" onChange={(eastM) => actions.editBuildingMass(active.id, { position: { eastM } })} />
            <Slider label="북쪽" value={active.mass.position.northM} min={-120} max={120} suffix="m" onChange={(northM) => actions.editBuildingMass(active.id, { position: { northM } })} />
          </section>
          <FootprintEditor footprint={active.mass.footprint} onChange={(footprint) => actions.setMassFootprint(active.id, footprint)} />
          <section className="inspector-section"><div className="section-heading"><span>그림자</span><b>{activeTime}</b></div><div className="readout-list"><div><span>태양고도</span><strong>{solarValue(activeShadow.solar.elevationDeg)}</strong></div><div><span>방위각</span><strong>{solarValue(activeShadow.solar.azimuthDeg)}</strong></div><div><span>그림자 길이</span><strong>{activeShadow.solar.isDaylight ? `${activeShadow.lengthM.toFixed(1)}m` : "—"}</strong></div><div><span>그림자 방향</span><strong>{shadowBearing(activeShadow)}{activeShadow.solar.isDaylight ? "°" : ""}</strong></div></div></section>
          <section className="inspector-section"><div className="section-heading"><span>계획 수치</span><b>현재 대안</b></div><div className="readout-list"><div><span>대지면적</span><strong>{activePlanning ? Math.round(activePlanning.siteAreaM2).toLocaleString() : "—"}㎡</strong></div><div><span>건축면적</span><strong>{Math.round(footprintAreaM2(active.mass.footprint)).toLocaleString()}㎡</strong></div><div><span>추정 연면적</span><strong>{estimateGfa(active.mass).toLocaleString()}㎡</strong></div><div><span>계획 건폐율</span><strong>{activePlanning ? activePlanning.coverageRatioPct.toFixed(1) : "—"}%</strong></div><div><span>계획 용적률</span><strong>{activePlanning ? activePlanning.floorAreaRatioPct.toFixed(1) : "—"}%</strong></div></div></section>
          <section className="inspector-section"><div className="section-heading"><span>일조시간</span><b>09:00–18:00</b></div><div className="readout-list"><div><span>분석 지점</span><strong>{state.sunStudyPoint ? "사용자 지정" : "부지 중심"}</strong></div><div><span>직접 일조</span><strong>{activeSunStudy ? formatMinutesKo(sceneSunContext?.supported ? activeContextSunMinutes : activeSunStudy.sunMinutes) : "—"}</strong></div><div><span>계획 건물 음영</span><strong>{activeSunStudy ? formatMinutesKo(activeSunStudy.shadowMinutes) : "—"}</strong></div><div><span>주변 환경</span><strong>{sceneSunBusy ? "계산 중…" : sceneSunContext?.supported ? "VWorld 3D 반영" : "계획 건물만"}</strong></div></div><button className="quiet-button analysis-action" onClick={() => setCanvasMode("sun-point")}>일조 지점 선택</button>{state.sunStudyPoint && <button className="quiet-button analysis-action" onClick={() => actions.setSunStudyPoint(undefined, "human")}>부지 중심 사용</button>}</section>
          <section className="inspector-section"><div className="section-heading"><span>조망 위치</span><b>{state.viewpoint ? `눈높이 ${state.viewpoint.eyeHeightM.toFixed(1)}m` : "미설정"}</b></div>{state.viewpoint ? <><label className="control"><div className="control-line"><span>눈높이</span><span className="value-editor"><input aria-label="조망 눈높이" type="number" min={1.2} max={50} step={0.1} value={state.viewpoint.eyeHeightM} onChange={(event) => actions.setViewpoint({ ...state.viewpoint!, eyeHeightM: Number(event.target.value) }, "human")} /><em>m</em></span></div></label>{viewImpactResults[active.id] && <>
            <ViewImpactBar
              visibleRatioPct={viewImpactResults[active.id].visibleRatioPct}
              classification={viewImpactResults[active.id].classification}
              label={`${active.id}안 예상 가시율`}
            />
            <div className="readout-list"><div><span>가시 샘플</span><strong>{viewImpactResults[active.id].visibleSamples} / {viewImpactResults[active.id].totalSamples}</strong></div></div>
            {compare && viewImpactResults[compare.id] && <ViewImpactBar
              visibleRatioPct={viewImpactResults[compare.id].visibleRatioPct}
              classification={viewImpactResults[compare.id].classification}
              label={`${compare.id}안 예상 가시율`}
            />}
          </>}<div className="viewpoint-actions"><button className="quiet-button" onClick={() => flyToViewpoint(state.viewpoint!, state.site, active.mass)}>이 위치에서 보기</button><button className="quiet-button" disabled={viewImpactBusy} onClick={() => void runViewImpact()}>{viewImpactBusy ? "분석 중…" : "조망 분석"}</button><button className="quiet-button" onClick={() => { actions.setViewpoint(undefined, "human"); flyToSite(state.site); }}>해제</button></div></> : <button className="quiet-button analysis-action" onClick={() => setCanvasMode("viewpoint")}>조망 위치 선택</button>}</section>
          <small className="boundary">*일조·그림자 결과는 초기 공간 검토용입니다. 법적 일조권 판정이나 인허가 판단을 대신하지 않습니다.</small>
        </> : <div className="inspector-empty"><div className="eyebrow">설계 설정</div><h2>선택된 건물이 없습니다</h2><p>프리셋 또는 커스텀 방식으로 첫 건물을 만들어보세요.</p></div>}
      </aside>
    </section>
  </main>;
}
