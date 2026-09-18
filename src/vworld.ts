import {
  computeShadowPolygon,
  geoPointToLocal,
  localPointToGeo,
  rotatedFootprintPoints,
  siteTimeZoneOffsetMinutes,
} from "./model";
import { viewTargetSamples } from "./analysis";
import type { SunStudySample } from "./analysis";
import type { BuildingMass, GeoPoint, LocalPoint, Scenario, Site, Viewpoint } from "./types";

declare global {
  interface Window {
    vw?: any;
    ws3d?: { viewer?: any };
    Cesium?: any;
    viewer?: any;
  }
}

let scriptPromise: Promise<void> | null = null;
let viewerPromise: Promise<any> | null = null;
const entities = new Map<string, any>();
let siteEntity: any;
let siteOutlineEntity: any;
let siteLabelEntity: any;
let draftEntity: any;
let sunStudyEntity: any;
let viewpointEntity: any;

function loadExternalScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => {
      const url = new URL(src, window.location.href);
      reject(new Error(`VWorld dependency load failed: ${url.origin}${url.pathname}`));
    };
    document.head.appendChild(script);
  });
}

export function loadVWorld(apiKey: string) {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    if (window.vw && window.Cesium) return resolve();
    const waitDeadline = Date.now() + 15_000;
    const waitForGlobals = () => {
      if (window.vw && window.Cesium) {
        resolve();
        return;
      }
      if (Date.now() >= waitDeadline) {
        reject(new Error("VWorld SDK unavailable"));
        return;
      }
      window.setTimeout(waitForGlobals, 100);
    };
    const childScripts: string[] = [];
    const originalWrite = document.write.bind(document);
    const originalWriteln = document.writeln.bind(document);
    const captureMarkup = (markup: string) => {
      const template = document.createElement("template");
      template.innerHTML = markup;
      template.content.querySelectorAll("script[src]").forEach((child) => {
        const src = child.getAttribute("src");
        if (src) childScripts.push(new URL(src, "https://map.vworld.kr/").href);
      });
    };
    document.write = captureMarkup;
    document.writeln = captureMarkup;
    const script = document.createElement("script");
    // Match the official VWorld WebGL 3.0 examples: the SDK bootstrap URL
    // uses version + apiKey only. Domain handling remains on VWorld REST APIs.
    const params = new URLSearchParams({ version: "3.0", apiKey });
    script.src = `https://map.vworld.kr/js/webglMapInit.js.do?${params.toString()}`;
    script.async = false;
    script.onload = () => {
      void (async () => {
        for (const childScript of childScripts) await loadExternalScript(childScript);
        document.write = originalWrite;
        document.writeln = originalWriteln;
        waitForGlobals();
      })().catch((error) => {
        document.write = originalWrite;
        document.writeln = originalWriteln;
        reject(error);
      });
    };
    script.onerror = () => {
      document.write = originalWrite;
      document.writeln = originalWriteln;
      reject(new Error("VWorld WebGL SDK bootstrap failed at map.vworld.kr"));
    };
    document.head.appendChild(script);
  }).catch((error) => {
    scriptPromise = null;
    throw error;
  });
  return scriptPromise;
}

function resolveViewer(map: any) {
  return window.ws3d?.viewer
    ?? map?.getViewer?.()
    ?? map?.getCesiumViewer?.()
    ?? map?.viewer
    ?? window.viewer
    ?? (map?.entities ? map : undefined);
}

