/* Road Properties panel redesign (NEW-1 / NEW-2 / NEW-3), driven against the REAL inspector on the owner's real
 * Tsakiris / Concept A roads (a centerline road with a junction, curbed roads, a 40' truck loop).
 *
 *   NEW-1  header (name · padlock · ⋯ · ✕ + summary), ROAD / CROSS-SECTION / LABEL / INTERSECTION sections; Length is
 *          NOT an input on a drawn road; Width / Right-of-way / Class / Length are ONE line each at the default AND the
 *          minimum panel width in BOTH themes; the label Background control is fully visible and not overlapped.
 *   NEW-2  no cost controls — and the road's stored cost fields are never rewritten.
 *   NEW-3  no "Curve at vertex", no radius warning, no canvas flags — with ONE flag that brings them back (positive control).
 *
 * Run: npx playwright test e2e/road-panel-redesign.spec.js
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const FIXTURE = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/tsakiris-concept-a-live.json", import.meta.url), "utf8"));
const SITE_ID = "e2e-road-panel";
const LOOP = "e38duuwgj";
const CURBED = { curbType: "curb-gutter", curbedSides: 2, panWidth: 2 };

async function boot(page, { theme = "dark", width = 320, flag = false, name = "TURNING BASIN DR", viewport = { width: 1500, height: 950 } } = {}) {
  await page.setViewportSize(viewport);
  await armPlannerHooks(page);
  const els = FIXTURE.els.map((e) => (e.id === LOOP ? { ...e, inlineLabel: name, ...CURBED } : e));
  const site = { id: SITE_ID, groupId: SITE_ID, site: "Tsakiris", name: "Concept A", origin: null, county: "waller", parcels: [], els, measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
  await page.addInitScript(([id, rec, th, w, fl]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
    localStorage.setItem("planyr.theme", th);
    localStorage.setItem("planarfit:leftWidth", String(w));
    if (fl) localStorage.setItem("planyr:flag:roadRadiusReview", "1");
  }, [SITE_ID, site, theme, width, flag]);
  await page.goto("/");
  const tab = page.getByTestId("module-tab-site-planner").filter({ visible: true });
  await tab.waitFor({ state: "visible", timeout: 20_000 });
  await expect(async () => { await tab.click({ timeout: 3_000 }); await expect(canvas(page)).toBeVisible({ timeout: 3_000 }); }).toPass({ timeout: 30_000 });
  await page.waitForFunction(() => !!window.__plannerView, null, { timeout: 20_000 });
}

/* Select the loop road and open its Properties with a real double-click (clickCount 1 then 2). */
async function openRoadPanel(page) {
  const CX = 1500, CY = 100, PPF = 0.5;
  await page.evaluate(([x, y, p]) => window.__plannerView.centerOn(x, y, p), [CX, CY, PPF]);
  await page.waitForTimeout(500);
  const box = await canvas(page).boundingBox();
  const v = await page.evaluate(() => window.__plannerView.get());
  const pt = { x: box.x + v.w / 2 + (1649 - CX) * PPF, y: box.y + v.h / 2 + (100 - CY) * PPF };
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(450);
  await page.mouse.dblclick(pt.x, pt.y);
  await expect(page.getByTestId("road-header")).toBeVisible({ timeout: 10_000 });
}
const roads = (page) => page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const s = Object.values(m)[0] || {};
  return (s.els || []).filter((e) => e.type === "road");
});
const loopRoad = async (page) => (await roads(page)).find((r) => r.id === LOOP);
const row = (page, label) => page.locator('[data-testid="property-panel"] [data-field-group="1"][data-row-align="1"]').filter({ has: page.getByText(label, { exact: true }) }).first();
const box = async (loc) => (await loc.boundingBox());

