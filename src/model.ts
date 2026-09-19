import type {
  BuildingMass,
  CreateMassInput,
  Footprint,
  GeoPoint,
  LocalPoint,
  MassPatch,
  Scenario,
  Site,
  SpatialWorkspace,
  WorkspaceAction,
} from "./types";

export const siteTimeZoneOffsetMinutes = 540;

const demoCenter = { lon: 127.11052, lat: 37.39483 };
const demoSite: Site = {
  id: "demo-pangyo",
  name: "부지를 선택하세요",
  center: demoCenter,
  boundary: [
    { lon: demoCenter.lon - 0.00022, lat: demoCenter.lat - 0.00016 },
    { lon: demoCenter.lon + 0.00022, lat: demoCenter.lat - 0.00016 },
    { lon: demoCenter.lon + 0.00022, lat: demoCenter.lat + 0.00016 },
    { lon: demoCenter.lon - 0.00022, lat: demoCenter.lat + 0.00016 },
  ],
  source: "demo",
};

export type SolarPosition = {
  azimuthDeg: number;
  elevationDeg: number;
  declinationDeg: number;
  equationOfTimeMinutes: number;
  isDaylight: boolean;
};

export type ShadowPolygon = {
  points: LocalPoint[];
  lengthM: number;
  solar: SolarPosition;
};

const defaultRectangle: Footprint = { kind: "rectangle", widthM: 32, depthM: 24 };

export const initialState: SpatialWorkspace = {
  site: demoSite,
  timeZoneOffsetMinutes: siteTimeZoneOffsetMinutes,
  scenarios: [],
  activeScenarioId: undefined,
  compareScenarioId: undefined,
};

export function getScenario(state: SpatialWorkspace, id: string): Scenario {
  const found = state.scenarios.find((scenario) => scenario.id === id);
  if (!found) throw new Error(`Unknown scenario: ${id}`);
  return found;
}

export function getActiveScenario(state: SpatialWorkspace) {
  return state.activeScenarioId ? state.scenarios.find((scenario) => scenario.id === state.activeScenarioId) : undefined;
}

export function cloneFootprint(footprint: Footprint): Footprint {
  return footprint.kind === "rectangle"
    ? { ...footprint }
    : { kind: "polygon", points: footprint.points.map((point) => ({ ...point })) };
}

export function cloneMass(mass: BuildingMass): BuildingMass {
  return {
    ...mass,
    position: { ...mass.position },
    footprint: cloneFootprint(mass.footprint),
  };
}

export function footprintPoints(footprint: Footprint): LocalPoint[] {
  if (footprint.kind === "polygon") return footprint.points;
  const halfWidth = footprint.widthM / 2;
  const halfDepth = footprint.depthM / 2;
  return [
    { xM: -halfWidth, yM: -halfDepth },
    { xM: halfWidth, yM: -halfDepth },
    { xM: halfWidth, yM: halfDepth },
    { xM: -halfWidth, yM: halfDepth },
  ];
}

export function rotatedFootprintPoints(mass: BuildingMass): LocalPoint[] {
  const angle = (mass.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return footprintPoints(mass.footprint).map(({ xM, yM }) => ({
    xM: xM * cos - yM * sin,
    yM: xM * sin + yM * cos,
  }));
}

export function footprintBounds(mass: BuildingMass) {
  const points = rotatedFootprintPoints(mass);
  const xs = points.map((point) => point.xM);
  const ys = points.map((point) => point.yM);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    widthM: Math.max(...xs) - Math.min(...xs),
    depthM: Math.max(...ys) - Math.min(...ys),
  };
}

export function footprintAreaM2(footprint: Footprint) {
  const points = footprintPoints(footprint);
  return Math.abs(points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.xM * next.yM - next.xM * point.yM;
  }, 0) / 2);
}

export function estimateGfa(mass: BuildingMass) {
  return Math.round(footprintAreaM2(mass.footprint) * mass.floors);
}

export function geoPointToLocal(center: GeoPoint, point: GeoPoint): LocalPoint {
  const northM = (point.lat - center.lat) * 111_320;
  const eastM = (point.lon - center.lon) * 111_320 * Math.cos((center.lat * Math.PI) / 180);
  return { xM: eastM, yM: northM };
}

export function localPointToGeo(center: GeoPoint, point: LocalPoint): GeoPoint {
  return {
    lon: center.lon + point.xM / (111_320 * Math.cos((center.lat * Math.PI) / 180)),
    lat: center.lat + point.yM / 111_320,
  };
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value: number) {
  return (value * 180) / Math.PI;
}

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

