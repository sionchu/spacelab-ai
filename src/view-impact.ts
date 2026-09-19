import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { viewTargetSamples } from "./analysis";
import { geoPointToLocal } from "./model";
import type { BuildingMass, LocalPoint, Site, Viewpoint } from "./types";

export type BuildingContextCollection = FeatureCollection<Polygon | MultiPolygon>;

export type ViewImpactResult = {
  supported: boolean;
  visibleSamples: number;
  totalSamples: number;
  visibleRatioPct: number;
  classification: "mostly-visible" | "partially-visible" | "mostly-occluded" | "unsupported";
  blockedSampleIds: string[];
  sampleStepM: number;
  source: "context-building-geojson" | "unsupported";
  scope: "surrounding-buildings-only";
};

type LocalBuilding = {
  heightM: number;
  rings: LocalPoint[][];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  containsObserver: boolean;
};

function pointInRing(point: LocalPoint, ring: LocalPoint[]) {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    const crosses = ((a.yM > point.yM) !== (b.yM > point.yM))
      && point.xM < ((b.xM - a.xM) * (point.yM - a.yM)) / ((b.yM - a.yM) || Number.EPSILON) + a.xM;
    if (crosses) inside = !inside;
  }
  return inside;
}

function geometryOuterRings(geometry: Polygon | MultiPolygon) {
  if (geometry.type === "Polygon") return geometry.coordinates[0] ? [geometry.coordinates[0]] : [];
  return geometry.coordinates.flatMap((polygon) => polygon[0] ? [polygon[0]] : []);
}

function numberValue(value: unknown, fallback: number) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildingOverlapsSite(site: Site, rings: Array<Array<[number, number]>>) {
  const siteRing = site.boundary.map((point) => geoPointToLocal(site.center, point));
  if (siteRing.length < 3) return false;

  for (const ring of rings) {
    const localRing = ring.map(([lon, lat]) => geoPointToLocal(site.center, { lon, lat }));
    if (localRing.some((point) => pointInRing(point, siteRing))) return true;
    if (siteRing.some((point) => pointInRing(point, localRing))) return true;
  }
  return false;
}

function prepareBuildings(
  viewpoint: Viewpoint,
  site: Site,
  context: BuildingContextCollection,
): LocalBuilding[] {
  const buildings: LocalBuilding[] = [];

  for (const feature of context.features) {
    if (!feature.geometry) continue;
    const geoRings = geometryOuterRings(feature.geometry) as Array<Array<[number, number]>>;
    if (!geoRings.length || buildingOverlapsSite(site, geoRings)) continue;

    const rings = geoRings
      .map((ring) => ring.map(([lon, lat]) => geoPointToLocal(viewpoint.point, { lon, lat })))
      .filter((ring) => ring.length >= 3);
    if (!rings.length) continue;

    const points = rings.flat();
    const xs = points.map((point) => point.xM);
    const ys = points.map((point) => point.yM);
    const heightM = Math.max(1, numberValue(feature.properties?.heightM, 9));

    buildings.push({
      heightM,
      rings,
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
      containsObserver: rings.some((ring) => pointInRing({ xM: 0, yM: 0 }, ring)),
    });
  }

  return buildings;
}

function isBlocked(
  point: LocalPoint,
  rayHeightM: number,
  buildings: LocalBuilding[],
  clearanceM: number,
) {
  for (const building of buildings) {
    if (building.containsObserver) continue;
    if (point.xM < building.minX || point.xM > building.maxX || point.yM < building.minY || point.yM > building.maxY) continue;
    if (building.heightM <= rayHeightM + clearanceM) continue;
    if (building.rings.some((ring) => pointInRing(point, ring))) return true;
  }
  return false;
}

/**
 * Deterministic early-stage visibility estimate against loaded surrounding-building
 * footprints and height attributes. Terrain and facade/window semantics are excluded.
 */
export function viewImpact(
  viewpoint: Viewpoint,
  site: Site,
  mass: BuildingMass,
  context: BuildingContextCollection,
  options: { sampleStepM?: number; clearanceM?: number } = {},
): ViewImpactResult {
  const sampleStepM = Math.max(2, options.sampleStepM ?? 4);
  const clearanceM = Math.max(0.1, options.clearanceM ?? 0.75);
  const targets = viewTargetSamples(site, mass);
  const buildings = prepareBuildings(viewpoint, site, context);

  if (!context.features.length) {
    return {
      supported: false,
      visibleSamples: 0,
      totalSamples: targets.length,
      visibleRatioPct: 0,
      classification: "unsupported",
      blockedSampleIds: [],
      sampleStepM,
      source: "unsupported",
      scope: "surrounding-buildings-only",
    };
  }

  const blockedSampleIds: string[] = [];
  const eyeHeightM = Math.max(1.2, viewpoint.eyeHeightM);

  for (const target of targets) {
    const local = geoPointToLocal(viewpoint.point, target.point);
    const distanceM = Math.hypot(local.xM, local.yM);
    if (!Number.isFinite(distanceM) || distanceM < 1) continue;

    const targetHeightM = Math.max(0, mass.heightM * target.heightFraction);
    let blocked = false;
    const maxPathM = distanceM * 0.94;

    for (let pathM = sampleStepM; pathM < maxPathM; pathM += sampleStepM) {
      const ratio = pathM / distanceM;
      const point = { xM: local.xM * ratio, yM: local.yM * ratio };
      const rayHeightM = eyeHeightM + (targetHeightM - eyeHeightM) * ratio;
      if (isBlocked(point, rayHeightM, buildings, clearanceM)) {
        blocked = true;
        break;
      }
    }

    if (blocked) blockedSampleIds.push(target.id);
  }

  const totalSamples = targets.length;
  const visibleSamples = Math.max(0, totalSamples - blockedSampleIds.length);
  const visibleRatioPct = totalSamples ? (visibleSamples / totalSamples) * 100 : 0;
  const classification = visibleRatioPct >= 75
    ? "mostly-visible"
    : visibleRatioPct >= 25
      ? "partially-visible"
      : "mostly-occluded";

  return {
    supported: true,
    visibleSamples,
    totalSamples,
    visibleRatioPct,
    classification,
    blockedSampleIds,
    sampleStepM,
    source: "context-building-geojson",
    scope: "surrounding-buildings-only",
  };
}
