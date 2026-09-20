import type { GeoPoint } from "@/src/types";
import {
  searchNominatimPlace,
  searchVWorldAddress,
} from "@/lib/vworld/server";

export type PlaySafeChildFacility = {
  id: string;
  name: string;
  kind: "daycare" | "kindergarten";
  establishmentType: string;
  address: string;
  point: GeoPoint;
  distanceM: number;
  phone: string;
  schoolVehicle: boolean;
  suspended: boolean;
  closed: boolean;
};

type LocalResponseItem = {
  id?: string;
  name?: string;
  establishType?: string;
  typeCode?: string;
  tel?: string;
  roadAddress?: string;
  longitude?: string | number;
  latitude?: string | number;
  distance?: number;
  kdspYn?: string;
  kdclYn?: string;
  vhclOprnYn?: string;
};

type SearchResponseItem = {
  id?: string;
  label?: string;
  establishType?: string;
  typeCode?: string;
  roadAddress?: string;
};

const BASE = "https://e-childschoolinfo.moe.go.kr";
const HEADERS = {
  "User-Agent": "PlaySafe/1.0 (+https://github.com/sionchu/spacelab-ai)",
  Referer: BASE + "/kinderMt/kinderSearch.do",
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "X-Requested-With": "XMLHttpRequest",
};

const nearbyCache = new Map<string, {
  expiresAt: number;
  items: PlaySafeChildFacility[];
}>();

const searchCache = new Map<string, {
  expiresAt: number;
  items: Array<Omit<PlaySafeChildFacility, "distanceM">>;
}>();

function cacheKey(center: GeoPoint, radiusKm: number) {
  return [
    center.lon.toFixed(3),
    center.lat.toFixed(3),
    radiusKm.toFixed(1),
  ].join(":");
}

async function postJson<T>(pathname: string, payload: Record<string, string>) {
  const response = await fetch(BASE + pathname, {
    method: "POST",
    headers: HEADERS,
    body: new URLSearchParams(payload),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("유아교육기관 공개정보 조회 실패 HTTP " + response.status);
  }
  return await response.json() as T;
}

function kindFromTypeCode(typeCode?: string): PlaySafeChildFacility["kind"] {
  return typeCode === "02" ? "daycare" : "kindergarten";
}

export async function nearbyChildFacilities(
  center: GeoPoint,
  radiusKm = 2,
  limit = 30,
): Promise<PlaySafeChildFacility[]> {
  const key = cacheKey(center, radiusKm);
  const cached = nearbyCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.items.slice(0, limit);
  }

  const payload = await postJson<LocalResponseItem[]>(
    "/kinderMt/kinderLocalFind.do",
    {
      institutionType: "",
      latitude: String(center.lat),
      longitude: String(center.lon),
      distance: String(radiusKm),
    },
  );

  const items = payload.flatMap((item) => {
    const lon = Number(item.longitude);
    const lat = Number(item.latitude);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [];

    const suspended = item.kdspYn === "Y";
    const closed = item.kdclYn === "Y";
    return [{
      id: String(item.id || [lon, lat].join(",")),
      name: String(item.name || "").trim(),
      kind: kindFromTypeCode(item.typeCode),
      establishmentType: String(item.establishType || "").trim(),
      address: String(item.roadAddress || "").trim(),
      point: { lon, lat },
      distanceM: Math.max(0, Math.round(Number(item.distance || 0) * 1000)),
      phone: String(item.tel || "").trim(),
      schoolVehicle: item.vhclOprnYn === "Y",
      suspended,
      closed,
    } satisfies PlaySafeChildFacility];
  })
    .filter((item) => item.name && !item.closed && !item.suspended)
    .sort((a, b) => a.distanceM - b.distanceM);

  nearbyCache.set(key, {
    expiresAt: Date.now() + 10 * 60_000,
    items,
  });
  return items.slice(0, limit);
}

async function geocodeFacility(
  item: SearchResponseItem,
): Promise<Omit<PlaySafeChildFacility, "distanceM"> | undefined> {
  const address = String(item.roadAddress || "").trim();
  const name = String(item.label || "").trim();
  if (!name || !address) return undefined;

  const vworld = await searchVWorldAddress(address).catch(() => []);
  let point = vworld.find((result) => result.kind === "road")?.point
    ?? vworld.find((result) => result.kind === "parcel")?.point
    ?? vworld[0]?.point;

  if (!point) {
    const osm = await searchNominatimPlace(name + " " + address, 2).catch(() => []);
    point = osm[0]?.point;
  }
  if (!point) {
    const osm = await searchNominatimPlace(address, 2).catch(() => []);
    point = osm[0]?.point;
  }
  if (!point) return undefined;

  return {
    id: String(item.id || name + ":" + address),
    name,
    kind: kindFromTypeCode(item.typeCode),
    establishmentType: String(item.establishType || "").trim(),
    address,
    point,
    phone: "",
    schoolVehicle: false,
    suspended: false,
    closed: false,
  };
}

function normalizeFacilitySearch(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "");
}

export async function searchChildFacilities(
  query: string,
  limit = 5,
  bias?: GeoPoint,
): Promise<Array<Omit<PlaySafeChildFacility, "distanceM">>> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  if (bias) {
    const queryKey = normalizeFacilitySearch(trimmed);
    const nearby = await nearbyChildFacilities(bias, 3, 120).catch(() => []);
    const localMatches = nearby
      .map((item) => {
        const nameKey = normalizeFacilitySearch(item.name);
        let score = 0;
        if (nameKey === queryKey) score += 1000;
        if (nameKey.startsWith(queryKey)) score += 500;
        if (nameKey.includes(queryKey)) score += 350;
        if (queryKey.includes(nameKey) && nameKey.length >= 4) score += 220;
        score += Math.max(0, 200 - Math.round(item.distanceM / 20));
        return { item, score };
      })
      .filter((entry) => entry.score >= 300)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ item }) => item);

    if (localMatches.length) return localMatches;
  }

  const key = trimmed.toLocaleLowerCase("ko-KR");
  const cached = searchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.items.slice(0, limit);
  }

  const candidates = await postJson<SearchResponseItem[]>(
    "/kinderMt/combineFindAutoComplete.do",
    {
      organName: trimmed,
      sidoCode: "99",
      sggCode: "99",
      roName: "99",
    },
  );

  const resolved = await Promise.all(
    candidates.slice(0, Math.max(limit, 5)).map((item) => geocodeFacility(item)),
  );
  const items = resolved.filter(
    (item): item is Omit<PlaySafeChildFacility, "distanceM"> => Boolean(item),
  );

  searchCache.set(key, {
    expiresAt: Date.now() + 10 * 60_000,
    items,
  });
  return items.slice(0, limit);
}
