import type { PlaySafeWeather } from "@/src/playsafe";

type OpenMeteoPayload = {
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    apparent_temperature?: number[];
    relative_humidity_2m?: number[];
    cloud_cover?: number[];
    precipitation?: number[];
    wind_speed_10m?: number[];
  };
};

function nearestIndex(times: string[], requested: string) {
  const target = new Date(requested + ":00+09:00").getTime();
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  times.forEach((value, index) => {
    const time = new Date(value + ":00+09:00").getTime();
    const distance = Math.abs(time - target);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

function readWeather(payload: OpenMeteoPayload, index: number): PlaySafeWeather | undefined {
  const hourly = payload.hourly;
  const localDateTime = hourly?.time?.[index];
  if (!hourly || !localDateTime) return undefined;

  const numberAt = (values: number[] | undefined, fallback = 0) => {
    const value = Number(values?.[index]);
    return Number.isFinite(value) ? value : fallback;
  };

  return {
    localDateTime: localDateTime.slice(0, 16),
    temperatureC: numberAt(hourly.temperature_2m),
    apparentTemperatureC: numberAt(hourly.apparent_temperature),
    relativeHumidityPct: numberAt(hourly.relative_humidity_2m),
    cloudCoverPct: numberAt(hourly.cloud_cover),
    precipitationMm: numberAt(hourly.precipitation),
    windSpeedKph: numberAt(hourly.wind_speed_10m),
  };
}

export async function playSafeWeather(
  lon: number,
  lat: number,
  requestedLocalDateTime: string,
): Promise<{ current: PlaySafeWeather; timeline: PlaySafeWeather[] }> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("timezone", "Asia/Seoul");
  url.searchParams.set("forecast_days", "2");
  url.searchParams.set(
    "hourly",
    [
      "temperature_2m",
      "apparent_temperature",
      "relative_humidity_2m",
      "cloud_cover",
      "precipitation",
      "wind_speed_10m",
    ].join(","),
  );

  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    next: { revalidate: 900 },
  });
  if (!response.ok) throw new Error(`Open-Meteo failed: HTTP ${response.status}`);
  const payload = await response.json() as OpenMeteoPayload;
  const times = payload.hourly?.time ?? [];
  if (!times.length) throw new Error("Open-Meteo returned no hourly data");

  const index = nearestIndex(times, requestedLocalDateTime);
  const current = readWeather(payload, index);
  if (!current) throw new Error("Requested weather hour is unavailable");

  const timeline = Array.from({ length: 5 }, (_, offset) => readWeather(payload, Math.min(times.length - 1, index + offset)))
    .filter((value): value is PlaySafeWeather => Boolean(value));

  return { current, timeline };
}
