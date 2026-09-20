import { NextRequest, NextResponse } from "next/server";
import { playSafeWalkingRoute } from "@/lib/server/playsafe-route";

export const dynamic = "force-dynamic";

function numberParam(value: string | null) {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  try {
    const fromLon = numberParam(request.nextUrl.searchParams.get("fromLon"));
    const fromLat = numberParam(request.nextUrl.searchParams.get("fromLat"));
    const toLon = numberParam(request.nextUrl.searchParams.get("toLon"));
    const toLat = numberParam(request.nextUrl.searchParams.get("toLat"));

    if (
      fromLon === undefined
      || fromLat === undefined
      || toLon === undefined
      || toLat === undefined
    ) {
      return NextResponse.json(
        { error: "출발지와 도착지 좌표가 필요합니다." },
        { status: 400 },
      );
    }

    return NextResponse.json(await playSafeWalkingRoute(
      { lon: fromLon, lat: fromLat },
      { lon: toLon, lat: toLat },
    ));
  } catch (error) {
    return NextResponse.json(
      {
        error: "보행 경로 분석 실패",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
