/* Unit tests for the pure thoroughfare ingestion transform (B721): ArcGIS GeoJSON feature →
 * normalized `thoroughfare_segments` row, incl. the Houston config crosswalk + Chapter-42 width
 * resolution + the WGS84/EPSG:2278 EWKT geometry (reusing the shared coordinate spine). The live
 * network fetch + DB upsert are NOT tested here (egress-blocked; owed on V274) — only the
 * deterministic transform is. */
import { describe, it, expect } from "vitest";
import {
  geometryToParts,
  ewkt4326,
  ewkt2278,
  featureToRow,
  buildQueryUrl,
} from "../src/shared/thoroughfare/ingestTransform.js";
import { HOUSTON } from "../src/shared/thoroughfare/houston.js";
import { projectToGrid } from "../src/shared/coordinates/index.js";
import { isClassification } from "../src/shared/thoroughfare/classification.js";

const lineFeature = (props, coords) => ({
  type: "Feature",
  properties: props,
  geometry: { type: "LineString", coordinates: coords },
});

// A short segment near downtown Houston.
const HOU = [
  [-95.3698, 29.7604],
  [-95.3690, 29.7610],
];

describe("geometryToParts", () => {
  it("wraps a LineString as one part", () => {
    expect(geometryToParts({ type: "LineString", coordinates: HOU })).toEqual([HOU]);
  });
  it("passes a MultiLineString through", () => {
    const mls = { type: "MultiLineString", coordinates: [HOU, HOU] };
    expect(geometryToParts(mls)).toEqual([HOU, HOU]);
  });
  it("reads an Esri JSON polyline's paths (f=json shape)", () => {
    expect(geometryToParts({ paths: [HOU, HOU] })).toEqual([HOU, HOU]);
  });
  it("returns [] for points/polygons/null", () => {
    expect(geometryToParts({ type: "Point", coordinates: [-95, 29] })).toEqual([]);
    expect(geometryToParts(null)).toEqual([]);
    expect(geometryToParts({ type: "LineString" })).toEqual([]);
  });
});

