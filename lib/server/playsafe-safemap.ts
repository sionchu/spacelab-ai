import type { PlayPlace } from "@/src/playsafe";
import type { GeoPoint } from "@/src/types";

const BASE_URL = "https://safemap.go.kr/openapi2/IF_0007";
const PAGE_SIZE = 5_000;
const CACHE_TTL_MS = 6 * 60 * 60_000;
const ALLOWED_INSTALL_PLACE_CODES = new Set(["A003", "A010", "A020"]);

type RawFacility = Record<string, unknown>;

type FacilityPage = {
  items: RawFacility[];
  totalCount: number;
};

type FacilityCache = {
  keyFingerprint: string;
  expiresAt: number;
  items?: PlayPlace[];
  pending?: Promise<PlayPlace[]>;
};

let facilityCache: FacilityCache | undefined;

function apiKey() {
  return process.env.SAFEMAP_API_KEY?.trim() || "";
}

function fingerprint(value: string) {
  if (!value) return "";
  return value.slice(0, 4) + ":" + value.length;
}

function field(row: RawFacility, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function distanceM(a: GeoPoint, b: GeoPoint) {
  const avgLat = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const x = (a.lon - b.lon) * 111_320 * Math.cos(avgLat);
  const y = (a.lat - b.lat) * 111_320;
  return Math.hypot(x, y);
}

function webMercatorPoint(xValue: unknown, yValue: unknown): GeoPoint | undefined {
  const x = Number(xValue);
  const y = Number(yValue);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;

  const radius = 6_378_137;
  const lon = (x / radius) * 180 / Math.PI;
  const lat = (2 * Math.atan(Math.exp(y / radius)) - Math.PI / 2) * 180 / Math.PI;
  if (lon < 124 || lon > 132 || lat < 32 || lat > 39.5) return undefined;
  return { lon, lat };
}

function parseItems(payload: any): RawFacility[] {
  const body = payload?.response?.body ?? payload?.body ?? payload ?? {};
  const candidates = [
    body?.items?.item,
    body?.items,
    body?.item,
    payload?.items?.item,
    payload?.items,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as RawFacility[];
    if (candidate && typeof candidate === "object") return [candidate as RawFacility];
  }
  return [];
}

function parseTotalCount(payload: any, fallback: number) {
  const body = payload?.response?.body ?? payload?.body ?? payload ?? {};
  const value = Number(
    body?.totalCount
      ?? body?.total_count
      ?? payload?.totalCount
      ?? payload?.total_count
      ?? fallback,
  );
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

async function fetchPage(key: string, pageNo: number): Promise<FacilityPage> {
  const url = new URL(BASE_URL);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("numOfRows", String(PAGE_SIZE));
  url.searchParams.set("returnType", "JSON");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "PlaySafe/1.0 (+https://github.com/sionchu/spacelab-ai)",
      Referer: "https://www.safemap.go.kr/",
    },
    signal: AbortSignal.timeout(15_000),
    next: { revalidate: 21_600 },
  });

  const text = await response.text();
  let payload: any;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("MOIS SafeMap playground API returned invalid JSON");
  }

  const resultCode = String(
    payload?.response?.header?.resultCode
      ?? payload?.header?.resultCode
      ?? payload?.resultCode
      ?? "",
  ).trim();
  if (!response.ok || (resultCode && resultCode !== "00" && resultCode !== "0")) {
    const message = String(
      payload?.response?.header?.resultMsg
        ?? payload?.header?.resultMsg
        ?? payload?.resultMsg
        ?? ("HTTP " + response.status),
    );
    throw new Error("MOIS SafeMap playground API error: " + message);
  }

  const items = parseItems(payload);
  return {
    items,
    totalCount: parseTotalCount(payload, items.length),
  };
}

