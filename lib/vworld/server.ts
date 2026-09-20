import type { GeoPoint, Site } from "@/src/types";

export type AddressSearchResult = {
  id: string;
  title: string;
  address: string;
  point: GeoPoint;
  kind?: "place" | "road" | "parcel" | "osm";
};

const APP_USER_AGENT = "SpaceLab/0.2 (+https://github.com/sionchu/spacelab-ai)";
let nominatimQueue: Promise<void> = Promise.resolve();
let nominatimNextAllowedAt = 0;

async function withNominatimRateLimit<T>(operation: () => Promise<T>): Promise<T> {
  const previous = nominatimQueue;
  let release: () => void = () => {};
  nominatimQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    const delayMs = Math.max(0, nominatimNextAllowedAt - Date.now());
    if (delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
    nominatimNextAllowedAt = Date.now() + 1_100;
    return await operation();
  } finally {
    release();
  }
}

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

function stripHtml(value: unknown) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function resultAddress(item: any, fallback: string) {
  if (typeof item?.address === "string") return stripHtml(item.address);
  return stripHtml(
    item?.address?.road
      || item?.address?.parcel
      || item?.roadAddress
      || item?.parcelAddress
      || item?.title
      || fallback,
  );
}

export async function searchVWorldPlace(query: string): Promise<AddressSearchResult[]> {
  const key = apiKey();
  if (!key) return [];
  const url = buildUrl("https://api.vworld.kr/req/search", {
    service: "search",
    request: "search",
    version: "2.0",
    crs: "EPSG:4326",
    size: 8,
    page: 1,
    query,
    type: "PLACE",
    format: "json",
    key,
    domain: apiDomain(),
  });
  const payload = await requestJson(url);
  if (responseStatus(payload) !== "OK") return [];

  const results: AddressSearchResult[] = [];
  for (const item of payload?.response?.result?.items ?? []) {
    const lon = Number(item?.point?.x);
    const lat = Number(item?.point?.y);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const title = stripHtml(item?.title || item?.name || query);
    results.push({
      id: "PLACE-" + lon + "-" + lat + "-" + results.length,
      title: title || query,
      address: resultAddress(item, title || query),
      point: { lon, lat },
      kind: "place",
    });
  }
  return results;
}

export async function searchVWorldAddress(query: string): Promise<AddressSearchResult[]> {
  const key = apiKey();
  if (!key) return [];

  const settled = await Promise.allSettled(
    (["ROAD", "PARCEL"] as const).map(async (category) => {
      const url = buildUrl("https://api.vworld.kr/req/search", {
        service: "search",
        request: "search",
        version: "2.0",
        crs: "EPSG:4326",
        size: 8,
        page: 1,
        query,
        type: "ADDRESS",
        category,
        format: "json",
        key,
        domain: apiDomain(),
      });
      const payload = await requestJson(url);
      if (responseStatus(payload) !== "OK") return [];

      return (payload?.response?.result?.items ?? []).flatMap((item: any, index: number) => {
        const lon = Number(item?.point?.x);
        const lat = Number(item?.point?.y);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [];
        const address = resultAddress(item, query);
        const title = stripHtml(item?.title || address || query);
        return [{
          id: category + "-" + lon + "-" + lat + "-" + index,
          title: title || address,
          address,
          point: { lon, lat },
          kind: category === "ROAD" ? "road" as const : "parcel" as const,
        }];
      });
    }),
  );

  return settled.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []);
}

export async function searchNominatimPlace(
  query: string,
  limit = 6,
  bias?: GeoPoint,
): Promise<AddressSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const params: Record<string, string | number> = {
    q: trimmed,
    format: "jsonv2",
    limit: Math.max(1, Math.min(8, limit)),
    countrycodes: "kr",
    addressdetails: 1,
    "accept-language": "ko",
  };
  if (bias) {
    const latSpan = 0.45;
    const lonSpan = 0.55;
    params.viewbox = [
      bias.lon - lonSpan,
      bias.lat + latSpan,
      bias.lon + lonSpan,
      bias.lat - latSpan,
    ].join(",");
    params.bounded = 0;
  }

  const url = buildUrl("https://nominatim.openstreetmap.org/search", params);

  return withNominatimRateLimit(async () => {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": APP_USER_AGENT,
        Referer: "https://github.com/sionchu/spacelab-ai",
      },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok) return [];

    const payload = await response.json() as Array<Record<string, any>>;
    return payload.flatMap((item, index) => {
      const lon = Number(item.lon);
      const lat = Number(item.lat);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [];

      const displayName = String(item.display_name || "").trim();
      const title = String(
        item.name
          || item.namedetails?.name
          || displayName.split(",")[0]
          || trimmed,
      ).trim();

      return [{
        id: "osm-" + String(item.place_id ?? index),
        title,
        address: displayName || title,
        point: { lon, lat },
        kind: "osm" as const,
      }];
    });
  });
}

