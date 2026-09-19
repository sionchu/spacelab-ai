import { NextRequest, NextResponse } from "next/server";
import { parcelAtPoint } from "@/lib/vworld/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const lon = Number(body?.point?.lon);
    const lat = Number(body?.point?.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      return NextResponse.json({ error: "Invalid point" }, { status: 400 });
    }
    const site = await parcelAtPoint({ lon, lat }, body?.label ? String(body.label) : undefined);
    return NextResponse.json(site);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
