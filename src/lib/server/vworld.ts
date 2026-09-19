import type { GeoPoint, Site } from "@/types";

export type AddressSearchResult = {
  id: string;
  title: string;
  address: string;
  point: GeoPoint;
};

function requireKey() {
  const key = process.env.VWORLD_API_KEY?.trim();
  if (!key) throw new Error("VWORLD_API_KEY is not configured.");
  return key;
}

function buildUrl(base: string, params: Record<string, string | number | undefined>) {
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  });
  return url;
}

async function requestJson(url: URL) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 300 },
  });
  if (!response.ok) throw new Error(`VWorld request failed: ${response.status}`);
  return response.json();
}

function responseStatus(payload: any) {
  return payload?.response?.status ?? payload?.status;
}

export async function searchVWorldAddress(query: string): Promise<AddressSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const key = requireKey();
  const domain = process.env.VWORLD_DOMAIN?.trim() || undefined;
  const categories = ["ROAD", "PARCEL"] as const;
  const all: AddressSearchResult[] = [];

  for (const category of categories) {
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
      domain,
    });
    const payload = await requestJson(url);
    if (responseStatus(payload) !== "OK") continue;

    const items = payload?.response?.result?.items ?? [];
    for (const item of items) {
      const lon = Number(item?.point?.x);
      const lat = Number(item?.point?.y);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      const address = String(item?.address?.road || item?.address?.parcel || item?.title || trimmed);
      all.push({
        id: `${category}-${lon}-${lat}-${all.length}`,
        title: String(item?.title || address),
        address,
        point: { lon, lat },
      });
    }
  }

  const seen = new Set<string>();
  return all.filter((item) => {
    const id = `${item.point.lon.toFixed(7)},${item.point.lat.toFixed(7)}`;
    if (seen.has(id)) return false;
    seen.add(id);
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
    .filter((point: GeoPoint | undefined): point is GeoPoint => Boolean(
      point && Number.isFinite(point.lon) && Number.isFinite(point.lat),
    ));
}

function centroid(boundary: GeoPoint[], fallback: GeoPoint): GeoPoint {
  const points = boundary.length > 2
    && boundary[0].lon === boundary[boundary.length - 1].lon
    && boundary[0].lat === boundary[boundary.length - 1].lat
    ? boundary.slice(0, -1)
    : boundary;
  if (!points.length) return fallback;
  return {
    lon: points.reduce((sum, point) => sum + point.lon, 0) / points.length,
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
  };
}

export async function getVWorldParcelAtPoint(point: GeoPoint, label?: string): Promise<Site> {
  const key = requireKey();
  const domain = process.env.VWORLD_DOMAIN?.trim() || undefined;
  const url = buildUrl("https://api.vworld.kr/req/data", {
    service: "data",
    request: "GetFeature",
    version: "2.0",
    data: "LP_PA_CBND_BUBUN",
    geometry: true as unknown as string,
    attribute: true as unknown as string,
    crs: "EPSG:4326",
    geomFilter: `POINT(${point.lon} ${point.lat})`,
    size: 1,
    page: 1,
    format: "json",
    key,
    domain,
  });
  const payload = await requestJson(url);
  const feature = payload?.response?.result?.featureCollection?.features?.[0];
  const boundary = firstBoundary(feature?.geometry);
  const properties = feature?.properties ?? {};
  const pnu = String(properties?.pnu || properties?.PNU || "").trim() || undefined;

  if (boundary.length >= 3) {
    const center = centroid(boundary, point);
    return {
      id: pnu ? `parcel-${pnu}` : `parcel-${center.lon.toFixed(7)}-${center.lat.toFixed(7)}`,
      name: label || properties?.full_nm || properties?.jibun || "선택 필지",
      address: label,
      center,
      boundary,
      pnu,
      source: "vworld-cadastral",
    };
  }

  const deltaLon = 18 / (111_320 * Math.cos((point.lat * Math.PI) / 180));
  const deltaLat = 18 / 111_320;
  return {
    id: `point-${point.lon.toFixed(7)}-${point.lat.toFixed(7)}`,
    name: label || "선택 위치",
    address: label,
    center: point,
    boundary: [
      { lon: point.lon - deltaLon, lat: point.lat - deltaLat },
      { lon: point.lon + deltaLon, lat: point.lat - deltaLat },
      { lon: point.lon + deltaLon, lat: point.lat + deltaLat },
      { lon: point.lon - deltaLon, lat: point.lat + deltaLat },
    ],
    source: "manual-point",
  };
}
