/* B2671333 — a NEW exhibit frame is centred on the PROPERTY LINE, so the site sits in the middle of the printed sheet.
 *
 * Owner (2026-11-24, Goose Creek "PII - TAS R3"): "why is this not centered when it prints". The frame used to be seeded on the buildings' extent,
 * which is not the property line's centre, so the property line printed off-centre. Michael does NOT want the sheet's white margin removed (it is
 * what keeps the picture centred), so the frame keeps its own shape and the picture is still nested "meet" in the plan window.
 *
 * Drives the REAL compose screen and reads the REAL preview sheet (the same buildComposedSheet the PDF rasterizes) for every paper size and
 * orientation, with the summary strip and buildings table each on and off: the parcel outline must sit centred in the plan window. */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { armPlannerHooks } from "./helpers.js";

const FIXTURE = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/goose-creek-plan1copy.json", import.meta.url), "utf8"));
const SITE_ID = "e2e-print-centered";
const canvas = (p) => p.getByTestId("planner-canvas");

async function loadPlan(page) {
  await armPlannerHooks(page);
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Goose Creek", name: "ZZ print centered",
    origin: null, county: "harris",
    parcels: FIXTURE.parcels, els: FIXTURE.els, measures: [], callouts: [], markups: [],
    settings: FIXTURE.settings || {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([id, rec]) => {
    if (localStorage.getItem("planarfit:currentSite:v1") === id) return;
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto("/#/site");
  if (!(await canvas(page).isVisible().catch(() => false))) await page.getByText("Goose Creek", { exact: true }).first().click();
  await expect(canvas(page)).toBeVisible();
  /* el-tier: readiness gate only — waits for the building band to be on the canvas; the sheet itself is measured over the parcel outline below. */
  await expect.poll(async () => page.locator("[data-el-id]").count(), { timeout: 20_000 }).toBeGreaterThan(10);
  await page.waitForTimeout(1000);
}
async function openCompose(page) {
  await page.locator('button:has-text("File")').first().click();
  await page.locator('button:has-text("Download PDF / pick frame")').click();
  await expect(page.locator('[data-testid="print-frame"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('button:has-text("Continue")').click();
  await expect(page.locator('[data-testid="print-compose"]')).toBeVisible({ timeout: 15_000 });
}
/* Read the live preview's SVG and measure it as the browser lays it out. */
async function measurePreview(page) {
  await page.waitForTimeout(1500); // debounce (350 ms) + build
  return page.evaluate(async () => {
    const img = document.querySelector('[data-testid="print-compose"] img');
    if (!img || !img.src.startsWith("blob:")) return { error: "no preview image" };
    const markup = await (await fetch(img.src)).text();
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:0;top:0;width:1600px;height:1600px;opacity:0;pointer-events:none";
    host.innerHTML = markup;
    document.body.appendChild(host);
    try {
      const root = host.querySelector("svg");
      const plan = [...root.querySelectorAll("svg")].find((s) => s.getAttribute("viewBox") && s.hasAttribute("width"));
      if (!plan) return { error: "no nested plan svg" };
      const [, , vw, vh] = plan.getAttribute("viewBox").split(/[\s,]+/).map(parseFloat);
      const W = parseFloat(plan.getAttribute("width")), H = parseFloat(plan.getAttribute("height"));
      const feats = [...plan.querySelectorAll('[data-feature^="parcel:"]')].filter((n) => !n.closest("[data-export='skip']") && !n.hasAttribute("data-chrome"));
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      feats.forEach((n) => { const b = n.getBoundingClientRect(); if (b.width + b.height === 0) return; x0 = Math.min(x0, b.left); y0 = Math.min(y0, b.top); x1 = Math.max(x1, b.right); y1 = Math.max(y1, b.bottom); });
      const pr = plan.getBoundingClientRect();
      const scale = Math.min(pr.width / vw, pr.height / vh); // meet fit of viewBox into the box
      const picW = vw * scale, picH = vh * scale;
      return { windowAspect: W / H, frameAspect: vw / vh, picFillX: picW / pr.width, picFillY: picH / pr.height, n: feats.length,
        // site centre relative to the window centre, as a fraction of the window size
        dx: ((x0 + x1) / 2 - (pr.left + pr.width / 2)) / pr.width, dy: ((y0 + y1) / 2 - (pr.top + pr.height / 2)) / pr.height };
    } finally { host.remove(); }
  });
}

const PAPERS = [["8.5 × 11", "Letter"], ["11 × 17", "Half"], ["24 × 36", "Full"]];
test.describe("Compose exhibit — property line centred (B2671333)", () => {
  test("every paper × orientation × summary strip × buildings table centres the property line", async ({ page }) => {
    test.setTimeout(240_000);
    await loadPlan(page);
    await openCompose(page);
    const panel = page.locator('[data-testid="print-compose"]');
    const report = [];
    for (const [label] of PAPERS) {
      await panel.getByText(label, { exact: false }).first().click();
      for (const orient of ["Landscape", "Portrait"]) {
        await panel.getByRole("button", { name: orient }).click();
        for (const strip of [false, true]) for (const table of [false, true]) {
          const cb = async (name, want) => { const c = panel.getByRole("checkbox", { name }); if (await c.isChecked() !== want) await c.setChecked(want); };
          await cb(/Site summary strip/, strip); await cb(/Buildings table/, table);
          const m = await measurePreview(page);
          const tag = `${label} ${orient} strip=${strip} table=${table}`;
          expect(m.error, tag).toBeUndefined();
          expect(m.n, `${tag}: the parcel outline is in the sheet`).toBeGreaterThan(0);
          expect(Math.abs(m.dx), `${tag}: site centred horizontally`).toBeLessThan(0.08);
          expect(Math.abs(m.dy), `${tag}: site centred vertically`).toBeLessThan(0.08);
          report.push(`${tag} dx=${m.dx.toFixed(3)} dy=${m.dy.toFixed(3)} n=${m.n}`);
        }
      }
    }
    console.log(report.join("\n"));
  });
  test("a fixed scale and Reposition → Continue keep the property line centred", async ({ page }) => {
    await loadPlan(page);
    await openCompose(page);
    const panel = page.locator('[data-testid="print-compose"]');
    await panel.locator("select").first().selectOption({ index: 3 }); // a fixed engineering scale
    let m = await measurePreview(page);
    expect(Math.abs(m.dx)).toBeLessThan(0.08); expect(Math.abs(m.dy)).toBeLessThan(0.08);
    await panel.getByRole("button", { name: /Reposition/ }).click();
    await page.locator('button:has-text("Continue")').click();
    await expect(panel).toBeVisible();
    m = await measurePreview(page);
    expect(Math.abs(m.dx)).toBeLessThan(0.08); expect(Math.abs(m.dy)).toBeLessThan(0.08);
  });
});
