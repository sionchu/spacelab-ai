import {
  computeShadowPolygon,
  estimateGfa,
  footprintAreaM2,
  geoPointToLocal,
  localPointToGeo,
  rotatedFootprintPoints,
} from "./model";
import type { BuildingMass, GeoPoint, LocalPoint, Site } from "./types";

export type SunStudySample = {
  localDateTime: string;
  state: "sun" | "shadow" | "night";
  elevationDeg: number;
  azimuthDeg: number;
};

export type DirectSunStudy = {
  point: GeoPoint;
  date: string;
  stepMinutes: number;
  sunMinutes: number;
  shadowMinutes: number;
  daylightMinutes: number;
  samples: SunStudySample[];
  scope: "planned-mass-only";
};

export type ViewTargetSample = {
  id: string;
  point: GeoPoint;
  heightFraction: number;
};

export type PlanningMetrics = {
  siteAreaM2: number;
  footprintAreaM2: number;
  estimatedGfaM2: number;
  coverageRatioPct: number;
  floorAreaRatioPct: number;
};

function pointInPolygon(point: LocalPoint, polygon: LocalPoint[]) {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects = ((a.yM > point.yM) !== (b.yM > point.yM))
      && (point.xM < ((b.xM - a.xM) * (point.yM - a.yM)) / ((b.yM - a.yM) || Number.EPSILON) + a.xM);
    if (intersects) inside = !inside;
  }
  return inside;
}

export function siteAreaM2(site: Site) {
  const local = site.boundary.map((point) => geoPointToLocal(site.center, point));
  if (local.length < 3) return 0;
  return Math.abs(local.reduce((area, point, index) => {
    const next = local[(index + 1) % local.length];
    return area + point.xM * next.yM - next.xM * point.yM;
  }, 0) / 2);
}

export function planningMetrics(site: Site, mass: BuildingMass): PlanningMetrics {
  const siteArea = siteAreaM2(site);
  const footprint = footprintAreaM2(mass.footprint);
  const gfa = estimateGfa(mass);
  return {
    siteAreaM2: siteArea,
    footprintAreaM2: footprint,
    estimatedGfaM2: gfa,
    coverageRatioPct: siteArea > 0 ? (footprint / siteArea) * 100 : 0,
    floorAreaRatioPct: siteArea > 0 ? (gfa / siteArea) * 100 : 0,
  };
}

function timeLabel(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Deterministic ground-point direct-sun estimate against the current planned mass.
 * It intentionally does not claim surrounding-city occlusion until external building
 * context is represented as analysis geometry.
 */
export function directSunStudy(
  mass: BuildingMass,
  site: Site,
  point: GeoPoint,
  date: string,
  timeZoneOffsetMinutes: number,
  options: { startMinutes?: number; endMinutes?: number; stepMinutes?: number } = {},
): DirectSunStudy {
  const startMinutes = options.startMinutes ?? 9 * 60;
  const endMinutes = options.endMinutes ?? 18 * 60;
  const stepMinutes = Math.max(5, options.stepMinutes ?? 15);
  const localPoint = geoPointToLocal(site.center, point);
  const samples: SunStudySample[] = [];
  let sunMinutes = 0;
  let shadowMinutes = 0;
  let daylightMinutes = 0;

  for (let minute = startMinutes; minute < endMinutes; minute += stepMinutes) {
    const localDateTime = `${date}T${timeLabel(minute)}`;
    const shadow = computeShadowPolygon(mass, site.center, localDateTime, timeZoneOffsetMinutes);
    if (!shadow.solar.isDaylight) {
      samples.push({
        localDateTime,
        state: "night",
        elevationDeg: shadow.solar.elevationDeg,
        azimuthDeg: shadow.solar.azimuthDeg,
      });
      continue;
    }

    daylightMinutes += stepMinutes;
    const blocked = shadow.points.length >= 3 && pointInPolygon(localPoint, shadow.points);
    if (blocked) shadowMinutes += stepMinutes;
    else sunMinutes += stepMinutes;

    samples.push({
      localDateTime,
      state: blocked ? "shadow" : "sun",
      elevationDeg: shadow.solar.elevationDeg,
      azimuthDeg: shadow.solar.azimuthDeg,
    });
  }

  return {
    point,
    date,
    stepMinutes,
    sunMinutes,
    shadowMinutes,
    daylightMinutes,
    samples,
    scope: "planned-mass-only",
  };
}



export function viewTargetSamples(
  site: Site,
  mass: BuildingMass,
  heightFractions: number[] = [0.25, 0.5, 0.75, 1],
): ViewTargetSample[] {
  const localFootprint = rotatedFootprintPoints(mass).map((point) => ({
    xM: point.xM + mass.position.eastM,
    yM: point.yM + mass.position.northM,
  }));
  const maxVertices = 8;
  const vertexStep = Math.max(1, Math.ceil(localFootprint.length / maxVertices));
  const selectedVertices = localFootprint.filter((_, index) => index % vertexStep === 0).slice(0, maxVertices);
  const centerLocal = {
    xM: mass.position.eastM,
    yM: mass.position.northM,
  };

  const horizontalSamples = [
    { id: "center", point: centerLocal },
    ...selectedVertices.map((point, index) => ({ id: `v${index + 1}`, point })),
  ];

  return horizontalSamples.flatMap((sample) => heightFractions.map((heightFraction) => ({
    id: `${sample.id}-h${Math.round(heightFraction * 100)}`,
    point: localPointToGeo(site.center, sample.point),
    heightFraction,
  })));
}

export function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder}m`;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}
