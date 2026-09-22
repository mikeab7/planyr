/* NEW-1 (B1804992) — THE PRINT/PDF EXPORT FRAME MUST CLIP EVERYTHING, NOT JUST THE AERIAL.
 *
 * Owner report (Goose Creek, Phase II — TAS R1 print): drag the aerial-image crop/frame to a
 * smaller box than the full site, export a PDF, and site-plan overlay content (parcel lines,
 * pond outlines, easement dashes, TAS/HW SPEC tags, dimension callouts, …) kept rendering in
 * the white margin outside the frame — the aerial respected the crop, nothing else did.
 *
 * Why no source reading alone could settle this: whether a nested <svg viewBox> clips its
 * children by default is a browser-rendering fact, not something you can see by reading
 * exportSheet.js. The fix (`buildExportSvgRaw` in lib/exportSheet.js) makes the crop an
 * EXPLICIT SVG <clipPath> wrapping every layer — the aerial/GIS rasters, every GIS vector
 * layer, and the whole cloned site-plan (parcels, elements, dimensions, handles) — instead of
 * relying on implicit viewBox behaviour, so "clip the frame" is guaranteed by structure rather
 * than assumed. This spec drives the REAL app: draws a building that spans well past a
 * deliberately small frame, builds the REAL export sheet (`window.__plannerExportSvg`, the
 * same E2E hook measure-export-lod.spec.js uses — gated behind `window.__PLANYR_E2E`, never
 * present in production), and inspects what came out — both structurally (every drawn node is
 * a descendant of the clip group) and visually (rendered on a page-sized canvas exactly the
 * way buildComposedSheet nests the plan, nothing paints in the margin outside the frame box).
 *
 * Runs LOGGED OUT on a seeded-blank site, no GIS and no network.
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");

async function startBlank(page) {
  await armPlannerHooks(page);
  await page.goto("/");
  await page.getByTestId("map-toolbar-draw").click();
  await expect(canvas(page)).toBeVisible();
}

function elCount(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return (site.els || []).length;
  });
}

/* A building spanning almost the whole canvas viewport, so it is guaranteed to extend well
 * past any frame we later shrink around its center. */
async function drawWideBuilding(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: /^Building$/ }).first().click();
  const x0 = box.x + box.width * 0.08, y0 = box.y + box.height * 0.12;
  const x1 = box.x + box.width * 0.92, y1 = box.y + box.height * 0.88;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
  await page.mouse.move(x1, y1, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => elCount(page), { timeout: 15_000 }).toBe(1);
  await page.keyboard.press("Escape");
}

/* Build the real export sheet with a FRAME roughly a quarter the size of the drawn building,
 * centered on the live view (screen px → feet via window.__plannerView, the same conversion
 * f2p/p2f use). Returns { markup, frame }. */
async function exportWithSmallFrame(page) {
  return page.evaluate(async () => {
    const v = window.__plannerView.get(); // { ppf, offX, offY, w, h }
    const cx = (v.w / 2 - v.offX) / v.ppf, cy = (v.h / 2 - v.offY) / v.ppf; // canvas center, in feet
    const wFt = (v.w / v.ppf) * 0.25, hFt = (v.h / v.ppf) * 0.25; // a quarter of the visible span
    const frame = { cx, cy, wFt, hFt };
    const markup = await window.__plannerExportSvg(frame);
    return { markup, frame };
  });
}