function clampUnit(value: number) {
  return Math.min(1, Math.max(-1, value));
}

function parseLocalDateTime(localDateTime: string, timeZoneOffsetMinutes: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(localDateTime);
  if (!match) return { date: new Date(Number.NaN), year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? 0);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second) - timeZoneOffsetMinutes * 60_000);
  return { date, year, month, day, hour, minute, second };
}

/** NOAA solar position approximation using the selected site and local time. */
export function solarPosition(
  location: GeoPoint,
  localDateTime: string,
  timeZoneOffsetMinutes = siteTimeZoneOffsetMinutes,
): SolarPosition {
  const parsed = parseLocalDateTime(localDateTime, timeZoneOffsetMinutes);
  if (Number.isNaN(parsed.date.getTime())) {
    return { azimuthDeg: Number.NaN, elevationDeg: Number.NaN, declinationDeg: Number.NaN, equationOfTimeMinutes: Number.NaN, isDaylight: false };
  }

  const julianDay = parsed.date.getTime() / 86_400_000 + 2_440_587.5;
  const julianCentury = (julianDay - 2_451_545) / 36_525;
  const geomMeanLongSun = normalizeDegrees(280.46646 + julianCentury * (36_000.76983 + julianCentury * 0.0003032));
  const geomMeanAnomSun = 357.52911 + julianCentury * (35_999.05029 - 0.0001537 * julianCentury);
  const eccentricity = 0.016708634 - julianCentury * (0.000042037 + 0.0000001267 * julianCentury);
  const anomalyRadians = degreesToRadians(geomMeanAnomSun);
  const sunEquationOfCenter = Math.sin(anomalyRadians) * (1.914602 - julianCentury * (0.004817 + 0.000014 * julianCentury))
    + Math.sin(2 * anomalyRadians) * (0.019993 - 0.000101 * julianCentury)
    + Math.sin(3 * anomalyRadians) * 0.000289;
  const sunTrueLongitude = geomMeanLongSun + sunEquationOfCenter;
  const omega = degreesToRadians(125.04 - 1_934.136 * julianCentury);
  const sunApparentLongitude = sunTrueLongitude - 0.00569 - 0.00478 * Math.sin(omega);
  const meanObliquity = 23 + (26 + ((21.448 - julianCentury * (46.815 + julianCentury * (0.00059 - julianCentury * 0.001813))) / 60)) / 60;
  const correctedObliquity = meanObliquity + 0.00256 * Math.cos(omega);
  const obliquityRadians = degreesToRadians(correctedObliquity);
  const apparentLongitudeRadians = degreesToRadians(sunApparentLongitude);
  const declinationRadians = Math.asin(Math.sin(obliquityRadians) * Math.sin(apparentLongitudeRadians));
  const declinationDeg = radiansToDegrees(declinationRadians);
  const variance = Math.tan(obliquityRadians / 2) ** 2;
  const equationOfTimeMinutes = 4 * radiansToDegrees(
    variance * Math.sin(2 * degreesToRadians(geomMeanLongSun))
      - 2 * eccentricity * Math.sin(anomalyRadians)
      + 4 * eccentricity * variance * Math.sin(anomalyRadians) * Math.cos(2 * degreesToRadians(geomMeanLongSun))
      - 0.5 * variance ** 2 * Math.sin(4 * degreesToRadians(geomMeanLongSun))
      - 1.25 * eccentricity ** 2 * Math.sin(2 * anomalyRadians),
  );

  const localMinutes = parsed.hour * 60 + parsed.minute + parsed.second / 60;
  const trueSolarTime = ((localMinutes + equationOfTimeMinutes + 4 * location.lon - timeZoneOffsetMinutes) % 1_440 + 1_440) % 1_440;
  const hourAngleDeg = trueSolarTime / 4 - 180;
  const latitudeRadians = degreesToRadians(location.lat);
  const hourAngleRadians = degreesToRadians(hourAngleDeg);
  const zenithRadians = Math.acos(clampUnit(
    Math.sin(latitudeRadians) * Math.sin(declinationRadians)
      + Math.cos(latitudeRadians) * Math.cos(declinationRadians) * Math.cos(hourAngleRadians),
  ));
  const elevationDeg = 90 - radiansToDegrees(zenithRadians);
  const azimuthDeg = normalizeDegrees(radiansToDegrees(Math.atan2(
    Math.sin(hourAngleRadians),
    Math.cos(hourAngleRadians) * Math.sin(latitudeRadians) - Math.tan(declinationRadians) * Math.cos(latitudeRadians),
  )) + 180);

  return { azimuthDeg, elevationDeg, declinationDeg, equationOfTimeMinutes, isDaylight: elevationDeg > 0 };
}

