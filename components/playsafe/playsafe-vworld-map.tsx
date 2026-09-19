"use client";

import { useEffect, useRef } from "react";
import type { PlaySafeSnapshot } from "@/src/playsafe";

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

function clearPlaySafeEntities(viewer: any) {
  const values = [...viewer.entities.values] as Array<{ id?: string }>;
  for (const entity of values) {
    if (typeof entity.id === "string" && entity.id.startsWith("playsafe:")) {
      viewer.entities.remove(entity);
    }
  }
}

export function PlaySafeVWorldMap({
  snapshot,
  selectedPlaceId,
  onSelectPlace,
  onUnavailable,
}: {
  snapshot: PlaySafeSnapshot;
  selectedPlaceId?: string;
  onSelectPlace: (placeId: string) => void;
  onUnavailable: (reason: string) => void;
}) {
  const containerId = "playsafe-vworld-map";
  const mapRef = useRef<VWorldMapLike | null>(null);
  const viewerRef = useRef<any>(undefined);
  const clickHandlerRef = useRef<any>(undefined);
  const readyRef = useRef(false);
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
    const apply = () => {
      if (!readyRef.current) return;
      const runtime = window as VWorldWindow;
      const viewer = viewerRef.current;
      const Cesium = runtime.Cesium;
      if (!viewer || !Cesium) return;

      clearPlaySafeEntities(viewer);

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
        const selected = assessment.place.id === selectedPlaceId;
        viewer.entities.add({
          id: "playsafe:place:" + assessment.place.id,
          name: assessment.place.name,
          position: Cesium.Cartesian3.fromDegrees(
            assessment.place.point.lon,
            assessment.place.point.lat,
          ),
          point: {
            pixelSize: selected ? 18 : 13,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            color: fitColor(Cesium, assessment.fitScore),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: selected ? 4 : 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: assessment.place.name + "\n" + Math.round(assessment.fitScore) + " · 그늘 " + Math.round(assessment.shadePct) + "%",
            font: selected ? "700 16px sans-serif" : "600 13px sans-serif",
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.fromCssColorString("#0b1116"),
            outlineWidth: 4,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, selected ? -42 : -32),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString("#0b1116").withAlpha(0.78),
            backgroundPadding: new Cesium.Cartesian2(8, 5),
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
          text: "🧒 " + snapshot.query.childAge + "세 · " + Math.round(selected.fitScore),
          font: "700 18px sans-serif",
          fillColor: fitColor(Cesium, selected.fitScore),
          outlineColor: Cesium.Color.fromCssColorString("#0b1116"),
          outlineWidth: 5,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -52),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("#0b1116").withAlpha(0.88),
          backgroundPadding: new Cesium.Cartesian2(10, 7),
        },
      });

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
        duration: 1.15,
      });
    };

    apply();
    window.addEventListener("playsafe-vworld-ready", apply);
    return () => window.removeEventListener("playsafe-vworld-ready", apply);
  }, [selectedPlaceId, snapshot]);

  return (
    <div className="absolute inset-0">
      <div id={containerId} className="h-full w-full bg-[#0d141b]" />
      <div className="pointer-events-none absolute right-3 top-3 rounded-2xl border border-white/10 bg-[#101820]/92 px-3 py-2 text-right shadow-xl backdrop-blur-sm">
        <div className="text-[10px] font-bold text-[#f0bb62]">VWORLD 3D · PLAYSAFE</div>
        <div className="mt-1 text-sm font-extrabold">
          {snapshot.weather.apparentTemperatureC.toFixed(1)}°C 체감
        </div>
        <div className="text-[9px] text-[#92a0ab]">
          기온 {snapshot.weather.temperatureC.toFixed(1)}° · 습도 {snapshot.weather.relativeHumidityPct.toFixed(0)}% · UV {snapshot.weather.uvIndex.toFixed(1)}
        </div>
      </div>
    </div>
  );
}
