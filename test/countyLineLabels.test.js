/* B2507065 (NEW-10, owner constraint #47) — county names go alongside the line on each county's own side, upright, never piled up; "<Name> Co." with ", <ST>" only
 * for a county in a different state than the view's. Pure placement (countyLineLabels.js) over a straight state line with a county on each side. */
import { describe, it, expect } from "vitest";
import { countyLineLabels, countyLabelText } from "../src/workspaces/site-planner/lib/countyLineLabels.js";

describe("countyLabelText", () => {
  it("is '<Name> Co.' and adds the state only when it differs from the view's", () => {
    expect(countyLabelText("DeSoto", "MS", "MS")).toBe("DeSoto Co.");
    expect(countyLabelText("Shelby", "TN", "MS")).toBe("Shelby Co., TN");
    expect(countyLabelText("HARRIS", "TX", "TX")).toBe("Harris Co.");
    expect(countyLabelText("Harris County", "TX", "TX")).toBe("Harris Co.");
    expect(countyLabelText("", "TX", "TX")).toBe("");
  });
});

// A flat plane: x = lng, y = −lat scaled to pixels. DeSoto (MS) is SOUTH of the line y = 100; Shelby (TN) is NORTH of it.
const project = (lng, lat) => ({ x: lng * 10, y: -lat * 10 });
const unproject = (x, y) => ({ lng: x / 10, lat: -y / 10 });
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(([x, y]) => [x / 10, -y / 10]);
const DESOTO = { properties: { n: "DeSoto" }, geometry: { type: "Polygon", coordinates: [rect(-50, 100, 600, 700)] } };
const SHELBY = { properties: { n: "Shelby" }, geometry: { type: "Polygon", coordinates: [rect(-50, -500, 600, 100)] } };
const opts = { project, unproject, viewW: 500, viewH: 400 };

describe("countyLineLabels", () => {
  it("puts each county's name on its OWN side of the shared line, parallel to it", () => {
    const out = countyLineLabels([DESOTO, SHELBY], { ...opts, textOf: (f) => (f.properties.n === "DeSoto" ? "DeSoto Co." : "Shelby Co., TN") });
    // view is y 0..400 so only the south county's side of the y=100 line, plus the north county's edge at y=100, is in view
    const d = out.find((l) => l.text === "DeSoto Co."), s = out.find((l) => l.text === "Shelby Co., TN");
    expect(d, "DeSoto label").toBeTruthy();
    expect(s, "Shelby label").toBeTruthy();
    const dy = project(d.lng, d.lat).y, sy = project(s.lng, s.lat).y;
    expect(dy).toBeGreaterThan(100);   // DeSoto is south (larger y) of the line
    expect(sy).toBeLessThan(100);      // Shelby is north of it
    expect(Math.abs(d.angle)).toBeLessThan(1); // the line is horizontal → upright, not rotated
    expect(Math.abs(s.angle)).toBeLessThan(1);
  });
  it("keeps text upright on a slanted line (angle within ±90°)", () => {
    const slant = { properties: { n: "A" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [40, -40], [40, -90], [-10, -90], [0, 0]].map(([x, y]) => [x / 10 + 5, y / 10])] } };
    const out = countyLineLabels([slant], { ...opts, project: (lng, lat) => ({ x: lng * 10, y: -lat * 10 }), textOf: () => "A County Long Name Co." });
    for (const l of out) expect(Math.abs(l.angle)).toBeLessThanOrEqual(90);
  });
  it("drops a label whose run is too short for its text, and labels that would collide", () => {
    const tiny = { properties: {}, geometry: { type: "Polygon", coordinates: [rect(0, 0, 20, 20)] } };
    expect(countyLineLabels([tiny], { ...opts, textOf: () => "Very Long County Name Co." })).toEqual([]);
    const twin = [DESOTO, { ...DESOTO }];
    expect(countyLineLabels(twin, { ...opts, textOf: () => "DeSoto Co." }).length).toBe(1);
  });
  it("skips a feature with no name and tolerates empty input", () => {
    expect(countyLineLabels([DESOTO], { ...opts, textOf: () => "" })).toEqual([]);
    expect(countyLineLabels([], opts)).toEqual([]);
    expect(countyLineLabels(null, opts)).toEqual([]);
  });
});
