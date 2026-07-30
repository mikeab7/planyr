/* NEW-1 — every manipulation handle lives in the ONE always-on-top handle layer.
 *
 * The owner's repro: a reference overlay's top-right resize grip fell under the parcel boundary,
 * so it was both invisible and ungrabbable and the overlay could not be resized from that corner.
 * The cause was structural — the grip was authored INSIDE the content pass that draws the overlay,
 * which paints below the parcel — and the same trap sat under the callout's width grips and the
 * measurement's control points, both authored inside their own content passes.
 *
 * This is a SOURCE guard rather than a render assertion because the property is about document
 * ORDER, which is exactly what a re-render can silently change and a screenshot can hide. In SVG
 * a later sibling both paints over and hit-tests ahead of an earlier one, so "last child of the
 * feet-space transform" IS the fix; the e2e spec (references-handle-layer.spec.js) proves the
 * consequence on a real render, and this proves nobody quietly authored a new handle inline again.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SP = readFileSync(join(here, "../src/workspaces/site-planner/SitePlanner.jsx"), "utf8");

/* The handle layer's markup: the group, and the consts rendered into it. */
const LAYER_OPEN = '<g data-export="skip" data-handle-layer="1">';
const layerStart = SP.indexOf(LAYER_OPEN);
const layerBlock = SP.slice(layerStart, SP.indexOf("</g>", SP.indexOf("{insHint &&", layerStart)));

/* The feet-space CONTENT passes: the canvas render from the <svg> open up to (but not including)
 * the handle layer. Deliberately NOT "everything before the layer" — the hoisted handle consts are
 * built in the component body far above the render, and they are exactly what should be there. */
const contentBefore = SP.slice(SP.indexOf("<svg ref={svgRef}"), layerStart);

describe("NEW-1: the handle layer exists and is the LAST child of the feet-space transform", () => {
  it("the group is tagged so a render check can find it, and is export-skipped", () => {
    expect(layerStart, "the data-handle-layer group is gone").toBeGreaterThan(-1);
  });

  it("nothing but the print-frame / screen-space chrome follows it inside the canvas", () => {
    const after = SP.slice(layerStart);
    // The next thing after the handle layer closes is the close of the feet-space <g>. Anything
    // else drawn in feet space after it would paint OVER the handles — the exact bug.
    const closeIdx = after.indexOf("{insHint &&");
    const tail = after.slice(closeIdx, after.indexOf("{/* print-frame crop overlay"));
    expect(tail).not.toMatch(/\.map\(render/);
    expect(tail).not.toMatch(/drawElsZ|drawMarkupsZ|drawParcels|overlayBands/);
  });
});

describe("NEW-1: every handle set is rendered from the handle layer, not from a content pass", () => {
  const sets = [
    "handleNodes",        // element resize / rotate / road vertices
    "sideAddNodes",
    "parkingAddNodes",
    "parcelHandles",      // parcel vertex handles
    "elPolyHandles",      // polygon-element vertex handles
    "markupHandles",      // markup resize / rotate / vertex handles
    "calloutHandles",     // NEW-1 — hoisted
    "measureHandles",     // NEW-1 — hoisted
    "overlayChrome",      // NEW-1 — hoisted (the reported case)
  ];
  it.each(sets)("%s is rendered inside the handle layer", (name) => {
    expect(layerBlock, `${name} is not rendered from the handle layer`).toContain(`{${name}}`);
  });

  /* The three drag-starters that USED to be bound inline. If any of these reappears in a content
   * pass, its handle is back under the map content and back to being ungrabbable. */
  const hoisted = ["startScaleOverlay", "startRotateOverlay", "startCalloutResize", "startMeasureVertex", "startMoveCallout(e, c.id, \"tip\""];
  it.each(hoisted)("%s is bound ONLY from the handle layer, never from a content pass", (fn) => {
    const inContent = contentBefore.includes(`onPointerDown={(e) => ${fn}`) || contentBefore.includes(`onPointerDown={canResize ? (e) => ${fn}`);
    expect(inContent, `${fn} is wired inside a content pass again — that handle can be buried`).toBe(false);
  });
});

describe("NEW-1: the hoisted handles keep the behaviour they had before the move", () => {
  it("every handle is still stripped from the exported sheet", () => {
    for (const set of ["const overlayChrome = ", "const calloutHandles = ", "const measureHandles = "]) {
      const at = SP.indexOf(set);
      expect(at, `${set} is missing`).toBeGreaterThan(-1);
      expect(SP.slice(at, at + 4000)).toMatch(/data-export="skip"/);
    }
  });

  it("the overlay grips still ride the overlay's own rotation transform (they must stay on its corners)", () => {
    const at = SP.indexOf("const overlayChrome = ");
    expect(SP.slice(at, at + 4000)).toMatch(/transform=\{o\.rotation \? `rotate\(\$\{o\.rotation\} \$\{cx\} \$\{cy\}\)` : undefined\}/);
  });

  it("a LOCKED reference still shows no grips, and calibration mode still hides them", () => {
    const at = SP.indexOf("const overlayChrome = ");
    expect(SP.slice(at, at + 4000)).toMatch(/!o\.locked && !ovCalib/);
  });

  it("a locked callout keeps pointer-inert grips, and a locked measurement gets none", () => {
    const c = SP.indexOf("const calloutHandles = ");
    expect(SP.slice(c, c + 3000)).toMatch(/const canResize = !c\.locked/);
    const m = SP.indexOf("const measureHandles = ");
    expect(SP.slice(m, m + 2000)).toMatch(/if \(!m \|\| m\.locked\) return null/);
  });

  it("B1184/B1185 are untouched — the thinning helper still drives the vertex handles", () => {
    // The move is about WHICH LAYER a handle lives in, never its size or count.
    expect(SP).toMatch(/const parcelHandles = \(\(\) => \{[\s\S]{0,400}decimatedHandles\(/);
    expect(SP).toMatch(/const elPolyHandles = \(\(\) => \{[\s\S]{0,400}decimatedHandles\(/);
  });
});
