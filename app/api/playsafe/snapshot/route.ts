import { NextRequest, NextResponse } from "next/server";
import { playSafeMapContext } from "@/lib/server/playgrounds";
import { playSafeWeather } from "@/lib/server/playsafe-weather";
import { assessPlayPlace } from "@/src/playsafe";

function defaultKstDateTime() {
  const shifted = new Date(Date.now() + 9 * 60 * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function withSubjectParticle(value: string) {
  const last = value.at(-1);
  if (!last) return value;
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return value + "이";
  const hasFinalConsonant = (code - 0xac00) % 28 !== 0;
  return value + (hasFinalConsonant ? "이" : "가");
}

export async function GET(request: NextRequest) {
  const lon = Number(request.nextUrl.searchParams.get("lon"));
  const lat = Number(request.nextUrl.searchParams.get("lat"));
  const childAge = Math.min(12, Math.max(2, Number(request.nextUrl.searchParams.get("age")) || 6));
  const activityMinutes = Math.min(120, Math.max(10, Number(request.nextUrl.searchParams.get("duration")) || 40));
  const requestedAt = request.nextUrl.searchParams.get("at") || defaultKstDateTime();

  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return NextResponse.json({ error: "Valid lon/lat are required." }, { status: 400 });
  }

  try {
    const [mapContext, weather] = await Promise.all([
      playSafeMapContext(lon, lat, 800, 4),
      playSafeWeather(lon, lat, requestedAt),
    ]);
    const { places, buildings, trees } = mapContext;

    const assessments = places
      .map((place) =>
        assessPlayPlace(
          place,
          buildings,
          trees,
          weather.current,
          childAge,
          activityMinutes,
          weather.timeline,
        ))
      .sort((a, b) => b.fitScore - a.fitScore);

    const best = assessments[0];
    const bestLater = assessments.flatMap((assessment) =>
      assessment.timeline.map((point) => ({
        placeId: assessment.place.id,
        placeName: assessment.place.name,
        ...point,
      })))
      .sort((a, b) => b.fitScore - a.fitScore)[0];

    return NextResponse.json({
      query: {
        center: { lon, lat },
        childAge,
        activityMinutes,
        requestedAt,
      },
      weather: weather.current,
      assessments,
      recommendation: best
        ? {
            placeId: best.place.id,
            placeName: best.place.name,
            fitScore: best.fitScore,
            label: best.label,
            summary: `${withSubjectParticle(best.place.name)} 현재 조건에서 상대적으로 가장 적합합니다. 예상 그늘 ${best.shadePct.toFixed(0)}%, UV ${weather.current.uvIndex.toFixed(1)}, 체감온도 ${weather.current.apparentTemperatureC.toFixed(1)}°C 기준입니다.`,
            betterTime: bestLater && bestLater.fitScore > best.fitScore + 5
              ? {
                  placeId: bestLater.placeId,
                  placeName: bestLater.placeName,
                  localDateTime: bestLater.localDateTime,
                  fitScore: bestLater.fitScore,
                }
              : undefined,
          }
        : undefined,
      buildings,
      trees,
      methodology: {
        scope: "relative-outdoor-activity-fit",
        note: "의학적 안전 판정이 아닌 상대적 환경 노출 비교입니다.",
        factors: ["apparent-temperature", "humidity", "precipitation", "uv-index", "solar-elevation", "building-shadow-sampling", "osm-tree-shadow-when-mapped", "play-area-boundary", "surface-heat-signal", "activity-duration"],
        playgroundSource: "OpenStreetMap",
        weatherSource: "Open-Meteo",
        buildingSource: buildings.features[0]?.properties?.source || "OpenStreetMap",
      },
    }, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
      },
    });
  } catch (error) {
    console.error("[playsafe] snapshot failed", error);
    return NextResponse.json({
      error: "PlaySafe 분석을 불러오지 못했습니다.",
      detail: error instanceof Error ? error.message : String(error),
    }, { status: 502 });
  }
}
