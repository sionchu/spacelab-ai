"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { bbox } from "@turf/turf";
import type { FeatureCollection, Polygon } from "geojson";
import * as maplibregl from "maplibre-gl";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapMouseEvent,
  StyleSpecification,
} from "maplibre-gl";
import { scenarioGeoJson, shadowGeoJson, siteGeoJson } from "@/lib/geojson";
import type { SunState } from "@/lib/sun";
import type { GeoPoint, Scenario, Site } from "@/types";

const emptyBuildings: FeatureCollection<Polygon> = {
  type: "FeatureCollection",
  features: [],
};

function baseStyle(demTileJson: string): StyleSpecification {
  return {
    version: 8,
    name: "SpaceLab map-first",
    light: {
      anchor: "map",
      color: "#fff4dc",
      intensity: 0.5,
      position: [1.5, 180, 45],
    },
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
        attribution: "© OpenStreetMap contributors",
      },
      terrain: {
        type: "raster-dem",
        url: demTileJson,
        tileSize: 256,
      },
      hillshadeDem: {
        type: "raster-dem",
        url: demTileJson,
        tileSize: 256,
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#d9e1e7" },
      },
      {
        id: "osm",
        type: "raster",
        source: "osm",
        paint: {
          "raster-saturation": -0.35,
          "raster-contrast": 0.08,
          "raster-brightness-min": 0.22,
          "raster-brightness-max": 0.9,
        },
      },
      {
        id: "hillshade",
        type: "hillshade",
        source: "hillshadeDem",
        paint: {
          "hillshade-method": "standard",
          "hillshade-exaggeration": 0.28,
          "hillshade-shadow-color": "#0f1720",
          "hillshade-highlight-color": "#f7f4ea",
          "hillshade-accent-color": "#5d6a72",
        },
      },
    ],
  };
}

function setData(map: MapLibreMap, id: string, data: FeatureCollection) {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  if (source) source.setData(data);
}

export type MapInteractionMode = "inspect" | "pick-site" | "move-mass";