export async function startVWorld(containerId: string, apiKey: string, lon: number, lat: number) {
  if (window.viewer?.entities) return window.viewer;
  if (viewerPromise) return viewerPromise;

  viewerPromise = (async () => {
    await loadVWorld(apiKey);
    const vw = window.vw;
    if (!vw) throw new Error("VWorld SDK unavailable");
    return new Promise<any>((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (!settled) reject(new Error("VWorld 3D initialization timed out"));
      }, 15_000);
      let map: any;
      const finish = () => {
        const viewer = resolveViewer(map);
        if (!viewer?.entities) return false;
        settled = true;
        window.clearTimeout(timeout);
        window.viewer = viewer;
        resolve(viewer);
        return true;
      };
      vw.ws3dInitCallBack = () => { finish(); };
      map = new vw.Map();
      const camera = new vw.CameraPosition(new vw.CoordZ(lon, lat, 220), new vw.Direction(0, -72, 0));
      map.setOption({ mapId: containerId, initPosition: camera, logo: false, navigation: true });
      map.setMapId(containerId);
      map.setInitPosition(camera);
      map.setLogoVisible(false);
      map.setNavigationZoomVisible(false);
      map.start();
      finish();
    });
  })().catch((error) => {
    viewerPromise = null;
    throw error;
  });
  return viewerPromise;
}

function flattenGeo(points: GeoPoint[]) {
  return points.flatMap((point) => [point.lon, point.lat]);
}

function footprintCorners(scenario: Scenario, site: Site) {
  return rotatedFootprintPoints(scenario.mass)
    .map((point) => localPointToGeo(site.center, {
      xM: point.xM + scenario.mass.position.eastM,
      yM: point.yM + scenario.mass.position.northM,
    }))
    .flatMap((point) => [point.lon, point.lat]);
}

function localPointsToDegrees(center: GeoPoint, points: LocalPoint[]) {
  return points.map((point) => localPointToGeo(center, point)).flatMap((point) => [point.lon, point.lat]);
}

function flyToGeo(point: GeoPoint, height: number) {
  const viewer = window.viewer;
  const Cesium = window.Cesium;
  if (!viewer?.camera || !Cesium) return;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(point.lon, point.lat, height),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-72), roll: 0 },
    duration: 0.8,
  });
}

export function flyToSite(site: Site, height = 230) {
  flyToGeo(site.center, height);
}

function frameGeoPoints(site: Site, points: GeoPoint[], minHeightM: number, scale = 3) {
  if (!points.length) {
    flyToSite(site);
    return;
  }

  const local = points.map((point) => geoPointToLocal(site.center, point));
  const xs = local.map((point) => point.xM);
  const ys = local.map((point) => point.yM);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const widthM = Math.max(1, maxX - minX);
  const depthM = Math.max(1, maxY - minY);
  const spanM = Math.max(widthM, depthM, 36);
  const center = localPointToGeo(site.center, {
    xM: (minX + maxX) / 2,
    yM: (minY + maxY) / 2,
  });
  const height = Math.min(1_800, Math.max(minHeightM, spanM * scale));
  flyToGeo(center, height);
}

export function frameSite(site: Site) {
  frameGeoPoints(site, site.boundary.length ? site.boundary : [site.center], 110, 3.2);
}


export type CameraControl =
  | "zoom-in"
  | "zoom-out"
  | "rotate-left"
  | "rotate-right"
  | "pan-left"
  | "pan-right"
  | "pan-up"
  | "pan-down";

export function controlCamera(action: CameraControl) {
  const viewer = window.viewer;
  const Cesium = window.Cesium;
  const camera = viewer?.camera;
  if (!camera || !Cesium) return;

  const height = Math.max(30, Number(camera.positionCartographic?.height) || 220);
  const moveAmount = Math.max(3, Math.min(120, height * 0.06));
  const zoomAmount = Math.max(8, Math.min(180, height * 0.18));
  const turn = Cesium.Math.toRadians(12);

  switch (action) {
    case "zoom-in":
      camera.zoomIn(zoomAmount);
      break;
    case "zoom-out":
      camera.zoomOut(zoomAmount);
      break;
    case "rotate-left":
      camera.setView({
        destination: camera.position,
        orientation: { heading: camera.heading - turn, pitch: camera.pitch, roll: camera.roll },
      });
      break;
    case "rotate-right":
      camera.setView({
        destination: camera.position,
        orientation: { heading: camera.heading + turn, pitch: camera.pitch, roll: camera.roll },
      });
      break;
    case "pan-left":
      camera.moveLeft(moveAmount);
      break;
    case "pan-right":
      camera.moveRight(moveAmount);
      break;
    case "pan-up":
      camera.moveUp(moveAmount);
      break;
    case "pan-down":
      camera.moveDown(moveAmount);
      break;
  }
}

