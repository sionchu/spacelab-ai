"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Clock3, Search, Sparkles, ThermometerSun } from "lucide-react";
import { PlaySafeMap } from "@/components/playsafe/playsafe-map";
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
  if (score >= 75) return "border-[#53d6c7]/35 bg-[#102620]";
  if (score >= 58) return "border-[#9bd4a3]/25 bg-[#17241b]";
  if (score >= 38) return "border-[#f2c45d]/30 bg-[#2a2416]";
  return "border-[#ef8795]/30 bg-[#29191d]";
}

export function PlaySafeClient() {
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
  const snapshotRef = useRef(snapshot);
  const selectedRef = useRef(selectedPlaceId);
  snapshotRef.current = snapshot;
  selectedRef.current = selectedPlaceId;

  const analysisAt = `${date}T${timeFromMinutes(committedMinutes)}`;

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
        {webMcpSupported && (
          <div className="flex items-center gap-1 rounded-lg border border-[#7f9df4]/25 bg-[#171e31] px-2.5 py-1.5 text-[10px] text-[#a7b7ff]">
            <Bot className="size-3.5" /> PlaySafe Tools
          </div>
        )}
        <div className="rounded-lg border border-white/8 bg-[#151f28] px-2.5 py-1.5 text-[10px] text-[#a8b3bd]">
          {centerLabel}
        </div>
      </header>

      <section className="relative min-h-0 overflow-hidden">
        {snapshot && (
          <PlaySafeMap
            snapshot={snapshot}
            selectedPlaceId={selectedPlaceId}
            onSelectPlace={setSelectedPlaceId}
          />
        )}

        {!snapshot && (
          <div className="absolute inset-0 grid place-items-center bg-[#0d141b] text-sm text-[#8f9ca7]">
            {loading ? "주변 놀이터와 열환경을 분석하는 중…" : "PlaySafe 데이터를 불러오지 못했습니다."}
          </div>
        )}

        <aside className="absolute bottom-3 left-3 top-3 z-20 flex w-[350px] flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#101820]/96 shadow-2xl backdrop-blur-md max-md:bottom-[76px] max-md:left-2 max-md:right-2 max-md:top-auto max-md:max-h-[52dvh] max-md:w-auto">
          <div className="border-b border-white/8 p-4">
            <form onSubmit={search} className="grid grid-cols-[1fr_auto] overflow-hidden rounded-xl border border-white/10 bg-[#0b1218]">
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

            <div className="mt-3 grid grid-cols-[auto_1fr] gap-3 rounded-2xl border border-white/8 bg-[#131d24] p-3">
              <div className="grid size-14 place-items-center rounded-2xl border border-[#53d6c7]/25 bg-[#102520] text-3xl shadow-inner">🧒</div>
              <div className="min-w-0">
                <div className="text-[10px] font-bold text-[#53d6c7]">아이 프로필</div>
                <div className="mt-1 flex items-center gap-2">
                  <select
                    value={childAge}
                    onChange={(event) => setChildAge(Number(event.target.value))}
                    className="rounded-lg border border-white/8 bg-[#0d151b] px-2 py-1.5 text-xs outline-none"
                  >
                    {Array.from({ length: 9 }, (_, index) => index + 3).map((age) => (
                      <option key={age} value={age}>{age}세</option>
                    ))}
                  </select>
                  <span className="text-[9px] leading-4 text-[#8795a0]">체온 예측이 아닌 환경 노출 비교에 사용합니다.</span>
                </div>
              </div>
            </div>

            <div className="mt-3">
              <div className="mb-1.5 text-[10px] font-bold text-[#9aa7b2]">예상 야외활동 시간</div>
              <div className="grid grid-cols-3 gap-1.5">
                {[20, 40, 60].map((value) => (
                  <button
                    key={value}
                    onClick={() => setDuration(value)}
                    className={"rounded-xl border px-2 py-2 text-[11px] font-bold " + (duration === value
                      ? "border-[#53d6c7]/40 bg-[#15302b] text-[#71dfd2]"
                      : "border-white/8 bg-[#0d151b] text-[#8795a0]")}
                  >
                    {value}분
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {snapshot?.recommendation && (
              <div className="rounded-2xl border border-[#53d6c7]/25 bg-gradient-to-br from-[#143129] to-[#101a20] p-3">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#6de0d1]">
                  <Sparkles className="size-3.5" /> AI 추천
                </div>
                <div className="mt-1.5 text-[15px] font-extrabold">{snapshot.recommendation.placeName}</div>
                <p className="mb-0 mt-1 text-[10px] leading-5 text-[#a4b4b7]">{snapshot.recommendation.summary}</p>
                {snapshot.recommendation.betterTime && (
                  <div className="mt-2 rounded-xl bg-black/15 px-2.5 py-2 text-[9px] text-[#d7c17f]">
                    더 나은 시간 후보 · {snapshot.recommendation.betterTime.localDateTime.slice(11, 16)}
                  </div>
                )}
              </div>
            )}

            <div className="mt-3 grid gap-2">
              {snapshot?.assessments.map((assessment, rank) => (
                <button
                  key={assessment.place.id}
                  onClick={() => setSelectedPlaceId(assessment.place.id)}
                  className={"rounded-2xl border p-3 text-left transition " + (
                    selected?.place.id === assessment.place.id
                      ? scoreBackground(assessment.fitScore) + " ring-1 ring-white/10"
                      : "border-white/8 bg-[#0d151b]/90 hover:bg-[#121d24]"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[9px] font-bold text-[#687883]">{rank + 1} · {assessment.place.kind === "playground" ? "놀이터" : "공원"}</div>
                      <strong className="mt-0.5 block truncate text-[12px]">{assessment.place.name}</strong>
                      <span className="mt-1 block text-[9px] text-[#788792]">{Math.round(assessment.place.distanceM)}m · 그늘 {assessment.shadePct.toFixed(0)}%</span>
                    </div>
                    <div className="text-right">
                      <div className={"text-xl font-black tabular-nums " + fitTone(assessment.fitScore)}>{assessment.fitScore.toFixed(0)}</div>
                      <div className="text-[8px] text-[#778690]">활동 적합도</div>
                    </div>
                  </div>
                  <div className="mt-2 text-[9px] font-semibold text-[#aab6bf]">{assessment.label}</div>
                </button>
              ))}
            </div>

            {selected && (
              <div className="mt-3 rounded-2xl border border-white/8 bg-[#0d151b] p-3">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-bold text-[#f0bb62]">시간별 변화</div>
                  <Clock3 className="size-3.5 text-[#788792]" />
                </div>
                <div className="mt-2 grid gap-1.5">
                  {selected.timeline.map((point) => (
                    <div key={point.localDateTime} className="grid grid-cols-[38px_1fr_34px] items-center gap-2 text-[9px]">
                      <span className="text-[#8d9ba6]">{point.localDateTime.slice(11, 16)}</span>
                      <div className="h-1.5 overflow-hidden rounded-full bg-[#26323b]">
                        <div className="h-full rounded-full bg-[#53d6c7]" style={{ width: `${Math.max(3, point.fitScore)}%` }} />
                      </div>
                      <strong className="text-right tabular-nums">{point.fitScore.toFixed(0)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {message && <div className="mt-3 rounded-xl border border-[#ef8795]/20 bg-[#2a171c] p-3 text-[10px] text-[#efabb4]">{message}</div>}

            <div className="mt-3 text-[9px] leading-4 text-[#657580]">
              활동 적합도는 체감온도·습도·강수·태양고도·주변 건물 그림자·활동시간을 합친 상대 비교입니다. 의료적 안전 판정이나 실제 바닥 표면온도 측정이 아닙니다.
            </div>
          </div>
        </aside>

        <section className="absolute bottom-3 left-[377px] right-3 z-20 rounded-2xl border border-white/10 bg-[#101820]/94 p-3 shadow-xl backdrop-blur-md max-md:bottom-2 max-md:left-2 max-md:right-2">
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
