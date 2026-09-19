import type { Feature, FeatureCollection, Geometry, Polygon, MultiPolygon } from "geojson";

type BuildingGeometry = Polygon | MultiPolygon;
type BuildingFeature = Feature<BuildingGeometry>;

const APP_USER_AGENT = "SpaceLab/0.2 (+https://github.com/sionchu/spacelab-ai)";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
] as const;

function bboxAround(lon: number, lat: number, radiusM: number) {
  const latDelta = radiusM / 111_320;
  const lonDelta = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return {
    west: lon - lonDelta,
    south: lat - latDelta,
    east: lon + lonDelta,
    north: lat + latDelta,
  };
}

function numberFrom(value: unknown) {
  if (value === undefined || value === null) return Number.NaN;
  return Number.parseFloat(String(value).replace(/[^0-9.-]/g, ""));
}

function normalizedHeight(properties: Record<string, unknown>) {
  const directCandidates = [
    properties.HEIGHT,
    properties.height,
    properties.BLD_HGT,
    properties.bld_hgt,
  ];
  for (const value of directCandidates) {
    const direct = numberFrom(value);
    if (Number.isFinite(direct) && direct > 1) return Math.min(300, direct);
  }

  const levelCandidates = [
    properties.GRND_FLR,
    properties.grnd_flr,
    properties["building:levels"],
    properties.levels,
  ];
  for (const value of levelCandidates) {
    const levels = numberFrom(value);
    if (Number.isFinite(levels) && levels > 0) return Math.min(300, levels * 3.2);
  }

  return 9;
}

function normalizeCollection(
  input: FeatureCollection,
  sourceName: string,
): FeatureCollection<BuildingGeometry> {
  const features: BuildingFeature[] = [];
  for (const feature of input.features ?? []) {
    const geometry = feature.geometry as Geometry | null;
    if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) continue;
    const properties = (feature.properties ?? {}) as Record<string, unknown>;
    features.push({
      ...feature,
      geometry,
      properties: {
        ...properties,
        source: sourceName,
        heightM: normalizedHeight(properties),
      },
    } as BuildingFeature);
  }
  return { type: "FeatureCollection", features };
}

async function vworldBuildings(
  lon: number,
  lat: number,
  radiusM: number,
): Promise<FeatureCollection<BuildingGeometry> | undefined> {
  const key = process.env.VWORLD_API_KEY?.trim();
  if (!key) return undefined;

  const domain = process.env.VWORLD_DOMAIN?.trim() || undefined;
  const box = bboxAround(lon, lat, radiusM);
  const url = new URL("https://api.vworld.kr/req/data");
  const params: Record<string, string> = {
    service: "data",
    request: "GetFeature",
    version: "2.0",
    data: "F_FAC_BUILDING",
    geometry: "true",
    attribute: "true",
    crs: "EPSG:4326",
    geomFilter: `BOX(${box.west} ${box.south},${box.east} ${box.north})`,
    size: "1000",
    page: "1",
    format: "json",
    key,
  };
  if (domain) params.domain = domain;
  Object.entries(params).forEach(([name, value]) => url.searchParams.set(name, value));

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
    next: { revalidate: 21_600 },
  });
  if (!response.ok) {
    console.warn("[buildings:vworld] HTTP", response.status);
    return undefined;
  }
  const payload = await response.json();
  const status = payload?.response?.status ?? payload?.status;
  if (status !== "OK") {
    const code = payload?.response?.error?.code ?? payload?.error?.code ?? status;
    console.warn("[buildings:vworld] provider status", String(code || "unknown"));
    return undefined;
  }

  const collection = payload?.response?.result?.featureCollection as FeatureCollection | undefined;
  if (!collection?.features?.length) return undefined;
  const normalized = normalizeCollection(collection, "VWorld GIS건물통합정보");
  return normalized.features.length ? normalized : undefined;
}

type OverpassElement = {
  id: number;
  type: string;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
};

async function osmBuildings(
  lon: number,
  lat: number,
  radiusM: number,
): Promise<FeatureCollection<BuildingGeometry>> {
  const box = bboxAround(lon, lat, radiusM);
  const bbox = [box.south, box.west, box.north, box.east]
    .map((value) => value.toFixed(7))
    .join(",");
  const query = `[out:json][timeout:12];way["building"](${bbox});out tags geom;`;

  let payload: { elements?: OverpassElement[] } | undefined;
  let lastError: Error | undefined;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const url = new URL(endpoint);
      url.searchParams.set("data", query);
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": APP_USER_AGENT,
          Referer: "https://github.com/sionchu/spacelab-ai",
        },
        signal: AbortSignal.timeout(15_000),
        next: { revalidate: 21_600 },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      payload = await response.json() as { elements?: OverpassElement[] };
      break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn("[buildings:osm] endpoint failed", new URL(endpoint).host, lastError.message);
    }
  }

  if (!payload) throw lastError ?? new Error("No Overpass endpoint available");
  const features: BuildingFeature[] = [];

  for (const element of payload.elements ?? []) {
    if (element.type !== "way" || !element.geometry || element.geometry.length < 3) continue;
    const coordinates = element.geometry.map((point) => [point.lon, point.lat]);
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) coordinates.push([...first]);
    const properties: Record<string, unknown> = {
      ...(element.tags ?? {}),
      source: "OpenStreetMap",
    };
    properties.heightM = normalizedHeight(properties);
    features.push({
      type: "Feature",
      id: element.id,
      properties,
      geometry: { type: "Polygon", coordinates: [coordinates] },
    });
  }

  return { type: "FeatureCollection", features };
}

export async function nearbyBuildings(
  lon: number,
  lat: number,
  radiusM: number,
): Promise<FeatureCollection<BuildingGeometry>> {
  const provider = (process.env.SPACELAB_BUILDING_PROVIDER || "auto").toLowerCase();

  if (provider !== "osm") {
    try {
      const vworld = await vworldBuildings(lon, lat, radiusM);
      if (vworld) return vworld;
      if (provider === "vworld") return { type: "FeatureCollection", features: [] };
    } catch (error) {
      console.warn("[buildings:vworld] request failed", error instanceof Error ? error.message : String(error));
      if (provider === "vworld") return { type: "FeatureCollection", features: [] };
    }
  }

  try {
    return await osmBuildings(lon, lat, radiusM);
  } catch (error) {
    console.warn("[buildings:osm] request failed", error instanceof Error ? error.message : String(error));
    return { type: "FeatureCollection", features: [] };
  }
}