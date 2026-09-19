import { solarPosition } from "@/model";
import type { GeoPoint } from "@/types";

export type SunState = {
  azimuthDeg: number;
  altitudeDeg: number;
  polarDeg: number;
  daylight: boolean;
};

export function timeLabel(totalMinutes: number) {
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

export function sunStateAt(
  point: GeoPoint,
  date: string,
  totalMinutes: number,
): SunState {
  const solar = solarPosition(point, `${date}T${timeLabel(totalMinutes)}`, 540);
  return {
    azimuthDeg: solar.azimuthDeg,
    altitudeDeg: solar.elevationDeg,
    polarDeg: Math.min(180, Math.max(0, 90 - solar.elevationDeg)),
    daylight: solar.isDaylight,
  };
}
