"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { featureCollection, point } from "@turf/turf";
import type { Feature, Point } from "geojson";
import type { PlaySafeSnapshot } from "@/src/playsafe";

const baseStyle: StyleSpecification = {
  version: 8,
  name: "PlaySafe Base",
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
    {
      id: "osm",
      type: "raster",
      source: "osm",
      paint: {
        "raster-saturation": -0.55,
        "raster-brightness-max": 0.70,
        "raster-contrast": 0.08,
      },
    },
  ],
  light: {
    anchor: "map",
    color: "#fff4df",
    intensity: 0.70,
    position: [1.5, 180, 48],
  },
};

function setGeoJson(map: MapLibreMap, id: string, data: GeoJSON.GeoJSON) {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  if (source) source.setData(data);
}

export function PlaySafeMap({
  snapshot,
  selectedPlaceId,
  onSelectPlace,
}: {
  snapshot: PlaySafeSnapshot;
  selectedPlaceId?: string;
  onSelectPlace: (placeId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const avatarRef = useRef<maplibregl.Marker | null>(null);
  const onSelectRef = useRef(onSelectPlace);
  onSelectRef.current = onSelectPlace;

  const selected = snapshot.assessments.find((item) => item.place.id === selectedPlaceId)
    ?? snapshot.assessments[0];

  const placesGeoJson = useMemo(() => featureCollection(
    snapshot.assessments.map((assessment) => point(
      [assessment.place.point.lon, assessment.place.point.lat],
      {
        id: assessment.place.id,
        name: assessment.place.name,
        kind: assessment.place.kind,
        fitScore: Math.round(assessment.fitScore),
      },
    )),
  ), [snapshot.assessments]);

  const heatGeoJson = useMemo(() => featureCollection(
    (selected?.heatSamples ?? []).map((sample, index) => point(
      [sample.point.lon, sample.point.lat],
      {
        id: index,
        shaded: sample.shaded ? 1 : 0,
        exposurePct: Math.round(sample.exposurePct),
      },
    )),
  ), [selected]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: baseStyle,
      center: [snapshot.query.center.lon, snapshot.query.center.lat],
      zoom: 15.0,
      pitch: 62,
      bearing: -24,
      maxPitch: 75,
      attributionControl: false,
      canvasContextAttributes: { antialias: true },
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      map.addSource("terrain-dem", {
        type: "raster-dem",
        tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 15,
        encoding: "terrarium",
      });
      map.setTerrain({ source: "terrain-dem", exaggeration: 1.2 });
      map.addLayer({
        id: "terrain-hillshade",
        type: "hillshade",
        source: "terrain-dem",
        paint: {
          "hillshade-exaggeration": 0.22,
          "hillshade-shadow-color": "#071015",
          "hillshade-highlight-color": "#dfe7e9",
          "hillshade-accent-color": "#5b6b73",
        },
      });

      map.addSource("context-buildings", {
        type: "geojson",
        data: snapshot.buildings,
      });
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
            0, "#59636b",
            15, "#707c84",
            40, "#8c979f",
            80, "#afb7bc",
          ],
          "fill-extrusion-height": ["coalesce", ["get", "heightM"], 9],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.62,
          "fill-extrusion-vertical-gradient": true,
        },
      });

      map.addSource("heat-samples", { type: "geojson", data: heatGeoJson });
      map.addLayer({
        id: "heat-samples",
        type: "circle",
        source: "heat-samples",
        paint: {
          "circle-radius": 16,
          "circle-blur": 0.45,
          "circle-opacity": 0.58,
          "circle-color": [
            "interpolate",
            ["linear"],
            ["get", "exposurePct"],
            0, "#43d6bd",
            45, "#f2c45d",
            75, "#ef8c57",
            100, "#e85f69",
          ],
        },
      });

      map.addSource("playsafe-places", { type: "geojson", data: placesGeoJson });
      map.addLayer({
        id: "playsafe-place-halo",
        type: "circle",
        source: "playsafe-places",
        paint: {
          "circle-radius": 16,
          "circle-opacity": 0.18,
          "circle-color": [
            "interpolate",
            ["linear"],
            ["get", "fitScore"],
            0, "#e85f69",
            50, "#f2c45d",
            78, "#43d6bd",
            100, "#43d6bd",
          ],
        },
      });
      map.addLayer({
        id: "playsafe-places",
        type: "circle",
        source: "playsafe-places",
        paint: {
          "circle-radius": 7,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#f5f8fa",
          "circle-color": [
            "interpolate",
            ["linear"],
            ["get", "fitScore"],
            0, "#e85f69",
            50, "#f2c45d",
            78, "#43d6bd",
            100, "#43d6bd",
          ],
        },
      });
      map.addLayer({
        id: "playsafe-labels",
        type: "symbol",
        source: "playsafe-places",
        layout: {
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-offset": [0, 1.5],
          "text-anchor": "top",
          "text-max-width": 12,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#0b1116",
          "text-halo-width": 1.5,
        },
      });

      map.on("click", "playsafe-places", (event) => {
        const feature = event.features?.[0] as Feature<Point> | undefined;
        const id = String(feature?.properties?.id || "");
        if (id) onSelectRef.current(id);
      });
      map.on("mouseenter", "playsafe-places", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "playsafe-places", () => {
        map.getCanvas().style.cursor = "grab";
      });

      mapRef.current = map;
      setMapReady(true);
    });

    return () => {
      avatarRef.current?.remove();
      avatarRef.current = null;
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.isStyleLoaded()) return;
    setGeoJson(map, "context-buildings", snapshot.buildings);
    setGeoJson(map, "playsafe-places", placesGeoJson);
    setGeoJson(map, "heat-samples", heatGeoJson);
  }, [heatGeoJson, mapReady, placesGeoJson, snapshot.buildings]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !selected) return;

    map.easeTo({
      center: [selected.place.point.lon, selected.place.point.lat],
      zoom: 16.8,
      pitch: 62,
      bearing: -24,
      duration: 900,
    });

    const element = document.createElement("div");
    element.setAttribute("aria-label", `${snapshot.query.childAge}세 아이 위치`);
    element.textContent = "🧒";
    Object.assign(element.style, {
      width: "38px",
      height: "38px",
      display: "grid",
      placeItems: "center",
      borderRadius: "999px",
      background: "rgba(10,18,24,.92)",
      border: "2px solid #f4f7f9",
      boxShadow: "0 8px 24px rgba(0,0,0,.35)",
      fontSize: "22px",
    });

    avatarRef.current?.remove();
    avatarRef.current = new maplibregl.Marker({ element, anchor: "bottom" })
      .setLngLat([selected.place.point.lon, selected.place.point.lat])
      .addTo(map);
  }, [mapReady, selected, snapshot.query.childAge]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute right-3 top-3 rounded-2xl border border-white/10 bg-[#101820]/92 px-3 py-2 text-right shadow-xl backdrop-blur-sm">
        <div className="text-[10px] font-bold text-[#f0bb62]">PLAYSAFE HEAT VIEW</div>
        <div className="mt-1 text-sm font-extrabold">
          {snapshot.weather.apparentTemperatureC.toFixed(1)}°C 체감
        </div>
        <div className="text-[9px] text-[#92a0ab]">
          기온 {snapshot.weather.temperatureC.toFixed(1)}° · 습도 {snapshot.weather.relativeHumidityPct.toFixed(0)}%
        </div>
      </div>
    </div>
  );
}
