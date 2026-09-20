"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Clock3,
  Copy,
  Footprints,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  Search,
  Sparkles,
  ThermometerSun,
} from "lucide-react";
import { PlaySafeMap } from "@/components/playsafe/playsafe-map";
import { PlaySafeVWorldMap } from "@/components/playsafe/playsafe-vworld-map";
import { Slider } from "@/components/ui/slider";
import { timeFromMinutes } from "@/lib/solar/sun";
import type { GeoPoint } from "@/src/types";
import type {
  PlaySafeMapViewAction,
  PlaySafeSnapshot,
  PlaySafeWalkingRoute,
} from "@/src/playsafe";
import { registerPlaySafeTools } from "@/src/playsafe-webmcp";

type SearchResult = {
  id: string;
  title: string;
  address: string;
  point: GeoPoint;
  kind?: "place" | "road" | "parcel" | "osm";
};

function kstNowParts() {
  const shifted = new Date(Date.now() + 9 * 60 * 60_000);
  return {
    date: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

function defaultMinutes() {
  const now = kstNowParts().minutes;
  if (now >= 9 * 60 && now <= 18 * 60) return Math.round(now / 15) * 15;
  return 15 * 60;
}

function fitTone(score: number) {
  if (score >= 75) return "text-[#53d6c7]";
  if (score >= 58) return "text-[#9bd4a3]";
  if (score >= 38) return "text-[#f2c45d]";
  return "text-[#ef8795]";
}

export function PlaySafeClient({ vworldEnabled }: { vworldEnabled: boolean }) {
  const initial = useMemo(() => kstNowParts(), []);
  const [center, setCenter] = useState<GeoPoint>({ lon: 127.11052, lat: 37.39483 });
  const [centerLabel, setCenterLabel] = useState("판교역 인근");
  const [query, setQuery] = useState("판교역");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [childAge, setChildAge] = useState(6);
  const [duration, setDuration] = useState(40);
  const [date, setDate] = useState(initial.date);
  const [minutes, setMinutes] = useState(defaultMinutes);
  const [committedMinutes, setCommittedMinutes] = useState(defaultMinutes);
  const [snapshot, setSnapshot] = useState<PlaySafeSnapshot>();
  const [selectedPlaceId, setSelectedPlaceId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>();
  const [copiedPlaceId, setCopiedPlaceId] = useState<string>();
  const [viewAction, setViewAction] = useState<PlaySafeMapViewAction>();
  const [walkingRoute, setWalkingRoute] = useState<PlaySafeWalkingRoute>();
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeMessage, setRouteMessage] = useState<string>();
  const [vworldIssue, setVworldIssue] = useState<string>();
  const snapshotRef = useRef(snapshot);
  const selectedRef = useRef(selectedPlaceId);
  const searchRequestRef = useRef(0);
  snapshotRef.current = snapshot;
  selectedRef.current = selectedPlaceId;

  const analysisAt = `${date}T${timeFromMinutes(committedMinutes)}`;
  const previewAt = `${date}T${timeFromMinutes(minutes)}`;

  const handleVWorldUnavailable = useCallback((reason: string) => {
    setVworldIssue(reason);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      lon: String(center.lon),
      lat: String(center.lat),
      age: String(childAge),
      duration: String(duration),
      at: analysisAt,
    });
    setLoading(true);
    setMessage(undefined);

    void fetch(`/api/playsafe/snapshot?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.detail || payload?.error || "PlaySafe 분석 실패");
        return payload as PlaySafeSnapshot;
      })
      .then((next) => {
        setSnapshot(next);
        setSelectedPlaceId((current) => {
          if (current && next.assessments.some((item) => item.place.id === current)) return current;
          return next.recommendation?.placeId ?? next.assessments[0]?.place.id;
        });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [analysisAt, center.lat, center.lon, childAge, duration]);

  useEffect(() => {
    const registration = registerPlaySafeTools({
      getSnapshot: () => snapshotRef.current,
      getSelectedPlaceId: () => selectedRef.current,
      selectPlace,
    });
    return registration.dispose;
  }, []);

  async function loadSearchResults(
    searchQuery: string,
    signal?: AbortSignal,
    broad = false,
  ): Promise<SearchResult[]> {
    const requestId = ++searchRequestRef.current;
    const response = await fetch(
      "/api/vworld/search?q="
        + encodeURIComponent(searchQuery.trim())
        + "&broad="
        + (broad ? "1" : "0"),
      signal ? { signal } : undefined,
    );
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || "위치 검색 실패");
    if (requestId !== searchRequestRef.current) return [];
    return payload as SearchResult[];
  }

  useEffect(() => {
    const searchQuery = query.trim();
    if (!searchOpen || searchQuery.length < 2) {
      if (searchQuery.length < 2) setSearchResults([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      setMessage(undefined);
      void loadSearchResults(searchQuery, controller.signal)
        .then((results) => {
          if (!controller.signal.aborted) setSearchResults(results);
        })
        .catch((error) => {
          if (!controller.signal.aborted && error?.name !== "AbortError") {
            setMessage(error instanceof Error ? error.message : String(error));
            setSearchResults([]);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, searchOpen]);

  async function search(event: FormEvent) {
    event.preventDefault();
    const searchQuery = query.trim();
    if (searchQuery.length < 2) return;
    setSearchOpen(true);
    setSearching(true);
    setMessage(undefined);
    try {
      const results = await loadSearchResults(searchQuery, undefined, true);
      setSearchResults(results);
      if (results.length === 1) chooseSearchResult(results[0]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  function chooseSearchResult(result: SearchResult) {
    setCenter(result.point);
    setCenterLabel(result.address || result.title);
    setQuery(result.title);
    setSearchResults([]);
    setSearchOpen(false);
    setSelectedPlaceId(undefined);
    triggerMapView("search");
  }

  function searchKindLabel(kind?: SearchResult["kind"]) {
    if (kind === "place") return "장소";
    if (kind === "road") return "도로명";
    if (kind === "parcel") return "지번";
    if (kind === "osm") return "보조";
    return "위치";
  }

  async function copyAddress(placeId: string, address?: string) {
    if (!address || typeof navigator === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(address);
    setCopiedPlaceId(placeId);
    window.setTimeout(() => setCopiedPlaceId((current) => current === placeId ? undefined : current), 1_500);
  }

  function triggerMapView(type: PlaySafeMapViewAction["type"]) {
    setViewAction((current) => ({
      type,
      nonce: (current?.nonce ?? 0) + 1,
    }));
  }

  function selectPlace(placeId: string) {
    setSelectedPlaceId(placeId);
    setViewAction(undefined);
  }

  const selected = snapshot?.assessments.find((item) => item.place.id === selectedPlaceId)
    ?? snapshot?.assessments[0];
  const selectedRank = selected && snapshot
    ? snapshot.assessments.findIndex((item) => item.place.id === selected.place.id)
    : -1;
  const ageProfile = selected?.ageProfile ?? snapshot?.assessments[0]?.ageProfile;
  const useAnalysisFallback = !vworldEnabled || Boolean(vworldIssue);
  const selectedIsRecommended = Boolean(
    selected && snapshot?.recommendation?.placeId === selected.place.id,
  );

  useEffect(() => {
    if (!selected) {
      setWalkingRoute(undefined);
      setRouteMessage(undefined);
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      fromLon: String(center.lon),
      fromLat: String(center.lat),
      toLon: String(selected.place.point.lon),
      toLat: String(selected.place.point.lat),
    });

    setWalkingRoute(undefined);
    setRouteLoading(true);
    setRouteMessage(undefined);

    void fetch("/api/playsafe/route?" + params, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.detail || payload?.error || "보행 경로 분석 실패");
        return payload as PlaySafeWalkingRoute;
      })
      .then((next) => {
        if (!controller.signal.aborted) setWalkingRoute(next);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setWalkingRoute(undefined);
          setRouteMessage(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setRouteLoading(false);
      });

    return () => controller.abort();
  }, [
    center.lat,
    center.lon,
    selected?.place.id,
    selected?.place.point.lat,
    selected?.place.point.lon,
  ]);

  return (
    <main className="relative h-dvh overflow-hidden bg-[#0b1116] text-white">
      <section className="absolute inset-0 overflow-hidden">
        {snapshot && !useAnalysisFallback && (
          <PlaySafeVWorldMap
            snapshot={snapshot}
            selectedPlaceId={selectedPlaceId}
            previewAt={previewAt}
            viewAction={viewAction}
            walkingRoute={walkingRoute}
            onSelectPlace={selectPlace}
            onUnavailable={handleVWorldUnavailable}
          />
        )}

        {snapshot && useAnalysisFallback && (
          <PlaySafeMap
            snapshot={snapshot}
            selectedPlaceId={selectedPlaceId}
            previewAt={previewAt}
            viewAction={viewAction}
            walkingRoute={walkingRoute}
            onSelectPlace={selectPlace}
          />
        )}

        {!snapshot && (
          <div className="absolute inset-0 grid place-items-center bg-[#0d141b] text-sm text-[#8f9ca7]">
            {loading ? "주변 놀이터와 열환경을 분석하는 중…" : "PlaySafe 데이터를 불러오지 못했습니다."}
          </div>
        )}

        <header className="pointer-events-none absolute left-5 right-5 top-5 z-30 flex items-start justify-between gap-4 max-[480px]:left-3 max-[480px]:right-3 max-[480px]:top-3">
          <div className="pointer-events-auto flex items-center gap-3">
            <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#53d6c7] text-xl text-[#071c19] shadow-[0_8px_24px_rgba(0,0,0,.26)]">☀</div>
            <div className="min-w-0 [text-shadow:0_2px_10px_rgba(0,0,0,.72)]">
              <strong className="block text-[18px] font-bold leading-[1.25] tracking-[-0.025em] text-white">PlaySafe</strong>
              <span className="mt-1 block text-[12px] leading-[1.5] tracking-[0.01em] text-white/70">아이 야외활동 지도</span>
            </div>
          </div>

          {snapshot && (
            <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-white/[0.06] bg-[#081116]/72 px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,.22)] backdrop-blur-xl">
              <ThermometerSun className="size-4 text-[#f0c45c]" />
              <span className="text-[13px] font-bold leading-none tabular-nums text-white">
                {snapshot.weather.apparentTemperatureC.toFixed(1)}°
              </span>
              <span className="h-4 w-px bg-white/10" />
              <span className="text-[12px] leading-none text-white/60">UV</span>
              <span className="text-[13px] font-bold leading-none tabular-nums text-white">
                {snapshot.weather.uvIndex.toFixed(1)}
              </span>
            </div>
          )}
        </header>

        {snapshot && (
          <div
            role="group"
            aria-label="지도 보기 조작"
            className="pointer-events-auto absolute right-5 top-[88px] z-30 overflow-visible rounded-2xl border border-white/[0.06] bg-[#081116]/78 p-1 shadow-[0_10px_30px_rgba(0,0,0,.26)] backdrop-blur-xl max-[480px]:right-3 max-[480px]:top-[82px]"
          >
            <button
              type="button"
              aria-label="탑뷰"
              onClick={() => triggerMapView("top")}
              className="group relative grid size-11 place-items-center rounded-xl text-[#72e2d3] transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#72e2d3]/60"
            >
              <MapIcon className="size-[18px]" />
              <span className="pointer-events-none absolute right-[calc(100%+8px)] whitespace-nowrap rounded-lg bg-[#071015]/92 px-2.5 py-1.5 text-[12px] font-medium leading-none text-white opacity-0 shadow-lg transition group-hover:opacity-100 group-focus-visible:opacity-100">
                탑뷰
              </span>
            </button>
            <div className="mx-2 h-px bg-white/[0.08]" />
            <button
              type="button"
              aria-label="검색 위치로 이동"
              onClick={() => triggerMapView("search")}
              className="group relative grid size-11 place-items-center rounded-xl text-[#d9bd63] transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d9bd63]/60"
            >
              <LocateFixed className="size-[18px]" />
              <span className="pointer-events-none absolute right-[calc(100%+8px)] whitespace-nowrap rounded-lg bg-[#071015]/92 px-2.5 py-1.5 text-[12px] font-medium leading-none text-white opacity-0 shadow-lg transition group-hover:opacity-100 group-focus-visible:opacity-100">
                검색 위치
              </span>
            </button>
            <div className="mx-2 h-px bg-white/[0.08]" />
            <button
              type="button"
              aria-label="보행 경로 보기"
              disabled={!walkingRoute || routeLoading}
              onClick={() => triggerMapView("route")}
              className="group relative grid size-11 place-items-center rounded-xl text-[#9bd4a3] transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9bd4a3]/60 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Footprints className="size-[18px]" />
              <span className="pointer-events-none absolute right-[calc(100%+8px)] whitespace-nowrap rounded-lg bg-[#071015]/92 px-2.5 py-1.5 text-[12px] font-medium leading-none text-white opacity-0 shadow-lg transition group-hover:opacity-100 group-focus-visible:opacity-100">
                가는 길
              </span>
            </button>
          </div>
        )}

        <aside className="absolute left-4 top-[82px] z-20 w-[400px] max-w-[calc(100vw-32px)] max-h-[calc(100dvh-98px)] overflow-visible rounded-[28px] bg-[#091218]/94 shadow-[0_24px_80px_rgba(0,0,0,.42)] backdrop-blur-2xl max-[480px]:left-2 max-[480px]:w-[calc(100vw-16px)]">
          <div
            data-playsafe-panel-scroll
            className="box-border w-full overflow-x-hidden overflow-y-auto overscroll-contain"
            style={{ maxHeight: "calc(100dvh - 98px)" }}
          >
            <div data-playsafe-safe-area style={{ padding: "20px 24px 32px", lineHeight: 1.5 }}>
              <div
                className="relative"
                onFocus={() => setSearchOpen(true)}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setSearchOpen(false);
                  }
                }}
              >
                <form
                  onSubmit={search}
                  role="search"
                  className="flex min-h-12 items-center gap-3 rounded-2xl bg-white/[0.055] px-4 py-3"
                >
                  <Search className="size-[18px] shrink-0 text-[#7a8992]" />
                  <input
                    value={query}
                    onFocus={() => setSearchOpen(true)}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setSearchOpen(true);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setSearchOpen(false);
                        event.currentTarget.blur();
                      }
                    }}
                    placeholder="아파트·건물·동네·주소 검색"
                    aria-label="위치 검색"
                    aria-autocomplete="list"
                    aria-controls="playsafe-search-results"
                    aria-expanded={searchOpen}
                    className="min-w-0 flex-1 bg-transparent text-[15px] font-medium leading-6 text-white outline-none placeholder:text-[#65747d]"
                  />
                  <button
                    disabled={searching || query.trim().length < 2}
                    className="shrink-0 text-[14px] font-bold leading-5 text-[#69ddd0] disabled:opacity-40"
                  >
                    {searching ? "검색 중" : "검색"}
                  </button>
                </form>

                {searchOpen && query.trim().length >= 2 && (
                  <div
                    id="playsafe-search-results"
                    role="listbox"
                    className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-2xl border border-white/[0.07] bg-[#101a21]/98 shadow-[0_18px_48px_rgba(0,0,0,.42)] backdrop-blur-xl"
                  >
                    {searching && searchResults.length === 0 && (
                      <div className="px-4 py-4 text-[13px] leading-5 text-[#8b99a2]">
                        장소와 주소를 함께 찾는 중…
                      </div>
                    )}

                    {!searching && searchResults.length === 0 && (
                      <div className="px-4 py-4">
                        <strong className="block text-[13px] font-bold leading-5 text-[#dfe7eb]">
                          빠른 후보가 없습니다
                        </strong>
                        <span className="mt-1 block text-[12px] leading-5 text-[#7e8c95]">
                          검색 버튼을 누르면 단지명·건물명까지 넓게 찾아봅니다.
                        </span>
                      </div>
                    )}

                    {searchResults.slice(0, 6).map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        role="option"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => chooseSearchResult(result)}
                        className="flex w-full items-start gap-3 border-b border-white/[0.05] px-4 py-3.5 text-left last:border-b-0 hover:bg-white/[0.05] focus-visible:bg-white/[0.07] focus-visible:outline-none"
                      >
                        <span className="mt-0.5 shrink-0 rounded-md bg-white/[0.06] px-2 py-1 text-[12px] font-bold leading-4 text-[#8fa0aa]">
                          {searchKindLabel(result.kind)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <strong className="block truncate text-[14px] font-bold leading-5 text-white">
                            {result.title}
                          </strong>
                          <span className="mt-1 block truncate text-[13px] leading-5 text-[#82919a]">
                            {result.address}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

            {snapshot && snapshot.assessments.length > 0 && (
              <section className="mt-5">
                <div className="flex items-center justify-between">
                  <strong className="text-[14px] font-bold leading-6 text-[#dfe7eb]">추천 놀이터·공원 TOP 3</strong>
                  <span className="max-w-[180px] truncate text-[12px] leading-5 text-[#687780]">{centerLabel}</span>
                </div>
                <div className="mt-2">
                  {snapshot.assessments.slice(0, 3).map((assessment, index) => (
                    <button
                      key={assessment.place.id}
                      type="button"
                      onClick={() => selectPlace(assessment.place.id)}
                      className={"flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left transition " + (
                        selected?.place.id === assessment.place.id
                          ? "bg-white/[0.055]"
                          : "hover:bg-white/[0.03]"
                      )}
                    >
                      <span className="w-5 shrink-0 text-[12px] font-black text-[#6f7f88]">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <strong className="block truncate text-[14px] leading-6">{assessment.place.name}</strong>
                        <span className="mt-1.5 block truncate text-[13px] leading-5 text-[#7f8d96]">
                          {Math.round(assessment.place.distanceM)}m · 그늘 {assessment.shadePct.toFixed(0)}%
                          {assessment.place.address ? " · " + assessment.place.address : ""}
                        </span>
                      </div>
                      <span className={"shrink-0 text-[18px] font-black tabular-nums " + fitTone(assessment.fitScore)}>
                        {assessment.fitScore.toFixed(0)}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {snapshot?.publicContext && (
              <details className="group mt-5 border-t border-white/[0.06] pt-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-2 text-left [&::-webkit-details-marker]:hidden">
                  <div className="min-w-0">
                    <strong className="block text-[14px] font-bold leading-6 text-[#dfe7eb]">주변 어린이 안전·편의</strong>
                    <span className="mt-1.5 block text-[13px] leading-5 text-[#7f8d96]">
                      보호구역 {snapshot.publicContext.summary.childZones}곳 · CCTV {snapshot.publicContext.summary.childZoneCctvCount}대 · 어린이 사고다발 {snapshot.publicContext.summary.childAccidentHotspots}곳
                    </span>
                  </div>
                  <ChevronDown className="size-4 shrink-0 text-[#77858e] transition group-open:rotate-180" />
                </summary>

                <div className="mt-3 space-y-4">
                  {snapshot.publicContext.childZones.length > 0 && (
                    <div>
                      <div className="text-[12px] font-bold leading-5 text-[#d5b85f]">어린이보호구역</div>
                      <div className="mt-1 divide-y divide-white/[0.05]">
                        {snapshot.publicContext.childZones.slice(0, 3).map((zone) => (
                          <div key={zone.id} className="py-2">
                            <div className="flex items-baseline justify-between gap-3">
                              <strong className="min-w-0 truncate text-[12px] leading-5">{zone.name || zone.facilityType}</strong>
                              <span className="shrink-0 text-[12px] leading-5 text-[#83919a]">{zone.distanceM}m</span>
                            </div>
                            <div className="mt-1 truncate text-[12px] leading-5 text-[#697982]">
                              {zone.facilityType || "보호구역"} · CCTV {zone.cctvCount}대{zone.roadWidth ? " · 도로폭 " + zone.roadWidth : ""}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {snapshot.publicContext.childAccidentHotspots.length > 0 && (
                    <div>
                      <div className="text-[12px] font-bold leading-5 text-[#ef9d8b]">어린이 사고다발 참고지점</div>
                      <div className="mt-1 divide-y divide-white/[0.05]">
                        {snapshot.publicContext.childAccidentHotspots.slice(0, 3).map((spot) => (
                          <div key={spot.id} className="py-2">
                            <div className="flex items-baseline justify-between gap-3">
                              <strong className="min-w-0 truncate text-[12px] leading-5">{spot.name}</strong>
                              <span className="shrink-0 text-[12px] leading-5 text-[#83919a]">{spot.distanceM}m</span>
                            </div>
                            <div className="mt-1 truncate text-[12px] leading-5 text-[#697982]">
                              {spot.year}년 {spot.accidentType} · 사고 {spot.occurrences}건 · 사상 {spot.casualties}명
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="text-[12px] font-bold leading-5 text-[#72e2d3]">아이와 이용할 주변 시설</div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                      <div>
                        <div className="text-[17px] font-black tabular-nums">{snapshot.publicContext.summary.parks}</div>
                        <div className="text-[12px] leading-5 text-[#71808a]">공원</div>
                      </div>
                      <div>
                        <div className="text-[17px] font-black tabular-nums">{snapshot.publicContext.summary.childCenters}</div>
                        <div className="text-[12px] leading-5 text-[#71808a]">아동센터</div>
                      </div>
                      <div>
                        <div className="text-[17px] font-black tabular-nums">{snapshot.publicContext.summary.childFriendlyToilets}</div>
                        <div className="text-[12px] leading-5 text-[#71808a]">어린이 편의 화장실</div>
                      </div>
                    </div>
                  </div>

                  {snapshot.publicContext.toilets[0] && (
                    <div className="text-[12px] leading-5 text-[#80909a]">
                      가까운 어린이 편의 화장실 · {snapshot.publicContext.toilets[0].name} · {snapshot.publicContext.toilets[0].distanceM}m
                    </div>
                  )}

                  <p className="text-[12px] leading-5 text-[#586871]">
                    공공데이터포털 전국 표준데이터 스냅샷을 검색 위치 기준으로 잘라 표시합니다. 보호구역 정보는 실제 보행 경로 안전도 판정이 아니라 주변 안전 인프라 참고 정보입니다.
                  </p>
                </div>
              </details>
            )}

            {selected && snapshot && (
              <>
                <section className="mt-5 border-t border-white/[0.06] pt-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#72e2d3]">
                        {selectedIsRecommended && <Sparkles className="size-3.5" />}
                        {selectedIsRecommended ? "선택한 장소" : `${selectedRank + 1}번째 후보`}
                      </div>
                      <h1 className="mt-1.5 break-keep text-[16px] font-bold leading-[1.3] tracking-[-0.02em]">
                        {selected.place.name}
                      </h1>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={"text-[20px] font-black leading-none tabular-nums " + fitTone(selected.fitScore)}>
                        {selected.fitScore.toFixed(0)}
                      </div>
                      <div className="mt-1 text-[12px] font-medium leading-5 text-[#77848d]">적합도</div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-start gap-2.5 text-[14px] leading-6 text-[#aab5bb]">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-[#6e7e87]" />
                    <span className="min-w-0 flex-1">{selected.place.address || "주소 정보를 확인하는 중입니다."}</span>
                    {selected.place.address && (
                      <button
                        type="button"
                        onClick={() => void copyAddress(selected.place.id, selected.place.address)}
                        className="flex shrink-0 items-center gap-1 text-[12px] font-semibold leading-5 text-[#72e2d3]"
                      >
                        <Copy className="size-3.5" />
                        {copiedPlaceId === selected.place.id ? "복사됨" : "주소 복사"}
                      </button>
                    )}
                  </div>

                  <div className="mt-5 grid grid-cols-3 gap-3">
                    <div>
                      <div className="text-[13px] leading-5 text-[#7b8a93]">예상 그늘</div>
                      <div className="mt-1 text-[17px] font-bold tabular-nums">{selected.shadePct.toFixed(0)}%</div>
                    </div>
                    <div>
                      <div className="text-[13px] leading-5 text-[#7b8a93]">체감온도</div>
                      <div className="mt-1 text-[17px] font-bold tabular-nums">{snapshot.weather.apparentTemperatureC.toFixed(1)}°</div>
                    </div>
                    <div>
                      <div className="text-[13px] leading-5 text-[#7b8a93]">UV</div>
                      <div className="mt-1 text-[17px] font-bold tabular-nums">{selected.uvIndex.toFixed(1)}</div>
                    </div>
                  </div>

                  <p className="mt-5 text-[14px] leading-6 text-[#9aa7ae]">
                    {selectedIsRecommended
                      ? snapshot.recommendation?.summary
                      : selected.reasons.slice(0, 3).join(" · ")}
                  </p>
                </section>

                <section className="mt-5 border-t border-white/[0.06] pt-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[14px] font-bold leading-6 text-[#dfe7eb]">
                        <Footprints className="size-4 text-[#9bd4a3]" />
                        가는 길
                      </div>
                      {routeLoading && (
                        <p className="mt-1 text-[13px] leading-5 text-[#7f8d96]">
                          보행 경로와 주변 안전 정보를 계산하는 중…
                        </p>
                      )}
                      {!routeLoading && walkingRoute && (
                        <p className="mt-1 text-[14px] leading-6 text-[#aab5bb]">
                          도보 <strong className="font-bold text-white">{walkingRoute.durationMinutes}분</strong>
                          <span className="mx-2 text-white/20">·</span>
                          {walkingRoute.distanceM >= 1000
                            ? (walkingRoute.distanceM / 1000).toFixed(1) + "km"
                            : walkingRoute.distanceM + "m"}
                        </p>
                      )}
                    </div>
                    {walkingRoute && !routeLoading && (
                      <button
                        type="button"
                        onClick={() => triggerMapView("route")}
                        className="shrink-0 text-[12px] font-bold leading-5 text-[#72e2d3] hover:text-[#9af0e6]"
                      >
                        지도에서 보기
                      </button>
                    )}
                  </div>

                  {routeMessage && (
                    <p className="mt-3 text-[13px] leading-6 text-[#d6bd73]">{routeMessage}</p>
                  )}

                  {walkingRoute && (
                    <>
                      <div className="mt-4 grid grid-cols-3 gap-4">
                        <div>
                          <div className="text-[12px] leading-5 text-[#71818a]">어린이보호구역</div>
                          <div className="mt-1 text-[17px] font-bold tabular-nums">
                            {walkingRoute.summary.childZones}곳
                          </div>
                          <div className="text-[12px] leading-5 text-[#7f8d96]">
                            CCTV {walkingRoute.summary.childZoneCctvCount}대
                          </div>
                        </div>
                        <div>
                          <div className="text-[12px] leading-5 text-[#71818a]">사고다발 참고</div>
                          <div className="mt-1 text-[17px] font-bold tabular-nums">
                            {walkingRoute.summary.childAccidentHotspots}곳
                          </div>
                          <div className="text-[12px] leading-5 text-[#7f8d96]">
                            경로 150m 이내
                          </div>
                        </div>
                        <div>
                          <div className="text-[12px] leading-5 text-[#71818a]">어린이 편의 화장실</div>
                          <div className="mt-1 text-[17px] font-bold tabular-nums">
                            {walkingRoute.summary.childFriendlyToilets}곳
                          </div>
                          <div className="text-[12px] leading-5 text-[#7f8d96]">
                            경로 120m 이내
                          </div>
                        </div>
                      </div>

                      {(walkingRoute.childZones.length > 0
                        || walkingRoute.childAccidentHotspots.length > 0
                        || walkingRoute.toilets.length > 0) && (
                        <details className="group mt-4">
                          <summary className="flex cursor-pointer list-none items-center justify-between py-1 text-[13px] font-semibold leading-5 text-[#93a2aa] [&::-webkit-details-marker]:hidden">
                            경로 주변 상세 보기
                            <ChevronDown className="size-4 transition group-open:rotate-180" />
                          </summary>
                          <div className="mt-2 space-y-3">
                            {walkingRoute.childZones.slice(0, 4).map((zone) => (
                              <div key={zone.id} className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <strong className="block truncate text-[12px] leading-5 text-[#d9bd63]">
                                    {zone.name || zone.facilityType || "어린이보호구역"}
                                  </strong>
                                  <span className="block truncate text-[12px] leading-5 text-[#71818a]">
                                    {zone.facilityType || "보호구역"} · CCTV {zone.cctvCount}대
                                  </span>
                                </div>
                                <span className="shrink-0 text-[12px] leading-5 text-[#7f8d96]">
                                  경로 {zone.distanceToRouteM}m
                                </span>
                              </div>
                            ))}

                            {walkingRoute.childAccidentHotspots.slice(0, 3).map((spot) => (
                              <div key={spot.id} className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <strong className="block truncate text-[12px] leading-5 text-[#ef9d8b]">
                                    {spot.name}
                                  </strong>
                                  <span className="block truncate text-[12px] leading-5 text-[#71818a]">
                                    {spot.year} {spot.accidentType} · 사고 {spot.occurrences}건
                                  </span>
                                </div>
                                <span className="shrink-0 text-[12px] leading-5 text-[#7f8d96]">
                                  경로 {spot.distanceToRouteM}m
                                </span>
                              </div>
                            ))}

                            {walkingRoute.toilets.slice(0, 2).map((toilet) => (
                              <div key={toilet.id} className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <strong className="block truncate text-[12px] leading-5 text-[#9fb3ff]">
                                    {toilet.name}
                                  </strong>
                                  <span className="block truncate text-[12px] leading-5 text-[#71818a]">
                                    {toilet.diaperChange ? "기저귀교환대 정보 있음" : "어린이용 위생시설"}
                                  </span>
                                </div>
                                <span className="shrink-0 text-[12px] leading-5 text-[#7f8d96]">
                                  경로 {toilet.distanceToRouteM}m
                                </span>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}

                      {walkingRoute.heatMitigation.status === "unavailable-no-key" && (
                        <p className="mt-4 text-[12px] leading-5 text-[#697982]">
                          폭염저감시설(그늘막·쉼터)은 공식 데이터 서비스키 미연결로 아직 경로 분석에 포함하지 않았습니다.
                        </p>
                      )}

                      <p className="mt-3 text-[12px] leading-5 text-[#5f6f78]">
                        보행선과 공공데이터의 근접도를 비교한 참고 정보이며 실제 보행 안전을 보장하는 판정은 아닙니다.
                      </p>
                    </>
                  )}
                </section>

                <section className="mt-6 bg-white/[0.035] px-4 py-4">
                  <div className="flex items-center gap-4">
                    <label className="min-w-0">
                      <span className="block text-[12px] font-medium leading-5 text-[#72818a]">아이</span>
                      <select
                        value={childAge}
                        onChange={(event) => setChildAge(Number(event.target.value))}
                        className="mt-1 bg-transparent text-[15px] font-bold text-white outline-none"
                      >
                        {Array.from({ length: 10 }, (_, index) => index + 3).map((age) => (
                          <option key={age} value={age}>{age}세</option>
                        ))}
                      </select>
                    </label>

                    <div className="ml-auto">
                      <span className="block text-right text-[12px] font-medium leading-5 text-[#72818a]">활동시간</span>
                      <div className="mt-1 flex gap-1">
                        {[20, 40, 60].map((value) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setDuration(value)}
                            className={"rounded-lg px-3 py-2 text-[13px] font-bold leading-5 transition " + (
                              duration === value ? "bg-[#1c3933] text-[#78e2d5]" : "text-[#86949d] hover:bg-white/5"
                            )}
                          >
                            {value}분
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {ageProfile && (
                    <details className="group mt-3">
                      <summary className="flex cursor-pointer list-none items-center justify-between text-[13px] font-semibold leading-5 text-[#93a2aa] [&::-webkit-details-marker]:hidden">
                        왜 아이 나이가 필요한가요?
                        <ChevronDown className="size-4 transition group-open:rotate-180" />
                      </summary>
                      <p className="mt-2 text-[13px] leading-6 text-[#75848d]">
                        {ageProfile.rationale}. 나이는 실제 열환경을 바꾸지 않고 같은 장소를 얼마나 보수적으로 평가할지만 조정합니다.
                      </p>
                    </details>
                  )}
                </section>

                <section className="mt-6">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-1.5 text-[12px] font-semibold leading-5 text-[#d5b85f]">
                        <ThermometerSun className="size-3.5" /> 방문 시간
                      </div>
                      <div className="mt-1 text-[26px] font-bold leading-[1.25] tabular-nums">{timeFromMinutes(minutes)} KST</div>
                    </div>
                    <input
                      type="date"
                      value={date}
                      onChange={(event) => setDate(event.target.value)}
                      className="w-[132px] bg-transparent text-right text-[13px] leading-5 text-[#99a7af] outline-none"
                    />
                  </div>

                  <div className="mt-4">
                    <Slider
                      value={[minutes]}
                      min={9 * 60}
                      max={19 * 60}
                      step={15}
                      onValueChange={(value) => setMinutes(value[0] ?? minutes)}
                      onValueCommit={(value) => setCommittedMinutes(value[0] ?? minutes)}
                    />
                    <div className="mt-2 flex justify-between text-[12px] leading-5 text-[#64737c]">
                      <span>09:00</span><span>19:00</span>
                    </div>
                  </div>

                  <p className="mt-3 text-[13px] leading-6 text-[#71818a]">
                    시간을 움직이면 지도 그림자가 즉시 바뀌고, 손을 떼면 활동 적합도를 다시 계산합니다.
                  </p>
                </section>

                <details className="group mt-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between py-2 text-[13px] font-bold [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center gap-2"><Clock3 className="size-4 text-[#d5b85f]" /> 시간별 변화</span>
                    <ChevronDown className="size-4 text-[#77858e] transition group-open:rotate-180" />
                  </summary>
                  <div className="mt-2 grid gap-3">
                    {selected.timeline.map((point) => (
                      <div key={point.localDateTime} className="grid grid-cols-[48px_1fr_36px_54px] items-center gap-3 text-[12px] leading-5">
                        <span className="text-[#8d9ba6]">{point.localDateTime.slice(11, 16)}</span>
                        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                          <div className="h-full rounded-full bg-[#53d6c7]" style={{ width: `${Math.max(3, point.fitScore)}%` }} />
                        </div>
                        <strong className="text-right tabular-nums">{point.fitScore.toFixed(0)}</strong>
                        <span className="text-right text-[#697983]">UV {point.uvIndex.toFixed(1)}</span>
                      </div>
                    ))}
                  </div>
                </details>

                {vworldIssue && (
                  <p className="mt-5 text-[12px] leading-5 text-[#d6bd73]">
                    VWorld를 불러오지 못해 경량 지도로 표시하고 있습니다.
                  </p>
                )}

                {message && (
                  <p className="mt-4 text-[13px] leading-6 text-[#efabb4]">{message}</p>
                )}

                <p className="mt-6 text-[13px] leading-6 text-[#697982]">
                  활동 적합도는 체감온도·강수·UV·태양고도·건물/수목 그림자·활동시간을 합친 상대 비교입니다.
                  의료적 안전 판정이나 실제 바닥 표면온도 측정이 아닙니다.
                </p>
              </>
            )}
            </div>
          </div>
        </aside>

        {loading && snapshot && (
          <div className="pointer-events-none absolute right-4 top-[78px] z-20 rounded-xl bg-[#081116]/80 px-3 py-2 text-[12px] leading-5 text-[#93a1aa] backdrop-blur-xl max-[640px]:right-2">
            조건을 다시 계산하는 중…
          </div>
        )}
      </section>
    </main>
  );
}
