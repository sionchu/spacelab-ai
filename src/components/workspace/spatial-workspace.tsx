"use client";

import { FormEvent, useMemo, useReducer, useRef, useState } from "react";
import { Building2, MapPin, Move3D, Search, SunMedium } from "lucide-react";
import { createApplicationActions } from "@/actions";
import { directSunStudy, planningMetrics } from "@/analysis";
import { buildingPresets } from "@/building-presets";
import { SpatialMap, type MapInteractionMode } from "@/components/map/spatial-map";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  geoPointToLocal,
  getScenario,
  initialState,
  reducer,
} from "@/model";
import { sunStateAt, timeLabel } from "@/lib/sun";
import type { GeoPoint, Site } from "@/types";

type SearchResult = {
  id: string;
  title: string;
  address: string;
  point: GeoPoint;
};

function datePart(value: string) {
  return value.slice(0, 10);
}

function minutesPart(value: string) {
  const [hours, minutes] = value.slice(11, 16).split(":").map(Number);
  return hours * 60 + minutes;
}

function localDateTime(date: string, minutes: number) {
  return `${date}T${timeLabel(minutes)}`;
}

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}시간${rest ? ` ${rest}분` : ""}` : `${rest}분`;
}

export function SpatialWorkspace() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const actions = useMemo(
    () => createApplicationActions(
      (action) => dispatch(action),
      () => stateRef.current,
    ),
    [],
  );

  const active = state.activeScenarioId
    ? getScenario(state, state.activeScenarioId)
    : undefined;
  const visibleScenarios = active ? [active] : [];
  const [interactionMode, setInteractionMode] = useState<MapInteractionMode>("inspect");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [siteMessage, setSiteMessage] = useState("");
  const [buildingTab, setBuildingTab] = useState("preset");

  const date = active ? datePart(active.analysisTime) : "2026-09-19";
  const minutes = active ? minutesPart(active.analysisTime) : 15 * 60;
  const sun = useMemo(
    () => sunStateAt(state.site.center, date, minutes),
    [date, minutes, state.site.center],
  );
  const metrics = useMemo(
    () => active ? planningMetrics(state.site, active.mass) : undefined,
    [active, state.site],
  );
  const sunStudy = useMemo(
    () => active
      ? directSunStudy(
          active.mass,
          state.site,
          state.sunStudyPoint ?? state.site.center,
          date,
          state.timeZoneOffsetMinutes,
        )
      : undefined,
    [active, date, state.site, state.sunStudyPoint, state.timeZoneOffsetMinutes],
  );

  async function searchSite(event: FormEvent) {
    event.preventDefault();
    const query = searchQuery.trim();
    if (query.length < 2) return;
    setSearching(true);
    setSiteMessage("");
    try {
      const response = await fetch(`/api/vworld/search?q=${encodeURIComponent(query)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "주소 검색 실패");
      setSearchResults(payload.results ?? []);
    } catch (error) {
      setSiteMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSearching(false);
    }
  }

  async function selectParcel(point: GeoPoint, label?: string) {
    setSiteMessage("필지 경계를 불러오는 중…");
    try {
      const params = new URLSearchParams({
        lon: String(point.lon),
        lat: String(point.lat),
      });
      if (label) params.set("label", label);
      const response = await fetch(`/api/vworld/parcel?${params}`);
      const payload = await response.json();
      if (!response.ok || !payload.site) throw new Error(payload?.error || "필지 선택 실패");
      actions.setSite(payload.site as Site, "human");
      setSearchResults([]);
      if (label) setSearchQuery(label);
      setInteractionMode("inspect");
      setSiteMessage("선택 필지를 3D 지형에 맞췄습니다.");
    } catch (error) {
      setSiteMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function handleMapClick(point: GeoPoint) {
    if (interactionMode === "pick-site") {
      void selectParcel(point);
      return;
    }
    if (interactionMode === "move-mass" && active) {
      const local = geoPointToLocal(state.site.center, point);
      actions.editBuildingMass(active.id, {
        position: { eastM: local.xM, northM: local.yM },
      }, "human");
      setInteractionMode("inspect");
    }
  }

  function createPreset(index: number) {
    const preset = buildingPresets[index];
    if (!preset) return;
    actions.createBuildingMass(preset.input, "human");
    setInteractionMode("inspect");
  }

  function createCustomRectangle() {
    actions.createBuildingMass({
      name: "커스텀 건물",
      intent: "커스텀 사각형 배치안",
      footprint: { kind: "rectangle", widthM: 32, depthM: 24 },
      heightM: 18,
      floors: 5,
    }, "human");
  }

  function setTime(nextMinutes: number) {
    if (!active) return;
    actions.setShadowTime(active.id, localDateTime(date, nextMinutes), "human");
  }

  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <div className="wordmark">
          <strong>SpaceLab</strong>
          <span>실제 부지 위 공간계획</span>
        </div>
        <div className="header-status">
          <span>MapLibre GL JS</span>
          <span>DEM 3D</span>
          <span>GeoJSON</span>
        </div>
      </header>

      <section className="workspace-map">
        <SpatialMap
          site={state.site}
          scenarios={visibleScenarios}
          activeScenarioId={state.activeScenarioId}
          sun={sun}
          interactionMode={interactionMode}
          onMapClick={handleMapClick}
        />

        <aside className="floating-panel site-panel">
          <div className="panel-title">
            <MapPin size={15} />
            <div>
              <strong>부지</strong>
              <span>{state.site.source === "demo" ? "실제 필지를 선택하세요" : state.site.address || state.site.name}</span>
            </div>
          </div>

          <form className="search-row" onSubmit={searchSite}>
            <Search size={15} />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="주소나 지번 검색"
              aria-label="주소나 지번 검색"
            />
            <Button size="sm" type="submit" disabled={searching}>
              {searching ? "검색 중" : "검색"}
            </Button>
          </form>

          {searchResults.length > 0 && (
            <div className="search-result-list">
              {searchResults.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => void selectParcel(result.point, result.address)}
                >
                  <strong>{result.title}</strong>
                  <span>{result.address}</span>
                </button>
              ))}
            </div>
          )}

          <div className="panel-actions">
            <Button
              variant={interactionMode === "pick-site" ? "default" : "secondary"}
              size="sm"
              onClick={() => setInteractionMode(
                interactionMode === "pick-site" ? "inspect" : "pick-site",
              )}
            >
              지도에서 필지 선택
            </Button>
          </div>

          {siteMessage && <p className="panel-message">{siteMessage}</p>}
          {state.site.pnu && <p className="parcel-code">PNU {state.site.pnu}</p>}
        </aside>

        <aside className="floating-panel building-panel">
          <div className="panel-title">
            <Building2 size={15} />
            <div>
              <strong>건물 배치</strong>
              <span>{active ? `${active.mass.heightM}m · ${active.mass.floors}층` : "초기 매스를 만들어보세요"}</span>
            </div>
          </div>

          <Tabs value={buildingTab} onValueChange={setBuildingTab}>
            <TabsList className="w-full">
              <TabsTrigger value="preset" className="flex-1">프리셋</TabsTrigger>
              <TabsTrigger value="custom" className="flex-1">커스텀</TabsTrigger>
            </TabsList>
            <TabsContent value="preset">
              <div className="preset-list">
                {buildingPresets.map((preset, index) => (
                  <button key={preset.id} type="button" onClick={() => createPreset(index)}>
                    <strong>{preset.label}</strong>
                    <span>{preset.floorsLabel}</span>
                  </button>
                ))}
              </div>
            </TabsContent>
            <TabsContent value="custom">
              <Button variant="secondary" className="w-full" onClick={createCustomRectangle}>
                사각형 매스 만들기
              </Button>
              <p className="panel-helper">자유형 폴리곤 편집기는 MapLibre 이관 2단계에서 복원합니다.</p>
            </TabsContent>
          </Tabs>

          {active && (
            <>
              <div className="mass-metrics">
                <div><span>대지면적</span><strong>{Math.round(metrics?.siteAreaM2 ?? 0).toLocaleString()}㎡</strong></div>
                <div><span>건축면적</span><strong>{Math.round(metrics?.footprintAreaM2 ?? 0).toLocaleString()}㎡</strong></div>
                <div><span>추정 연면적</span><strong>{Math.round(metrics?.estimatedGfaM2 ?? 0).toLocaleString()}㎡</strong></div>
              </div>
              <Button
                variant={interactionMode === "move-mass" ? "default" : "outline"}
                className="w-full"
                onClick={() => setInteractionMode(
                  interactionMode === "move-mass" ? "inspect" : "move-mass",
                )}
              >
                <Move3D size={15} />
                지도에서 위치 이동
              </Button>
            </>
          )}
        </aside>

        {interactionMode !== "inspect" && (
          <div className="mode-hint">
            {interactionMode === "pick-site"
              ? "지도에서 검토할 필지를 탭하세요."
              : "건물 중심을 옮길 위치를 탭하세요."}
            <button type="button" onClick={() => setInteractionMode("inspect")}>취소</button>
          </div>
        )}

        <section className="sun-dock">
          <div className="sun-summary">
            <SunMedium size={18} />
            <div>
              <span>{date}</span>
              <strong>{timeLabel(minutes)}</strong>
            </div>
            <div className="sun-values">
              <span>고도 {sun.altitudeDeg.toFixed(1)}°</span>
              <span>방위 {sun.azimuthDeg.toFixed(0)}°</span>
              <span>{sunStudy ? `직접 일조 ${formatMinutes(sunStudy.sunMinutes)}` : "건물 생성 전"}</span>
            </div>
          </div>
          <div className="timeline-row">
            <span>09:00</span>
            <Slider
              min={540}
              max={1080}
              step={15}
              value={[minutes]}
              onValueChange={(value) => setTime(value[0] ?? minutes)}
              disabled={!active}
              aria-label="태양 시간"
            />
            <span>18:00</span>
          </div>
          <div className="sun-track">
            <span
              className="sun-track-now"
              style={{ left: `${((minutes - 540) / 540) * 100}%` }}
            />
          </div>
        </section>
      </section>
    </main>
  );
}
