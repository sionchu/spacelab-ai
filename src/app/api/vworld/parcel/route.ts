import { NextRequest, NextResponse } from "next/server";
import { getVWorldParcelAtPoint } from "@/lib/server/vworld";

export async function GET(request: NextRequest) {
  const lon = Number(request.nextUrl.searchParams.get("lon"));
  const lat = Number(request.nextUrl.searchParams.get("lat"));
  const label = request.nextUrl.searchParams.get("label") || undefined;

  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return NextResponse.json({ error: "Valid lon/lat are required." }, { status: 400 });
  }

  try {
    const site = await getVWorldParcelAtPoint({ lon, lat }, label);
    return NextResponse.json({ site });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