function cross(origin: LocalPoint, a: LocalPoint, b: LocalPoint) {
  return (a.xM - origin.xM) * (b.yM - origin.yM) - (a.yM - origin.yM) * (b.xM - origin.xM);
}

function convexHull(points: LocalPoint[]) {
  const sorted = points
    .map((point) => ({ xM: Number(point.xM.toFixed(6)), yM: Number(point.yM.toFixed(6)) }))
    .filter((point, index, all) => all.findIndex((candidate) => candidate.xM === point.xM && candidate.yM === point.yM) === index)
    .sort((a, b) => a.xM - b.xM || a.yM - b.yM);
  if (sorted.length <= 2) return sorted;
  const lower: LocalPoint[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: LocalPoint[] = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function computeShadowPolygon(
  mass: BuildingMass,
  location: GeoPoint,
  localDateTime: string,
  timeZoneOffsetMinutes = siteTimeZoneOffsetMinutes,
): ShadowPolygon {
  const solar = solarPosition(location, localDateTime, timeZoneOffsetMinutes);
  if (!solar.isDaylight) return { points: [], lengthM: 0, solar };

  const elevationRadians = degreesToRadians(solar.elevationDeg);
  const lengthM = mass.heightM / Math.tan(elevationRadians);
  if (!Number.isFinite(lengthM) || lengthM <= 0) return { points: [], lengthM: 0, solar };

  const basePoints = rotatedFootprintPoints(mass).map((point) => ({
    xM: point.xM + mass.position.eastM,
    yM: point.yM + mass.position.northM,
  }));
  const azimuthRadians = degreesToRadians(solar.azimuthDeg);
  const shadowEastM = -Math.sin(azimuthRadians) * lengthM;
  const shadowNorthM = -Math.cos(azimuthRadians) * lengthM;
  const shadowPoints = basePoints.map((point) => ({ xM: point.xM + shadowEastM, yM: point.yM + shadowNorthM }));
  return { points: convexHull([...basePoints, ...shadowPoints]), lengthM, solar };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizePoint(point: LocalPoint): LocalPoint {
  return {
    xM: clamp(Number(point.xM) || 0, -300, 300),
    yM: clamp(Number(point.yM) || 0, -300, 300),
  };
}

function normalizeFootprint(footprint: Footprint): Footprint {
  if (!footprint || footprint.kind === "rectangle") {
    return {
      kind: "rectangle",
      widthM: clamp(Number(footprint?.widthM) || 12, 6, 200),
      depthM: clamp(Number(footprint?.depthM) || 12, 6, 200),
    };
  }
  const points = Array.isArray(footprint.points) ? footprint.points.map(normalizePoint) : [];
  return {
    kind: "polygon",
    points: points.length >= 3 ? points : footprintPoints(defaultRectangle),
  };
}

function normalizePatch(patch: MassPatch): MassPatch {
  const normalized: MassPatch = {};
  if (patch.heightM !== undefined) normalized.heightM = clamp(Number(patch.heightM) || 6, 3, 120);
  if (patch.floors !== undefined) normalized.floors = Math.round(clamp(Number(patch.floors) || 1, 1, 40));
  if (patch.rotationDeg !== undefined) normalized.rotationDeg = clamp(Number(patch.rotationDeg) || 0, -180, 180);
  if (patch.position) {
    const position: Partial<BuildingMass["position"]> = {};
    if (patch.position.eastM !== undefined) position.eastM = clamp(Number(patch.position.eastM) || 0, -300, 300);
    if (patch.position.northM !== undefined) position.northM = clamp(Number(patch.position.northM) || 0, -300, 300);
    normalized.position = position;
  }
  if (patch.footprint) normalized.footprint = normalizeFootprint(patch.footprint);
  return normalized;
}

function applyMassPatch(mass: BuildingMass, patch: MassPatch) {
  const normalized = normalizePatch(patch);
  return {
    ...mass,
    ...normalized,
    position: { ...mass.position, ...normalized.position },
    footprint: normalized.footprint ? cloneFootprint(normalized.footprint) : cloneFootprint(mass.footprint),
  };
}

function nextScenarioId(scenarios: Scenario[]) {
  const ids = new Set(scenarios.map((scenario) => scenario.id));
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    if (!ids.has(letter)) return letter;
  }
  return `S${scenarios.length + 1}`;
}

function createScenario(scenarios: Scenario[], input: CreateMassInput = {}, createdBy: "human" | "agent" = "human"): Scenario {
  const id = nextScenarioId(scenarios);
  const footprint = normalizeFootprint(input.footprint ?? defaultRectangle);
  return {
    id,
    name: input.name?.trim() || `Option ${id}`,
    intent: input.intent?.trim() || "Early massing option",
    createdBy,
    mass: {
      id: `mass-${id.toLowerCase()}`,
      name: input.name?.trim() || `Building mass ${id}`,
      footprint,
      heightM: clamp(Number(input.heightM) || 18, 3, 120),
      floors: Math.round(clamp(Number(input.floors) || 5, 1, 40)),
      position: {
        eastM: clamp(Number(input.position?.eastM) || 0, -300, 300),
        northM: clamp(Number(input.position?.northM) || 0, -300, 300),
      },
      rotationDeg: clamp(Number(input.rotationDeg) || 0, -180, 180),
    },
    analysisTime: "2026-09-18T15:00",
  };
}

export function reducer(state: SpatialWorkspace, action: WorkspaceAction): SpatialWorkspace {
  switch (action.type) {
    case "SET_SITE":
      return {
        ...state,
        site: {
          ...action.site,
          center: { ...action.site.center },
          boundary: action.site.boundary.map((point) => ({ ...point })),
        },
        scenarios: [],
        activeScenarioId: undefined,
        compareScenarioId: undefined,
        sunStudyPoint: undefined,
        viewpoint: undefined,
      };
    case "CREATE_SCENARIO": {
      const next = createScenario(state.scenarios, action.input, action.createdBy);
      return {
        ...state,
        scenarios: [...state.scenarios, next],
        activeScenarioId: next.id,
        compareScenarioId: undefined,
      };
    }
    case "DELETE_SCENARIO": {
      getScenario(state, action.scenarioId);
      const scenarios = state.scenarios.filter((scenario) => scenario.id !== action.scenarioId);
      const activeScenarioId = state.activeScenarioId === action.scenarioId ? scenarios[0]?.id : state.activeScenarioId;
      const compareScenarioId = state.compareScenarioId === action.scenarioId ? undefined : state.compareScenarioId;
      return { ...state, scenarios, activeScenarioId, compareScenarioId };
    }
    case "SELECT_SCENARIO":
      getScenario(state, action.scenarioId);
      return { ...state, activeScenarioId: action.scenarioId };
    case "COMPARE_SCENARIOS":
      getScenario(state, action.primaryId);
      if (action.compareId) getScenario(state, action.compareId);
      return { ...state, activeScenarioId: action.primaryId, compareScenarioId: action.compareId };
    case "SET_SHADOW_TIME":
      getScenario(state, action.scenarioId);
      return {
        ...state,
        scenarios: state.scenarios.map((scenario) => scenario.id === action.scenarioId
          ? { ...scenario, analysisTime: action.value }
          : scenario),
      };
    case "EDIT_BUILDING_MASS":
      getScenario(state, action.scenarioId);
      return {
        ...state,
        scenarios: state.scenarios.map((scenario) => scenario.id === action.scenarioId
          ? { ...scenario, mass: applyMassPatch(scenario.mass, action.patch) }
          : scenario),
      };
    case "SET_SUN_STUDY_POINT":
      return { ...state, sunStudyPoint: action.point ? { ...action.point } : undefined };
    case "SET_VIEWPOINT":
      return {
        ...state,
        viewpoint: action.viewpoint
          ? { point: { ...action.viewpoint.point }, eyeHeightM: action.viewpoint.eyeHeightM }
          : undefined,
      };
    case "CLONE_SCENARIO": {
      const source = getScenario(state, action.sourceId);
      const id = nextScenarioId(state.scenarios);
      const next: Scenario = {
        ...source,
        id,
        parentId: source.id,
        name: action.name?.trim() || `Option ${id}`,
        createdBy: action.createdBy ?? "human",
        mass: { ...cloneMass(source.mass), id: `mass-${id.toLowerCase()}` },
      };
      return {
        ...state,
        scenarios: [...state.scenarios, next],
        activeScenarioId: id,
      };
    }
  }
}
