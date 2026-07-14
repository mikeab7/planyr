// B809 — the fill-depth heat map's pure layer: bin/paint classing, bbox, legend
// compaction, the tie-out totals (identical to the ledger by construction — the same
// retained cells), and the hover lookup. The canvas painter is DOM-gated and returns
// null here (node env) — asserted so a headless-less run can never half-paint.
import { describe, it, expect } from "vitest";
import {
  DEPTH_BIN_FT, HEAT_RAMP, FLOODWAY_FILL, UNKNOWN_FILL,
  binIndex, cellPaint, heatmapBBox, heatmapLegend, heatmapTotals, cellAt, paintHeatmap,
} from "../src/workspaces/site-planner/lib/mitigationHeatmap.js";
import { computeMitigation } from "../src/workspaces/site-planner/lib/floodplainMitigation.js";
import { DEFAULT_FLOODPLAIN_RULES } from "../src/workspaces/site-planner/lib/floodplainRules.js";

const cell = (x, y, depthFt, cls = "1pct", wFt = 2, hFt = 2, fpId = "b1") => ({ cls, fpId, x, y, wFt, hFt, depthFt });

describe("bin / paint classing", () => {
  it("bins at 0.5 ft and clamps the top bin", () => {
    expect(binIndex(0)).toBe(0);
    expect(binIndex(0.49)).toBe(0);
    expect(binIndex(0.5)).toBe(1);
    expect(binIndex(3.4)).toBe(6);
    expect(binIndex(99)).toBe(HEAT_RAMP.length - 1);
  });
  it("floodway is prohibition hatch, never a depth color; null depth is unknown hatch", () => {
    expect(cellPaint(cell(0, 0, 2.5, "floodway")).kind).toBe("floodway");
    expect(cellPaint(cell(0, 0, 2.5, "floodway")).color).toBe(FLOODWAY_FILL);
    expect(cellPaint(cell(0, 0, null)).kind).toBe("unknown");
    expect(cellPaint(cell(0, 0, null)).color).toBe(UNKNOWN_FILL);
    expect(cellPaint(cell(0, 0, 1.2)).color).toBe(HEAT_RAMP[2]);
  });
});

describe("bbox + legend", () => {
  it("bbox spans the cell rectangles (centers ± half-size)", () => {
    const b = heatmapBBox([cell(10, 10, 1), cell(50, 30, 1, "1pct", 4, 4)]);
    expect(b).toEqual({ x: 9, y: 9, w: 43, h: 23 });
  });
  it("legend lists only the PRESENT bins + hatch classes, in depth order", () => {
    const rows = heatmapLegend([cell(0, 0, 0.2), cell(4, 0, 2.6), cell(8, 0, null), cell(12, 0, 1, "floodway")]);
    expect(rows.map((r) => r.kind)).toEqual(["depth", "depth", "floodway", "unknown"]);
    expect(rows[0].label).toBe("0.0–0.5′");
    expect(rows[1].label).toBe("2.5–3.0′");
  });
});

describe("tie-out totals — engine truth", () => {
  it("Σ cells × ratio equals the engine ledger exactly (same retained array)", () => {
    const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
    const zone = { cls: "1pct", zone: "AE", subtype: "", staticBfeFt: 100, aoDepthFt: null, vdatum: null, unstudiedA: false, rings: [rect(-50, -50, 400, 400)], bbox: [-50, -50, 350, 350] };
    const rule = { ...DEFAULT_FLOODPLAIN_RULES.harris, verified: true, ratio: 1.5 };
    const r = computeMitigation({
      footprints: [{ id: "b1", ring: rect(0, 0, 100, 100) }],
      zones: [zone], rule,
      elev: { padElevFt: 100, existGradeFt: 93, gradeAt: (pt) => 90 + 0.06 * pt.x, sources: { existGrade: "3dep" } },
      opts: { retainCells: true },
    });
    const t = heatmapTotals(r.cells, r.ratio);
    expect(Math.abs(t.volumeCf - r.volumeCf)).toBeLessThan(1e-6 * r.volumeCf);
    expect(t.perFpAcFt.b1).toBeCloseTo(r.volumeAcFt, 9);
  });
  it("floodway/unknown cells tally as acres, never volume", () => {
    const t = heatmapTotals([cell(0, 0, 1), cell(4, 0, null), cell(8, 0, 9, "floodway")], 1);
    expect(t.volumeCf).toBeCloseTo(4 * 1, 9);
    expect(t.unknownAcres).toBeGreaterThan(0);
    expect(t.floodwayAcres).toBeGreaterThan(0);
  });
});

describe("hover lookup + DOM gate", () => {
  it("cellAt hits the covering cell and misses outside", () => {
    const cells = [cell(10, 10, 1), cell(20, 10, 2)];
    expect(cellAt(cells, { x: 10.9, y: 9.1 }).depthFt).toBe(1);
    expect(cellAt(cells, { x: 15, y: 10 })).toBeNull();
    expect(cellAt(cells, null)).toBeNull();
  });
  it("paintHeatmap is honestly null with no DOM (never a half-painted exhibit)", () => {
    expect(paintHeatmap([cell(0, 0, 1)])).toBeNull();
  });
});
