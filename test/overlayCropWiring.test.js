/* B712595 — CROP A PLACED OVERLAY, the wiring half. `test/overlayCrop.test.js` proves the pure
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

  it("renders <clipPath> only when hasCrop(o), keyed to a per-overlay id", () => {
    expect(renderBody).toMatch(/\{hasCrop\(o\) && \(\(\) => \{/);
    expect(renderBody).toMatch(/<clipPath id=\{`ov-crop-\$\{o\.id\}`\}>/);
  });
  it("the clip rect comes from the pure geometry module, not hand-rolled inline math", () => {
    expect(renderBody).toMatch(/cropClipRectScreen\(o, tl, o\.ftPerPx, rppf\)/);
  });
  it("the <image> references the clipPath only when cropped — an uncropped overlay renders byte-identically to before", () => {
    expect(renderBody).toMatch(/clipPath=\{hasCrop\(o\) \? `url\(#ov-crop-\$\{o\.id\}\)` : undefined\}/);
  });
  it("the persisted raster href is untouched by cropping — still o.src / hiresById[o.id], never re-encoded", () => {
    expect(renderBody).toMatch(/href=\{hiresById\[o\.id\] \|\| o\.src\}/);
  });
});

describe("the References panel exposes a non-destructive, reversible crop editor", () => {
  const panelStart = src.indexOf("Knock out white paper");
  const panelEnd = src.indexOf("{o.sheet && (() => {", panelStart);
  const panelBody = src.slice(panelStart, panelEnd);

  it("offers four edge-trim fields, in FEET (not raw image px — feet-everywhere-internal)", () => {
    expect(panelBody).toContain('field("L", "left"');
    expect(panelBody).toContain('field("T", "top"');
    expect(panelBody).toContain('field("R", "right"');
    expect(panelBody).toContain('field("B", "bottom"');
  });
  it("reads/writes through the pure module (cropTrimFeet / cropFromTrimFeet), not inline arithmetic", () => {
    expect(panelBody).toMatch(/cropTrimFeet\(o\)/);
    expect(panelBody).toMatch(/cropFromTrimFeet\(next, o\)/);
  });
  it("commits through patchOverlay (undo history + persistence), the same helper Opacity/Rotate/Width already use", () => {
    expect(panelBody).toMatch(/patchOverlay\(o\.id, \{ crop: cropFromTrimFeet\(next, o\) \}, false\)/);
    expect(panelBody).toMatch(/onFocus=\{\(\) => pushHistory\(\)\}/);
  });
  it('offers a "Reset crop" action that restores the full image (crop: null, not a re-import)', () => {
    expect(panelBody).toMatch(/hasCrop\(o\) && <button[\s\S]*?patchOverlay\(o\.id, \{ crop: null \}\)/);
  });
  it("is available for BOTH sheet (PDF) and plain image overlays — not gated on o.sheet", () => {
    // panelBody is sliced to END right where the `o.sheet &&` scale-picker block begins, so the crop
    // editor being findable in it at all proves it renders BEFORE (i.e. outside) that conditional.
    expect(panelBody).toContain('title="Trim white space off any edge — reversible, the full image is kept">Crop</span>');
  });
});

describe("crop travels with copy/duplicate/paste for free (plain field on a spread record)", () => {
  it("placeOverlayCopy spreads the whole source overlay record", () => {
    const start = src.indexOf("const placeOverlayCopy = (o, x, y) => {");
    const body = src.slice(start, src.indexOf("};", start));
    expect(body).toMatch(/\{ \.\.\.o, id: nid, x, y, locked: false \}/);
  });
});
