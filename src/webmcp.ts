import { directSunStudy } from "./analysis";
import type { SunStudySample } from "./analysis";
import { getScenario } from "./model";
import type {
  AddressSearchResult,
} from "./vworld-api";
import type { ApplicationActions, BuildingMass, GeoPoint, Site, SpatialWorkspace, Viewpoint } from "./types";

declare global {
  interface Document {
    modelContext?: {
      registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => Promise<void>;
    };
  }
}

type ToolBridge = ApplicationActions & {
  getState: () => SpatialWorkspace;
  searchLocation: (query: string) => Promise<AddressSearchResult[]>;
  selectSiteAtPoint: (point: GeoPoint, label?: string) => Promise<Site>;
  sampleSunContext: (point: GeoPoint, samples: SunStudySample[]) => Promise<{ supported: boolean; blockedTimes: string[]; source: string }>;
  sampleViewImpact: (viewpoint: Viewpoint, site: Site, mass: BuildingMass) => Promise<{
    supported: boolean;
    visibleSamples: number;
    totalSamples: number;
    visibleRatioPct: number;
    classification: string;
    blockedSampleIds: string[];
    source: string;
  }>;
};

const pointSchema = {
  type: "object",
  properties: { xM: { type: "number" }, yM: { type: "number" } },
  required: ["xM", "yM"],
  additionalProperties: false,
};

const footprintSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["rectangle", "polygon"] },
    widthM: { type: "number", minimum: 6, maximum: 200 },
    depthM: { type: "number", minimum: 6, maximum: 200 },
    points: { type: "array", minItems: 3, items: pointSchema },
  },
  required: ["kind"],
  additionalProperties: false,
};

