"use client";

import { useEffect, useRef } from "react";
import {
  playSafeShadowPolygons,
  type PlaySafeMapViewAction,
  type PlaySafeSnapshot,
  type PlaySafeWalkingRoute,
} from "@/src/playsafe";

type VWorldMapLike = {
  setOption: (options: Record<string, unknown>) => void;
  setMapId?: (id: string) => void;
  setInitPosition?: (position: unknown) => void;
  setLogoVisible?: (visible: boolean) => void;
  setNavigationZoomVisible?: (visible: boolean) => void;
  getLayerElement?: (name: string) => { show?: () => void; hide?: () => void } | undefined;
  start: () => void;
  destroy?: () => void;
};

type VWorldRuntime = {
  Map: new () => VWorldMapLike;
  CameraPosition: new (coord: unknown, direction: unknown) => unknown;
  CoordZ: new (lon: number, lat: number, height: number) => unknown;
  Direction: new (heading: number, pitch: number, roll: number) => unknown;
  ws3dInitCallBack?: () => void;
};

type VWorldWindow = Window & {
  vw?: VWorldRuntime;
  ws3d?: { viewer?: any };
  Cesium?: any;
};

function exposureColor(Cesium: any, value: number) {
  const stops = [
    { value: 0, color: [67, 214, 189] },
    { value: 45, color: [242, 196, 93] },
    { value: 75, color: [239, 140, 87] },
    { value: 100, color: [232, 95, 105] },
  ];

  const clamped = Math.max(0, Math.min(100, value));
  let a = stops[0];
  let b = stops[stops.length - 1];
  for (let index = 0; index < stops.length - 1; index += 1) {
    if (clamped >= stops[index].value && clamped <= stops[index + 1].value) {
      a = stops[index];
      b = stops[index + 1];
      break;
    }
  }

  const span = Math.max(1, b.value - a.value);
  const ratio = (clamped - a.value) / span;
  const color = a.color.map((channel, index) =>
    Math.round(channel + (b.color[index] - channel) * ratio)) as [number, number, number];

  return new Cesium.Color(color[0] / 255, color[1] / 255, color[2] / 255, 0.86);
}

function fitColor(Cesium: any, score: number) {
  if (score >= 75) return Cesium.Color.fromCssColorString("#53d6c7");
  if (score >= 58) return Cesium.Color.fromCssColorString("#9bd4a3");
  if (score >= 38) return Cesium.Color.fromCssColorString("#f2c45d");
  return Cesium.Color.fromCssColorString("#ef8795");
}

function waitForVWorldBootstrap(timeoutMs = 8_000) {
  return new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const runtime = window as VWorldWindow;
      if (runtime.vw?.Map) {
        resolve();
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error("VWorld bootstrap timed out"));
        return;
      }
      window.setTimeout(check, 80);
    };
    check();
  });
}

function loadVWorldScript() {
  return waitForVWorldBootstrap();
}

function kstDate(localDateTime: string) {
  const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/.test(localDateTime);
  const value = hasOffset
    ? localDateTime
    : localDateTime.length === 16
      ? localDateTime + ":00+09:00"
      : localDateTime + "+09:00";
  return new Date(value);
}

function clearPlaySafeEntities(viewer: any, prefixes = ["playsafe:"]) {
  const values = [...viewer.entities.values] as Array<{ id?: string }>;
  for (const entity of values) {
    if (
      typeof entity.id === "string"
      && prefixes.some((prefix) => entity.id?.startsWith(prefix))
    ) {
      viewer.entities.remove(entity);
    }
  }
}

