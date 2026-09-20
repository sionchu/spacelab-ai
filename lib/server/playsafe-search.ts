import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import type { GeoPoint } from "@/src/types";
import {
  searchVWorldAddress,
  searchVWorldPlace,
  type AddressSearchResult,
} from "@/lib/vworld/server";

export type PlaySafeSearchKind =
  | "apartment"
  | "park"
  | "childFacility"
  | "toilet"
  | "place"
  | "road"
  | "parcel";

export type PlaySafeSearchResult = {
  id: string;
  title: string;
  address: string;
  point: GeoPoint;
  kind: PlaySafeSearchKind;
  source: "kapt" | "public-data" | "vworld";
  score: number;
};
type ApartmentEntry = {
  code: string;
  name: string;
  lotAddresses: string[];
  roadAddresses: string[];
};

type RawPublicPoint = {
  id: string;
  name: string;
  address?: string;
  lat: number;
  lon: number;
  [key: string]: unknown;
};

type IndexedLocal = {
  id: string;
  title: string;
  address: string;
  addresses: string[];
  kind: "apartment" | "park" | "childFacility" | "toilet";
  source: "kapt" | "public-data";
  point?: GeoPoint;
  titleKey: string;
  addressKey: string;
};

type SearchIndex = {
  apartments: IndexedLocal[];
  publicPlaces: IndexedLocal[];
};
let indexPromise: Promise<SearchIndex> | undefined;
const apartmentPointCache = new Map<string, GeoPoint | undefined>();
const queryCache = new Map<string, {
  expiresAt: number;
  items: PlaySafeSearchResult[];
}>();

const BRAND_ALIASES: Array<[RegExp, string]> = [
  [/엘지/gi, "lg"],
  [/에스케이/gi, "sk"],
  [/엘에이치/gi, "lh"],
  [/케이티/gi, "kt"],
];

function normalizeSearchText(value: string) {
  let result = value.normalize("NFKC").toLocaleLowerCase("ko-KR");
  for (const [pattern, replacement] of BRAND_ALIASES) {
    result = result.replace(pattern, replacement);
  }
  return result.replace(/[^0-9a-z가-힣]/g, "");
}

function stripResidenceSuffix(value: string) {
  return value.replace(/(?:아파트|apt|공동주택)$/i, "");
}
function brandCore(value: string) {
  const brands = ["lg", "sk", "lh", "kt"] as const;
  for (const brand of brands) {
    if (value.includes(brand)) {
      return {
        brand,
        core: stripResidenceSuffix(value.replaceAll(brand, "")),
      };
    }
  }
  return { brand: "", core: stripResidenceSuffix(value) };
}

function bigrams(value: string) {
  if (value.length < 2) return [value];
  const items: string[] = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    items.push(value.slice(index, index + 2));
  }
  return items;
}

function diceSimilarity(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const left = bigrams(a);
  const right = [...bigrams(b)];
  let hits = 0;
  for (const gram of left) {
    const index = right.indexOf(gram);
    if (index < 0) continue;
    hits += 1;
    right.splice(index, 1);
  }
  return (2 * hits) / Math.max(1, left.length + bigrams(b).length);
}

function candidateScore(
  query: string,
  titleKey: string,
  addressKey: string,
  baseScore: number,
) {
  const queryKey = normalizeSearchText(query);
  if (!queryKey) return 0;

  const queryCore = brandCore(queryKey);
  const titleCore = brandCore(titleKey);
  let score = baseScore;

  if (titleKey === queryKey) score += 900;
  if (stripResidenceSuffix(titleKey) === stripResidenceSuffix(queryKey)) score += 760;

  if (
    queryCore.brand
    && queryCore.brand === titleCore.brand
    && queryCore.core
    && queryCore.core === titleCore.core
  ) {
    score += 820;
  }
  const candidateRatio = titleKey.length / Math.max(1, queryKey.length);
  if (titleKey.startsWith(queryKey)) score += 320;
  if (queryKey.startsWith(titleKey) && candidateRatio >= 0.65) score += 150;
  if (titleKey.includes(queryKey)) score += 260;
  if (queryKey.includes(titleKey) && candidateRatio >= 0.65) score += 120;
  if (addressKey.includes(queryKey)) score += 230;

  const titleSimilarity = diceSimilarity(queryKey, titleKey);
  const coreSimilarity = diceSimilarity(queryCore.core, titleCore.core);
  score += Math.round(Math.max(titleSimilarity, coreSimilarity) * 340);

  return score;
}

function minimumScore(query: string) {
  const length = normalizeSearchText(query).length;
  if (length <= 2) return 360;
  if (length <= 4) return 260;
  return 220;
}

