import type { BuildingMass, GeoPoint, Site, Viewpoint } from "./types";

export type ConceptProjectType =
  | "house"
  | "retail"
  | "office"
  | "factory"
  | "warehouse"
  | "farm"
  | "other";

export type ConceptVisualStyle =
  | "neutral"
  | "contemporary"
  | "industrial"
  | "minimal";

export type ConceptCameraState = {
  lon: number;
  lat: number;
  heightM: number;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
};

export type ConceptViewRequest = {
  version: 2;
  createdAt: string;
  projectType: ConceptProjectType;
  visualStyle: ConceptVisualStyle;
  site: {
    name: string;
    address?: string;
    pnu?: string;
    center: GeoPoint;
  };
  scenario: {
    id: string;
    name: string;
    intent: string;
    mass: BuildingMass;
  };
  viewpoint?: Viewpoint;
  camera?: ConceptCameraState;
  prompt: string;
};

const projectLabels: Record<ConceptProjectType, string> = {
  house: "detached residential house",
  retail: "low-rise neighborhood retail building",
  office: "mid-rise office building",
  factory: "industrial factory building",
  warehouse: "warehouse or logistics building",
  farm: "low-rise agricultural facility",
  other: "building or facility",
};

const styleLabels: Record<ConceptVisualStyle, string> = {
  neutral: "restrained architectural concept design",
  contemporary: "contemporary architecture with practical materials",
  industrial: "clean industrial architecture with robust materials",
  minimal: "minimal architecture with simple proportions and restrained detailing",
};

function footprintSummary(mass: BuildingMass) {
  if (mass.footprint.kind === "rectangle") {
    return `rectangular footprint ${mass.footprint.widthM.toFixed(1)}m by ${mass.footprint.depthM.toFixed(1)}m`;
  }
  return `free-polygon footprint with ${mass.footprint.points.length} vertices`;
}

export function suggestConceptProjectType(name: string, intent: string): ConceptProjectType {
  const value = `${name} ${intent}`.toLowerCase();
  if (/주택|house|residential/.test(value)) return "house";
  if (/상가|retail|commercial/.test(value)) return "retail";
  if (/업무|office/.test(value)) return "office";
  if (/공장|factory|production/.test(value)) return "factory";
  if (/창고|warehouse|logistics/.test(value)) return "warehouse";
  if (/농가|농업|farm|agricultural/.test(value)) return "farm";
  return "other";
}

export function buildConceptPrompt(
  site: Site,
  scenario: ConceptViewRequest["scenario"],
  projectType: ConceptProjectType,
  visualStyle: ConceptVisualStyle,
) {
  const mass = scenario.mass;
  return [
    "Create a realistic early-stage architectural concept visualization from the supplied SpaceLab 3D context image.",
    `Project type: ${projectLabels[projectType]}.`,
    `Visual direction: ${styleLabels[visualStyle]}.`,
    `Site context: ${site.address || site.name}.`,
    "Preserve the selected parcel, planned building location, orientation, approximate envelope, camera perspective, surrounding roads, terrain, and neighboring buildings.",
    `Planned mass: ${mass.heightM.toFixed(1)}m high, ${mass.floors} floors, ${footprintSummary(mass)}, rotation ${mass.rotationDeg.toFixed(1)} degrees.`,
    "Treat the reference image as the source of truth for scale and composition.",
    "Do not move the planned building to another parcel. Do not add unrelated towers or major structures.",
    "Translate only the simple planned mass into a plausible architectural concept with restrained facade detail, openings, roof treatment, materials, and modest site landscaping appropriate to the project type.",
    "Keep the result clearly conceptual rather than presenting it as an approved construction design.",
    "Use realistic daylight and documentary architectural visualization. Avoid cinematic effects, fantasy forms, text, labels, logos, watermarks, and people as focal subjects.",
  ].join(" ");
}

export function buildConceptViewRequest(args: {
  site: Site;
  scenario: ConceptViewRequest["scenario"];
  projectType: ConceptProjectType;
  visualStyle: ConceptVisualStyle;
  viewpoint?: Viewpoint;
  camera?: ConceptCameraState;
}): ConceptViewRequest {
  return {
    version: 2,
    createdAt: new Date().toISOString(),
    projectType: args.projectType,
    visualStyle: args.visualStyle,
    site: {
      name: args.site.name,
      address: args.site.address,
      pnu: args.site.pnu,
      center: { ...args.site.center },
    },
    scenario: {
      ...args.scenario,
      mass: {
        ...args.scenario.mass,
        position: { ...args.scenario.mass.position },
        footprint: args.scenario.mass.footprint.kind === "rectangle"
          ? { ...args.scenario.mass.footprint }
          : {
              kind: "polygon",
              points: args.scenario.mass.footprint.points.map((point) => ({ ...point })),
            },
      },
    },
    viewpoint: args.viewpoint
      ? { point: { ...args.viewpoint.point }, eyeHeightM: args.viewpoint.eyeHeightM }
      : undefined,
    camera: args.camera ? { ...args.camera } : undefined,
    prompt: buildConceptPrompt(args.site, args.scenario, args.projectType, args.visualStyle),
  };
}
