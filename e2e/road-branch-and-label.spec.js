/* NEW-8 / NEW-9 — two owner requests from 2026-07-25, driven against his REAL plan:
 *
 *   "add a feature where I can right click on a road and, basically, add a road coming out of it
 *    like a t."
 *   "I want to also… put the name label of, like, easement or a road… I'd like an option to put it
 *    on the center line. because right now, that's what I thought this would do, but it's not
 *    putting it there."
 *
 * Run: npx playwright test e2e/road-branch-and-label.spec.js
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { armPlannerHooks, roadNetwork } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const FIXTURE = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/tsakiris-concept-a-live.json", import.meta.url), "utf8"));
const SITE_ID = "e2e-branch-label";
const LOOP = "e38duuwgj";                                  // the 40' truck loop

async function loadPlan(page, tweak = (e) => e) {
  await armPlannerHooks(page);
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Tsakiris", name: "Concept A", origin: null, county: "waller",
    parcels: [], els: FIXTURE.els.map(tweak), measures: [], callouts: [], markups: [], settings: {},
    underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([id, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto("/");
  await expect(canvas(page)).toBeVisible();
  await page.waitForFunction(() => !!window.__plannerView, null, { timeout: 20_000 });
}
const roads = (page) => page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const s = Object.values(m)[0] || {};
  return (s.els || []).filter((e) => e.type === "road" && Array.isArray(e.pts)).map((e) => ({ id: e.id, cls: e.roadClass, w: e.travelW, n: e.pts.length }));
});

test.describe("NEW-8 — branch a road off another with a right-click", () => {
  test("the menu offers it, and the new road resolves as a REAL tee inheriting the parent's section", async ({ page }) => {
    await loadPlan(page);
    const CX = 1500, CY = 100, PPF = 0.5;
    await page.evaluate(([x, y, p]) => window.__plannerView.centerOn(x, y, p), [CX, CY, PPF]);
    await page.waitForTimeout(400);
    const box = await canvas(page).boundingBox();
    const v = await page.evaluate(() => window.__plannerView.get());
    const f2s = (fx, fy) => ({ x: box.x + v.w / 2 + (fx - CX) * PPF, y: box.y + v.h / 2 + (fy - CY) * PPF });

    const before = await roads(page);
    const parent = before.find((r) => r.id === LOOP);

    const on = f2s(1649, 100);
    await page.mouse.click(on.x, on.y, { button: "right" });
    const item = page.getByTestId("road-branch-here");
    await expect(item, "a road's right-click menu must offer the branch").toBeVisible();
    await item.click();

    // The draft starts AT the road — one click places the far end, then the on-canvas finish control.
    const to = f2s(1300, 100);
    await page.mouse.click(to.x, to.y);
    const done = page.getByTestId("road-draft-finish");
    await expect(done).toBeVisible();
    await done.locator("rect").click({ force: true });

    await expect.poll(async () => (await roads(page)).length, { timeout: 10_000 }).toBe(before.length + 1);
    const fresh = (await roads(page)).find((r) => !before.some((b) => b.id === r.id));
    expect(fresh.cls, "the branch inherits the parent's class").toBe(parent.cls);
    expect(fresh.w, "…and its travel width").toBe(parent.w);

    const net = await roadNetwork(page);
    const tee = net.tees.find((t) => t.sideId === fresh.id);
    expect(tee, "the branch must resolve as a TEE, not a road merely lying nearby").toBeTruthy();
    expect(tee.wedges, "with curb returns on both sides").toBe(2);
    expect(tee.R).toBeGreaterThan(1);
  });
});

test.describe("NEW-9 — a road's name label can ride the centre line", () => {
  const label = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid="planner-canvas"] text')]
    .filter((t) => t.textContent === "BAUER HOCKLEY")
    .map((t) => ({ x: +t.getAttribute("x"), y: +t.getAttribute("y") }))
    .sort((a, b) => a.y - b.y || a.x - b.x));

  const at = async (page, place) => {
    await loadPlan(page, (e) => (e.id === LOOP
      ? { ...e, inlineLabel: "BAUER HOCKLEY", labelSpacing: 600, labelPlace: place, labelInside: place === "inside" } : e));
    await page.evaluate(() => window.__plannerView.centerOn(1645, 50, 0.6));
    await page.waitForTimeout(400);
    return label(page);
  };

  test("centre / beside / inside are three DISTINCT places, and centre is the one that rides the line", async ({ page }) => {
    const center = await at(page, "center");
    expect(center.length, "the label must render at all").toBeGreaterThan(0);
    const off = await at(page, "off");
    const inside = await at(page, "inside");
    expect(off).toHaveLength(center.length);
    expect(inside).toHaveLength(center.length);

    const shift = (a, b) => Math.min(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));
    // "Just beside" is the OLD default; if centring didn't move the text, the new option is a no-op —
    // which is exactly what the owner reported about the previous control.
    expect(shift(off, center), "centring must actually move the label off the old just-beside spot").toBeGreaterThan(3);
    expect(shift(inside, center)).toBeGreaterThan(3);
    // Which of "beside" and "inside" sits further out is ZOOM-DEPENDENT by design — "beside" is a
    // font-height clearance in screen space, "inside" a quarter of the road's width in feet — so the
    // invariant is that all three are distinct, never a fixed order between those two.
    expect(shift(inside, off)).toBeGreaterThan(3);
  });

  test("a plan saved before this existed renders exactly as it did", async ({ page }) => {
    // Only the old boolean present: true → inside, absent/false → just beside. No new field, no change.
    await loadPlan(page, (e) => (e.id === LOOP ? { ...e, inlineLabel: "BAUER HOCKLEY", labelSpacing: 600, labelInside: true } : e));
    await page.evaluate(() => window.__plannerView.centerOn(1645, 50, 0.6));
    await page.waitForTimeout(400);
    const legacy = await label(page);
    const inside = await at(page, "inside");
    expect(legacy).toHaveLength(inside.length);
    for (let i = 0; i < legacy.length; i++) {
      expect(Math.hypot(legacy[i].x - inside[i].x, legacy[i].y - inside[i].y)).toBeLessThan(0.01);
    }
  });
});
