"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Clock3, Copy, MapPin, Search, Sparkles, ThermometerSun } from "lucide-react";
import { PlaySafeMap } from "@/components/playsafe/playsafe-map";
import { PlaySafeVWorldMap } from "@/components/playsafe/playsafe-vworld-map";
import { Slider } from "@/components/ui/slider";
import { timeFromMinutes } from "@/lib/solar/sun";
import type { GeoPoint } from "@/src/types";
import type { PlaySafeSnapshot } from "@/src/playsafe";
import { registerPlaySafeTools } from "@/src/playsafe-webmcp";

type SearchResult = {
  id: string;
  title: string;
  address: string;
  point: GeoPoint;
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
  const [vworldIssue, setVworldIssue] = useState<string>();
  const snapshotRef = useRef(snapshot);
  const selectedRef = useRef(selectedPlaceId);
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
      selectPlace: setSelectedPlaceId,
    });
    return registration.dispose;
  }, []);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setMessage(undefined);
    try {
      const response = await fetch("/api/vworld/search?q=" + encodeURIComponent(query.trim()));
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "위치 검색 실패");
      setSearchResults(payload as SearchResult[]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSearching(false);
    }
  }

  function chooseSearchResult(result: SearchResult) {
    setCenter(result.point);
    setCenterLabel(result.address || result.title);
    setQuery(result.title);
    setSearchResults([]);
    setSelectedPlaceId(undefined);
  }

  async function copyAddress(placeId: string, address?: string) {
    if (!address || typeof navigator === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(address);
    setCopiedPlaceId(placeId);
    window.setTimeout(() => setCopiedPlaceId((current) => current === placeId ? undefined : current), 1_500);
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

  return (
    <main className="relative h-dvh overflow-hidden bg-[#0b1116] text-white">
      <section className="absolute inset-0 overflow-hidden">
        {snapshot && !useAnalysisFallback && (
          <PlaySafeVWorldMap
            snapshot={snapshot}
            selectedPlaceId={selectedPlaceId}
            previewAt={previewAt}
            onSelectPlace={setSelectedPlaceId}
            onUnavailable={handleVWorldUnavailable}
          />
        )}

        {snapshot && useAnalysisFallback && (
          <PlaySafeMap
            snapshot={snapshot}
            selectedPlaceId={selectedPlaceId}
            previewAt={previewAt}
            onSelectPlace={setSelectedPlaceId}
          />
        )}

        {!snapshot && (
          <div className="absolute inset-0 grid place-items-center bg-[#0d141b] text-sm text-[#8f9ca7]">
            {loading ? "주변 놀이터와 열환경을 분석하는 중…" : "PlaySafe 데이터를 불러오지 못했습니다."}
          </div>
        )}

        <header className="pointer-events-none absolute left-4 right-4 top-4 z-30 flex items-start justify-between gap-3 max-md:left-2 max-md:right-2 max-md:top-2">
          <div className="pointer-events-auto min-w-0 rounded-2xl bg-[#081116]/78 px-3 py-2.5 shadow-lg backdrop-blur-xl">
            <div className="flex items-center gap-2">
              <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-[#53d6c7] text-lg text-[#071c19]">☀</div>
              <div className="min-w-0">
                <strong className="block text-[15px] tracking-[-0.03em]">PlaySafe</strong>
                <span className="block max-w-[300px] truncate text-[11px] text-[#8d9aa3]">{centerLabel}</span>
              </div>
            </div>
          </div>

          {snapshot && (
            <div className="pointer-events-auto rounded-2xl bg-[#081116]/78 px-3 py-2.5 text-right shadow-lg backdrop-blur-xl">
              <div className="text-[12px] font-semibold text-white">
                체감 {snapshot.weather.apparentTemperatureC.toFixed(1)}°C
                <span className="mx-2 text-[#53616a]">·</span>
                UV {snapshot.weather.uvIndex.toFixed(1)}
              </div>
              <div className="mt-0.5 text-[11px] text-[#7d8992]">
                {useAnalysisFallback ? "경량 지도 fallback" : "실시간 3D 열환경"}
              </div>
            </div>
          )}
        </header>

        <aside className="absolute bottom-[52px] left-4 top-[82px] z-20 w-[392px] overflow-y-auto rounded-[30px] bg-[#091218]/94 shadow-[0_24px_80px_rgba(0,0,0,.42)] backdrop-blur-2xl max-md:bottom-[52px] max-md:left-2 max-md:right-2 max-md:top-auto max-md:max-h-[68dvh] max-md:w-auto">
          <div className="p-5 max-md:p-4">
            <form onSubmit={search} className="flex items-center gap-2 rounded-2xl bg-white/[0.055] px-3 py-2.5">
              <Search className="size-4 shrink-0 text-[#6f7f89]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="동네, 공원, 주소 검색"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-[#61707a]"
              />
              <button disabled={searching} className="text-[12px] font-semibold text-[#69ddd0]">
                {searching ? "검색 중" : "검색"}
              </button>
            </form>

            {searchResults.length > 0 && (
              <div className="mt-2 overflow-hidden rounded-2xl bg-[#101a21]">
                {searchResults.slice(0, 5).map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    onClick={() => chooseSearchResult(result)}
                    className="block w-full px-3 py-3 text-left hover:bg-white/[0.045]"
                  >
                    <strong className="block truncate text-[13px]">{result.title}</strong>
                    <span className="mt-0.5 block truncate text-[11px] leading-5 text-[#7e8c95]">{result.address}</span>
                  </button>
                ))}
              </div>
            )}

            {selected && snapshot && (
              <>
                <section className="pt-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#72e2d3]">
                        {selectedIsRecommended && <Sparkles className="size-3.5" />}
                        {selectedIsRecommended ? "지금 추천" : `${selectedRank + 1}번째 후보`}
                      </div>
                      <h1 className="mt-1.5 break-keep text-[24px] font-black leading-[1.18] tracking-[-0.035em]">
                        {selected.place.name}
                      </h1>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={"text-[36px] font-black leading-none tabular-nums " + fitTone(selected.fitScore)}>
                        {selected.fitScore.toFixed(0)}
                      </div>
                      <div className="mt-1 text-[11px] font-medium text-[#77848d]">활동 적합도</div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-start gap-2 text-[12px] leading-5 text-[#a5b0b7]">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-[#6e7e87]" />
                    <span className="min-w-0 flex-1">{selected.place.address || "주소 정보를 확인하는 중입니다."}</span>
                    {selected.place.address && (
                      <button
                        type="button"
                        onClick={() => void copyAddress(selected.place.id, selected.place.address)}
                        className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[#72e2d3]"
                      >
                        <Copy className="size-3.5" />
                        {copiedPlaceId === selected.place.id ? "복사됨" : "주소 복사"}
                      </button>
                    )}
                  </div>

                  <div className="mt-5 grid grid-cols-3 gap-3">
                    <div>
                      <div className="text-[11px] text-[#70808a]">예상 그늘</div>
                      <div className="mt-1 text-[17px] font-bold tabular-nums">{selected.shadePct.toFixed(0)}%</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[#70808a]">체감온도</div>
                      <div className="mt-1 text-[17px] font-bold tabular-nums">{snapshot.weather.apparentTemperatureC.toFixed(1)}°</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[#70808a]">UV</div>
                      <div className="mt-1 text-[17px] font-bold tabular-nums">{selected.uvIndex.toFixed(1)}</div>
                    </div>
                  </div>

                  <p className="mt-4 text-[12px] leading-5 text-[#89979f]">
                    {selectedIsRecommended
                      ? snapshot.recommendation?.summary
                      : selected.reasons.slice(0, 3).join(" · ")}
                  </p>
                </section>

                <section className="mt-6 bg-white/[0.035] px-4 py-4">
                  <div className="flex items-center gap-4">
                    <label className="min-w-0">
                      <span className="block text-[11px] font-medium text-[#72818a]">아이</span>
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
                      <span className="block text-right text-[11px] font-medium text-[#72818a]">활동시간</span>
                      <div className="mt-1 flex gap-1">
                        {[20, 40, 60].map((value) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setDuration(value)}
                            className={"rounded-lg px-3 py-1.5 text-[12px] font-bold transition " + (
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
                      <summary className="flex cursor-pointer list-none items-center justify-between text-[12px] font-semibold text-[#93a2aa] [&::-webkit-details-marker]:hidden">
                        왜 아이 나이가 필요한가요?
                        <ChevronDown className="size-4 transition group-open:rotate-180" />
                      </summary>
                      <p className="mt-2 text-[12px] leading-5 text-[#75848d]">
                        {ageProfile.rationale}. 나이는 실제 열환경을 바꾸지 않고 같은 장소를 얼마나 보수적으로 평가할지만 조정합니다.
                      </p>
                    </details>
                  )}
                </section>

                <section className="mt-6">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#d5b85f]">
                        <ThermometerSun className="size-3.5" /> 방문 시간
                      </div>
                      <div className="mt-1 text-[24px] font-black tabular-nums">{timeFromMinutes(minutes)} KST</div>
                    </div>
                    <input
                      type="date"
                      value={date}
                      onChange={(event) => setDate(event.target.value)}
                      className="w-[124px] bg-transparent text-right text-[12px] text-[#99a7af] outline-none"
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
                    <div className="mt-2 flex justify-between text-[11px] text-[#64737c]">
                      <span>09:00</span><span>19:00</span>
                    </div>
                  </div>

                  <p className="mt-2 text-[11px] leading-5 text-[#667680]">
                    시간을 움직이면 지도 그림자가 즉시 바뀌고, 손을 떼면 활동 적합도를 다시 계산합니다.
                  </p>
                </section>

                {snapshot.assessments.length > 1 && (
                  <details className="group mt-6">
                    <summary className="flex cursor-pointer list-none items-center justify-between py-2 text-[13px] font-bold [&::-webkit-details-marker]:hidden">
                      다른 장소 {snapshot.assessments.length - 1}곳 비교
                      <ChevronDown className="size-4 text-[#77858e] transition group-open:rotate-180" />
                    </summary>
                    <div className="mt-1">
                      {snapshot.assessments
                        .filter((assessment) => assessment.place.id !== selected.place.id)
                        .map((assessment) => (
                          <button
                            key={assessment.place.id}
                            type="button"
                            onClick={() => setSelectedPlaceId(assessment.place.id)}
                            className="flex w-full items-start gap-3 py-3 text-left hover:bg-white/[0.025]"
                          >
                            <div className="min-w-0 flex-1">
                              <strong className="block truncate text-[13px]">{assessment.place.name}</strong>
                              <span className="mt-0.5 block truncate text-[11px] text-[#74838c]">
                                {assessment.place.address || `${Math.round(assessment.place.distanceM)}m 거리`}
                              </span>
                              <span className="mt-1 block text-[11px] text-[#84939b]">
                                그늘 {assessment.shadePct.toFixed(0)}% · UV {assessment.uvIndex.toFixed(1)} · {Math.round(assessment.place.distanceM)}m
                              </span>
                            </div>
                            <div className={"shrink-0 text-[22px] font-black tabular-nums " + fitTone(assessment.fitScore)}>
                              {assessment.fitScore.toFixed(0)}
                            </div>
                          </button>
                        ))}
                    </div>
                  </details>
                )}

                <details className="group mt-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between py-2 text-[13px] font-bold [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center gap-2"><Clock3 className="size-4 text-[#d5b85f]" /> 시간별 변화</span>
                    <ChevronDown className="size-4 text-[#77858e] transition group-open:rotate-180" />
                  </summary>
                  <div className="mt-2 grid gap-3">
                    {selected.timeline.map((point) => (
                      <div key={point.localDateTime} className="grid grid-cols-[44px_1fr_32px_50px] items-center gap-2 text-[11px]">
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
                  <p className="mt-5 text-[11px] leading-5 text-[#d6bd73]">
                    VWorld를 불러오지 못해 경량 지도로 표시하고 있습니다.
                  </p>
                )}

                {message && (
                  <p className="mt-4 text-[12px] leading-5 text-[#efabb4]">{message}</p>
                )}

                <p className="mt-5 text-[11px] leading-5 text-[#5f6f78]">
                  활동 적합도는 체감온도·강수·UV·태양고도·건물/수목 그림자·활동시간을 합친 상대 비교입니다.
                  의료적 안전 판정이나 실제 바닥 표면온도 측정이 아닙니다.
                </p>
              </>
            )}
          </div>
        </aside>

        {loading && snapshot && (
          <div className="pointer-events-none absolute right-4 top-[78px] z-20 rounded-xl bg-[#081116]/80 px-3 py-2 text-[11px] text-[#93a1aa] backdrop-blur-xl max-md:right-2">
            조건을 다시 계산하는 중…
          </div>
        )}
      </section>
    </main>
  );
}
