import { describe, it, expect } from "vitest";
import {
  EMPTY_PREFS, DEFAULT_DASHBOARD_LAYOUT, DASHBOARD_CARD_IDS, _normalizePrefs, setDashboardLayoutPref,
} from "../src/workspaces/site-planner/lib/userPrefs.js";

describe("userPrefs — dashboardLayout (B1196305, NEW-2)", () => {
  it("defaults to every card, at width md, in the catalog's own order", () => {
    expect(EMPTY_PREFS.dashboardLayout).toEqual(DEFAULT_DASHBOARD_LAYOUT);
    expect(DEFAULT_DASHBOARD_LAYOUT.map((c) => c.id)).toEqual(DASHBOARD_CARD_IDS);
    expect(DEFAULT_DASHBOARD_LAYOUT.every((c) => c.width === "md")).toBe(true);
  });

  it("a fresh/never-customized prefs row normalizes to the full default board", () => {
    expect(_normalizePrefs(null).dashboardLayout).toEqual(DEFAULT_DASHBOARD_LAYOUT);
    expect(_normalizePrefs({}).dashboardLayout).toEqual(DEFAULT_DASHBOARD_LAYOUT);
  });

  it("keeps a well-formed custom order/width, subsetted and reordered", () => {
    const p = _normalizePrefs({ dashboardLayout: [{ id: "jumpBackIn", width: "lg" }, { id: "goingQuiet", width: "sm" }] });
    expect(p.dashboardLayout).toEqual([{ id: "jumpBackIn", width: "lg" }, { id: "goingQuiet", width: "sm" }]);
  });

  it("drops an unknown card id and a duplicate, keeping the first occurrence", () => {
    const p = _normalizePrefs({ dashboardLayout: [
      { id: "jumpBackIn", width: "md" }, { id: "bogusCard", width: "md" }, { id: "jumpBackIn", width: "lg" },
    ] });
    expect(p.dashboardLayout).toEqual([{ id: "jumpBackIn", width: "md" }]);
  });

  it("an unrecognized width falls back to md", () => {
    const p = _normalizePrefs({ dashboardLayout: [{ id: "jumpBackIn", width: "huge" }] });
    expect(p.dashboardLayout).toEqual([{ id: "jumpBackIn", width: "md" }]);
  });

  // ⛔ NO EMPTY LAYOUT MAY BE REACHABLE FROM ANY ENTRY POINT — every one of these malformed
  // shapes must fall all the way back to the full default board, never an empty array.
  it("never produces an empty board, from any malformed input", () => {
    expect(_normalizePrefs({ dashboardLayout: "nope" }).dashboardLayout).toEqual(DEFAULT_DASHBOARD_LAYOUT);
    expect(_normalizePrefs({ dashboardLayout: [] }).dashboardLayout).toEqual(DEFAULT_DASHBOARD_LAYOUT);
    expect(_normalizePrefs({ dashboardLayout: [{ id: "bogusCard" }] }).dashboardLayout).toEqual(DEFAULT_DASHBOARD_LAYOUT);
    expect(_normalizePrefs({ dashboardLayout: [null, 42, "x"] }).dashboardLayout).toEqual(DEFAULT_DASHBOARD_LAYOUT);
  });

  it("setDashboardLayoutPref replaces the board wholesale and still refuses an empty result", () => {
    const p1 = setDashboardLayoutPref(null, [{ id: "compsSummary", width: "sm" }]);
    expect(p1.dashboardLayout).toEqual([{ id: "compsSummary", width: "sm" }]);
    const p2 = setDashboardLayoutPref(p1, []);
    expect(p2.dashboardLayout).toEqual(DEFAULT_DASHBOARD_LAYOUT);
  });
});
