import { NextRequest, NextResponse } from "next/server";
import { searchAddress } from "@/lib/vworld/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get("q") || "";
    const broad = request.nextUrl.searchParams.get("broad") === "1";
    return NextResponse.json(await searchAddress(query, { allowNominatim: broad }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
