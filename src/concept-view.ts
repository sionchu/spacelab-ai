import type { BuildingMass, GeoPoint, Site, Viewpoint } from "./types";

export type ConceptProjectType =
  | "house"
  | "rural-house"
  | "warehouse"
  | "office"
  | "public-facility"
  | "other";

export type ConceptVisualStyle =
  | "neutral-concept"
  | "contemporary"
  | "rural-contemporary"
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
  version: 1;
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
  house: "detached house",
  "rural-house": "rural house",
  warehouse: "warehouse / logistics facility",
  office: "office building",
  "public-facility": "public facility",
  other: "building or facility",
};

const styleLabels: Record<ConceptVisualStyle, string> = {
  "neutral-concept": "restrained architectural concept design",
  contemporary: "contemporary architecture",
  "rural-contemporary": "contemporary rural architecture",
  industrial: "clean industrial architecture",
  minimal: "minimal architecture",
};

function footprintSummary(mass: BuildingMass) {
  if (mass.footprint.kind === "rectangle") {
    return `rectangular footprint ${mass.footprint.widthM.toFixed(1)}m × ${mass.footprint.depthM.toFixed(1)}m`;
  }
  return `free-polygon footprint with ${mass.footprint.points.length} vertices`;
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
    `Site: ${site.address || site.name}.`,
    `Preserve the planned building's location, orientation, approximate envelope, and camera composition.`,
    `Planned mass: ${mass.heightM.toFixed(1)}m high, ${mass.floors} floors, ${footprintSummary(mass)}, rotation ${mass.rotationDeg.toFixed(1)}°.`,
    "Treat the reference image as the source of truth for surrounding terrain, roads, neighboring buildings, parcel position, perspective, and scale.",
    "Do not move the building to a different parcel and do not invent additional towers or major structures.",
    "Translate only the simple mass into a plausible architectural concept with restrained facade detail, materials, roof treatment, openings, and site landscaping appropriate to the project type.",
    "Keep the result clearly conceptual rather than presenting it as an approved construction design.",
    "Use realistic daylight and photographic rendering; avoid exaggerated cinematic lighting, fantasy forms, text, labels, logos, watermarks, or people as focal subjects.",
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
    version: 1,
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
