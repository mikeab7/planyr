import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

/* NEW-1 — ONE implementation of each overlay concern, with both surfaces importing it. This sweeps
 * src/ for a second copy creeping back: no module at the old paths, no private Procrustes /
 * rotate / dpi-cap / crop-clip, and every importer pointing at src/shared/overlay. */
const SRC = new URL("../src/", import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.(js|jsx)$/.test(p) ? [p] : []; });
const files = walk(SRC);
const text = (p) => readFileSync(p, "utf8");
const rel = (p) => p.slice(SRC.length);

describe("overlay engine — single source of truth", () => {
  it("the retired modules are gone (no copy, no re-export shim)", () => {
    for (const old of ["workspaces/site-planner/lib/overlayCrop.js", "workspaces/site-planner/lib/overlayAlign.js",
      "shared/sitePlans/lib/overlayGeoref.js", "shared/sitePlans/lib/overlayRasterSize.js", "workspaces/site-planner/lib/overlayScale.js"]) expect(existsSync(SRC + old), old).toBe(false);
  });
  it("nothing imports a retired path", () => {
    const bad = files.filter((p) => /from\s+["'][^"']*(overlayGeoref|overlayAlign|overlayRasterSize)\.js["']/.test(text(p)) ||
      /from\s+["'][^"']*site-planner\/lib\/overlayCrop\.js["']/.test(text(p)) || /from\s+["']\.\/overlayCrop\.js["']/.test(text(p)));
    expect(bad.map(rel)).toEqual([]);
  });
  it("the crop model and the placement engine are defined once, under shared/overlay", () => {
    for (const [sym, re] of [["clipPathValueForCrop", /export function clipPathValueForCrop\b/], ["cropClipShapeScreen", /export function cropClipShapeScreen\b/],
      ["overlayCornersFromPlacement", /export function overlayCornersFromPlacement\b/], ["imagePointToWorld", /export function imagePointToWorld\b/],
      ["effectiveRasterDpi", /export function effectiveRasterDpi\b/], ["cappedRasterDims", /export function cappedRasterDims\b/]]) {
      const homes = files.filter((p) => re.test(text(p))).map(rel);
      expect(homes, sym).toHaveLength(1);
      expect(homes[0], sym).toMatch(/^shared\/overlay\//);
    }
  });
  it("one Procrustes solve and one similarity apply: shared/geometry/similarityTransform.js", () => {
    // The closed-form fit's signature statements — Σp·q and Σp×q — appear in exactly one file.
    const homes = files.filter((p) => /C \+= px \* qx \+ py \* qy/.test(text(p))).map(rel);
    expect(homes).toEqual(["shared/geometry/similarityTransform.js"]);
    const applyHomes = files.filter((p) => /scale \* \(c \* dx - s \* dy\)/.test(text(p))).map(rel);
    expect(applyHomes).toEqual(["shared/geometry/similarityTransform.js"]);
  });
  it("one rotate-offset: the 2×2 rotation lives only in overlayPlacement.rotateOffset", () => {
    const homes = files.filter((p) => /export function rotateOffset\b/.test(text(p))).map(rel);
    expect(homes).toEqual(["shared/overlay/overlayPlacement.js"]);
    // …and the surfaces' own placement code does not re-derive it from overlay.rotation.
    for (const f of ["workspaces/site-planner/SitePlanner.jsx", "workspaces/site-planner/lib/overlayPlacementHandles.js"])
      expect(text(SRC + f), f).not.toMatch(/dx \* cos - dy \* sin/);
  });
  it("one page→canvas step, shared by the Comps/OCR and Site-tab rasterisers", () => {
    const homes = files.filter((p) => /export async function renderPageToCanvas\b/.test(text(p))).map(rel);
    expect(homes).toEqual(["shared/overlay/overlayRaster.js"]);
    for (const f of ["shared/files/pdfRaster.js", "workspaces/site-planner/lib/overlayPdf.js"]) {
      expect(text(SRC + f), f).toMatch(/renderPageToCanvas\(/);
      expect(text(SRC + f), f).not.toMatch(/await page\.render\(/);
    }
  });
  it("pdfRaster and the image loader use the shared cap — no private long-edge math", () => {
    expect(text(SRC + "shared/files/pdfRaster.js")).toMatch(/effectiveRasterDpi/);
    expect(text(SRC + "shared/files/pdfRaster.js")).not.toMatch(/capDpi/);
    expect(text(SRC + "workspaces/site-planner/lib/image.js")).toMatch(/cappedRasterDims/);
  });
  it("both surfaces import the engine", () => {
    const sp = text(SRC + "workspaces/site-planner/SitePlanner.jsx");
    const comps = text(SRC + "shared/sitePlans/components/SitePlansSection.jsx");
    for (const t of [sp, comps]) { expect(t).toMatch(/shared\/overlay\/overlayCrop\.js|\.\.\/\.\.\/overlay\/overlayCrop\.js/); expect(t).toMatch(/overlay\/overlayPlacement\.js/); }
  });
  it("storage did not move: no migration or schema file under shared/overlay", () => {
    expect(readdirSync(SRC + "shared/overlay").filter((f) => /\.sql$/.test(f))).toEqual([]);
  });
});
