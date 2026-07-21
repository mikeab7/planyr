// v3 UI SPEC Part B — the pond inspector's chip vocabulary (B4), the collapsed-group
// titles/summaries (B5), Dimensions labels (B3), and Purpose descriptors (B3.6). Pure-data
// tests (the repo's vitest config is DOM-free): the visible copy lives in
// lib/pondInspectorCopy.js so both the inspector and this guard read one source.
import { describe, it, expect } from "vitest";
import {
  POND_CHIP_DEFS, pondInspectorChips, POND_GROUPS, pondGroupSummary,
  POND_DIMENSION_LABELS, POND_PURPOSE_DESCRIPTOR, POND_PURPOSE_TOOLTIP, POND_FLOOD_NOTES,
} from "../src/workspaces/site-planner/lib/pondInspectorCopy.js";

const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
const EM_DASH = "—";

describe("B4 — top warning chips (exact copy + gating)", () => {
  it("has exactly the three watch-out chips, each ≤6 visible words with a non-empty ⓘ popover", () => {
    expect(POND_CHIP_DEFS.map((c) => c.text)).toEqual([
      "Flood level estimated",
      "Criteria unverified",
      "In floodway: no fill",
    ]);
    for (const c of POND_CHIP_DEFS) {
      expect(words(c.text), c.text).toBeLessThanOrEqual(6);
      expect(c.popover && c.popover.length, c.text).toBeGreaterThan(20);
      expect(c.tone, c.text).toBe("amber");
    }
  });

  it("the deleted 'Rim below flood level' and 'Elevations: NAVD88' chips are gone from the top set", () => {
    const texts = POND_CHIP_DEFS.map((c) => c.text);
    expect(texts).not.toContain("Rim below flood level");
    expect(texts.some((t) => /NAVD88/.test(t))).toBe(false);
  });

  it("only true conditions render; nothing flagged → no chips", () => {
    expect(pondInspectorChips({})).toEqual([]);
    const all = pondInspectorChips({ floodEstimated: true, criteriaUnverified: true, inFloodway: true });
    expect(all.map((c) => c.id)).toEqual(["flood-est", "crit-unv", "floodway"]);
    expect(pondInspectorChips({ inFloodway: true }).map((c) => c.id)).toEqual(["floodway"]);
  });

  it("no em dash in any chip text or popover (G2)", () => {
    for (const c of POND_CHIP_DEFS) {
      expect(c.text.includes(EM_DASH), c.text).toBe(false);
      expect(c.popover.includes(EM_DASH), c.text).toBe(false);
    }
  });
});

describe("B5.3 — the NAVD88 datum note relocates into the FLOOD & DATUM group", () => {
  it("keeps the NGVD29 warning verbatim-ish (nothing lost)", () => {
    expect(POND_FLOOD_NOTES.datum).toContain("NGVD29");
    expect(POND_FLOOD_NOTES.datum).toContain("NAVD88");
    expect(POND_FLOOD_NOTES.split).toContain("counts toward detention");
  });
});

describe("B3.6 — purpose descriptors + tooltip (exact copy)", () => {
  it("matches the spec strings", () => {
    expect(POND_PURPOSE_DESCRIPTOR).toEqual({
      auto: "picks by site needs",
      detention: "rate-control storage only",
      mitigation: "flood-fill offset only",
      hybrid: "both, split by elevation",
    });
    expect(POND_PURPOSE_TOOLTIP).toBe(
      "Auto: serve whatever the site needs. Detention: rate-control storage only. Mitigation: flood-fill offset only. Hybrid: both, split by elevation."
    );
  });
});

describe("B3 — Dimensions labels", () => {
  it("carries the six spec labels in order", () => {
    expect(POND_DIMENSION_LABELS).toEqual(["Water area", "Land take", "Depth", "Rim", "Holds", "Purpose"]);
  });
});

describe("B5 — the four collapsed groups + summaries", () => {
  it("exactly four groups, in fixed order, with the v3 titles", () => {
    expect(POND_GROUPS.map((g) => g.id)).toEqual(["sizing", "outlet", "flood", "appearance"]);
    expect(POND_GROUPS.map((g) => g.title)).toEqual([
      "Sizing & criteria", "Outlet & storms", "Flood & datum", "Appearance",
    ]);
  });

  it("summaries describe contents and carry NO ac-ft number (G6)", () => {
    const summaries = [
      pondGroupSummary.sizing({}),
      pondGroupSummary.outlet({ hasOutlet: false }),
      pondGroupSummary.outlet({ hasOutlet: true, stages: 2, fails: 0 }),
      pondGroupSummary.outlet({ hasOutlet: true, stages: 3, fails: 1 }),
      pondGroupSummary.flood({ wse: "153.1", estimated: true }),
      pondGroupSummary.flood({ wse: null }),
      pondGroupSummary.appearance({}),
    ];
    expect(summaries[0]).toBe("criteria & drainage");
    expect(summaries[1]).toBe("no outlet yet");
    expect(summaries[2]).toBe("2 stages · all storms PASS");
    expect(summaries[3]).toBe("3 stages · 1 FAIL");
    expect(summaries[4]).toBe("flood 153.1′ est. · NAVD88");
    expect(summaries[5]).toBe("NAVD88");
    expect(summaries[6]).toBe("fill · outline · opacity");
    for (const s of summaries) expect(/ac-ft/.test(s), s).toBe(false);
  });
});
