import { directSunStudy, planningMetrics } from "./analysis";
import { getScenario } from "./model";
import type {
  ApplicationActions,
  CreateMassInput,
  Footprint,
  GeoPoint,
  MassPatch,
  Site,
  SpatialWorkspace,
  Viewpoint,
} from "./types";
import { viewImpact, type BuildingContextCollection } from "./view-impact";

declare global {
  interface Document {
    modelContext?: {
      registerTool: (
        tool: {
          name: string;
          title?: string;
          description: string;
          inputSchema: Record<string, unknown>;
          annotations?: { readOnlyHint?: boolean };
          execute: (input: any) => Promise<unknown> | unknown;
        },
        options?: { signal?: AbortSignal },
      ) => Promise<void>;
    };
  }
}

export type SpaceLabWebMcpBridge = {
  actions: ApplicationActions;
  getState: () => SpatialWorkspace;
  searchLocation: (query: string) => Promise<unknown>;
  selectSiteAtPoint: (point: GeoPoint, label?: string) => Promise<Site>;
  getBuildingContext: () => BuildingContextCollection;
};

const pointSchema = {
  type: "object",
  properties: {
    xM: { type: "number", minimum: -300, maximum: 300 },
    yM: { type: "number", minimum: -300, maximum: 300 },
  },
  required: ["xM", "yM"],
  additionalProperties: false,
};

const footprintSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["rectangle", "polygon"] },
    widthM: { type: "number", minimum: 6, maximum: 200 },
    depthM: { type: "number", minimum: 6, maximum: 200 },
    points: { type: "array", minItems: 3, maxItems: 32, items: pointSchema },
  },
  required: ["kind"],
  additionalProperties: false,
};

async function waitForWorkspaceChange(
  before: SpatialWorkspace,
  getState: () => SpatialWorkspace,
  timeoutMs = 800,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise<void>((resolve) => setTimeout(resolve, 16));
    const current = getState();
    if (current !== before) return current;
  }
  return getState();
}

async function applyWorkspaceChange(
  bridge: SpaceLabWebMcpBridge,
  action: () => void,
) {
  const before = bridge.getState();
  action();
  return waitForWorkspaceChange(before, bridge.getState);
}

function scenarioSnapshot(state: SpatialWorkspace, scenarioId: string) {
  const scenario = getScenario(state, scenarioId);
  return {
    scenario,
    planning: planningMetrics(state.site, scenario.mass),
  };
}

