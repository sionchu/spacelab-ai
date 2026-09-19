"use client";

import { FormEvent, useEffect, useMemo, useReducer, useState } from "react";
import { Building2, Eye, Layers3, MapPin, Move, Search, SunMedium } from "lucide-react";
import { SpatialMap } from "@/components/map/spatial-map";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { createApplicationActions } from "@/src/actions";
import { buildingPresets } from "@/src/building-presets";
import {
  computeShadowPolygon,
  estimateGfa,
  getScenario,
  initialState,
  reducer,
} from "@/src/model";
import type { GeoPoint, Site } from "@/src/types";
import { viewImpact } from "@/src/view-impact";
import type { BuildingContextCollection, ViewImpactResult } from "@/src/view-impact";
import { solarPositionAt, timeFromMinutes } from "@/lib/solar/sun";

type Mode = "inspect" | "pick-site" | "move-mass" | "viewpoint";

type SearchResult = {
  id: string;
  title: string;
  address: string;
  point: GeoPoint;
};

const emptyContextBuildings: BuildingContextCollection = {
  type: "FeatureCollection",
  features: [],
};

function viewImpactLabel(result?: ViewImpactResult) {
  if (!result?.supported) return "분석 불가";
  if (result.classification === "mostly-visible") return "대부분 보임";
  if (result.classification === "partially-visible") return "일부 보임";
  return "대부분 가림";
}