export function PlaySafeVWorldMap({
  snapshot,
  selectedPlaceId,
  previewAt,
  viewAction,
  walkingRoute,
  onSelectPlace,
  onUnavailable,
}: {
  snapshot: PlaySafeSnapshot;
  selectedPlaceId?: string;
  previewAt: string;
  viewAction?: PlaySafeMapViewAction;
  walkingRoute?: PlaySafeWalkingRoute;
  onSelectPlace: (placeId: string) => void;
  onUnavailable: (reason: string) => void;
}) {
  const containerId = "playsafe-vworld-map";
  const mapRef = useRef<VWorldMapLike | null>(null);
  const viewerRef = useRef<any>(undefined);
  const clickHandlerRef = useRef<any>(undefined);
  const shadowFrameRef = useRef<number | undefined>(undefined);
  const readyRef = useRef(false);
  const lastCameraPlaceRef = useRef<string | undefined>(undefined);
  const onSelectRef = useRef(onSelectPlace);
  onSelectRef.current = onSelectPlace;

  useEffect(() => {
    let disposed = false;
    let viewerPollId: number | undefined;
    let viewerReady = false;

    void loadVWorldScript()
      .then(() => {
        if (disposed) return;
        const runtime = window as VWorldWindow;
        const vw = runtime.vw;
        if (!vw) throw new Error("VWorld runtime is unavailable");

        const initial = snapshot.assessments[0]?.place.point ?? snapshot.query.center;
        const position = new vw.CameraPosition(
          new vw.CoordZ(initial.lon, initial.lat, 850),
          new vw.Direction(335, -48, 0),
        );

        const map = new vw.Map();
        map.setOption({
          mapId: containerId,
          initPosition: position,
          logo: true,
          navigation: true,
        });
        map.setMapId?.(containerId);
        map.setInitPosition?.(position);
        map.setLogoVisible?.(true);
        map.setNavigationZoomVisible?.(false);

        const setupViewer = () => {
          if (disposed || viewerReady) return false;
          const readyRuntime = window as VWorldWindow;
          const viewer = readyRuntime.ws3d?.viewer;
          const Cesium = readyRuntime.Cesium;
          if (!viewer || !Cesium) return false;

          viewerReady = true;
          viewerRef.current = viewer;
          mapRef.current = map;
          readyRef.current = true;

          try {
            map.getLayerElement?.("facility_build")?.show?.();
          } catch {
            // VWorld may already have the layer visible.
          }

          try {
            viewer.scene.globe.depthTestAgainstTerrain = true;
            viewer.scene.globe.enableLighting = true;
            viewer.scene.requestRenderMode = true;
            viewer.scene.maximumRenderTimeChange = Number.POSITIVE_INFINITY;
            viewer.shadows = true;
            viewer.clock.shouldAnimate = false;
            viewer.scene.requestRender?.();
          } catch {
            // Not critical for the presentation overlay.
          }

          const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
          handler.setInputAction((movement: any) => {
            const picked = viewer.scene.pick(movement.position);
            const id = picked?.id?.id ?? picked?.id;
            if (typeof id === "string" && id.startsWith("playsafe:place:")) {
              onSelectRef.current(id.slice("playsafe:place:".length));
            }
          }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
          clickHandlerRef.current = handler;

          window.dispatchEvent(new CustomEvent("playsafe-vworld-ready"));
          return true;
        };

        vw.ws3dInitCallBack = () => {
          setupViewer();
        };

        map.start();

        viewerPollId = window.setInterval(() => {
          if (setupViewer() && viewerPollId !== undefined) {
            window.clearInterval(viewerPollId);
            viewerPollId = undefined;
          }
        }, 120);

        window.setTimeout(() => {
          if (!disposed && !viewerReady) {
            onUnavailable("VWorld viewer unavailable");
          }
          if (viewerPollId !== undefined) {
            window.clearInterval(viewerPollId);
            viewerPollId = undefined;
          }
        }, 8_000);
      })
      .catch((error) => {
        if (!disposed) onUnavailable(error instanceof Error ? error.message : String(error));
      });

    return () => {
      disposed = true;
      if (viewerPollId !== undefined) {
        window.clearInterval(viewerPollId);
      }
      readyRef.current = false;
      try {
        clickHandlerRef.current?.destroy?.();
      } catch {
        // Ignore teardown differences across VWorld versions.
      }
      clickHandlerRef.current = undefined;
      viewerRef.current = undefined;
      try {
        mapRef.current?.destroy?.();
      } catch {
        // Ignore teardown differences across VWorld versions.
      }
      mapRef.current = null;
    };
  }, [onUnavailable]);

  useEffect(() => {
    const applyStatic = () => {
      if (!readyRef.current) return;
      const runtime = window as VWorldWindow;
      const viewer = viewerRef.current;
      const Cesium = runtime.Cesium;
      if (!viewer || !Cesium) return;

      clearPlaySafeEntities(viewer, [
        "playsafe:tree:",
        "playsafe:place:",
        "playsafe:selected-boundary",
        "playsafe:heat:",
        "playsafe:child",
      ]);

      try {
        const primitives = viewer.scene.primitives;
        if (primitives?.length && Cesium.ShadowMode) {
          for (let index = 0; index < primitives.length; index += 1) {
            const primitive = primitives.get(index);
            if (primitive && "shadows" in primitive) {
              primitive.shadows = Cesium.ShadowMode.ENABLED;
            }
          }
        }
      } catch {
        // The analytical shadow overlay is independent of VWorld tile shadow support.
      }

      snapshot.trees.slice(0, 80).forEach((tree, index) => {
        viewer.entities.add({
          id: "playsafe:tree:" + index,
          position: Cesium.Cartesian3.fromDegrees(tree.point.lon, tree.point.lat),
          point: {
            pixelSize: 5,
            color: Cesium.Color.fromCssColorString("#55c77a").withAlpha(0.8),
            outlineColor: Cesium.Color.fromCssColorString("#d6f5dc").withAlpha(0.75),
            outlineWidth: 1,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      });

      for (const assessment of snapshot.assessments) {
        const isSelected = assessment.place.id === selectedPlaceId;
        viewer.entities.add({
          id: "playsafe:place:" + assessment.place.id,
          name: assessment.place.name,
          position: Cesium.Cartesian3.fromDegrees(
            assessment.place.point.lon,
            assessment.place.point.lat,
          ),
          point: {
            pixelSize: isSelected ? 18 : 13,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            color: fitColor(Cesium, assessment.fitScore),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: isSelected ? 4 : 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: isSelected
              ? assessment.place.name + " · " + Math.round(assessment.fitScore)
              : assessment.place.name,
            font: isSelected ? "700 15px sans-serif" : "600 12px sans-serif",
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.fromCssColorString("#071015"),
            outlineWidth: isSelected ? 4 : 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, isSelected ? -38 : -28),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            showBackground: false,
          },
        });
      }

      const selected = snapshot.assessments.find((item) => item.place.id === selectedPlaceId)
        ?? snapshot.assessments[0];
      if (!selected) return;

      if (selected.place.boundary && selected.place.boundary.length >= 3) {
        const coordinates = selected.place.boundary.flatMap((point) => [point.lon, point.lat]);
        const boundaryPositions = Cesium.Cartesian3.fromDegreesArray(coordinates);
        viewer.entities.add({
          id: "playsafe:selected-boundary",
          polygon: {
            hierarchy: boundaryPositions,
            material: fitColor(Cesium, selected.fitScore).withAlpha(0.08),
            height: 0,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            classificationType: Cesium.ClassificationType.TERRAIN,
          },
        });
        viewer.entities.add({
          id: "playsafe:selected-boundary-line",
          polyline: {
            positions: [...boundaryPositions, boundaryPositions[0]],
            width: 3,
            material: fitColor(Cesium, selected.fitScore).withAlpha(0.95),
            clampToGround: true,
          },
        });
      }

      selected.heatSamples.forEach((sample, index) => {
        const color = exposureColor(Cesium, sample.exposurePct);
        viewer.entities.add({
          id: "playsafe:heat:" + index,
          position: Cesium.Cartesian3.fromDegrees(sample.point.lon, sample.point.lat),
          ellipse: {
            semiMajorAxis: 7.5,
            semiMinorAxis: 7.5,
            material: color.withAlpha(sample.shaded ? 0.16 : 0.34),
            outline: true,
            outlineColor: color.withAlpha(0.72),
            height: 0.35,
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
            classificationType: Cesium.ClassificationType.TERRAIN,
          },
        });
      });

      viewer.entities.add({
        id: "playsafe:child",
        position: Cesium.Cartesian3.fromDegrees(
          selected.place.point.lon,
          selected.place.point.lat,
        ),
        point: {
          pixelSize: 20,
          color: Cesium.Color.fromCssColorString("#111922"),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 4,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: "🧒 " + snapshot.query.childAge + "세",
          font: "700 16px sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.fromCssColorString("#071015"),
          outlineWidth: 4,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -48),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          showBackground: false,
        },
      });

      if (lastCameraPlaceRef.current !== selected.place.id) {
        lastCameraPlaceRef.current = selected.place.id;
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(
            selected.place.point.lon,
            selected.place.point.lat,
            720,
          ),
          orientation: {
            heading: Cesium.Math.toRadians(335),
            pitch: Cesium.Math.toRadians(-48),
            roll: 0,
          },
          duration: 0.8,
        });
      }

      viewer.scene.requestRender?.();
    };

    applyStatic();
    window.addEventListener("playsafe-vworld-ready", applyStatic);
    return () => window.removeEventListener("playsafe-vworld-ready", applyStatic);
  }, [selectedPlaceId, snapshot]);

  useEffect(() => {
    const applyTime = () => {
      if (!readyRef.current) return;
      const runtime = window as VWorldWindow;
      const viewer = viewerRef.current;
      const Cesium = runtime.Cesium;
      if (!viewer || !Cesium) return;

      const previewDate = kstDate(previewAt);
      if (!Number.isNaN(previewDate.getTime())) {
        viewer.clock.currentTime = Cesium.JulianDate.fromDate(previewDate);
        viewer.clock.shouldAnimate = false;
      }

      clearPlaySafeEntities(viewer, ["playsafe:shadow:"]);

      const selected = snapshot.assessments.find((item) => item.place.id === selectedPlaceId)
        ?? snapshot.assessments[0];
      if (selected) {
        const shadowPolygons = playSafeShadowPolygons(
          selected.place,
          snapshot.buildings,
          snapshot.trees,
          previewAt,
        );
        shadowPolygons.slice(0, 180).forEach((polygon, index) => {
          if (polygon.length < 3) return;
          const positions = Cesium.Cartesian3.fromDegreesArray(
            polygon.flatMap((point) => [point.lon, point.lat]),
          );
          viewer.entities.add({
            id: "playsafe:shadow:" + index,
            polygon: {
              hierarchy: positions,
              material: Cesium.Color.fromCssColorString("#071015").withAlpha(0.28),
              height: 0.08,
              heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
              classificationType: Cesium.ClassificationType.TERRAIN,
            },
          });
        });
      }

      viewer.scene.requestRender?.();
    };

    const schedule = () => {
      if (shadowFrameRef.current !== undefined) {
        window.cancelAnimationFrame(shadowFrameRef.current);
      }
      shadowFrameRef.current = window.requestAnimationFrame(() => {
        shadowFrameRef.current = undefined;
        applyTime();
      });
    };

    schedule();
    window.addEventListener("playsafe-vworld-ready", schedule);
    return () => {
      window.removeEventListener("playsafe-vworld-ready", schedule);
      if (shadowFrameRef.current !== undefined) {
        window.cancelAnimationFrame(shadowFrameRef.current);
        shadowFrameRef.current = undefined;
      }
    };
  }, [previewAt, selectedPlaceId, snapshot.assessments, snapshot.buildings, snapshot.trees]);

  useEffect(() => {
    const applyRoute = () => {
      if (!readyRef.current) return;
      const runtime = window as VWorldWindow;
      const viewer = viewerRef.current;
      const Cesium = runtime.Cesium;
      if (!viewer || !Cesium) return;

      clearPlaySafeEntities(viewer, [
        "playsafe:route-line",
        "playsafe:route-start",
        "playsafe:route-zone:",
        "playsafe:route-accident:",
        "playsafe:route-toilet:",
      ]);

      if (!walkingRoute || walkingRoute.points.length < 2) {
        viewer.scene.requestRender?.();
        return;
      }

      const routePositions = Cesium.Cartesian3.fromDegreesArray(
        walkingRoute.points.flatMap((point) => [point.lon, point.lat]),
      );

      viewer.entities.add({
        id: "playsafe:route-line",
        polyline: {
          positions: routePositions,
          width: 6,
          material: Cesium.Color.fromCssColorString("#53d6c7").withAlpha(0.96),
          clampToGround: true,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });

      viewer.entities.add({
        id: "playsafe:route-start",
        position: Cesium.Cartesian3.fromDegrees(
          walkingRoute.start.lon,
          walkingRoute.start.lat,
        ),
        point: {
          pixelSize: 13,
          color: Cesium.Color.fromCssColorString("#53d6c7"),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 3,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: "출발",
          font: "700 12px sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.fromCssColorString("#071015"),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -24),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });

      walkingRoute.childZones.slice(0, 10).forEach((zone, index) => {
        viewer.entities.add({
          id: "playsafe:route-zone:" + index,
          position: Cesium.Cartesian3.fromDegrees(zone.point.lon, zone.point.lat),
          point: {
            pixelSize: 9,
            color: Cesium.Color.fromCssColorString("#d9bd63"),
            outlineColor: Cesium.Color.fromCssColorString("#071015"),
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      });

      walkingRoute.childAccidentHotspots.slice(0, 8).forEach((spot, index) => {
        viewer.entities.add({
          id: "playsafe:route-accident:" + index,
          position: Cesium.Cartesian3.fromDegrees(spot.point.lon, spot.point.lat),
          point: {
            pixelSize: 10,
            color: Cesium.Color.fromCssColorString("#ef9d8b"),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      });

      walkingRoute.toilets.slice(0, 5).forEach((toilet, index) => {
        viewer.entities.add({
          id: "playsafe:route-toilet:" + index,
          position: Cesium.Cartesian3.fromDegrees(toilet.point.lon, toilet.point.lat),
          point: {
            pixelSize: 7,
            color: Cesium.Color.fromCssColorString("#7f9df4"),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 1,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      });

      viewer.scene.requestRender?.();
    };

    applyRoute();
    window.addEventListener("playsafe-vworld-ready", applyRoute);
    return () => window.removeEventListener("playsafe-vworld-ready", applyRoute);
  }, [walkingRoute]);

  useEffect(() => {
    if (!viewAction) return;

    const applyCamera = () => {
      if (!readyRef.current) return;
      const runtime = window as VWorldWindow;
      const viewer = viewerRef.current;
      const Cesium = runtime.Cesium;
      if (!viewer || !Cesium) return;

      const selected = snapshot.assessments.find((item) => item.place.id === selectedPlaceId)
        ?? snapshot.assessments[0];

      if (viewAction.type === "route" && walkingRoute?.points.length) {
        const routePositions = walkingRoute.points.map((point) =>
          Cesium.Cartesian3.fromDegrees(point.lon, point.lat));
        const sphere = Cesium.BoundingSphere.fromPoints(routePositions);
        viewer.camera.flyToBoundingSphere(sphere, {
          duration: 0.65,
          offset: new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(0),
            Cesium.Math.toRadians(-58),
            Math.max(420, sphere.radius * 3.2),
          ),
        });
        viewer.scene.requestRender?.();
        return;
      }

      const target = viewAction.type === "top"
        ? selected?.place.point ?? snapshot.query.center
        : snapshot.query.center;

      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          target.lon,
          target.lat,
          viewAction.type === "top" ? 900 : 850,
        ),
        orientation: {
          heading: Cesium.Math.toRadians(viewAction.type === "top" ? 0 : 335),
          pitch: Cesium.Math.toRadians(viewAction.type === "top" ? -90 : -48),
          roll: 0,
        },
        duration: 0.65,
      });
      viewer.scene.requestRender?.();
    };

    applyCamera();
    window.addEventListener("playsafe-vworld-ready", applyCamera);
    return () => window.removeEventListener("playsafe-vworld-ready", applyCamera);
  }, [selectedPlaceId, snapshot.assessments, snapshot.query.center, viewAction, walkingRoute]);

  return (
    <div className="absolute inset-0">
      <div id={containerId} className="h-full w-full bg-[#0d141b]" />
    </div>
  );
}
