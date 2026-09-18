import type { SunStudySample } from "./analysis";

export type SunVisualState = "sun" | "planned-shadow" | "city-shadow" | "night";

function visualState(sample: SunStudySample, cityBlocked: Set<string>): SunVisualState {
  if (sample.state === "night") return "night";
  if (sample.state === "shadow") return "planned-shadow";
  if (cityBlocked.has(sample.localDateTime)) return "city-shadow";
  return "sun";
}

function timePart(localDateTime: string) {
  return localDateTime.slice(11, 16);
}

export function SunExposureTimeline({
  label,
  samples,
  cityBlockedTimes,
  activeLocalDateTime,
  onSelect,
}: {
  label?: string;
  samples: SunStudySample[];
  cityBlockedTimes: Iterable<string>;
  activeLocalDateTime?: string;
  onSelect?: (localDateTime: string) => void;
}) {
  const cityBlocked = new Set(cityBlockedTimes);
  if (!samples.length) return null;

  return <div className="sun-exposure-viz">
    {label && <div className="sun-exposure-label">{label}</div>}
    <div className="sun-exposure-track" aria-label={label ? `${label} direct sun timeline` : "Direct sun timeline"}>
      {samples.map((sample) => {
        const state = visualState(sample, cityBlocked);
        const isActive = Boolean(activeLocalDateTime && timePart(activeLocalDateTime) === timePart(sample.localDateTime));
        const title = `${timePart(sample.localDateTime)} · ${state.replace("-", " ")}`;
        return onSelect
          ? <button
              type="button"
              key={sample.localDateTime}
              className={`sun-segment ${state} ${isActive ? "active" : ""}`}
              title={title}
              aria-label={title}
              onClick={() => onSelect(sample.localDateTime)}
            />
          : <span
              key={sample.localDateTime}
              className={`sun-segment ${state} ${isActive ? "active" : ""}`}
              title={title}
            />;
      })}
    </div>
  </div>;
}

export function SunExposureLegend() {
  return <div className="sun-exposure-legend" aria-label="Direct sun timeline legend">
    <span><i className="sun-key sun"></i>Sun</span>
    <span><i className="sun-key planned-shadow"></i>Planned mass</span>
    <span><i className="sun-key city-shadow"></i>City context</span>
  </div>;
}

export function ViewImpactBar({
  visibleRatioPct,
  classification,
  label,
}: {
  visibleRatioPct: number;
  classification: string;
  label?: string;
}) {
  const ratio = Math.min(100, Math.max(0, visibleRatioPct));
  return <div className="view-impact-viz">
    <div className="view-impact-head">
      <span>{label ?? "Estimated visibility"}</span>
      <strong>{ratio.toFixed(0)}%</strong>
    </div>
    <div className="view-impact-track" aria-label={`${label ?? "Estimated visibility"} ${ratio.toFixed(0)}%`}>
      <span style={{ width: `${ratio}%` }}></span>
    </div>
    <small>{classification.replaceAll("-", " ")}</small>
  </div>;
}
