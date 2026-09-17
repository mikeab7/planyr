/* B1749152 (NEW-1) — "drag the south-edge resize handle on an employee-parking field; it grows
 * from the wrong edge and the field jumps/resizes along the wall too", driven through the REAL
 * render and the REAL drag.
 *
 * ROOT CAUSE: `hostClampOf` (SitePlanner.jsx) picks which host-local axis ("x"/"y") faces AWAY
 * from the building by comparing `|l.x| - host.w/2` against `|l.y| - host.h/2` — a proxy for
 * "which side is this on" that assumes the element's ALONG-the-wall offset stays smaller than its
 * PERPENDICULAR one. That assumption fails for a short field sitting off-centre on a long wall (or
 * one a dog-ear bump-out has lengthened): its along-wall offset can exceed its depth offset, so the
 * heuristic names the wrong axis. `clampToHost` then re-pins the WRONG axis on a depth-only drag —
 * the ALONG-wall position snaps toward the wall centre and its run resets toward the span default,
 * while the depth itself may still track correctly, which reads as "it grew from the wrong edge."
 *
 * FIX: `hostClampOf` now reads the element's own stored wall tag (`sideParkSide` / `sidewalkSide` /
 * a dock zone's own side) FIRST, the same "trust the stored fact" pattern `dockAxis` already uses,
 * and only falls back to the geometric guess when no such tag exists.
 *
 * This fixture reproduces the owner's shape directly: a 60 ft employee-parking field, legitimately
 * trimmed (carries a matching `sideParkFit` stamp, exactly what a prior edge-drag would record),
 * sitting 140 ft along a 200 ft LEFT wall — off-centre enough to flip the old heuristic's axis pick.
 *
 * Logged out, no external GIS, local storage only: Claude-doable here, per ATTEMPT-BEFORE-YOU-PARK.
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks, openModule } from "./helpers.js";

const SITE_ID = "e2e-side-park-depth-anchor";
const HOST = "hostBldg1";
const PAD = "empPark1";

const BUILDING = { id: HOST, type: "building", cx: 5000, cy: 5000, w: 400, h: 200, rot: 0, dock: "both" };
// A short (60 ft) field, off-centre 115 ft along a 200 ft LEFT wall (still genuinely ON the wall —
// its own near end sits at 115-30=85, inside the wall's 100 ft half-length), flush against it
// (depth 18 ft), with a STAMP matching its own geometry exactly — the shape a prior, legitimate
// edge-drag leaves. |l.y|-host.h/2 = 15 exceeds |l.x|-host.w/2 = 9 (depth/2), which is exactly what
// flips `hostClampOf`'s old heuristic onto the wrong axis.
const PAD_EL = {
  id: PAD, type: "parking", cx: BUILDING.cx - (BUILDING.w / 2 + 18 / 2), cy: BUILDING.cy + 115,
  w: 60, h: 18, rot: 90, attachedTo: HOST, sideParkSide: "left",
  sideParkFit: { run: 60, alongShift: 115 },
};

const canvas = (p) => p.getByTestId("planner-canvas");

async function loadPlan(page) {
  await armPlannerHooks(page);
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Test", name: "Side-park depth anchor", origin: null, county: "harris",
    parcels: [], els: [BUILDING, PAD_EL], measures: [], callouts: [], markups: [],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: 1785500000000,
  };
  await page.addInitScript(([id, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto("/");
  await openModule(page, "site-planner");
  await expect(canvas(page)).toBeVisible({ timeout: 45000 });
  await expect.poll(() => page.locator(`[data-el-id="${PAD}"]`).count(), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window.__plannerView ? 1 : 0)), { timeout: 20_000 }).toBe(1);
  await page.evaluate(([x, y]) => window.__plannerView.centerOn(x, y, 0.8), [BUILDING.cx, BUILDING.cy]);
  await page.waitForTimeout(150);
}

async function select(page, id) {
  const c = await page.evaluate((elId) => {
    const r = document.querySelector(`[data-el-id="${elId}"] rect`);
    const b = r.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, id);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator('[data-handle="edge"]').first()).toBeVisible({ timeout: 5_000 });
}

const readEl = (page, id) => page.evaluate(({ key, siteId, id }) => {
  const rec = JSON.parse(localStorage.getItem(key) || "{}")[siteId];
  return (rec.els || []).find((e) => e.id === id);
}, { key: "planarfit:sites:v1", siteId: SITE_ID, id });

test("dragging the DEPTH edge of a short, off-centre side-parking field grows away from the wall — never the along-wall position or run", async ({ page }) => {
  await loadPlan(page);
  const before = await readEl(page, PAD);
  expect(before.w, "sanity: fixture starts short").toBe(60);
  expect(before.cy, "sanity: fixture starts off-centre along the wall").toBeCloseTo(5115, 0);

  await select(page, PAD);

  // The DEPTH-axis grips are always "0,1"/"0,-1" in the element's own local frame; pick whichever
  // is farther from the host as the "away" (outward) one, exactly as a user would grab it.
  const hostCenter = await page.evaluate((hostId) => {
    const b = document.querySelector(`[data-el-id="${hostId}"] rect`).getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, HOST);
  const grips = await page.locator('[data-handle="edge"]').all();
  let away = null, awayD = -1;
  for (const g of grips) {
    const attr = await g.getAttribute("data-edge");
    if (attr !== "0,1" && attr !== "0,-1") continue;
    const bb = await g.boundingBox();
    const d = Math.hypot(bb.x - hostCenter.x, bb.y - hostCenter.y);
    if (d > awayD) { awayD = d; away = bb; }
  }
  expect(away, "a depth-axis edge grip is on screen").toBeTruthy();

  const x = away.x + away.width / 2, y = away.y + away.height / 2;
  const dx = x - hostCenter.x, dy = y - hostCenter.y, len = Math.hypot(dx, dy) || 1;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + (dx / len) * 30, y + (dy / len) * 30, { steps: 6 });
  await page.mouse.move(x + (dx / len) * 60, y + (dy / len) * 60, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  const after = await readEl(page, PAD);
  expect(after.h, "depth grew").toBeGreaterThan(before.h + 10);
  expect(after.w, "the along-wall RUN must not reset toward the wall span").toBeCloseTo(before.w, 0);
  expect(after.cy, "the along-wall POSITION must not snap toward the wall centre").toBeCloseTo(before.cy, 0);
  // The host-facing (near) edge stays put: the perpendicular distance from the host wall to the
  // pad's near face is unchanged even though the far face moved outward.
  const nearBefore = Math.abs(before.cx - BUILDING.cx) - before.h / 2;
  const nearAfter = Math.abs(after.cx - BUILDING.cx) - after.h / 2;
  expect(nearAfter, "the near (host-facing) edge does not move").toBeCloseTo(nearBefore, 0);
});
