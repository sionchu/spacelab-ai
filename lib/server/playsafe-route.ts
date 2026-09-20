import type { GeoPoint } from "@/src/types";
import type { PlaySafeWalkingRoute } from "@/src/playsafe";
import { playSafeRoutePublicContext } from "@/lib/server/playsafe-public-context";

type ValhallaRouteResponse = {
  trip?: {
    legs?: Array<{ shape?: string }>;
    summary?: {
      length?: number;
      time?: number;
    };
  };
};

const routeCache = new Map<string, {
  expiresAt: number;
  value: PlaySafeWalkingRoute;
}>();

function routeKey(start: GeoPoint, end: GeoPoint) {
  return [
    start.lon.toFixed(5),
    start.lat.toFixed(5),
    end.lon.toFixed(5),
    end.lat.toFixed(5),
  ].join(":");
}

function decodePolyline6(encoded: string): GeoPoint[] {
  const coordinates: GeoPoint[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  const nextValue = () => {
    let result = 0;
    let shift = 0;
    let byte = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index <= encoded.length);
    return (result & 1) ? ~(result >> 1) : (result >> 1);
  };

  while (index < encoded.length) {
    lat += nextValue();
    lon += nextValue();
    coordinates.push({
      lat: lat / 1_000_000,
      lon: lon / 1_000_000,
    });
  }

  return coordinates;
}

async function valhallaPedestrianRoute(
  start: GeoPoint,
  end: GeoPoint,
): Promise<{ points: GeoPoint[]; distanceM: number; durationMinutes: number }> {
  const response = await fetch("https://valhalla1.openstreetmap.de/route", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Client-Id": "spacelab-ai-playsafe-hackathon",
    },
    body: JSON.stringify({
      locations: [
        { lat: start.lat, lon: start.lon, type: "break" },
        { lat: end.lat, lon: end.lon, type: "break" },
      ],
      costing: "pedestrian",
      directions_type: "none",
      units: "kilometers",
    }),
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("보행 경로를 계산하지 못했습니다. HTTP " + response.status);
  }

  const payload = await response.json() as ValhallaRouteResponse;
  const shape = payload.trip?.legs?.[0]?.shape;
  const lengthKm = Number(payload.trip?.summary?.length);
  const timeSeconds = Number(payload.trip?.summary?.time);

  if (!shape || !Number.isFinite(lengthKm) || !Number.isFinite(timeSeconds)) {
    throw new Error("보행 경로 응답이 올바르지 않습니다.");
  }

  const points = decodePolyline6(shape);
  if (points.length < 2) throw new Error("보행 경로 좌표가 비어 있습니다.");

  return {
    points,
    distanceM: Math.max(1, Math.round(lengthKm * 1000)),
    durationMinutes: Math.max(1, Math.round(timeSeconds / 60)),
  };
}

export async function playSafeWalkingRoute(
  start: GeoPoint,
  end: GeoPoint,
): Promise<PlaySafeWalkingRoute> {
  const key = routeKey(start, end);
  const cached = routeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const base = await valhallaPedestrianRoute(start, end);
  const publicContext = await playSafeRoutePublicContext(base.points);

  const heatKey = process.env.SAFETYDATA_SERVICE_KEY || process.env.DATA_GO_KR_SERVICE_KEY || "";
  const heatMitigation: PlaySafeWalkingRoute["heatMitigation"] = {
    status: heatKey ? "error" : "unavailable-no-key",
    facilities: [],
  };

  const value: PlaySafeWalkingRoute = {
    provider: "valhalla-osm",
    start,
    end,
    distanceM: base.distanceM,
    durationMinutes: base.durationMinutes,
    points: base.points,
    summary: {
      ...publicContext.summary,
      heatMitigationFacilities: heatMitigation.facilities.length,
    },
    childZones: publicContext.childZones,
    childAccidentHotspots: publicContext.childAccidentHotspots,
    toilets: publicContext.toilets,
    heatMitigation,
    note: "보행 경로는 OpenStreetMap 기반 Valhalla 라우팅이며, 보호구역·사고다발·편의시설은 경로 주변 공공데이터를 겹쳐 본 참고 정보입니다. 실제 보행 안전을 보장하는 판정은 아닙니다.",
  };

  routeCache.set(key, {
    expiresAt: Date.now() + 10 * 60_000,
    value,
  });
  return value;
}
