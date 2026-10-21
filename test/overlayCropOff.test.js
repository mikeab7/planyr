/* NEW-2 (2026-10-21) — the Overlays panel's CROP SWITCH. Switching crop OFF keeps the shape but every consumer
 * draws the whole sheet; switching ON brings the very same shape back. The flag lives on the crop object
 * (`crop.off`) inside the SHARED engine (shared/overlay/overlayCrop.js), so the Site tab's SVG clip, the print
 * clone, the Map/Comps CSS clip, the handles' visible frame, the DB row mappers and the cross-plan copy all
 * honour it from one place. An old record with no flag behaves exactly as before. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  hasCrop, hasSavedCrop, activeCrop, cropIsOff, withCropOff, effectiveCropRect, cropClipShapeScreen, clipPathValueForCrop,
  cropOutlinePath, normalizeCropShape, recropForRaster, isValidCropShape, cropKind,
} from "../src/shared/overlay/overlayCrop.js";
import { visibleFrame, visibleCornersPx } from "../src/shared/overlay/overlayPlacement.js";
import { rowToOverlay, overlayToRow } from "../src/shared/sitePlans/lib/sitePlanOverlays.js";
import { makeForeignCopy } from "../src/workspaces/site-planner/lib/siblingOverlays.js";
import OverlaysPanel from "../src/workspaces/site-planner/components/OverlaysPanel.jsx";

const base = { id: "a", src: "data:image/png;base64,AA", imgW: 1000, imgH: 800, ftPerPx: 0.5, x: 0, y: 0, rotation: 0 };
const RECT = { kind: "rect", x: 100, y: 50, w: 700, h: 600 };
const POLY = { kind: "poly", pts: [[100, 100], [900, 150], [700, 700], [150, 650]] };

describe("hasCrop — an OFF crop is no crop, and ON again is the same shape", () => {
  for (const [name, crop] of [["rect", RECT], ["polygon", POLY], ["legacy rect (no kind)", { x: 100, y: 50, w: 700, h: 600 }]]) {
    it(`${name}: on → off → on restores the identical object`, () => {
      const on = { ...base, crop };
      expect(hasCrop(on)).toBe(true);
      const off = { ...base, crop: withCropOff(crop, true) };
      expect(cropIsOff(off.crop)).toBe(true);
      expect(hasCrop(off)).toBe(false);          // consumers treat it as uncropped…
      expect(hasSavedCrop(off)).toBe(true);      // …but the shape is still kept for the switch
      const back = { ...base, crop: withCropOff(off.crop, false) };
      expect(hasCrop(back)).toBe(true);
      expect(back.crop).toEqual(crop);           // byte-for-byte the same shape, no residual `off` key
      expect("off" in back.crop).toBe(false);
    });
  }
  it("an old record with no flag behaves exactly as before; no crop is no crop", () => {
    expect(hasCrop({ ...base, crop: RECT })).toBe(true);
    expect(hasCrop(base)).toBe(false);
    expect(hasCrop(null)).toBe(false);
    expect(activeCrop({ ...base, crop: RECT })).toBe(RECT);
    expect(withCropOff(null, true)).toBeNull();
  });
  it("only off === true switches it off (a stray falsy or string value never hides a real crop)", () => {
    for (const off of [false, 0, "", null, undefined, "true", 1]) expect(hasCrop({ ...base, crop: { ...RECT, off } })).toBe(true);
  });
});

describe("every consumer draws the whole sheet while off", () => {
  const offRect = { ...base, crop: withCropOff(RECT, true) };
  const offPoly = { ...base, crop: withCropOff(POLY, true) };
  it("the Site-tab SVG clip (and therefore the print/PDF clone, which copies the live <svg>) is absent", () => {
    for (const o of [offRect, offPoly]) expect(cropClipShapeScreen(o, { x: 0, y: 0 }, 0.5, 0.5, 2)).toBeNull();
    expect(cropClipShapeScreen({ ...base, crop: RECT }, { x: 0, y: 0 }, 0.5, 0.5, 2)).not.toBeNull();
  });
  it("the Map/Comps CSS clip-path is empty", () => {
    expect(clipPathValueForCrop(offRect.crop, 1000, 800)).toBe("");
    expect(clipPathValueForCrop(offPoly.crop, 1000, 800)).toBe("");
    expect(clipPathValueForCrop(RECT, 1000, 800)).toMatch(/^inset\(/);
  });
  it("the visible frame behind the selection handles / fit is the FULL image", () => {
    expect(effectiveCropRect(offRect)).toEqual({ x: 0, y: 0, w: 1000, h: 800 });
    expect(effectiveCropRect(offPoly)).toEqual({ x: 0, y: 0, w: 1000, h: 800 });
    expect(visibleFrame(offPoly)).toEqual({ x: 0, y: 0, w: 1000, h: 800 });
    expect(visibleFrame({ ...base, crop: RECT })).toEqual({ x: 100, y: 50, w: 700, h: 600 });
    const full = visibleCornersPx(base), off = visibleCornersPx(offRect);
    expect(off).toEqual(full);
  });
  it("the picture's dashed outline disappears with it", () => {
    expect(cropOutlinePath(offRect)).toBe("");
    expect(cropOutlinePath({ ...base, crop: RECT })).toBe("M100 50h700v600h-700Z");
    expect(cropOutlinePath({ ...base, crop: POLY })).toBe("M100 100L900 150L700 700L150 650Z");
  });
});

describe("the flag survives every write and read path", () => {
  it("normalizeCropShape (the one write normalizer) keeps `off` and keeps the shape", () => {
    for (const crop of [RECT, POLY]) {
      const n = normalizeCropShape(withCropOff(crop, true), 1000, 800);
      expect(n.off).toBe(true);
      expect(cropKind(n)).toBe(cropKind(crop));
      expect({ ...n, off: undefined }).toEqual({ ...normalizeCropShape(crop, 1000, 800), off: undefined });
    }
    expect(normalizeCropShape(RECT, 1000, 800).off).toBeUndefined();   // an enabled crop carries no key at all
  });
  it("a switched-off crop whose shape is unusable normalizes to null (never an orphan {off:true})", () => {
    expect(normalizeCropShape({ kind: "poly", pts: [[0, 0], [1, 1]], off: true }, 1000, 800)).toBeNull();
  });
  it("a page change re-validates the kept shape without dropping the flag", () => {
    const r = recropForRaster(withCropOff(RECT, true), 500, 400);
    expect(r && r.off).toBe(true);
  });
  it("it is a VALID stored shape (so a row mapper keeps it instead of silently dropping the crop)", () => {
    expect(isValidCropShape(withCropOff(RECT, true))).toBe(true);
    expect(isValidCropShape(withCropOff(POLY, true))).toBe(true);
  });
  it("a record round-trips through JSON save/load with the flag intact, and on again is the same shape", () => {
    const rec = { ...base, crop: withCropOff(POLY, true) };
    const loaded = JSON.parse(JSON.stringify({ sheetOverlays: [rec] })).sheetOverlays[0];
    expect(loaded.crop.off).toBe(true);
    expect(hasCrop(loaded)).toBe(false);
    expect(withCropOff(loaded.crop, false)).toEqual(POLY);
  });
  it("the Map/Comps row mapper round-trips it (read keeps it, write sends it)", () => {
    const row = { id: "r1", user_id: "u", review_id: "rv", page: 1, img_w: 1000, img_h: 800, crop: withCropOff(RECT, true) };
    const o = rowToOverlay(row);
    expect(o.crop).toEqual(withCropOff(RECT, true));
    expect(hasCrop({ ...o, src: "x" })).toBe(false);
    expect(overlayToRow(o).crop).toEqual(withCropOff(RECT, true));
  });
  it("a sibling-plan copy keeps the kept shape and shows the whole sheet while off", () => {
    const foreign = { overlay: { ...base, id: "src1", crop: withCropOff(POLY, true), storageKey: "k" }, sharedFrom: { siteId: "s", overlayId: "src1" } };
    const copy = makeForeignCopy(foreign, { mint: () => "new1" });
    expect(copy.id).toBe("new1");
    expect(hasCrop(copy)).toBe(false);
    expect(withCropOff(copy.crop, false)).toEqual(POLY);
  });
});

describe("the panel", () => {
  const noop = () => {};
  const handlers = new Proxy({}, { get: (_, k) => (k === "sliderHistory" ? () => ({}) : k === "pageReady" ? () => true : noop) });
  const render = (o, extra = {}) => renderToStaticMarkup(createElement(OverlaysPanel, {
    overlays: [o], selId: o.id, showAerial: true, hasParcel: true, busy: false, loadErr: {}, basemapNote: false, calib: null, calibMsg: "",
    menuId: null, renamingId: null, pageFocusTick: 0, handlers, ...extra,
  }));
  const img = (o = {}) => ({ ...base, id: "img1", name: "Aerial.png", opacity: 1, ...o });
  it("OFF is just the heading and the switch — no picture, no Adjust, no shape text, no Reset", () => {
    const h = render(img());
    expect(h).toContain('data-testid="overlay-crop-switch-img1"');
    expect(h).toMatch(/role="switch"[^>]*aria-checked="false"|aria-checked="false"[^>]*role="switch"/);
    expect(h).not.toContain('data-testid="overlay-crop-open"');
    expect(h).not.toContain("overlay-crop-picture");
    expect(h).not.toMatch(/Not cropped|Rectangle|Polygon ·|overlay-crop-reset|overlay-crop-shape/);
  });
  it("a kept-but-off crop also renders OFF (the switch is the only thing there)", () => {
    const h = render(img({ crop: withCropOff(RECT, true) }));
    expect(h).toContain('aria-checked="false"');
    expect(h).not.toContain("overlay-crop-picture");
  });
  it("ON shows the picture (a button 'Adjust the crop') with the dim + dashed outline, and an Adjust button", () => {
    const h = render(img({ crop: POLY }));
    expect(h).toContain('aria-checked="true"');
    expect(h).toContain('aria-label="Adjust the crop"');
    expect(h).toContain('data-testid="overlay-crop-picture-img1"');
    expect(h).toContain('data-testid="overlay-crop-dim"'); expect(h).toContain('data-testid="overlay-crop-outline"');
    expect(h).toContain("M100 100L900 150L700 700L150 650Z");
    expect((h.match(/data-testid="overlay-crop-open"/g) || []).length).toBe(1);
    expect(h).toMatch(/data-testid="overlay-crop-open"[^>]*>Adjust</);
  });
  it("switch and Adjust carry the same disabled reason as before, and a LOCKED overlay is NOT a reason", () => {
    const noRaster = render(img({ src: null }));
    expect(noRaster).toMatch(/aria-label="Crop"[^>]*disabled/);
    expect(noRaster).toContain("Load the drawing first to crop it");
    const locked = render(img({ locked: true, crop: RECT }));
    expect(locked).not.toMatch(/data-testid="overlay-crop-switch-img1"[^>]*disabled|disabled=""[^>]*data-testid="overlay-crop-switch-img1"/);
    expect(locked).not.toMatch(/data-testid="overlay-crop-open"[^>]*disabled/);
  });
  it("the map capture still has no crop section", () => {
    expect(render({ id: "m", name: "Aerial", fromMap: true, src: "data:image/png;base64,AA", imgW: 800, imgH: 600, ftPerPx: 1 })).not.toContain("overlay-crop-switch");
  });
});

describe("wiring (source guard)", () => {
  const src = readFileSync("src/workspaces/site-planner/SitePlanner.jsx", "utf8");
  const panel = readFileSync("src/workspaces/site-planner/components/OverlaysPanel.jsx", "utf8");
  it("the switch writes through the ONE crop writer (lock check + one undo frame), and Reset is gone", () => {
    expect(src).toMatch(/onCropSwitch: setOverlayCropOn/);
    const fn = src.slice(src.indexOf("const setOverlayCropOn"), src.indexOf("const setOverlayCropOn") + 400);
    expect(fn).toMatch(/setOverlayCrop\(id, withCropOff\(o\.crop, !on\)\)/);
    expect(src).not.toMatch(/onResetCrop/);
    expect(panel).not.toMatch(/overlay-crop-reset|onResetCrop/);
  });
  it("no consumer decides 'is the sheet clipped' from the truthiness of o.crop", () => {
    for (const f of ["src/workspaces/site-planner/lib/rotatedImageLayer.js", "src/shared/overlay/overlayPlacement.js"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/\bo\.crop\b/);
    }
  });
});