async function requestJson(url: URL) {
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();

  if (!response.ok) {
    let detail = "";
    try {
      const payload = text ? JSON.parse(text) : undefined;
      const code = payload?.response?.error?.code ?? payload?.error?.code ?? payload?.response?.status;
      const message = payload?.response?.error?.text ?? payload?.response?.error?.message ?? payload?.error?.message;
      detail = [code, message].filter(Boolean).join(" ");
    } catch {
      detail = "";
    }
    const error = `VWorld request failed: HTTP ${response.status}${detail ? ` ${detail}` : ""}`;
    console.error("[vworld]", error, "domainConfigured=" + Boolean(apiDomain()), "keyConfigured=" + Boolean(apiKey()));
    throw new Error(error);
  }

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    console.error("[vworld] Invalid JSON response", "domainConfigured=" + Boolean(apiDomain()), "keyConfigured=" + Boolean(apiKey()));
    throw new Error("VWorld returned invalid JSON");
  }
}

const reverseAddressCache = new Map<string, string | undefined>();

async function reverseNominatim(point: GeoPoint) {
  const url = buildUrl("https://nominatim.openstreetmap.org/reverse", {
    lat: point.lat,
    lon: point.lon,
    format: "jsonv2",
    zoom: 18,
    addressdetails: 1,
    "accept-language": "ko",
  });

  return withNominatimRateLimit(async () => {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": APP_USER_AGENT,
        Referer: "https://github.com/sionchu/spacelab-ai",
      },
      signal: AbortSignal.timeout(10_000),
      next: { revalidate: 2_592_000 },
    });
    if (!response.ok) return undefined;
    const payload = await response.json() as Record<string, any>;
    const address = payload.address ?? {};
    const values = [
      address.state,
      address.city || address.county,
      address.borough || address.city_district,
      address.suburb || address.quarter || address.neighbourhood,
      address.road || address.pedestrian,
      address.house_number,
    ].filter(Boolean).map((value: unknown) => String(value).trim());
    const normalized = Array.from(new Set(values)).join(" ").trim();
    if (normalized) return normalized;
    const displayName = String(payload.display_name || "").split(",").slice(0, 6).join(" ").trim();
    return displayName || undefined;
  });
}

export async function reverseAddress(
  point: GeoPoint,
  options: { allowNominatim?: boolean } = {},
): Promise<string | undefined> {
  const cacheKey = point.lon.toFixed(6) + "," + point.lat.toFixed(6);
  if (reverseAddressCache.has(cacheKey)) return reverseAddressCache.get(cacheKey);

  const key = apiKey();
  if (key) {
    try {
      const url = buildUrl("https://api.vworld.kr/req/address", {
        service: "address",
        request: "getaddress",
        version: "2.0",
        crs: "EPSG:4326",
        type: "BOTH",
        point: point.lon + "," + point.lat,
        format: "json",
        zipcode: "true",
        simple: "false",
        key,
        domain: apiDomain(),
      });
      const payload = await requestJson(url);
      const results = Array.isArray(payload?.response?.result) ? payload.response.result : [];
      const road = results.find((item: any) => String(item?.type || "").toLowerCase() === "road");
      const parcel = results.find((item: any) => String(item?.type || "").toLowerCase() === "parcel");
      const address = String(road?.text || parcel?.text || results[0]?.text || "").trim() || undefined;
      if (address) {
        reverseAddressCache.set(cacheKey, address);
        return address;
      }
    } catch (error) {
      console.warn("[vworld] reverse fallback", error instanceof Error ? error.message : String(error));
    }
  }

  if (options.allowNominatim === false) return undefined;

  try {
    const address = await reverseNominatim(point);
    reverseAddressCache.set(cacheKey, address);
    return address;
  } catch (error) {
    console.warn("[nominatim] reverse failed", error instanceof Error ? error.message : String(error));
    reverseAddressCache.set(cacheKey, undefined);
    return undefined;
  }
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

function manualSite(pointValue: GeoPoint, label?: string): Site {
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

export async function parcelAtPoint(pointValue: GeoPoint, label?: string): Promise<Site> {
  const key = apiKey();
  if (!key) return manualSite(pointValue, label);

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

  let payload: any;
  try {
    payload = await requestJson(url);
  } catch (error) {
    console.warn("[vworld] parcel fallback", error instanceof Error ? error.message : String(error));
    return manualSite(pointValue, label);
  }
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

  return manualSite(pointValue, label);
}
