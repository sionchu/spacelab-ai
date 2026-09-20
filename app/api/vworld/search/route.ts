import { NextRequest, NextResponse } from "next/server";
import { searchPlaySafePlaces } from "@/lib/server/playsafe-search";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get("q") || "";
    return NextResponse.json(await searchPlaySafePlaces(query));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
