/* B2090352 — MERGE PARCELS REFUSED NEIGHBOURS THAT PLAINLY TOUCH.
 * Owner report (2026-10-05): "sometimes it won't let me add parcels together even though they're right next
 * to each other … the parcel boundary isn't shared." The old merge only fused a pair whose common edge was
 * vertex-for-vertex identical; the usual county shape — one lot shorter than its neighbour, so its corner
 * lands mid-way along the other's edge — was refused. This drives the REAL merge-pick flow, logged out, on a
 * seeded plan (sibling of parcel-merge-inactive-refusal.spec.js, which only ever covered the identical-twin
 * shape) and asserts: the mid-edge-corner pair fuses to ONE parcel with the right area; and a pair across a
 * street is still refused with the banner, leaving both parcels alone.
 */
import { test, expect } from "@playwright/test";
import { openModule } from "./helpers.js";

const canvas = (page) => page.locator('[data-testid="planner-canvas"]');
const R = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

const site = (id, a, b) => ({
  id, groupId: id, site: "Merge Test", name: "Concept A", origin: null, county: null,
  parcels: [{ id: "pA", points: a, active: true, locked: true }, { id: "pB", points: b, active: true, locked: true }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, updatedAt: Date.now(),
});

async function open(page, id, rec) {
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.addInitScript(([sid, r]) => {
    if (localStorage.getItem("e2e:seeded:" + sid)) return;
    localStorage.setItem("e2e:seeded:" + sid, "1");
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [sid]: r }));
    localStorage.setItem("planarfit:currentSite:v1", sid);
  }, [id, rec]);
  await page.goto("/");
  await openModule(page, "site-planner");
  await expect(canvas(page)).toBeVisible({ timeout: 30_000 });
  await page.locator('[data-rail-tab="parcel"]').click();
  await expect(page.getByTestId("parcel-row-pA")).toBeVisible({ timeout: 20_000 });
}

const readParcels = (page, id) => page.evaluate((sid) => JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}")[sid]?.parcels || [], id);
const area = (pts) => Math.abs(pts.reduce((s, p, i, arr) => { const q = arr[(i + 1) % arr.length]; return s + (p.x * q.y - q.x * p.y); }, 0) / 2);

async function pickBoth(page) {
  await page.getByTestId("rail-parcel-tools").click();
  await page.getByRole("button", { name: /^Combine parcels/ }).click();
  await page.getByTestId("parcel-row-pA").click();
  await page.getByTestId("parcel-row-pB").click();
  await expect(page.getByTestId("parcel-row-pB")).toContainText("✓");
}

test.describe("Merge parcels fuses neighbours whose common line is not edge-for-edge identical (B2090352)", () => {
  test("a shorter neighbour (corner lands mid-way along the other lot's edge) merges to one parcel", async ({ page }) => {
    const ID = "e2eMergeMidEdge";
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await open(page, ID, site(ID, R(0, 0, 200, 100), R(200, 0, 400, 60))); // 20,000 + 12,000 sf
    await pickBoth(page);
    await page.getByRole("button", { name: /Merge parcels ⏎/i }).click();
    await expect.poll(async () => (await readParcels(page, ID)).length).toBe(1);
    const merged = (await readParcels(page, ID))[0];
    expect(area(merged.points)).toBeCloseTo(32000, 0);
    expect(merged.locked).toBe(true);
    await expect(page.locator("text=/touch edge-to-edge/i")).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("two lots across a street are still refused with the banner and neither is touched", async ({ page }) => {
    const ID = "e2eMergeAcrossStreet";
    await open(page, ID, site(ID, R(0, 0, 200, 100), R(240, 0, 440, 100))); // 40 ft apart
    await pickBoth(page);
    await page.getByRole("button", { name: /Merge parcels ⏎/i }).click();
    await expect(page.locator("text=/touch edge-to-edge/i")).toBeVisible();
    expect((await readParcels(page, ID)).length).toBe(2);
  });
});
