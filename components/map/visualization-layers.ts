"use client";

import { PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { viewTargetSamples } from "@/src/analysis";
import { localPointToGeo } from "@/src/model";
import type { Scenario, Site, Viewpoint } from "@/src/types";
import type { ViewImpactResult } from "@/src/view-impact";

type Color = [number, number, number, number];

type VisualizationArgs = {
  site: Site;
  active?: Scenario;
  viewpoint?: Viewpoint;
  viewImpact?: ViewImpactResult;
  sunAzimuthDeg: number;
};

type ViewRay = {
  id: string;
  path: Array<[number, number]>;
  blocked: boolean;
};

type PathDatum = { path: Array<[number, number]> };
type LabelDatum = { position: [number, number]; text: string };

const ACTIVE: Color = [83, 214, 199, 235];
const ACTIVE_GLOW: Color = [83, 214, 199, 72];
const COMPARE: Color = [127, 157, 244, 230];
const BLOCKED: Color = [239, 104, 104, 225];
const PARTIAL: Color = [216, 173, 88, 235];
const SUN: Color = [244, 194, 78, 220];

function massCenter(site: Site, scenario: Scenario) {
  return localPointToGeo(site.center, {
    xM: scenario.mass.position.eastM,
    yM: scenario.mass.position.northM,
  });
}

export function analysisColor(result?: ViewImpactResult): Color {
  if (!result?.supported) return ACTIVE;
  if (result.visibleRatioPct < 25) return BLOCKED;
  if (result.visibleRatioPct < 75) return PARTIAL;
  return ACTIVE;
}

export function buildVisualizationLayers({
  site,
  active,
  viewpoint,
  viewImpact,
  sunAzimuthDeg,
}: VisualizationArgs) {
  const layers = [];

  if (site.boundary.length >= 3) {
    const siteData = [{ polygon: site.boundary.map((point) => [point.lon, point.lat]) }];

    layers.push(
      new PolygonLayer({
        id: "viz-site-glow",
        data: siteData,
        getPolygon: (item: { polygon: number[][] }) => item.polygon,
        filled: true,
        stroked: true,
        getFillColor: [83, 214, 199, 22],
        getLineColor: ACTIVE_GLOW,
        getLineWidth: 12,
        lineWidthUnits: "pixels",
        lineWidthMinPixels: 8,
        pickable: false,
      }),
      new PolygonLayer({
        id: "viz-site-outline",
        data: siteData,
        getPolygon: (item: { polygon: number[][] }) => item.polygon,
        filled: false,
        stroked: true,
        getLineColor: ACTIVE,
        getLineWidth: 3,
        lineWidthUnits: "pixels",
        lineWidthMinPixels: 2,
        pickable: false,
      }),
    );
  }

  const azimuth = (sunAzimuthDeg * Math.PI) / 180;
  const sunEnd = localPointToGeo(site.center, {
    xM: Math.sin(azimuth) * 110,
    yM: Math.cos(azimuth) * 110,
  });
  layers.push(
    new PathLayer<PathDatum>({
      id: "viz-sun-direction",
      data: [{ path: [[site.center.lon, site.center.lat], [sunEnd.lon, sunEnd.lat]] }],
      getPath: (item) => item.path,
      getColor: SUN,
      getWidth: 2.5,
      widthUnits: "pixels",
      widthMinPixels: 2,
      antialiasing: true,
      pickable: false,
    }),
    new TextLayer<LabelDatum>({
      id: "viz-sun-label",
      data: [{ position: [sunEnd.lon, sunEnd.lat], text: "SUN" }],
      getPosition: (item) => item.position,
      getText: (item) => item.text,
      getColor: SUN,
      getSize: 11,
      sizeUnits: "pixels",
      getTextAnchor: "middle",
      getAlignmentBaseline: "center",
      outlineWidth: 2,
      outlineColor: [15, 22, 29, 230],
      billboard: true,
      pickable: false,
    }),
  );

  if (viewpoint) {
    layers.push(
      new ScatterplotLayer({
        id: "viz-viewpoint-halo",
        data: [viewpoint],
        getPosition: (item: Viewpoint) => [item.point.lon, item.point.lat],
        getRadius: 11,
        radiusUnits: "pixels",
        getFillColor: [127, 157, 244, 90],
        stroked: true,
        getLineColor: COMPARE,
        getLineWidth: 2,
        lineWidthUnits: "pixels",
        pickable: false,
      }),
    );
  }

  if (!active) return layers;

  const center = massCenter(site, active);
  const metricColor = analysisColor(viewImpact);
  const metricText = viewImpact?.supported
    ? `${active.id} · ${active.mass.heightM.toFixed(1)}m · 조망 ${viewImpact.visibleRatioPct.toFixed(0)}%`
    : `${active.id} · ${active.mass.heightM.toFixed(1)}m · ${active.mass.floors}층`;

  layers.push(
    new TextLayer<LabelDatum>({
      id: "viz-active-metric",
      data: [{ position: [center.lon, center.lat], text: metricText }],
      getPosition: (item) => item.position,
      getText: (item) => item.text,
      getColor: metricColor,
      getSize: 13,
      sizeUnits: "pixels",
      getTextAnchor: "middle",
      getAlignmentBaseline: "bottom",
      outlineWidth: 3,
      outlineColor: [9, 14, 18, 240],
      billboard: true,
      pickable: false,
    }),
  );

  if (viewpoint && viewImpact?.supported) {
    const blockedIds = new Set(viewImpact.blockedSampleIds);
    const targets = viewTargetSamples(site, active.mass, [0.5, 1]);
    const rays: ViewRay[] = targets.map((target) => ({
      id: target.id,
      blocked: blockedIds.has(target.id),
      path: [
        [viewpoint.point.lon, viewpoint.point.lat],
        [target.point.lon, target.point.lat],
      ],
    }));

    layers.push(
      new PathLayer<ViewRay>({
        id: "viz-view-impact-rays",
        data: rays,
        getPath: (ray) => ray.path,
        getColor: (ray) => ray.blocked ? BLOCKED : ACTIVE,
        getWidth: (ray) => ray.blocked ? 3.4 : 2.2,
        widthUnits: "pixels",
        widthMinPixels: 1.5,
        antialiasing: true,
        pickable: false,
      }),
    );
  }

  return layers;
}
