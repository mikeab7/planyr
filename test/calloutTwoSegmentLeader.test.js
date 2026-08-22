/* NEW-1 (two-segment leader, owner report 2026-08-22 — "I like on Bluebeam how the callouts
 * have two lines in the arm... how you can manipulate the two arms"). A callout leader is now a
 * stub (box edge → elbow) + a run (elbow → target), with the elbow independently draggable.
 *
 * The render/drag WIRING lives inside SitePlanner.jsx (a single giant component; the geometry
 * itself is pure and covered by markupModel.test.js's "two-segment leader" describe block). This
 * is a SOURCE guard, mirroring parcelClickRouting.test.js / handleLayerOrder.test.js, for the
 * properties a render/behavioural test can't easily reach in this sandbox: that the render's
 * elbow defaults to the ORIGIN (byte-identical old straight line) rather than some other point,
 * and that the drag machinery is wired symmetrically with the existing tip/box handles.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SP = readFileSync(join(here, "../src/workspaces/site-planner/SitePlanner.jsx"), "utf8");

describe("NEW-1: the callout leader is a stub + elbow + run, defaulting to today's straight line", () => {
  it("calloutElbows mirrors calloutTips's singular/plural read rule", () => {
    expect(SP.includes('const calloutElbows = (c) => (Array.isArray(c.elbows) ? c.elbows : (c.elbow ? [c.elbow] : []));')).toBe(true);
  });

  it("the render's elbow defaults to the box-edge ORIGIN when unpinned — zero-length stub, byte-identical old line", () => {
    const renderStart = SP.indexOf("const renderCalloutNode = (c) => {");
    const renderEnd = SP.indexOf("const drawParcels = useMemo");
    expect(renderStart).toBeGreaterThan(-1);
    const region = SP.slice(renderStart, renderEnd);
    expect(region.includes("const elbow = elbowW ? f2p(elbowW) : origin;")).toBe(true);
    // Both segments (stub AND run) must actually be drawn, or the two-segment claim is cosmetic.
    expect(region.includes('data-testid={`callout-leader-stub-${c.id}-${i}`}')).toBe(true);
    expect(region.includes('data-testid={`callout-leader-run-${c.id}-${i}`}')).toBe(true);
    // The arrowhead angle comes from the ELBOW→tip segment (the run), not origin→tip — so a
    // pinned elbow actually re-aims the arrowhead, not just the stub.
    expect(region.includes("Math.atan2(tp.y - elbow.y, tp.x - elbow.x)")).toBe(true);
  });

  it("dragging the elbow snapshots every leader's CURRENT elbow (pinned or the live default), so the grab tracks the cursor exactly", () => {
    const starterStart = SP.indexOf("const startMoveCallout = (e, id, part, tipIndex = 0) => {");
    const starterEnd = SP.indexOf("const startCalloutResize = (e, id, hx) => {");
    expect(starterStart).toBeGreaterThan(-1);
    const region = SP.slice(starterStart, starterEnd);
    expect(region.includes("elbows0")).toBe(true);
    expect(region.includes("nearestRectPerimeterPoint(boxRectFt, tp)")).toBe(true);
  });

  it("the apply-on-move dispatcher moves ONLY the dragged leader's elbow, collapsing singular/plural like tip/tips", () => {
    const dispatchStart = SP.indexOf('if (d.mode === "callout") {');
    const dispatchEnd = SP.indexOf('if (d.mode === "draw") {');
    expect(dispatchStart).toBeGreaterThan(-1);
    const region = SP.slice(dispatchStart, dispatchEnd);
    expect(region.includes('d.part === "elbow"')).toBe(true);
    expect(region.includes("elbow: elbows[0], elbows: undefined")).toBe(true);
  });

  it("the elbow grip lives in the handle layer (calloutHandles), not a content pass", () => {
    const handlesStart = SP.indexOf("const calloutHandles = (() => {");
    const handlesEnd = SP.indexOf("const measureHandles = (() => {");
    expect(handlesStart).toBeGreaterThan(-1);
    const region = SP.slice(handlesStart, handlesEnd);
    expect(region.includes('data-handle="callout-elbow"')).toBe(true);
    expect(region.includes('startMoveCallout(e, c.id, "elbow", i)')).toBe(true);
  });

  it("a whole-callout translate (multi-select drag, duplicate, cross-plan paste) carries a pinned elbow along", () => {
    const mm = readFileSync(join(here, "../src/shared/markup/markupModel.js"), "utf8");
    expect(mm.includes("if (m.elbow) out.elbow = { x: m.elbow.x + dx, y: m.elbow.y + dy };")).toBe(true);
    const pc = readFileSync(join(here, "../src/workspaces/site-planner/lib/planClipboard.js"), "utf8");
    expect(pc.includes("else if (c.elbow) out.elbow = { x: c.elbow.x + dx, y: c.elbow.y + dy };")).toBe(true);
  });
});
