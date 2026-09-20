import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { geoPointToLocal, localPointToGeo, solarPosition } from "./model";
import type { GeoPoint, LocalPoint } from "./types";

export type PlayPlaceKind = "playground" | "park";

export type PlaySafeTree = {
  point: GeoPoint;
  heightM: number;
  crownRadiusM: number;
};

export type PlaySafeMapViewAction = {
  type: "top" | "search" | "route";
  nonce: number;
};

export type PlayPlace = {
  id: string;
  name: string;
  kind: PlayPlaceKind;
  point: GeoPoint;
  boundary?: GeoPoint[];
  address?: string;
  distanceM: number;
  tags: Record<string, string>;
};

export type PlaySafeWeather = {
  localDateTime: string;
  temperatureC: number;
  apparentTemperatureC: number;
  relativeHumidityPct: number;
  cloudCoverPct: number;
  precipitationMm: number;
  windSpeedKph: number;
  uvIndex: number;
};

export type HeatSample = {
  point: GeoPoint;
  shaded: boolean;
  exposurePct: number;
};

export type PlaySafeTimelinePoint = {
  localDateTime: string;
  fitScore: number;
  shadePct: number;
  apparentTemperatureC: number;
  uvIndex: number;
  label: PlaySafeAssessment["label"];
};

export type PlaySafeAgeProfile = {
  band: "3-5" | "6-8" | "9-12";
  label: string;
  rationale: string;
  policy: "conservative-product-heuristic";
};

export type PlaySafeAssessment = {
  place: PlayPlace;
  childAge: number;
  activityMinutes: number;
  ageProfile: PlaySafeAgeProfile;
  shadePct: number;
  directSunPct: number;
  exposureScore: number;
  fitScore: number;
  uvIndex: number;
  surfaceHeatSignal: "낮음" | "보통" | "높음" | "정보 없음";
  surfaceLabel?: string;
  treeShadePct: number;
  mappedTreeCount: number;
  label: "상대적으로 쾌적" | "활동 가능성 높음" | "주의 필요" | "시간 조정 권장";
  reasons: string[];
  heatSamples: HeatSample[];
  timeline: PlaySafeTimelinePoint[];
};
export type PlaySafePublicContext = {
  generatedAt: string;
  summary: {
    parks: number;
    childZones: number;
    childZoneCctvCount: number;
    childAccidentHotspots: number;
    childCenters: number;
    childFriendlyToilets: number;
  };
  parks: Array<{
    id: string;
    name: string;
    address: string;
    point: GeoPoint;
    distanceM: number;
    type: string;
    areaM2: number;
    amusement: string;
    convenience: string;
    exercise: string;
    phone: string;
    referenceDate: string;
  }>;
  childZones: Array<{
    id: string;
    name: string;
    address: string;
    point: GeoPoint;
    distanceM: number;
    facilityType: string;
    cctv: string;
    cctvCount: number;
    active: string;
    roadWidth: string;
    referenceDate: string;
  }>;
  childAccidentHotspots: Array<{
    id: string;
    name: string;
    point: GeoPoint;
    distanceM: number;
    accidentType: string;
    year: string;
    region: string;
    occurrences: number;
    casualties: number;
    deaths: number;
    seriousInjuries: number;
    minorInjuries: number;
    reportedInjuries: number;
    referenceDate: string;
  }>;
  childCenters: Array<{
    id: string;
    name: string;
    address: string;
    point: GeoPoint;
    distanceM: number;
    phone: string;
    capacity: number;
    current: number;
    operatorType: string;
    referenceDate: string;
  }>;
  toilets: Array<{
    id: string;
    name: string;
    address: string;
    point: GeoPoint;
    distanceM: number;
    openTime: string;
    childFixtures: number;
    diaperChange: string;
    emergencyBell: string;
    referenceDate: string;
  }>;
  sources: {
    parks: number;
    childZones: number;
    childAccidentHotspots: number;
    childCenters: number;
    toilets: number;
  };
};

