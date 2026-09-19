"use client";

import { useEffect, useMemo, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent, StyleSpecification } from "maplibre-gl";
import { bbox, featureCollection } from "@turf/turf";
import type { Feature } from "geojson";
import { computeShadowPolygon } from "@/src/model";
import type { GeoPoint, Scenario, Site } from "@/src/types";
import { scenarioFeature, shadowFeature, siteGeoJson } from "@/lib/spatial/geojson";
import { solarPositionAt } from "@/lib/solar/sun";

type InteractionMode = "inspect" | "pick-site" | "move-mass";

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
    { id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.35, "raster-brightness-max": 0.76 } },
  ],
  light: {
    anchor: "map",
    color: "#ffffff",
    intensity: 0.55,
    position: [1.5, 180, 55],
  },
};

function setGeoJson(map: MapLibreMap, id: string, data: GeoJSON.GeoJSON) {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  if (source) source.setData(data);
}

function fitSite(map: MapLibreMap, site: Site) {
  if (site.boundary.length < 3) {
    map.easeTo({ center: [site.center.lon, site.center.lat], zoom: 16.5, pitch: 55, duration: 700 });
    return;
  }
  const extent = bbox(siteGeoJson(site));
  map.fitBounds(
    [[extent[0], extent[1]], [extent[2], extent[3]]],
    { padding: 90, pitch: 55, bearing: -18, maxZoom: 18.2, duration: 700 },
  );
}

export function SpatialMap({
  site,
  active,
  compare,
  date,
  minutes,
  mode,
  onPickSite,
  onMoveMass,
}: {
  site: Site;
  active?: Scenario;
  compare?: Scenario;
  date: string;
  minutes: number;
  mode: InteractionMode;
  onPickSite: (point: GeoPoint) => void;
  onMoveMass: (point: GeoPoint) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  const scene = useMemo(() => {
    const activeShadow = active
      ? computeShadowPolygon(active.mass, site.center, date + "T" + String(Math.floor(minutes / 60)).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0"), 540)
      : undefined;
    const compareShadow = compare
      ? computeShadowPolygon(compare.mass, site.center, date + "T" + String(Math.floor(minutes / 60)).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0"), 540)
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
    };
  }, [active, compare, date, minutes, site]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: baseStyle,
      center: [site.center.lon, site.center.lat],
      zoom: 15.8,
      pitch: 55,
      bearing: -18,
      maxPitch: 75,
      attributionControl: false,
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
      map.setTerrain({ source: "terrain-dem", exaggeration: 1.15 });
      map.addLayer({
        id: "terrain-hillshade",
        type: "hillshade",
        source: "terrain-dem",
        paint: {
          "hillshade-exaggeration": 0.18,
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

      fitSite(map, site);
    });

    map.on("click", (event: MapMouseEvent) => {
      const point = { lon: event.lngLat.lng, lat: event.lngLat.lat };
      if (mode === "pick-site") onPickSite(point);
      if (mode === "move-mass") onMoveMass(point);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    setGeoJson(map, "site", scene.site);
    setGeoJson(map, "buildings", scene.buildings);
    setGeoJson(map, "shadows", scene.shadows);
  }, [scene]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    fitSite(map, site);
  }, [site.id]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const sun = solarPositionAt(date, minutes, site.center.lat, site.center.lon);
    const polar = Math.max(5, Math.min(100, 90 - sun.altitudeDeg));
    map.setLight({
      anchor: "map",
      color: sun.isDaylight ? "#fff9e8" : "#71819a",
      intensity: sun.isDaylight ? 0.62 : 0.22,
      position: [1.5, sun.azimuthDeg, polar],
    });
    if (map.getLayer("terrain-hillshade")) {
      map.setPaintProperty("terrain-hillshade", "hillshade-illumination-direction", sun.azimuthDeg);
    }
  }, [date, minutes, site.center.lat, site.center.lon]);

  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (!canvas) return;
    canvas.style.cursor = mode === "inspect" ? "grab" : "crosshair";
  }, [mode]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute left-3 top-3 rounded-xl border border-white/10 bg-[#101820]/90 px-3 py-2 shadow-lg backdrop-blur-sm">
        <div className="text-[10px] font-bold text-[var(--primary)]">선택 부지</div>
        <div className="mt-0.5 max-w-[260px] truncate text-xs font-semibold text-white">
          {site.address || site.name}
        </div>
      </div>
    </div>
  );
}
