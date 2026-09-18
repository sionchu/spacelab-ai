import { FormEvent, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createApplicationActions } from "./actions";
import { directSunStudy, formatMinutes, planningMetrics } from "./analysis";
import { SunExposureLegend, SunExposureTimeline, ViewImpactBar } from "./analysis-visuals";
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
  flyToSite,
  flyToViewpoint,
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
    <div className="section-heading"><span>FOOTPRINT</span><b>{footprint.kind === "polygon" ? "FREE POLYGON" : "RECTANGLE"}</b></div>
    <div className="segmented" role="group" aria-label="Footprint type">
      <button className={footprint.kind === "rectangle" ? "selected" : ""} onClick={() => onChange(footprint.kind === "rectangle" ? footprint : { kind: "rectangle", widthM: 32, depthM: 24 })}>Rectangle</button>
      <button className={footprint.kind === "polygon" ? "selected" : ""} onClick={() => onChange(clonePolygon(footprint))}>Free polygon</button>
    </div>
    {footprint.kind === "rectangle" ? <div className="two-fields">
      <label><span>Width</span><input type="number" min={6} max={200} value={footprint.widthM} onChange={(event) => setRectangleDimension("widthM", Number(event.target.value))} /></label>
      <label><span>Depth</span><input type="number" min={6} max={200} value={footprint.depthM} onChange={(event) => setRectangleDimension("depthM", Number(event.target.value))} /></label>
    </div> : <div className="polygon-editor">
      <div className="polygon-toolbar"><span>{footprint.points.length} vertices · local meters</span></div>
      {footprint.points.map((point, index) => <div className="point-row" key={`point-${index}`}>
        <span>P{index + 1}</span>
        <input aria-label={`P${index + 1} east`} type="number" step="1" value={point.xM} onChange={(event) => setPoint(index, "xM", Number(event.target.value))} />
        <input aria-label={`P${index + 1} north`} type="number" step="1" value={point.yM} onChange={(event) => setPoint(index, "yM", Number(event.target.value))} />
        <button className="remove-point" aria-label={`Remove P${index + 1}`} disabled={footprint.points.length <= 3} onClick={() => removePoint(index)}>×</button>
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
  const [viewImpactResults, setViewImpactResults] = useState<Record<string, { supported: boolean; visibleRatioPct: number; visibleSamples: number; totalSamples: number; classification: string }>>({});
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
    if (!apiKey) throw new Error("VWorld API key is required for address search.");
    return searchVWorldAddress(apiKey, query, vworldDomain);
  }, []);

  const selectSiteAtPoint = useMemo(() => async (point: GeoPoint, label?: string) => {
    if (!apiKey) throw new Error("VWorld API key is required for parcel selection.");
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
    flyToSite(state.site);
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
        setSiteMessage("Resolving cadastral parcel…");
        void selectSiteAtPoint(point)
          .then((site) => {
            actions.setSite(site, "human");
            setDraftPoints([]);
            setCanvasMode("inspect");
            setSiteMessage(site.pnu ? `Selected parcel ${site.pnu}` : "Selected map site");
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
      if (!results.length) setSiteMessage("No VWorld address results.");
    } catch (error) {
      setSiteMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSearching(false);
    }
  }

  async function selectSearchResult(result: AddressSearchResult) {
    setSiteBusy(true);
    setSiteMessage("Resolving cadastral parcel…");
    try {
      const site = await selectSiteAtPoint(result.point, result.address);
      actions.setSite(site, "human");
      setSearchResults([]);
      setSearchQuery(result.address);
      setDraftPoints([]);
      setCanvasMode("inspect");
      setSiteMessage(site.pnu ? `Selected parcel ${site.pnu}` : "Selected map site");
    } catch (error) {
      setSiteMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSiteBusy(false);
    }
  }

  function createRectangle() {
    actions.createBuildingMass({
      footprint: { kind: "rectangle", widthM: 32, depthM: 24 },
      heightM: 18,
      floors: 5,
      intent: "New rectangular mass",
    }, "human");
    setCanvasMode("inspect");
  }

  function startPolygon() {
    setDraftPoints([]);
    setCanvasMode("draw-polygon");
  }

  function finishPolygon() {
    if (draftPoints.length < 3) return;
    actions.createBuildingMass({
      footprint: { kind: "polygon", points: draftPoints },
      heightM: 18,
      floors: 5,
      intent: "Canvas-drawn polygon mass",
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
      <div className="brand"><div className="brand-mark" aria-hidden="true">S</div><div><strong>SpaceLab</strong><span>/ {state.site.name}</span></div></div>
      <button className="navigator-toggle" aria-label="Open scenario navigator" aria-expanded={navigatorOpen} onClick={() => setNavigatorOpen((open) => !open)}>SCENARIOS</button>
      <nav className="mode-switch" aria-label="Workspace mode">
        <button className={workspaceMode === "design" ? "selected" : ""} onClick={() => setWorkspaceMode("design")}>Design</button>
        <button className={workspaceMode === "compare" ? "selected" : ""} onClick={() => setWorkspaceMode("compare")} disabled={!active || state.scenarios.length < 2}>Compare</button>
      </nav>
      <div className="top-status">
        <span className={`runtime-status ${vworldReady ? "live" : mapError ? "attention" : ""}`}><i aria-hidden="true"></i>VWorld <b>{vworldReady ? "Live" : mapError ? "Error" : "Demo"}</b></span>
        <span className={`runtime-status ${webMcp ? "live" : ""}`}><i aria-hidden="true"></i>Site Tools <b>{webMcp ? "Connected" : "Optional"}</b></span>
      </div>
    </header>

    <section className="workspace">
      <aside className={`left-panel panel ${navigatorOpen ? "open" : ""}`}>
        <div className="panel-heading"><div><div className="eyebrow">SCENARIOS</div><span className="panel-caption">DESIGN HISTORY</span></div><span className="option-count">{state.scenarios.length} OPTIONS</span></div>
        <div className="navigator-base site-summary"><strong>REAL SITE</strong><span>{state.site.address || state.site.name}</span>{state.site.pnu && <small>PNU {state.site.pnu}</small>}</div>
        <div className="scenario-navigator">
          {state.scenarios.length ? state.scenarios.map((scenario) => <button key={scenario.id} className={`scenario-row ${scenario.id === active?.id ? "active" : ""}`} data-scenario={scenario.id} onClick={() => { actions.selectScenario(scenario.id); setNavigatorOpen(false); }}>
            <span className="scenario-marker">{scenario.id}</span>
            <span className="scenario-copy"><strong>{scenario.name}</strong><small>{scenario.mass.heightM}m · {scenario.mass.floors} floors <em>{scenario.createdBy === "agent" ? "✦" : "•"}</em></small></span>
            <span className="scenario-ancestry">{scenario.parentId ? `↳ ${scenario.parentId}` : "BASE"}</span>
          </button>) : <div className="navigator-empty">No massing options yet.<br />Create one on the selected site.</div>}
        </div>
        {active ? <button className="primary branch-button" onClick={() => actions.cloneScenario(active.id, undefined, "human")}>＋ Branch current option</button> : <button className="primary branch-button" onClick={createRectangle}>＋ Create first mass</button>}
      </aside>

      <section className={`canvas-wrap canvas-mode-${canvasMode}`}>
        <div id="vworld-map" className={`vworld-canvas ${vworldReady ? "ready" : ""}`}></div>
        {!vworldReady && <div className="fallback-world">
          <div className="terrain-grid"></div><div className="fake-road road-a"></div><div className="fake-road road-b"></div>
          <div className="context-building b1"></div><div className="context-building b2"></div><div className="context-building b3"></div>
          {active && <svg className="analysis-overlay" viewBox="0 0 320 240" aria-label="Solar shadow analysis">
            {compareShadow && compareShadow.points.length >= 3 && <polygon className="fallback-shadow compare" points={svgPoints(compareShadow.points)} />}
            {activeShadow && activeShadow.points.length >= 3 && <polygon className="fallback-shadow active" points={svgPoints(activeShadow.points)} />}
            {compare && <polygon className="fallback-mass compare" points={svgPoints(massLocalPoints(compare.mass))} />}
            <polygon className="fallback-mass active" points={svgPoints(massLocalPoints(active.mass))} />
          </svg>}
          <div className="fallback-note">{mapError ? "VWorld unavailable" : apiKey ? "VWorld loading…" : "VITE_VWORLD_API_KEY 미주입"}</div>
        </div>}

        <div className="site-toolbar">
          <form className="site-search" onSubmit={handleSearch}>
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search Korean address…" aria-label="Search VWorld address" />
            <button type="submit" disabled={searching || !apiKey}>{searching ? "…" : "Search"}</button>
          </form>
          {searchResults.length > 0 && <div className="search-results">
            {searchResults.map((result) => <button key={result.id} onClick={() => void selectSearchResult(result)}><strong>{result.title}</strong><span>{result.address}</span></button>)}
          </div>}
        </div>

        <div className="model-toolbar" aria-label="Canvas modeling tools">
          <button className={canvasMode === "pick-site" ? "selected" : ""} onClick={() => setCanvasMode("pick-site")}>⌖ Pick parcel</button>
          <button onClick={createRectangle}>＋ Rectangle</button>
          <button className={canvasMode === "draw-polygon" ? "selected" : ""} onClick={startPolygon}>✎ Polygon</button>
          <button className={canvasMode === "move-mass" ? "selected" : ""} onClick={() => active && setCanvasMode("move-mass")} disabled={!active}>↔ Move</button>
          <button className={canvasMode === "sun-point" ? "selected" : ""} onClick={() => active && setCanvasMode("sun-point")} disabled={!active}>☀ Sun point</button>
          <button className={canvasMode === "viewpoint" ? "selected" : ""} onClick={() => setCanvasMode("viewpoint")}>◉ Viewpoint</button>
          <button onClick={() => active && actions.deleteScenario(active.id, "human")} disabled={!active}>Delete</button>
        </div>

        {canvasMode !== "inspect" && <div className="canvas-tool-hint">
          {canvasMode === "pick-site" && "Click the map to select the cadastral parcel."}
          {canvasMode === "move-mass" && "Click the new center position for the active mass."}
          {canvasMode === "draw-polygon" && <>{draftPoints.length < 3 ? `Click footprint vertices · ${draftPoints.length} placed` : `${draftPoints.length} vertices ready`} <button onClick={finishPolygon} disabled={draftPoints.length < 3}>Finish</button></>}
          {canvasMode === "sun-point" && "Click a ground point to estimate direct sun hours for the current option."}
          {canvasMode === "viewpoint" && "Click where you want to stand and look back at the site."}
          <button onClick={cancelCanvasTool}>Cancel</button>
        </div>}

        {siteMessage && <div className={`site-message ${siteBusy ? "busy" : ""}`}>{siteMessage}</div>}
        {mapError && <div className="error-banner">{mapError}</div>}
        <div className="canvas-title"><span>{state.site.source === "vworld-cadastral" ? "VWORLD PARCEL" : "SITE CONTEXT"}</span><strong>{active ? `${active.id} · ${active.name}` : state.site.name}</strong></div>
        {active && <div className="canvas-legend"><span><i className="legend-dot active-dot"></i>{active.id} active</span>{compare && <span><i className="legend-dot compare-dot"></i>{compare.id} compare</span>}</div>}

        <section className="analysis-dock" aria-label="Sun and shadow analysis">
          {active && activeShadow ? <>
            <div className="analysis-topline">
              <div className="analysis-title"><div className="eyebrow">SUN / SHADOW</div><strong>{activeTime} KST</strong><span>Altitude {solarValue(activeShadow.solar.elevationDeg)} · Azimuth {solarValue(activeShadow.solar.azimuthDeg)} · Shadow {activeShadow.solar.isDaylight ? `${activeShadow.lengthM.toFixed(1)}m` : "—"} · Direct sun {activeSunStudy ? formatMinutes(sceneSunContext?.supported ? activeContextSunMinutes : activeSunStudy.sunMinutes) : "—"}</span></div>
              <div className="analysis-fields"><label>Date<input aria-label="Shadow date" type="date" value={activeDate} onChange={(event) => actions.setShadowTime(active.id, withDateAndTime(active.analysisTime, event.target.value, activeTime))} /></label><label>Time<input aria-label="Shadow time" type="time" value={activeTime} onChange={(event) => actions.setShadowTime(active.id, withDateAndTime(active.analysisTime, activeDate, event.target.value))} /></label></div>
            </div>
            <div className="timeline"><span>09:00</span><input aria-label="Shadow time timeline" type="range" min={540} max={1080} step={15} value={Math.min(1080, Math.max(540, activeMinutes))} onChange={(event) => actions.setShadowTime(active.id, withDateAndTime(active.analysisTime, activeDate, timeFromMinutes(Number(event.target.value))))} /><span>18:00</span></div>
            {activeSunStudy && <div className="sun-viz-block">
              <SunExposureTimeline
                label={workspaceMode === "compare" ? `${active.id} · ${active.name}` : "Direct sun"}
                samples={activeSunStudy.samples}
                cityBlockedTimes={sceneBlockedTimes}
                activeLocalDateTime={active.analysisTime}
                onSelect={(localDateTime) => actions.setShadowTime(active.id, localDateTime)}
              />
              {workspaceMode === "compare" && compare && compareSunStudy && <SunExposureTimeline
                label={`${compare.id} · ${compare.name}`}
                samples={compareSunStudy.samples}
                cityBlockedTimes={sceneBlockedTimes}
                activeLocalDateTime={active.analysisTime}
              />}
              <SunExposureLegend />
            </div>}
            {workspaceMode === "compare" && <div className="compare-drawer">
              <div className="compare-drawer-head"><div><div className="eyebrow">COMPARE</div><strong>Scenario delta</strong></div><select aria-label="Compare scenario" value={state.compareScenarioId ?? ""} onChange={(event) => actions.compareScenarios(active.id, event.target.value || undefined)}><option value="">No comparison</option>{state.scenarios.filter((scenario) => scenario.id !== active.id).map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.id} · {scenario.name}</option>)}</select></div>
              {compare && compareShadow ? <div className="compare-grid"><Meter label="Height A / B" value={`${active.mass.heightM} / ${compare.mass.heightM}`} suffix="m" /><Meter label="GFA Δ" value={(estimateGfa(active.mass) - estimateGfa(compare.mass)).toLocaleString()} suffix="㎡" /><Meter label="Shadow Δ" value={(activeShadow.lengthM - compareShadow.lengthM).toFixed(1)} suffix="m" /><Meter label="Direct sun A / B" value={activeSunStudy && compareSunStudy ? `${formatMinutes(sceneSunContext?.supported ? activeContextSunMinutes : activeSunStudy.sunMinutes)} / ${formatMinutes(sceneSunContext?.supported ? compareContextSunMinutes : compareSunStudy.sunMinutes)}` : "—"} /><Meter label="View visible A / B" value={viewImpactResults[active.id] && viewImpactResults[compare.id] ? `${viewImpactResults[active.id].visibleRatioPct.toFixed(0)} / ${viewImpactResults[compare.id].visibleRatioPct.toFixed(0)}` : "—"} suffix={viewImpactResults[active.id] && viewImpactResults[compare.id] ? "%" : ""} /></div> : <p className="muted">Select another scenario to compare.</p>}
            </div>}
          </> : <div className="analysis-empty"><strong>Select a site, then create a building mass.</strong><span>Address search or Pick parcel → Rectangle / Polygon → analyze and branch.</span></div>}
        </section>
      </section>

      <aside className="right-panel panel">
        {active && activeShadow ? <>
          <div className="inspector-heading"><span className="inspector-scenario" data-scenario={active.id}>{active.id}</span><div><div className="eyebrow">INSPECTOR</div><h2>{active.name}</h2></div></div>
          <section className="inspector-section"><div className="section-heading"><span>MASS</span><b>{active.mass.footprint.kind === "polygon" ? "POLYGON" : "RECTANGLE"}</b></div>
            <Slider label="Height" value={active.mass.heightM} min={3} max={80} suffix="m" onChange={(heightM) => actions.editBuildingMass(active.id, { heightM })} />
            <Slider label="Rotation" value={active.mass.rotationDeg} min={-180} max={180} suffix="°" onChange={(rotationDeg) => actions.editBuildingMass(active.id, { rotationDeg })} />
            <label className="control"><div className="control-line"><span>Floors</span><span className="value-editor"><input aria-label="Floors" type="number" min={1} max={40} value={active.mass.floors} onChange={(event) => actions.editBuildingMass(active.id, { floors: Number(event.target.value) })} /></span></div></label>
          </section>
          <section className="inspector-section"><div className="section-heading"><span>POSITION</span><b>LOCAL METERS</b></div>
            <Slider label="East" value={active.mass.position.eastM} min={-120} max={120} suffix="m" onChange={(eastM) => actions.editBuildingMass(active.id, { position: { eastM } })} />
            <Slider label="North" value={active.mass.position.northM} min={-120} max={120} suffix="m" onChange={(northM) => actions.editBuildingMass(active.id, { position: { northM } })} />
          </section>
          <FootprintEditor footprint={active.mass.footprint} onChange={(footprint) => actions.setMassFootprint(active.id, footprint)} />
          <section className="inspector-section"><div className="section-heading"><span>SHADOW</span><b>{activeTime} KST</b></div><div className="readout-list"><div><span>Solar altitude</span><strong>{solarValue(activeShadow.solar.elevationDeg)}</strong></div><div><span>Azimuth</span><strong>{solarValue(activeShadow.solar.azimuthDeg)}</strong></div><div><span>Shadow length</span><strong>{activeShadow.solar.isDaylight ? `${activeShadow.lengthM.toFixed(1)}m` : "—"}</strong></div><div><span>Shadow bearing</span><strong>{shadowBearing(activeShadow)}{activeShadow.solar.isDaylight ? "°" : ""}</strong></div></div></section>
          <section className="inspector-section"><div className="section-heading"><span>PLANNING</span><b>CURRENT OPTION</b></div><div className="readout-list"><div><span>Site area</span><strong>{activePlanning ? Math.round(activePlanning.siteAreaM2).toLocaleString() : "—"}㎡</strong></div><div><span>Footprint</span><strong>{Math.round(footprintAreaM2(active.mass.footprint)).toLocaleString()}㎡</strong></div><div><span>Estimated GFA</span><strong>{estimateGfa(active.mass).toLocaleString()}㎡</strong></div><div><span>Planned coverage</span><strong>{activePlanning ? activePlanning.coverageRatioPct.toFixed(1) : "—"}%</strong></div><div><span>Planned FAR</span><strong>{activePlanning ? activePlanning.floorAreaRatioPct.toFixed(1) : "—"}%</strong></div></div></section>
          <section className="inspector-section"><div className="section-heading"><span>SUN EXPOSURE</span><b>09:00–18:00</b></div><div className="readout-list"><div><span>Study point</span><strong>{state.sunStudyPoint ? "Selected" : "Site center"}</strong></div><div><span>Direct sun</span><strong>{activeSunStudy ? formatMinutes(sceneSunContext?.supported ? activeContextSunMinutes : activeSunStudy.sunMinutes) : "—"}</strong></div><div><span>Planned-mass shadow</span><strong>{activeSunStudy ? formatMinutes(activeSunStudy.shadowMinutes) : "—"}</strong></div><div><span>City context</span><strong>{sceneSunBusy ? "Sampling…" : sceneSunContext?.supported ? "VWorld 3D" : "Planned mass only"}</strong></div></div><button className="quiet-button analysis-action" onClick={() => setCanvasMode("sun-point")}>Set sun study point</button>{state.sunStudyPoint && <button className="quiet-button analysis-action" onClick={() => actions.setSunStudyPoint(undefined, "human")}>Use site center</button>}</section>
          <section className="inspector-section"><div className="section-heading"><span>VIEWPOINT</span><b>{state.viewpoint ? `${state.viewpoint.eyeHeightM.toFixed(1)}m EYE` : "NOT SET"}</b></div>{state.viewpoint ? <><label className="control"><div className="control-line"><span>Eye height</span><span className="value-editor"><input aria-label="Viewpoint eye height" type="number" min={1.2} max={50} step={0.1} value={state.viewpoint.eyeHeightM} onChange={(event) => actions.setViewpoint({ ...state.viewpoint!, eyeHeightM: Number(event.target.value) }, "human")} /><em>m</em></span></div></label>{viewImpactResults[active.id] && <>
  <ViewImpactBar
    visibleRatioPct={viewImpactResults[active.id].visibleRatioPct}
    classification={viewImpactResults[active.id].classification}
    label={`${active.id} visibility`}
  />
  <div className="readout-list"><div><span>Visible samples</span><strong>{viewImpactResults[active.id].visibleSamples} / {viewImpactResults[active.id].totalSamples}</strong></div></div>
  {compare && viewImpactResults[compare.id] && <ViewImpactBar
    visibleRatioPct={viewImpactResults[compare.id].visibleRatioPct}
    classification={viewImpactResults[compare.id].classification}
    label={`${compare.id} visibility`}
  />}
</>}<div className="viewpoint-actions"><button className="quiet-button" onClick={() => flyToViewpoint(state.viewpoint!, state.site, active.mass)}>Open view</button><button className="quiet-button" disabled={viewImpactBusy} onClick={() => void runViewImpact()}>{viewImpactBusy ? "Analyzing…" : "Analyze view"}</button><button className="quiet-button" onClick={() => { actions.setViewpoint(undefined, "human"); flyToSite(state.site); }}>Clear</button></div></> : <button className="quiet-button analysis-action" onClick={() => setCanvasMode("viewpoint")}>Pick viewpoint</button>}</section>
          <small className="boundary">*Direct sun uses the current planned mass plus VWorld 3D scene height sampling when supported. It remains a geometric pre-check, not a statutory sunlight-right determination.</small>
        </> : <div className="inspector-empty"><div className="eyebrow">INSPECTOR</div><h2>No mass selected</h2><p>Use Rectangle or Polygon on the map to create the first design option.</p></div>}
      </aside>
    </section>
  </main>;
}