export function frameWorkspace(
  site: Site,
  scenarios: Scenario[],
  viewpoint?: Viewpoint,
) {
  const points: GeoPoint[] = [...site.boundary];
  scenarios.forEach((scenario) => {
    rotatedFootprintPoints(scenario.mass).forEach((point) => {
      points.push(localPointToGeo(site.center, {
        xM: point.xM + scenario.mass.position.eastM,
        yM: point.yM + scenario.mass.position.northM,
      }));
    });
  });
  if (viewpoint) points.push(viewpoint.point);
  frameGeoPoints(site, points.length ? points : [site.center], 140, 3.1);
}

export function renderSite(site: Site) {
  const viewer = window.viewer;
  const Cesium = window.Cesium;
  if (!viewer?.entities || !Cesium) return;

  if (siteEntity) viewer.entities.remove(siteEntity);
  if (siteOutlineEntity) viewer.entities.remove(siteOutlineEntity);
  if (siteLabelEntity) viewer.entities.remove(siteLabelEntity);
  siteEntity = undefined;
  siteOutlineEntity = undefined;
  siteLabelEntity = undefined;

  if (site.boundary.length < 3) return;

  siteEntity = viewer.entities.add({
    name: site.name,
    polygon: {
      hierarchy: Cesium.Cartesian3.fromDegreesArray(flattenGeo(site.boundary)),
      height: 0,
      material: Cesium.Color.fromCssColorString("#55d7c8").withAlpha(0.10),
      outline: false,
    },
  });

  const closedBoundary = [...site.boundary, site.boundary[0]];
  siteOutlineEntity = viewer.entities.add({
    name: "SpaceLab selected site boundary",
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArray(flattenGeo(closedBoundary)),
      width: 4,
      material: Cesium.Color.fromCssColorString("#55d7c8").withAlpha(0.98),
      clampToGround: true,
    },
  });

  siteLabelEntity = viewer.entities.add({
    name: "SpaceLab selected site label",
    position: Cesium.Cartesian3.fromDegrees(site.center.lon, site.center.lat),
    point: {
      pixelSize: 8,
      color: Cesium.Color.fromCssColorString("#55d7c8"),
      outlineColor: Cesium.Color.BLACK.withAlpha(0.8),
      outlineWidth: 2,
      heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: "선택 부지",
      font: "600 12px sans-serif",
      fillColor: Cesium.Color.WHITE,
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString("#0f151c").withAlpha(0.88),
      backgroundPadding: new Cesium.Cartesian2(8, 5),
      pixelOffset: new Cesium.Cartesian2(0, -22),
      heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
}

export function clearScenarioEntities() {
  const viewer = window.viewer;
  if (!viewer?.entities) return;
  entities.forEach((value) => {
    if (value?.building) viewer.entities.remove(value.building);
    if (value?.shadow) viewer.entities.remove(value.shadow);
  });
  entities.clear();
}

export function renderScenario(
  scenario: Scenario,
  site: Site,
  active: boolean,
  timeZoneOffsetMinutes = siteTimeZoneOffsetMinutes,
) {
  const viewer = window.viewer;
  const Cesium = window.Cesium;
  if (!viewer?.entities || !Cesium) return;
  const old = entities.get(scenario.id);
  if (old?.building) viewer.entities.remove(old.building);
  if (old?.shadow) viewer.entities.remove(old.shadow);

  const buildingPolygon: any = {
    hierarchy: Cesium.Cartesian3.fromDegreesArray(footprintCorners(scenario, site)),
    extrudedHeight: scenario.mass.heightM,
    height: 0,
    material: Cesium.Color.fromCssColorString(active ? "#68f3c2" : "#7aa7ff").withAlpha(active ? 0.72 : 0.38),
    outline: true,
    outlineColor: Cesium.Color.WHITE.withAlpha(active ? 0.9 : 0.45),
  };
  if (Cesium.HeightReference) {
    buildingPolygon.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
    buildingPolygon.extrudedHeightReference = Cesium.HeightReference.RELATIVE_TO_GROUND;
  }

  const building = viewer.entities.add({
    id: `spacelab-mass-${scenario.id}`,
    name: scenario.name,
    properties: { scenarioId: scenario.id, kind: "building-mass" },
    polygon: buildingPolygon,
  });

  const shadow = computeShadowPolygon(scenario.mass, site.center, scenario.analysisTime, timeZoneOffsetMinutes);
  const shadowEntity = shadow.points.length >= 3 ? (() => {
    const shadowPolygon: any = {
      hierarchy: Cesium.Cartesian3.fromDegreesArray(localPointsToDegrees(site.center, shadow.points)),
      height: 0,
      extrudedHeight: 0.25,
      material: Cesium.Color.fromCssColorString(active ? "#68f3c2" : "#7aa7ff").withAlpha(active ? 0.22 : 0.14),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString(active ? "#68f3c2" : "#7aa7ff").withAlpha(active ? 0.55 : 0.38),
    };
    if (Cesium.HeightReference) {
      shadowPolygon.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
      shadowPolygon.extrudedHeightReference = Cesium.HeightReference.RELATIVE_TO_GROUND;
    }
    return viewer.entities.add({ name: `${scenario.name} solar shadow`, polygon: shadowPolygon });
  })() : undefined;
  entities.set(scenario.id, { building, shadow: shadowEntity });
}

export function renderDraftFootprint(center: GeoPoint, points: LocalPoint[]) {
  const viewer = window.viewer;
  const Cesium = window.Cesium;
  if (!viewer?.entities || !Cesium) return;
  if (draftEntity) viewer.entities.remove(draftEntity);
  if (!points.length) {
    draftEntity = undefined;
    return;
  }
  const geo = points.map((point) => localPointToGeo(center, point));
  draftEntity = viewer.entities.add({
    name: "SpaceLab drawing draft",
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArray(flattenGeo(geo)),
      width: 3,
      material: Cesium.Color.fromCssColorString("#ffcb6b"),
      clampToGround: true,
    },
  });
}

function pointFromScreen(position: any): GeoPoint | undefined {
  const viewer = window.viewer;
  const Cesium = window.Cesium;
  if (!viewer?.scene || !Cesium) return undefined;

  let cartesian;
  const picked = viewer.scene.pick(position);
  if (viewer.scene.pickPositionSupported && Cesium.defined(picked)) {
    cartesian = viewer.scene.pickPosition(position);
  }
  if (!cartesian) {
    const ray = viewer.camera.getPickRay(position);
    cartesian = ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined;
  }
  if (!cartesian) cartesian = viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid);
  if (!cartesian) return undefined;

  const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
  return {
    lon: Cesium.Math.toDegrees(cartographic.longitude),
    lat: Cesium.Math.toDegrees(cartographic.latitude),
  };
}

