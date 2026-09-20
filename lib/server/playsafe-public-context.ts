import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { lineString, point, pointToLineDistance } from "@turf/turf";
import type { GeoPoint } from "@/src/types";
import type { PlaySafePublicContext, PlaySafeWalkingRoute } from "@/src/playsafe";

type RawPoint = {
  id: string;
  name: string;
  address?: string;
  lat: number;
  lon: number;
  [key: string]: unknown;
};

type PublicContextFile = {
  generatedAt: string;
  source: string;
  datasets: {
    parks: { publicDataPk: number; rows: RawPoint[] };
    childZones: { publicDataPk: number; rows: RawPoint[] };
    childAccidentHotspots: { publicDataPk: number; rows: RawPoint[] };
    childCenters: { publicDataPk: number; rows: RawPoint[] };
    toilets: { publicDataPk: number; rows: RawPoint[] };
  };
};

let cached: Promise<PublicContextFile> | undefined;

function distanceM(a: GeoPoint, b: GeoPoint) {
  const toRad = (value: number) => value * Math.PI / 180;
  const earthRadiusM = 6_371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * earthRadiusM * Math.asin(Math.min(1, Math.sqrt(h)));
}

async function loadPublicContext() {
  if (!cached) {
    cached = (async () => {
      const file = path.join(process.cwd(), "data", "playsafe", "public-context.json.gz");
      const compressed = await readFile(file);
      return JSON.parse(gunzipSync(compressed).toString("utf8")) as PublicContextFile;
    })();
  }
  return cached;
}

