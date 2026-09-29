/* NEW-1 (owner report 2026-09-28: "the designed road sections just show as a single road") —
 * REGRESSION from B1788912 (ea236232), which retired the fixed bottom-of-stack `road-network-layer`
 * and put each dissolved road cluster into the unified creation-order paint stack at its NEWEST
 * member's z. A road's own node (which carries its band fills, lane marks, ROW lines) always
 * painted at-or-before its cluster's fill, so the plain asphalt buried every designed section.
 *
 * THE PROPERTY (structural, on the real render — not a registration count): for every road cluster,
 * each member's decoration paints AFTER (above, in DOM order) that cluster's own
 * `road-network-surface`, and every band fill the section declares is present. RED on the
 * pre-fix build (decoration precedes the surface), GREEN after. Also a lone road, a designed road
 * joined to a plain one, and the selected (lifted) state.
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const BANDS = [{ type: "travel", w: 12 }, { type: "travel", w: 12 }, { type: "median", w: 20 }, { type: "travel", w: 12 }, { type: "travel", w: 12 }];
const road = (id, cy, z, xsection) => ({
  id, type: "road", z, pts: [{ x: -300, y: cy }, { x: 300, y: cy }], vtx: [{}, {}], travelW: 68, curb: 0.5, roadClass: "local",
  cx: 0, cy, w: 600, h: 80, rot: 0, ...(xsection ? { xsection } : {}),
});
const designed = (id, cy, z) => road(id, cy, z, { bands: BANDS, rowDesignFt: 100 });

async function open(page, els, sel) {
  const DEMO = "xsec-order";
  const site = {
    id: DEMO, groupId: DEMO, site: "xsec order", name: "Plan 1", origin: null, county: null,
    parcels: [{ id: "pc1", locked: false, points: [{ x: -700, y: -300 }, { x: 700, y: -300 }, { x: 700, y: 900 }, { x: -700, y: 900 }] }],
    els, measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await armPlannerHooks(page);
  await page.addInitScript(([id, s]) => {
    try { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: s })); localStorage.setItem("planarfit:currentSite:v1", id); } catch (e) { /* */ }
  }, [DEMO, site]);
  await page.goto("/");
  await page.getByTestId("module-tab-site-planner").filter({ visible: true }).click({ timeout: 8000 }).catch(() => {});
  await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(800);
  if (sel) await page.evaluate((id) => document.querySelector(`[data-el-id="${id}"]`)?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 0, clientY: 0 })), sel);
}

/* Document-order facts: for each cluster, where its surface sits and where each member's decoration sits. */
const order = (page) => page.evaluate(() => {
  const all = [...document.querySelectorAll('[data-testid="planner-canvas"] *')];
  const idx = (n) => all.indexOf(n);
  return [...document.querySelectorAll("[data-road-cluster]")].map((c) => {
    const surface = c.querySelector('[data-testid="road-network-surface"]');
    const ids = c.getAttribute("data-road-cluster").split(",");
    return {
      ids,
      members: ids.map((id) => {
        // The decoration node: its own `data-road-deco` group after the fix; before it, the road's
        // own `[data-el-id]` node carried it — asking for either keeps the red proof honest.
        const deco = document.querySelector(`[data-road-deco="${id}"]`) || document.querySelector(`[data-el-id="${id}"]`);
        return {
          id, decoAfterSurface: !!(deco && idx(deco) > idx(surface)),
          bandFills: deco ? deco.querySelectorAll("polygon").length : 0,
          laneMarks: deco ? [...deco.querySelectorAll("polyline")].filter((p) => ["#e6b800", "#f2f2f2"].includes(p.getAttribute("stroke"))).length : 0,
        };
      }),
    };
  });
});

const expectDecoAboveSurface = (clusters, id, { minFills }) => {
  const m = clusters.flatMap((c) => c.members).find((x) => x.id === id);
  expect(m, `member ${id} present`).toBeTruthy();
  expect(m.decoAfterSurface, `${id}: decoration must paint AFTER (above) its cluster's fill`).toBe(true);
  expect(m.bandFills, `${id}: band fills present`).toBeGreaterThanOrEqual(minFills);
  expect(m.laneMarks, `${id}: lane striping present`).toBeGreaterThan(0);
};

test.describe("road cross-section decoration paints above its cluster's fill (B1788912 regression)", () => {
  test("a lone designed road", async ({ page }) => {
    await open(page, [designed("dsg", 0, 5)]);
    expectDecoAboveSurface(await order(page), "dsg", { minFills: 1 });
  });

  test("a designed road clustered with plain roads older AND newer than it", async ({ page }) => {
    // (At the whole-site framing only the 20′ median clears the per-band zoom gate of PR #1499, hence minFills 1.)
    // Three parallel roads would not touch; join them with a connector so they form ONE cluster.
    const older = road("old", 0, 1), newer = road("new", 0, 9);
    older.pts = [{ x: -300, y: 0 }, { x: 0, y: 0 }]; older.cx = -150; older.w = 300;
    newer.pts = [{ x: 0, y: 0 }, { x: 300, y: 0 }]; newer.cx = 150; newer.w = 300;
    const mid = designed("mid", 0, 5);
    mid.pts = [{ x: 0, y: 0 }, { x: 0, y: 400 }]; mid.cx = 0; mid.cy = 200; mid.w = 80; mid.h = 400;
    await open(page, [older, mid, newer]);
    const clusters = await order(page);
    expect(clusters.length).toBeGreaterThan(0);
    expectDecoAboveSurface(clusters, "mid", { minFills: 1 });
  });

  test("the selected (lifted) designed road", async ({ page }) => {
    await open(page, [designed("dsg", 0, 5)], "dsg");
    expectDecoAboveSurface(await order(page), "dsg", { minFills: 1 });
  });
});