describe("EWKT geometry", () => {
  it("ewkt4326 emits a MULTILINESTRING wrapping the part, WGS84", () => {
    const w = ewkt4326([HOU]);
    expect(w).toMatch(/^SRID=4326;MULTILINESTRING\(\(/);
    expect(w).toContain("-95.3698 29.7604");
  });
  it("ewkt2278 projects every vertex through the shared EPSG:2278 spine", () => {
    const w = ewkt2278([HOU]);
    expect(w).toMatch(/^SRID=2278;MULTILINESTRING\(\(/);
    const { x, y } = projectToGrid(29.7604, -95.3698);
    expect(w).toContain(`${Number(x.toFixed(3))} ${Number(y.toFixed(3))}`);
    // Houston lands in the EPSG:2278 (Texas South Central, ftUS) high-millions easting/northing.
    expect(x).toBeGreaterThan(2_900_000);
    expect(x).toBeLessThan(3_400_000);
    expect(y).toBeGreaterThan(13_700_000);
    expect(y).toBeLessThan(14_100_000);
  });
});

describe("featureToRow (Houston config)", () => {
  it("normalizes a major-thoroughfare feature end to end", () => {
    const row = featureToRow(
      lineFeature({ OBJECTID: 42, FULL_NAME: "Westheimer Rd", HIER_TABLE: "Major Thoroughfare", ST_STATUS: "Existing" }, HOU),
      HOUSTON,
    );
    expect(row.jurisdiction).toBe("coh");
    expect(row.source_feature_id).toBe("42"); // stringified id → idempotency key
    expect(row.street_name).toBe("Westheimer Rd");
    expect(row.classification).toBe("major_thoroughfare");
    expect(row.raw_classification).toBe("Major Thoroughfare"); // verbatim source kept
    expect(row.status).toBe("existing");
    expect(row.ultimate_row_ft).toBe(100); // resolved from the confirmed §42-122 standard
    expect(row.building_line_ft).toBeNull();
    expect(row.geom).toMatch(/^SRID=4326;MULTILINESTRING/);
    expect(row.geom_2278).toMatch(/^SRID=2278;MULTILINESTRING/);
    expect(row.plan_name).toContain("MTFP");
  });

  it("maps a proposed transit corridor; width null until verified", () => {
    const row = featureToRow(
      lineFeature({ OBJECTID: 7, NAME: "Future Transit", HIER_TABLE: "Transit Corridor", ST_STATUS: "Proposed" }, HOU),
      HOUSTON,
    );
    expect(row.classification).toBe("transit_corridor");
    expect(row.status).toBe("proposed");
    expect(row.ultimate_row_ft).toBeNull(); // provisional class — not guessed
  });

  it("falls back to 'other' for an unknown hierarchy value (never dropped)", () => {
    const row = featureToRow(
      lineFeature({ OBJECTID: 9, NAME: "Cul de sac", HIER_TABLE: "Alleyway", ST_STATUS: "Existing" }, HOU),
      HOUSTON,
    );
    expect(row.classification).toBe("other");
    expect(row.raw_classification).toBe("Alleyway");
    expect(isClassification(row.classification)).toBe(true);
  });

  it("prefers FULL_NAME over NAME, and defaults status to existing when blank", () => {
    const row = featureToRow(
      lineFeature({ OBJECTID: 1, FULL_NAME: "Kirby Dr", NAME: "KIRBY", HIER_TABLE: "Collector", ST_STATUS: "" }, HOU),
      HOUSTON,
    );
    expect(row.street_name).toBe("Kirby Dr");
    expect(row.classification).toBe("collector_major");
    expect(row.status).toBe("existing");
  });

  it("handles a multi-part centerline", () => {
    const row = featureToRow(
      { type: "Feature", properties: { OBJECTID: 5, HIER_TABLE: "Freeway" },
        geometry: { type: "MultiLineString", coordinates: [HOU, HOU] } },
      HOUSTON,
    );
    expect(row.classification).toBe("freeway");
    expect(row.geom).toMatch(/^SRID=4326;MULTILINESTRING\(\(/);
    expect(row.geom).toContain("), ("); // two parts joined into one MULTILINESTRING
  });

  it("reads an Esri JSON feature (attributes + paths), not just GeoJSON", () => {
    const row = featureToRow(
      { attributes: { OBJECTID: 11, FULL_NAME: "Bissonnet St", HIER_TABLE: "Major Thoroughfare", ST_STATUS: "Existing" },
        geometry: { paths: [HOU] } },
      HOUSTON,
    );
    expect(row.source_feature_id).toBe("11");
    expect(row.street_name).toBe("Bissonnet St");
    expect(row.classification).toBe("major_thoroughfare");
    expect(row.ultimate_row_ft).toBe(100);
    expect(row.geom).toMatch(/^SRID=4326;MULTILINESTRING/);
    expect(row.geom_2278).toMatch(/^SRID=2278;MULTILINESTRING/);
  });

  it("skips features with no line geometry or no id", () => {
    expect(featureToRow(lineFeature({ OBJECTID: 1 }, [[-95, 29]]), HOUSTON)).toBeNull(); // 1-point line
    expect(featureToRow({ type: "Feature", properties: { OBJECTID: 1 }, geometry: { type: "Point", coordinates: [-95, 29] } }, HOUSTON)).toBeNull();
    expect(featureToRow(lineFeature({ FULL_NAME: "no id" }, HOU), HOUSTON)).toBeNull();
  });
});

describe("buildQueryUrl", () => {
  it("builds a paged Esri-JSON query reprojected to WGS84", () => {
    const url = buildQueryUrl(HOUSTON, { offset: 2000, pageSize: 500 });
    expect(url).toContain(`${HOUSTON.serviceUrl}/query?`);
    expect(url).toContain("f=json");
    expect(url).toContain("outSR=4326");
    expect(url).toContain("returnGeometry=true");
    expect(url).toContain("resultOffset=2000");
    expect(url).toContain("resultRecordCount=500");
  });
  it("omits resultRecordCount without a pageSize (server uses its maxRecordCount) and can order by OBJECTID", () => {
    const url = buildQueryUrl(HOUSTON, { offset: 0, orderByObjectId: true });
    expect(url).not.toContain("resultRecordCount");
    expect(url).toContain("orderByFields=OBJECTID");
  });
});
