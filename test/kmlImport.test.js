import { describe, it, expect } from "vitest";
import {
  parseKmlPlacemarks, polygonCentroid, kmlDescriptionToText, placemarkToDraftRow, kmlToDraftRows,
} from "../src/shared/comps/lib/kmlImport.js";

const SAMPLE_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <Placemark>
    <name>FM 359 tract</name>
    <description><![CDATA[Talked to the owner in spring 2026, roughly 3.2 AC, asking $850k]]></description>
    <Point>
      <coordinates>-95.789,29.812,0</coordinates>
    </Point>
  </Placemark>
  <Placemark>
    <name>Warehouse block</name>
    <description>Sold for $3.1M, 25,000 SF building, closed 3/14/2026</description>
    <Polygon>
      <outerBoundaryIs>
        <LinearRing>
          <coordinates>
            -95.80,29.80,0 -95.79,29.80,0 -95.79,29.81,0 -95.80,29.81,0 -95.80,29.80,0
          </coordinates>
        </LinearRing>
      </outerBoundaryIs>
    </Polygon>
  </Placemark>
  <Placemark>
    <name>No geometry yet</name>
    <description>Just a note, no location pinned</description>
  </Placemark>
</Document>
</kml>`;

describe("kmlImport: placemark extraction", () => {
  it("finds every Placemark", () => {
    const placemarks = parseKmlPlacemarks(SAMPLE_KML);
    expect(placemarks).toHaveLength(3);
  });

  it("reads a Point placemark's name, description (CDATA) and coordinates", () => {
    const [p] = parseKmlPlacemarks(SAMPLE_KML);
    expect(p.name).toBe("FM 359 tract");
    expect(p.description).toContain("3.2 AC");
    expect(p.geometry).toEqual({ kind: "point", lon: -95.789, lat: 29.812 });
  });

  it("reads a Polygon placemark and derives its centroid", () => {
    const [, p] = parseKmlPlacemarks(SAMPLE_KML);
    expect(p.geometry.kind).toBe("polygon");
    expect(p.geometry.ring.length).toBeGreaterThanOrEqual(4);
    // A square ring's centroid is its center, regardless of vertex density.
    expect(p.geometry.centroid.lon).toBeCloseTo(-95.795, 3);
    expect(p.geometry.centroid.lat).toBeCloseTo(29.805, 3);
  });

  it("a placemark with no Point/Polygon has null geometry, not a crash", () => {
    const [, , p] = parseKmlPlacemarks(SAMPLE_KML);
    expect(p.geometry).toBeNull();
  });
});

describe("kmlImport: polygonCentroid — area-weighted, not a vertex average", () => {
  it("an equilateral-ish square with one dense edge still centers correctly", () => {
    // Square [0,0]-[10,0]-[10,10]-[0,10], but the bottom edge has 3 extra points crammed onto
    // it. A vertex average would drag the centroid toward that edge; the area formula must not.
    const ring = [[0, 0], [2, 0], [5, 0], [8, 0], [10, 0], [10, 10], [0, 10]];
    const c = polygonCentroid(ring);
    expect(c.lon).toBeCloseTo(5, 5);
    expect(c.lat).toBeCloseTo(5, 5);
  });
});

describe("kmlImport: description -> plain text", () => {
  it("turns <br> into newlines and strips other tags", () => {
    expect(kmlDescriptionToText("Line one<br>Line two<br/><b>bold</b> text")).toBe("Line one\nLine two\nbold text");
  });
  it("decodes common entities", () => {
    expect(kmlDescriptionToText("Tom &amp; Jerry&#39;s lot")).toBe("Tom & Jerry's lot");
  });
  it("is empty (not null/undefined) for no description", () => {
    expect(kmlDescriptionToText(null)).toBe("");
  });
});

describe("kmlImport: placemark -> draft row, best-effort extraction never commits silently", () => {
  it("proposes values from the description via the SAME prose parser the paste-grid uses", () => {
    const [placemark] = parseKmlPlacemarks(SAMPLE_KML);
    const row = placemarkToDraftRow(placemark, { sourceFile: "jordan-comps.kml" });
    expect(row.source).toBe("kml");
    expect(row.source_file).toBe("jordan-comps.kml");
    expect(row.raw_name).toBe("FM 359 tract");
    expect(row.raw_geometry).toEqual({ kind: "point", lat: 29.812, lon: -95.789 });
    expect(row.status).toBe("pending");
    // proposed is a PROPOSAL, not a commit — it's the same shape a pasted line would produce.
    expect(row.proposed.compType).toBe("land");
    expect(row.proposed.landPrice).toBe("850000");
    expect(row.proposed.landSizeValue).toBe("3.2");
  });

  it("a placemark with no geometry still becomes a draft row (never dropped)", () => {
    const placemarks = parseKmlPlacemarks(SAMPLE_KML);
    const row = placemarkToDraftRow(placemarks[2]);
    expect(row.raw_geometry).toBeNull();
    expect(row.raw_name).toBe("No geometry yet");
  });

  it("kmlToDraftRows converts a whole document in one call", () => {
    const rows = kmlToDraftRows(SAMPLE_KML, { sourceFile: "test.kml" });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.source === "kml")).toBe(true);
  });
});
