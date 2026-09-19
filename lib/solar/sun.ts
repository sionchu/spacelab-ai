import * as SunCalc from "suncalc";

export function timeFromMinutes(minutes: number) {
  const value = Math.max(0, Math.min(1439, Math.round(minutes)));
  const hh = String(Math.floor(value / 60)).padStart(2, "0");
  const mm = String(value % 60).padStart(2, "0");
  return hh + ":" + mm;
}

export function localKstDate(date: string, minutes: number) {
  return new Date(date + "T" + timeFromMinutes(minutes) + ":00+09:00");
}

export function solarPositionAt(date: string, minutes: number, lat: number, lon: number) {
  const position = SunCalc.getPosition(localKstDate(date, minutes), lat, lon);
  return {
    azimuthDeg: position.azimuth,
    altitudeDeg: position.altitude,
    isDaylight: position.altitude > 0,
  };
}
