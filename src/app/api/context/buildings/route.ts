import { NextRequest, NextResponse } from "next/server";
import type { Feature, FeatureCollection, Polygon } from "geojson";

type OverpassElement = {
  id: number;
  type: string;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
};

function numericHeight(tags: Record<string, string> = {}) {
  const direct = Number.parseFloat(String(tags.height || "").replace(/[^0-9.]/g, ""));
  if (Number.isFinite(direct) && direct > 1) return Math.min(300, direct);
  const levels = Number.parseFloat(tags["building:levels"] || "");
  if (Number.isFinite(levels) && levels > 0) return Math.min(300, levels * 3.2);
  return 9;
}

export async function GET(request: NextRequest) {
  const lon = Number(request.nextUrl.searchParams.get("lon"));
  const lat = Number(request.nextUrl.searchParams.get("lat"));
  const radius = Math.min(500, Math.max(100, Number(request.nextUrl.searchParams.get("radius")) || 350));

  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return NextResponse.json({ error: "Valid lon/lat are required." }, { status: 400 });
  }

  const latDelta = radius / 111_320;
  const lonDelta = radius / (111_320 * Math.cos((lat * Math.PI) / 180));
  const bbox = [lat - latDelta, lon - lonDelta, lat + latDelta, lon + lonDelta]
    .map((value) => value.toFixed(7))
    .join(",");
  const query = `[out:json][timeout:12];way["building"](${bbox});out tags geom;`;

  try {
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(15_000),
      next: { revalidate: 21_600 },
    });
    if (!response.ok) throw new Error(`Overpass request failed: ${response.status}`);

    const payload = await response.json() as { elements?: OverpassElement[] };
    const features: Array<Feature<Polygon>> = [];

    for (const element of payload.elements ?? []) {
      if (element.type !== "way" || !element.geometry || element.geometry.length < 3) continue;
      const coordinates = element.geometry.map((point) => [point.lon, point.lat]);
      const [firstLon, firstLat] = coordinates[0];
      const [lastLon, lastLat] = coordinates[coordinates.length - 1];
      if (firstLon !== lastLon || firstLat !== lastLat) coordinates.push([firstLon, firstLat]);

      features.push({
        type: "Feature",
        id: element.id,
        properties: {
          source: "OpenStreetMap",
          name: element.tags?.name || "",
          heightM: numericHeight(element.tags),
          levels: Number(element.tags?.["building:levels"]) || null,
        },
        geometry: { type: "Polygon", coordinates: [coordinates] },
      });
    }

    const collection: FeatureCollection<Polygon> = { type: "FeatureCollection", features };
    return NextResponse.json(collection, {
      headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" },
    });
  } catch (error) {
    return NextResponse.json(
      { type: "FeatureCollection", features: [], error: error instanceof Error ? error.message : String(error) },
      { status: 200 },
    );
  }
}