export function WorkspaceClient() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [mode, setMode] = useState<Mode>("inspect");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [minutes, setMinutes] = useState(900);
  const [date, setDate] = useState("2026-09-19");
  const [panel, setPanel] = useState<"site" | "building" | "analysis" | "scenario">("site");
  const [contextBuildings, setContextBuildings] = useState<BuildingContextCollection>(emptyContextBuildings);
  const [contextSource, setContextSource] = useState("건물 컨텍스트 없음");

  const actions = useMemo(
    () => createApplicationActions(dispatch, () => state),
    [state],
  );

  const active = state.activeScenarioId ? getScenario(state, state.activeScenarioId) : undefined;
  const compare = state.compareScenarioId ? getScenario(state, state.compareScenarioId) : undefined;
  const sun = solarPositionAt(date, minutes, state.site.center.lat, state.site.center.lon);
  const viewImpactResults = useMemo(() => {
    if (!state.viewpoint || !active || !contextBuildings.features.length) return {} as Record<string, ViewImpactResult>;
    const results: Record<string, ViewImpactResult> = {
      [active.id]: viewImpact(state.viewpoint, state.site, active.mass, contextBuildings),
    };
    if (compare) results[compare.id] = viewImpact(state.viewpoint, state.site, compare.mass, contextBuildings);
    return results;
  }, [active, compare, contextBuildings, state.site, state.viewpoint]);
  const shadow = active
    ? computeShadowPolygon(active.mass, state.site.center, date + "T" + timeFromMinutes(minutes), 540)
    : undefined;

  useEffect(() => {
    if (state.site.source === "demo") {
      setContextBuildings(emptyContextBuildings);
      setContextSource("건물 컨텍스트 없음");
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      lon: String(state.site.center.lon),
      lat: String(state.site.center.lat),
      radius: "350",
    });

    void fetch(`/api/context/buildings?${params}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((data) => {
        if (data?.type !== "FeatureCollection") return;
        setContextBuildings(data as BuildingContextCollection);
        const source = data.features?.[0]?.properties?.source;
        setContextSource(
          typeof source === "string" && source
            ? source
            : data.features?.length
              ? "건물 GeoJSON"
              : "건물 컨텍스트 없음",
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setContextBuildings(emptyContextBuildings);
          setContextSource("건물 컨텍스트 없음");
        }
      });

    return () => controller.abort();
  }, [state.site.center.lat, state.site.center.lon, state.site.id, state.site.source]);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      const response = await fetch("/api/vworld/search?q=" + encodeURIComponent(query));
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "주소 검색 실패");
      setResults(payload);
    } finally {
      setSearching(false);
    }
  }

  async function selectParcel(point: GeoPoint, label?: string) {
    const response = await fetch("/api/vworld/parcel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ point, label }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || "필지 선택 실패");
    actions.setSite(payload as Site, "human");
    setMode("inspect");
    setResults([]);
    if (label) setQuery(label);
  }

  function setViewpoint(point: GeoPoint) {
    actions.setViewpoint({ point, eyeHeightM: state.viewpoint?.eyeHeightM ?? 1.7 }, "human");
    setMode("inspect");
  }

  function moveActive(point: GeoPoint) {
    if (!active) return;
    const latScale = 111_320;
    const lonScale = 111_320 * Math.cos((state.site.center.lat * Math.PI) / 180);
    actions.editBuildingMass(active.id, {
      position: {
        eastM: (point.lon - state.site.center.lon) * lonScale,
        northM: (point.lat - state.site.center.lat) * latScale,
      },
    }, "human");
    setMode("inspect");
  }

  function setMassNumber(key: "heightM" | "floors" | "rotationDeg", value: number) {
    if (!active) return;
    actions.editBuildingMass(active.id, { [key]: value }, "human");
  }

  const navItems = [
    { key: "site" as const, label: "부지", icon: MapPin },
    { key: "building" as const, label: "건물", icon: Building2 },
    { key: "analysis" as const, label: "분석", icon: SunMedium },
    { key: "scenario" as const, label: "대안", icon: Layers3 },
  ];

  return (
    <main className="grid h-dvh grid-rows-[54px_minmax(0,1fr)] overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <header className="flex items-center gap-3 border-b border-white/8 bg-[#0f161d] px-3 md:px-5">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-extrabold tracking-[-0.03em]">SpaceLab</div>
          <div className="hidden text-[9px] text-[var(--muted-foreground)] md:block">부지 · 건물 · 일조 · 조망 검토</div>
        </div>
        <div className="rounded-lg border border-white/8 bg-[#151f28] px-2.5 py-1.5 text-[10px] text-[#a8b3bd]">
          MapLibre 3D
        </div>
      </header>

      <section className="relative min-h-0 overflow-hidden">
        <SpatialMap
          site={state.site}
          active={active}
          compare={compare}
          date={date}
          minutes={minutes}
          mode={mode}
          contextBuildings={contextBuildings}
          contextSource={contextSource}
          viewpoint={state.viewpoint}
          onPickSite={(point) => void selectParcel(point)}
          onMoveMass={moveActive}
          onSetViewpoint={setViewpoint}
        />

        <aside className="absolute left-3 top-[76px] z-10 hidden w-[310px] overflow-hidden rounded-2xl border border-white/9 bg-[#121b23]/96 shadow-2xl md:block">
          <div className="border-b border-white/7 px-4 py-3">
            <div className="text-[10px] font-bold text-[var(--primary)]">SPACE WORKSPACE</div>
            <div className="mt-1 text-sm font-bold">{state.site.address || state.site.name}</div>
          </div>
          <div className="p-3">
            <PanelContent
              panel={panel}
              active={active}
              state={state}
              mode={mode}
              query={query}
              results={results}
              searching={searching}
              onQuery={setQuery}
              onSearch={search}
              onSelectResult={(result) => void selectParcel(result.point, result.address)}
              onMode={setMode}
              onCreatePreset={(preset) => actions.createBuildingMass(preset.input, "human")}
              onMassNumber={setMassNumber}
              viewImpactResults={viewImpactResults}
              contextSource={contextSource}
              onEyeHeight={(value) => state.viewpoint && actions.setViewpoint({ ...state.viewpoint, eyeHeightM: value }, "human")}
              onClearViewpoint={() => actions.setViewpoint(undefined, "human")}
              onSelectScenario={(scenarioId) => actions.selectScenario(scenarioId)}
              onCompareScenario={(scenarioId) => active && actions.compareScenarios(active.id, scenarioId || undefined)}
            />
          </div>
        </aside>

        <section className="absolute bottom-[70px] left-3 right-3 z-10 rounded-2xl border border-white/9 bg-[#111922]/96 p-3 shadow-2xl md:bottom-4 md:left-[330px] md:right-[330px]">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-[10px] font-bold text-[#d8ad58]">태양 · 그림자</div>
              <div className="mt-0.5 text-lg font-extrabold tabular-nums">{timeFromMinutes(minutes)} KST</div>
            </div>
            <div className="text-right text-[10px] leading-4 text-[var(--muted-foreground)]">
              <div>고도 {sun.altitudeDeg.toFixed(1)}° · 방위 {sun.azimuthDeg.toFixed(1)}°</div>
              <div>{!active ? "건물 없음" : shadow?.solar.isDaylight ? "그림자 " + shadow.lengthM.toFixed(1) + "m" : "태양 고도 0° 이하"}</div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-[42px_1fr_42px] items-center gap-2 text-[9px] text-[#8b98a3]">
            <span>09:00</span>
            <Slider value={[minutes]} min={540} max={1080} step={15} onValueChange={(value) => setMinutes(value[0] ?? 900)} />
            <span className="text-right">18:00</span>
          </div>
          <input
            className="mt-2 w-[126px] rounded-lg border border-white/8 bg-[#0e151b] px-2 py-1 text-[10px] text-white"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </section>

        <nav className="absolute bottom-2 left-2 right-2 z-20 grid h-[58px] grid-cols-4 rounded-2xl border border-white/9 bg-[#101820]/98 p-1 shadow-2xl md:hidden">
          {navItems.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setPanel(key)}
              className={"grid place-items-center content-center gap-1 rounded-xl text-[10px] font-semibold " + (panel === key ? "bg-[#1d2a34] text-white" : "text-[#798793]")}
            >
              <Icon className={"size-4 " + (panel === key ? "text-[var(--primary)]" : "")} />
              {label}
            </button>
          ))}
        </nav>

        <section className="absolute bottom-[136px] left-2 right-2 z-20 max-h-[48dvh] overflow-y-auto rounded-2xl border border-white/9 bg-[#131c24]/98 p-3 shadow-2xl md:hidden">
          <PanelContent
            panel={panel}
            active={active}
            state={state}
            mode={mode}
            query={query}
            results={results}
            searching={searching}
            onQuery={setQuery}
            onSearch={search}
            onSelectResult={(result) => void selectParcel(result.point, result.address)}
            onMode={setMode}
            onCreatePreset={(preset) => actions.createBuildingMass(preset.input, "human")}
            onMassNumber={setMassNumber}
            viewImpactResults={viewImpactResults}
            contextSource={contextSource}
            onEyeHeight={(value) => state.viewpoint && actions.setViewpoint({ ...state.viewpoint, eyeHeightM: value }, "human")}
            onClearViewpoint={() => actions.setViewpoint(undefined, "human")}
            onSelectScenario={(scenarioId) => actions.selectScenario(scenarioId)}
            onCompareScenario={(scenarioId) => active && actions.compareScenarios(active.id, scenarioId || undefined)}
          />
        </section>
      </section>
    </main>
  );
}

function PanelContent({
  panel,
  active,
  state,
  mode,
  query,
  results,
  searching,
  onQuery,
  onSearch,
  onSelectResult,
  onMode,
  onCreatePreset,
  onMassNumber,
  viewImpactResults,
  contextSource,
  onEyeHeight,
  onClearViewpoint,
  onSelectScenario,
  onCompareScenario,
}: {
  panel: "site" | "building" | "analysis" | "scenario";
  active: ReturnType<typeof getScenario> | undefined;
  state: typeof initialState;
  mode: Mode;
  query: string;
  results: SearchResult[];
  searching: boolean;
  onQuery: (value: string) => void;
  onSearch: (event: FormEvent) => void;
  onSelectResult: (result: SearchResult) => void;
  onMode: (mode: Mode) => void;
  onCreatePreset: (preset: (typeof buildingPresets)[number]) => void;
  onMassNumber: (key: "heightM" | "floors" | "rotationDeg", value: number) => void;
  viewImpactResults: Record<string, ViewImpactResult>;
  contextSource: string;
  onEyeHeight: (value: number) => void;
  onClearViewpoint: () => void;
  onSelectScenario: (scenarioId: string) => void;
  onCompareScenario: (scenarioId: string) => void;
}) {
  if (panel === "site") {
    return (
      <div className="grid gap-3">
        <div>
          <div className="text-[10px] font-bold text-[var(--primary)]">선택 부지</div>
          <div className="mt-1 truncate text-xs font-semibold">{state.site.address || state.site.name}</div>
          {state.site.pnu && <div className="mt-0.5 text-[9px] text-[#7f8c98]">PNU {state.site.pnu}</div>}
        </div>
        <form onSubmit={onSearch} className="grid grid-cols-[1fr_auto] overflow-hidden rounded-xl border border-white/9 bg-[#0d141a]">
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="주소나 지번 검색"
            className="min-w-0 bg-transparent px-3 py-2.5 text-xs outline-none"
          />
          <button className="px-3 text-[var(--primary)]" disabled={searching}>
            <Search className="size-4" />
          </button>
        </form>
        {results.length > 0 && (
          <div className="max-h-44 overflow-y-auto rounded-xl border border-white/8 bg-[#0f171e]">
            {results.map((result) => (
              <button key={result.id} onClick={() => onSelectResult(result)} className="grid w-full gap-0.5 border-b border-white/6 px-3 py-2 text-left last:border-b-0">
                <strong className="truncate text-[11px]">{result.title}</strong>
                <span className="truncate text-[9px] text-[#7f8c98]">{result.address}</span>
              </button>
            ))}
          </div>
        )}
        <Button variant={mode === "pick-site" ? "default" : "outline"} size="sm" onClick={() => onMode(mode === "pick-site" ? "inspect" : "pick-site")}>
          <MapPin className="size-3.5" /> 지도에서 필지 선택
        </Button>
      </div>
    );
  }

  if (panel === "building") {
    return (
      <div className="grid gap-3">
        <div>
          <div className="text-[10px] font-bold text-[var(--primary)]">건물 프리셋</div>
          <div className="mt-1 text-[11px] text-[#8d99a5]">초기 매스를 만든 뒤 바로 수정할 수 있습니다.</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {buildingPresets.map((preset) => (
            <button key={preset.id} onClick={() => onCreatePreset(preset)} className="rounded-xl border border-white/8 bg-[#0f171e] p-2.5 text-left hover:border-[var(--primary)]/40">
              <div className="text-[11px] font-bold">{preset.label}</div>
              <div className="mt-1 text-[9px] text-[#7e8b97]">{preset.floorsLabel}</div>
            </button>
          ))}
        </div>
        {active && (
          <div className="grid gap-3 rounded-xl border border-white/8 bg-[#0e151b] p-3">
            <div className="flex items-center justify-between">
              <strong className="text-xs">{active.name}</strong>
              <Button size="sm" variant={mode === "move-mass" ? "default" : "outline"} onClick={() => onMode(mode === "move-mass" ? "inspect" : "move-mass")}>
                <Move className="size-3.5" /> 이동
              </Button>
            </div>
            <NumericControl label="높이" value={active.mass.heightM} min={3} max={120} suffix="m" onValue={(value) => onMassNumber("heightM", value)} />
            <NumericControl label="층수" value={active.mass.floors} min={1} max={40} suffix="층" onValue={(value) => onMassNumber("floors", Math.round(value))} />
            <NumericControl label="회전" value={active.mass.rotationDeg} min={-180} max={180} suffix="°" onValue={(value) => onMassNumber("rotationDeg", value)} />
          </div>
        )}
      </div>
    );
  }

  if (panel === "analysis") {
    const activeView = active ? viewImpactResults[active.id] : undefined;
    const compareScenario = state.compareScenarioId
      ? state.scenarios.find((scenario) => scenario.id === state.compareScenarioId)
      : undefined;
    const compareView = compareScenario ? viewImpactResults[compareScenario.id] : undefined;

    return (
      <div className="grid gap-3">
        <div>
          <div className="text-[10px] font-bold text-[#d8ad58]">일조 · 조망 분석</div>
          <div className="mt-1 text-[11px] leading-5 text-[#8d99a5]">
            태양 슬라이더는 광원·지형 음영·계획 건물 그림자를 갱신합니다. 조망은 선택 위치에서 주변 건물 GeoJSON과 계획 매스 사이의 시선 교차를 계산합니다.
          </div>
        </div>

        <div className="rounded-xl border border-white/8 bg-[#0e151b] p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] font-bold text-[var(--secondary)]">조망 위치</div>
              <div className="mt-1 text-[10px] text-[#8d99a5]">
                {state.viewpoint
                  ? `${state.viewpoint.point.lat.toFixed(5)}, ${state.viewpoint.point.lon.toFixed(5)}`
                  : "지도에서 관찰 위치를 선택하세요."}
              </div>
            </div>
            <Button
              size="sm"
              variant={mode === "viewpoint" ? "default" : "outline"}
              onClick={() => onMode(mode === "viewpoint" ? "inspect" : "viewpoint")}
            >
              <Eye className="size-3.5" /> {state.viewpoint ? "위치 변경" : "위치 선택"}
            </Button>
          </div>

          {state.viewpoint && (
            <div className="mt-3 grid gap-2">
              <label className="grid gap-1 text-[10px] text-[#8f9ca7]">
                눈높이
                <input
                  type="number"
                  min={1.2}
                  max={50}
                  step={0.1}
                  value={state.viewpoint.eyeHeightM}
                  onChange={(event) => onEyeHeight(Math.max(1.2, Math.min(50, Number(event.target.value) || 1.7)))}
                  className="rounded-lg border border-white/8 bg-[#111922] px-2 py-1.5 text-white outline-none"
                />
              </label>
              <Button size="sm" variant="ghost" onClick={onClearViewpoint}>조망 위치 해제</Button>
            </div>
          )}
        </div>

        {active && state.viewpoint && (
          <div className="grid gap-2 rounded-xl border border-white/8 bg-[#0e151b] p-3">
            <div className="flex items-center justify-between">
              <strong className="text-[11px]">{active.id} · {active.name}</strong>
              <span className="text-[9px] text-[#778590]">{contextSource}</span>
            </div>
            <ViewImpactReadout result={activeView} />
            {compareScenario && (
              <div className="mt-1 border-t border-white/7 pt-2">
                <div className="mb-2 text-[11px] font-semibold">{compareScenario.id} · {compareScenario.name}</div>
                <ViewImpactReadout result={compareView} />
              </div>
            )}
          </div>
        )}

        <div className="text-[9px] leading-4 text-[#71808c]">
          조망 가시율은 주변 건물 footprint·높이 기반의 초기 기하학적 추정입니다. 지형, 창호, 수목, 법적 조망권 판단은 포함하지 않습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="text-[10px] font-bold text-[var(--secondary)]">설계 대안</div>
      {state.scenarios.length === 0 ? (
        <div className="text-[11px] text-[#8794a0]">아직 대안이 없습니다. 건물 프리셋을 선택하세요.</div>
      ) : (
        <>
          <div className="grid gap-2">
            {state.scenarios.map((scenario) => (
              <button
                key={scenario.id}
                onClick={() => onSelectScenario(scenario.id)}
                className={"flex items-center justify-between rounded-xl border px-3 py-2 text-left " + (scenario.id === state.activeScenarioId ? "border-[var(--primary)]/45 bg-[#14242a]" : "border-white/8 bg-[#0f171e]")}
              >
                <div>
                  <div className="text-[11px] font-bold">{scenario.id} · {scenario.name}</div>
                  <div className="text-[9px] text-[#7d8a96]">{scenario.mass.heightM}m · {scenario.mass.floors}층 · 약 {estimateGfa(scenario.mass).toLocaleString()}㎡</div>
                </div>
              </button>
            ))}
          </div>
          {active && state.scenarios.length > 1 && (
            <label className="mt-2 grid gap-1 text-[10px] text-[#8d99a5]">
              A/B 비교
              <select
                value={state.compareScenarioId ?? ""}
                onChange={(event) => onCompareScenario(event.target.value)}
                className="rounded-lg border border-white/8 bg-[#0e151b] px-2 py-2 text-white outline-none"
              >
                <option value="">비교 안 함</option>
                {state.scenarios.filter((scenario) => scenario.id !== active.id).map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>{scenario.id} · {scenario.name}</option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
    </div>
  );
}

function ViewImpactReadout({ result }: { result?: ViewImpactResult }) {
  if (!result) {
    return <div className="text-[10px] text-[#7d8a96]">주변 건물 컨텍스트를 불러오면 자동으로 계산됩니다.</div>;
  }
  if (!result.supported) {
    return <div className="text-[10px] text-[#7d8a96]">분석 가능한 주변 건물 데이터가 없습니다.</div>;
  }
  const ratio = Math.max(0, Math.min(100, result.visibleRatioPct));
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-[#8f9ca7]">{viewImpactLabel(result)}</span>
        <strong className="tabular-nums">{ratio.toFixed(0)}%</strong>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#26313a]">
        <div className="h-full rounded-full bg-[var(--secondary)]" style={{ width: `${ratio}%` }} />
      </div>
      <div className="text-[9px] text-[#71808c]">가시 샘플 {result.visibleSamples} / {result.totalSamples}</div>
    </div>
  );
}

function NumericControl({
  label,
  value,
  min,
  max,
  suffix,
  onValue,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  onValue: (value: number) => void;
}) {
  return (
    <label className="grid gap-1.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-[#8f9ca7]">{label}</span>
        <strong className="tabular-nums">{Math.round(value * 10) / 10}{suffix}</strong>
      </div>
      <Slider value={[value]} min={min} max={max} step={label === "층수" ? 1 : 0.5} onValueChange={(next) => onValue(next[0] ?? value)} />
    </label>
  );
}
