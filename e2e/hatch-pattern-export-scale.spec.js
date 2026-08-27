/* B794960 — the SIBLING defect check the owner's brief asked for ("look at whether anything else
 * with a fixed pixel size has the same problem on export... hatch spacing"). An easement/encumbrance
 * hatch `<pattern>` tile is a deliberate constant-canvas-px size with no scale ancestor (see
 * shared/style/hatchPatterns.js's header — this is what keeps a hatch from turning to mush zoomed
 * out or a solid block zoomed in ON SCREEN), but `buildComposedSheet` nests the exported plan as its
 * OWN `<svg viewBox=…>` inside a FIXED physical plan box, and the browser's native SVG rasterizer
 * applies that nested viewBox's fit scale to the pattern tile too — so a tile's PHYSICAL size on the
 * printed sheet used to vary with whatever live zoom was active when the export was captured, exactly
 * the class `exportStyle.js` already solved for stroke width. `HatchPatternDef` (+ the four
 * hand-authored patterns) now composes a `labelK` correction into `patternTransform`.
 *
 * Same shape as callout-arrow-export-scale.spec.js: seed geometry, capture the real export sheet
 * (`window.__plannerExportSvg`) at two very different live zooms, and check the pattern tile's
 * PHYSICAL size relative to the sheet's own viewBox stays constant. Runs LOGGED OUT, no GIS/network.
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const SITE_ID = "e2e-hatch-pattern-export-scale";

// Borrowed verbatim from easement-label-fit.spec.js — a real, validated easement record (storm,
// default un-overridden hatch → shares its TYPE's `pat-ease-storm` pattern, the common case).
const EASEMENT = {
  id: "e1454917vfjirh",
  kind: "easement",
  mode: "centerline",
  width: 60,
  easeType: "storm",
  status: "existing",
  exclusive: false,
  restrictsBuildings: true,
  restrictsPaving: false,
  centerline: [{ x: 790.69, y: 902.86 }, { x: 1303.47, y: 889.25 }],
  pts: [
    { x: 791.485967590727, y: 932.8494387342363 },
    { x: 1304.2659675907269, y: 919.2394387342363 },
    { x: 1302.6740324092732, y: 859.2605612657637 },
    { x: 789.8940324092731, y: 872.8705612657637 },
  ],
  z: 10240,
};
// exportFeetExtent()'s fallback (no devExtent()-eligible element on this plan — only an easement)
// reads a parcel's `points` field, not `pts` (the elements' field name) — the two collections use
// different keys for the same thing in this codebase.
const PARCEL = { id: "p-fit", active: true, points: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1300 }, { x: 0, y: 1300 }] };

async function boot(page) {
  await armPlannerHooks(page);
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Hatch export scale", name: "Concept A",
    origin: null, county: "harris",
    parcels: [PARCEL], els: [], measures: [], callouts: [], markups: [EASEMENT],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([id, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto("/");
  await expect(canvas(page)).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.locator(`[data-markup="${EASEMENT.id}"]`).count(), { timeout: 20_000 }).toBeGreaterThan(0);
}

async function wheelZoom(page, steps, dir) {
  const box = await canvas(page).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dir * 120); await page.waitForTimeout(16); }
}

/* Reads the exported sheet's easement hatch pattern: its declared tile width times whatever scale
 * factor `patternTransform` composes in (1 when absent), as a fraction of the sheet's viewBox
 * width — the tile's size RELATIVE TO THE FRAMED PLAN, which is what has to stay constant. */
async function hatchFraction(page) {
  return page.evaluate(async () => {
    const markup = await window.__plannerExportSvg();
    if (!markup) return null;
    const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
    const root = doc.documentElement;
    const vb = (root.getAttribute("viewBox") || "").trim().split(/\s+/).map(Number);
    const viewBoxW = vb[2];
    const pat = root.querySelector('pattern[id^="pat-ease-"]');
    if (!pat || !(viewBoxW > 0)) return null;
    const tileW = parseFloat(pat.getAttribute("width"));
    const tf = pat.getAttribute("patternTransform") || "";
    const m = tf.match(/scale\(([-\d.eE]+)\)/);
    const scale = m ? parseFloat(m[1]) : 1;
    const effectiveTileW = tileW * scale;
    return { tileW, scale, effectiveTileW, viewBoxW, fraction: effectiveTileW / viewBoxW };
  });
}

test.describe("B794960 — an easement's hatch tile prints at the same relative size at any capture zoom", () => {
  test("a huge zoomed-out capture and a close capture of the same plan agree, within a tight tolerance", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await boot(page);

    await wheelZoom(page, 20, +1);
    await page.waitForTimeout(250);
    const wide = await hatchFraction(page);

    await wheelZoom(page, 26, -1);
    await page.waitForTimeout(250);
    const close = await hatchFraction(page);

    expect(wide, "wide-zoom export produced no easement hatch pattern").toBeTruthy();
    expect(close, "close-zoom export produced no easement hatch pattern").toBeTruthy();
    expect(wide.fraction).toBeGreaterThan(0);
    // Pre-fix, `effectiveTileW` was a CONSTANT canvas-px number (no scale term at all) while the
    // viewBox itself shrank/grew with the live zoom, so `fraction` would have moved by roughly the
    // same factor as the zoom ratio between the two captures — an easy order of magnitude here.
    expect(close.fraction / wide.fraction).toBeGreaterThan(0.85);
    expect(close.fraction / wide.fraction).toBeLessThan(1.15);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
