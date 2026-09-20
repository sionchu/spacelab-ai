import type { GeoPoint } from "@/src/types";
import type {
  PlaySafeRouteSegment,
  PlaySafeWalkingRoute,
} from "@/src/playsafe";
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

type ValhallaTraceEdge = {
  length?: number;
  use?: string;
  road_class?: string;
  begin_shape_index?: number;
  end_shape_index?: number;
};

type ValhallaTraceResponse = {
  edges?: ValhallaTraceEdge[];
};

const VALHALLA_BASE_URL = "https://valhalla1.openstreetmap.de";
const CHILD_PEDESTRIAN_COSTING = {
  walkway_factor: 0.35,
  sidewalk_factor: 0.35,
  alley_factor: 8,
  driveway_factor: 12,
  service_factor: 6,
  service_penalty: 20,
  use_tracks: 0,
  use_living_streets: 0.15,
  step_penalty: 45,
  max_hiking_difficulty: 0,
};

const PEDESTRIAN_USES = new Set([
  "footway",
  "sidewalk",
  "pedestrian",
  "path",
  "cycleway",
  "mountain_bike",
  "bridleway",
  "steps",
]);
const CROSSING_USES = new Set(["pedestrian_crossing"]);
const SHARED_ROAD_USES = new Set([
  "road",
  "ramp",
  "turn_channel",
  "track",
  "driveway",
  "alley",
  "parking_aisle",
  "emergency_access",
  "drive_through",
  "culdesac",
  "living_street",
  "service_road",
]);

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

function segmentKind(edge: ValhallaTraceEdge): PlaySafeRouteSegment["kind"] {
  const use = String(edge.use || "").toLowerCase();
  if (CROSSING_USES.has(use)) return "crossing";
  if (PEDESTRIAN_USES.has(use)) return "pedestrian";
  if (SHARED_ROAD_USES.has(use)) return "shared-road";
  if (edge.road_class) return "shared-road";
  return "unknown";
}

function routeQuality(
  segments: PlaySafeRouteSegment[],
  totalDistanceM: number,
  traceStatus: PlaySafeWalkingRoute["quality"]["traceStatus"],
): PlaySafeWalkingRoute["quality"] {
  const totals = {
    pedestrian: 0,
    crossing: 0,
    sharedRoad: 0,
    unknown: 0,
  };

  for (const segment of segments) {
    if (segment.kind === "pedestrian") totals.pedestrian += segment.distanceM;
    else if (segment.kind === "crossing") totals.crossing += segment.distanceM;
    else if (segment.kind === "shared-road") totals.sharedRoad += segment.distanceM;
    else totals.unknown += segment.distanceM;
  }

  const classified = totals.pedestrian + totals.crossing + totals.sharedRoad + totals.unknown;
  if (classified < totalDistanceM) totals.unknown += totalDistanceM - classified;
  const denominator = Math.max(1, totalDistanceM);

  return {
    traceStatus,
    pedestrianOnlyM: Math.round(totals.pedestrian),
    crossingM: Math.round(totals.crossing),
    sharedRoadM: Math.round(totals.sharedRoad),
    unknownM: Math.round(totals.unknown),
    pedestrianOnlyPct: Math.round((totals.pedestrian / denominator) * 100),
    crossingPct: Math.round((totals.crossing / denominator) * 100),
    sharedRoadPct: Math.round((totals.sharedRoad / denominator) * 100),
    unknownPct: Math.round((totals.unknown / denominator) * 100),
  };
}

