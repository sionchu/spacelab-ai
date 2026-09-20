import { searchVWorldPlaceNearby } from "@/lib/vworld/server";
import { nearbyMoisPlaygrounds } from "@/lib/server/playsafe-safemap";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import type { PlayPlace, PlaySafeTree } from "@/src/playsafe";

const APP_USER_AGENT = "PlaySafe/0.1 (+https://github.com/sionchu/spacelab-ai)";

type OsmNode = {
  id: string;
  lat: number;
  lon: number;
  tags: Record<string, string>;
};

type ParsedWay = {
  id: string;
  refs: string[];
  tags: Record<string, string>;
};

function decodeXml(value: string) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function attrs(raw: string) {
  const values: Record<string, string> = {};
  const regex = /([A-Za-z_:][A-Za-z0-9_.:-]*)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw))) values[match[1]] = decodeXml(match[2]);
  return values;
}

function tagsFrom(body: string) {
  const tags: Record<string, string> = {};
  const regex = /<tag\s+k="([^"]*)"\s+v="([^"]*)"\s*\/>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body))) tags[decodeXml(match[1])] = decodeXml(match[2]);
  return tags;
}

function distanceM(aLon: number, aLat: number, bLon: number, bLat: number) {
  const latScale = 111_320;
  const lonScale = 111_320 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot((bLon - aLon) * lonScale, (bLat - aLat) * latScale);
}

function bbox(lon: number, lat: number, radiusM: number) {
  const latDelta = radiusM / 111_320;
  const lonDelta = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [
    lon - lonDelta,
    lat - latDelta,
    lon + lonDelta,
    lat + latDelta,
  ].map((value) => value.toFixed(7)).join(",");
}

