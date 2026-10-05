/* HARD REQUIREMENT (owner): "if I do the split without ever coming into the left-hand menu, just
 * from the right-hand menu, it'll still work, same thing with merge." The Parcels panel and the map
 * toolbar must run the SAME single combine and the SAME single split.
 *
 * Two halves, because the component cannot be rendered in a unit test:
 *  1. BEHAVIOURAL — the planner both entry points call, driven the way each one drives it (panel:
 *     explicit ids / explicit target; map: the picked set / the selected parcel), yields IDENTICAL
 *     resulting parcels (same names, geometry, include/lock state, history, totals).
 *  2. STRUCTURAL — SitePlanner.jsx has exactly one construction site for each; every entry point
 *     routes into it; nothing else builds a tract or a piece. (The live both-entry-points run is
 *     ui-audit/verify-parcel-combine-split.mjs.) */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { planCombine, planSplit, includedAcres } from "../src/workspaces/site-planner/lib/parcelOps.js";

const src = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/workspaces/site-planner/components/ParcelsPanel.jsx", import.meta.url), "utf8");

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const mergeRings = (a, b) => {
  const bb = (r) => ({ x0: Math.min(...r.map((p) => p.x)), x1: Math.max(...r.map((p) => p.x)), y0: Math.min(...r.map((p) => p.y)), y1: Math.max(...r.map((p) => p.y)) });
  const A = bb(a), B = bb(b);
  if (!(A.y0 === B.y0 && A.y1 === B.y1 && (A.x1 === B.x0 || B.x1 === A.x0))) return null;
  return rect(Math.min(A.x0, B.x0), A.y0, Math.max(A.x1, B.x1) - Math.min(A.x0, B.x0), A.y1 - A.y0);
};
const fresh = () => { let n = 0; return () => `n${++n}`; };
const plan = () => ["a", "b", "c", "d"].map((id, i) => ({ id, points: rect(i * 100, 0, 100, 100), locked: true, acct: `APN${i}` }));
const strip = (o) => JSON.parse(JSON.stringify(o));

describe("behavioural parity — panel entry vs map entry", () => {
  it("combine: the panel's checked rows and the map's picked set give identical state", () => {
    const viaPanel = planCombine(plan(), ["a", "b", "c"], { mergeRings, newId: fresh() });
    const viaMap = planCombine(plan(), ["c", "a", "b"].sort(), { mergeRings, newId: fresh() }); // pick order is not significant
    expect(strip(viaPanel.parcels)).toEqual(strip(viaMap.parcels));
    expect(viaPanel.name).toBe(viaMap.name);
    expect(viaPanel.removeIds.sort()).toEqual(viaMap.removeIds.sort());
    expect(includedAcres(viaPanel.parcels)).toBe(includedAcres(viaMap.parcels));
  });
  it("split: aiming the cut from the panel and selecting the parcel on the map give identical state", () => {
    const cut = [{ x: 50, y: -10 }, { x: 50, y: 110 }];
    const viaPanel = planSplit(plan(), cut, { targetId: "a", newId: fresh() });
    const viaMap = planSplit(plan(), cut, { selId: "a", newId: fresh() });
    const viaBareTool = planSplit(plan(), cut, { newId: fresh() });
    expect(strip(viaPanel.parcels)).toEqual(strip(viaMap.parcels));
    expect(strip(viaPanel.parcels)).toEqual(strip(viaBareTool.parcels));
    expect(viaPanel.made.map((m) => m.splitName)).toEqual(viaMap.made.map((m) => m.splitName));
  });
  it("refusals are identical too (same message from either entry)", () => {
    const a = planCombine(plan(), ["a", "c"], { mergeRings, newId: fresh() });
    const b = planCombine(plan(), ["c", "a"], { mergeRings, newId: fresh() });
    expect(a.message).toBe(b.message);
  });
});

describe("structural parity — SitePlanner.jsx has ONE combine and ONE split", () => {
  const count = (s, needle) => s.split(needle).length - 1;
  it("every map entry point (Merge button, Enter, right-click menu) reaches the one combine", () => {
    expect(src).toContain("const mergeParcels = () => combineParcelsAction(combineSel);");
    expect(count(src, "planCombine(")).toBe(2);               // the applier + the panel's dry-run preview (same planner)
    expect(src).toMatch(/onCombine: combineParcelsAction/);   // the panel's Combine button
    expect(src).toMatch(/mergeParcels\(\)/);                  // Enter / menu still call it
  });
  it("every split entry point (Finish, Enter, double-click, panel Split) reaches the one split", () => {
    expect(count(src, "planSplit(")).toBe(1);
    expect(src).toMatch(/const finishSplit = \(\) => \{\s*if \(splitPath\.length >= 2\) performSplit\(splitPath\);/);
    expect(src).toMatch(/onSplit: startPanelSplit/);
    expect(src).toMatch(/selectTool\("split"\); \/\/ arms the SAME map tool/);
  });
  it("nothing else builds a tract or a piece, or runs the cut / union engines directly", () => {
    expect(count(src, "splitPolygonByCut(")).toBe(0);
    expect(src).not.toMatch(/const merged = mergeRings\(/);   // the old inline union loop is gone; the combine receives mergeRings by injection
    expect(src).not.toMatch(/combined:\s*\{\s*from/);
    expect(src).not.toMatch(/splitFrom:\s*\{/);
  });
  it("the panel component is presentational — it imports no planner", () => {
    expect(panel).not.toMatch(/planCombine|planSplit|mergeRings|splitPolygonByCut/);
  });
});
