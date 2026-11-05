/* NEW-2 (owner report 2026-10-14, Concept A) — two roads tee onto the SAME trunk; one tee got curb returns on BOTH corners, the other on ONE
 * side only (the other corner left SQUARE).
 *
 * ROOT CAUSE (lib/roadJunctions.js `armStraightRun`): an arm's straight run was capped at the IMMEDIATELY adjacent interior vertex, even when that
 * vertex renders no corner at all — a collinear vertex, or a leftover connect vertex a few feet from the tee node. A run shorter than the side
 * road's half-width puts the fillet's corner BEYOND the run, `nodeJunction`'s `tMax` goes to 0, and that one corner is square.
 *
 * THE PROPERTY, asked of the app's own geometry through `window.__plannerRoadNet()` (`tees[].cornerR`, one radius per curb return the tee builds):
 * every corner of every tee between two nearby tees on one trunk has R > 0. RED on the pre-fix build (a 0 on the side the stray vertex sits), GREEN after.
 * Seeded, not drawn: the stray vertices are the whole variable, and a drawn trunk would not have them (WRONG-CASE — the tidy fixture passes on main).
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const road = (id, pts, travelW = 24) => ({
  id, type: "road", z: 1, pts, vtx: pts.map(() => ({})), travelW, curb: 0.5, roadClass: "aisle",
  cx: pts[0].x, cy: pts[0].y, w: 10, h: 10, rot: 0,
});
const X = (x, y = 0) => ({ x, y });
const down = (id, x) => road(id, [{ x, y: -160 }, { x, y: 0 }]);
const up = (id, x) => road(id, [{ x, y: 160 }, { x, y: 0 }]);

async function open(page, els) {
  const ID = "tee-corners";
  const site = {
    id: ID, groupId: ID, site: "tee corners", name: "Plan 1", origin: null, county: null,
    parcels: [{ id: "pc1", locked: false, points: [{ x: -500, y: -400 }, { x: 500, y: -400 }, { x: 500, y: 400 }, { x: -500, y: 400 }] }],
    els, measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await armPlannerHooks(page);
  await page.addInitScript(([id, s]) => {
    try { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: s })); localStorage.setItem("planarfit:currentSite:v1", id); } catch (e) { /* */ }
  }, [ID, site]);
  await page.goto("/");
  await page.getByTestId("module-tab-site-planner").filter({ visible: true }).click({ timeout: 8000 }).catch(() => {});
  await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => page.evaluate(() => (window.__plannerRoadNet ? window.__plannerRoadNet().tees.length : -1)), { timeout: 15000 }).toBeGreaterThan(0);
  return page.evaluate(() => window.__plannerRoadNet());
}
/* WRONG-CASE precondition: the stray vertices must SURVIVE the load-time cleanup (`migrateRoad` drops collinear ones and any stub shorter than a quarter
 * of the road's width that carries a turn) — a fixture whose strays were silently removed passes on a dead fix. `net.roads` is the cleaned model. */
const trunkPts = async (page) => (await page.evaluate(() => window.__plannerRoadNet())).roads.find((r) => r.id === "G").pts.length;
const zeroCorners = (net) => net.tees.flatMap((t) => t.cornerR.map((r, k) => ({ side: t.sideId, corner: k, R: r }))).filter((c) => !(c.R > 0));

test.describe("NEW-2 — every tee corner gets a curb return", () => {
  test("two tees on one trunk, each with a leftover connect vertex 8 ft off its node", async ({ page }) => {
    // 1.8 ft off the chord at 8 ft = an ~13° stub: past the 1.5 ft simplify tolerance (so it survives load), and a real arc corner whose
    // tangent run is clamped to a few feet — far less straight run than the side road's half-width.
    const net = await open(page, [road("G", [X(-400), X(-8, 1.8), X(0), X(52, 1.8), X(60), X(400)]), down("S1", 0), up("S2", 60)]);
    expect(await trunkPts(page), "the leftover vertices survived load").toBe(6);
    expect(net.tees.length).toBe(2);
    expect(zeroCorners(net), "a tee corner was left square").toEqual([]);
  });

  test("a leftover vertex beside a single tee node, on each side", async ({ page }) => {
    const net = await open(page, [road("G", [X(-400), X(-8, 1.8), X(0), X(8, 1.8), X(400)]), down("S1", 0)]);
    expect(await trunkPts(page)).toBe(5);
    expect(net.tees.length).toBe(1);
    expect(zeroCorners(net)).toEqual([]);
  });

  test("two tees 45 ft apart, real vertices at both nodes (opposite sides)", async ({ page }) => {
    const net = await open(page, [road("G", [X(-400), X(0), X(45), X(400)]), down("S1", 0), up("S2", 45)]);
    expect(net.tees.length).toBe(2);
    expect(zeroCorners(net)).toEqual([]);
  });

  test("control — a tee with a clean trunk keeps full returns on both corners", async ({ page }) => {
    const net = await open(page, [road("G", [X(-400), X(0), X(400)]), down("S1", 0)]);
    expect(net.tees[0].cornerR.length).toBe(2);
    for (const r of net.tees[0].cornerR) expect(r).toBeGreaterThan(20);   // the aisle class's own return, un-shrunk
  });
});