export function setMapPointHandler(handler?: (point: GeoPoint) => void) {
  const viewer = window.viewer;
  const Cesium = window.Cesium;
  if (!viewer?.screenSpaceEventHandler || !Cesium) return () => undefined;

  viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
  if (!handler) return () => undefined;

  const callback = (movement: any) => {
    const point = pointFromScreen(movement.position);
    if (point) handler(point);
  };
  viewer.screenSpaceEventHandler.setInputAction(callback, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  return () => viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
}


export function renderAnalysisMarkers(sunStudyPoint?: GeoPoint, viewpoint?: Viewpoint) {
  const viewer = window.viewer;
  const Cesium = window.Cesium;
  if (!viewer?.entities || !Cesium) return;

  if (sunStudyEntity) viewer.entities.remove(sunStudyEntity);
  if (viewpointEntity) viewer.entities.remove(viewpointEntity);
  sunStudyEntity = undefined;
  viewpointEntity = undefined;

  if (sunStudyPoint) {
    sunStudyEntity = viewer.entities.add({
      name: "Direct sun study point",
      position: Cesium.Cartesian3.fromDegrees(sunStudyPoint.lon, sunStudyPoint.lat),
      point: {
        pixelSize: 10,
        color: Cesium.Color.fromCssColorString("#ffcb6b"),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.75),
        outlineWidth: 2,
        heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
      },
      label: {
        text: "SUN",
        font: "11px sans-serif",
        fillColor: Cesium.Color.fromCssColorString("#ffdf9b"),
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.65),
        pixelOffset: new Cesium.Cartesian2(0, -20),
        heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
      },
    });
  }

  if (viewpoint) {
    viewpointEntity = viewer.entities.add({
      name: "Saved viewpoint",
      position: Cesium.Cartesian3.fromDegrees(viewpoint.point.lon, viewpoint.point.lat),
      point: {
        pixelSize: 10,
        color: Cesium.Color.fromCssColorString("#82a6ff"),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.75),
        outlineWidth: 2,
        heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
      },
      label: {
        text: "VIEW",
        font: "11px sans-serif",
        fillColor: Cesium.Color.fromCssColorString("#dce5ff"),
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.65),
        pixelOffset: new Cesium.Cartesian2(0, -20),
        heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
      },
    });
  }
}

