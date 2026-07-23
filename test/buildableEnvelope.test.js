// PR-G — the buildable envelope: hard limits (drainage cap, floodway no-fill, outfall/
// tailwater) + a soft geotech screen. Pure; fixture-driven.
import { describe, it, expect } from "vitest";
import {
  rimCapElevFt,
  assessBuildability,
  unbuildableHeading,
  makeItBuildableOptions,
  unbuildableNote,
  requirementNote,
  DEFAULT_MAX_EXCAV_DEPTH_FT,
} from "../src/workspaces/site-planner/lib/buildableEnvelope.js";

describe("rimCapElevFt — the highest buildable top-of-bank elevation", () => {
  it("takes the SMALLEST of the drainage cap and the geometric ceiling", () => {
    expect(rimCapElevFt({ drainageCapElevFt: 104, geometricCeilingElevFt: 110 })).toBe(104);
    expect(rimCapElevFt({ drainageCapElevFt: 112, geometricCeilingElevFt: 108 })).toBe(108);
  });
  it("PR-K: the floodway is NOT a rim cap — only the physical caps bound the rim", () => {
    // A floodway berm is allowed with a no-rise cert, so the drainage cap alone governs the rim.
    expect(rimCapElevFt({ drainageCapElevFt: 109 })).toBe(109);
  });
  it("null inputs don't constrain; nothing finite → null", () => {
    expect(rimCapElevFt({})).toBeNull();
  });
});

describe("assessBuildability — hard limits (a, c) block; floodway is a no-rise REQUIREMENT; soft (d) warns", () => {
  it("PR-K: a floodway pond bermed above grade IS buildable, but raises a no-rise REQUIREMENT", () => {
    const r = assessBuildability({ tobElev: 109.3, gradeFt: 100, inFloodway: true });
    expect(r.buildable).toBe(true); // no longer a hard block
    expect(r.hard.some((h) => h.code === "floodway-fill")).toBe(false);
    expect(r.requirements.map((q) => q.code)).toContain("floodway-no-rise");
    expect(r.requirements[0].label).toMatch(/no-rise certification/);
    expect(r.requirements[0].label).not.toMatch(/prohibited|no fill/i);
  });
  it("a floodway pond with the rim AT grade (no fill) raises NO requirement", () => {
    const r = assessBuildability({ tobElev: 100, gradeFt: 100, inFloodway: true });
    expect(r.requirements.length).toBe(0);
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
  it("multiple hard limits stack; the floodway rides alongside as a requirement, not a hard block", () => {
    const r = assessBuildability({ tobElev: 110, gradeFt: 100, inFloodway: true, drainageCapElevFt: 104, floorElev: 90, tailwaterFt: 95 });
    expect(r.buildable).toBe(false);
    expect(r.hard.map((h) => h.code).sort()).toEqual(["drainage-cap", "outfall-tailwater"]);
    expect(r.requirements.map((q) => q.code)).toContain("floodway-no-rise");
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
    const note = unbuildableNote({ hard: [{ code: "drainage-cap", label: "Rim is above the elevation the site can drain in by gravity." }], extraAcres: 2 });
    expect(note).toMatch(/drain in by gravity/);
    expect(note).toMatch(/To make it buildable/);
    expect(note.includes("—")).toBe(false);
  });
});

describe("PR-K — the floodway no-rise requirement copy", () => {
  it("names the no-rise cert, defines it inline, and never says 'prohibited' / 'no fill'", () => {
    const r = assessBuildability({ tobElev: 108, gradeFt: 100, inFloodway: true });
    const note = requirementNote({ requirements: r.requirements });
    expect(note).toMatch(/no-rise certification/);
    expect(note).toMatch(/zero rise to the 100-yr flood level/); // the inline definition
    expect(note).not.toMatch(/prohibited/i);
    expect(note).not.toMatch(/no fill/i);
    expect(note.includes("—")).toBe(false);
  });
});
