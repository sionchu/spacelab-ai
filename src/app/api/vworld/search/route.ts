import { NextRequest, NextResponse } from "next/server";
import { searchVWorldAddress } from "@/lib/server/vworld";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return NextResponse.json({ results: [] });

  try {
    const results = await searchVWorldAddress(query);
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error), results: [] },
      { status: 502 },
    );
  }
}
