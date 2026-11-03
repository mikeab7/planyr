/* City of Sugar Land Master Thoroughfare Plan (NEW-1, 2026-11-02) — the class filter, the paint, and the card, over real values. */
import { describe, it, expect } from "vitest";
import {
  THOROUGHFARE_CLASSES, THOROUGHFARE_ORDER, THOROUGHFARE_WHERE, thoroughfareStyle, thoroughfareCard, thoroughfareLegend, plannedSectionDiffers, hasPlannedSectionOnly, streetName, sectionCode, classKey,
} from "../src/workspaces/site-planner/lib/sugarLandThoroughfare.js";
import { GIS_SOURCES } from "../src/shared/gis/sources.js";

describe("the class filter — the five classes the city's own renderer draws", () => {
  it("is exactly FRWY, STATE, ARTERIAL, MAJ COLL, MIN COLL; OTHER / LOCAL / blank are not in it", () => {
    expect(THOROUGHFARE_ORDER).toEqual(["FRWY", "STATE", "ARTERIAL", "MAJ COLL", "MIN COLL"]);
    for (const k of THOROUGHFARE_ORDER) expect(THOROUGHFARE_WHERE).toContain(`'${k}'`);
    for (const k of ["OTHER", "LOCAL"]) expect(THOROUGHFARE_WHERE).not.toContain(k);
  });
  it("drops Retired but KEEPS a blank LIFE_CYCLE (7 classed segments have one — `<> 'Retired'` alone would lose them)", () => {
    expect(THOROUGHFARE_WHERE).toContain("LIFE_CYCLE IS NULL OR LIFE_CYCLE <> 'Retired'");
    // evaluate the clause the way SQL would, over a table of real shapes
    const sql = (r) => THOROUGHFARE_ORDER.includes(r.FUNCTIONAL_CLASS) && (r.LIFE_CYCLE == null || r.LIFE_CYCLE !== "Retired");
    expect(sql({ FUNCTIONAL_CLASS: "ARTERIAL", LIFE_CYCLE: "Active" })).toBe(true);
    expect(sql({ FUNCTIONAL_CLASS: "ARTERIAL", LIFE_CYCLE: null })).toBe(true);
    expect(sql({ FUNCTIONAL_CLASS: "ARTERIAL", LIFE_CYCLE: "Retired" })).toBe(false);
    expect(sql({ FUNCTIONAL_CLASS: "OTHER", LIFE_CYCLE: "Active" })).toBe(false);
    expect(sql({ FUNCTIONAL_CLASS: null, LIFE_CYCLE: "Active" })).toBe(false);
  });
  it("the registry source row carries the SAME clause (one definition, two places)", () => {
    expect(GIS_SOURCES.slThoroughfare.where).toBe(THOROUGHFARE_WHERE);
  });
});

describe("paint — every class distinct, the legend and the map read one table", () => {
  it("five distinct colours; freeways and state highways heavier than collectors", () => {
    const colors = THOROUGHFARE_ORDER.map((k) => THOROUGHFARE_CLASSES[k].color);
    expect(new Set(colors).size).toBe(5);
    expect(THOROUGHFARE_CLASSES.FRWY.weight).toBeGreaterThan(THOROUGHFARE_CLASSES["MIN COLL"].weight);
  });
  it("the per-feature style reads the class; the legend lists the same colours", () => {
    expect(thoroughfareStyle({ FUNCTIONAL_CLASS: "MAJ COLL" }, 1)).toMatchObject({ color: THOROUGHFARE_CLASSES["MAJ COLL"].color, weight: THOROUGHFARE_CLASSES["MAJ COLL"].weight, fill: false });
    expect(thoroughfareLegend().map((l) => l.color)).toEqual(THOROUGHFARE_ORDER.map((k) => THOROUGHFARE_CLASSES[k].color));
  });
  it("class keys tolerate case and spacing", () => { expect(classKey({ FUNCTIONAL_CLASS: " maj  coll " })).toBe("MAJ COLL"); });
});

describe("the card — what the city says, and nothing it does not", () => {
  const p = { FULL_STREET_NAME: "COMMONWEALTH BLVD", FUNCTIONAL_CLASS: "ARTERIAL", SECTION_TYPE: "C4D", RECOMMENDED_SECTION: "P6D", SECTION_2035: "P6D", LANE_NUMBER: 2, ROAD_WIDTH: "50", RR_Wd_1: 25, RR_WD_2: 40 };
  it("name, class in plain words, the three section codes as written, and the lane count labelled as the city's", () => {
    const c = thoroughfareCard(p);
    expect(c.title).toBe("Commonwealth Blvd");
    const get = (l) => (c.rows.find((r) => r.label === l) || {}).text;
    expect(get("Class")).toBe("Arterial");
    expect(get("Current section")).toBe("C4D");
    expect(get("Plan's recommended section")).toBe("P6D");
    expect(get("2035 section")).toBe("P6D");
    expect(get("Lanes (city's count)")).toBe("2");
  });
  it("a road whose plan section differs from its current one is flagged, without a verdict", () => {
    expect(plannedSectionDiffers(p)).toBe(true);
    expect(thoroughfareCard(p).rows.find((r) => r.label === "Plan differs from current").text).toBe("C4D → P6D");
    expect(plannedSectionDiffers({ SECTION_TYPE: "C4D", RECOMMENDED_SECTION: "C4D" })).toBe(false);
    expect(plannedSectionDiffers({ SECTION_TYPE: null, RECOMMENDED_SECTION: "P4D" })).toBe(false);
  });
  it("a plan section with no current section on file (University Blvd: 94 segments) says so", () => {
    const u = { FULL_STREET_NAME: "UNIVERSITY BLVD", FUNCTIONAL_CLASS: "ARTERIAL", SECTION_TYPE: null, RECOMMENDED_SECTION: "P4D-B", SECTION_2035: "P4D-B", LANE_NUMBER: 2 };
    expect(hasPlannedSectionOnly(u)).toBe(true);
    expect(thoroughfareCard(u).rows.find((r) => r.label === "Plan differs from current").text).toBe("no current section on file → P4D-B");
  });
  it("NEVER prints a width, a right-of-way, or the unexplained RR fields — ROAD_WIDTH is not proven to be either", () => {
    const text = JSON.stringify(thoroughfareCard(p)).toLowerCase();
    expect(text).not.toMatch(/right-of-way|\brow\b|width|\bft\b|feet/);
    expect(text).not.toContain("50");
    expect(text).not.toContain("25");
    expect(text).not.toContain("40");
  });
  it("section codes are shown as written — never decoded", () => {
    const text = JSON.stringify(thoroughfareCard({ ...p, SECTION_TYPE: "C2U-40-P" })).toLowerCase();
    expect(text).not.toMatch(/divided|undivided|arterial section|four-lane|two-lane/);
    expect(sectionCode("<Null>")).toBe("");
    expect(sectionCode(" p4d-b ")).toBe("P4D-B");
  });
  it("shouted street names read as words; route numbers and compass letters stay capitals", () => {
    expect(streetName("S STADIUM DR")).toBe("S Stadium Dr");
    expect(streetName("US 90A E")).toBe("US 90A E");
    expect(streetName("CALLAVANCE")).toBe("Callavance");
    expect(streetName("Hwy 6")).toBe("Hwy 6");
    expect(streetName("")).toBe("");
  });
});