function parseOsmXml(xml: string) {
  const nodes = new Map<string, OsmNode>();

  const fullNodeRegex = /<node\s+([^>]*?)>([\s\S]*?)<\/node>/g;
  let match: RegExpExecArray | null;
  while ((match = fullNodeRegex.exec(xml))) {
    const attribute = attrs(match[1]);
    const lat = Number(attribute.lat);
    const lon = Number(attribute.lon);
    if (!attribute.id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    nodes.set(attribute.id, {
      id: attribute.id,
      lat,
      lon,
      tags: tagsFrom(match[2]),
    });
  }

  const simpleNodeRegex = /<node\s+([^>]*?)\/>/g;
  while ((match = simpleNodeRegex.exec(xml))) {
    const attribute = attrs(match[1]);
    if (!attribute.id || nodes.has(attribute.id)) continue;
    const lat = Number(attribute.lat);
    const lon = Number(attribute.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    nodes.set(attribute.id, { id: attribute.id, lat, lon, tags: {} });
  }

  const ways: ParsedWay[] = [];
  const wayRegex = /<way\s+([^>]*?)>([\s\S]*?)<\/way>/g;
  while ((match = wayRegex.exec(xml))) {
    const attribute = attrs(match[1]);
    if (!attribute.id) continue;
    const refs = Array.from(match[2].matchAll(/<nd\s+ref="([^"]+)"\s*\/>/g), (item) => item[1]);
    ways.push({ id: attribute.id, refs, tags: tagsFrom(match[2]) });
  }

  return { nodes, ways };
}

function wayPoints(way: ParsedWay, nodes: Map<string, OsmNode>) {
  return way.refs.flatMap((ref) => {
    const node = nodes.get(ref);
    return node ? [{ lon: node.lon, lat: node.lat }] : [];
  });
}

function centerOf(points: Array<{ lon: number; lat: number }>) {
  if (!points.length) return undefined;
  return {
    lon: points.reduce((sum, point) => sum + point.lon, 0) / points.length,
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
  };
}

function displayName(tags: Record<string, string>, kind: PlayPlace["kind"]) {
  const name = tags["name:ko"] || tags.name;
  if (name) return name;
  return kind === "playground" ? "이름 없는 어린이 놀이터" : "이름 없는 공원";
}

function addressFromTags(tags: Record<string, string>) {
  if (tags["addr:full"]) return tags["addr:full"];
  const region = tags["addr:province"] || tags["addr:state"];
  const city = tags["addr:city"];
  const district = tags["addr:district"] || tags["addr:county"];
  const locality = tags["addr:subdistrict"] || tags["addr:neighbourhood"];
  const street = tags["addr:street"];
  const houseNumber = tags["addr:housenumber"];
  const streetAddress = [street, houseNumber].filter(Boolean).join(" ");
  const values = [region, city, district, locality, streetAddress].filter(Boolean);
  return values.length >= 2 ? Array.from(new Set(values)).join(" ") : undefined;
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

function choosePlaces(items: PlayPlace[], limit: number) {
  const nameRank = (item: PlayPlace) =>
    item.name.startsWith("이름 없는") ? 1 : 0;
  items.sort((a, b) => {
    const kindRank = (item: PlayPlace) => item.kind === "playground" ? 0 : 1;
    return kindRank(a) - kindRank(b) || nameRank(a) - nameRank(b) || a.distanceM - b.distanceM;
  });

  const selected: PlayPlace[] = [];
  for (const item of items) {
    const duplicateIndex = selected.findIndex((prior) =>
      distanceM(prior.point.lon, prior.point.lat, item.point.lon, item.point.lat) < 35
      && prior.kind === item.kind);

    if (duplicateIndex < 0) {
      selected.push(item);
    } else {
      const prior = selected[duplicateIndex];
      const geometrySource = prior.boundary?.length
        ? prior
        : item.boundary?.length
          ? item
          : prior;
      const betterName = nameRank(item) < nameRank(prior) ? item.name : prior.name;
      const sourceNames = [
        prior.tags.source,
        prior.tags.sources,
        item.tags.source,
        item.tags.sources,
      ].filter(Boolean).join(" + ");

      selected[duplicateIndex] = {
        ...geometrySource,
        name: betterName,
        address: prior.address || item.address,
        distanceM: Math.min(prior.distanceM, item.distanceM),
        tags: {
          ...prior.tags,
          ...item.tags,
          sources: Array.from(new Set(sourceNames.split(" + ").filter(Boolean))).join(" + "),
        },
      };
    }

    if (selected.length >= limit) break;
  }
  return selected;
}

async function nearbyVWorldPlayPlaces(
  lon: number,
  lat: number,
  radiusM: number,
): Promise<PlayPlace[]> {
  const center = { lon, lat };
  const settled = await Promise.allSettled(
    ["놀이터", "어린이놀이터", "어린이공원"].map((query) =>
      searchVWorldPlaceNearby(query, center, radiusM, 40)),
  );

  const results = settled.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []);
  const seen = new Set<string>();
  const output: PlayPlace[] = [];

  for (const item of results) {
    const distance = distanceM(lon, lat, item.point.lon, item.point.lat);
    if (distance > radiusM * 1.05) continue;
    const signature = item.point.lon.toFixed(6) + "," + item.point.lat.toFixed(6);
    if (seen.has(signature)) continue;

    const searchable = (item.title + " " + (item.category || "")).replace(/\s+/g, "");
    if (!/(놀이터|어린이공원|어린이놀이시설|유아놀이터)/.test(searchable)) continue;
    if (/(키즈카페|실내놀이터|실내놀이방)/.test(searchable)) continue;

    seen.add(signature);
    const kind: PlayPlace["kind"] =
      item.title.includes("공원") && !item.title.includes("놀이터")
        ? "park"
        : "playground";

    output.push({
      id: "vworld-" + item.id,
      name: item.title || (kind === "playground" ? "어린이 놀이터" : "어린이공원"),
      kind,
      point: item.point,
      address: item.address || undefined,
      distanceM: distance,
      tags: {
        source: "VWorld POI",
        category: item.category || "",
        leisure: kind === "playground" ? "playground" : "park",
      },
    });
  }

  return output;
}

type PlaySafeMapContext = {
  places: PlayPlace[];
  buildings: FeatureCollection<Polygon>;
  trees: PlaySafeTree[];
  playgroundSources: string[];
};

type MapContextCacheEntry = {
  fetchedAt: number;
  value?: PlaySafeMapContext;
  pending?: Promise<PlaySafeMapContext>;
};

const MAP_CONTEXT_CACHE_TTL_MS = 10 * 60_000;
const mapContextCache = new Map<string, MapContextCacheEntry>();

function mapContextCacheKey(lon: number, lat: number, radiusM: number, limit: number) {
  return [lon.toFixed(5), lat.toFixed(5), radiusM, limit].join(":");
}

async function fetchPlaySafeMapContext(
  lon: number,
  lat: number,
  radiusM: number,
  limit: number,
): Promise<PlaySafeMapContext> {
  const vworldPlacesPromise = nearbyVWorldPlayPlaces(lon, lat, radiusM).catch(() => []);
  const moisPlacesPromise = nearbyMoisPlaygrounds({ lon, lat }, radiusM, 80).catch(() => []);
  const url = new URL("https://api.openstreetmap.org/api/0.6/map");
  url.searchParams.set("bbox", bbox(lon, lat, radiusM));

  const response = await fetch(url, {
    headers: {
      Accept: "application/xml,text/xml",
      "User-Agent": APP_USER_AGENT,
      Referer: "https://github.com/sionchu/spacelab-ai",
    },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("OpenStreetMap map API failed: HTTP " + response.status);
  const xml = await response.text();
  const parsed = parseOsmXml(xml);

  const placeItems: PlayPlace[] = [];

  for (const node of parsed.nodes.values()) {
    const leisure = node.tags.leisure;
    if (leisure !== "playground" && leisure !== "park") continue;
    const kind: PlayPlace["kind"] = leisure === "playground" ? "playground" : "park";
    placeItems.push({
      id: "osm-node-" + node.id,
      name: displayName(node.tags, kind),
      kind,
      point: { lon: node.lon, lat: node.lat },
      address: addressFromTags(node.tags),
      distanceM: distanceM(lon, lat, node.lon, node.lat),
      tags: node.tags,
    });
  }

  for (const way of parsed.ways) {
    const leisure = way.tags.leisure;
    if (leisure !== "playground" && leisure !== "park") continue;
    const points = wayPoints(way, parsed.nodes);
    const center = centerOf(points);
    if (!center) continue;
    const kind: PlayPlace["kind"] = leisure === "playground" ? "playground" : "park";
    placeItems.push({
      id: "osm-way-" + way.id,
      name: displayName(way.tags, kind),
      kind,
      point: center,
      boundary: points,
      address: addressFromTags(way.tags),
      distanceM: distanceM(lon, lat, center.lon, center.lat),
      tags: way.tags,
    });
  }

  const [moisPlaces, vworldPlaces] = await Promise.all([
    moisPlacesPromise,
    vworldPlacesPromise,
  ]);
  placeItems.push(...moisPlaces, ...vworldPlaces);
  const places = choosePlaces(placeItems, limit);
  const playgroundSources = [
    "OpenStreetMap",
    ...(moisPlaces.length ? ["MOIS SafeMap IF_0007"] : []),
    ...(vworldPlaces.length ? ["VWorld nearby POI"] : []),
  ];
  const trees: PlaySafeTree[] = [];
  for (const node of parsed.nodes.values()) {
    if (node.tags.natural !== "tree") continue;
    const closeToCandidate = places.some((place) =>
      distanceM(place.point.lon, place.point.lat, node.lon, node.lat) <= 100);
    if (!closeToCandidate) continue;
    const parsedHeight = numberFrom(node.tags.height);
    const crownDiameter = numberFrom(node.tags.diameter_crown || node.tags["crown:diameter"]);
    trees.push({
      point: { lon: node.lon, lat: node.lat },
      heightM: Number.isFinite(parsedHeight) && parsedHeight > 2 ? Math.min(30, parsedHeight) : 8,
      crownRadiusM: Number.isFinite(crownDiameter) && crownDiameter > 1
        ? Math.min(10, Math.max(1.5, crownDiameter / 2))
        : 3.5,
    });
  }

  const features: Array<Feature<Polygon>> = [];

  for (const way of parsed.ways) {
    if (!way.tags.building) continue;
    const points = wayPoints(way, parsed.nodes);
    if (points.length < 3) continue;
    const center = centerOf(points);
    if (!center) continue;
    const closeToCandidate = places.some((place) =>
      distanceM(place.point.lon, place.point.lat, center.lon, center.lat) <= 220);
    if (!closeToCandidate) continue;

    const coordinates = points.map((point) => [point.lon, point.lat]);
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) coordinates.push([...first]);
    features.push({
      type: "Feature",
      id: Number(way.id),
      properties: {
        ...way.tags,
        source: "OpenStreetMap",
        heightM: buildingHeightM(way.tags),
      },
      geometry: { type: "Polygon", coordinates: [coordinates] },
    });
  }

  return {
    places,
    buildings: { type: "FeatureCollection", features },
    trees,
    playgroundSources,
  };
}

export async function playSafeMapContext(
  lon: number,
  lat: number,
  radiusM = 800,
  limit = 4,
): Promise<PlaySafeMapContext> {
  const key = mapContextCacheKey(lon, lat, radiusM, limit);
  const cached = mapContextCache.get(key);
  const now = Date.now();

  if (cached?.value && now - cached.fetchedAt <= MAP_CONTEXT_CACHE_TTL_MS) {
    return cached.value;
  }
  if (cached?.pending) return cached.pending;

  const pending = fetchPlaySafeMapContext(lon, lat, radiusM, limit);
  mapContextCache.set(key, { fetchedAt: now, value: cached?.value, pending });

  try {
    const value = await pending;
    mapContextCache.set(key, { fetchedAt: Date.now(), value });
    return value;
  } catch (error) {
    if (cached?.value) {
      mapContextCache.set(key, cached);
      return cached.value;
    }
    mapContextCache.delete(key);
    throw error;
  }
}