export type PlaySafeWalkingRoute = {
  provider: "valhalla-osm";
  start: GeoPoint;
  end: GeoPoint;
  distanceM: number;
  durationMinutes: number;
  points: GeoPoint[];
  summary: {
    childZones: number;
    childZoneCctvCount: number;
    childAccidentHotspots: number;
    childFriendlyToilets: number;
    heatMitigationFacilities: number;
  };
  childZones: Array<{
    id: string;
    name: string;
    facilityType: string;
    point: GeoPoint;
    distanceToRouteM: number;
    cctvCount: number;
  }>;
  childAccidentHotspots: Array<{
    id: string;
    name: string;
    accidentType: string;
    year: string;
    point: GeoPoint;
    distanceToRouteM: number;
    occurrences: number;
    casualties: number;
  }>;
  toilets: Array<{
    id: string;
    name: string;
    address: string;
    point: GeoPoint;
    distanceToRouteM: number;
    diaperChange: string;
    childFixtures: number;
  }>;
  heatMitigation: {
    status: "available" | "unavailable-no-key" | "error";
    facilities: Array<{
      id: string;
      name: string;
      type: string;
      point: GeoPoint;
      distanceToRouteM: number;
    }>;
  };
  note: string;
};

export type PlaySafeSnapshot = {
  query: {
    center: GeoPoint;
    childAge: number;
    activityMinutes: number;
    requestedAt: string;
  };
  weather: PlaySafeWeather;
  assessments: PlaySafeAssessment[];
  recommendation?: {
    placeId: string;
    placeName: string;
    fitScore: number;
    label: PlaySafeAssessment["label"];
    summary: string;
    betterTime?: {
      placeId: string;
      placeName: string;
      localDateTime: string;
      fitScore: number;
    };
  };
  buildings: PlaySafeBuildingCollection;
  trees: PlaySafeTree[];
  publicContext?: PlaySafePublicContext;
  methodology: {
    scope: string;
    note: string;
    factors: string[];
    playgroundSource: string;
    weatherSource: string;
    buildingSource: string;
  };
};


export type PlaySafeBuildingCollection = FeatureCollection<Polygon | MultiPolygon>;

type LocalShadow = LocalPoint[];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function pointInPolygon(point: LocalPoint, polygon: LocalPoint[]) {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects = ((a.yM > point.yM) !== (b.yM > point.yM))
      && point.xM < ((b.xM - a.xM) * (point.yM - a.yM)) / ((b.yM - a.yM) || Number.EPSILON) + a.xM;
    if (intersects) inside = !inside;
  }
  return inside;
}

function cross(origin: LocalPoint, a: LocalPoint, b: LocalPoint) {
  return (a.xM - origin.xM) * (b.yM - origin.yM) - (a.yM - origin.yM) * (b.xM - origin.xM);
}

