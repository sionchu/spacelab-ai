import type { Feature, FeatureCollection, Point, Polygon } from "geojson";
import { featureCollection, point, polygon } from "@turf/turf";
import { localPointToGeo, rotatedFootprintPoints } from "@/src/model";
import type { Scenario, Site } from "@/src/types";

function closeRing(points: number[][]) {
  if (!points.length) return points;
  const first = points[0];
  const last = points[points.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? points : [...points, first];
}

export function siteGeoJson(site: Site): FeatureCollection {
  const boundary = closeRing(site.boundary.map((p) => [p.lon, p.lat]));
  const features: Array<Feature<Polygon | Point>> = [];
  if (boundary.length >= 4) {
    features.push(polygon([boundary], {
      kind: "site",
      name: site.name,
      pnu: site.pnu ?? "",
    }));
  }
  features.push(point([site.center.lon, site.center.lat], {
    kind: "site-center",
    name: "선택 부지",
  }));
  return featureCollection(features);
}

export function scenarioFeature(scenario: Scenario, site: Site, kind: "active" | "compare") {
  const coords = rotatedFootprintPoints(scenario.mass).map((local) => {
    const geo = localPointToGeo(site.center, {
      xM: local.xM + scenario.mass.position.eastM,
      yM: local.yM + scenario.mass.position.northM,
    });
    return [geo.lon, geo.lat];
  });
  return polygon([closeRing(coords)], {
    kind,
    scenarioId: scenario.id,
    heightM: scenario.mass.heightM,
    floors: scenario.mass.floors,
  });
}

export function shadowFeature(
  points: Array<{ xM: number; yM: number }>,
  site: Site,
  kind: "active-shadow" | "compare-shadow",
) {
  if (points.length < 3) return undefined;
  const coords = points.map((local) => {
    const geo = localPointToGeo(site.center, local);
    return [geo.lon, geo.lat];
  });
  return polygon([closeRing(coords)], { kind });
}
