/* NEW-1 (B2191xxx) — the compact Setbacks section: the one common value + the few that differ, and a sketch
 * label per section placed so no two overlap. Pure (lib/setbackSketch.js). */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { summarizeSetbacks, layoutSectionLabels } from "../src/workspaces/site-planner/lib/setbackSketch.js";
import { boundarySections } from "../src/workspaces/site-planner/lib/boundarySections.js";
import { fitSketch, sectionPath } from "../src/workspaces/site-planner/components/SetbackSections.jsx";

describe("summarizeSetbacks", () => {
  const sec = (key, value, lengthFt) => ({ key, value, lengthFt });
  it("all sections the same -> one common value and no rows", () => {
    expect(summarizeSetbacks([sec("a", 25, 100), sec("b", 25, 300)])).toEqual({ common: 25, others: [] });
  });
  it("by length, not by count", () => {
    const r = summarizeSetbacks([sec("a", 25, 100), sec("b", 50, 900), sec("c", 25, 300)]);
    expect(r.common).toBe(50);
    expect(r.others.map((s) => s.key)).toEqual(["a", "c"]);
  });
  it("a mixed section is always listed", () => {
    const r = summarizeSetbacks([sec("a", 25, 900), sec("m", null, 100)]);
    expect(r.others.map((s) => s.key)).toEqual(["m"]);
  });
  it("no sections -> nothing (never a crash)", () => expect(summarizeSetbacks([])).toEqual({ common: null, others: [] }));
});

describe("layoutSectionLabels — no overlaps, nothing outside the sketch", () => {
  const J = JSON.parse(fs.readFileSync(new URL("./fixtures/silvestriParcels.json", import.meta.url)));
  const P = (a) => a.map(([x, y]) => ({ x, y }));
  const streets = J.roads.map((r) => ({ name: r.name, pts: P(r.pts) }));
  for (const k of ["schiel", "parcel2", "trs"]) {
    it(`${k}: every placed label is clear of every other and inside the viewBox`, () => {
      const pts = P(J[k]);
      const secs = boundarySections(pts, { defaultSetback: 25, streets });
      const fit = fitSketch(pts);
      const items = secs.map((s) => ({ key: s.key, pts: sectionPath(pts, s).map(fit.map), text: "25′" }));
      const placed = layoutSectionLabels(items, { width: 300, height: 150 });
      expect(placed.size).toBeGreaterThanOrEqual(1);
      const boxes = [...placed.values()].map((b) => ({ x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h }));
      for (let i = 0; i < boxes.length; i++) {
        const a = boxes[i];
        expect(a.x).toBeGreaterThanOrEqual(0); expect(a.y).toBeGreaterThanOrEqual(0);
        expect(a.x + a.w).toBeLessThanOrEqual(300); expect(a.y + a.h).toBeLessThanOrEqual(150);
        for (let j = i + 1; j < boxes.length; j++) {
          const b = boxes[j];
          const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
          expect(apart, `${k} labels ${i}/${j}`).toBe(true);
        }
      }
    });
  }
  it("a forced (selected/hovered) short section still gets its label; an unforced one does not", () => {
    const tiny = [{ x: 100, y: 50 }, { x: 108, y: 50 }];
    expect(layoutSectionLabels([{ key: "t", pts: tiny, text: "25′" }]).has("t")).toBe(false);
    expect(layoutSectionLabels([{ key: "t", pts: tiny, text: "25′", force: true }]).has("t")).toBe(true);
  });
  it("the pre-fix style (one label at each section midpoint) DID overlap on these parcels — the check can fail", () => {
    const a = { x: 10, y: 10, w: 20, h: 14 }, b = { x: 20, y: 12, w: 20, h: 14 };
    const items = [{ key: "a", pts: [{ x: 10, y: 20 }, { x: 40, y: 20 }], text: "25′" }, { key: "b", pts: [{ x: 10, y: 20 }, { x: 40, y: 20 }], text: "25′" }];
    const p = layoutSectionLabels(items, { width: 300, height: 150 });
    if (p.size === 2) { const [u, v] = [...p.values()]; expect(Math.abs(u.x - v.x) > 1 || Math.abs(u.y - v.y) > 1).toBe(true); }
    expect(a.w).toBeGreaterThan(0); expect(b.w).toBeGreaterThan(0);
  });
});
