// source-scan: the layer drives a real Leaflet map and DOM, which cannot run in node; behaviour was measured in a browser harness (see PR #3090).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Ghost-on-zoom: an <img> with no transform/size paints at its natural pixel size at the pane origin
// (big, opaque, bottom-left, then gone). The layer must stay hidden until it has a finite placement.
// Behaviour was measured in a real Leaflet map (unsolved layer: visible 3000px-wide before, hidden after).
const src = readFileSync("src/workspaces/site-planner/lib/rotatedImageLayer.js", "utf8");

describe("rotatedImageLayer never paints an unplaced image", () => {
  it("starts hidden and un-eased", () => {
    expect(src).toMatch(/img\.style\.visibility = "hidden";\s*\n\s*img\.style\.transition = "none";/);
  });
  it("hides when there is no size or corners", () => {
    expect(src).toMatch(/if \(!corners \|\| !imgW \|\| !imgH\) \{ img\.style\.visibility = "hidden"; return; \}/);
  });
  it("every transform write goes through the finite-matrix guard", () => {
    expect(src).not.toMatch(/img\.style\.transform = matrixFor/);
    expect(src.match(/writeTransform\(matrixFor/g)).toHaveLength(2);
  });
});