function terrainHeight(point: GeoPoint) {
  const viewer = window.viewer;
  const Cesium = window.Cesium;
  if (!viewer?.scene?.globe || !Cesium) return 0;
  const cartographic = Cesium.Cartographic.fromDegrees(point.lon, point.lat);
  return viewer.scene.globe.getHeight(cartographic) ?? 0;
}

export function flyToViewpoint(viewpoint: Viewpoint, site: Site, mass?: BuildingMass) {
  const viewer = window.viewer;
  const Cesium = window.Cesium;
  if (!viewer?.camera || !Cesium) return;

  const eyeHeight = terrainHeight(viewpoint.point) + Math.max(1.2, viewpoint.eyeHeightM);
  const targetHeight = terrainHeight(site.center) + Math.max(4, (mass?.heightM ?? 12) / 2);
  const eye = Cesium.Cartesian3.fromDegrees(viewpoint.point.lon, viewpoint.point.lat, eyeHeight);
  const target = Cesium.Cartesian3.fromDegrees(site.center.lon, site.center.lat, targetHeight);
  const direction = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.subtract(target, eye, new Cesium.Cartesian3()),
    new Cesium.Cartesian3(),
  );
  const up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(eye, new Cesium.Cartesian3());

  viewer.camera.flyTo({
    destination: eye,
    orientation: { direction, up },
    duration: 0.8,
  });
}


export type SceneSunContextResult = {
  supported: boolean;
  blockedTimes: string[];
  maxDistanceM: number;
  sampleStepM: number;
  source: "vworld-3d-scene" | "unsupported";
};

function analysisObjectsToExclude() {
  const excluded: any[] = [];
  entities.forEach((value) => {
    if (value?.building) excluded.push(value.building);
    if (value?.shadow) excluded.push(value.shadow);
  });
  if (siteEntity) excluded.push(siteEntity);
  if (siteOutlineEntity) excluded.push(siteOutlineEntity);
  if (siteLabelEntity) excluded.push(siteLabelEntity);
  if (draftEntity) excluded.push(draftEntity);
  if (sunStudyEntity) excluded.push(sunStudyEntity);
  if (viewpointEntity) excluded.push(viewpointEntity);
  return excluded;
}

/**
 * Samples the loaded VWorld/Cesium 3D scene along each sun vector.
 * Existing 3D Tiles and terrain become context occluders while SpaceLab's own
 * planned entities are excluded and handled by the deterministic mass engine.
 */
