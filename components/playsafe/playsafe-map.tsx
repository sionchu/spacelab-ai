"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { featureCollection, lineString, point, polygon } from "@turf/turf";
import type { Feature, Point } from "geojson";
import {
  playSafeShadowPolygons,
  type PlaySafeMapViewAction,
  type PlaySafeSnapshot,
  type PlaySafeWalkingRoute,
} from "@/src/playsafe";

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

function routeParts(route: PlaySafeWalkingRoute) {
  return route.segments.length
    ? route.segments
    : [{ kind: "unknown" as const, points: route.points, distanceM: route.distanceM }];
}

function partialRoutePoints(points: Array<{ lon: number; lat: number }>, progress: number) {
  if (points.length < 2) return points;
  const clamped = Math.max(0, Math.min(1, progress));
  const scaled = clamped * (points.length - 1);
  const index = Math.min(points.length - 2, Math.floor(scaled));
  const local = scaled - index;
  const result = points.slice(0, index + 1);
  const from = points[index];
  const to = points[index + 1];
  result.push({ lon: from.lon + (to.lon - from.lon) * local, lat: from.lat + (to.lat - from.lat) * local });
  return result;
}

function routeGeoJsonAtProgress(route: PlaySafeWalkingRoute, progress: number) {
  const parts = routeParts(route).filter((segment) => segment.points.length >= 2);
  const weights = parts.map((segment) => Math.max(1, segment.distanceM || segment.points.length - 1));
  const total = Math.max(1, weights.reduce((sum, value) => sum + value, 0));
  let offset = 0;

  return featureCollection(parts.flatMap((segment, index) => {
    const weight = weights[index];
    const localProgress = (progress * total - offset) / weight;
    offset += weight;
    if (localProgress <= 0) return [];
    const points = partialRoutePoints(segment.points, localProgress);
    if (points.length < 2) return [];
    return [lineString(points.map((item) => [item.lon, item.lat]), { kind: segment.kind })];
  }));
}

function routePointAtProgress(points: Array<{ lon: number; lat: number }>, progress: number) {
  const partial = partialRoutePoints(points, progress);
  return partial[partial.length - 1] ?? points[0];
}