function indexedLocal(
  item: Omit<IndexedLocal, "titleKey" | "addressKey">,
): IndexedLocal {
  return {
    ...item,
    titleKey: normalizeSearchText(item.title),
    addressKey: normalizeSearchText([item.address, ...item.addresses].join(" ")),
  };
}
async function loadSearchIndex(): Promise<SearchIndex> {
  if (indexPromise) return indexPromise;

  indexPromise = (async () => {
    const apartmentPath = path.join(
      process.cwd(),
      "data",
      "playsafe",
      "kapt-search-index.json.gz",
    );
    const publicPath = path.join(
      process.cwd(),
      "data",
      "playsafe",
      "public-context.json.gz",
    );

    const [apartmentBuffer, publicBuffer] = await Promise.all([
      readFile(apartmentPath),
      readFile(publicPath),
    ]);
    const apartmentPayload = JSON.parse(
      gunzipSync(apartmentBuffer).toString("utf8"),
    ) as { complexes: ApartmentEntry[] };

    const publicPayload = JSON.parse(
      gunzipSync(publicBuffer).toString("utf8"),
    ) as {
      datasets: {
        parks: { rows: RawPublicPoint[] };
        childZones: { rows: RawPublicPoint[] };
        childCenters: { rows: RawPublicPoint[] };
        toilets: { rows: RawPublicPoint[] };
      };
    };

    const apartments = apartmentPayload.complexes.map((item) => {
      const addresses = [...item.lotAddresses, ...item.roadAddresses]
        .filter(Boolean)
        .slice(0, 8);
      return indexedLocal({
        id: "kapt:" + item.code,
        title: item.name,
        address: item.roadAddresses[0] || item.lotAddresses[0] || "",
        addresses,
        kind: "apartment",
        source: "kapt",
      });
    });
    const publicPlaces: IndexedLocal[] = [];
    const addPublic = (
      rows: RawPublicPoint[],
      kind: IndexedLocal["kind"],
      prefix: string,
    ) => {
      for (const item of rows) {
        const lon = Number(item.lon);
        const lat = Number(item.lat);
        if (!Number.isFinite(lon) || !Number.isFinite(lat) || !item.name) continue;
        const address = String(item.address || "");
        publicPlaces.push(indexedLocal({
          id: prefix + ":" + item.id,
          title: String(item.name),
          address,
          addresses: address ? [address] : [],
          kind,
          source: "public-data",
          point: { lon, lat },
        }));
      }
    };

    addPublic(publicPayload.datasets.parks.rows, "park", "park");
    addPublic(publicPayload.datasets.childZones.rows, "childFacility", "zone");
    addPublic(publicPayload.datasets.childCenters.rows, "childFacility", "center");
    addPublic(publicPayload.datasets.toilets.rows, "toilet", "toilet");
    return { apartments, publicPlaces };
  })();

  return indexPromise;
}