export function registerSpaceLabTools(bridge: ToolBridge) {
  if (!document.modelContext) return { supported: false, dispose: () => undefined };

  const controller = new AbortController();
  const register = (tool: unknown) => {
    void document.modelContext!.registerTool(tool, { signal: controller.signal }).catch(() => undefined);
  };

  register({
    name: "get_spatial_workspace",
    title: "Read SpaceLab spatial workspace",
    description: "Read the selected real-world site, scenario branches, active option, comparison option, footprints, and model parameters.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async () => bridge.getState(),
  });

  register({
    name: "search_location",
    title: "Search a Korean location in VWorld",
    description: "Search VWorld address data before selecting a real site. Returns coordinates only; selecting the parcel is a separate action.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", minLength: 2 } },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async (input: { query: string }) => bridge.searchLocation(input.query),
  });

  register({
    name: "select_site",
    title: "Select a real SpaceLab site",
    description: "Resolve the VWorld cadastral parcel containing a coordinate and make it the canonical SpaceLab site. Selecting a new site clears old design scenarios.",
    inputSchema: {
      type: "object",
      properties: {
        lon: { type: "number", minimum: 124, maximum: 132 },
        lat: { type: "number", minimum: 33, maximum: 39.5 },
        label: { type: "string" },
      },
      required: ["lon", "lat"],
      additionalProperties: false,
    },
    execute: async (input: { lon: number; lat: number; label?: string }) => {
      const site = await bridge.selectSiteAtPoint({ lon: input.lon, lat: input.lat }, input.label);
      bridge.setSite(site, "agent");
      return bridge.getState();
    },
  });

  register({
    name: "create_building_mass",
    title: "Create a new SpaceLab building mass",
    description: "Create the first or next early-stage massing scenario on the selected site. This is conceptual massing, not BIM.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        intent: { type: "string" },
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
    execute: async (input: any) => {
      bridge.createBuildingMass(input, "agent");
      return bridge.getState();
    },
  });

  register({
    name: "delete_scenario",
    title: "Delete a SpaceLab scenario",
    description: "Delete one conceptual scenario from the current site.",
    inputSchema: {
      type: "object",
      properties: { scenarioId: { type: "string" } },
      required: ["scenarioId"],
      additionalProperties: false,
    },
    execute: async (input: { scenarioId: string }) => {
      bridge.deleteScenario(input.scenarioId, "agent");
      return bridge.getState();
    },
  });

  register({
    name: "clone_scenario",
    title: "Branch a SpaceLab scenario",
    description: "Clone an existing design scenario to create a new alternative before editing it.",
    inputSchema: {
      type: "object",
      properties: { sourceId: { type: "string" }, name: { type: "string" } },
      required: ["sourceId"],
      additionalProperties: false,
    },
    execute: async (input: { sourceId: string; name?: string }) => {
      bridge.cloneScenario(input.sourceId, input.name, "agent");
      return bridge.getState();
    },
  });

  register({
    name: "edit_building_mass",
    title: "Edit a SpaceLab building mass",
    description: "Edit early-stage massing parameters. Dimensions are meters and rotation is degrees; this is not detailed BIM.",
    inputSchema: {
      type: "object",
      properties: {
        scenarioId: { type: "string" },
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
    execute: async (input: any) => {
      const { scenarioId, ...patch } = input;
      bridge.editBuildingMass(scenarioId, patch, "agent");
      return bridge.getState();
    },
  });

  register({
    name: "set_mass_footprint",
    title: "Set a rectangular or free-polygon footprint",
    description: "Replace one scenario's conceptual building footprint with a rectangle or local-coordinate polygon.",
    inputSchema: {
      type: "object",
      properties: { scenarioId: { type: "string" }, footprint: footprintSchema },
      required: ["scenarioId", "footprint"],
      additionalProperties: false,
    },
    execute: async (input: any) => {
      bridge.setMassFootprint(input.scenarioId, input.footprint, "agent");
      return bridge.getState();
    },
  });

  register({
    name: "set_sun_study_point",
    title: "Set SpaceLab direct-sun study point",
    description: "Set the ground point used for deterministic direct-sun estimates against the planned mass.",
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
      bridge.setSunStudyPoint({ lon: input.lon, lat: input.lat }, "agent");
      return bridge.getState();
    },
  });

  register({
    name: "set_viewpoint",
    title: "Set SpaceLab viewpoint",
    description: "Save a repeatable observation point for comparing scenarios from the same place.",
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
      bridge.setViewpoint({
        point: { lon: input.lon, lat: input.lat },
        eyeHeightM: input.eyeHeightM ?? 1.7,
      }, "agent");
      return bridge.getState();
    },
  });

  register({
    name: "run_direct_sun_study",
    title: "Run SpaceLab direct-sun study",
    description: "Estimate direct-sun duration from 09:00 to 18:00 at a ground point against one planned mass. This is a geometric pre-check, not a statutory sunlight-right determination.",
    inputSchema: {
      type: "object",
      properties: {
        scenarioId: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
        lon: { type: "number", minimum: 124, maximum: 132 },
        lat: { type: "number", minimum: 33, maximum: 39.5 },
        stepMinutes: { type: "number", minimum: 5, maximum: 60 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async (input: { scenarioId?: string; date?: string; lon?: number; lat?: number; stepMinutes?: number }) => {
      const state = bridge.getState();
      const scenarioId = input.scenarioId ?? state.activeScenarioId;
      if (!scenarioId) throw new Error("No active SpaceLab scenario.");
      const scenario = getScenario(state, scenarioId);
      const point = input.lon !== undefined && input.lat !== undefined
        ? { lon: input.lon, lat: input.lat }
        : state.sunStudyPoint ?? state.site.center;
      const study = directSunStudy(
        scenario.mass,
        state.site,
        point,
        input.date ?? scenario.analysisTime.slice(0, 10),
        state.timeZoneOffsetMinutes,
        { stepMinutes: input.stepMinutes },
      );
      const context = await bridge.sampleSunContext(point, study.samples);
      const blockedByContext = new Set(context.blockedTimes);
      const contextAdjustedSunMinutes = context.supported
        ? study.samples.reduce((minutes, sample) => sample.state === "sun" && !blockedByContext.has(sample.localDateTime)
          ? minutes + study.stepMinutes
          : minutes, 0)
        : study.sunMinutes;
      return {
        scenarioId,
        point: study.point,
        date: study.date,
        stepMinutes: study.stepMinutes,
        plannedMassSunMinutes: study.sunMinutes,
        contextAdjustedSunMinutes,
        shadowMinutes: study.shadowMinutes,
        daylightMinutes: study.daylightMinutes,
        plannedMassScope: study.scope,
        cityContextSupported: context.supported,
        cityContextSource: context.source,
        cityContextBlockedTimes: context.blockedTimes,
        samples: study.samples,
      };
    },
  });


  register({
    name: "run_view_impact",
    title: "Run SpaceLab viewpoint visibility analysis",
    description: "Estimate how much of one planned mass is visible from the saved viewpoint against the loaded VWorld 3D city and terrain. This is a geometric view-impact aid, not a legal view-right determination.",
    inputSchema: {
      type: "object",
      properties: {
        scenarioId: { type: "string" },
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
      const result = await bridge.sampleViewImpact(state.viewpoint, state.site, scenario.mass);
      return {
        scenarioId,
        viewpoint: state.viewpoint,
        ...result,
      };
    },
  });

  register({
    name: "set_shadow_time",
    title: "Set SpaceLab shadow preview time",
    description: "Set the local scenario date/time used for a geometric solar shadow preview, not a statutory sunlight-right determination.",
    inputSchema: {
      type: "object",
      properties: {
        scenarioId: { type: "string" },
        localDateTime: { type: "string", description: "YYYY-MM-DDTHH:mm" },
      },
      required: ["scenarioId", "localDateTime"],
      additionalProperties: false,
    },
    execute: async (input: { scenarioId: string; localDateTime: string }) => {
      bridge.setShadowTime(input.scenarioId, input.localDateTime, "agent");
      return bridge.getState();
    },
  });

  register({
    name: "compare_scenarios",
    title: "Compare two SpaceLab scenarios",
    description: "Select a primary and comparison scenario in the shared SpaceLab workspace.",
    inputSchema: {
      type: "object",
      properties: { primaryId: { type: "string" }, compareId: { type: "string" } },
      required: ["primaryId", "compareId"],
      additionalProperties: false,
    },
    execute: async (input: { primaryId: string; compareId: string }) => {
      bridge.compareScenarios(input.primaryId, input.compareId);
      return bridge.getState();
    },
  });

  return { supported: true, dispose: () => controller.abort() };
}
