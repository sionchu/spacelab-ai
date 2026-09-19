import type { GeoPoint, Site } from "@/src/types";

export type AddressSearchResult = {
  id: string;
  title: string;
  address: string;
  point: GeoPoint;
};

function apiKey() {
  return process.env.VWORLD_API_KEY || process.env.VITE_VWORLD_API_KEY || "";
}

function apiDomain() {
  return process.env.VWORLD_DOMAIN || process.env.VITE_VWORLD_DOMAIN || "";
}

function buildUrl(base: string, params: Record<string, string | number | undefined>) {
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  });
  return url;
}

function responseStatus(payload: any) {
  return payload?.response?.status ?? payload?.status;
}

async function requestJson(url: URL) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("VWorld request failed: " + response.status);
  return response.json();
}

export async function searchAddress(query: string): Promise<AddressSearchResult[]> {
  const key = apiKey();
  if (!key) throw new Error("VWORLD_API_KEY is not configured");
  const trimmed = query.trim();
  if (!trimmed) return [];

  const all: AddressSearchResult[] = [];
  for (const category of ["ROAD", "PARCEL"] as const) {
    const url = buildUrl("https://api.vworld.kr/req/search", {
      service: "search",
      request: "search",
      version: "2.0",
      crs: "EPSG:4326",
      size: 8,
      page: 1,
      query: trimmed,
      type: "ADDRESS",
      category,
      format: "json",
      key,
      domain: apiDomain(),
    });
    const payload = await requestJson(url);
    if (responseStatus(payload) !== "OK") continue;
    for (const item of payload?.response?.result?.items ?? []) {
      const lon = Number(item?.point?.x);
      const lat = Number(item?.point?.y);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      const address = String(item?.address?.road || item?.address?.parcel || item?.title || trimmed);
      all.push({
        id: category + "-" + lon + "-" + lat + "-" + all.length,
        title: String(item?.title || address),
        address,
        point: { lon, lat },
      });
    }
  }

  const seen = new Set<string>();
  return all.filter((item) => {
    const keyValue = item.point.lon.toFixed(7) + "," + item.point.lat.toFixed(7);
    if (seen.has(keyValue)) return false;
    seen.add(keyValue);
    return true;
  }).slice(0, 8);
}

function firstBoundary(geometry: any): GeoPoint[] {
  if (!geometry) return [];
  const coords = geometry.coordinates;
  const ring = geometry.type === "MultiPolygon" ? coords?.[0]?.[0] : coords?.[0];
  if (!Array.isArray(ring)) return [];
  return ring
    .map((coordinate: unknown) => Array.isArray(coordinate)
      ? { lon: Number(coordinate[0]), lat: Number(coordinate[1]) }
      : undefined)
    .filter((value: GeoPoint | undefined): value is GeoPoint =>
      Boolean(value && Number.isFinite(value.lon) && Number.isFinite(value.lat)));
}

function averageCenter(boundary: GeoPoint[], fallback: GeoPoint) {
  const points = boundary.length > 1 ? boundary.slice(0, -1) : boundary;
  if (!points.length) return fallback;
  return {
    lon: points.reduce((sum, value) => sum + value.lon, 0) / points.length,
    lat: points.reduce((sum, value) => sum + value.lat, 0) / points.length,
  };
}

export async function parcelAtPoint(pointValue: GeoPoint, label?: string): Promise<Site> {
  const key = apiKey();
  if (!key) throw new Error("VWORLD_API_KEY is not configured");

  const url = buildUrl("https://api.vworld.kr/req/data", {
    service: "data",
    request: "GetFeature",
    version: "2.0",
    data: "LP_PA_CBND_BUBUN",
    geometry: "true",
    attribute: "true",
    crs: "EPSG:4326",
    geomFilter: "POINT(" + pointValue.lon + " " + pointValue.lat + ")",
    size: 1,
    page: 1,
    format: "json",
    key,
    domain: apiDomain(),
  });

  const payload = await requestJson(url);
  const feature = payload?.response?.result?.featureCollection?.features?.[0];
  const boundary = firstBoundary(feature?.geometry);
  const properties = feature?.properties ?? {};
  const pnu = String(properties?.pnu || properties?.PNU || "").trim() || undefined;

  if (boundary.length >= 3) {
    const center = averageCenter(boundary, pointValue);
    return {
      id: pnu ? "parcel-" + pnu : "parcel-" + center.lon.toFixed(7) + "-" + center.lat.toFixed(7),
      name: label || properties?.full_nm || properties?.jibun || "선택 필지",
      address: label,
      center,
      boundary,
      pnu,
      source: "vworld-cadastral",
    };
  }

  const deltaLon = 18 / (111_320 * Math.cos((pointValue.lat * Math.PI) / 180));
  const deltaLat = 18 / 111_320;
  return {
    id: "point-" + pointValue.lon.toFixed(7) + "-" + pointValue.lat.toFixed(7),
    name: label || "선택 위치",
    address: label,
    center: pointValue,
    boundary: [
      { lon: pointValue.lon - deltaLon, lat: pointValue.lat - deltaLat },
      { lon: pointValue.lon + deltaLon, lat: pointValue.lat - deltaLat },
      { lon: pointValue.lon + deltaLon, lat: pointValue.lat + deltaLat },
      { lon: pointValue.lon - deltaLon, lat: pointValue.lat + deltaLat },
    ],
    source: "manual-point",
  };
}
