import { describe, it, expect } from "vitest";
import {
  titleCaseName, ringAreaCentroid, featureAnchor, labelAnchors, placeLabels, labelsVisible,
} from "../src/workspaces/site-planner/lib/boundaryLabels.js";

const square = (x, y, d) => [[x, y], [x, y + d], [x + d, y + d], [x + d, y], [x, y]];
const feat = (props, rings) => ({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: rings } });
const fc = (...features) => ({ type: "FeatureCollection", features });

describe("titleCaseName — ALL-CAPS agency names → display case", () => {
  it("title-cases each word (H-GAC publishes ALL CAPS)", () => {
    expect(titleCaseName("HOUSTON")).toBe("Houston");
    expect(titleCaseName("MISSOURI CITY")).toBe("Missouri City");
    expect(titleCaseName("mont belvieu")).toBe("Mont Belvieu");
  });
});

describe("ringAreaCentroid / featureAnchor", () => {
  it("centroid of a unit square is its center; area is signed", () => {
    const r = ringAreaCentroid(square(0, 0, 2));
    expect(Math.abs(r.area)).toBeCloseTo(4, 9);
    expect(r.cx).toBeCloseTo(1, 9);
    expect(r.cy).toBeCloseTo(1, 9);
  });
  it("a degenerate (zero-area) ring still yields an anchor (vertex average)", () => {
    const r = ringAreaCentroid([[1, 1], [1, 1], [1, 1]]);
    expect(r.area).toBe(0);
    expect(r.cx).toBe(1);
    expect(r.cy).toBe(1);
  });
  it("featureAnchor picks the LARGEST ring (outer ring beats a hole)", () => {
    const outer = square(0, 0, 10), hole = square(4, 4, 1);
    const a = featureAnchor({ type: "Polygon", coordinates: [outer, hole] });
    expect(a.lng).toBeCloseTo(5, 6);
    expect(a.lat).toBeCloseTo(5, 6);
    expect(a.areaDeg).toBeCloseTo(100, 6);
  });
  it("empty geometry → null (no fabricated anchor)", () => {
    expect(featureAnchor({ type: "Polygon", coordinates: [] })).toBe(null);
    expect(featureAnchor(null)).toBe(null);
  });
});

describe("labelAnchors — one anchor per NAME", () => {
  it("extracts name + anchor per feature, title-casing when asked", () => {
    const out = labelAnchors(fc(feat({ CITY: "HOUSTON" }, [square(0, 0, 2)])), { labelField: "CITY", titleCase: true });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Houston");
    expect(out[0].lng).toBeCloseTo(1);
  });
  it("a name split across several polygons labels ONCE, at its biggest piece", () => {
    const out = labelAnchors(fc(
      feat({ city_name: "Houston" }, [square(0, 0, 1)]),
      feat({ city_name: "Houston" }, [square(10, 10, 5)]), // bigger — wins
      feat({ city_name: "Katy" }, [square(-3, 0, 1)]),
    ), { labelField: "city_name" });
    expect(out).toHaveLength(2);
    const hou = out.find((a) => a.name === "Houston");
    expect(hou.lng).toBeCloseTo(12.5);
  });
  it("nameless / empty-name features are skipped (honest nothing, never 'undefined')", () => {
    const out = labelAnchors(fc(
      feat({}, [square(0, 0, 1)]),
      feat({ CNTY_NM: "  " }, [square(2, 0, 1)]),
      feat({ CNTY_NM: "Harris" }, [square(4, 0, 1)]),
    ), { labelField: "CNTY_NM" });
    expect(out.map((a) => a.name)).toEqual(["Harris"]);
  });
});

describe("placeLabels — greedy collision-drop, biggest area first", () => {
  // Identity projection: 1° = 100 px, viewport 1000×1000.
  const project = (lng, lat) => ({ x: lng * 100, y: lat * 100 });
  const anchor = (name, lng, lat, areaDeg) => ({ name, lng, lat, areaDeg });

  it("keeps non-colliding labels and drops the smaller of a colliding pair", () => {
    const placed = placeLabels([
      anchor("Small", 1.02, 1.02, 1),   // ~2px from Big's anchor — collides
      anchor("Big", 1, 1, 100),
      anchor("Far", 8, 8, 5),
    ], { project, viewW: 1000, viewH: 1000 });
    expect(placed.map((p) => p.name).sort()).toEqual(["Big", "Far"]); // Big wins its spot
  });
  it("drops anchors outside the viewport (with margin)", () => {
    const placed = placeLabels([anchor("Off", 50, 50, 10), anchor("On", 5, 5, 1)], { project, viewW: 1000, viewH: 1000 });
    expect(placed.map((p) => p.name)).toEqual(["On"]);
  });
  it("longer names claim wider boxes (box width tracks name length)", () => {
    const placed = placeLabels([anchor("A Very Long County Name", 1, 1, 10)], { project, viewW: 1000, viewH: 1000 });
    expect(placed[0].box.w).toBeGreaterThan(100);
  });
  it("a null/NaN projection is skipped, never thrown", () => {
    const placed = placeLabels([anchor("X", 1, 1, 1)], { project: () => null, viewW: 100, viewH: 100 });
    expect(placed).toEqual([]);
  });
});

describe("labelsVisible — the zoom gate", () => {
  const gate = { min: 6, max: 11 };
  it("inclusive band: on at min & max, off outside, off with no gate", () => {
    expect(labelsVisible(gate, 6)).toBe(true);
    expect(labelsVisible(gate, 11)).toBe(true);
    expect(labelsVisible(gate, 5)).toBe(false);
    expect(labelsVisible(gate, 12)).toBe(false);   // parcel zoom — you're inside one county
    expect(labelsVisible(null, 8)).toBe(false);
    expect(labelsVisible(gate, undefined)).toBe(false);
  });
});
