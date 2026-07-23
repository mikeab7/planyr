// PR-N (DECISION 4) — the outfall tailwater source ladder: district → FEMA FIS → USGS → normal-depth
// → proxy, always EST + source-tagged, with graceful degradation. Pure, fixture-driven.
import { describe, it, expect } from "vitest";
import {
  TAILWATER_SOURCES, deriveTailwater, normalDepthWse, channelTerrainWse, resolveTailwater, tailwaterNote, GRADE_PLACEHOLDER_EPS_FT,
} from "../src/workspaces/site-planner/lib/tailwaterSource.js";
import { assessBuildability } from "../src/workspaces/site-planner/lib/buildableEnvelope.js";

describe("deriveTailwater — priority ordering + EST/source tagging", () => {
  it("picks the district value when present, over lower-priority sources", () => {
    const r = deriveTailwater({ district: { valueFt: 148.1 }, femaFis: { valueFt: 147 }, usgs: { valueFt: 146 }, channelTerrain: { valueFt: 145 } });
    expect(r.valueFt).toBe(148.1);
    expect(r.source).toBe("district");
    expect(r.sourceLabel).toBe("district channel");
    expect(r.estimated).toBe(true);
    expect(r.degraded).toBe(false);
  });
  it("falls through the ladder in order as higher sources drop out", () => {
    expect(deriveTailwater({ femaFis: { valueFt: 147 }, usgs: { valueFt: 146 } }).source).toBe("femaFis");
    expect(deriveTailwater({ usgs: { valueFt: 146 }, normalDepth: { valueFt: 145 } }).source).toBe("usgs");
    expect(deriveTailwater({ normalDepth: { valueFt: 145 }, channelTerrain: { valueFt: 144 } }).source).toBe("normalDepth");
  });
  it("the channel-terrain fallback is flagged degraded (no higher receiving-water source resolved)", () => {
    const r = deriveTailwater({ channelTerrain: { valueFt: 144 } });
    expect(r.source).toBe("channelTerrain");
    expect(r.degraded).toBe(true);
    expect(r.estimated).toBe(true);
  });
  it("ignores non-finite candidate values and never fabricates one", () => {
    const r = deriveTailwater({ district: { valueFt: null }, femaFis: { valueFt: NaN }, usgs: { valueFt: 146 } });
    expect(r.source).toBe("usgs");
    const empty = deriveTailwater({});
    expect(empty.valueFt).toBeNull();
    expect(empty.degraded).toBe(true);
  });
  it("the registry is ordered by ascending priority (district first, channel-terrain last); NO grade proxy", () => {
    const ids = TAILWATER_SOURCES.map((s) => s.id);
    expect(ids[0]).toBe("district");
    expect(ids[ids.length - 1]).toBe("channelTerrain");
    expect(ids).not.toContain("proxy"); // O5 — the grade proxy is gone
    const pr = TAILWATER_SOURCES.map((s) => s.priority);
    expect([...pr].sort((a, b) => a - b)).toEqual(pr);
  });
});

describe("O5 — NEVER emit receiving water == site grade (placeholder guard)", () => {
  it("rejects a candidate that equals site grade and falls through to a real (below-grade) source", () => {
    // a source erroneously returns grade (153.1); the real channel data is 145.9 below grade
    const r = deriveTailwater({ femaFis: { valueFt: 153.1 }, channelTerrain: { valueFt: 145.9 } }, { gradeFt: 153.1 });
    expect(r.valueFt).toBe(145.9);
    expect(r.source).toBe("channelTerrain");
    expect(r.belowGrade).toBe(true);
    expect(r.rejectedGrade).toContain("femaFis");
  });
  it("when EVERY candidate equals grade, the result is UNKNOWN (null), never grade", () => {
    const r = deriveTailwater({ femaFis: { valueFt: 153.1 }, usgs: { valueFt: 153.12 } }, { gradeFt: 153.1 });
    expect(r.valueFt).toBeNull();
    expect(r.degraded).toBe(true);
    expect(r.rejectedGrade).toEqual(["femaFis", "usgs"]);
  });
  it("a value a hair beyond the placeholder epsilon is accepted (real data near grade is allowed)", () => {
    const r = deriveTailwater({ femaFis: { valueFt: 153.1 - GRADE_PLACEHOLDER_EPS_FT - 0.5 } }, { gradeFt: 153.1 });
    expect(r.valueFt).toBeCloseTo(152.55, 5);
    expect(r.source).toBe("femaFis");
  });
});

describe("channelTerrainWse — the below-grade flowline fallback (never grade)", () => {
  it("packages a below-grade channel invert", () => {
    const r = channelTerrainWse({ channelInvertFt: 145.9, gradeFt: 153.1 });
    expect(r.valueFt).toBe(145.9);
    expect(r.note).toMatch(/flowline from terrain/);
  });
  it("refuses an invert at/above grade (not a valid channel flowline)", () => {
    expect(channelTerrainWse({ channelInvertFt: 153.1, gradeFt: 153.1 })).toBeNull();
    expect(channelTerrainWse({ channelInvertFt: 155, gradeFt: 153.1 })).toBeNull();
    expect(channelTerrainWse({})).toBeNull();
  });
});

