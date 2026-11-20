/* NEW-1 (2026-11-06) — A FINISHED CLOUD MARKUP READS AS A CLOUD, AND ITS DOTS BELONG TO ITS SELECTION.
 *
 * Owner report: he drew a blue cloud round two ramps on a whole-site view and asked "why the dots get
 * left on it" (a square on every corner, the outline plain straight segments).
 * What was MEASURED before fixing (this spec drives the real tool):
 *   (a) handles stay after deselect ........... FALSE — gone on a click on empty map and on Esc.
 *   (b) stays selected with no way out ........ FALSE — a just-drawn markup is selected (like every
 *                                                tool's); Esc and an empty click both let go.
 *   (c) the cloud has no visible scallops ..... TRUE  — arc size is stored in FEET (3 ft), which at a
 *                                                whole-site zoom is a ~1 px radius: the scallops
 *                                                exist but nobody can see them, so the handles were
 *                                                the only thing that read as "wrong".
 * So the red arm here is the scallop radius ON SCREEN; the rest guard the neighbours (handles only
 * while selected, a plain press on a vertex never edits, handles never print).
 * Run: npx playwright test e2e/cloud-markup-reads.spec.js --project=chromium --no-deps
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { armPlannerHooks } from "./helpers.js";

/* A BLANK plan is the wrong fixture: with no parcel the planner arms its boundary-drawing tool as the
 * default, so a "click on empty map" there draws a parcel point instead of deselecting. The owner's own
 * Goose Creek geometry (a real parcel + buildings, framed whole-site) is the working-zoom scene. */
const FIXTURE = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/goose-creek-plan1copy.json", import.meta.url), "utf8"));

const SITE_ID = "e2e-cloud-reads";
const canvas = (p) => p.getByTestId("planner-canvas");

async function openBlankPlan(page) {
  await armPlannerHooks(page);
  const site = { id: SITE_ID, groupId: SITE_ID, site: "Cloud reads", name: "ZZ cloud reads", origin: null, county: "harris",
    parcels: FIXTURE.parcels, els: FIXTURE.els, measures: [], callouts: [], markups: [], settings: FIXTURE.settings || {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
  /* seed ONCE — an init script runs on every document, so an unconditional write would undo an edit across a reload */
  await page.addInitScript(([id, rec]) => {
    if (localStorage.getItem("planarfit:currentSite:v1") === id) return;
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto(`/#/project/${SITE_ID}/site`, { waitUntil: "load" });
  await expect(canvas(page)).toBeVisible();
  await expect.poll(async () => page.locator("[data-el-id]").count(), { timeout: 20_000 }).toBeGreaterThan(10); // el-tier: readiness = the plan is on the canvas
  await page.waitForTimeout(1200);
  return canvas(page).boundingBox();
}

/* A 13-point ring round "two ramps" — the shape of the owner's markup, drawn with the real Cloud tool. */
const RING = [[300,250],[340,236],[390,240],[430,262],[462,300],[470,346],[446,392],[400,418],[352,424],[312,404],[290,364],[286,312],[292,274]];
async function drawCloud(page, box) {
  await page.keyboard.press("c");
  for (const [x, y] of RING) await page.mouse.click(box.x + x, box.y + y);
  await page.mouse.click(box.x + RING[0][0], box.y + RING[0][1]); // close on the first dot
  await expect(page.locator('[data-mk-kind="cloud"]')).toHaveCount(1);
}

const read = (page) => page.evaluate(() => {
  const g = document.querySelector('[data-mk-kind="cloud"]');
  const d = g?.querySelector("path:not([stroke='rgba(0,0,0,0.001)'])")?.getAttribute("d") || "";
  const radii = [...d.matchAll(/A\s+([\d.]+)\s+([\d.]+)/g)].map((m) => +m[1]);
  const poly = g?.querySelector("polygon")?.getAttribute("points")?.split(" ").map((q) => q.split(",").map(Number)) || [];
  return {
    handles: document.querySelectorAll('[data-testid="vtx-handle"]').length,
    selected: !!document.querySelector('[data-testid="markup-selected"]'),
    arcs: radii.length,
    minRadiusPx: radii.length ? Math.min(...radii) : 0,
    shape: poly.map(([x, y]) => `${(x - poly[0][0]).toFixed(2)},${(y - poly[0][1]).toFixed(2)}`).join(" "),
    handlesNotPrinted: [...document.querySelectorAll('[data-testid="vtx-handle"]')].every((h) => h.getAttribute("data-export") === "skip"),
  };
});

test.describe("finished cloud markup", () => {
  test("its scallops are big enough to read at the zoom it was drawn at", async ({ page }) => {
    const box = await openBlankPlan(page);
    await drawCloud(page, box);
    const s = await read(page);
    expect(s.arcs).toBeGreaterThan(RING.length); // a chain of arcs, not straight segments
    expect(s.minRadiusPx, "scallop radius on screen").toBeGreaterThanOrEqual(5);
  });

  test("an OLD cloud (3 ft arcs saved before this fix) reads too — the floor is in the draw, not only the default", async ({ page }) => {
    const box = await openBlankPlan(page);
    await drawCloud(page, box);
    // force the stored size back to the old 3 ft default through the Properties panel field
    await page.mouse.dblclick(box.x + RING[0][0], box.y + RING[0][1]); // opens Properties
    await page.getByLabel("Arc size").fill("3");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    expect((await read(page)).minRadiusPx).toBeGreaterThanOrEqual(5);
  });

  test("dots show only while selected: just drawn = selected, an empty click or Esc lets go, and they never print", async ({ page }) => {
    const box = await openBlankPlan(page);
    await drawCloud(page, box);
    let s = await read(page);
    expect(s.selected && s.handles).toBeTruthy();
    expect(s.handlesNotPrinted).toBe(true);
    await page.mouse.click(box.x + 70, box.y + 150);
    s = await read(page);
    expect(s.handles).toBe(0);
    expect(s.selected).toBe(false);
    // select again, then Esc
    await page.mouse.click(box.x + RING[0][0], box.y + RING[0][1]);
    await expect.poll(async () => (await read(page)).handles).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    s = await read(page);
    expect(s.handles).toBe(0);
    expect(s.selected).toBe(false);
  });

  test("a plain press on a vertex dot never edits the shape, and a reload shows no dots and the same scallops", async ({ page }) => {
    const box = await openBlankPlan(page);
    await drawCloud(page, box);
    const before = await read(page);
    await page.mouse.click(box.x + RING[0][0], box.y + RING[0][1]); // press + release on vertex 0's dot, no travel
    await page.waitForTimeout(300);
    expect((await read(page)).shape).toBe(before.shape);
    await page.mouse.click(box.x + 70, box.y + 150);
    await page.waitForTimeout(1500); // let the autosave land
    await page.reload({ waitUntil: "load" });
    await expect(canvas(page)).toBeVisible();
    await expect(page.locator('[data-mk-kind="cloud"]')).toHaveCount(1);
    const after = await read(page);
    expect(after.handles).toBe(0);
    expect(after.selected).toBe(false);
    expect(after.minRadiusPx).toBeGreaterThanOrEqual(5);
  });
});