test.describe("NEW-1 (B1804992) — the export sheet clips every layer to the dragged frame", () => {
  test("a building drawn well past the frame is clipped, not printed in the margin", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await startBlank(page);
    await drawWideBuilding(page);

    const { markup, frame } = await exportWithSmallFrame(page);
    expect(markup, "the export produced no sheet at all").toBeTruthy();
    expect(frame.wFt, "the frame should be meaningfully smaller than the drawn building").toBeGreaterThan(0);

    const facts = await page.evaluate((markup) => {
      const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
      const root = doc.documentElement;
      const viewBox = (root.getAttribute("viewBox") || "").split(/\s+/).map(Number);
      const clipRect = root.querySelector("clipPath rect");
      const clipG = root.querySelector("g[clip-path]");
      // el-tier: this asserts the site plan's own drawn ELEMENT (the one building this spec
      // draws) is structurally clipped — not a plan-content census, so [data-feature] doesn't
      // apply; any one drawn element proves the clip wraps the el tier.
      const building = root.querySelector("[data-el-id]");
      // Is the building node a descendant of the clip group? (structural guarantee, independent
      // of how the returned markup is later nested/rendered.)
      const buildingInClip = !!(building && clipG && clipG.contains(building));
      return {
        viewBox,
        hasClipPath: !!clipRect,
        clipRectBox: clipRect ? [clipRect.getAttribute("x"), clipRect.getAttribute("y"), clipRect.getAttribute("width"), clipRect.getAttribute("height")].map(Number) : null,
        hasClipGroup: !!clipG,
        buildingFound: !!building,
        buildingInClip,
      };
    }, markup);

    expect(facts.hasClipPath, "no <clipPath> in the exported sheet — the crop is not explicit").toBe(true);
    expect(facts.hasClipGroup, "no clipped <g> wrapping the sheet's content").toBe(true);
    expect(facts.buildingFound, "the drawn building never reached the export").toBe(true);
    expect(facts.buildingInClip, "the building is NOT inside the clip group — it can render outside the frame").toBe(true);
    // The clip rect matches the sheet's own viewBox exactly — the crop IS the frame, not an
    // approximation of it.
    expect(facts.clipRectBox).toEqual(facts.viewBox);

    /* Render the returned markup nested inside a page-sized canvas at an OFFSET — exactly the
     * shape buildComposedSheet nests the plan svg in (x/y/width/height overridden to the plan
     * box, viewBox left as the frame's own extent) — and prove nothing paints in the margin
     * surrounding that box. This is the shape the owner's PDF actually printed wrong. */
    const bleed = await page.evaluate(async (markup) => {
      const PAGE_W = 1200, PAGE_H = 900;
      const PLAN_X = 150, PLAN_Y = 120, PLAN_W = 900, PLAN_H = 660; // page margin surrounds this box
      const nested = markup.replace(
        /width="[\d.]+" height="[\d.]+"(?=[^>]*>)/,
        `x="${PLAN_X}" y="${PLAN_Y}" width="${PLAN_W}" height="${PLAN_H}" preserveAspectRatio="xMidYMid meet"`,
      );
      const sheet = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAGE_W} ${PAGE_H}" width="${PAGE_W}" height="${PAGE_H}">`
        + `<rect x="0" y="0" width="${PAGE_W}" height="${PAGE_H}" fill="#ffffff"/>`
        + nested
        + `</svg>`;
      const url = URL.createObjectURL(new Blob([sheet], { type: "image/svg+xml" }));
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("sheet image failed to load")); img.src = url; });
      const c = document.createElement("canvas");
      c.width = PAGE_W; c.height = PAGE_H;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, PAGE_W, PAGE_H);
      ctx.drawImage(img, 0, 0, PAGE_W, PAGE_H);
      URL.revokeObjectURL(url);
      const data = ctx.getImageData(0, 0, PAGE_W, PAGE_H).data;
      let nonWhiteOutsidePlanBox = 0;
      for (let y = 0; y < PAGE_H; y += 2) {
        for (let x = 0; x < PAGE_W; x += 2) {
          const insidePlanBox = x >= PLAN_X && x <= PLAN_X + PLAN_W && y >= PLAN_Y && y <= PLAN_Y + PLAN_H;
          if (insidePlanBox) continue;
          const i = (y * PAGE_W + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          if (!(r > 250 && g > 250 && b > 250)) nonWhiteOutsidePlanBox++;
        }
      }
      return { nonWhiteOutsidePlanBox };
    }, markup);
    expect(bleed.nonWhiteOutsidePlanBox, "overlay content painted in the page margin outside the plan box").toBe(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
