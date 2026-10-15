/* NEW-1 — PRINT/PDF MUST STACK EXACTLY AS THE CANVAS DOES (owner report 2026-10-14, "Schlipf — Concept A").
 * Seeds the owner-shaped scene (a filled polygon over buildings), sends it to back through the real
 * menu, then compares paint order on the LIVE canvas with the paint order of the REAL built export sheet
 * (`window.__plannerExportSvg`). Paint order is document order in SVG. */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const FIXTURE = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/goose-creek-plan1copy.json", import.meta.url), "utf8"));
const SITE_ID = "e2e-print-stacking";
const BLDG = "e1454729ykduhm";
const MK = "mkPoly";

function seedMarkup() {
  const b = FIXTURE.els.find((e) => e.id === BLDG);
  const hw = b.w / 2 + 80, hh = b.h / 2 + 80;
  return {
    id: MK, kind: "polygon", pts: [[b.cx - hw, b.cy - hh], [b.cx + hw, b.cy - hh], [b.cx + hw, b.cy + hh], [b.cx - hw, b.cy + hh]].map(([x, y]) => ({ x, y })),
    stroke: "#e11d48", weight: 2, fill: "#e11d48", fillOpacity: 0.35, z: 1000,
  };
}

async function loadPlan(page) {
  await armPlannerHooks(page);
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Goose Creek", name: "ZZ print stacking",
    origin: null, county: "harris",
    parcels: FIXTURE.parcels, els: FIXTURE.els, measures: [], callouts: [], markups: [seedMarkup()],
    settings: FIXTURE.settings || {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([id, rec]) => {
    if (localStorage.getItem("planarfit:currentSite:v1") === id) return;
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto("/#/site");
  if (!(await canvas(page).isVisible().catch(() => false))) await page.getByText("Goose Creek", { exact: true }).first().click(); // landing is the Map; open the plan
  await expect(canvas(page)).toBeVisible();
  /* el-tier: readiness gate — waits for the building band to be on the canvas; the markup is asserted on its own line. */
  await expect.poll(async () => page.locator("[data-el-id]").count(), { timeout: 20_000 }).toBeGreaterThan(10);
  await expect(page.locator(`[data-feature="markup:${MK}"]`)).toHaveCount(1);
  await page.waitForTimeout(1200);
}

/* true = the markup paints AFTER (covers) the building, on the live canvas AND in the built sheet. */
async function coverage(page) {
  return page.evaluate(async ([mk, el]) => {
    const covers = (root) => {
      const m = root.querySelector(`[data-feature="markup:${mk}"]`);
      const b = root.querySelector(`[data-feature="el:${el}"]`) || root.querySelector(`[data-el-id="${el}"]`);
      if (!m || !b) return null;
      return !(m.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    };
    const markup = await window.__plannerExportSvg();
    const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
    return { canvas: covers(document), sheet: covers(doc) };
  }, [MK, BLDG]);
}

async function overlapPoint(page) {
  return page.evaluate((id) => {
    const r = document.querySelector(`[data-el-id="${id}"]`).getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, BLDG);
}

test("Send to Back: the printed sheet stacks the polygon under the building, like the canvas", async ({ page }) => {
  await loadPlan(page);
  expect(await coverage(page)).toEqual({ canvas: true, sheet: true }); // vacuity guard: it starts on top, both places
  const pt = await overlapPoint(page);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.click(pt.x, pt.y, { button: "right" });
  await page.getByRole("button", { name: /^Send to Back/ }).click();
  await expect.poll(async () => (await coverage(page)).canvas).toBe(false);
  expect((await coverage(page)).sheet).toBe(false);
  // deselected too (selection lift is canvas-only, ephemeral)
  await page.keyboard.press("Escape");
  await page.mouse.click(pt.x - 900, pt.y - 400);
  expect(await coverage(page)).toEqual({ canvas: false, sheet: false });
});

/* The WHOLE stack, not one pair: the sequence of features (first node of each) on the canvas must be the
 * sequence in the built sheet, for every element type the plan holds (buildings, truck courts, trailer
 * parking, car parking, roads, ponds, ...). */
async function sequences(page) {
  return page.evaluate(async () => {
    const seq = (root) => {
      const seen = new Set(); const out = [];
      for (const n of root.querySelectorAll("[data-feature]")) {
        const k = n.getAttribute("data-feature");
        if (!seen.has(k)) { seen.add(k); out.push(k); }
      }
      return out;
    };
    const markup = await window.__plannerExportSvg();
    const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
    return { canvas: seq(document), sheet: seq(doc) };
  });
}

test("the full feature stack in the sheet equals the canvas stack", async ({ page }) => {
  await loadPlan(page);
  const pt = await overlapPoint(page);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.click(pt.x, pt.y, { button: "right" });
  await page.getByRole("button", { name: /^Send to Back/ }).click();
  await expect.poll(async () => (await coverage(page)).canvas).toBe(false);
  await page.mouse.click(pt.x - 900, pt.y - 400);
  const { canvas: c, sheet: s } = await sequences(page);
  const common = c.filter((k) => s.includes(k));
  expect(s.filter((k) => c.includes(k))).toEqual(common);
});

/* ⛔ THE ACTUAL OWNER REPORT. The PDF's default ("Flatten markups" OFF) lifts markups out of the page and writes them
 * as PDF annotations — which a PDF always paints ABOVE the page. So a polygon sent behind the buildings printed on top
 * of them. This drives the real composed sheet and asserts the behind-the-plan polygon is NOT lifted (it stays in the
 * page, in its true place) while one on top of the plan still is (still editable in Bluebeam). */
async function composed(page) {
  return page.evaluate(async (mk) => {
    const c = await window.__plannerExportComposed();
    const doc = new DOMParser().parseFromString(c.sheetSvg, "image/svg+xml");
    return { lifted: c.liftedIds, kept: c.keptInPage, polygonInPage: !!doc.querySelector(`[data-feature="markup:${mk}"]`) };
  }, MK);
}

test("editable PDF: a polygon on top is a PDF markup; sent to back it stays in the page, under the building", async ({ page }) => {
  await loadPlan(page);
  const top = await composed(page);
  expect(top).toMatchObject({ lifted: 1, kept: 0, polygonInPage: false }); // on top of everything → editable, as before
  const pt = await overlapPoint(page);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.click(pt.x, pt.y, { button: "right" });
  await page.getByRole("button", { name: /^Send to Back/ }).click();
  await expect.poll(async () => (await coverage(page)).canvas).toBe(false);
  await page.mouse.click(pt.x - 900, pt.y - 400);
  const back = await composed(page);
  expect(back).toMatchObject({ lifted: 0, kept: 1, polygonInPage: true });
  // …and in the page picture it is beneath the building
  const under = await page.evaluate(async ([mk, el]) => {
    const c = await window.__plannerExportComposed();
    const doc = new DOMParser().parseFromString(c.sheetSvg, "image/svg+xml");
    const m = doc.querySelector(`[data-feature="markup:${mk}"]`), b = doc.querySelector(`[data-feature="el:${el}"]`);
    return !!(m && b && (m.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
  }, [MK, BLDG]);
  expect(under).toBe(true);
  // Bring to Front puts it back on top → editable again
  await page.mouse.click(pt.x, pt.y, { button: "right" });
  await page.getByRole("button", { name: /^Bring to Front/ }).click();
  await expect.poll(async () => (await coverage(page)).canvas).toBe(true);
  await page.mouse.click(pt.x - 900, pt.y - 400);
  expect(await composed(page)).toMatchObject({ lifted: 1, kept: 0, polygonInPage: false });
});


test("order survives a reload; a SELECTED building does not change what prints", async ({ page }) => {
  await loadPlan(page);
  const pt = await overlapPoint(page);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.click(pt.x, pt.y, { button: "right" });
  await page.getByRole("button", { name: /^Send to Back/ }).click();
  await expect.poll(async () => (await coverage(page)).canvas).toBe(false);
  await page.mouse.click(pt.x - 900, pt.y - 400);
  await page.waitForTimeout(800);
  await page.reload();
  if (!(await canvas(page).isVisible().catch(() => false))) await page.getByText("Goose Creek", { exact: true }).first().click();
  /* el-tier: readiness gate — waits for the building band to be on the canvas; the markup is asserted on its own line. */
  await expect.poll(async () => page.locator("[data-el-id]").count(), { timeout: 20_000 }).toBeGreaterThan(10);
  await page.waitForTimeout(1200);
  expect(await composed(page)).toMatchObject({ lifted: 0, kept: 1, polygonInPage: true });   // persisted z, read by print
  // select the building (the canvas lifts a selected element while selected): the markup must still print beneath it
  const pt2 = await overlapPoint(page);
  await page.mouse.click(pt2.x, pt2.y);
  expect(await composed(page)).toMatchObject({ lifted: 0, kept: 1, polygonInPage: true });
});
