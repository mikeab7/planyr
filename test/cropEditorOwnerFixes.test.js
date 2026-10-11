/* The 2026-10-11 crop-editor owner block (NEW-1 … NEW-7) — pure rules + source guards. The real-browser proof is
 * ui-audit/verify-crop-editor-ux.mjs (layout, right-click, reset, layering on the Site tab) and the signed-in
 * verify-crop-editor-live.mjs (the Map/Comps modal, the Adjust panel, lock, scale). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  nearestEdgeIndex, addPointAtNearestEdge, deletePointAt, canDeletePoint, MIN_POLY_VERTICES, MAX_POLY_VERTICES,
  clipPathValueForCrop, cropKind, cropEditBlock,
} from "../src/shared/overlay/overlayCrop.js";

const tool = readFileSync("src/shared/sitePlans/components/ImageCropTool.jsx", "utf8");
const modal = readFileSync("src/shared/sitePlans/components/CropModal.jsx", "utf8");
const section = readFileSync("src/shared/sitePlans/components/SitePlansSection.jsx", "utf8");
const siteDialog = readFileSync("src/workspaces/site-planner/components/OverlayCropDialog.jsx", "utf8");
const layers = readFileSync("src/workspaces/site-planner/lib/useSitePlanOverlayLayers.js", "utf8");

const SQUARE = [[0, 0], [100, 0], [100, 100], [0, 100]];

describe("NEW-4 — right-click add/delete point rules", () => {
  it("the nearest edge is by true point-to-segment distance (wrapping edge included)", () => {
    expect(nearestEdgeIndex(SQUARE, [50, -10])).toBe(0);   // above the top edge
    expect(nearestEdgeIndex(SQUARE, [110, 50])).toBe(1);   // right of the right edge
    expect(nearestEdgeIndex(SQUARE, [50, 120])).toBe(2);
    expect(nearestEdgeIndex(SQUARE, [-5, 50])).toBe(3);    // the closing edge (3 → 0)
    expect(nearestEdgeIndex([[0, 0]], [1, 1])).toBe(-1);
  });
  it("Add control point lands EXACTLY where clicked, spliced after the nearest edge's first vertex", () => {
    const p = [60, -8];                                    // outside, nearest the top edge
    const out = addPointAtNearestEdge(SQUARE, p);
    expect(out).toHaveLength(5);
    expect(out[1]).toEqual([60, -8]);                      // not projected onto the edge
    expect(out[0]).toEqual([0, 0]); expect(out[2]).toEqual([100, 0]);
    expect(addPointAtNearestEdge(SQUARE, [-5, 50])[4]).toEqual([-5, 50]); // closing edge → appended at the end
    expect(SQUARE).toHaveLength(4);                        // never mutates
  });
  it("Add stops at the vertex ceiling and returns the same array", () => {
    const big = Array.from({ length: MAX_POLY_VERTICES }, (_, i) => [i, (i * 7) % 50]);
    expect(addPointAtNearestEdge(big, [3, 3])).toBe(big);
  });
  it("Delete point works above the 3-point floor and is refused AT it (same array back)", () => {
    expect(canDeletePoint(SQUARE)).toBe(true);
    expect(deletePointAt(SQUARE, 1)).toEqual([[0, 0], [100, 100], [0, 100]]);
    const tri = SQUARE.slice(0, MIN_POLY_VERTICES);
    expect(canDeletePoint(tri)).toBe(false);
    expect(deletePointAt(tri, 0)).toBe(tri);
    expect(deletePointAt(SQUARE, 9)).toBe(SQUARE);
  });
  it("the tool wires the menu: native menu suppressed, items by testid, Delete DISABLED (not hidden) at the floor, undo-framed", () => {
    expect(tool).toMatch(/onContextMenu=\{\(e\) => e\.preventDefault\(\)\} data-testid="crop-canvas"/);
    expect(tool).toMatch(/data-testid="crop-menu-delete-point" disabled=\{!canDeletePoint\(polyPts\)\}/);
    expect(tool).toContain('data-testid="crop-menu-add-point"');
    expect(tool).toMatch(/const menuAddPoint = \(\) => \{[\s\S]*?pushPolyUndo\(\);[\s\S]*?setPolyPts\(next\)/);
    expect(tool).toMatch(/const menuDeletePoint = \(\) => \{[\s\S]*?pushPolyUndo\(\);[\s\S]*?deletePointAt/);
    expect(tool).toMatch(/if \(menu && k === "Escape"\)/);             // Escape closes the menu, not the dialog
    expect(tool).toMatch(/addEventListener\("pointerdown", away, true\)/); // click-away closes
    expect(tool).toMatch(/onContextMenu=\{onVertexContext\(i\)\}/);
    expect(tool).toMatch(/onContextMenu=\{onCanvasContext\}/);
  });
  it("a right-PRESS never starts a drag or inserts a point (button !== 0 is ignored by all three starters)", () => {
    expect((tool.match(/if \(e\.button != null && e\.button !== 0\) return;/g) || []).length).toBe(3);
  });
  it("the hint mentions right-click", () => { expect(tool).toMatch(/right-click to add or delete a point/); });
});

describe("NEW-3 — one toolbar line, one zoom readout, canvas gets the height", () => {
  it("the separate zoom readout is gone; the zoom control shows the live zoom", () => {
    expect(tool).not.toContain("crop-zoom-pct");
    expect(tool).toMatch(/data-testid="crop-zoom-100"[\s\S]{0,260}\{zoomPct\}%<\/Button>/);
  });
  it("the polygon hint and the footer hint no longer cost a row", () => {
    expect(tool).toContain('data-testid="crop-poly-hint"');
    expect(tool).not.toContain("Scroll to zoom · Pan tool, Space+drag");
    expect(tool).toMatch(/data-testid="crop-footer" style=\{\{[^}]*flexWrap: "nowrap"/);
  });
  it("both surfaces size the tool with `fill` inside the shared 96vw × 94vh modal", () => {
    expect(modal).toMatch(/width: "96vw", height: "94vh"/);
    expect(section).toMatch(/<ImageCropTool\s+fill/);
    expect(siteDialog).toMatch(/<ImageCropTool\s+key=\{[^}]+\}\s+fill/);
  });
});

describe("NEW-1 / NEW-2 — the crop modal is above every map control; the Adjust panel steps aside", () => {
  it("CropModal portals to <body> at a z-index above Leaflet's controls and every MAP_CHROME band", () => {
    expect(modal).toMatch(/createPortal\(/);
    expect(modal).toMatch(/document\.body/);
    const z = Number(/CROP_MODAL_Z = (\d+)/.exec(modal)[1]);
    const stack = readFileSync("src/workspaces/site-planner/lib/mapChromeStack.js", "utf8");
    const leaflet = Number(/LEAFLET_CONTROL_Z = (\d+)/.exec(stack)[1]);
    expect(z).toBeGreaterThan(leaflet + 120);   // above the highest named band (`alert`)
  });
  it("both crop surfaces render through CropModal (one layering rule)", () => {
    expect(section).toMatch(/<CropModal testId="site-plan-crop-modal"/);
    expect(siteDialog).toMatch(/<CropModal testId="overlay-crop-dialog"/);
  });
  it("the Adjust panel is not rendered while the crop editor is open (its open state is kept)", () => {
    expect(section).toMatch(/\{adjustOpen && !cropTarget && focusedOverlay && mapHostRef\?\.current && createPortal\(/);
  });
});

describe("NEW-5 — one reset, nothing hidden", () => {
  it("Done saves only the active mode's shape; no dormant shape is carried", () => {
    expect(tool).not.toMatch(/dormant|otherShapes|crop-keeps-other|Clear polygon|crop-clear-polygon/);
    const commit = /const commit = \(\) => \{[\s\S]*?\n  \};/.exec(tool)[0];
    expect(commit).toMatch(/onCommit\(pts \? \{ kind: "poly", pts \} : null\)/);
    expect(commit).toMatch(/onCommit\(rect \? \{ kind: "rect", \.\.\.rect \} : null\)/);
  });
  it("a crop saved with BOTH shapes still renders by its active kind alone (so dropping the hidden one changes nothing)", () => {
    const both = { kind: "poly", pts: [[10, 10], [90, 10], [50, 90]], x: 5, y: 5, w: 50, h: 50 };
    const polyOnly = { kind: "poly", pts: both.pts };
    expect(clipPathValueForCrop(both, 100, 100)).toBe(clipPathValueForCrop(polyOnly, 100, 100));
    const rectBoth = { kind: "rect", x: 5, y: 5, w: 50, h: 50, pts: both.pts };
    expect(clipPathValueForCrop(rectBoth, 100, 100)).toBe(clipPathValueForCrop({ kind: "rect", x: 5, y: 5, w: 50, h: 50 }, 100, 100));
    expect(cropKind(both)).toBe("poly");
  });
  it("the tool seeds from the ACTIVE shape only", () => {
    expect(tool).toMatch(/useRef\(initialKind === "rect" \? savedRectOf\(crop\) : null\)/);
    expect(tool).toMatch(/useRef\(initialKind === "poly" \? savedPtsOf\(crop\) : null\)/);
  });
});

describe("NEW-6 — Lock only blocks direct drags on the map", () => {
  it("Edit crop is never gated by lock (Map/Comps panel, its start and commit, and the shared Site-tab predicate)", () => {
    expect(section).toMatch(/<ToggleChip active=\{hasCrop\(o\)\} disabled=\{!o\.rasterKey\}/);
    const start = section.indexOf("const startCrop = async (o) => {");
    expect(section.slice(start, section.indexOf("const toggleVisible", start))).not.toMatch(/\.locked/);
    expect(cropEditBlock({ id: "a", src: "x", imgW: 10, imgH: 10, locked: true })).toBeNull();
  });
  it("Move / resize in the panel is NOT disabled by lock", () => {
    const i = section.indexOf('data-testid="site-plan-adjust-move"');
    expect(section.slice(i - 400, i)).not.toMatch(/disabled=/);
  });
  it("the placement write allows a locked plan only when explicitly armed or explicitly asked", () => {
    expect(section).toMatch(/existing\.locked && !\(opts && opts\.explicit\) && activeIdRef\.current !== id/);
  });
  it("direct drags stay blocked: a locked plan is not click-selectable, and a map drag cannot arm it", () => {
    expect(layers).toMatch(/else if \(!o\.locked && !pinTargetId && !calibrating\)/);
  });
  it("the map handles show for the explicitly armed plan, locked or not (the lock check left the active lookup)", () => {
    const i = layers.indexOf("const active = (ovs || []).find(");
    expect(layers.slice(i, i + 160)).not.toMatch(/locked/);
  });
  it("locking an armed plan still disarms it", () => {
    expect(section).toMatch(/if \(locking && activeOverlayId === o\.id\) onActivateOverlay && onActivateOverlay\(null\)/);
  });
});

describe("NEW-7 — scale is reachable from the Adjust site plan panel", () => {
  it("the panel renders the three equal actions for every placed plan — scaled or not, locked or not", () => {
    expect(section).toMatch(/\{placed && scale && <OverlayScaleSection o=\{o\} \{\.\.\.scale\} \/>\}/);
    for (const k of ["set", "trace", "match"]) expect(section).toContain(`["${k}",`);
    expect(section).toContain("`site-plan-scale-${k}`");
    expect(section).toContain('"Set scale"'); expect(section).toContain('"Trace a length"'); expect(section).toContain('"Match 2 points"');
    const comp = section.slice(section.indexOf("function OverlayScaleSection"), section.indexOf("function SitePlanAdjustPanel"));
    expect(comp).not.toMatch(/\.locked/);              // no lock gate anywhere in the scale section
  });
  it("scale writes go through the placement commit as an explicit act (so a locked plan takes them and pinned comps follow)", () => {
    expect(section).toMatch(/await commitPlacement\(o\.id, planned\.patch, \{ explicit: true \}\)/);
  });
  it("MapFinder claims every click while calibrating and hides click-select on the overlays", () => {
    const mf = readFileSync("src/workspaces/site-planner/MapFinder.jsx", "utf8");
    expect(mf).toMatch(/if \(calibRef\.current\) \{ calibClickRef\.current && calibClickRef\.current\(e\.latlng\); return; \}/);
    expect(mf).toMatch(/calibrating: !!calibration/);
  });
});