for (const theme of ["dark", "light"]) {
  for (const [wname, width] of [["default", 320], ["minimum", 240]]) {
    test(`NEW-1/2/3 — layout contract · ${theme} · ${wname} panel width`, async ({ page }) => {
      await boot(page, { theme, width });
      await openRoadPanel(page);
      const panel = page.getByTestId("property-panel");
      const text = (await panel.innerText()).replace(/\s+/g, " ");

      // NEW-2 — no cost controls, no readout, no Yield link text
      for (const s of ["Curb & paving", "Curb type", "Curbed sides", "Gutter pan", " SY", "Set unit prices"]) expect(text, s).not.toContain(s);
      // NEW-3 — the min-radius review is invisible: no section, no warning, no Fix button, no canvas flags
      for (const s of ["Curve at vertex", "radius — below", "Fix radius", "below"]) expect(text, s).not.toContain(s);
      await expect(page.getByTestId("road-radius-flags")).toHaveCount(0);
      await expect(page.getByTestId("road-radius-warning")).toHaveCount(0);
      expect(await loopRoad(page)).toMatchObject(CURBED); // …and the stored cost fields are untouched

      // NEW-1 — Length is a readout on a drawn road, never an input
      await expect(page.getByTestId("road-length")).toContainText("follows the line");
      await expect(page.getByTestId("road-length").locator("input")).toHaveCount(0);
      await expect(row(page, "Length").locator("input, select, textarea")).toHaveCount(0);

      // one control height, measured off the real Width box
      const widthBox = await box(page.getByTestId("road-width").locator("xpath=ancestor::*[@data-numbox][1]"));
      const oneCtl = widthBox.height;
      expect(oneCtl).toBeGreaterThan(20);
      for (const label of ["Length", "Width", "Right-of-way", "Class"]) {
        const r = await box(row(page, label));
        expect(r.height, `${label} row must be ONE line (a control tall), not wrapped`).toBeLessThanOrEqual(oneCtl + 1);
        const lab = await box(row(page, label).getByText(label, { exact: true }));
        expect(lab.height, `${label} label must not wrap`).toBeLessThan(20);
      }
      // the panel never scrolls sideways and nothing pokes past its right edge
      const pb = await box(panel);
      expect(await panel.evaluate((el) => el.scrollWidth - el.clientWidth), "no horizontal overflow").toBeLessThanOrEqual(1);
      for (const t of ["road-width", "road-row", "road-class"]) { const b = await box(page.getByTestId(t)); expect(b.x + b.width, t).toBeLessThanOrEqual(pb.x + pb.width + 1); }

      // header: name, summary line (length · width, no ROW — none is designated), padlock, ⋯, ✕
      await expect(page.getByTestId("road-title")).toContainText(/TURNING|…|Road/);
      await expect(page.getByTestId("road-summary")).toContainText("ft long · 40 ft wide");
      await expect(page.getByTestId("road-summary")).not.toContainText("ROW");
      for (const t of ["road-lock", "road-more", "road-close"]) await expect(page.getByTestId(t)).toBeVisible();

      // LABEL: Background control is fully visible — in the panel, on top, and its label is not covered
      const seg = page.getByTestId("label-background");
      await seg.scrollIntoViewIfNeeded();
      const sb = await box(seg);
      expect(sb.x).toBeGreaterThanOrEqual(pb.x - 1); expect(sb.x + sb.width).toBeLessThanOrEqual(pb.x + pb.width + 1);
      for (const t of ["label-halo-on", "label-halo-off"]) {
        const b = await box(page.getByTestId(t));
        expect(await page.evaluate(([x, y, id]) => { const el = document.elementFromPoint(x, y); return !!el && !!el.closest(`[data-testid="${id}"]`); }, [b.x + b.width / 2, b.y + b.height / 2, t]), `${t} must be the top element at its own centre`).toBe(true);
      }
      const bl = await box(row(page, "Background").getByText("Background", { exact: true }));
      expect(await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return !!el && el.textContent.trim() === "Background"; }, [bl.x + bl.width / 2, bl.y + bl.height / 2]), "'Background' label not covered").toBe(true);
      expect(bl.height).toBeLessThan(20);
      for (const label of ["Text size", "Repeat every", "Position"]) { const r = await box(row(page, label)); expect(r.height, label).toBeLessThanOrEqual(oneCtl + 1); }

      // CROSS-SECTION has its own section; the button sits clear of the neighbours
      await expect(page.getByTestId("road-xs-strip")).toBeVisible();
      await expect(page.getByTestId("road-xs-caption")).toContainText("Curb face to curb face, 40 ft");
      const xb = page.getByTestId("edit-road-xsection");
      await expect(xb).toHaveText("Design cross-section");
      const xbb = await box(xb), capb = await box(page.getByTestId("road-xs-caption"));
      expect(xbb.y).toBeGreaterThanOrEqual(capb.y + capb.height - 1);

      // INTERSECTION: this road has a junction → the section exists and starts CLOSED
      await expect(panel.getByRole("button", { name: /Intersection/i })).toHaveAttribute("aria-expanded", "false");
    });
  }
}

test("NEW-3 — ONE flag brings the hidden min-radius review back (positive control)", async ({ page }) => {
  await boot(page, { flag: true });
  await openRoadPanel(page);
  await expect(page.getByTestId("road-curve-at-vertex")).toBeVisible();
  await expect(page.getByTestId("property-panel")).toContainText("Curve at vertex");
  // …and the canvas review flags are back too — so the flag-OFF "zero flags" assertions above are not vacuous on this fixture
  await expect(page.getByTestId("road-radius-flags")).toHaveCount(1);
});

