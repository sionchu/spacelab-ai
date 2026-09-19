import { NextRequest, NextResponse } from "next/server";
import { nearbyBuildings } from "@/lib/server/buildings";

export async function GET(request: NextRequest) {
  const lon = Number(request.nextUrl.searchParams.get("lon"));
  const lat = Number(request.nextUrl.searchParams.get("lat"));
  const radius = Math.min(
    500,
    Math.max(100, Number(request.nextUrl.searchParams.get("radius")) || 350),
  );

  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return NextResponse.json({ error: "Valid lon/lat are required." }, { status: 400 });
  }

  const collection = await nearbyBuildings(lon, lat, radius);
  return NextResponse.json(collection, {
    headers: {
      "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
    },
  });
}