describe("normalDepthWse — Manning's normal depth (screening source d)", () => {
  it("solves a physical depth and returns WSE = invert + depth", () => {
    // a wide, mild channel carrying a moderate flow → a shallow-ish normal depth
    const r = normalDepthWse({ channelInvertFt: 145, dischargeCfs: 500, bottomWidthFt: 40, sideSlope: 3, manningN: 0.035, channelSlope: 0.001 });
    expect(r).toBeTruthy();
    expect(r.depthFt).toBeGreaterThan(0);
    expect(r.valueFt).toBeCloseTo(145 + r.depthFt, 6);
  });
  it("normal depth INCREASES with discharge (monotone), same channel", () => {
    const base = { channelInvertFt: 100, bottomWidthFt: 30, sideSlope: 2, manningN: 0.035, channelSlope: 0.002 };
    const lo = normalDepthWse({ ...base, dischargeCfs: 200 });
    const hi = normalDepthWse({ ...base, dischargeCfs: 800 });
    expect(hi.depthFt).toBeGreaterThan(lo.depthFt);
  });
  it("returns null on insufficient/non-physical inputs, never throws", () => {
    expect(normalDepthWse({})).toBeNull();
    expect(normalDepthWse({ channelInvertFt: 100, dischargeCfs: 0, bottomWidthFt: 30, channelSlope: 0.001 })).toBeNull();
    expect(normalDepthWse({ channelInvertFt: 100, dischargeCfs: 500, bottomWidthFt: 30, channelSlope: -1 })).toBeNull();
    // a tiny channel that can't pass a huge flow within maxDepth → out of screening range
    expect(normalDepthWse({ channelInvertFt: 100, dischargeCfs: 1e7, bottomWidthFt: 1, channelSlope: 0.0001, maxDepthFt: 20 })).toBeNull();
  });
});

describe("resolveTailwater — async orchestrator, graceful degradation", () => {
  it("uses a live fetcher when it resolves, over local candidates", async () => {
    const r = await resolveTailwater({
      fetchers: { district: async () => ({ valueFt: 153.1 }) },
      localCandidates: { normalDepth: { valueFt: 150 }, proxy: { valueFt: 149 } },
    });
    expect(r.source).toBe("district");
    expect(r.valueFt).toBe(153.1);
    expect(r.attempts.find((a) => a.id === "district").ok).toBe(true);
  });
  it("a fetcher that throws is logged and skipped; falls through to the local candidate", async () => {
    const r = await resolveTailwater({
      fetchers: { district: async () => { throw new Error("403 auth wall"); }, femaFis: async () => null },
      localCandidates: { normalDepth: { valueFt: 150 } },
    });
    expect(r.source).toBe("normalDepth");
    expect(r.attempts.find((a) => a.id === "district").ok).toBe(false);
    expect(r.attempts.find((a) => a.id === "district").reason).toMatch(/403/);
    expect(r.attempts.find((a) => a.id === "femaFis").ok).toBe(false);
  });
  it("no fetchers + only a channel-terrain candidate → degraded terrain result", async () => {
    const r = await resolveTailwater({ localCandidates: { channelTerrain: { valueFt: 144 } } });
    expect(r.source).toBe("channelTerrain");
    expect(r.degraded).toBe(true);
  });
  it("no source at all → UNKNOWN (null), never grade", async () => {
    const r = await resolveTailwater({ ctx: { gradeFt: 153.1 } });
    expect(r.valueFt).toBeNull();
    expect(r.degraded).toBe(true);
  });
});

describe("O5 — the grade placeholder deadlocked every pond; the fix un-sticks it", () => {
  const gradeFt = 153.1, outletInvertFt = 145.1, floorElev = 145.1; // Tsakiris shape: outlet at the floor, below grade
  it("the OLD behavior (tailwater == grade) fires the outfall gate on an outlet below grade (the deadlock)", () => {
    const r = assessBuildability({ tobElev: 157.1, gradeFt, floorElev, outletInvertFt, tailwaterFt: gradeFt });
    expect(r.hard.some((h) => h.code === "outfall-tailwater")).toBe(true); // "can't discharge by gravity"
  });
  it("the FIXED behavior: no real source → tailwater UNKNOWN (null) → the gate does NOT fire (deadlock broken)", () => {
    const tw = deriveTailwater({}, { gradeFt }).valueFt; // no channel source in the sandbox → null, never grade
    expect(tw).toBeNull();
    const r = assessBuildability({ tobElev: 157.1, gradeFt, floorElev, outletInvertFt, tailwaterFt: tw });
    expect(r.hard.some((h) => h.code === "outfall-tailwater")).toBe(false);
  });
  it("with a REAL below-grade channel tailwater, the outlet discharges by gravity (no block)", () => {
    const tw = deriveTailwater({ channelTerrain: { valueFt: 143.5 } }, { gradeFt }).valueFt; // channel cut below grade
    expect(tw).toBe(143.5);
    expect(tw).toBeLessThan(gradeFt);
    const r = assessBuildability({ tobElev: 157.1, gradeFt, floorElev, outletInvertFt, tailwaterFt: tw });
    expect(r.hard.some((h) => h.code === "outfall-tailwater")).toBe(false); // outlet 145.1 ≥ tailwater 143.5
  });
});

describe("tailwaterNote — plain-English, em-dash-free", () => {
  it("names the value + source when known", () => {
    const note = tailwaterNote(deriveTailwater({ district: { valueFt: 153.1 } }));
    expect(note).toMatch(/153\.1'/);
    expect(note).toMatch(/district channel/);
    expect(note).toMatch(/estimated/);
    expect(note.includes("—")).toBe(false);
  });
  it("says it's unknown when there's no value", () => {
    expect(tailwaterNote(deriveTailwater({}))).toMatch(/unknown/i);
  });
});