test("NEW-1 — header: pin, ⋯ menu (Duplicate · Bring to front · Delete road), close", async ({ page }) => {
  await boot(page);
  await openRoadPanel(page);
  await page.getByTestId("road-lock").click();
  await expect(page.getByTestId("road-lock")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("road-summary")).toContainText("locked");
  await page.getByTestId("road-lock").click();
  await expect(page.getByTestId("road-lock")).toHaveAttribute("aria-pressed", "false");

  const n0 = (await roads(page)).length;
  await page.getByTestId("road-more").click();
  await expect(page.getByTestId("road-duplicate")).toBeVisible();
  await expect(page.getByTestId("road-front")).toBeVisible();
  await expect(page.getByTestId("road-delete")).toBeVisible();
  await page.getByTestId("road-duplicate").click();
  await expect.poll(async () => (await roads(page)).length).toBe(n0 + 1);

  // the duplicate is selected now; delete it through the same menu
  await expect(page.getByTestId("road-header")).toBeVisible();
  await page.getByTestId("road-more").click();
  await page.getByTestId("road-delete").click();
  await expect.poll(async () => (await roads(page)).length).toBe(n0);

  await openRoadPanel(page);
  await page.getByTestId("road-close").click();
  await expect(page.getByTestId("road-header")).toHaveCount(0);
});

test("NEW-1 — Width / Right-of-way steppers, ROW on a plain road, class, cost fields stay stored", async ({ page }) => {
  await boot(page);
  await openRoadPanel(page);
  const w0 = (await loopRoad(page)).travelW;
  await page.getByTestId("road-width").fill("44"); await page.getByTestId("road-width").press("Enter");
  await expect.poll(async () => (await loopRoad(page)).travelW).toBe(44);
  await expect(page.getByTestId("road-summary")).toContainText("44 ft wide");
  // the width box stays an editable stepper (a plain road), never the read-only "set by cross-section"
  await expect(page.getByTestId("road-width-readonly")).toHaveCount(0);

  // ROW: blank on a plain road → designate → stored on the section → clear removes it
  expect((await loopRoad(page)).xsection?.rowDesignFt).toBeUndefined();
  await page.getByTestId("road-row").fill("100"); await page.getByTestId("road-row").press("Enter");
  await expect.poll(async () => (await loopRoad(page)).xsection?.rowDesignFt).toBe(100);
  await expect(page.getByTestId("road-summary")).toContainText("100 ft ROW");
  expect((await loopRoad(page)).travelW, "designating a ROW never changes the pavement width").toBe(44);
  await page.getByTestId("road-row").fill(""); await page.getByTestId("road-row").press("Enter");
  await expect.poll(async () => (await loopRoad(page)).xsection?.rowDesignFt).toBeUndefined();
  await expect(page.getByTestId("road-summary")).not.toContainText("ROW");

  expect(await loopRoad(page)).toMatchObject(CURBED);
  expect(w0).toBe(40);
});

test("NEW-1 — label section: Name, then size / repeat / background / position write through the same fields", async ({ page }) => {
  await boot(page, { name: "" });
  await openRoadPanel(page);
  const panel = page.getByTestId("property-panel");
  // no name yet → only the Name row; the per-label controls appear once a name exists
  await expect(page.getByTestId("road-title")).toHaveText("Road");
  await expect(page.getByTestId("label-spacing")).toHaveCount(0);
  await page.getByTestId("road-name").fill("MAIN STREET");
  await expect(page.getByTestId("road-title")).toHaveText("MAIN STREET");
  await expect(page.getByTestId("label-spacing")).toBeVisible();
  await expect(panel.locator('input[type="range"]')).toHaveCount(0); // the slider is gone

  const sp0 = (await loopRoad(page)).labelSpacing;
  const spin = page.getByTestId("label-spacing").locator("xpath=ancestor::*[@data-numbox][1]").getByRole("button", { name: "Increase" });
  await spin.click();
  await expect.poll(async () => (await loopRoad(page)).labelSpacing).not.toBe(sp0);
  expect((await loopRoad(page)).labelSpacing).toBeGreaterThan(0);

  await page.getByTestId("label-halo-off").click();
  await expect.poll(async () => (await loopRoad(page)).labelHalo).toBe(false);
  await page.getByTestId("label-halo-on").click();
  await expect.poll(async () => (await loopRoad(page)).labelHalo).toBe(true);

  await page.getByTestId("label-position").selectOption("inside");
  await expect.poll(async () => (await loopRoad(page)).labelPlace).toBe("inside");
});

test("NEW-1 — the cross-section button opens the existing dialog", async ({ page }) => {
  await boot(page);
  await openRoadPanel(page);
  await page.getByTestId("edit-road-xsection").click();
  await expect(page.getByTestId("road-xsection-dialog")).toBeVisible();
});
