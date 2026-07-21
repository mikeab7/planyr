// FINAL UI SPEC Part A — the condensed pond inspector's chip vocabulary (A3, exact copy +
// conditions) and word budget (A4). Pure-data tests (the repo's vitest config is DOM-free):
// the visible copy lives in lib/pondInspectorCopy.js so both the inspector and this guard read
// one source, and the word count is computed off that source rather than a live render.
import { describe, it, expect } from "vitest";
import {
  POND_CHIP_DEFS, pondInspectorChips, POND_GROUPS, pondGroupSummary,
  POND_PURPOSE_TOOLTIPS,
} from "../src/workspaces/site-planner/lib/pondInspectorCopy.js";

const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;

describe("A3 — chip vocabulary (exact copy + gating)", () => {
  it("has exactly the five specified chips, each ≤6 visible words with a non-empty ⓘ popover", () => {
    expect(POND_CHIP_DEFS.map((c) => c.text)).toEqual([
      "Flood level is estimated",
      "Rim below flood level",
      "Criteria unverified",
      "Elevations: NAVD88",
      "In floodway: no fill",
    ]);
    for (const c of POND_CHIP_DEFS) {
      expect(words(c.text), c.text).toBeLessThanOrEqual(6);
      expect(c.popover && c.popover.length, c.text).toBeGreaterThan(20); // full sentence moved here
    }
  });

  it("tones: NAVD88 is neutral, the four watch-outs are amber", () => {
    const tone = Object.fromEntries(POND_CHIP_DEFS.map((c) => [c.id, c.tone]));
    expect(tone.navd88).toBe("neutral");
    for (const id of ["flood-est", "rim-below", "crit-unv", "floodway"]) expect(tone[id]).toBe("amber");
  });

  it("only true conditions render; NAVD88 always renders", () => {
    // Nothing flagged → only the always-on datum chip.
    expect(pondInspectorChips({}).map((c) => c.id)).toEqual(["navd88"]);
    // Everything flagged → all five, in spec order.
    const all = pondInspectorChips({ floodEstimated: true, rimBelowFlood: true, criteriaUnverified: true, inFloodway: true });
    expect(all.map((c) => c.id)).toEqual(["flood-est", "rim-below", "crit-unv", "navd88", "floodway"]);
    // A single flag toggles exactly its chip.
    expect(pondInspectorChips({ inFloodway: true }).map((c) => c.id)).toEqual(["navd88", "floodway"]);
  });

  it("the deleted flood/datum sentences survive verbatim-ish inside chip popovers (nothing lost)", () => {
    const pop = Object.fromEntries(POND_CHIP_DEFS.map((c) => [c.id, c.popover]));
    expect(pop["flood-est"]).toContain("ESTIMATED flood WSE");
    expect(pop["rim-below"]).toContain("usable detention is ZERO");
    expect(pop["crit-unv"]).toContain("unverified placeholders");
    expect(pop["navd88"]).toContain("NGVD29");
    expect(pop["floodway"]).toContain("regulatory floodway");
  });
});

describe("A1.4 — purpose tooltips (exact copy)", () => {
  it("matches the spec strings", () => {
    expect(POND_PURPOSE_TOOLTIPS).toEqual({
      auto: "Pick by site needs",
      detention: "Rate-control storage only",
      mitigation: "Flood-fill offset only",
      hybrid: "Both, split by elevation",
    });
  });
});

describe("A1.6 — the four collapsed groups + summaries", () => {
  it("exactly four groups, in fixed order", () => {
    expect(POND_GROUPS.map((g) => g.id)).toEqual(["sizing", "outlet", "flood", "appearance"]);
    expect(POND_GROUPS.map((g) => g.title)).toEqual([
      "Sizing & criteria", "Outlet & storms", "Flood & datum notes", "Appearance",
    ]);
  });

  it("summaries render the specified shapes", () => {
    expect(pondGroupSummary.sizing({ reqLo: "28.60", reqHi: "33.80", drainageAc: "52.04" }))
      .toBe("req 28.60–33.80 ac-ft · drainage 52.04 ac");
    expect(pondGroupSummary.outlet({ hasOutlet: false })).toBe("no outlet");
    expect(pondGroupSummary.outlet({ hasOutlet: true, stages: 2, allPass: true })).toBe("2 stages · all storms PASS");
    expect(pondGroupSummary.outlet({ hasOutlet: true, stages: 2, allPass: null })).toBe("2 stages");
    expect(pondGroupSummary.flood({ wse: "153.1", estimated: true })).toBe("flood level 153.1′ (estimated)");
    expect(pondGroupSummary.flood({ wse: null })).toBe("no flood data");
    expect(pondGroupSummary.appearance({})).toBe("fill · outline · opacity");
  });
});

describe("A4 — visible word budget (default state, all groups closed)", () => {
  it("stays under 200 words (and comfortably under the 120 target excluding values)", () => {
    // The default-visible copy = every chip (worst case: all conditions true) + the four group
    // titles + their closed-state summaries + the two fixed sub-headings. At-a-glance/status-card
    // VALUES are excluded per the spec.
    const chipWords = pondInspectorChips({ floodEstimated: true, rimBelowFlood: true, criteriaUnverified: true, inFloodway: true })
      .reduce((n, c) => n + words(c.text), 0);
    const titleWords = POND_GROUPS.reduce((n, g) => n + words(g.title), 0);
    const summaryWords = [
      pondGroupSummary.sizing({ reqLo: "28.60", reqHi: "33.80", drainageAc: "52.04" }),
      pondGroupSummary.outlet({ hasOutlet: true, stages: 2, allPass: null }),
      pondGroupSummary.flood({ wse: "153.1", estimated: true }),
      pondGroupSummary.appearance({}),
    ].reduce((n, s) => n + words(s), 0);
    const fixed = words("At a glance") + words("Detention storage");

    const total = chipWords + titleWords + summaryWords + fixed;
    expect(total).toBeLessThan(200);
    // The chips + titles + fixed headings (no summary values) are the "excluding values" set.
    expect(chipWords + titleWords + fixed).toBeLessThan(120);
  });
});