export function PlaySafeMap({
  snapshot,
  selectedPlaceId,
  previewAt,
  viewAction,
  walkingRoute,
  onSelectPlace,
}: {
  snapshot: PlaySafeSnapshot;
  selectedPlaceId?: string;
  previewAt: string;
  viewAction?: PlaySafeMapViewAction;
  walkingRoute?: PlaySafeWalkingRoute;
  onSelectPlace: (placeId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const avatarRef = useRef<maplibregl.Marker | null>(null);
  const routeAnimationFrameRef = useRef<number | undefined>(undefined);
  const ambientAnimationFrameRef = useRef<number | undefined>(undefined);
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
        selected: assessment.place.id === selectedPlaceId ? 1 : 0,
      },
    )),
  ), [selectedPlaceId, snapshot.assessments]);

  const treesGeoJson = useMemo(() => featureCollection(
    snapshot.trees.map((tree, index) => point(
      [tree.point.lon, tree.point.lat],
      { id: index, heightM: tree.heightM, crownRadiusM: tree.crownRadiusM },
    )),
  ), [snapshot.trees]);

  const selectedBoundaryGeoJson = useMemo(() => {
    const boundary = selected?.place.boundary;
    if (!boundary || boundary.length < 3) return featureCollection([]);
    const ring = boundary.map((item) => [item.lon, item.lat]);
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
    return featureCollection([polygon([ring], { id: selected.place.id })]);
  }, [selected]);

  const shadowGeoJson = useMemo(() => {
    if (!selected) return featureCollection([]);
    const shadows = playSafeShadowPolygons(
      selected.place,
      snapshot.buildings,
      snapshot.trees,
      previewAt,
    );
    return featureCollection(shadows.flatMap((shadow, index) => {
      if (shadow.length < 3) return [];
      const ring = shadow.map((item) => [item.lon, item.lat]);
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
      return [polygon([ring], { id: index })];
    }));
  }, [previewAt, selected, snapshot.buildings, snapshot.trees]);

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

  const routeGeoJson = useMemo(
    () => walkingRoute ? routeGeoJsonAtProgress(walkingRoute, 1) : featureCollection([]),
    [walkingRoute],
  );

  const routeSignalsGeoJson = useMemo(() => featureCollection([
    ...(walkingRoute?.childZones ?? []).map((item) => point(
      [item.point.lon, item.point.lat],
      { kind: "zone", name: item.name },
    )),
    ...(walkingRoute?.childAccidentHotspots ?? []).map((item) => point(
      [item.point.lon, item.point.lat],
      { kind: "accident", name: item.name },
    )),
    ...(walkingRoute?.toilets ?? []).map((item) => point(
      [item.point.lon, item.point.lat],
      { kind: "toilet", name: item.name },
    )),
  ]), [walkingRoute]);

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

      map.addSource("playsafe-trees", { type: "geojson", data: treesGeoJson });
      map.addLayer({
        id: "playsafe-trees",
        type: "circle",
        source: "playsafe-trees",
        paint: {
          "circle-radius": 3.5,
          "circle-color": "#55c77a",
          "circle-opacity": 0.82,
          "circle-stroke-width": 1,
          "circle-stroke-color": "#d6f5dc",
        },
      });

      map.addSource("playsafe-route", { type: "geojson", data: routeGeoJson });
      map.addLayer({
        id: "playsafe-route",
        type: "line",
        source: "playsafe-route",
        paint: {
          "line-color": [
            "match",
            ["get", "kind"],
            "road-sidewalk", "#7f9df4",
            "shared-road", "#f2c45d",
            "unknown", "#8fa0aa",
            "#53d6c7",
          ],
          "line-width": 5,
          "line-opacity": 0.92,
          "line-blur": 0.25,
        },
      });

      map.addSource("playsafe-route-flow", { type: "geojson", data: featureCollection([]) });
      map.addLayer({
        id: "playsafe-route-flow",
        type: "circle",
        source: "playsafe-route-flow",
        paint: {
          "circle-radius": 4.5,
          "circle-color": "#9af0e6",
          "circle-stroke-color": "#071015",
          "circle-stroke-width": 1.5,
          "circle-opacity": 0.95,
        },
      });

      map.addSource("playsafe-route-signals", { type: "geojson", data: routeSignalsGeoJson });
      map.addLayer({
        id: "playsafe-route-signals",
        type: "circle",
        source: "playsafe-route-signals",
        paint: {
          "circle-radius": [
            "match",
            ["get", "kind"],
            "accident", 6,
            "zone", 5,
            4,
          ],
          "circle-color": [
            "match",
            ["get", "kind"],
            "accident", "#ef9d8b",
            "zone", "#d9bd63",
            "toilet", "#7f9df4",
            "#ffffff",
          ],
          "circle-stroke-color": "#f5f8fa",
          "circle-stroke-width": 1.5,
          "circle-opacity": 0.92,
        },
      });

      map.addSource("selected-place-boundary", { type: "geojson", data: selectedBoundaryGeoJson });
      map.addLayer({
        id: "selected-place-boundary-fill",
        type: "fill",
        source: "selected-place-boundary",
        paint: {
          "fill-color": "#53d6c7",
          "fill-opacity": 0.10,
        },
      });
      map.addLayer({
        id: "selected-place-boundary-line",
        type: "line",
        source: "selected-place-boundary",
        paint: {
          "line-color": "#77e6d8",
          "line-width": 2.5,
          "line-opacity": 0.9,
        },
      });

      map.addSource("playsafe-shadows", { type: "geojson", data: shadowGeoJson });
      map.addLayer({
        id: "playsafe-shadows",
        type: "fill",
        source: "playsafe-shadows",
        paint: {
          "fill-color": "#071015",
          "fill-opacity": 0.30,
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
      if (routeAnimationFrameRef.current !== undefined) {
        window.cancelAnimationFrame(routeAnimationFrameRef.current);
        routeAnimationFrameRef.current = undefined;
      }
      if (ambientAnimationFrameRef.current !== undefined) {
        window.cancelAnimationFrame(ambientAnimationFrameRef.current);
        ambientAnimationFrameRef.current = undefined;
      }
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
    setGeoJson(map, "playsafe-trees", treesGeoJson);
    setGeoJson(map, "selected-place-boundary", selectedBoundaryGeoJson);
    setGeoJson(map, "playsafe-places", placesGeoJson);
    setGeoJson(map, "heat-samples", heatGeoJson);
  }, [heatGeoJson, mapReady, placesGeoJson, selectedBoundaryGeoJson, snapshot.buildings, treesGeoJson]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.isStyleLoaded()) return;
    setGeoJson(map, "playsafe-shadows", shadowGeoJson);
  }, [mapReady, shadowGeoJson]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.isStyleLoaded()) return;

    if (routeAnimationFrameRef.current !== undefined) {
      window.cancelAnimationFrame(routeAnimationFrameRef.current);
      routeAnimationFrameRef.current = undefined;
    }
    setGeoJson(map, "playsafe-route-signals", routeSignalsGeoJson);

    if (!walkingRoute || walkingRoute.points.length < 2) {
      setGeoJson(map, "playsafe-route", routeGeoJson);
      return;
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setGeoJson(map, "playsafe-route", routeGeoJson);
      avatarRef.current?.setLngLat([walkingRoute.end.lon, walkingRoute.end.lat]);
      return;
    }

    setGeoJson(map, "playsafe-route", featureCollection([]));
    const first = walkingRoute.points[0];
    avatarRef.current?.setLngLat([first.lon, first.lat]);
    const startedAt = performance.now();
    const durationMs = 1_050;

    const tick = (now: number) => {
      const raw = Math.min(1, (now - startedAt) / durationMs);
      const progress = 1 - Math.pow(1 - raw, 3);
      setGeoJson(map, "playsafe-route", routeGeoJsonAtProgress(walkingRoute, progress));
      const walker = routePointAtProgress(walkingRoute.points, progress);
      if (walker) avatarRef.current?.setLngLat([walker.lon, walker.lat]);

      if (raw < 1) {
        routeAnimationFrameRef.current = window.requestAnimationFrame(tick);
      } else {
        routeAnimationFrameRef.current = undefined;
        setGeoJson(map, "playsafe-route", routeGeoJson);
      }
    };

    routeAnimationFrameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (routeAnimationFrameRef.current !== undefined) {
        window.cancelAnimationFrame(routeAnimationFrameRef.current);
        routeAnimationFrameRef.current = undefined;
      }
    };
  }, [mapReady, routeGeoJson, routeSignalsGeoJson, walkingRoute]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.isStyleLoaded()) return;

    if (ambientAnimationFrameRef.current !== undefined) {
      window.cancelAnimationFrame(ambientAnimationFrameRef.current);
      ambientAnimationFrameRef.current = undefined;
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      map.setPaintProperty("playsafe-place-halo", "circle-radius", [
        "case", ["==", ["get", "selected"], 1], 20, 14,
      ]);
      map.setPaintProperty("playsafe-place-halo", "circle-opacity", [
        "case", ["==", ["get", "selected"], 1], 0.22, 0.12,
      ]);
      setGeoJson(map, "playsafe-route-flow", featureCollection([]));
      return;
    }

    const tick = (now: number) => {
      const wave = (Math.sin(now / 520) + 1) / 2;
      map.setPaintProperty("playsafe-place-halo", "circle-radius", [
        "case", ["==", ["get", "selected"], 1], 18 + wave * 8, 14,
      ]);
      map.setPaintProperty("playsafe-place-halo", "circle-opacity", [
        "case", ["==", ["get", "selected"], 1], 0.12 + wave * 0.16, 0.10,
      ]);

      if (walkingRoute?.points.length && walkingRoute.points.length >= 2) {
        const progress = (now % 4_200) / 4_200;
        const flowPoint = routePointAtProgress(walkingRoute.points, progress);
        setGeoJson(
          map,
          "playsafe-route-flow",
          flowPoint
            ? featureCollection([point([flowPoint.lon, flowPoint.lat])])
            : featureCollection([]),
        );
      } else {
        setGeoJson(map, "playsafe-route-flow", featureCollection([]));
      }

      ambientAnimationFrameRef.current = window.requestAnimationFrame(tick);
    };

    ambientAnimationFrameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (ambientAnimationFrameRef.current !== undefined) {
        window.cancelAnimationFrame(ambientAnimationFrameRef.current);
        ambientAnimationFrameRef.current = undefined;
      }
    };
  }, [mapReady, selectedPlaceId, walkingRoute]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !selected) return;

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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !viewAction) return;

    if (viewAction.type === "route" && walkingRoute?.points.length) {
      const bounds = new maplibregl.LngLatBounds();
      walkingRoute.points.forEach((item) => bounds.extend([item.lon, item.lat]));
      const wide = map.getContainer().clientWidth >= 760;
      map.fitBounds(bounds, {
        padding: wide
          ? { top: 90, right: 90, bottom: 90, left: 450 }
          : { top: 90, right: 40, bottom: 220, left: 40 },
        maxZoom: 17.2,
        duration: 650,
      });
      return;
    }

    const target = viewAction.type === "top"
      ? selected?.place.point ?? snapshot.query.center
      : viewAction.point ?? snapshot.query.center;

    map.easeTo({
      center: [target.lon, target.lat],
      zoom: viewAction.type === "top" ? 17.2 : viewAction.type === "focus" ? 16.8 : 15.2,
      pitch: viewAction.type === "top" ? 0 : 62,
      bearing: viewAction.type === "top" ? 0 : -24,
      duration: 650,
    });
  }, [mapReady, selected, snapshot.query.center, viewAction, walkingRoute]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
