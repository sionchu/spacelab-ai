import { computeShadowPolygon, localPointToGeo, rotatedFootprintPoints, siteTimeZoneOffsetMinutes } from "./model";
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
        if (src) childScripts.push(new URL(src, document.baseURI).href);
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
      reject(new Error("Failed to load VWorld WebGL SDK"));
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

export function flyToSite(site: Site, height = 230) {
  const viewer = window.viewer;
  const Cesium = window.Cesium;
  if (!viewer?.camera || !Cesium) return;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(site.center.lon, site.center.lat, height),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-72), roll: 0 },
    duration: 0.8,
  });
}

export function renderSite(site: Site) {
  const viewer = window.viewer;
  const Cesium = window.Cesium;
  if (!viewer?.entities || !Cesium) return;
  if (siteEntity) viewer.entities.remove(siteEntity);
  if (site.boundary.length < 3) return;
  siteEntity = viewer.entities.add({
    name: site.name,
    polygon: {
      hierarchy: Cesium.Cartesian3.fromDegreesArray(flattenGeo(site.boundary)),
      height: 0,
      material: Cesium.Color.fromCssColorString("#ffcb6b").withAlpha(0.10),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString("#ffcb6b").withAlpha(0.95),
      outlineWidth: 2,
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
