/* NEW-1 — Site Analysis "Activate layer" must never zoom the owner out or move a view that
 * already shows his site. Red-proof: the pre-fix rule (fit parcels + 0.6 margin) is replayed
 * below and MUST fail the same assertions, so these cases can tell the two apart. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { activateLayerView, activeParcelBox } from "../src/workspaces/site-planner/lib/activateFraming.js";

const size = { w: 1000, h: 700 };
const parcels = [{ active: true, points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }] }];
const box = activeParcelBox(parcels);

/* The old body of frameToActiveParcels, verbatim math. */
function oldFrame(box, size, marginFrac = 0.6) {
  let { minX, minY, maxX, maxY } = box;
  const bw = Math.max(maxX - minX, 10), bh = Math.max(maxY - minY, 10);
  minX -= bw * marginFrac; maxX += bw * marginFrac; minY -= bh * marginFrac; maxY += bh * marginFrac;
  const ebw = maxX - minX, ebh = maxY - minY, pad = 40;
  const ppf = Math.max(0.02, Math.min(8, Math.min((size.w - pad * 2) / ebw, (size.h - pad * 2) / ebh)));
  return { ppf, offX: pad - minX * ppf + (size.w - pad * 2 - ebw * ppf) / 2, offY: pad - minY * ppf + (size.h - pad * 2 - ebh * ppf) / 2 };
}

describe("activateLayerView", () => {
  const closeView = { ppf: 1.6, offX: 150, offY: 100 }; // parcel fills much of the screen

  it("leaves a view that already shows the site EXACTLY as it is", () => {
    expect(activateLayerView({ view: closeView, size, box })).toBe(closeView);
  });
  it("the pre-fix rule fails that same case (red proof)", () => {
    const o = oldFrame(box, size);
    expect(o.ppf).toBeLessThan(closeView.ppf);
  });
  it("site off screen → pans to centre it at the SAME scale", () => {
    const off = { ppf: 1.6, offX: 5000, offY: 5000 };
    const v = activateLayerView({ view: off, size, box });
    expect(v.ppf).toBe(off.ppf);
    const cx = ((box.minX + box.maxX) / 2) * v.ppf + v.offX, cy = ((box.minY + box.maxY) / 2) * v.ppf + v.offY;
    expect(cx).toBeCloseTo(size.w / 2); expect(cy).toBeCloseTo(size.h / 2);
    expect(v.ppf).toBeGreaterThanOrEqual(off.ppf);
  });
  it("scale-gated layer while too far out → zooms IN to the gate, never out", () => {
    const far = { ppf: 0.2, offX: 400, offY: 300 };
    const v = activateLayerView({ view: far, size, box, minPpf: 0.5 });
    expect(v.ppf).toBe(0.5);
  });
  it("already past the gate → no zoom change even when a gate is given", () => {
    expect(activateLayerView({ view: closeView, size, box, minPpf: 0.5 })).toBe(closeView);
  });
  it("many activations in a row do not drift", () => {
    let v = closeView;
    for (let i = 0; i < 10; i++) v = activateLayerView({ view: v, size, box, minPpf: 0.5 });
    expect(v).toBe(closeView);
  });
  it("no active parcels → no-op", () => {
    expect(activeParcelBox([{ active: false, points: parcels[0].points }])).toBeNull();
  });
});

describe("no other path reframes on activate / layer load", () => {
  const src = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
  it("toggleAnalysisLayer goes through the non-zooming helper, not a margin fit", () => {
    expect(src).toMatch(/activateLayerView\(\{ view: v, size, box, minPpf \}\)/);
    expect(src).not.toMatch(/frameToActiveParcels = useCallback\(\(marginFrac/);
  });
  it("no layer status/load callback calls requestFit or fitBounds", () => {
    const layers = readFileSync(new URL("../src/workspaces/site-planner/lib/layers.js", import.meta.url), "utf8");
    expect(layers).not.toMatch(/fitBounds|requestFit|fitReq/);
    const m = src.match(/const toggleAnalysisLayer[\s\S]*?\}, \[setOverlays/)[0];
    expect(m).not.toMatch(/requestFit|setFitReq/);
  });
});
