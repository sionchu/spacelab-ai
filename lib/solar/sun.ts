import * as SunCalc from "suncalc";

export function timeFromMinutes(minutes: number) {
  const value = Math.max(0, Math.min(1439, Math.round(minutes)));
  const hh = String(Math.floor(value / 60)).padStart(2, "0");
  const mm = String(value % 60).padStart(2, "0");
  return hh + ":" + mm;
}

export function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 900;
  return Math.max(0, Math.min(1439, hours * 60 + minutes));
}

export function localDateTimeToday(minutes = 900, timeZoneOffsetMinutes = 540) {
  const shifted = new Date(Date.now() + timeZoneOffsetMinutes * 60_000);
  return shifted.toISOString().slice(0, 10) + "T" + timeFromMinutes(minutes);
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
