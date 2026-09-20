import { NextRequest, NextResponse } from "next/server";
import { searchPlaySafePlaces } from "@/lib/server/playsafe-search";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get("q") || "";
    const lon = Number(request.nextUrl.searchParams.get("lon"));
    const lat = Number(request.nextUrl.searchParams.get("lat"));
    const bias = Number.isFinite(lon) && Number.isFinite(lat)
      ? { lon, lat }
      : undefined;
    return NextResponse.json(await searchPlaySafePlaces(query, bias));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