export function SpatialMap({
  site,
  scenarios,
  activeScenarioId,
  sun,
  interactionMode,
  onMapClick,
}: {
  site: Site;
  scenarios: Scenario[];
  activeScenarioId?: string;
  sun: SunState;
  interactionMode: MapInteractionMode;
  onMapClick: (point: GeoPoint) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onMapClickRef = useRef(onMapClick);
  const [ready, setReady] = useState(false);
  const [contextBuildings, setContextBuildings] = useState<FeatureCollection<Polygon>>(emptyBuildings);
  const demTileJson = process.env.NEXT_PUBLIC_DEM_TILEJSON
    || "https://demotiles.maplibre.org/terrain-tiles/tiles.json";
  const radius = Number(process.env.NEXT_PUBLIC_BUILDING_CONTEXT_RADIUS_M || 350);

  onMapClickRef.current = onMapClick;

  const siteData = useMemo(() => siteGeoJson(site), [site]);
  const scenarioData = useMemo(
    () => scenarioGeoJson(site, scenarios, activeScenarioId),
    [activeScenarioId, scenarios, site],
  );
  const shadowData = useMemo(() => shadowGeoJson(site, scenarios), [scenarios, site]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: baseStyle(demTileJson),
      center: [site.center.lon, site.center.lat],
      zoom: 16,
      pitch: 58,
      bearing: -18,
      maxPitch: 80,
      attributionControl: false,
      canvasContextAttributes: { antialias: true },
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

    map.on("load", () => {
      map.addSource("context-buildings", { type: "geojson", data: emptyBuildings });
      map.addLayer({
        id: "context-buildings",
        type: "fill-extrusion",
        source: "context-buildings",
        minzoom: 14,
        paint: {
          "fill-extrusion-color": "#8f9aa2",
          "fill-extrusion-height": ["coalesce", ["get", "heightM"], 9],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.48,
        },
      });

      map.addSource("spacelab-shadow", { type: "geojson", data: shadowData });
      map.addLayer({
        id: "spacelab-shadow",
        type: "fill",
        source: "spacelab-shadow",
        paint: {
          "fill-color": "#1f2937",
          "fill-opacity": 0.32,
        },
      });

      map.addSource("spacelab-site", { type: "geojson", data: siteData });
      map.addLayer({
        id: "spacelab-site-fill",
        type: "fill",
        source: "spacelab-site",
        paint: {
          "fill-color": "#28c9bd",
          "fill-opacity": 0.1,
        },
      });
      map.addLayer({
        id: "spacelab-site-line",
        type: "line",
        source: "spacelab-site",
        paint: {
          "line-color": "#39e0d4",
          "line-width": 3,
          "line-opacity": 0.95,
        },
      });

      map.addSource("spacelab-mass", { type: "geojson", data: scenarioData });
      map.addLayer({
        id: "spacelab-mass",
        type: "fill-extrusion",
        source: "spacelab-mass",
        paint: {
          "fill-extrusion-color": [
            "case",
            ["boolean", ["get", "active"], false],
            "#2dd4bf",
            "#8fa8ff",
          ],
          "fill-extrusion-height": ["get", "heightM"],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": [
            "case",
            ["boolean", ["get", "active"], false],
            0.86,
            0.48,
          ],
        },
      });

      map.setTerrain({ source: "terrain", exaggeration: 1.05 });
      setReady(true);
    });

    map.on("click", (event: MapMouseEvent) => {
      onMapClickRef.current({ lon: event.lngLat.lng, lat: event.lngLat.lat });
    });

    return () => {
      setReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, [demTileJson]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    setData(mapRef.current, "spacelab-site", siteData);
    setData(mapRef.current, "spacelab-mass", scenarioData);
    setData(mapRef.current, "spacelab-shadow", shadowData);

    const bounds = bbox(siteData);
    mapRef.current.fitBounds(
      [[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
      { padding: 90, pitch: 58, bearing: -18, maxZoom: 18, duration: 650 },
    );
  }, [ready, scenarioData, shadowData, site.id, siteData]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    setData(mapRef.current, "context-buildings", contextBuildings);
  }, [contextBuildings, ready]);

  useEffect(() => {
    if (site.source === "demo") {
      setContextBuildings(emptyBuildings);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({
      lon: String(site.center.lon),
      lat: String(site.center.lat),
      radius: String(Number.isFinite(radius) ? radius : 350),
    });
    void fetch(`/api/context/buildings?${params}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((data) => {
        if (data?.type === "FeatureCollection") setContextBuildings(data);
      })
      .catch(() => setContextBuildings(emptyBuildings));
    return () => controller.abort();
  }, [radius, site.center.lat, site.center.lon, site.id, site.source]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setLight({
      anchor: "map",
      color: sun.daylight ? "#fff1d1" : "#9fb3cc",
      intensity: sun.daylight ? 0.62 : 0.24,
      position: [1.5, sun.azimuthDeg, sun.polarDeg],
    });
    map.setPaintProperty("hillshade", "hillshade-illumination-direction", sun.azimuthDeg);
    map.setPaintProperty(
      "hillshade",
      "hillshade-illumination-altitude",
      Math.max(0, Math.min(90, sun.altitudeDeg)),
    );
    map.setPaintProperty("osm", "raster-brightness-max", sun.daylight ? 0.9 : 0.58);
  }, [ready, sun]);

  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (!canvas) return;
    canvas.style.cursor = interactionMode === "inspect" ? "grab" : "crosshair";
  }, [interactionMode]);

  return (
    <div className="map-stage">
      <div ref={containerRef} className="maplibre-canvas" />
      <div className="map-source-chip">
        <strong>{ready ? "MapLibre 3D" : "지도 준비 중"}</strong>
        <span>DEM · OSM 건물 · SpaceLab GeoJSON</span>
      </div>
      <div className="map-source-note">주변 건물은 현재 OSM 컨텍스트 · GIS건물통합정보 어댑터 예정</div>
    </div>
  );
}
