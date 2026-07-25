/* NEW-1/NEW-3/NEW-4 — the two things the owner asked for on 2026-07-25, locked in against his REAL
 * plan (never a mock — see road-tee-oblique.spec.js for why that distinction has teeth here):
 *
 *   1. "I should be able to just press three points if I'm building a road … but it doesn't seem
 *      like I can do that."  Three clicks DID store three points; what was missing was any way to
 *      SAY he was done — nothing on the canvas offered it and the instinctive Esc threw the draft
 *      away. So: a draft in progress must show a finish control, and clicking it must commit a
 *      three-point road with a real rounded corner.
 *   2. "the exclamation point should never become exclamation points, the software should self fix."
 *      A corner that can't hold its class turn must name the remedy and fix itself on one click —
 *      and the fix must keep the alignment square, not skew it into a chamfer.
 *
 * Run: npx playwright test e2e/road-corner-selffix.spec.js
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const FIXTURE = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/tsakiris-concept-a-live.json", import.meta.url), "utf8"));
const SITE_ID = "e2e-tsakiris-live";

async function loadOwnerPlan(page) {
  await armPlannerHooks(page);
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Tsakiris", name: "Concept A", origin: null, county: "waller",
    parcels: [], els: FIXTURE.els, measures: [], callouts: [], markups: [], settings: {},
    underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([id, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto("/");
  await expect(canvas(page)).toBeVisible();
}

const roads = (page) => page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const s = Object.values(m)[0] || {};
  return (s.els || []).filter((e) => e.type === "road" && Array.isArray(e.pts))
    .map((e) => ({ id: e.id, cls: e.roadClass, n: e.pts.length, pts: e.pts, vtx: e.vtx || [] }));
});

test.describe("NEW-1 — three clicks make a road", () => {
  test("a draft in progress offers a finish control, and clicking it commits the road", async ({ page }) => {
    await armPlannerHooks(page);
    await page.goto("/");
    try { await page.getByRole("button", { name: /Start blank/i }).click({ timeout: 8000 }); } catch { /* already blank */ }
    await expect(canvas(page)).toBeVisible();
    const box = await canvas(page).boundingBox();

    await page.getByRole("button", { name: "Road", exact: true }).click();
    await page.getByRole("button", { name: "Road presets" }).click();
    await page.getByRole("button", { name: /travel — click points/i }).first().click();

    // Keep every click well inside the canvas — the bottom strip carries the scale/north chips.
    const cx = (fx) => box.x + box.width * fx, cy = (fy) => box.y + box.height * fy;
    await page.mouse.click(cx(0.2), cy(0.3));              // start
    await page.waitForTimeout(150);
    await page.mouse.click(cx(0.7), cy(0.3));              // where it turns
    await page.waitForTimeout(150);
    await page.mouse.click(cx(0.7), cy(0.62));             // the end
    await page.waitForTimeout(150);

    const done = page.getByTestId("road-draft-finish");
    await expect(done, "the draft must offer a way to finish — its absence IS the reported bug").toBeVisible();
    await done.locator("rect").click({ force: true });

    await expect.poll(async () => (await roads(page)).length, { timeout: 10_000 }).toBe(1);
    const [r] = await roads(page);
    expect(r.n, "three clicks → exactly three control points").toBe(3);
    expect(r.vtx[1]?.treatment, "the turn is a real rounded corner, not a kink").toBe("arc");
    expect(r.vtx[1]?.radius).toBeGreaterThan(0);
  });
});

test.describe("NEW-3/NEW-4 — a corner that can't hold its class fixes itself", () => {
  test("the flag names the missing approach and one click clears it, squarely", async ({ page }) => {
    await loadOwnerPlan(page);
    const flags = page.locator("[data-road-radius-flag]");
    await expect.poll(async () => flags.count(), { timeout: 20_000 }).toBeGreaterThan(0);

    // It must SAY what it needs — a bare "!" is the thing being replaced.
    const first = flags.first();
    await expect(first).toContainText(/more approach|tighter than/);
    await expect(first, "and offer the fix in place").toContainText("Fix");
    expect(Number(await first.getAttribute("data-road-radius-shortfall"))).toBeGreaterThan(0);

    const fire = (await roads(page)).find((r) => r.cls === "fire");
    const bearingBefore = Math.atan2(fire.pts[3].y - fire.pts[2].y, fire.pts[3].x - fire.pts[2].x);

    let guard = 0;
    while (await flags.count() > 0 && guard++ < 6) {
      await flags.first().locator("rect").click({ force: true });
      await page.waitForTimeout(400);
    }
    await expect(flags, "every corner holds its class turn after the fix").toHaveCount(0);

    // The fix runs the approach OUT along its own bearing — it must not skew the alignment, which
    // is what the vertex-nudge fallback used to do (a chamfered entry no one lays out on a plan).
    const after = (await roads(page)).find((r) => r.cls === "fire");
    const bearingAfter = Math.atan2(after.pts[3].y - after.pts[2].y, after.pts[3].x - after.pts[2].x);
    expect(Math.abs(bearingAfter - bearingBefore)).toBeLessThan(0.02);
    expect(after.pts.length, "no control points invented or lost").toBe(fire.pts.length);
  });
});
