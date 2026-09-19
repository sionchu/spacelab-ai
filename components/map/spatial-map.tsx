"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { MapLibreOverlay } from "@deck.gl/maplibre";
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent, StyleSpecification } from "maplibre-gl";
import { bbox, featureCollection, point } from "@turf/turf";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { computeShadowPolygon } from "@/src/model";
import type { GeoPoint, Scenario, Site, Viewpoint } from "@/src/types";
import { scenarioFeature, shadowFeature, siteGeoJson } from "@/lib/spatial/geojson";
import { minutesFromTime, solarPositionAt } from "@/lib/solar/sun";
import type { ConceptCameraState } from "@/src/concept-view";
import type { ViewImpactResult } from "@/src/view-impact";
import { buildVisualizationLayers } from "@/components/map/visualization-layers";

type InteractionMode = "inspect" | "pick-site" | "move-mass" | "viewpoint";

export type SpatialMapApi = {
  getCameraState: () => ConceptCameraState | undefined;
  captureSnapshot: () => Promise<Blob | undefined>;
};

const emptyContextBuildings: FeatureCollection<Polygon | MultiPolygon> = {
  type: "FeatureCollection",
  features: [],
};

const baseStyle: StyleSpecification = {
  version: 8,
  name: "SpaceLab Base",
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#0d141b" } },
    { id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.55, "raster-brightness-max": 0.66, "raster-contrast": 0.08 } },
  ],
  light: {
    anchor: "map",
    color: "#fff9e8",
    intensity: 0.68,
    position: [1.5, 180, 50],
  },
};

function setGeoJson(map: MapLibreMap, id: string, data: GeoJSON.GeoJSON) {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  if (source) source.setData(data);
}

function fitSite(map: MapLibreMap, site: Site) {
  if (site.source === "demo") {
    map.easeTo({ center: [site.center.lon, site.center.lat], zoom: 15.65, pitch: 66, bearing: -26, duration: 1100 });
    return;
  }
  if (site.boundary.length < 3) {
    map.easeTo({ center: [site.center.lon, site.center.lat], zoom: 16.2, pitch: 66, bearing: -26, duration: 1100 });
    return;
  }
  const extent = bbox(siteGeoJson(site));
  map.fitBounds(
    [[extent[0], extent[1]], [extent[2], extent[3]]],
    { padding: 82, pitch: 66, bearing: -26, maxZoom: 16.8, duration: 1100 },
  );
}

function cameraState(map: MapLibreMap): ConceptCameraState {
  const center = map.getCenter();
  return {
    center: { lon: center.lng, lat: center.lat },
    zoom: map.getZoom(),
    bearingDeg: map.getBearing(),
    pitchDeg: map.getPitch(),
  };
}

async function captureMapSnapshot(map: MapLibreMap): Promise<Blob | undefined> {
  try {
    map.triggerRepaint();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const canvas = map.getCanvas();
    return await new Promise<Blob | undefined>((resolve) => {
      try {
        canvas.toBlob((blob) => resolve(blob ?? undefined), "image/png");
      } catch {
        resolve(undefined);
      }
    });
  } catch {
    return undefined;
  }
}