function convexHull(points: LocalPoint[]) {
  const sorted = points
    .map((point) => ({ xM: Number(point.xM.toFixed(5)), yM: Number(point.yM.toFixed(5)) }))
    .filter((point, index, all) => all.findIndex((candidate) => candidate.xM === point.xM && candidate.yM === point.yM) === index)
    .sort((a, b) => a.xM - b.xM || a.yM - b.yM);
  if (sorted.length <= 2) return sorted;
  const lower: LocalPoint[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: LocalPoint[] = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function outerRings(geometry: Polygon | MultiPolygon) {
  if (geometry.type === "Polygon") return geometry.coordinates[0] ? [geometry.coordinates[0]] : [];
  return geometry.coordinates.flatMap((polygon) => polygon[0] ? [polygon[0]] : []);
}

function buildingShadows(
  origin: GeoPoint,
  buildings: PlaySafeBuildingCollection,
  localDateTime: string,
): LocalShadow[] {
  const solar = solarPosition(origin, localDateTime, 540);
  if (!solar.isDaylight || solar.elevationDeg <= 1) return [];
  const elevation = (solar.elevationDeg * Math.PI) / 180;
  const azimuth = (solar.azimuthDeg * Math.PI) / 180;
  const shadows: LocalShadow[] = [];

  for (const feature of buildings.features) {
    if (!feature.geometry) continue;
    const heightM = clamp(Number(feature.properties?.heightM) || 9, 1, 300);
    const lengthM = heightM / Math.tan(elevation);
    if (!Number.isFinite(lengthM) || lengthM <= 0) continue;
    const shift = {
      xM: -Math.sin(azimuth) * lengthM,
      yM: -Math.cos(azimuth) * lengthM,
    };

    for (const ring of outerRings(feature.geometry)) {
      const local = ring
        .map(([lon, lat]) => geoPointToLocal(origin, { lon, lat }))
        .filter((point) => Number.isFinite(point.xM) && Number.isFinite(point.yM));
      if (local.length < 3) continue;
      const shifted = local.map((point) => ({ xM: point.xM + shift.xM, yM: point.yM + shift.yM }));
      const hull = convexHull([...local, ...shifted]);
      if (hull.length >= 3) shadows.push(hull);
    }
  }

  return shadows;
}

function treeShadows(
  origin: GeoPoint,
  trees: PlaySafeTree[],
  localDateTime: string,
): LocalShadow[] {
  const solar = solarPosition(origin, localDateTime, 540);
  if (!solar.isDaylight || solar.elevationDeg <= 1) return [];
  const elevation = (solar.elevationDeg * Math.PI) / 180;
  const azimuth = (solar.azimuthDeg * Math.PI) / 180;
  const shadows: LocalShadow[] = [];

  for (const tree of trees) {
    const local = geoPointToLocal(origin, tree.point);
    if (Math.hypot(local.xM, local.yM) > 90) continue;
    const lengthM = tree.heightM / Math.tan(elevation);
    if (!Number.isFinite(lengthM) || lengthM <= 0) continue;
    const shift = {
      xM: -Math.sin(azimuth) * lengthM,
      yM: -Math.cos(azimuth) * lengthM,
    };
    const base: LocalPoint[] = [];
    const shifted: LocalPoint[] = [];
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      const point = {
        xM: local.xM + Math.cos(angle) * tree.crownRadiusM,
        yM: local.yM + Math.sin(angle) * tree.crownRadiusM,
      };
      base.push(point);
      shifted.push({ xM: point.xM + shift.xM, yM: point.yM + shift.yM });
    }
    const hull = convexHull([...base, ...shifted]);
    if (hull.length >= 3) shadows.push(hull);
  }

  return shadows;
}

export function playSafeShadowPolygons(
  place: PlayPlace,
  buildings: PlaySafeBuildingCollection,
  trees: PlaySafeTree[],
  localDateTime: string,
): GeoPoint[][] {
  return [
    ...buildingShadows(place.point, buildings, localDateTime),
    ...treeShadows(place.point, trees, localDateTime),
  ].map((polygon) => polygon.map((point) => localPointToGeo(place.point, point)));
}

function sampleLocalPoints(radiusM = 24) {
  const points: LocalPoint[] = [{ xM: 0, yM: 0 }];
  for (const radius of [radiusM * 0.45, radiusM]) {
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      points.push({ xM: Math.cos(angle) * radius, yM: Math.sin(angle) * radius });
    }
  }
  return points;
}

function samplePlacePoints(place: PlayPlace) {
  if (!place.boundary || place.boundary.length < 3) return sampleLocalPoints();
  const polygon = place.boundary.map((point) => geoPointToLocal(place.point, point));
  const xs = polygon.map((point) => point.xM);
  const ys = polygon.map((point) => point.yM);
  const minX = Math.max(-60, Math.min(...xs));
  const maxX = Math.min(60, Math.max(...xs));
  const minY = Math.max(-60, Math.min(...ys));
  const maxY = Math.min(60, Math.max(...ys));
  const span = Math.max(maxX - minX, maxY - minY);
  const step = clamp(span / 6, 7, 16);
  const samples: LocalPoint[] = [];

  for (let xM = minX; xM <= maxX; xM += step) {
    for (let yM = minY; yM <= maxY; yM += step) {
      const point = { xM, yM };
      if (pointInPolygon(point, polygon)) samples.push(point);
      if (samples.length >= 36) return samples;
    }
  }

  return samples.length >= 5 ? samples : sampleLocalPoints();
}