export function registerSpaceLabTools(bridge: SpaceLabWebMcpBridge) {
  if (typeof document === "undefined" || typeof document.modelContext?.registerTool !== "function") {
    return { supported: false, dispose: () => undefined };
  }

  const controller = new AbortController();
  const register = (tool: Parameters<NonNullable<Document["modelContext"]>["registerTool"]>[0]) => {
    void document.modelContext!.registerTool(tool, { signal: controller.signal }).catch(() => undefined);
  };

  register({
    name: "get_spatial_workspace",
    title: "Read SpaceLab workspace",
    description: "Read the selected site, design scenarios, active and comparison options, saved analysis points, and current planning geometry.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const state = bridge.getState();
      return {
        ...state,
        analyses: state.scenarios.map((scenario) => ({
          scenarioId: scenario.id,
          planning: planningMetrics(state.site, scenario.mass),
        })),
      };
    },
  });

  register({
    name: "search_location",
    title: "Search a Korean location",
    description: "Search Korean road or parcel addresses through the SpaceLab VWorld server route. This does not change the selected site.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 2, maxLength: 120 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async (input: { query: string }) => bridge.searchLocation(input.query),
  });

  register({
    name: "select_site",
    title: "Select a cadastral site",
    description: "Resolve the cadastral parcel containing a Korean coordinate and make it the canonical SpaceLab site. Selecting a new site clears the previous design scenarios.",
    inputSchema: {
      type: "object",
      properties: {
        lon: { type: "number", minimum: 124, maximum: 132 },
        lat: { type: "number", minimum: 33, maximum: 39.5 },
        label: { type: "string", maxLength: 160 },
      },
      required: ["lon", "lat"],
      additionalProperties: false,
    },
    execute: async (input: { lon: number; lat: number; label?: string }) => {
      const site = await bridge.selectSiteAtPoint({ lon: input.lon, lat: input.lat }, input.label);
      const state = await applyWorkspaceChange(bridge, () => bridge.actions.setSite(site, "agent"));
      return { selectedSite: state.site, scenariosCleared: state.scenarios.length === 0 };
    },
  });

  register({
    name: "create_building_mass",
    title: "Create a building mass scenario",
    description: "Create a conceptual early-stage building mass on the current site. This changes the canonical workspace and is not detailed BIM.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", maxLength: 120 },
        intent: { type: "string", maxLength: 300 },
        heightM: { type: "number", minimum: 3, maximum: 120 },
        floors: { type: "number", minimum: 1, maximum: 40 },
        rotationDeg: { type: "number", minimum: -180, maximum: 180 },
        position: {
          type: "object",
          properties: {
            eastM: { type: "number", minimum: -300, maximum: 300 },
            northM: { type: "number", minimum: -300, maximum: 300 },
          },
          additionalProperties: false,
        },
        footprint: footprintSchema,
      },
      additionalProperties: false,
    },
    execute: async (input: CreateMassInput) => {
      const before = bridge.getState();
      const state = await applyWorkspaceChange(bridge, () => bridge.actions.createBuildingMass(input, "agent"));
      const created = state.scenarios.find((scenario) => !before.scenarios.some((prior) => prior.id === scenario.id));
      return created ? scenarioSnapshot(state, created.id) : { workspace: state };
    },
  });

  register({
    name: "clone_scenario",
    title: "Clone a design scenario",
    description: "Clone an existing scenario into a new editable alternative.",
    inputSchema: {
      type: "object",
      properties: {
        sourceId: { type: "string", minLength: 1, maxLength: 32 },
        name: { type: "string", maxLength: 120 },
      },
      required: ["sourceId"],
      additionalProperties: false,
    },
    execute: async (input: { sourceId: string; name?: string }) => {
      const before = bridge.getState();
      const state = await applyWorkspaceChange(
        bridge,
        () => bridge.actions.cloneScenario(input.sourceId, input.name, "agent"),
      );
      const created = state.scenarios.find((scenario) => !before.scenarios.some((prior) => prior.id === scenario.id));
      return created ? scenarioSnapshot(state, created.id) : { workspace: state };
    },
  });

  register({
    name: "delete_scenario",
    title: "Delete a design scenario",
    description: "Delete one conceptual scenario from the current workspace.",
    inputSchema: {
      type: "object",
      properties: {
        scenarioId: { type: "string", minLength: 1, maxLength: 32 },
      },
      required: ["scenarioId"],
      additionalProperties: false,
    },
    execute: async (input: { scenarioId: string }) => {
      const state = await applyWorkspaceChange(
        bridge,
        () => bridge.actions.deleteScenario(input.scenarioId, "agent"),
      );
      return {
        deletedScenarioId: input.scenarioId,
        remainingScenarioIds: state.scenarios.map((scenario) => scenario.id),
        activeScenarioId: state.activeScenarioId,
      };
    },
  });

  register({
    name: "edit_building_mass",
    title: "Edit a building mass",
    description: "Edit conceptual building height, floors, rotation, position, or footprint in an existing scenario.",
    inputSchema: {
      type: "object",
      properties: {
        scenarioId: { type: "string", minLength: 1, maxLength: 32 },
        heightM: { type: "number", minimum: 3, maximum: 120 },
        floors: { type: "number", minimum: 1, maximum: 40 },
        rotationDeg: { type: "number", minimum: -180, maximum: 180 },
        position: {
          type: "object",
          properties: {
            eastM: { type: "number", minimum: -300, maximum: 300 },
            northM: { type: "number", minimum: -300, maximum: 300 },
          },
          additionalProperties: false,
        },
        footprint: footprintSchema,
      },
      required: ["scenarioId"],
      additionalProperties: false,
    },
    execute: async (input: MassPatch & { scenarioId: string }) => {
      const { scenarioId, ...patch } = input;
      const state = await applyWorkspaceChange(
        bridge,
        () => bridge.actions.editBuildingMass(scenarioId, patch, "agent"),
      );
      return scenarioSnapshot(state, scenarioId);
    },
  });

  register({
    name: "set_mass_footprint",
    title: "Set a building footprint",
    description: "Replace one scenario's conceptual footprint with a rectangle or local-coordinate free polygon.",
    inputSchema: {
      type: "object",
      properties: {
        scenarioId: { type: "string", minLength: 1, maxLength: 32 },
        footprint: footprintSchema,
      },
      required: ["scenarioId", "footprint"],
      additionalProperties: false,
    },
    execute: async (input: { scenarioId: string; footprint: Footprint }) => {
      const state = await applyWorkspaceChange(
        bridge,
        () => bridge.actions.setMassFootprint(input.scenarioId, input.footprint, "agent"),
      );
      return scenarioSnapshot(state, input.scenarioId);
    },
  });

  register({
    name: "set_sun_study_point",
    title: "Set the direct-sun study point",
    description: "Set the ground coordinate used for deterministic planned-mass direct-sun analysis.",
    inputSchema: {
      type: "object",
      properties: {
        lon: { type: "number", minimum: 124, maximum: 132 },
        lat: { type: "number", minimum: 33, maximum: 39.5 },
      },
      required: ["lon", "lat"],
      additionalProperties: false,
    },
    execute: async (input: { lon: number; lat: number }) => {
      const point = { lon: input.lon, lat: input.lat };
      const state = await applyWorkspaceChange(
        bridge,
        () => bridge.actions.setSunStudyPoint(point, "agent"),
      );
      return { sunStudyPoint: state.sunStudyPoint };
    },
  });

  register({
    name: "set_viewpoint",
    title: "Set the View Impact observation point",
    description: "Save a repeatable observation point and eye height for deterministic surrounding-building View Impact comparison.",
    inputSchema: {
      type: "object",
      properties: {
        lon: { type: "number", minimum: 124, maximum: 132 },
        lat: { type: "number", minimum: 33, maximum: 39.5 },
        eyeHeightM: { type: "number", minimum: 1.2, maximum: 50 },
      },
      required: ["lon", "lat"],
      additionalProperties: false,
    },
    execute: async (input: { lon: number; lat: number; eyeHeightM?: number }) => {
      const viewpoint: Viewpoint = {
        point: { lon: input.lon, lat: input.lat },
        eyeHeightM: input.eyeHeightM ?? 1.7,
      };
      const state = await applyWorkspaceChange(
        bridge,
        () => bridge.actions.setViewpoint(viewpoint, "agent"),
      );
      return { viewpoint: state.viewpoint };
    },
  });

  register({
    name: "set_shadow_time",
    title: "Set a scenario analysis time",
    description: "Set the local date and time used by a scenario's geometric solar shadow preview.",
    inputSchema: {
      type: "object",
      properties: {
        scenarioId: { type: "string", minLength: 1, maxLength: 32 },
        localDateTime: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$",
          description: "Local site date and time in YYYY-MM-DDTHH:mm format.",
        },
      },
      required: ["scenarioId", "localDateTime"],
      additionalProperties: false,
    },
    execute: async (input: { scenarioId: string; localDateTime: string }) => {
      const state = await applyWorkspaceChange(
        bridge,
        () => bridge.actions.setShadowTime(input.scenarioId, input.localDateTime, "agent"),
      );
      return scenarioSnapshot(state, input.scenarioId);
    },
  });

  register({
    name: "compare_scenarios",
    title: "Compare two design scenarios",
    description: "Select a primary scenario and an optional comparison scenario in the shared SpaceLab workspace.",
    inputSchema: {
      type: "object",
      properties: {
        primaryId: { type: "string", minLength: 1, maxLength: 32 },
        compareId: { type: "string", maxLength: 32 },
      },
      required: ["primaryId"],
      additionalProperties: false,
    },
    execute: async (input: { primaryId: string; compareId?: string }) => {
      const state = await applyWorkspaceChange(
        bridge,
        () => bridge.actions.compareScenarios(input.primaryId, input.compareId || undefined),
      );
      return {
        activeScenarioId: state.activeScenarioId,
        compareScenarioId: state.compareScenarioId,
      };
    },
  });

  register({
    name: "run_direct_sun_study",
    title: "Run planned-mass direct-sun analysis",
    description: "Estimate direct-sun duration from 09:00 to 18:00 at a ground point against one planned mass. The result excludes surrounding buildings and is not a statutory sunlight-right determination.",
    inputSchema: {
      type: "object",
      properties: {
        scenarioId: { type: "string", maxLength: 32 },
        date: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description: "Local date in YYYY-MM-DD format.",
        },
        lon: { type: "number", minimum: 124, maximum: 132 },
        lat: { type: "number", minimum: 33, maximum: 39.5 },
        stepMinutes: { type: "number", minimum: 5, maximum: 60 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async (input: {
      scenarioId?: string;
      date?: string;
      lon?: number;
      lat?: number;
      stepMinutes?: number;
    }) => {
      const state = bridge.getState();
      const scenarioId = input.scenarioId ?? state.activeScenarioId;
      if (!scenarioId) throw new Error("No active SpaceLab scenario.");
      const scenario = getScenario(state, scenarioId);
      const point = input.lon !== undefined && input.lat !== undefined
        ? { lon: input.lon, lat: input.lat }
        : state.sunStudyPoint ?? state.site.center;
      const result = directSunStudy(
        scenario.mass,
        state.site,
        point,
        input.date ?? scenario.analysisTime.slice(0, 10),
        state.timeZoneOffsetMinutes,
        { stepMinutes: input.stepMinutes },
      );
      return { scenarioId, ...result };
    },
  });

  register({
    name: "run_view_impact",
    title: "Run surrounding-building View Impact",
    description: "Estimate how much of a planned mass is visible from the saved viewpoint using the loaded surrounding-building footprints and height attributes. Terrain, vegetation, windows, and legal view-right judgments are excluded.",
    inputSchema: {
      type: "object",
      properties: {
        scenarioId: { type: "string", maxLength: 32 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async (input: { scenarioId?: string }) => {
      const state = bridge.getState();
      if (!state.viewpoint) throw new Error("No SpaceLab viewpoint is set.");
      const scenarioId = input.scenarioId ?? state.activeScenarioId;
      if (!scenarioId) throw new Error("No active SpaceLab scenario.");
      const scenario = getScenario(state, scenarioId);
      const result = viewImpact(
        state.viewpoint,
        state.site,
        scenario.mass,
        bridge.getBuildingContext(),
      );
      return { scenarioId, viewpoint: state.viewpoint, ...result };
    },
  });

  return { supported: true, dispose: () => controller.abort() };
}
