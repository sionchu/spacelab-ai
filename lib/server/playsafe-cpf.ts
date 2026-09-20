import type { PlayPlace } from "@/src/playsafe";
import type { GeoPoint } from "@/src/types";

const CPF_URL = "https://www.cpf.go.kr/user/exts/cpf/com/getPfctData.do";
export const OFFICIAL_PLAYGROUND_SOURCE = "MOIS CPF playground registry";
const CACHE_TTL_MS = 10 * 60_000;
const QUERY_GRID_STEP_DEG = 0.01;
const QUERY_RADIUS_M = 1_200;
const ALLOWED_INSTALL_PLACE_CODES = new Set(["A003", "A010", "A020"]);

type CpfFacility = Record<string, unknown>;
type CacheEntry = {
  expiresAt: number;
  value?: PlayPlace[];
  pending?: Promise<PlayPlace[]>;
};

const cache = new Map<string, CacheEntry>();

function field(row: CpfFacility, key: string) {
  const value = row[key];
  return value === undefined || value === null ? "" : String(value).trim();
}
function distanceM(a: GeoPoint, b: GeoPoint) {
  const avgLat = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const x = (a.lon - b.lon) * 111_320 * Math.cos(avgLat);
  const y = (a.lat - b.lat) * 111_320;
  return Math.hypot(x, y);
}

function coarseCenter(center: GeoPoint): GeoPoint {
  return {
    lon: Math.round(center.lon * 100) / 100,
    lat: Math.round(center.lat * 100) / 100,
  };
}

function queryCenters(center: GeoPoint) {
  const base = coarseCenter(center);
  return [-1, 0, 1].flatMap((latOffset) =>
    [-1, 0, 1].map((lonOffset) => ({
      lon: base.lon + lonOffset * QUERY_GRID_STEP_DEG,
      lat: base.lat + latOffset * QUERY_GRID_STEP_DEG,
    })),
  );
}

function cacheKey(center: GeoPoint, radiusM: number) {
  const coarse = coarseCenter(center);
  return [coarse.lon.toFixed(2), coarse.lat.toFixed(2), Math.ceil(radiusM)].join(":");
}
function normalizeFacility(row: CpfFacility): PlayPlace | undefined {
  const installPlaceCode = field(row, "instlPlaceCd");
  if (!ALLOWED_INSTALL_PLACE_CODES.has(installPlaceCode)) return undefined;

  const operationCode = field(row, "operYnCd");
  const indoorOutdoorCode = field(row, "idrodrCd");
  if (operationCode && operationCode !== "B001") return undefined;
  if (indoorOutdoorCode && indoorOutdoorCode !== "O002") return undefined;
  if (field(row, "clsgYn") === "Y") return undefined;

  const lat = Number(field(row, "latCrtsVl"));
  const lon = Number(field(row, "lotCrtsVl"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  if (lat < 32 || lat > 39.5 || lon < 124 || lon > 132) return undefined;

  const name = field(row, "pfctNm");
  if (!name) return undefined;
  const serial = field(row, "pfctSn") || lon.toFixed(7) + "," + lat.toFixed(7);
  const address = [field(row, "ronaAddr"), field(row, "ronaDaddr")]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    id: "mois-cpf-" + serial,
    name,
    kind: installPlaceCode === "A003" ? "park" : "playground",
    point: { lon, lat },
    address: address || undefined,
    distanceM: 0,
    tags: {
      source: OFFICIAL_PLAYGROUND_SOURCE,
      installPlaceCode,
      installPlaceName: field(row, "instlPlaceCdNm"),
      operationCode,
      operationName: field(row, "operYnCdNm"),
      indoorOutdoorCode,
      indoorOutdoorName: field(row, "idrodrCdNm"),
      publicPrivateCode: field(row, "prvtPblcYnCd"),
      publicPrivateName: field(row, "prvtPblcYnCdNm"),
      installedAt: field(row, "instlYmd"),
      facilityAreaM2: field(row, "fcar"),
      leisure: installPlaceCode === "A003" ? "park" : "playground",
    },
  };
}

async function queryCpf(center: GeoPoint): Promise<CpfFacility[]> {
  const body = new URLSearchParams();
  body.set("latitude", String(center.lat));
  body.set("longitude", String(center.lon));
  body.set("distance", String(QUERY_RADIUS_M));
  body.set("searchKeyword", "");
  body.set("searchCondition", "1");
  body.set("wowaStylRideCd", "");
  body.set("mapWowaStylRideCd", "");
  body.set("exfcValidYn", "");

  const response = await fetch(CPF_URL, {
    method: "POST",
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("MOIS CPF playground search failed: HTTP " + response.status);
  }

  const payload = await response.json();
  return Array.isArray(payload) ? payload as CpfFacility[] : [];
}

async function queryCpfGrid(center: GeoPoint) {
  const settled = await Promise.allSettled(queryCenters(center).map(queryCpf));
  const rows = settled.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []);
  const unique = new Map<string, CpfFacility>();
  for (const row of rows) {
    const id = field(row, "pfctSn")
      || [field(row, "pfctNm"), field(row, "latCrtsVl"), field(row, "lotCrtsVl")].join("|");
    if (id) unique.set(id, row);
  }
  return [...unique.values()];
}

export async function nearbyOfficialPlaygrounds(
  center: GeoPoint,
  radiusM: number,
  limit = 80,
): Promise<PlayPlace[]> {
  const key = cacheKey(center, radiusM);
  const now = Date.now();
  const cached = cache.get(key);

  if (cached?.value && cached.expiresAt > now) return cached.value.slice(0, limit);
  if (cached?.pending) return (await cached.pending).slice(0, limit);

  const pending = queryCpfGrid(center).then((rows) =>
    rows
      .flatMap((row) => {
        const normalized = normalizeFacility(row);
        return normalized ? [normalized] : [];
      })
      .map((item) => ({ ...item, distanceM: distanceM(center, item.point) }))
      .filter((item) => item.distanceM <= radiusM)
      .sort((a, b) => a.distanceM - b.distanceM),
  );

  cache.set(key, { expiresAt: now + CACHE_TTL_MS, value: cached?.value, pending });

  try {
    const value = await pending;
    cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    return value.slice(0, limit);
  } catch (error) {
    if (cached?.value) return cached.value.slice(0, limit);
    cache.delete(key);
    throw error;
  }
}
