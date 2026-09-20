import { NextRequest, NextResponse } from "next/server";
import { nearbyChildFacilities } from "@/lib/server/playsafe-child-facilities";

export const dynamic = "force-dynamic";

function numberParam(value: string | null) {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  try {
    const lon = numberParam(request.nextUrl.searchParams.get("lon"));
    const lat = numberParam(request.nextUrl.searchParams.get("lat"));
    const radiusKm = Math.min(
      3,
      Math.max(0.5, numberParam(request.nextUrl.searchParams.get("radiusKm")) ?? 2),
    );

    if (lon === undefined || lat === undefined) {
      return NextResponse.json(
        { error: "출발지 후보를 찾을 기준 좌표가 필요합니다." },
        { status: 400 },
      );
    }

    const items = await nearbyChildFacilities({ lon, lat }, radiusKm, 24);
    return NextResponse.json(items);
  } catch (error) {
    return NextResponse.json(
      {
        error: "어린이집·유치원 출발지 조회 실패",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
