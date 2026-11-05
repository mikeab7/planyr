/* NEW-1 — Easement panel: editable Map label first, Recording details tucked away.
 * Seeded, logged out. Asserts from the live DOM: field order, custom label drawn on the map,
 * clearing restores the automatic name, Ctrl+Z restores it, Recording details collapsed with a
 * summary, "Exclusive easement" with no hint line, and the label survives a reload. */
import { test, expect } from "@playwright/test";
import { armPlannerHooks, openModule } from "./helpers.js";
import { assertMeasurable, pacedWait } from "../ui-audit/lib/tabTiming.mjs";
import { deriveEasementRing } from "../src/workspaces/site-planner/lib/easements.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const SITE_ID = "e2e-easement-map-label";
const E = { id: "el1", kind: "easement", mode: "centerline", width: 50, easeType: "pipeline", status: "existing",
  holder: "CenterPoint", recording: "Vol 412 Pg 88", exclusive: true, restrictsBuildings: true, restrictsPaving: false,
  centerline: [{ x: 300, y: 600 }, { x: 2100, y: 600 }], z: 100 };
E.pts = deriveEasementRing(E);
const PARCEL = { id: "p-l", active: true, pts: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1200 }, { x: 0, y: 1200 }] };

async function boot(page) {
  await armPlannerHooks(page);
  const site = { id: SITE_ID, groupId: SITE_ID, site: "MapLabel", name: "A", origin: { lat: 29.78, lon: -95.82 }, county: "harris",
    parcels: [PARCEL], els: [], measures: [], callouts: [], markups: [E], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
  await page.addInitScript(([id, rec]) => {
    if (sessionStorage.getItem("seeded")) return; sessionStorage.setItem("seeded", "1");
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:sites:history:v1", JSON.stringify({ [id]: [] }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto("/");
  if (!(await canvas(page).count())) await openModule(page, "site-planner");
  await expect(canvas(page)).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.locator(`[data-markup="${E.id}"]`).count(), { timeout: 20_000 }).toBeGreaterThan(0);
  await pacedWait(page, 1000);
  await assertMeasurable(page, "easement-map-label");
}
const mapLabel = (page) => page.locator(`[data-markup="${E.id}"] [data-easement-label] text`).first();
async function select(page) {
  const box = await page.locator(`[data-markup="${E.id}"] polygon`).first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole("button", { name: "Properties" }).first().click();
  await expect(page.getByTestId("easement-map-label")).toBeVisible({ timeout: 10_000 });
}

test("easement panel: Map label first, custom label on the map, recording details collapsed", async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);
  await select(page);
  const input = page.getByTestId("easement-map-label");
  // order of the always-visible fields
  const ys = [];
  for (const name of ["Map label", "Type", "Width (ft)", "Status", "Recording details"]) {
    const box = await page.getByText(name, { exact: true }).first().boundingBox();
    expect(box, `${name} not visible`).not.toBeNull();
    ys.push(box.y);
  }
  expect([...ys].sort((x, y) => x - y)).toEqual(ys);
  await expect(input).toHaveAttribute("placeholder", "50′ Pipeline Esmt");
  // Recording details collapsed, summary shown, fields hidden
  const hdr = page.getByRole("button", { name: /Recording details/ });
  await expect(hdr).toHaveAttribute("aria-expanded", "false");
  await expect(hdr).toContainText("CenterPoint · Vol 412 Pg 88 · Exclusive");
  await expect(page.getByText("Holder / beneficiary")).toHaveCount(0);
  await hdr.click();
  await expect(page.getByText("Holder / beneficiary")).toBeVisible();
  const cb = page.getByLabel("Exclusive easement");
  await expect(cb).toBeChecked();
  await expect(page.getByText(/Exclusive use/)).toHaveCount(0);
  // custom label drawn on the map
  await input.fill("Enterprise 12in");
  await expect(mapLabel(page)).toHaveText("Enterprise 12in");
  // clearing restores the automatic name
  await input.fill("");
  await expect(mapLabel(page)).toHaveText("50′ Pipeline Esmt");
  // type change with custom label set leaves custom label alone
  await input.fill("WL-A");
  await expect(mapLabel(page)).toHaveText("WL-A");
  // one typing session = one undo frame
  await input.blur();
  await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.mouse.move(400, 400);
  await page.keyboard.press("Control+z");
  await expect(mapLabel(page)).not.toHaveText("WL-A");
  await page.keyboard.press("Control+y");
  await expect(mapLabel(page)).toHaveText("WL-A");
  // persisted locally across a reload
  await pacedWait(page, 1500);
  await page.reload();
  await expect(canvas(page)).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.locator(`[data-markup="${E.id}"]`).count(), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect(mapLabel(page)).toHaveText("WL-A", { timeout: 15_000 });
});
