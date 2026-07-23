// PR-G — the buildable envelope: hard limits (drainage cap, floodway no-fill, outfall/
// tailwater) + a soft geotech screen. Pure; fixture-driven.
import { describe, it, expect } from "vitest";
import {
  rimCapElevFt,
  assessBuildability,
  unbuildableHeading,
  makeItBuildableOptions,
  unbuildableNote,
  DEFAULT_MAX_EXCAV_DEPTH_FT,
} from "../src/workspaces/site-planner/lib/buildableEnvelope.js";

describe("rimCapElevFt — the highest buildable top-of-bank elevation", () => {
  it("takes the SMALLEST of the drainage cap and the geometric ceiling", () => {
    expect(rimCapElevFt({ drainageCapElevFt: 104, geometricCeilingElevFt: 110 })).toBe(104);
    expect(rimCapElevFt({ drainageCapElevFt: 112, geometricCeilingElevFt: 108 })).toBe(108);
  });
  it("floodway no-fill caps the rim at existing grade (no berm)", () => {
    expect(rimCapElevFt({ gradeFt: 100, drainageCapElevFt: 109, inFloodway: true })).toBe(100);
    // not in a floodway → grade doesn't cap
    expect(rimCapElevFt({ gradeFt: 100, drainageCapElevFt: 109, inFloodway: false })).toBe(109);
  });
  it("null inputs don't constrain; nothing finite → null", () => {
    expect(rimCapElevFt({})).toBeNull();
    expect(rimCapElevFt({ inFloodway: true })).toBeNull(); // no grade → floodway can't cap
  });
});

describe("assessBuildability — hard limits (a-c) block; soft (d) only warns", () => {
  it("a floodway pond bermed above grade is NOT buildable", () => {
    const r = assessBuildability({ tobElev: 109.3, gradeFt: 100, inFloodway: true });
    expect(r.buildable).toBe(false);
    expect(r.hard.map((h) => h.code)).toContain("floodway-fill");
  });
  it("a floodway pond with the rim AT grade (no fill) is buildable on that axis", () => {
    const r = assessBuildability({ tobElev: 100, gradeFt: 100, inFloodway: true });
    expect(r.hard.some((h) => h.code === "floodway-fill")).toBe(false);
  });
  it("a rim above the drainage cap is NOT buildable", () => {
    const r = assessBuildability({ tobElev: 109.3, gradeFt: 100, drainageCapElevFt: 104.5 });
    expect(r.buildable).toBe(false);
    expect(r.hard.map((h) => h.code)).toContain("drainage-cap");
  });
  it("a rim at/below the drainage cap does not trip it", () => {
    const r = assessBuildability({ tobElev: 104.4, gradeFt: 100, drainageCapElevFt: 104.5 });
    expect(r.hard.some((h) => h.code === "drainage-cap")).toBe(false);
  });
  it("an outlet below the 100-yr tailwater is NOT buildable (gravity discharge fails)", () => {
    const r = assessBuildability({ tobElev: 104, floorElev: 92, tailwaterFt: 95, outletInvertFt: 92 });
    expect(r.buildable).toBe(false);
    const tw = r.hard.find((h) => h.code === "outfall-tailwater");
    expect(tw).toBeTruthy();
    expect(tw.label).toMatch(/can't discharge by gravity/);
  });
  it("the outlet invert falls back to the pond floor when no explicit invert is given", () => {
    const withFloor = assessBuildability({ floorElev: 90, tailwaterFt: 95 });
    expect(withFloor.hard.some((h) => h.code === "outfall-tailwater")).toBe(true);
    const okOutlet = assessBuildability({ floorElev: 90, tailwaterFt: 95, outletInvertFt: 96 });
    expect(okOutlet.hard.some((h) => h.code === "outfall-tailwater")).toBe(false);
  });
  it("deep excavation is a SOFT warning — it never makes the design unbuildable", () => {
    const r = assessBuildability({ tobElev: 104, gradeFt: 100, waterDepthFt: 16.3 });
    expect(r.buildable).toBe(true); // soft only
    expect(r.soft.map((s) => s.code)).toContain("deep-excavation");
    expect(r.soft[0].label).toMatch(/below seasonal groundwater/);
  });
  it("the excavation screen threshold is editable (default 12 ft)", () => {
    expect(DEFAULT_MAX_EXCAV_DEPTH_FT).toBe(12);
    const shallowOk = assessBuildability({ waterDepthFt: 10 });
    expect(shallowOk.soft.length).toBe(0);
    const raised = assessBuildability({ waterDepthFt: 16, maxExcavDepthFt: 20 });
    expect(raised.soft.length).toBe(0); // raised the screen → no warning
  });
  it("a clean design inside every limit is buildable with no flags", () => {
    const r = assessBuildability({ tobElev: 103, gradeFt: 100, drainageCapElevFt: 105, tailwaterFt: 92, outletInvertFt: 93, waterDepthFt: 8 });
    expect(r.buildable).toBe(true);
    expect(r.hard.length).toBe(0);
    expect(r.soft.length).toBe(0);
  });
  it("unknown facts (nulls) never fabricate a violation", () => {
    const r = assessBuildability({ tobElev: 120 }); // no grade/cap/tailwater/depth known
    expect(r.buildable).toBe(true);
    expect(r.hard.length).toBe(0);
  });
  it("multiple hard limits stack in one assessment", () => {
    const r = assessBuildability({ tobElev: 110, gradeFt: 100, inFloodway: true, drainageCapElevFt: 104, floorElev: 90, tailwaterFt: 95 });
    expect(r.buildable).toBe(false);
    expect(r.hard.map((h) => h.code).sort()).toEqual(["drainage-cap", "floodway-fill", "outfall-tailwater"]);
  });
});

describe("copy helpers", () => {
  it("the AMBER heading names the volume but never says OK", () => {
    const h = unbuildableHeading({ requiredAcFt: 33.8 });
    expect(h).toBe("Meets the 33.8 ac-ft volume, but not buildable as drawn");
    expect(h).not.toMatch(/\bOK\b/);
  });
  it("make-it-buildable options list the four escapes; enlarge carries acreage when known", () => {
    expect(makeItBuildableOptions({ extraAcres: 4 })).toBe("To make it buildable: enlarge the pond by ~4.0 ac, add a second basin, raise the outfall or add a pump, or provide inlets through the berm.");
    expect(makeItBuildableOptions({})).toMatch(/^To make it buildable: enlarge the pond,/);
  });
  it("unbuildableNote joins the hard reasons with the options and has NO em-dash", () => {
    const note = unbuildableNote({ hard: [{ code: "floodway-fill", label: "In the regulatory floodway: fill is prohibited." }], extraAcres: 2 });
    expect(note).toMatch(/floodway/);
    expect(note).toMatch(/To make it buildable/);
    expect(note.includes("—")).toBe(false);
  });
});
