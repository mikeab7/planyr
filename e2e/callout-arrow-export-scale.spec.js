/* B794960 — the owner's report: "the arrows print huge, way bigger than they show on the planner
 * module." Root cause traced to the callout leader's arrowhead: `renderCalloutNode`'s `ah` used a
 * bare `Math.max(7, fontPx * 0.7)` — a 7 SCREEN-px legibility floor with no export correction. The
 * rest of the arrowhead (`fontPx`) is feet-proportional (scales with the live `rppf`, exactly like
 * any other drawn geometry), so it already exports at the right relative size — but the floor is an
 * absolute px constant, and per exportLabelScale.js's own rule ("a 30-px legibility floor" is
 * exactly this class), an unconverted floor bakes a HUGE world-feet arrowhead when the export is
 * captured at a zoomed-OUT live view — which is exactly what framing a large exhibit requires.
 *
 * Same shape as measure-export-lod.spec.js (B1085): the defect exists only in the BUILT SHEET, so
 * this drives the real export hook (`window.__plannerExportSvg`) rather than reading the canvas.
 * Runs LOGGED OUT on a seeded-blank site, no GIS, no network.
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");

async function startBlank(page) {
  await armPlannerHooks(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

// One 1.12x wheel step per event (the handler ignores magnitude) — the shared zoom helper, same
// idiom as measure-export-lod.spec.js.
async function wheelZoom(page, steps, dir /* -1 in, +1 out */) {
  const box = await canvas(page).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dir * 120); await page.waitForTimeout(16); }
}

// exportFeetExtent() frames the DEVELOPMENT bounds (devExtent — buildings/elements), not bare
// callouts, so a plan with only a callout on it exports nothing to crop to. Draw a building
// first, matching measure-export-lod.spec.js's pattern, so there is real content to frame.
async function drawBuilding(page, box) {
  await page.getByRole("button", { name: "Building", exact: true }).click();
  const x1 = box.x + 260, y1 = box.y + 200, x2 = box.x + 620, y2 = box.y + 400;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 80, y1 + 40, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
}

async function placeCallout(page, box) {
  await page.getByRole("button", { name: /^Callout\s/ }).click();
  await page.mouse.click(box.x + 300, box.y + 320); // tip (target) — over the building
  await page.mouse.click(box.x + 420, box.y + 130); // box (label) — clear of the building
  await page.getByPlaceholder("Type…").waitFor({ state: "visible" });
  await page.keyboard.type("Detention pond");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
}

/* Build the real export sheet (no frame → the content-derived default extent, so this is
 * IDENTICAL feet-wise across both captures below — only the live capture zoom differs) and report
 * the leader arrowhead's size relative to the sheet's own viewBox width. */
async function arrowFraction(page) {
  return page.evaluate(async () => {
    const markup = await window.__plannerExportSvg();
    if (!markup) return null;
    const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
    const root = doc.documentElement;
    const vb = (root.getAttribute("viewBox") || "").trim().split(/\s+/).map(Number);
    const viewBoxW = vb[2];
    const poly = root.querySelector('[data-testid^="callout-leader-arrow-"]');
    if (!poly || !(viewBoxW > 0)) return null;
    const pts = (poly.getAttribute("points") || "").trim().split(/\s+/).map((p) => p.split(",").map(Number));
    let maxD = 0;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      maxD = Math.max(maxD, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
    }
    return { arrowSize: maxD, viewBoxW, fraction: maxD / viewBoxW };
  });
}

test.describe("B794960 — the callout leader arrowhead prints at the same relative size at any capture zoom", () => {
  test("a huge zoomed-out capture and a close capture of the same plan agree, within a tight tolerance", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawBuilding(page, box);
    await placeCallout(page, box);
    await expect(page.locator('[data-testid^="callout-leader-arrow-"]').first()).toBeAttached();

    // WIDE — the owner's actual pre-print state: zoomed way out to frame a large exhibit. This is
    // exactly the condition that trips the un-fixed 7px SCREEN floor (fontPx shrinks well below it).
    // Settle past the smooth-zoom anchor's own commit debounce (B1449 — mid-gesture the emitted
    // frame is the ANCHOR'S, not `view.ppf`) before reading anything, same as
    // callout-two-segment-leader.spec.js's "settle past the last one" rule — otherwise a capture
    // mid-settle races the anchor and this spec's own numeric ratio (unlike a boolean present/absent
    // check) is sensitive enough to catch that race, not the fix.
    await wheelZoom(page, 20, +1);
    await page.waitForTimeout(250);
    const wide = await arrowFraction(page);

    // CLOSE — a normal editing zoom, well above where the floor would ever bite.
    await wheelZoom(page, 26, -1);
    await page.waitForTimeout(250);
    const close = await arrowFraction(page);

    expect(wide, "wide-zoom export produced no arrowhead").toBeTruthy();
    expect(close, "close-zoom export produced no arrowhead").toBeTruthy();

    // The fix: fontPx and the (now labelK-corrected) floor both scale with the live capture zoom
    // exactly like the rest of the drawing, so the arrowhead's size RELATIVE TO THE SHEET is a
    // function of the plan and the paper only — never of where the canvas happened to be zoomed
    // when the export was captured. Pre-fix, the bare 7px floor stayed a CONSTANT number of
    // viewBox units regardless of zoom while the viewBox itself shrank with it, so `fraction` grew
    // by roughly the same factor as the zoom ratio between the two captures — an easy order of
    // magnitude here — which is exactly what would fail this assertion.
    expect(wide.fraction).toBeGreaterThan(0);
    expect(close.fraction / wide.fraction).toBeGreaterThan(0.85);
    expect(close.fraction / wide.fraction).toBeLessThan(1.15);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