export async function sampleSceneSunContext(
  point: GeoPoint,
  samples: SunStudySample[],
  options: { observerHeightM?: number; maxDistanceM?: number; sampleStepM?: number } = {},
): Promise<SceneSunContextResult> {
  const viewer = window.viewer;
  const Cesium = window.Cesium;
  const scene = viewer?.scene;
  const maxDistanceM = Math.max(50, options.maxDistanceM ?? 350);
  const sampleStepM = Math.max(5, options.sampleStepM ?? 10);
  const observerHeightM = Math.max(0.1, options.observerHeightM ?? 1.2);

  if (!scene || !Cesium || !scene.sampleHeightSupported || typeof scene.sampleHeightMostDetailed !== "function") {
    return { supported: false, blockedTimes: [], maxDistanceM, sampleStepM, source: "unsupported" };
  }

  const groundCartographic = Cesium.Cartographic.fromDegrees(point.lon, point.lat);
  const terrainHeight = scene.globe?.getHeight?.(groundCartographic);
  const originHeight = Number.isFinite(terrainHeight) ? terrainHeight : 0;
  const positions: any[] = [];
  const ranges: { sample: SunStudySample; start: number; end: number; elevationRad: number }[] = [];

  for (const sample of samples) {
    if (sample.state === "night" || !Number.isFinite(sample.elevationDeg) || sample.elevationDeg <= 0) continue;
    const start = positions.length;
    const azimuthRad = (sample.azimuthDeg * Math.PI) / 180;
    const elevationRad = (sample.elevationDeg * Math.PI) / 180;
    for (let distanceM = sampleStepM; distanceM <= maxDistanceM; distanceM += sampleStepM) {
      const geo = localPointToGeo(point, {
        xM: Math.sin(azimuthRad) * distanceM,
        yM: Math.cos(azimuthRad) * distanceM,
      });
      const cartographic = Cesium.Cartographic.fromDegrees(geo.lon, geo.lat);
      (cartographic as any).__spaceLabDistanceM = distanceM;
      positions.push(cartographic);
    }
    ranges.push({ sample, start, end: positions.length, elevationRad });
  }

  if (!positions.length) {
    return { supported: true, blockedTimes: [], maxDistanceM, sampleStepM, source: "vworld-3d-scene" };
  }

  const sampled = await scene.sampleHeightMostDetailed(positions, analysisObjectsToExclude(), 0.5);
  const blockedTimes: string[] = [];

  for (const range of ranges) {
    let blocked = false;
    for (let index = range.start; index < range.end; index += 1) {
      const samplePosition = sampled[index];
      const sampledHeight = samplePosition?.height;
      const distanceM = Number((positions[index] as any).__spaceLabDistanceM);
      if (!Number.isFinite(sampledHeight) || !Number.isFinite(distanceM)) continue;
      const sunRayHeight = originHeight + observerHeightM + Math.tan(range.elevationRad) * distanceM;
      if (sampledHeight > sunRayHeight + 0.75) {
        blocked = true;
        break;
      }
    }
    if (blocked) blockedTimes.push(range.sample.localDateTime);
  }

  return {
    supported: true,
    blockedTimes,
    maxDistanceM,
    sampleStepM,
    source: "vworld-3d-scene",
  };
}



export type ViewImpactResult = {
  supported: boolean;
  visibleSamples: number;
  totalSamples: number;
  visibleRatioPct: number;
  classification: "mostly-visible" | "partially-visible" | "mostly-occluded" | "unsupported";
  blockedSampleIds: string[];
  sampleStepM: number;
  source: "vworld-3d-scene" | "unsupported";
};

