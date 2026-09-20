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
  sidewalk?: string;
  begin_shape_index?: number;
  end_shape_index?: number;
};

type ValhallaTraceResponse = {
  edges?: ValhallaTraceEdge[];
};

const VALHALLA_BASE_URL = "https://valhalla1.openstreetmap.de";
const CHILD_PEDESTRIAN_COSTING = {
  walkway_factor: 0.2,
  sidewalk_factor: 0.25,
  alley_factor: 10,
  driveway_factor: 15,
  service_factor: 8,
  service_penalty: 30,
  use_tracks: 0,
  use_living_streets: 1,
  step_penalty: 75,
  max_hiking_difficulty: 0,
};

const PEDESTRIAN_USES = new Set([
  "sidewalk",
  "footway",
  "steps",
  "cycleway",
  "mountain_bike",
  "pedestrian",
  "path",
]);
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
  "service_other",
]);

const routeCache = new Map<string, {
  expiresAt: number;
  value: PlaySafeWalkingRoute;
}>();

function routeKey(start: GeoPoint, end: GeoPoint) {
  return [
    "ped-v3",
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
  if (PEDESTRIAN_USES.has(use)) return "pedestrian";
  if (edge.sidewalk === "left" || edge.sidewalk === "right" || edge.sidewalk === "both") {
    return "road-sidewalk";
  }
  if (SHARED_ROAD_USES.has(use) || edge.road_class) return "shared-road";
  return "unknown";
}

function routeQuality(
  segments: PlaySafeRouteSegment[],
  totalDistanceM: number,
  traceStatus: PlaySafeWalkingRoute["quality"]["traceStatus"],
): PlaySafeWalkingRoute["quality"] {
  const totals = {
    pedestrian: 0,
    roadSidewalk: 0,
    sharedRoad: 0,
    unknown: 0,
  };

  for (const segment of segments) {
    if (segment.kind === "pedestrian") totals.pedestrian += segment.distanceM;
    else if (segment.kind === "road-sidewalk") totals.roadSidewalk += segment.distanceM;
    else if (segment.kind === "shared-road") totals.sharedRoad += segment.distanceM;
    else totals.unknown += segment.distanceM;
  }

  const classified = totals.pedestrian
    + totals.roadSidewalk
    + totals.sharedRoad
    + totals.unknown;
  totals.unknown += Math.max(0, totalDistanceM - classified);
  const denominator = Math.max(
    1,
    totalDistanceM,
    totals.pedestrian + totals.roadSidewalk + totals.sharedRoad + totals.unknown,
  );
  const pct = (distanceM: number) => Math.round((distanceM / denominator) * 100);

  return {
    traceStatus,
    pedestrianOnlyM: Math.round(totals.pedestrian),
    roadSidewalkM: Math.round(totals.roadSidewalk),
    sharedRoadM: Math.round(totals.sharedRoad),
    unknownM: Math.round(totals.unknown),
    pedestrianOnlyPct: pct(totals.pedestrian),
    roadSidewalkPct: pct(totals.roadSidewalk),
    sharedRoadPct: pct(totals.sharedRoad),
    unknownPct: pct(totals.unknown),
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
            "edge.sidewalk",
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
      const beginRaw = Number(edge.begin_shape_index);
      const endRaw = Number(edge.end_shape_index);
      if (!Number.isFinite(beginRaw) || !Number.isFinite(endRaw)) return [];

      const begin = Math.max(0, Math.min(points.length - 1, Math.floor(beginRaw)));
      const end = Math.max(begin, Math.min(points.length - 1, Math.floor(endRaw)));
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
        sidewalk: edge.sidewalk,
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

  const qualityNotes: string[] = [];
  if (trace.quality.traceStatus === "unavailable") {
    qualityNotes.push("이 경로의 보도 구분 정보는 확인하지 못했습니다.");
  } else {
    if (trace.quality.roadSidewalkPct > 0) {
      qualityNotes.push(
        `파란색 ${trace.quality.roadSidewalkPct}%는 OSM에 보도가 표시된 도로이지만 지도 선형은 도로 중심선과 겹칠 수 있습니다.`,
      );
    }
    if (trace.quality.sharedRoadPct > 0) {
      qualityNotes.push(
        `노란색 ${trace.quality.sharedRoadPct}%는 별도 보도 정보가 없어 차량과 공유될 수 있는 구간입니다.`,
      );
    }
  }

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
    note: [
      "보행 전용로와 보도가 있는 길을 강하게 우선하는 OpenStreetMap 기반 Valhalla 경로입니다.",
      ...qualityNotes,
      "보호구역·사고다발·편의시설은 경로 주변 공공데이터를 겹쳐 본 참고 정보이며 실제 보행 안전을 보장하는 판정은 아닙니다.",
    ].join(" "),
  };

  routeCache.set(key, {
    expiresAt: Date.now() + 10 * 60_000,
    value,
  });
  return value;
}
