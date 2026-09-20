import { NextRequest, NextResponse } from "next/server";
import { playSafeMapContext } from "@/lib/server/playgrounds";
import { playSafePublicContext } from "@/lib/server/playsafe-public-context";
import { playSafeWeather } from "@/lib/server/playsafe-weather";
import { reverseAddress } from "@/lib/vworld/server";
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
    const [mapContext, weather, publicContext] = await Promise.all([
      playSafeMapContext(lon, lat, 800, 4),
      playSafeWeather(lon, lat, requestedAt),
      playSafePublicContext({ lon, lat }),
    ]);
    const { places, buildings, trees } = mapContext;
    const placesWithAddresses = await Promise.all(
      places.map(async (place) => place.address
        ? place
        : {
            ...place,
            address: await reverseAddress(place.point, { allowNominatim: false }),
          }),
    );
    const assessments = placesWithAddresses
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
    if (best && !best.place.address) {
      best.place.address = await reverseAddress(best.place.point);
    }

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
            summary: `${withSubjectParticle(best.place.name)} 현재 조건에서 상대적으로 가장 적합합니다. ${best.ageProfile.label} 기준으로 예상 그늘 ${best.shadePct.toFixed(0)}%, UV ${weather.current.uvIndex.toFixed(1)}, 체감온도 ${weather.current.apparentTemperatureC.toFixed(1)}°C, ${activityMinutes}분 활동을 함께 반영했습니다.`,
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
      publicContext,
      methodology: {
        scope: "relative-outdoor-activity-fit",
        note: "의학적 안전 판정이 아닌 상대적 환경 노출 비교입니다. 나이는 어린 아이일수록 같은 환경을 더 보수적으로 해석하는 제품 비교 휴리스틱에만 사용됩니다.",
        factors: ["apparent-temperature", "humidity", "precipitation", "uv-index", "solar-elevation", "building-shadow-sampling", "osm-tree-shadow-when-mapped", "play-area-boundary", "surface-heat-signal", "activity-duration", "age-conservatism-profile"],
        playgroundSource: "OpenStreetMap + VWorld nearby POI",
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
