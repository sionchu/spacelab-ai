import type { Feature, FeatureCollection, Polygon } from "geojson";
import { computeShadowPolygon, localPointToGeo, rotatedFootprintPoints } from "@/model";
import type { Scenario, Site } from "@/types";

function closeRing(coordinates: number[][]) {
  if (!coordinates.length) return coordinates;
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return coordinates;
  return [...coordinates, [...first]];
}

export function siteGeoJson(site: Site): FeatureCollection<Polygon> {
  const ring = closeRing(site.boundary.map((point) => [point.lon, point.lat]));
  const feature: Feature<Polygon> = {
    type: "Feature",
    id: site.id,
    properties: {
      id: site.id,
      name: site.name,
      address: site.address ?? "",
      pnu: site.pnu ?? "",
      selected: true,
    },
    geometry: { type: "Polygon", coordinates: [ring] },
  };
  return { type: "FeatureCollection", features: [feature] };
}

export function scenarioGeoJson(
  site: Site,
  scenarios: Scenario[],
  activeScenarioId?: string,
): FeatureCollection<Polygon> {
  const features = scenarios.map<Feature<Polygon>>((scenario) => {
    const ring = closeRing(rotatedFootprintPoints(scenario.mass).map((point) => {
      const geo = localPointToGeo(site.center, {
        xM: point.xM + scenario.mass.position.eastM,
        yM: point.yM + scenario.mass.position.northM,
      });
      return [geo.lon, geo.lat];
    }));

    return {
      type: "Feature",
      id: scenario.id,
      properties: {
        scenarioId: scenario.id,
        name: scenario.name,
        heightM: scenario.mass.heightM,
        floors: scenario.mass.floors,
        active: scenario.id === activeScenarioId,
      },
      geometry: { type: "Polygon", coordinates: [ring] },
    };
  });

  return { type: "FeatureCollection", features };
}

export function shadowGeoJson(
  site: Site,
  scenarios: Scenario[],
): FeatureCollection<Polygon> {
  const features: Array<Feature<Polygon>> = [];
  for (const scenario of scenarios) {
    const shadow = computeShadowPolygon(
      scenario.mass,
      site.center,
      scenario.analysisTime,
      540,
    );
    if (shadow.points.length < 3) continue;
    const ring = closeRing(shadow.points.map((point) => {
      const geo = localPointToGeo(site.center, point);
      return [geo.lon, geo.lat];
    }));
    features.push({
      type: "Feature",
      id: `shadow-${scenario.id}`,
      properties: {
        scenarioId: scenario.id,
        lengthM: shadow.lengthM,
      },
      geometry: { type: "Polygon", coordinates: [ring] },
    });
  }
  return { type: "FeatureCollection", features };
}
