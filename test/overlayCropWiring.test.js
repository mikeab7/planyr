/* B719779 — CROP A PLACED OVERLAY, the wiring half. `test/overlayCrop.test.js` proves the pure
 * geometry (overlayCrop.js); this suite is a SOURCE GUARD proving `SitePlanner.jsx` actually uses
 * it — the clip-path applied to the drawn image (and carried into the export by the SAME clone the
 * rest of this SVG's PDF-PARITY relies on), and the panel's four-field trim editor.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("src/workspaces/site-planner/SitePlanner.jsx", "utf8");

describe("the drawn overlay image applies a crop clipPath, non-destructively", () => {
  const renderStart = src.indexOf("const renderSheetOverlay = (o) => {");
  const renderEnd = src.indexOf("const overlayChrome = (() => {");
  const renderBody = src.slice(renderStart, renderEnd);

  it("renders <clipPath> only when there is a valid crop, keyed to a per-overlay id", () => {
    expect(renderBody).toMatch(/\{ovClip && \(/);
    expect(renderBody).toMatch(/<clipPath id=\{`ov-crop-\$\{o\.id\}`\}>/);
  });
  it("the clip shape (rect OR polygon) comes from the ONE pure projection, not hand-rolled inline math", () => {
    expect(renderBody).toMatch(/cropClipShapeScreen\(o, tl, o\.ftPerPx, sy, rppf\)/);
    expect(renderBody).toMatch(/<polygon points=\{ovClip\.points\}/);
    expect(renderBody).toMatch(/<rect x=\{ovClip\.x\}/);
  });
  it("the <image> references the clipPath only when cropped — an uncropped overlay renders byte-identically to before", () => {
    expect(renderBody).toMatch(/clipPath=\{ovClip \? `url\(#ov-crop-\$\{o\.id\}\)` : undefined\}/);
  });
  it("the persisted raster href is untouched by cropping — still o.src / hiresById[o.id], never re-encoded", () => {
    expect(renderBody).toMatch(/href=\{hiresById\[o\.id\] \|\| o\.src\}/);
  });
});

describe("the Overlays panel exposes a non-destructive, reversible crop editor", () => {
  // NEW-1 (Overlays redesign): the panel is components/OverlaysPanel.jsx; the four trim-by-feet fields moved
  // INSIDE the Crop dialog. There is ONE crop control in the panel (Edit + Reset), not two.
  const panel = readFileSync("src/workspaces/site-planner/components/OverlaysPanel.jsx", "utf8");
  const dlg = readFileSync("src/workspaces/site-planner/components/OverlayCropDialog.jsx", "utf8");

  it("offers four edge-trim fields, in FEET, inside the Crop dialog (not the panel)", () => {
    for (const edge of ["left", "top", "right", "bottom"]) expect(dlg).toContain(`"${edge}"`);
    expect(dlg).toContain("overlay-crop-trim");
    expect(panel).not.toMatch(/Crop (Left|Top|Right|Bottom) edge/);
  });
  it("reads/writes through the pure module (cropTrimFeet / cropFromTrimFeet), not inline arithmetic", () => {
    expect(src).toMatch(/trim=\{cropTrimFeet\(o\)\}/);
    expect(src).toMatch(/cropFromTrimFeet\(next, o\)/);
  });
  it("commits through setOverlayCrop (lock check + undo history + persistence via patchOverlay)", () => {
    expect(src).toMatch(/setOverlayCrop\(o\.id, cropFromTrimFeet\(next, o\), false\)/);
    expect(src).toMatch(/onTrimFocus=\{\(\) => pushHistory\(\)\}/);
  });
  it('offers a "Reset" action that restores the full image (crop: null, not a re-import)', () => {
    expect(panel).toContain('data-testid="overlay-crop-reset"');
    expect(src).toMatch(/onResetCrop: \(id\) => setOverlayCrop\(id, null\)/);
  });
  it("is available for BOTH sheet (PDF) and plain image overlays — not gated on a PDF-only field", () => {
    expect(panel).toContain('data-testid="overlay-crop-open"');
    const crop = panel.slice(panel.indexOf("function CropSection"), panel.indexOf("function AppearanceSection"));
    expect(crop).not.toMatch(/o\.sheet/);
  });
  it("there is exactly ONE crop entry point in the panel, and it gates on the ONE lock predicate", () => {
    expect((panel.match(/data-testid="overlay-crop-open"/g) || []).length).toBe(1);
    expect(panel).toMatch(/const why = cropEditBlock\(o\)/);
    expect(src).toMatch(/onCrop: \(id\) => \{ setSelOverlay\(id\); setOvCropId\(id\); \}/);
  });
});

describe("crop travels with copy/duplicate/paste for free (plain field on a spread record)", () => {
  it("placeOverlayCopy spreads the whole source overlay record", () => {
    const start = src.indexOf("const placeOverlayCopy = (o, x, y) => {");
    const body = src.slice(start, src.indexOf("};", start));
    expect(body).toMatch(/\{ \.\.\.o, id: nid, x, y, locked: false \}/);
  });
});

describe("NEW-1 — the crop WRITE refuses a locked overlay (not just a greyed button — B1154369)", () => {
  const start = src.indexOf("const setOverlayCrop = (id, crop, hist = true) => {");
  const body = src.slice(start, src.indexOf("\n  };", start));
  it("asks cropEditBlock before writing and bails loudly", () => {
    expect(start).toBeGreaterThan(0);
    expect(body).toMatch(/const why = cropEditBlock\(o\);\s*if \(why\) \{ flashWarn/);
  });
  it("normalizes either shape and refuses a degenerate one rather than clipping to nothing", () => {
    expect(body).toMatch(/normalizeCropShape\(crop, o\.imgW, o\.imgH\)/);
    expect(body).toMatch(/if \(crop && !next\) \{ flashWarn/);
  });
  it("writes through patchOverlay — the same autosave/undo path as every overlay edit", () => {
    expect(body).toMatch(/patchOverlay\(id, \{ crop: next \}, hist\)/);
  });
  it("the dialog reuses the shared ImageCropTool, lazily", () => {
    expect(src).toMatch(/const OverlayCropDialog = lazy\(\(\) => import\("\.\/components\/OverlayCropDialog\.jsx"\)\)/);
    const dlg = readFileSync("src/workspaces/site-planner/components/OverlayCropDialog.jsx", "utf8");
    expect(dlg).toMatch(/import ImageCropTool from "\.\.\/\.\.\/\.\.\/shared\/sitePlans\/components\/ImageCropTool\.jsx"/);
  });
  it("a PDF page change re-fits the crop to the new raster", () => {
    expect(src).toMatch(/crop: recropForRaster\(o && o\.crop, r\.imgW, r\.imgH\)/);
  });
});

describe("NEW-1 — a crop edit is its own UNDO frame", () => {
  it("the history signature (histKey) includes the overlay's crop, so the dedup can't swallow it", () => {
    const start = src.indexOf("const histKey = (s) =>");
    const body = src.slice(start, src.indexOf("\n  // Pure snapshot stack", start));
    expect(body).toMatch(/o\.crop \? JSON\.stringify\(o\.crop\) : ""/);
  });
});