function nearby<T extends RawPoint>(
  rows: T[],
  center: GeoPoint,
  radiusM: number,
  limit: number,
) {
  return rows
    .map((row) => ({
      ...row,
      point: { lon: row.lon, lat: row.lat },
      distanceM: Math.round(distanceM(center, { lon: row.lon, lat: row.lat })),
    }))
    .filter((row) => row.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
}

function routeCandidates<T extends RawPoint>(
  rows: T[],
  route: GeoPoint[],
  corridorM: number,
) {
  if (route.length < 2) return [];
  const latPad = corridorM / 111_320;
  const avgLat = route.reduce((sum, value) => sum + value.lat, 0) / route.length;
  const lonPad = corridorM / (111_320 * Math.max(0.2, Math.cos(avgLat * Math.PI / 180)));
  const minLat = Math.min(...route.map((value) => value.lat)) - latPad;
  const maxLat = Math.max(...route.map((value) => value.lat)) + latPad;
  const minLon = Math.min(...route.map((value) => value.lon)) - lonPad;
  const maxLon = Math.max(...route.map((value) => value.lon)) + lonPad;
  const line = lineString(route.map((value) => [value.lon, value.lat]));

  return rows
    .filter((row) =>
      row.lat >= minLat
      && row.lat <= maxLat
      && row.lon >= minLon
      && row.lon <= maxLon)
    .map((row) => ({
      ...row,
      point: { lon: row.lon, lat: row.lat },
      distanceToRouteM: Math.round(pointToLineDistance(
        point([row.lon, row.lat]),
        line,
        { units: "meters" },
      )),
    }))
    .filter((row) => row.distanceToRouteM <= corridorM)
    .sort((a, b) => a.distanceToRouteM - b.distanceToRouteM);
}

export async function playSafeRoutePublicContext(
  route: GeoPoint[],
): Promise<Pick<
  PlaySafeWalkingRoute,
  "childZones" | "childAccidentHotspots" | "toilets" | "summary"
>> {
  const data = await loadPublicContext();

  const childZones = routeCandidates(data.datasets.childZones.rows, route, 120)
    .slice(0, 12)
    .map((row) => ({
      id: row.id,
      name: row.name,
      facilityType: String(row.facilityType || ""),
      point: row.point,
      distanceToRouteM: row.distanceToRouteM,
      cctvCount: Number(row.cctvCount || 0),
    }));

  const rawHotspots = routeCandidates(data.datasets.childAccidentHotspots.rows, route, 150);
  const hotspotGroups = new Map<string, {
    id: string;
    name: string;
    point: GeoPoint;
    distanceToRouteM: number;
    accidentTypes: Set<string>;
    years: Set<string>;
    occurrences: number;
    casualties: number;
  }>();
  for (const row of rawHotspots) {
    const key = row.lat.toFixed(3) + "," + row.lon.toFixed(3);
    const current = hotspotGroups.get(key);
    if (!current) {
      hotspotGroups.set(key, {
        id: row.id,
        name: row.name,
        point: row.point,
        distanceToRouteM: row.distanceToRouteM,
        accidentTypes: new Set([String(row.accidentType || "")].filter(Boolean)),
        years: new Set([String(row.year || "")].filter(Boolean)),
        occurrences: Number(row.occurrences || 0),
        casualties: Number(row.casualties || 0),
      });
      continue;
    }
    current.distanceToRouteM = Math.min(current.distanceToRouteM, row.distanceToRouteM);
    const accidentType = String(row.accidentType || "");
    const year = String(row.year || "");
    if (accidentType) current.accidentTypes.add(accidentType);
    if (year) current.years.add(year);
    current.occurrences += Number(row.occurrences || 0);
    current.casualties += Number(row.casualties || 0);
  }

  const childAccidentHotspots = [...hotspotGroups.values()]
    .sort((a, b) => a.distanceToRouteM - b.distanceToRouteM)
    .slice(0, 8)
    .map((row) => {
      const years = [...row.years].sort();
      return {
        id: row.id,
        name: row.name,
        accidentType: [...row.accidentTypes].join("·"),
        year: years.length > 1 ? years[0] + "–" + years[years.length - 1] : (years[0] || ""),
        point: row.point,
        distanceToRouteM: row.distanceToRouteM,
        occurrences: row.occurrences,
        casualties: row.casualties,
      };
    });

  const toilets = routeCandidates(data.datasets.toilets.rows, route, 120)
    .slice(0, 6)
    .map((row) => ({
      id: row.id,
      name: row.name,
      address: String(row.address || ""),
      point: row.point,
      distanceToRouteM: row.distanceToRouteM,
      diaperChange: String(row.diaperChange || ""),
      childFixtures: Number(row.childFixtures || 0),
    }));

  return {
    childZones,
    childAccidentHotspots,
    toilets,
    summary: {
      childZones: childZones.length,
      childZoneCctvCount: childZones.reduce((sum, item) => sum + item.cctvCount, 0),
      childAccidentHotspots: childAccidentHotspots.length,
      childFriendlyToilets: toilets.length,
      heatMitigationFacilities: 0,
    },
  };
}

export async function playSafePublicContext(
  center: GeoPoint,
): Promise<PlaySafePublicContext> {
  const data = await loadPublicContext();

  const parks = nearby(data.datasets.parks.rows, center, 1_500, 6).map((row) => ({
    id: row.id,
    name: row.name,
    address: String(row.address || ""),
    point: row.point,
    distanceM: row.distanceM,
    type: String(row.type || ""),
    areaM2: Number(row.areaM2 || 0),
    amusement: String(row.amusement || ""),
    convenience: String(row.convenience || ""),
    exercise: String(row.exercise || ""),
    phone: String(row.phone || ""),
    referenceDate: String(row.referenceDate || ""),
  }));

  const childZones = nearby(data.datasets.childZones.rows, center, 1_200, 10).map((row) => ({
    id: row.id,
    name: row.name,
    address: String(row.address || ""),
    point: row.point,
    distanceM: row.distanceM,
    facilityType: String(row.facilityType || ""),
    cctv: String(row.cctv || ""),
    cctvCount: Number(row.cctvCount || 0),
    active: String(row.active || ""),
    roadWidth: String(row.roadWidth || ""),
    referenceDate: String(row.referenceDate || ""),
  }));

  const rawChildAccidentHotspots = nearby(
    data.datasets.childAccidentHotspots.rows,
    center,
    2_000,
    50,
  );
  const accidentGroups = new Map<string, {
    id: string;
    name: string;
    point: GeoPoint;
    distanceM: number;
    accidentTypes: Set<string>;
    years: Set<string>;
    region: string;
    occurrences: number;
    casualties: number;
    deaths: number;
    seriousInjuries: number;
    minorInjuries: number;
    reportedInjuries: number;
    referenceDate: string;
  }>();
  for (const row of rawChildAccidentHotspots) {
    const key = row.point.lat.toFixed(3) + "," + row.point.lon.toFixed(3);
    const current = accidentGroups.get(key);
    if (!current) {
      accidentGroups.set(key, {
        id: row.id,
        name: row.name,
        point: row.point,
        distanceM: row.distanceM,
        accidentTypes: new Set([String(row.accidentType || "")].filter(Boolean)),
        years: new Set([String(row.year || "")].filter(Boolean)),
        region: String(row.region || ""),
        occurrences: Number(row.occurrences || 0),
        casualties: Number(row.casualties || 0),
        deaths: Number(row.deaths || 0),
        seriousInjuries: Number(row.seriousInjuries || 0),
        minorInjuries: Number(row.minorInjuries || 0),
        reportedInjuries: Number(row.reportedInjuries || 0),
        referenceDate: String(row.referenceDate || ""),
      });
      continue;
    }
    if (row.distanceM < current.distanceM) {
      current.distanceM = row.distanceM;
      current.point = row.point;
      current.name = row.name;
    }
    const accidentType = String(row.accidentType || "");
    const year = String(row.year || "");
    if (accidentType) current.accidentTypes.add(accidentType);
    if (year) current.years.add(year);
    current.occurrences += Number(row.occurrences || 0);
    current.casualties += Number(row.casualties || 0);
    current.deaths += Number(row.deaths || 0);
    current.seriousInjuries += Number(row.seriousInjuries || 0);
    current.minorInjuries += Number(row.minorInjuries || 0);
    current.reportedInjuries += Number(row.reportedInjuries || 0);
    if (String(row.referenceDate || "") > current.referenceDate) {
      current.referenceDate = String(row.referenceDate || "");
    }
  }
  const childAccidentHotspots = [...accidentGroups.values()]
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, 8)
    .map((row) => {
      const years = [...row.years].sort();
      return {
        id: row.id,
        name: row.name,
        point: row.point,
        distanceM: row.distanceM,
        accidentType: [...row.accidentTypes].join("·"),
        year: years.length > 1 ? years[0] + "–" + years[years.length - 1] : (years[0] || ""),
        region: row.region,
        occurrences: row.occurrences,
        casualties: row.casualties,
        deaths: row.deaths,
        seriousInjuries: row.seriousInjuries,
        minorInjuries: row.minorInjuries,
        reportedInjuries: row.reportedInjuries,
        referenceDate: row.referenceDate,
      };
    });

  const childCenters = nearby(data.datasets.childCenters.rows, center, 1_500, 5).map((row) => ({
    id: row.id,
    name: row.name,
    address: String(row.address || ""),
    point: row.point,
    distanceM: row.distanceM,
    phone: String(row.phone || ""),
    capacity: Number(row.capacity || 0),
    current: Number(row.current || 0),
    operatorType: String(row.operatorType || ""),
    referenceDate: String(row.referenceDate || ""),
  }));

  const toilets = nearby(data.datasets.toilets.rows, center, 1_200, 5).map((row) => ({
    id: row.id,
    name: row.name,
    address: String(row.address || ""),
    point: row.point,
    distanceM: row.distanceM,
    openTime: String(row.openTime || ""),
    childFixtures: Number(row.childFixtures || 0),
    diaperChange: String(row.diaperChange || ""),
    emergencyBell: String(row.emergencyBell || ""),
    referenceDate: String(row.referenceDate || ""),
  }));

  return {
    generatedAt: data.generatedAt,
    summary: {
      parks: parks.length,
      childZones: childZones.length,
      childZoneCctvCount: childZones.reduce((sum, item) => sum + item.cctvCount, 0),
      childAccidentHotspots: childAccidentHotspots.length,
      childCenters: childCenters.length,
      childFriendlyToilets: toilets.length,
    },
    parks,
    childZones,
    childAccidentHotspots,
    childCenters,
    toilets,
    sources: {
      parks: data.datasets.parks.publicDataPk,
      childZones: data.datasets.childZones.publicDataPk,
      childAccidentHotspots: data.datasets.childAccidentHotspots.publicDataPk,
      childCenters: data.datasets.childCenters.publicDataPk,
      toilets: data.datasets.toilets.publicDataPk,
    },
  };
}
