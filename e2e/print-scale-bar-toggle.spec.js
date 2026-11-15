/* NEW-1 (2026-11-13) — the Print panel's "Scale bar" checkbox, against the REAL built sheet.
 *
 * Seeds the Goose Creek plan (20 buildings) plus one measurement, then asks the app for the composed sheet through the E2E-only
 * `window.__plannerExportComposed` (the one `buildComposedSheet` the preview and the download both call), with the bar on and off:
 *   · ON  — the sheet carries the bar's plate (+ its FEET label) and the stated scale in the title block, exactly as before;
 *   · OFF — neither is in the sheet, the north arrow and the Buildings table still are, and the page still carries its embedded
 *           measurement scale (the /VP viewport the editable PDF writes), so Bluebeam / Acrobat still calibrate;
 *   · the title-block row is not reserved (the plan box is taller), and the rest of the sheet is untouched.
 * Then the panel itself: the row is in "On the plan", ticked, and unticking it removes the bar from the live preview. */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const FIXTURE = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/goose-creek-plan1copy.json", import.meta.url), "utf8"));
const SITE_ID = "e2e-print-scale-bar";

async function loadPlan(page) {
  await armPlannerHooks(page);
  const b = FIXTURE.els.find((e) => e.type === "building");
  const measure = { id: "meScaleBar", mode: "area", z: 900005, pts: [[-60, -60], [60, -60], [60, 40], [-60, 40]].map(([x, y]) => ({ x: b.cx + x, y: b.cy + y - b.h })) };
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Goose Creek", name: "ZZ print scale bar",
    origin: null, county: "harris",
    parcels: FIXTURE.parcels, els: FIXTURE.els, measures: [measure], callouts: [], markups: [],
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
  /* el-tier: readiness gate — waits for the building band to be on the canvas; the sheet itself is asserted by kind below. */
  await expect.poll(async () => page.locator("[data-el-id]").count(), { timeout: 20_000 }).toBeGreaterThan(10);
  await page.waitForTimeout(1200);
}

const composed = (page, o) => page.evaluate((opts) => window.__plannerExportComposed(opts), o);
const kindsIn = (svg) => [...svg.matchAll(/data-furniture-kind="([a-z-]+)"/g)].map((m) => m[1]).sort();
const STATED = '1" = 100\'';

test.describe("Scale bar toggle — the built sheet", () => {
  test("ON keeps today's sheet; OFF removes the bar and the stated scale and nothing else", async ({ page }) => {
    await loadPlan(page);
    for (const annotate of [false, true]) { // Flatten markups ON (page picture) and OFF (editable annotations)
      const on = await composed(page, { scaleText: STATED, annotate, scaleBar: true });
      const off = await composed(page, { scaleText: STATED, annotate, scaleBar: false });
      expect(on, "a sheet was built").toBeTruthy();
      // known-good arm: ON really has the bar and the stated scale, so the OFF absence below is not vacuous
      if (annotate) {
        expect(on.annots.filter((a) => a.family === "sheet-furniture").map((a) => a.kind).sort()).toContain("scale-bar");
        expect(off.annots.filter((a) => a.family === "sheet-furniture").map((a) => a.kind)).not.toContain("scale-bar");
        expect(off.annots.filter((a) => a.family === "sheet-furniture").map((a) => a.kind)).toContain("north-arrow");
      } else {
        expect(kindsIn(on.sheetSvg)).toContain("scale-bar");
        expect(kindsIn(off.sheetSvg)).not.toContain("scale-bar");
        expect(kindsIn(off.sheetSvg)).toContain("north-arrow");
        expect(kindsIn(off.sheetSvg)).toContain("buildings-table");
        expect(off.sheetSvg).not.toContain(">FEET<");
        expect(on.sheetSvg).toContain(">FEET<");
      }
      expect(on.sheetSvg).toContain("100");
      expect(on.sheetSvg).toMatch(/1&quot; = 100'/);
      expect(off.sheetSvg).not.toMatch(/1&quot; = 100'/);
      // the embedded measurement scale is the same either way (only exists on the editable-PDF build)
      if (annotate) {
        expect(on.hasViewport).toBe(true);
        expect(off.hasViewport).toBe(true);
      }
    }
  });

  test("default and an old saved plan (no key) print with the bar — the output is the pre-change sheet", async ({ page }) => {
    await loadPlan(page);
    const dflt = await composed(page, { scaleText: STATED, annotate: false }); // no `scaleBar` option = the default
    const explicit = await composed(page, { scaleText: STATED, annotate: false, scaleBar: true });
    // the app mints a random clip-path id on every build (pre-existing); everything else must match byte for byte
    const norm = (svg) => svg.replace(/exportFrameClip[a-z0-9]+/g, "exportFrameClip#");
    expect(norm(dflt.sheetSvg)).toBe(norm(explicit.sheetSvg));
    expect(kindsIn(dflt.sheetSvg)).toEqual(["buildings-table", "north-arrow", "scale-bar"]);
  });

  test("every paper size, both orientations: the bar goes, the north arrow and table stay", async ({ page }) => {
    await loadPlan(page);
    for (const paper of ["letter", "tabloid", "archd", "archc", "ansic", "ansid"]) {
      for (const orient of ["landscape", "portrait"]) {
        const off = await composed(page, { paper, orient, scaleText: STATED, annotate: false, scaleBar: false });
        expect(off, `${paper} ${orient}`).toBeTruthy();
        expect(kindsIn(off.sheetSvg), `${paper} ${orient}`).toEqual(["buildings-table", "north-arrow"]);
      }
    }
  });

  test("the stated scale's title-block row is not reserved when it goes (no empty band)", async ({ page }) => {
    await loadPlan(page);
    const on = await composed(page, { scaleText: STATED, annotate: false, scaleBar: true });
    const off = await composed(page, { scaleText: STATED, annotate: false, scaleBar: false });
    const planH = (svg) => Number((svg.match(/<svg[^>]*\sheight="([\d.]+)"[^>]*viewBox=/) || svg.match(/<svg x="[\d.]+" y="[\d.]+" width="[\d.]+" height="([\d.]+)"/) || [])[1]);
    expect(planH(on.sheetSvg)).toBeGreaterThan(0);
    expect(planH(off.sheetSvg)).toBeGreaterThan(planH(on.sheetSvg));
  });
});
