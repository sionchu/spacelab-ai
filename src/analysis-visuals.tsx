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
    <div className="sun-exposure-track" aria-label={label ? `${label} 일조 시간대` : "일조 시간대"}>
      {samples.map((sample) => {
        const state = visualState(sample, cityBlocked);
        const isActive = Boolean(activeLocalDateTime && timePart(activeLocalDateTime) === timePart(sample.localDateTime));
        const title = `${timePart(sample.localDateTime)} · ${
          state === "sun"
            ? "일조"
            : state === "planned-shadow"
              ? "계획 건물 음영"
              : state === "city-shadow"
                ? "주변 건물·지형 음영"
                : "야간"
        }`;

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
  return <div className="sun-exposure-legend" aria-label="일조 시간대 범례">
    <span><i className="sun-key sun"></i>일조</span>
    <span><i className="sun-key planned-shadow"></i>계획 건물</span>
    <span><i className="sun-key city-shadow"></i>주변 환경</span>
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
  const classificationLabel = classification === "mostly-visible"
    ? "대부분 보임"
    : classification === "partially-visible"
      ? "일부 보임"
      : classification === "mostly-occluded"
        ? "대부분 가림"
        : "분석 불가";

  return <div className="view-impact-viz">
    <div className="view-impact-head">
      <span>{label ?? "예상 가시율"}</span>
      <strong>{ratio.toFixed(0)}%</strong>
    </div>
    <div className="view-impact-track" aria-label={`${label ?? "예상 가시율"} ${ratio.toFixed(0)}%`}>
      <span style={{ width: `${ratio}%` }}></span>
    </div>
    <small>{classificationLabel}</small>
  </div>;
}