function localSearch(
  items: IndexedLocal[],
  query: string,
  baseScore: number,
  limit: number,
) {
  const threshold = minimumScore(query);
  return items
    .map((item) => ({
      item,
      score: candidateScore(query, item.titleKey, item.addressKey, baseScore),
    }))
    .filter((entry) => entry.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function averagePoint(points: GeoPoint[]) {
  if (!points.length) return undefined;
  return {
    lon: points.reduce((sum, item) => sum + item.lon, 0) / points.length,
    lat: points.reduce((sum, item) => sum + item.lat, 0) / points.length,
  };
}
async function resolveApartment(
  candidate: IndexedLocal,
  score: number,
): Promise<PlaySafeSearchResult | undefined> {
  let point = apartmentPointCache.get(candidate.id);
  if (!point && !apartmentPointCache.has(candidate.id)) {
    const addresses = candidate.addresses.slice(0, 5);
    const primaryAddress = addresses[0] || candidate.address;
    const primaryResults = primaryAddress
      ? await searchVWorldAddress(primaryAddress).catch(() => [])
      : [];

    point = primaryResults.find((item) => item.kind === "parcel")?.point;

    if (!point) {
      const roadAddresses = addresses.slice(1, 4);
      const settled = await Promise.allSettled(
        roadAddresses.map((address) => searchVWorldAddress(address)),
      );
      const points: GeoPoint[] = [];

      for (const result of settled) {
        if (result.status !== "fulfilled" || !result.value.length) continue;
        const best = result.value.find((item) => item.kind === "road")
          ?? result.value[0];
        if (!best) continue;
        if (
          !points.some((item) =>
            Math.abs(item.lon - best.point.lon) < 0.000001
            && Math.abs(item.lat - best.point.lat) < 0.000001)
        ) {
          points.push(best.point);
        }
      }

      point = averagePoint(points) ?? primaryResults[0]?.point;
    }

    if (!point) {
      const placeResults = await searchVWorldPlace(candidate.title).catch(() => []);
      point = placeResults[0]?.point;
    }
    apartmentPointCache.set(candidate.id, point);
  }

  if (!point) return undefined;
  return {
    id: candidate.id,
    title: candidate.title,
    address: candidate.address,
    point,
    kind: "apartment",
    source: "kapt",
    score,
  };
}

function searchVariants(
  query: string,
  apartmentMatches: Array<{ item: IndexedLocal; score: number }>,
) {
  const variants = [query.trim()];
  for (const match of apartmentMatches.slice(0, 2)) {
    if (!variants.includes(match.item.title)) variants.push(match.item.title);
  }
  return variants.slice(0, 3);
}
function fromVWorld(
  query: string,
  item: AddressSearchResult,
): PlaySafeSearchResult {
  const kind: PlaySafeSearchKind = item.kind === "road"
    ? "road"
    : item.kind === "parcel"
      ? "parcel"
      : "place";
  const baseScore = kind === "place" ? 105 : kind === "road" ? 95 : 88;
  return {
    id: "vworld:" + item.id,
    title: item.title,
    address: item.address,
    point: item.point,
    kind,
    source: "vworld",
    score: candidateScore(
      query,
      normalizeSearchText(item.title),
      normalizeSearchText(item.address),
      baseScore,
    ),
  };
}

function distanceMeters(a: GeoPoint, b: GeoPoint) {
  const lat = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const x = (a.lon - b.lon) * 111_320 * Math.cos(lat);
  const y = (a.lat - b.lat) * 111_320;
  return Math.hypot(x, y);
}
function semanticallySame(a: PlaySafeSearchResult, b: PlaySafeSearchResult) {
  const aKey = normalizeSearchText(a.title);
  const bKey = normalizeSearchText(b.title);
  const aCore = brandCore(aKey);
  const bCore = brandCore(bKey);
  const titleSimilar = aKey === bKey
    || stripResidenceSuffix(aKey) === stripResidenceSuffix(bKey)
    || (
      aCore.brand
      && aCore.brand === bCore.brand
      && aCore.core === bCore.core
    )
    || diceSimilarity(aKey, bKey) >= 0.84;

  return titleSimilar && distanceMeters(a.point, b.point) <= 450;
}

function dedupeRanked(items: PlaySafeSearchResult[]) {
  const ranked = [...items].sort((a, b) => b.score - a.score);
  const output: PlaySafeSearchResult[] = [];
  for (const item of ranked) {
    if (output.some((existing) =>
      distanceMeters(existing.point, item.point) <= 18
      || semanticallySame(existing, item))) {
      continue;
    }
    output.push(item);
    if (output.length >= 8) break;
  }
  return output;
}
export async function searchPlaySafePlaces(
  query: string,
): Promise<PlaySafeSearchResult[]> {
  const trimmed = query.trim();
  if (normalizeSearchText(trimmed).length < 2) return [];

  const cacheKey = normalizeSearchText(trimmed);
  const cached = queryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.items;

  const index = await loadSearchIndex();
  const apartmentMatches = localSearch(index.apartments, trimmed, 160, 8);
  const publicMatches = localSearch(index.publicPlaces, trimmed, 95, 10);

  const publicResults = publicMatches.flatMap(({ item, score }) => item.point
    ? [{
        id: item.id,
        title: item.title,
        address: item.address,
        point: item.point,
        kind: item.kind,
        source: item.source,
        score,
      } satisfies PlaySafeSearchResult]
    : []);
  const variants = searchVariants(trimmed, apartmentMatches);
  const [resolvedApartments, placeSettled, addressResults] = await Promise.all([
    Promise.all(
      apartmentMatches.slice(0, 2).map(({ item, score }) =>
        resolveApartment(item, score)),
    ),
    Promise.allSettled(
      variants.map((variant) => searchVWorldPlace(variant)),
    ),
    searchVWorldAddress(trimmed).catch(() => []),
  ]);

  const vworldItems: AddressSearchResult[] = [];
  for (const result of placeSettled) {
    if (result.status === "fulfilled") vworldItems.push(...result.value);
  }
  vworldItems.push(...addressResults);

  const combined = [
    ...resolvedApartments.filter(
      (item): item is PlaySafeSearchResult => Boolean(item),
    ),
    ...publicResults,
    ...vworldItems.map((item) => fromVWorld(trimmed, item)),
  ];
  const items = dedupeRanked(combined);
  queryCache.set(cacheKey, {
    expiresAt: Date.now() + 10 * 60_000,
    items,
  });
  return items;
}