async function tracePedestrianRoute(
  encodedShape: string,
  points: GeoPoint[],
  totalDistanceM: number,
): Promise<{
  segments: PlaySafeRouteSegment[];
  quality: PlaySafeWalkingRoute["quality"];
}> {
  try {
    const response = await fetch(VALHALLA_BASE_URL + "/trace_attributes", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Client-Id": "spacelab-ai-playsafe-hackathon",
      },
      body: JSON.stringify({
        encoded_polyline: encodedShape,
        costing: "pedestrian",
        costing_options: {
          pedestrian: CHILD_PEDESTRIAN_COSTING,
        },
        shape_match: "edge_walk",
        filters: {
          action: "include",
          attributes: [
            "edge.length",
            "edge.use",
            "edge.road_class",
            "edge.begin_shape_index",
            "edge.end_shape_index",
          ],
        },
        directions_options: {
          units: "kilometers",
        },
      }),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });

    if (!response.ok) throw new Error("trace HTTP " + response.status);
    const payload = await response.json() as ValhallaTraceResponse;
    const edges = payload.edges ?? [];
    if (!edges.length) throw new Error("trace edges unavailable");

    const segments = edges.flatMap((edge) => {
      const begin = Math.max(0, Math.min(
        points.length - 1,
        Math.floor(Number(edge.begin_shape_index)),
      ));
      const end = Math.max(begin, Math.min(
        points.length - 1,
        Math.floor(Number(edge.end_shape_index)),
      ));
      const segmentPoints = points.slice(begin, end + 1);
      if (segmentPoints.length < 2) return [];

      const lengthKm = Number(edge.length);
      const distanceM = Number.isFinite(lengthKm)
        ? Math.max(0, Math.round(lengthKm * 1000))
        : 0;

      return [{
        kind: segmentKind(edge),
        points: segmentPoints,
        distanceM,
        use: edge.use,
        roadClass: edge.road_class,
      } satisfies PlaySafeRouteSegment];
    });

    if (!segments.length) throw new Error("trace segments unavailable");
    return {
      segments,
      quality: routeQuality(segments, totalDistanceM, "available"),
    };
  } catch {
    const segments: PlaySafeRouteSegment[] = [{
      kind: "unknown",
      points,
      distanceM: totalDistanceM,
    }];
    return {
      segments,
      quality: routeQuality(segments, totalDistanceM, "unavailable"),
    };
  }
}

async function valhallaPedestrianRoute(
  start: GeoPoint,
  end: GeoPoint,
): Promise<{
  points: GeoPoint[];
  encodedShape: string;
  distanceM: number;
  durationMinutes: number;
}> {
  const response = await fetch(VALHALLA_BASE_URL + "/route", {
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
      costing_options: {
        pedestrian: CHILD_PEDESTRIAN_COSTING,
      },
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
    encodedShape: shape,
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
  const [publicContext, trace] = await Promise.all([
    playSafeRoutePublicContext(base.points),
    tracePedestrianRoute(base.encodedShape, base.points, base.distanceM),
  ]);

  const heatKey = process.env.SAFETYDATA_SERVICE_KEY || process.env.DATA_GO_KR_SERVICE_KEY || "";
  const heatMitigation: PlaySafeWalkingRoute["heatMitigation"] = {
    status: heatKey ? "error" : "unavailable-no-key",
    facilities: [],
  };

  const sharedRoadNote = trace.quality.traceStatus === "available"
    && trace.quality.sharedRoadPct > 0
    ? ` 보행 전용 선형이 없는 구간 ${trace.quality.sharedRoadPct}%는 차량과 공유되거나 도로 중심선과 겹쳐 보일 수 있어 지도에서 노란색으로 구분합니다.`
    : "";

  const value: PlaySafeWalkingRoute = {
    provider: "valhalla-osm",
    start,
    end,
    distanceM: base.distanceM,
    durationMinutes: base.durationMinutes,
    points: base.points,
    segments: trace.segments,
    quality: trace.quality,
    summary: {
      ...publicContext.summary,
      heatMitigationFacilities: heatMitigation.facilities.length,
    },
    childZones: publicContext.childZones,
    childAccidentHotspots: publicContext.childAccidentHotspots,
    toilets: publicContext.toilets,
    heatMitigation,
    note: "보도·보행로를 강하게 우선하는 OpenStreetMap 기반 Valhalla 보행 경로입니다." + sharedRoadNote
      + " 보호구역·사고다발·편의시설은 경로 주변 공공데이터를 겹쳐 본 참고 정보이며 실제 보행 안전을 보장하는 판정은 아닙니다.",
  };

  routeCache.set(key, {
    expiresAt: Date.now() + 10 * 60_000,
    value,
  });
  return value;
}
