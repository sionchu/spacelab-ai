import SunCalc from "suncalc";
import type { GeoPoint } from "@/types";

export type SunState = {
  azimuthDeg: number;
  altitudeDeg: number;
  polarDeg: number;
  daylight: boolean;
};

function localDate(date: string, totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return new Date(
    `${date}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00+09:00`,
  );
}

export function sunStateAt(
  point: GeoPoint,
  date: string,
  totalMinutes: number,
): SunState {
  const position = SunCalc.getPosition(localDate(date, totalMinutes), point.lat, point.lon);
  const altitudeDeg = position.altitude * 180 / Math.PI;
  const azimuthDeg = ((position.azimuth * 180 / Math.PI) + 180 + 360) % 360;
  return {
    azimuthDeg,
    altitudeDeg,
    polarDeg: Math.min(180, Math.max(0, 90 - altitudeDeg)),
    daylight: altitudeDeg > 0,
  };
}

export function timeLabel(totalMinutes: number) {
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}
