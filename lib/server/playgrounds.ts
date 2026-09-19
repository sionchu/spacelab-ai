import type { Feature, FeatureCollection, Polygon } from "geojson";
import type { PlayPlace } from "@/src/playsafe";

const APP_USER_AGENT = "PlaySafe/0.1 (+https://github.com/sionchu/spacelab-ai)";
const ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
  "https://overpass-api.de/api/interpreter",
] as const;

type Element = {
  id: number;
  type: "node" | "way" | "relation";
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
};

function distanceM(aLon: number, aLat: number, bLon: number, bLat: number) {
  const latScale = 111_320;
  const lonScale = 111_320 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot((bLon - aLon) * lonScale, (bLat - aLat) * latScale);
}

function displayName(element: Element, kind: PlayPlace["kind"]) {
  const name = element.tags?.["name:ko"] || element.tags?.name;
  if (name) return name;
  return kind === "playground" ? "이름 없는 어린이 놀이터" : "이름 없는 공원";
}

async function queryOverpass<T>(query: string, label: string): Promise<T> {
  const requests = ENDPOINTS.map(async (endpoint) => {
    const url = new URL(endpoint);
    url.searchParams.set("data", query);
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": APP_USER_AGENT,
        Referer: "https://github.com/sionchu/spacelab-ai",
      },
      signal: AbortSignal.timeout(4_500),
      next: { revalidate: 3_600 },
    });
    if (!response.ok) throw new Error(new URL(endpoint).host + " HTTP " + response.status);
    return await response.json() as T;
  });

  try {
    return await Promise.any(requests);
  } catch (error) {
    console.warn("[playsafe:" + label + "] all endpoints failed", error instanceof Error ? error.message : String(error));
    throw new Error("PlaySafe map data provider unavailable");
  }
}

export async function findNearbyPlayPlaces(
  lon: number,
  lat: number,
  radiusM = 900,
  limit = 4,
): Promise<PlayPlace[]> {
  const query = `[out:json][timeout:8];(
    nwr["leisure"="playground"](around:${radiusM},${lat},${lon});
    nwr["leisure"="park"](around:${radiusM},${lat},${lon});
  );out center tags 30;`;

  const payload = await queryOverpass<{ elements?: Element[] }>(query, "places");

  const items = (payload.elements ?? []).flatMap((element): PlayPlace[] => {
    const point = {
      lat: Number(element.lat ?? element.center?.lat),
      lon: Number(element.lon ?? element.center?.lon),
    };
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return [];
    const kind = element.tags?.leisure === "playground" ? "playground" : "park";
    return [{
      id: `osm-${element.type}-${element.id}`,
      name: displayName(element, kind),
      kind,
      point,
      distanceM: distanceM(lon, lat, point.lon, point.lat),
      tags: element.tags ?? {},
    }];
  });

  items.sort((a, b) => {
    const kindRank = (item: PlayPlace) => item.kind === "playground" ? 0 : 1;
    const namedRank = (item: PlayPlace) => item.tags.name || item.tags["name:ko"] ? 0 : 1;
    return kindRank(a) - kindRank(b) || namedRank(a) - namedRank(b) || a.distanceM - b.distanceM;
  });

  const deduped: PlayPlace[] = [];
  for (const item of items) {
    const duplicate = deduped.some((prior) =>
      distanceM(prior.point.lon, prior.point.lat, item.point.lon, item.point.lat) < 35
      && prior.kind === item.kind);
    if (!duplicate) deduped.push(item);
    if (deduped.length >= limit) break;
  }

  return deduped;
}

function bboxAround(point: { lon: number; lat: number }, radiusM: number) {
  const latDelta = radiusM / 111_320;
  const lonDelta = radiusM / (111_320 * Math.cos((point.lat * Math.PI) / 180));
  return [
    point.lat - latDelta,
    point.lon - lonDelta,
    point.lat + latDelta,
    point.lon + lonDelta,
  ].map((value) => value.toFixed(7)).join(",");
}

function numberFrom(value: unknown) {
  if (value === undefined || value === null) return Number.NaN;
  return Number.parseFloat(String(value).replace(/[^0-9.-]/g, ""));
}

function buildingHeightM(tags: Record<string, string>) {
  const direct = numberFrom(tags.height);
  if (Number.isFinite(direct) && direct > 1) return Math.min(300, direct);
  const levels = numberFrom(tags["building:levels"]);
  if (Number.isFinite(levels) && levels > 0) return Math.min(300, levels * 3.2);
  return 9;
}

export async function buildingsAroundPlayPlaces(
  places: PlayPlace[],
  radiusM = 180,
): Promise<FeatureCollection<Polygon>> {
  if (!places.length) return { type: "FeatureCollection", features: [] };

  const clauses = places
    .slice(0, 4)
    .map((place) => `way["building"](${bboxAround(place.point, radiusM)});`)
    .join("");
  const query = `[out:json][timeout:8];(${clauses});out tags geom;`;

  let payload: { elements?: Element[] };
  try {
    payload = await queryOverpass<{ elements?: Element[] }>(query, "buildings");
  } catch {
    return { type: "FeatureCollection", features: [] };
  }

  const features: Array<Feature<Polygon>> = [];
  const seen = new Set<number>();
  for (const element of payload.elements ?? []) {
    if (element.type !== "way" || seen.has(element.id) || !element.geometry || element.geometry.length < 3) continue;
    seen.add(element.id);
    const coordinates = element.geometry.map((point) => [point.lon, point.lat]);
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) coordinates.push([...first]);
    const tags = element.tags ?? {};
    features.push({
      type: "Feature",
      id: element.id,
      properties: {
        ...tags,
        source: "OpenStreetMap",
        heightM: buildingHeightM(tags),
      },
      geometry: { type: "Polygon", coordinates: [coordinates] },
    });
  }

  return { type: "FeatureCollection", features };
}