export async function sampleViewImpact(
  viewpoint: Viewpoint,
  site: Site,
  mass: BuildingMass,
  options: { sampleStepM?: number; clearanceM?: number } = {},
): Promise<ViewImpactResult> {
  const viewer = window.viewer;
  const Cesium = window.Cesium;
  const scene = viewer?.scene;
  const sampleStepM = Math.max(3, options.sampleStepM ?? 8);
  const clearanceM = Math.max(0.1, options.clearanceM ?? 0.75);

  if (!scene || !Cesium || !scene.sampleHeightSupported || typeof scene.sampleHeightMostDetailed !== "function") {
    return {
      supported: false,
      visibleSamples: 0,
      totalSamples: 0,
      visibleRatioPct: 0,
      classification: "unsupported",
      blockedSampleIds: [],
      sampleStepM,
      source: "unsupported",
    };
  }

  const targets = viewTargetSamples(site, mass);
  const eyeGround = terrainHeight(viewpoint.point);
  const eyeHeight = eyeGround + Math.max(1.2, viewpoint.eyeHeightM);
  const positions: any[] = [];
  const ranges: { id: string; start: number; end: number }[] = [];

  for (const target of targets) {
    const local = geoPointToLocal(viewpoint.point, target.point);
    const distanceM = Math.hypot(local.xM, local.yM);
    const targetGround = terrainHeight(target.point);
    const targetHeight = targetGround + Math.max(0, mass.heightM * target.heightFraction);

    if (!Number.isFinite(distanceM) || distanceM < 1) {
      ranges.push({ id: target.id, start: positions.length, end: positions.length });
      continue;
    }

    const start = positions.length;
    const maxPathDistance = Math.max(0, distanceM * 0.92);
    for (let pathDistanceM = sampleStepM; pathDistanceM < maxPathDistance; pathDistanceM += sampleStepM) {
      const ratio = pathDistanceM / distanceM;
      const geo = localPointToGeo(viewpoint.point, {
        xM: local.xM * ratio,
        yM: local.yM * ratio,
      });
      const cartographic = Cesium.Cartographic.fromDegrees(geo.lon, geo.lat);
      (cartographic as any).__spaceLabRayHeight = eyeHeight + (targetHeight - eyeHeight) * ratio;
      positions.push(cartographic);
    }
    ranges.push({ id: target.id, start, end: positions.length });
  }

  const sampled = positions.length
    ? await scene.sampleHeightMostDetailed(positions, analysisObjectsToExclude(), 0.5)
    : [];

  const blockedSampleIds: string[] = [];
  for (const range of ranges) {
    let blocked = false;
    for (let index = range.start; index < range.end; index += 1) {
      const samplePosition = sampled[index];
      const sampledHeight = samplePosition?.height;
      const rayHeight = Number((positions[index] as any).__spaceLabRayHeight);
      if (!Number.isFinite(sampledHeight) || !Number.isFinite(rayHeight)) continue;
      if (sampledHeight > rayHeight + clearanceM) {
        blocked = true;
        break;
      }
    }
    if (blocked) blockedSampleIds.push(range.id);
  }

  const totalSamples = targets.length;
  const visibleSamples = Math.max(0, totalSamples - blockedSampleIds.length);
  const visibleRatioPct = totalSamples > 0 ? (visibleSamples / totalSamples) * 100 : 0;
  const classification = visibleRatioPct >= 75
    ? "mostly-visible"
    : visibleRatioPct >= 25
      ? "partially-visible"
      : "mostly-occluded";

  return {
    supported: true,
    visibleSamples,
    totalSamples,
    visibleRatioPct,
    classification,
    blockedSampleIds,
    sampleStepM,
    source: "vworld-3d-scene",
  };
}

export function setShadowTime(localDateTime: string, timeZoneOffsetMinutes = siteTimeZoneOffsetMinutes) {
  const viewer = window.viewer;
  const Cesium = window.Cesium;
  if (!viewer || !Cesium || !localDateTime) return;
  const sign = timeZoneOffsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(timeZoneOffsetMinutes);
  const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
  const offsetMinutes = String(absoluteOffset % 60).padStart(2, "0");
  const date = new Date(`${localDateTime}:00${sign}${offsetHours}:${offsetMinutes}`);
  if (!Number.isNaN(date.getTime())) viewer.clock.currentTime = Cesium.JulianDate.fromDate(date);
}

export function setShadowMode(enabled: boolean) {
  const viewer = window.viewer;
  if (!viewer) return;
  viewer.shadows = enabled;
  if (viewer.scene?.globe) {
    const Cesium = window.Cesium;
    if (Cesium) viewer.scene.globe.shadows = enabled ? Cesium.ShadowMode.ENABLED : Cesium.ShadowMode.DISABLED;
  }
}
