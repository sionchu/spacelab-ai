export type GeoPoint = { lon: number; lat: number };

export type LocalPoint = { xM: number; yM: number };

export type Site = {
  id: string;
  name: string;
  center: GeoPoint;
  boundary: GeoPoint[];
  pnu?: string;
  address?: string;
  source: "vworld-cadastral" | "manual-point" | "demo";
};

export type RectangleFootprint = {
  kind: "rectangle";
  widthM: number;
  depthM: number;
};

export type PolygonFootprint = {
  kind: "polygon";
  points: LocalPoint[];
};

export type Footprint = RectangleFootprint | PolygonFootprint;

export type MassPosition = {
  eastM: number;
  northM: number;
};

/** Canonical domain object. Rendering adapters consume this object but do not own it. */
export type BuildingMass = {
  id: string;
  name: string;
  footprint: Footprint;
  heightM: number;
  floors: number;
  position: MassPosition;
  rotationDeg: number;
};

/** A branchable design alternative and its analysis time are canonical scenario state. */
export type Scenario = {
  id: string;
  name: string;
  parentId?: string;
  intent: string;
  createdBy: "human" | "agent";
  mass: BuildingMass;
  analysisTime: string;
};

export type Viewpoint = {
  point: GeoPoint;
  eyeHeightM: number;
};

export type SpatialWorkspace = {
  site: Site;
  /** Local scenario datetimes are interpreted with this fixed site offset. */
  timeZoneOffsetMinutes: number;
  scenarios: Scenario[];
  activeScenarioId?: string;
  compareScenarioId?: string;
  /** Ground point used for deterministic direct-sun study. Defaults to site center in the UI. */
  sunStudyPoint?: GeoPoint;
  /** Saved camera observation point for repeatable scenario viewing. */
  viewpoint?: Viewpoint;
};

export type MassPatch = Partial<Pick<BuildingMass, "heightM" | "floors" | "rotationDeg" | "footprint">> & {
  position?: Partial<MassPosition>;
};

export type CreateMassInput = {
  name?: string;
  intent?: string;
  /** Local site datetime used by the scenario's solar preview. */
  analysisTime?: string;
  footprint?: Footprint;
  heightM?: number;
  floors?: number;
  position?: MassPosition;
  rotationDeg?: number;
};

export type ActionSource = "human" | "agent";

export type WorkspaceAction =
  | { type: "SET_SITE"; site: Site; source?: ActionSource }
  | { type: "CREATE_SCENARIO"; input?: CreateMassInput; createdBy?: ActionSource }
  | { type: "DELETE_SCENARIO"; scenarioId: string; source?: ActionSource }
  | { type: "SELECT_SCENARIO"; scenarioId: string }
  | { type: "COMPARE_SCENARIOS"; primaryId: string; compareId?: string }
  | { type: "CLONE_SCENARIO"; sourceId: string; name?: string; createdBy?: ActionSource }
  | { type: "EDIT_BUILDING_MASS"; scenarioId: string; patch: MassPatch; source?: ActionSource }
  | { type: "SET_SHADOW_TIME"; scenarioId: string; value: string; source?: ActionSource }
  | { type: "SET_SUN_STUDY_POINT"; point?: GeoPoint; source?: ActionSource }
  | { type: "SET_VIEWPOINT"; viewpoint?: Viewpoint; source?: ActionSource };

export type ApplicationActions = {
  setSite: (site: Site, source?: ActionSource) => void;
  createBuildingMass: (input?: CreateMassInput, createdBy?: ActionSource) => void;
  deleteScenario: (scenarioId: string, source?: ActionSource) => void;
  selectScenario: (scenarioId: string) => void;
  compareScenarios: (primaryId: string, compareId?: string) => void;
  cloneScenario: (sourceId: string, name?: string, createdBy?: ActionSource) => void;
  editBuildingMass: (scenarioId: string, patch: MassPatch, source?: ActionSource) => void;
  setMassFootprint: (scenarioId: string, footprint: Footprint, source?: ActionSource) => void;
  setShadowTime: (scenarioId: string, value: string, source?: ActionSource) => void;
  setSunStudyPoint: (point?: GeoPoint, source?: ActionSource) => void;
  setViewpoint: (viewpoint?: Viewpoint, source?: ActionSource) => void;
};
