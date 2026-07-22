// v3 C3 — pond screening guards (warnings only): rim-above-grade → gravity-inflow +
// FFE-proximity amber chips. Pure; no browser.
import { describe, it, expect } from "vitest";
import { pondScreeningGuards, FFE_FREEBOARD_REQ_FT } from "../src/workspaces/site-planner/lib/pondScreeningGuards.js";

describe("pondScreeningGuards", () => {
  it("a rim at or below grade produces NO guards (a dug pond needs neither warning)", () => {
    expect(pondScreeningGuards({ rimVsGradeFt: 0, peakWseFt: 99, buildings: [{ label: "1", ffeFt: 99 }] })).toEqual([]);
    expect(pondScreeningGuards({ rimVsGradeFt: -3 })).toEqual([]);
    expect(pondScreeningGuards({ rimVsGradeFt: null })).toEqual([]);
    expect(pondScreeningGuards({})).toEqual([]);
  });

  it("a rim above grade always surfaces the gravity-inflow (inlets-through-the-berm) chip", () => {
    const guards = pondScreeningGuards({ rimVsGradeFt: 4 });
    expect(guards.map((g) => g.id)).toContain("berm-inlets");
    const inlets = guards.find((g) => g.id === "berm-inlets");
    expect(inlets.tone).toBe("amber");
    expect(inlets.text).toBe("Rim above site grade: runoff needs inlets through the berm");
  });

  it("the gravity-inflow chip alone appears when there is no routed peak elevation", () => {
    const guards = pondScreeningGuards({ rimVsGradeFt: 4, peakWseFt: null, buildings: [{ label: "1", ffeFt: 99 }] });
    expect(guards.map((g) => g.id)).toEqual(["berm-inlets"]);
  });

  it("FFE-proximity chip fires + names the LOWEST building when peak water is within 1 ft of its floor", () => {
    const guards = pondScreeningGuards({
      rimVsGradeFt: 4,
      peakWseFt: 98.5,
      buildings: [
        { label: "1", ffeFt: 99.2 }, // freeboard 0.7 ft < 1 → the offender (lowest)
        { label: "2", ffeFt: 101.0 }, // safe
      ],
    });
    const ffe = guards.find((g) => g.id === "ffe-freeboard");
    expect(ffe).toBeTruthy();
    expect(ffe.tone).toBe("amber");
    expect(ffe.text).toBe("Peak water 98.5 ft within 1 ft of Building 1 FFE 99.2 ft");
  });

  it("no FFE chip when every building keeps at least the required freeboard", () => {
    const guards = pondScreeningGuards({
      rimVsGradeFt: 4,
      peakWseFt: 98,
      buildings: [{ label: "1", ffeFt: 100 }, { label: "2", ffeFt: 101 }],
    });
    expect(guards.map((g) => g.id)).toEqual(["berm-inlets"]);
  });

  it("picks the lowest FFE even when it's listed second, and reports that building's number", () => {
    const guards = pondScreeningGuards({
      rimVsGradeFt: 4,
      peakWseFt: 97.9,
      buildings: [{ label: "A", ffeFt: 100 }, { label: "B", ffeFt: 98.4 }],
    });
    const ffe = guards.find((g) => g.id === "ffe-freeboard");
    expect(ffe.text).toContain("Building B FFE 98.4 ft");
  });

  it("buildings with no finished floor are ignored, never crash", () => {
    const guards = pondScreeningGuards({
      rimVsGradeFt: 4,
      peakWseFt: 98.5,
      buildings: [{ label: "1", ffeFt: null }, { label: "2" }],
    });
    expect(guards.map((g) => g.id)).toEqual(["berm-inlets"]);
  });

  it("the freeboard requirement constant is the 1 ft the chip copy promises", () => {
    expect(FFE_FREEBOARD_REQ_FT).toBe(1);
  });
});
