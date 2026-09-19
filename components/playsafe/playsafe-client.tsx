"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Clock3, Search, Sparkles, ThermometerSun } from "lucide-react";
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

function scoreBackground(score: number) {
  if (score >= 75) return "bg-[#102620] ring-[#53d6c7]/35";
  if (score >= 58) return "bg-[#17241b] ring-[#9bd4a3]/25";
  if (score >= 38) return "bg-[#2a2416] ring-[#f2c45d]/30";
  return "bg-[#29191d] ring-[#ef8795]/30";
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
  const [webMcpSupported, setWebMcpSupported] = useState(false);
  const [renderer, setRenderer] = useState<"vworld" | "analysis">(vworldEnabled ? "vworld" : "analysis");
  const [vworldIssue, setVworldIssue] = useState<string>();
  const snapshotRef = useRef(snapshot);
  const selectedRef = useRef(selectedPlaceId);
  snapshotRef.current = snapshot;
  selectedRef.current = selectedPlaceId;

  const analysisAt = `${date}T${timeFromMinutes(committedMinutes)}`;

  const handleVWorldUnavailable = useCallback((reason: string) => {
    setVworldIssue(reason);
    setRenderer("analysis");
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
    setWebMcpSupported(registration.supported);
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

  const selected = snapshot?.assessments.find((item) => item.place.id === selectedPlaceId)
    ?? snapshot?.assessments[0];
  const recommended = snapshot?.recommendation
    ? snapshot.assessments.find((item) => item.place.id === snapshot.recommendation?.placeId)
    : undefined;

  return (
    <main className="grid h-dvh grid-rows-[58px_minmax(0,1fr)] overflow-hidden bg-[#0b1116] text-white">
      <header className="flex items-center gap-3 border-b border-white/8 bg-[#0f161d] px-3 md:px-5">
        <div className="grid size-8 place-items-center rounded-xl bg-[#53d6c7] text-lg text-[#071c19]">☀</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <strong className="text-[15px] tracking-[-0.03em]">PlaySafe AI</strong>
            <span className="rounded-full border border-[#53d6c7]/20 bg-[#11231f] px-2 py-0.5 text-[9px] text-[#71dfd2]">
              playground heat intelligence
            </span>
          </div>
          <div className="hidden text-[9px] text-[#8896a1] md:block">아이와 지금 어디에서, 몇 시에 놀지 결정하는 공간 AI</div>
        </div>
        <div className="hidden items-center gap-1 rounded-xl border border-white/8 bg-[#0b1218] p-1 md:flex">
          <button
            type="button"
            disabled={!vworldEnabled}
            onClick={() => vworldEnabled && setRenderer("vworld")}
            className={"rounded-lg px-2.5 py-1.5 text-[9px] font-bold transition " + (renderer === "vworld"
              ? "bg-[#1d2b35] text-[#f2c45d]"
              : "text-[#778690] hover:text-white")}
          >
            VWorld 3D
          </button>
          <button
            type="button"
            onClick={() => setRenderer("analysis")}
            className={"rounded-lg px-2.5 py-1.5 text-[9px] font-bold transition " + (renderer === "analysis"
              ? "bg-[#1d2b35] text-[#53d6c7]"
              : "text-[#778690] hover:text-white")}
          >
            분석 지도
          </button>
        </div>
        {webMcpSupported && (
          <div className="flex items-center gap-1 rounded-lg border border-[#7f9df4]/25 bg-[#171e31] px-2.5 py-1.5 text-[10px] text-[#a7b7ff]">
            <Bot className="size-3.5" /> PlaySafe Tools
          </div>
        )}
        <div className="max-w-[240px] truncate rounded-lg bg-white/[0.045] px-2.5 py-1.5 text-[10px] text-[#a8b3bd]">
          {centerLabel}
        </div>
      </header>

      <section className="relative min-h-0 overflow-hidden">
        {snapshot && vworldEnabled && (
          <div
            className={"absolute inset-0 transition-opacity duration-200 " + (
              renderer === "vworld"
                ? "z-[2] opacity-100"
                : "pointer-events-none z-0 opacity-0"
            )}
            aria-hidden={renderer !== "vworld"}
          >
            <PlaySafeVWorldMap
              snapshot={snapshot}
              selectedPlaceId={selectedPlaceId}
              onSelectPlace={setSelectedPlaceId}
              onUnavailable={handleVWorldUnavailable}
            />
          </div>
        )}

        {snapshot && (
          <div
            className={"absolute inset-0 transition-opacity duration-200 " + (
              renderer === "analysis" || !vworldEnabled
                ? "z-[2] opacity-100"
                : "pointer-events-none z-0 opacity-0"
            )}
            aria-hidden={renderer !== "analysis" && vworldEnabled}
          >
            <PlaySafeMap
              snapshot={snapshot}
              selectedPlaceId={selectedPlaceId}
              onSelectPlace={setSelectedPlaceId}
            />
          </div>
        )}

        {!snapshot && (
          <div className="absolute inset-0 grid place-items-center bg-[#0d141b] text-sm text-[#8f9ca7]">
            {loading ? "주변 놀이터와 열환경을 분석하는 중…" : "PlaySafe 데이터를 불러오지 못했습니다."}
          </div>
        )}

        <aside className="absolute left-3 top-3 z-20 max-h-[calc(100%-104px)] w-[360px] overflow-y-auto rounded-[26px] border border-white/10 bg-[#0d161d]/94 shadow-[0_18px_60px_rgba(0,0,0,.36)] backdrop-blur-xl max-md:bottom-[76px] max-md:left-2 max-md:right-2 max-md:top-auto max-md:max-h-[52dvh] max-md:w-auto">
          <div className="p-4">
            <form onSubmit={search} className="grid grid-cols-[1fr_auto] overflow-hidden rounded-2xl bg-black/20 shadow-inner">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="동네, 공원, 주소 검색"
                className="min-w-0 bg-transparent px-3 py-2.5 text-xs outline-none"
              />
              <button disabled={searching} className="px-3 text-[#53d6c7]">
                <Search className="size-4" />
              </button>
            </form>

            {searchResults.length > 0 && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-white/8 bg-[#0c141a]">
                {searchResults.slice(0, 5).map((result) => (
                  <button
                    key={result.id}
                    onClick={() => chooseSearchResult(result)}
                    className="grid w-full gap-0.5 border-b border-white/6 px-3 py-2 text-left last:border-0 hover:bg-white/5"
                  >
                    <strong className="truncate text-[11px]">{result.title}</strong>
                    <span className="truncate text-[9px] text-[#7f8d98]">{result.address}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="mt-3 rounded-2xl bg-white/[0.03] px-3 py-3">
              <div className="flex items-center gap-2.5">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#102520] text-2xl ring-1 ring-[#53d6c7]/15">🧒</div>
                <div className="min-w-0">
                  <div className="text-[9px] font-bold text-[#6f817d]">아이</div>
                  <select
                    value={childAge}
                    onChange={(event) => setChildAge(Number(event.target.value))}
                    className="mt-0.5 bg-transparent pr-6 text-[13px] font-extrabold text-white outline-none"
                  >
                    {Array.from({ length: 9 }, (_, index) => index + 3).map((age) => (
                      <option key={age} value={age}>{age}세</option>
                    ))}
                  </select>
                </div>
                <div className="ml-auto">
                  <div className="mb-1 text-right text-[9px] font-bold text-[#6f817d]">야외활동 시간</div>
                  <div className="flex rounded-xl bg-black/15 p-0.5">
                    {[20, 40, 60].map((value) => (
                      <button
                        key={value}
                        onClick={() => setDuration(value)}
                        className={"rounded-[10px] px-3 py-1.5 text-[10px] font-extrabold transition " + (duration === value
                          ? "bg-[#15302b] text-[#71dfd2]"
                          : "text-[#7e8d97] hover:text-white")}
                      >
                        {value}분
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="px-4 pb-4">
            {snapshot?.recommendation && (
              <div className="rounded-3xl bg-gradient-to-br from-[#15342c] via-[#11251f] to-[#101a20] p-4 shadow-[0_16px_38px_rgba(0,0,0,.22)]">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-extrabold text-[#72e2d3]">
                    <Sparkles className="size-3.5" /> 지금 가기 좋은 곳
                  </div>
                  {recommended && (
                    <div className={"text-2xl font-black tabular-nums " + fitTone(recommended.fitScore)}>
                      {recommended.fitScore.toFixed(0)}
                    </div>
                  )}
                </div>
                <div className="mt-1.5 flex items-end justify-between gap-3">
                  <div className="text-[16px] font-black tracking-[-0.02em]">{snapshot.recommendation.placeName}</div>
                  {recommended && <div className="pb-0.5 text-[9px] font-bold text-[#9ec2b8]">{recommended.label}</div>}
                </div>
                {recommended && (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[9px] text-[#a8bbb7]">
                    <span className="rounded-full bg-white/[0.045] px-2 py-1">그늘 {recommended.shadePct.toFixed(0)}%</span>
                    <span className="rounded-full bg-white/[0.045] px-2 py-1">UV {recommended.uvIndex.toFixed(1)}</span>
                    <span className="rounded-full bg-white/[0.045] px-2 py-1">체감 {snapshot.weather.apparentTemperatureC.toFixed(1)}°C</span>
                    {recommended.surfaceHeatSignal !== "정보 없음" && (
                      <span className="rounded-full bg-white/[0.045] px-2 py-1">표면 열축적 {recommended.surfaceHeatSignal}</span>
                    )}
                    {recommended.mappedTreeCount > 0 && (
                      <span className="rounded-full bg-white/[0.045] px-2 py-1">수목 {recommended.mappedTreeCount} · 그늘 {recommended.treeShadePct.toFixed(0)}%</span>
                    )}
                  </div>
                )}
                <p className="mb-0 mt-2.5 text-[10px] leading-[1.55] text-[#b0c0bd]">{snapshot.recommendation.summary}</p>
                {snapshot.recommendation.betterTime && (
                  <div className="mt-3 flex items-center justify-between rounded-2xl bg-black/15 px-3 py-2 text-[9px] text-[#d9c77f]">
                    <span>더 쾌적해지는 시간</span>
                    <strong className="text-[11px]">{snapshot.recommendation.betterTime.localDateTime.slice(11, 16)}</strong>
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 flex items-center justify-between px-1">
              <div className="text-[10px] font-extrabold text-[#8f9ca7]">주변 장소</div>
              <div className="text-[9px] text-[#61717c]">{snapshot?.assessments.length ?? 0}곳 비교</div>
            </div>
            <div className="mt-1 divide-y divide-white/[0.055] overflow-hidden">
              {snapshot?.assessments.map((assessment, rank) => (
                <button
                  key={assessment.place.id}
                  onClick={() => setSelectedPlaceId(assessment.place.id)}
                  className={"relative w-full px-2.5 py-3.5 text-left transition " + (
                    selected?.place.id === assessment.place.id
                      ? scoreBackground(assessment.fitScore) + " rounded-2xl ring-1"
                      : "bg-transparent hover:bg-white/[0.035]"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[9px] font-bold text-[#667783]">{rank + 1} · {assessment.place.kind === "playground" ? "놀이터" : "공원"}</div>
                      <strong className="mt-1 block truncate text-[13px] leading-[1.4]">{assessment.place.name}</strong>
                      <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[9.5px] leading-[1.45] text-[#83929c]">
                        <span>{Math.round(assessment.place.distanceM)}m</span>
                        <span>그늘 {assessment.shadePct.toFixed(0)}%</span>
                        <span>UV {assessment.uvIndex.toFixed(1)}</span>
                        {assessment.surfaceHeatSignal !== "정보 없음" && <span>표면 {assessment.surfaceHeatSignal}</span>}
                        {assessment.mappedTreeCount > 0 && <span>수목 {assessment.mappedTreeCount}</span>}
                      </div>
                    </div>
                    <div className="min-w-[52px] text-right">
                      <div className={"text-[22px] font-black leading-none tabular-nums " + fitTone(assessment.fitScore)}>{assessment.fitScore.toFixed(0)}</div>
                      <div className="mt-1 text-[8.5px] text-[#778690]">활동 적합도</div>
                    </div>
                  </div>
                  <div className="mt-2.5 text-[10px] font-semibold leading-[1.45] text-[#aab6bf]">{assessment.label}</div>
                </button>
              ))}
            </div>

            {selected && (
              <div className="mt-4 border-t border-white/[0.065] px-1 pt-3.5">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-extrabold text-[#f0bb62]">시간별 변화</div>
                  <div className="flex items-center gap-1 text-[9px] text-[#71808b]">
                    <Clock3 className="size-3.5" /> {selected.place.name}
                  </div>
                </div>
                <div className="mt-2.5 grid gap-2">
                  {selected.timeline.map((point) => (
                    <div key={point.localDateTime} className="grid grid-cols-[40px_1fr_30px_46px] items-center gap-2 text-[9.5px]">
                      <span className="text-[#8d9ba6]">{point.localDateTime.slice(11, 16)}</span>
                      <div className="h-1.5 overflow-hidden rounded-full bg-[#26323b]">
                        <div className="h-full rounded-full bg-[#53d6c7]" style={{ width: `${Math.max(3, point.fitScore)}%` }} />
                      </div>
                      <strong className="text-right tabular-nums">{point.fitScore.toFixed(0)}</strong>
                      <span className="text-right text-[8.5px] text-[#697983]">UV {point.uvIndex.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {vworldIssue && (
              <div className="mt-3 rounded-xl border border-[#f2c45d]/20 bg-[#2a2416] p-3 text-[9px] leading-4 text-[#d9c27a]">
                VWorld 3D를 불러오지 못해 분석 지도로 전환했습니다. {vworldIssue}
              </div>
            )}
            {message && <div className="mt-3 rounded-xl border border-[#ef8795]/20 bg-[#2a171c] p-3 text-[10px] text-[#efabb4]">{message}</div>}

            <div className="mt-3 text-[9px] leading-4 text-[#657580]">
              활동 적합도는 체감온도·습도·강수·UV·태양고도·주변 건물 그림자·OSM에 실제 매핑된 수목·활동시간을 합친 상대 비교입니다. 표면재는 열축적 신호로만 사용하며 의료적 안전 판정이나 실제 바닥 표면온도 측정이 아닙니다.
            </div>
          </div>
        </aside>

        <section className="absolute bottom-3 left-[387px] right-3 z-20 rounded-2xl border border-white/10 bg-[#101820]/94 p-3 shadow-xl backdrop-blur-md max-md:bottom-2 max-md:left-2 max-md:right-2">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-[100px]">
              <div className="flex items-center gap-1 text-[9px] font-bold text-[#f0bb62]"><ThermometerSun className="size-3" /> 방문 시간</div>
              <div className="mt-0.5 text-lg font-black tabular-nums">{timeFromMinutes(minutes)} KST</div>
            </div>
            <div className="min-w-0 flex-1">
              <Slider
                value={[minutes]}
                min={9 * 60}
                max={19 * 60}
                step={15}
                onValueChange={(value) => setMinutes(value[0] ?? minutes)}
                onValueCommit={(value) => setCommittedMinutes(value[0] ?? minutes)}
              />
              <div className="mt-1 flex justify-between text-[8px] text-[#71808b]"><span>09:00</span><span>19:00</span></div>
            </div>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="rounded-lg border border-white/8 bg-[#0c141a] px-2 py-1.5 text-[10px]"
            />
          </div>
        </section>

        {loading && snapshot && (
          <div className="pointer-events-none absolute right-3 top-[84px] z-20 rounded-xl border border-white/10 bg-[#101820]/90 px-3 py-2 text-[10px] text-[#9cabb6] shadow-lg">
            시간·장소 조건 재계산 중…
          </div>
        )}
      </section>
    </main>
  );
}
