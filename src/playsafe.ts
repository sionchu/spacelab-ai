import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { geoPointToLocal, localPointToGeo, solarPosition } from "./model";
import type { GeoPoint, LocalPoint } from "./types";

export type PlayPlaceKind = "playground" | "park";

export type PlayPlace = {
  id: string;
  name: string;
  kind: PlayPlaceKind;
  point: GeoPoint;
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
  label: PlaySafeAssessment["label"];
};

export type PlaySafeAssessment = {
  place: PlayPlace;
  childAge: number;
  activityMinutes: number;
  shadePct: number;
  directSunPct: number;
  exposureScore: number;
  fitScore: number;
  label: "상대적으로 쾌적" | "활동 가능성 높음" | "주의 필요" | "시간 조정 권장";
  reasons: string[];
  heatSamples: HeatSample[];
  timeline: PlaySafeTimelinePoint[];
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

function assessAtTime(
  place: PlayPlace,
  buildings: PlaySafeBuildingCollection,
  weather: PlaySafeWeather,
  childAge: number,
  activityMinutes: number,
) {
  const solar = solarPosition(place.point, weather.localDateTime, 540);
  const shadows = buildingShadows(place.point, buildings, weather.localDateTime);
  const samples = sampleLocalPoints();
  const cloudFactor = clamp(1 - weather.cloudCoverPct / 130, 0.25, 1);
  const daylightStrength = solar.isDaylight ? clamp(solar.elevationDeg / 55, 0.15, 1) * cloudFactor : 0;
  const baseWeatherExposure = weatherExposure(weather);
  let shadedCount = 0;

  const heatSamples = samples.map((local) => {
    const shaded = !solar.isDaylight || shadows.some((shadow) => pointInPolygon(local, shadow));
    if (shaded) shadedCount += 1;
    const directSolarLoad = shaded ? 0 : 100 * daylightStrength;
    const exposurePct = clamp(baseWeatherExposure * 0.64 + directSolarLoad * 0.36, 0, 100);
    return {
      point: localPointToGeo(place.point, local),
      shaded,
      exposurePct,
    };
  });

  const shadePct = (shadedCount / Math.max(1, samples.length)) * 100;
  const directSunPct = solar.isDaylight ? 100 - shadePct : 0;
  const durationLoad = clamp(((activityMinutes - 20) / 70) * 18, 0, 18);
  const directSolarExposure = directSunPct * daylightStrength;
  const exposureScore = clamp(
    baseWeatherExposure * 0.58 + directSolarExposure * 0.34 + durationLoad,
    0,
    100,
  );
  const fitScore = 100 - exposureScore;
  const reasons = [
    `체감온도 ${weather.apparentTemperatureC.toFixed(1)}°C`,
    `예상 건물 그늘 ${shadePct.toFixed(0)}%`,
    `${activityMinutes}분 활동 기준`,
  ];
  if (weather.precipitationMm > 0) reasons.push(`강수 ${weather.precipitationMm.toFixed(1)}mm/h`);
  if (childAge <= 6) reasons.push("어린 연령 프로필 · 보수적 설명 모드");

  return {
    shadePct,
    directSunPct,
    exposureScore,
    fitScore,
    label: labelForFit(fitScore),
    reasons,
    heatSamples,
  };
}

export function assessPlayPlace(
  place: PlayPlace,
  buildings: PlaySafeBuildingCollection,
  weather: PlaySafeWeather,
  childAge: number,
  activityMinutes: number,
  timelineWeather: PlaySafeWeather[] = [],
): PlaySafeAssessment {
  const now = assessAtTime(place, buildings, weather, childAge, activityMinutes);
  const timeline = timelineWeather.map((sample) => {
    const assessment = assessAtTime(place, buildings, sample, childAge, activityMinutes);
    return {
      localDateTime: sample.localDateTime,
      fitScore: assessment.fitScore,
      shadePct: assessment.shadePct,
      apparentTemperatureC: sample.apparentTemperatureC,
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