function surfaceHeat(place: PlayPlace) {
  const surface = String(place.tags.surface || "").toLowerCase();
  const label = surface || undefined;
  const high = new Set(["asphalt", "concrete", "paving_stones", "rubber", "urethane", "tartan", "artificial_turf"]);
  const low = new Set(["grass", "sand", "woodchips", "wood", "earth", "ground"]);
  const medium = new Set(["paved", "gravel", "fine_gravel", "compacted", "sett", "cobblestone"]);

  if (!surface) return { signal: "정보 없음" as const, load: 0, label };
  if (high.has(surface)) return { signal: "높음" as const, load: 58, label };
  if (low.has(surface)) return { signal: "낮음" as const, load: 8, label };
  if (medium.has(surface)) return { signal: "보통" as const, load: 30, label };
  return { signal: "정보 없음" as const, load: 0, label };
}

function labelForFit(fitScore: number): PlaySafeAssessment["label"] {
  if (fitScore >= 75) return "상대적으로 쾌적";
  if (fitScore >= 58) return "활동 가능성 높음";
  if (fitScore >= 38) return "주의 필요";
  return "시간 조정 권장";
}

function weatherExposure(weather: PlaySafeWeather) {
  const apparentLoad = clamp(((weather.apparentTemperatureC - 23) / 15) * 100, 0, 100);
  const humidityLoad = clamp(((weather.relativeHumidityPct - 55) / 35) * 100, 0, 100);
  const precipitationLoad = weather.precipitationMm >= 1 ? 55 : weather.precipitationMm > 0 ? 20 : 0;
  return clamp(apparentLoad * 0.78 + humidityLoad * 0.12 + precipitationLoad * 0.10, 0, 100);
}

// Product-level conservative comparison heuristic; this is not a medical risk threshold.
export function playSafeAgeProfile(childAge: number): PlaySafeAgeProfile & {
  weatherMultiplier: number;
  directSunMultiplier: number;
  uvMultiplier: number;
  surfaceMultiplier: number;
  durationMultiplier: number;
} {
  if (childAge <= 5) {
    return {
      band: "3-5",
      label: "3–5세 · 보호자 집중",
      rationale: "같은 환경에서도 그늘 부족·강한 UV·긴 활동시간을 더 보수적으로 반영",
      policy: "conservative-product-heuristic",
      weatherMultiplier: 1.06,
      directSunMultiplier: 1.18,
      uvMultiplier: 1.20,
      surfaceMultiplier: 1.10,
      durationMultiplier: 1.25,
    };
  }
  if (childAge <= 8) {
    return {
      band: "6-8",
      label: "6–8세 · 보호자 확인",
      rationale: "그늘·UV·활동시간을 기본 환경점수보다 조금 더 보수적으로 반영",
      policy: "conservative-product-heuristic",
      weatherMultiplier: 1.03,
      directSunMultiplier: 1.10,
      uvMultiplier: 1.10,
      surfaceMultiplier: 1.05,
      durationMultiplier: 1.12,
    };
  }
  return {
    band: "9-12",
    label: "9–12세 · 기본 활동",
    rationale: "환경 노출과 활동시간을 기본 비교 규칙으로 반영",
    policy: "conservative-product-heuristic",
    weatherMultiplier: 1,
    directSunMultiplier: 1,
    uvMultiplier: 1,
    surfaceMultiplier: 1,
    durationMultiplier: 1,
  };
}

