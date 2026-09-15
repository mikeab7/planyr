import { describe, it, expect } from "vitest";
import { leanProps, quantizeGeometry, leanFeature, buildSnapshotFC, KEEP_FIELDS, esriRingsToGeoJsonGeometry } from "../src/shared/gis/parcelSnapshotBuild.js";

describe("leanProps — keep only the fields the UI reads", () => {
  it("keeps wanted keys (case-insensitive), drops the rest + empties", () => {
    const out = leanProps({ PROP_ID: "55173", OWNER_NAME: "ACME", SHAPE_AREA: 1234, NOTES: "", extra_junk: "x", county: "CHAMBERS" });
    expect(out).toEqual({ PROP_ID: "55173", OWNER_NAME: "ACME", county: "CHAMBERS" });
  });
  it("always preserves county verbatim", () => {
    expect(leanProps({ county: "WALLER" }).county).toBe("WALLER");
  });
});

describe("quantizeGeometry — shrink coordinate precision", () => {
  it("rounds Polygon coords to N decimals", () => {
    const g = quantizeGeometry({ type: "Polygon", coordinates: [[[-94.8861234567, 29.8461234567], [-94.88, 29.84], [-94.8861234567, 29.8461234567]]] }, 4);
    expect(g.coordinates[0][0]).toEqual([-94.8861, 29.8461]);
  });
  it("handles MultiPolygon and rejects non-polygons", () => {
    expect(quantizeGeometry({ type: "MultiPolygon", coordinates: [[[[1.11111, 2.22222], [3, 4], [1.11111, 2.22222]]]] }, 2).coordinates[0][0][0]).toEqual([1.11, 2.22]);
    expect(quantizeGeometry({ type: "Point", coordinates: [1, 2] })).toBeNull();
    expect(quantizeGeometry(null)).toBeNull();
  });
});

describe("leanFeature / buildSnapshotFC", () => {
  const raw = (id, x, y) => ({ type: "Feature", properties: { PROP_ID: id, SHAPE_JUNK: 9, county: "CHAMBERS" }, geometry: { type: "Polygon", coordinates: [[[x, y], [x + 0.001, y], [x + 0.001, y + 0.001], [x, y + 0.001], [x, y]]] } });

  it("leanFeature strips props + quantizes; null on non-polygon", () => {
    const f = leanFeature(raw("1", -94.886, 29.846), { decimals: 5 });
    expect(f.properties).toEqual({ PROP_ID: "1", county: "CHAMBERS" });
    expect(f.geometry.type).toBe("Polygon");
    expect(leanFeature({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [0, 0] } })).toBeNull();
  });

  it("buildSnapshotFC lean-maps all + computes the [w,s,e,n] extent", () => {
    const fc = buildSnapshotFC([raw("1", -95, 29.8), raw("2", -94.9, 29.9)]);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(2);
    expect(fc.features.every((f) => !("SHAPE_JUNK" in f.properties))).toBe(true);
    expect(fc.bbox[0]).toBeCloseTo(-95, 5);      // min lng
    expect(fc.bbox[2]).toBeCloseTo(-94.899, 3);  // max lng (second square's east edge)
  });

  it("KEEP_FIELDS covers both CAD and TxGIO schemas (prop_id, owner_name, situs_addr)", () => {
    for (const k of ["prop_id", "owner_name", "situs_addr", "county", "hcad_num", "situs"]) expect(KEEP_FIELDS).toContain(k);
  });
});

// B1657600 — /identify (unlike /query with f=geojson) always answers in Esri JSON rings, so the
// tile-identify extraction path needs its own rings→GeoJSON step.
describe("esriRingsToGeoJsonGeometry — Esri rings → GeoJSON (B1657600)", () => {
  // A square, CLOCKWISE (negative shoelace area) — the Esri convention for an outer ring.
  const cw = (x, y, h) => [[x - h, y - h], [x - h, y + h], [x + h, y + h], [x + h, y - h], [x - h, y - h]];
  // The same square, COUNTER-clockwise (positive area) — the Esri convention for a hole.
  const ccw = (x, y, h) => [...cw(x, y, h)].reverse();

  it("returns null for no rings", () => {
    expect(esriRingsToGeoJsonGeometry(null)).toBeNull();
    expect(esriRingsToGeoJsonGeometry([])).toBeNull();
  });

  it("a single outer ring → a Polygon, re-wound to GeoJSON's CCW exterior convention", () => {
    const g = esriRingsToGeoJsonGeometry([cw(0, 0, 1)]);
    expect(g.type).toBe("Polygon");
    expect(g.coordinates).toHaveLength(1);
    // GeoJSON wants the exterior ring CCW (positive shoelace area).
    const ring = g.coordinates[0];
    let a = 0;
    for (let i = 0; i < ring.length; i++) { const j = (i + 1) % ring.length; a += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1]; }
    expect(a / 2).toBeGreaterThan(0);
  });

  it("an outer ring + a hole inside it → one Polygon with two rings", () => {
    const g = esriRingsToGeoJsonGeometry([cw(0, 0, 2), ccw(0, 0, 0.5)]);
    expect(g.type).toBe("Polygon");
    expect(g.coordinates).toHaveLength(2); // exterior + one hole
  });

  it("two separate outer rings (a two-tract parcel) → a MultiPolygon", () => {
    const g = esriRingsToGeoJsonGeometry([cw(0, 0, 1), cw(10, 10, 1)]);
    expect(g.type).toBe("MultiPolygon");
    expect(g.coordinates).toHaveLength(2);
  });

  it("a hole is assigned to the outer ring that actually contains it", () => {
    const g = esriRingsToGeoJsonGeometry([cw(0, 0, 2), cw(10, 10, 2), ccw(10, 10, 0.5)]);
    expect(g.type).toBe("MultiPolygon");
    const withHole = g.coordinates.find((poly) => poly.length > 1);
    expect(withHole).toBeTruthy();
    // its exterior ring is centered near (10,10), not (0,0)
    const cx = withHole[0].reduce((s, p) => s + p[0], 0) / withHole[0].length;
    expect(cx).toBeCloseTo(10, 0);
  });

  it("round-trips through quantizeGeometry/buildSnapshotFC like any other feature", () => {
    const geometry = esriRingsToGeoJsonGeometry([cw(-95, 29, 0.001)]);
    const fc = buildSnapshotFC([{ type: "Feature", properties: { PROP_ID: "1" }, geometry }]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry.type).toBe("Polygon");
  });
});
