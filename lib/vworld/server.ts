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

function searchQueryVariants(query: string) {
  const normalized = query.trim().replace(/\s+/g, " ");
  const compact = normalized.replace(/\s+/g, "");
  const variants: string[] = [];
  const add = (value: string) => {
    const next = value.trim();
    if (next.length >= 2 && !variants.includes(next)) variants.push(next);
  };

  add(normalized);
  add(compact);

  const latinHangul = compact.match(/^([A-Za-z]{2,})([가-힣].+)$/);
  if (latinHangul) {
    const [, rawBrand, rest] = latinHangul;
    const brand = rawBrand.toUpperCase();

    if (rest.endsWith("빌리지")) {
      const stem = rest.slice(0, -"빌리지".length);
      add(stem + brand + "빌리지");
      add(stem + brand + "빌리지아파트");
      if (brand === "LG") add(stem + "엘지빌리지");
    }

    add(brand + " " + rest);
    add(rest);
    if (brand === "LG") add("엘지" + rest);
  }

  const residentialName = variants.find((value) =>
    /(?:빌리지|마을|타운|캐슬|자이|푸르지오|래미안|아이파크|힐스테이트)$/.test(value),
  );
  if (residentialName) add(residentialName + "아파트");

  return variants.slice(0, 8);
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

async function searchVWorldPlace(query: string, key: string): Promise<AddressSearchResult[]> {
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

async function searchVWorldAddress(query: string, key: string): Promise<AddressSearchResult[]> {
  const results: AddressSearchResult[] = [];
  for (const category of ["ROAD", "PARCEL"] as const) {
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
    if (responseStatus(payload) !== "OK") continue;

    for (const item of payload?.response?.result?.items ?? []) {
      const lon = Number(item?.point?.x);
      const lat = Number(item?.point?.y);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      const address = resultAddress(item, query);
      const title = stripHtml(item?.title || address || query);
      results.push({
        id: category + "-" + lon + "-" + lat + "-" + results.length,
        title: title || address,
        address,
        point: { lon, lat },
        kind: category === "ROAD" ? "road" : "parcel",
      });
    }
  }
  return results;
}

const searchCache = new Map<string, { expiresAt: number; items: AddressSearchResult[] }>();

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

async function searchNominatim(query: string): Promise<AddressSearchResult[]> {
  const url = buildUrl("https://nominatim.openstreetmap.org/search", {
    q: query,
    format: "jsonv2",
    limit: 8,
    countrycodes: "kr",
    "accept-language": "ko",
    addressdetails: 1,
  });

  return withNominatimRateLimit(async () => {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": APP_USER_AGENT,
        Referer: "https://github.com/sionchu/spacelab-ai",
      },
      signal: AbortSignal.timeout(10_000),
      next: { revalidate: 86_400 },
    });
    if (!response.ok) throw new Error("Nominatim request failed: HTTP " + response.status);
    const payload = await response.json() as Array<Record<string, unknown>>;
    return payload.flatMap((item, index) => {
      const lon = Number(item.lon);
      const lat = Number(item.lat);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [];
      const displayName = String(item.display_name || query);
      const name = String(item.name || displayName.split(",")[0] || displayName);
      return [{
        id: "osm-" + String(item.place_id ?? index),
        title: name,
        address: displayName,
        point: { lon, lat },
        kind: "osm" as const,
      }];
    });
  });
}

function dedupeSearchResults(items: AddressSearchResult[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const keyValue = item.point.lon.toFixed(7) + "," + item.point.lat.toFixed(7);
    if (seen.has(keyValue)) return false;
    seen.add(keyValue);
    return true;
  }).slice(0, 8);
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

export async function searchAddress(query: string): Promise<AddressSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const cacheKey = trimmed.toLocaleLowerCase("ko-KR");
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.items;

  const variants = searchQueryVariants(trimmed);
  const key = apiKey();
  const all: AddressSearchResult[] = [];

  if (key) {
    for (const variant of variants) {
      try {
        all.push(...await searchVWorldPlace(variant, key));
      } catch (error) {
        console.warn(
          "[vworld] place search variant failed",
          variant,
          error instanceof Error ? error.message : String(error),
        );
      }
      if (dedupeSearchResults(all).length >= 6) break;
    }

    try {
      all.push(...await searchVWorldAddress(trimmed, key));
    } catch (error) {
      console.warn(
        "[vworld] address search fallback",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  let items = dedupeSearchResults(all);
  if (!items.length) {
    const nominatimVariants = [
      ...variants.filter((variant) => variant.endsWith("아파트")),
      ...variants.filter((variant) => !variant.endsWith("아파트")),
    ];
    for (const variant of nominatimVariants.slice(0, 4)) {
      try {
        const osm = dedupeSearchResults(await searchNominatim(variant));
        if (osm.length) {
          items = osm;
          break;
        }
      } catch (error) {
        console.warn(
          "[nominatim] search variant failed",
          variant,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  searchCache.set(cacheKey, {
    expiresAt: Date.now() + 10 * 60_000,
    items,
  });
  return items;
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