function normalizeFacility(row: RawFacility): PlayPlace | undefined {
  const installPlaceCode = field(row, "fclty_cd4", "FCLTY_CD4");
  const indoorOutdoorCode = field(row, "fclty_cd6", "FCLTY_CD6");
  const operationCode = field(row, "fclty_cd7", "FCLTY_CD7");

  if (installPlaceCode && !ALLOWED_INSTALL_PLACE_CODES.has(installPlaceCode)) return undefined;
  if (indoorOutdoorCode && indoorOutdoorCode !== "O002") return undefined;
  if (operationCode && operationCode !== "B001") return undefined;

  const point = webMercatorPoint(row.x ?? row.X, row.y ?? row.Y);
  if (!point) return undefined;

  const name = field(row, "fclty_nm", "FCLTY_NM");
  if (!name) return undefined;

  const id = field(row, "fclty_cd1", "FCLTY_CD1", "objt_id", "OBJT_ID")
    || point.lon.toFixed(7) + "," + point.lat.toFixed(7);
  const installPlaceName = installPlaceCode === "A003"
    ? "도시공원"
    : installPlaceCode === "A010"
      ? "주택단지"
      : installPlaceCode === "A020"
        ? "주상복합"
        : "";

  return {
    id: "mois-safemap-" + id,
    name,
    kind: installPlaceCode === "A003" ? "park" : "playground",
    point,
    address: field(row, "adres", "ADRES") || undefined,
    distanceM: 0,
    tags: {
      source: "MOIS SafeMap IF_0007",
      installPlaceCode,
      installPlaceName,
      indoorOutdoorCode,
      operationCode,
      publicPrivateCode: field(row, "fclty_cd5", "FCLTY_CD5"),
      installedAt: field(row, "instl_de", "INSTL_DE"),
      leisure: installPlaceCode === "A003" ? "park" : "playground",
    },
  };
}

async function loadFacilities(key: string): Promise<PlayPlace[]> {
  const first = await fetchPage(key, 1);
  const pages = Math.max(1, Math.ceil(first.totalCount / PAGE_SIZE));
  const allRows = [...first.items];

  for (let start = 2; start <= pages; start += 4) {
    const batch = Array.from(
      { length: Math.min(4, pages - start + 1) },
      (_, index) => start + index,
    );
    const settled = await Promise.allSettled(batch.map((pageNo) => fetchPage(key, pageNo)));
    for (const result of settled) {
      if (result.status === "fulfilled") allRows.push(...result.value.items);
    }
  }

  return allRows.flatMap((row) => {
    const normalized = normalizeFacility(row);
    return normalized ? [normalized] : [];
  });
}

async function allFacilities() {
  const key = apiKey();
  if (!key) return [];

  const keyFingerprint = fingerprint(key);
  const now = Date.now();
  if (
    facilityCache?.items
    && facilityCache.keyFingerprint === keyFingerprint
    && facilityCache.expiresAt > now
  ) {
    return facilityCache.items;
  }
  if (
    facilityCache?.pending
    && facilityCache.keyFingerprint === keyFingerprint
  ) {
    return facilityCache.pending;
  }

  const pending = loadFacilities(key);
  facilityCache = {
    keyFingerprint,
    expiresAt: now + CACHE_TTL_MS,
    items: facilityCache?.keyFingerprint === keyFingerprint ? facilityCache.items : undefined,
    pending,
  };

  try {
    const items = await pending;
    facilityCache = {
      keyFingerprint,
      expiresAt: Date.now() + CACHE_TTL_MS,
      items,
    };
    return items;
  } catch (error) {
    const stale = facilityCache?.items;
    facilityCache = stale
      ? { keyFingerprint, expiresAt: Date.now() + 10 * 60_000, items: stale }
      : undefined;
    throw error;
  }
}

export async function nearbyMoisPlaygrounds(
  center: GeoPoint,
  radiusM: number,
  limit = 80,
): Promise<PlayPlace[]> {
  const facilities = await allFacilities();
  return facilities
    .map((item) => ({
      ...item,
      distanceM: distanceM(center, item.point),
    }))
    .filter((item) => item.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
}

export function moisPlaygroundConfigured() {
  return Boolean(apiKey());
}
