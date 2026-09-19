import type { PlaySafeSnapshot } from "./playsafe";

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

export type PlaySafeWebMcpBridge = {
  getSnapshot: () => PlaySafeSnapshot | undefined;
  getSelectedPlaceId: () => string | undefined;
  selectPlace: (placeId: string) => void;
};

export function registerPlaySafeTools(bridge: PlaySafeWebMcpBridge) {
  if (typeof document === "undefined" || typeof document.modelContext?.registerTool !== "function") {
    return { supported: false, dispose: () => undefined };
  }

  const controller = new AbortController();
  const register = (tool: Parameters<NonNullable<Document["modelContext"]>["registerTool"]>[0]) => {
    void document.modelContext!.registerTool(tool, { signal: controller.signal }).catch(() => undefined);
  };

  const snapshot = () => {
    const current = bridge.getSnapshot();
    if (!current) throw new Error("PlaySafe snapshot is not loaded yet.");
    return current;
  };

  register({
    name: "get_playsafe_snapshot",
    title: "Read current PlaySafe analysis",
    description: "Read the current child profile, weather, nearby playground/park assessments, recommendation and methodology.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async () => snapshot(),
  });

  register({
    name: "find_nearby_playgrounds",
    title: "List nearby playgrounds and parks",
    description: "List the currently loaded nearby playgrounds and parks ordered by relative outdoor activity fit.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async () => snapshot().assessments.map((item) => ({
      id: item.place.id,
      name: item.place.name,
      kind: item.place.kind,
      distanceM: Math.round(item.place.distanceM),
      fitScore: Math.round(item.fitScore),
      shadePct: Math.round(item.shadePct),
      label: item.label,
    })),
  });

  register({
    name: "compare_playgrounds",
    title: "Compare playground heat exposure",
    description: "Compare nearby places using the current weather, analysis time, building-shadow estimate and planned activity duration. This is a relative environmental comparison, not a medical safety determination.",
    inputSchema: {
      type: "object",
      properties: {
        placeIds: {
          type: "array",
          items: { type: "string" },
          maxItems: 6,
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async (input: { placeIds?: string[] }) => {
      const state = snapshot();
      const requested = new Set(input.placeIds ?? []);
      return state.assessments
        .filter((item) => requested.size === 0 || requested.has(item.place.id))
        .map((item) => ({
          id: item.place.id,
          name: item.place.name,
          fitScore: Math.round(item.fitScore),
          exposureScore: Math.round(item.exposureScore),
          shadePct: Math.round(item.shadePct),
          directSunPct: Math.round(item.directSunPct),
          label: item.label,
          reasons: item.reasons,
        }));
    },
  });

  register({
    name: "assess_outdoor_activity",
    title: "Assess outdoor activity at one place",
    description: "Read the current relative activity-fit assessment for one playground or park. Results describe environmental exposure and do not diagnose or guarantee medical safety.",
    inputSchema: {
      type: "object",
      properties: {
        placeId: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async (input: { placeId?: string }) => {
      const state = snapshot();
      const id = input.placeId || bridge.getSelectedPlaceId() || state.recommendation?.placeId;
      const assessment = state.assessments.find((item) => item.place.id === id);
      if (!assessment) throw new Error("Unknown PlaySafe place.");
      return assessment;
    },
  });

  register({
    name: "recommend_play_time",
    title: "Recommend a better play time",
    description: "Compare the next loaded hourly windows for a playground or park and return the highest relative activity-fit time.",
    inputSchema: {
      type: "object",
      properties: {
        placeId: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async (input: { placeId?: string }) => {
      const state = snapshot();
      const id = input.placeId || bridge.getSelectedPlaceId() || state.recommendation?.placeId;
      const assessment = state.assessments.find((item) => item.place.id === id);
      if (!assessment) throw new Error("Unknown PlaySafe place.");
      const best = [...assessment.timeline].sort((a, b) => b.fitScore - a.fitScore)[0];
      return {
        placeId: assessment.place.id,
        placeName: assessment.place.name,
        currentFitScore: Math.round(assessment.fitScore),
        bestTime: best,
        timeline: assessment.timeline,
      };
    },
  });

  register({
    name: "select_playground",
    title: "Select a playground on the PlaySafe map",
    description: "Select one currently loaded playground or park so the human UI focuses its 3D heat visualization there.",
    inputSchema: {
      type: "object",
      properties: {
        placeId: { type: "string", minLength: 1 },
      },
      required: ["placeId"],
      additionalProperties: false,
    },
    execute: async (input: { placeId: string }) => {
      const state = snapshot();
      const assessment = state.assessments.find((item) => item.place.id === input.placeId);
      if (!assessment) throw new Error("Unknown PlaySafe place.");
      bridge.selectPlace(input.placeId);
      return {
        selectedPlaceId: input.placeId,
        placeName: assessment.place.name,
        fitScore: Math.round(assessment.fitScore),
      };
    },
  });

  return { supported: true, dispose: () => controller.abort() };
}