export function SpatialMap({
  site,
  active,
  compare,
  analysisTime,
  mode,
  contextBuildings,
  contextSource,
  viewpoint,
  viewImpactResult,
  onPickSite,
  onMoveMass,
  onSetViewpoint,
  onMapApi,
}: {
  site: Site;
  active?: Scenario;
  compare?: Scenario;
  analysisTime: string;
  mode: InteractionMode;
  contextBuildings: FeatureCollection<Polygon | MultiPolygon>;
  contextSource: string;
  viewpoint?: Viewpoint;
  viewImpactResult?: ViewImpactResult;
  onPickSite: (point: GeoPoint) => void;
  onMoveMass: (point: GeoPoint) => void;
  onSetViewpoint: (point: GeoPoint) => void;
  onMapApi?: (api: SpatialMapApi | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapLibreOverlay | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const modeRef = useRef(mode);
  const onPickSiteRef = useRef(onPickSite);
  const onMoveMassRef = useRef(onMoveMass);
  const onSetViewpointRef = useRef(onSetViewpoint);
  const onMapApiRef = useRef(onMapApi);

  modeRef.current = mode;
  onPickSiteRef.current = onPickSite;
  onMoveMassRef.current = onMoveMass;
  onSetViewpointRef.current = onSetViewpoint;
  onMapApiRef.current = onMapApi;

  const solar = useMemo(() => {
    const date = analysisTime.slice(0, 10);
    const minutes = minutesFromTime(analysisTime.slice(11, 16));
    return solarPositionAt(date, minutes, site.center.lat, site.center.lon);
  }, [analysisTime, site.center.lat, site.center.lon]);

  const scene = useMemo(() => {
    const activeShadow = active
      ? computeShadowPolygon(active.mass, site.center, analysisTime, 540)
      : undefined;
    const compareShadow = compare
      ? computeShadowPolygon(compare.mass, site.center, analysisTime, 540)
      : undefined;

    const buildingFeatures: Feature[] = [];
    if (active) buildingFeatures.push(scenarioFeature(active, site, "active"));
    if (compare) buildingFeatures.push(scenarioFeature(compare, site, "compare"));

    const shadowFeatures: Feature[] = [];
    const activeShadowFeature = activeShadow ? shadowFeature(activeShadow.points, site, "active-shadow") : undefined;
    const compareShadowFeature = compareShadow ? shadowFeature(compareShadow.points, site, "compare-shadow") : undefined;
    if (activeShadowFeature) shadowFeatures.push(activeShadowFeature);
    if (compareShadowFeature) shadowFeatures.push(compareShadowFeature);

    return {
      site: siteGeoJson(site),
      buildings: featureCollection(buildingFeatures),
      shadows: featureCollection(shadowFeatures),
      analysisPoints: viewpoint
        ? featureCollection([point([viewpoint.point.lon, viewpoint.point.lat], { kind: "viewpoint" })])
        : featureCollection([]),
    };
  }, [active, analysisTime, compare, site, viewpoint]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: baseStyle,
      center: [site.center.lon, site.center.lat],
      zoom: 15.65,
      pitch: 66,
      bearing: -26,
      maxPitch: 75,
      attributionControl: false,
      canvasContextAttributes: {
        antialias: true,
        preserveDrawingBuffer: true,
      },
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      map.addSource("terrain-dem", {
        type: "raster-dem",
        tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 15,
        encoding: "terrarium",
      });
      map.setTerrain({ source: "terrain-dem", exaggeration: 1.25 });
      map.addLayer({
        id: "terrain-hillshade",
        type: "hillshade",
        source: "terrain-dem",
        paint: {
          "hillshade-exaggeration": 0.24,
          "hillshade-shadow-color": "#071015",
          "hillshade-highlight-color": "#dfe7e9",
          "hillshade-accent-color": "#5b6b73",
        },
      });

      map.addSource("site", { type: "geojson", data: scene.site });
      map.addLayer({
        id: "site-fill",
        type: "fill",
        source: "site",
        filter: ["==", ["get", "kind"], "site"],
        paint: { "fill-color": "#53d6c7", "fill-opacity": 0.10 },
      });
      map.addLayer({
        id: "site-line",
        type: "line",
        source: "site",
        filter: ["==", ["get", "kind"], "site"],
        paint: { "line-color": "#66e1d4", "line-width": 3 },
      });

      map.addSource("analysis-points", { type: "geojson", data: scene.analysisPoints });
      map.addLayer({
        id: "viewpoint-marker",
        type: "circle",
        source: "analysis-points",
        filter: ["==", ["get", "kind"], "viewpoint"],
        paint: {
          "circle-radius": 7,
          "circle-color": "#7f9df4",
          "circle-stroke-width": 3,
          "circle-stroke-color": "#f4f7f9",
        },
      });

      map.addSource("context-buildings", { type: "geojson", data: emptyContextBuildings });
      map.addLayer({
        id: "context-buildings",
        type: "fill-extrusion",
        source: "context-buildings",
        minzoom: 13,
        paint: {
          "fill-extrusion-color": [
            "interpolate",
            ["linear"],
            ["coalesce", ["get", "heightM"], 9],
            0, "#56616a",
            15, "#6f7b84",
            40, "#8e9aa3",
            80, "#b0bac1",
          ],
          "fill-extrusion-height": ["coalesce", ["get", "heightM"], 9],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.72,
          "fill-extrusion-vertical-gradient": true,
        },
      });

      map.addSource("shadows", { type: "geojson", data: scene.shadows });
      map.addLayer({
        id: "shadow-fill",
        type: "fill",
        source: "shadows",
        paint: {
          "fill-color": [
            "case",
            ["==", ["get", "kind"], "compare-shadow"],
            "#7f9df4",
            "#0b1116",
          ],
          "fill-opacity": [
            "case",
            ["==", ["get", "kind"], "compare-shadow"],
            0.18,
            0.34,
          ],
        },
      });

      map.addSource("buildings", { type: "geojson", data: scene.buildings });
      map.addLayer({
        id: "planned-buildings",
        type: "fill-extrusion",
        source: "buildings",
        paint: {
          "fill-extrusion-color": [
            "case",
            ["==", ["get", "kind"], "compare"],
            "#7f9df4",
            "#53d6c7",
          ],
          "fill-extrusion-height": ["get", "heightM"],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.82,
          "fill-extrusion-vertical-gradient": true,
        },
      });

      const visualizationOverlay = new MapLibreOverlay({
        interleaved: false,
        layers: [],
      });
      map.addControl(visualizationOverlay);
      overlayRef.current = visualizationOverlay;

      fitSite(map, site);
      setMapReady(true);
      onMapApiRef.current?.({
        getCameraState: () => cameraState(map),
        captureSnapshot: () => captureMapSnapshot(map),
      });
    });

    map.on("click", (event: MapMouseEvent) => {
      const point = { lon: event.lngLat.lng, lat: event.lngLat.lat };
      if (modeRef.current === "pick-site") onPickSiteRef.current(point);
      if (modeRef.current === "move-mass") onMoveMassRef.current(point);
      if (modeRef.current === "viewpoint") onSetViewpointRef.current(point);
    });

    mapRef.current = map;
    return () => {
      onMapApiRef.current?.(null);
      overlayRef.current = null;
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.isStyleLoaded()) return;
    setGeoJson(map, "site", scene.site);
    setGeoJson(map, "buildings", scene.buildings);
    setGeoJson(map, "shadows", scene.shadows);
    setGeoJson(map, "analysis-points", scene.analysisPoints);
  }, [mapReady, scene]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.isStyleLoaded()) return;
    fitSite(map, site);
  }, [mapReady, site.id]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.isStyleLoaded()) return;
    setGeoJson(map, "context-buildings", contextBuildings);
  }, [contextBuildings, mapReady]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !mapReady) return;
    overlay.setProps({
      layers: buildVisualizationLayers({
        site,
        active,
        viewpoint,
        viewImpact: viewImpactResult,
        sunAzimuthDeg: solar.azimuthDeg,
      }),
    });
  }, [active, mapReady, site, solar.azimuthDeg, viewpoint, viewImpactResult]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.isStyleLoaded() || !map.getLayer("planned-buildings")) return;
    const activeColor = !viewImpactResult?.supported
      ? "#53d6c7"
      : viewImpactResult.visibleRatioPct < 25
        ? "#ef6868"
        : viewImpactResult.visibleRatioPct < 75
          ? "#d8ad58"
          : "#53d6c7";
    map.setPaintProperty("planned-buildings", "fill-extrusion-color", [
      "case",
      ["==", ["get", "kind"], "compare"],
      "#7f9df4",
      activeColor,
    ]);
  }, [mapReady, viewImpactResult]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.isStyleLoaded()) return;
    const polar = Math.max(5, Math.min(100, 90 - solar.altitudeDeg));
    map.setLight({
      anchor: "map",
      color: solar.isDaylight ? "#fff9e8" : "#71819a",
      intensity: solar.isDaylight ? 0.72 : 0.28,
      position: [1.5, solar.azimuthDeg, polar],
    });
    if (map.getLayer("terrain-hillshade")) {
      map.setPaintProperty("terrain-hillshade", "hillshade-illumination-direction", solar.azimuthDeg);
    }
  }, [mapReady, solar]);

  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (!canvas) return;
    canvas.style.cursor = mode === "inspect" ? "grab" : "crosshair";
  }, [mode]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute left-3 top-3 rounded-xl border border-white/10 bg-[#101820]/90 px-3 py-2 shadow-lg backdrop-blur-sm">
        <div className="text-[10px] font-bold text-[var(--primary)]">
          {site.source === "manual-point" ? "임시 위치 경계" : "선택 부지"}
        </div>
        <div className="mt-0.5 max-w-[260px] truncate text-xs font-semibold text-white">
          {site.address || site.name}
        </div>
        <div className="mt-1 text-[9px] text-[#8f9ca7]">
          {contextSource} · 주변 건물 {contextBuildings.features.length.toLocaleString()}개
        </div>
      </div>
    </div>
  );
}