function assessAtTime(
  place: PlayPlace,
  buildings: PlaySafeBuildingCollection,
  trees: PlaySafeTree[],
  weather: PlaySafeWeather,
  childAge: number,
  activityMinutes: number,
) {
  const solar = solarPosition(place.point, weather.localDateTime, 540);
  const buildingShadowPolygons = buildingShadows(place.point, buildings, weather.localDateTime);
  const treeShadowPolygons = treeShadows(place.point, trees, weather.localDateTime);
  const samples = samplePlacePoints(place);
  const cloudFactor = clamp(1 - weather.cloudCoverPct / 130, 0.25, 1);
  const daylightStrength = solar.isDaylight ? clamp(solar.elevationDeg / 55, 0.15, 1) * cloudFactor : 0;
  const baseWeatherExposure = weatherExposure(weather);
  let shadedCount = 0;
  let treeShadedCount = 0;
  const mappedTreeCount = trees.filter((tree) => {
    const local = geoPointToLocal(place.point, tree.point);
    return Math.hypot(local.xM, local.yM) <= 90;
  }).length;

  const heatSamples = samples.map((local) => {
    const buildingShaded = buildingShadowPolygons.some((shadow) => pointInPolygon(local, shadow));
    const treeShaded = treeShadowPolygons.some((shadow) => pointInPolygon(local, shadow));
    const shaded = !solar.isDaylight || buildingShaded || treeShaded;
    if (shaded) shadedCount += 1;
    if (treeShaded) treeShadedCount += 1;
    const directSolarLoad = shaded ? 0 : 100 * daylightStrength;
    const exposurePct = clamp(baseWeatherExposure * 0.64 + directSolarLoad * 0.36, 0, 100);
    return {
      point: localPointToGeo(place.point, local),
      shaded,
      exposurePct,
    };
  });

  const shadePct = (shadedCount / Math.max(1, samples.length)) * 100;
  const treeShadePct = (treeShadedCount / Math.max(1, samples.length)) * 100;
  const directSunPct = solar.isDaylight ? 100 - shadePct : 0;
  const ageProfile = playSafeAgeProfile(childAge);
  const durationLoad = clamp(
    ((activityMinutes - 20) / 70) * 18 * ageProfile.durationMultiplier,
    0,
    24,
  );
  const directSolarExposure = directSunPct * daylightStrength;
  const uvLoad = clamp((weather.uvIndex / 8) * 100, 0, 100);
  const surface = surfaceHeat(place);
  const exposureScore = clamp(
    baseWeatherExposure * 0.52 * ageProfile.weatherMultiplier
      + directSolarExposure * 0.28 * ageProfile.directSunMultiplier
      + uvLoad * 0.08 * ageProfile.uvMultiplier
      + surface.load * daylightStrength * 0.07 * ageProfile.surfaceMultiplier
      + durationLoad,
    0,
    100,
  );
  const fitScore = 100 - exposureScore;
  const reasons = [
    `체감온도 ${weather.apparentTemperatureC.toFixed(1)}°C`,
    `UV ${weather.uvIndex.toFixed(1)}`,
    `예상 그늘 ${shadePct.toFixed(0)}%`,
    `${activityMinutes}분 활동 기준`,
  ];
  if (surface.label) reasons.push(`표면 ${surface.label} · 열축적 신호 ${surface.signal}`);
  if (mappedTreeCount > 0) reasons.push(`OSM 수목 ${mappedTreeCount}그루 · 추정 수목 그늘 ${treeShadePct.toFixed(0)}%`);
  if (weather.precipitationMm > 0) reasons.push(`강수 ${weather.precipitationMm.toFixed(1)}mm/h`);
  reasons.push(`${ageProfile.label} · ${ageProfile.rationale}`);

  return {
    ageProfile: {
      band: ageProfile.band,
      label: ageProfile.label,
      rationale: ageProfile.rationale,
      policy: ageProfile.policy,
    },
    shadePct,
    directSunPct,
    exposureScore,
    fitScore,
    uvIndex: weather.uvIndex,
    surfaceHeatSignal: surface.signal,
    surfaceLabel: surface.label,
    treeShadePct,
    mappedTreeCount,
    label: labelForFit(fitScore),
    reasons,
    heatSamples,
  };
}

export function assessPlayPlace(
  place: PlayPlace,
  buildings: PlaySafeBuildingCollection,
  trees: PlaySafeTree[],
  weather: PlaySafeWeather,
  childAge: number,
  activityMinutes: number,
  timelineWeather: PlaySafeWeather[] = [],
): PlaySafeAssessment {
  const now = assessAtTime(place, buildings, trees, weather, childAge, activityMinutes);
  const timeline = timelineWeather.map((sample) => {
    const assessment = assessAtTime(place, buildings, trees, sample, childAge, activityMinutes);
    return {
      localDateTime: sample.localDateTime,
      fitScore: assessment.fitScore,
      shadePct: assessment.shadePct,
      apparentTemperatureC: sample.apparentTemperatureC,
      uvIndex: sample.uvIndex,
      label: assessment.label,
    };
  });

  return {
    place,
    childAge,
    activityMinutes,
    ...now,
    timeline,
  };
}
