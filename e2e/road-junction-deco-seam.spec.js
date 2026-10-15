/* NEW-1 (owner report 2026-10-14, Concept A) — a LINE between the road's body and its curb-return curves, again (recurrence of B1783376, exposed by B1958144).
 *
 * The pavement is ONE dissolved shape per cluster, but each road's DECORATION (cross-section band fills, lane seams, face-of-curb stripes) was bounded
 * by that road's OWN strip ring. At a junction the strip's straight edge is exactly where the untinted fillet wedge begins, so every tinted band stopped
 * on a straight line running ALONG the pavement; and on a road-to-road tee the face-of-curb stripe stopped dead at the fillet (only a drive-into-pad
 * junction continued it). B1958144 moved the decoration above the fill, which is what un-buried both.
 *
 * THE PROPERTIES, asked of the app's own geometry through `window.__plannerRoadNet()` (`deco` = where each road's decoration may paint, `stripes` = the
 * trimmed face-of-curb lines, `regions` = the dissolved pavement):
 *   1. every edge of a road's decoration domain is either ON the pavement's outline or LATERAL (across the road) — never a longitudinal edge running
 *      through the interior alongside the fillet. A road with a junction MUST have a domain at all (RED on the pre-fix build: none exists).
 *   2. every point of every face-of-curb stripe is within a curb-width of the outline — none runs on through the interior beside a fillet.
 *   3. around every tee / drive curb return a stripe FOLLOWS the arc, a curb-width inside the pavement (RED pre-fix: tees had none; drives' sat a curb
 *      width OUTSIDE the pavement).
 * Seeded (not drawn) with real designed cross-sections — WRONG-CASE: a plain road has no bands, so the plain scenes only exercise 2 and 3.
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";
import { decoSeamViolations, interiorStripePoints, arcsWithoutStripe } from "../ui-audit/lib/junctionDecoProbe.mjs";

const CG = { type: "curbGutter", w: 2 };
const BANDS = [CG, { type: "travel", w: 10 }, { type: "median", w: 10 }, { type: "travel", w: 10 }, CG, { type: "sidewalk", w: 5 }];   // within-curb 34
const designed = (extra = {}) => ({ travelW: 34, xsection: { bands: BANDS } , ...extra });
const road = (id, pts, o = {}) => ({
  id, type: "road", z: 1, pts, vtx: pts.map(() => ({})), travelW: 34, curb: 0.5, roadClass: "local",
  cx: pts[0].x, cy: pts[0].y, w: 10, h: 10, rot: 0, ...o,
});
const P = (x, y) => ({ x, y });

async function open(page, els, kind) {   // kind = "tees" | "drives": wait until the app has built exactly one of that junction
  const ID = "deco-seam";
  const site = {
    id: ID, groupId: ID, site: "deco seam", name: "Plan 1", origin: null, county: null,
    parcels: [{ id: "pc1", locked: false, points: [{ x: -600, y: -500 }, { x: 600, y: -500 }, { x: 600, y: 500 }, { x: -600, y: 500 }] }],
    els, measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await armPlannerHooks(page);
  await page.addInitScript(([id, s]) => {
    try { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: s })); localStorage.setItem("planarfit:currentSite:v1", id); } catch (e) { /* */ }
  }, [ID, site]);
  await page.goto("/");
  await page.getByTestId("module-tab-site-planner").filter({ visible: true }).click({ timeout: 8000 }).catch(() => {});
  await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => page.evaluate((k) => { const n = window.__plannerRoadNet && window.__plannerRoadNet(); return !!n && n[k].length === 1; }, kind), { timeout: 15000 }).toBeTruthy();
  await page.waitForTimeout(500);
  return page.evaluate(() => window.__plannerRoadNet());
}

const SCENES = [
  {
    name: "tee — side AND through road carry a designed cross-section",
    els: () => [road("G", [P(-300, 0), P(0, 0), P(300, 0)], designed()), road("S", [P(0, -250), P(0, 0)], designed())],
    kind: "tees",
    arcs: (n) => n.tees[0].arcs,
    designedIds: ["G", "S"],
  },
  {
    name: "tee — plain roads (no cross-section)",
    els: () => [road("G", [P(-300, 0), P(0, 0), P(300, 0)]), road("S", [P(0, -250), P(0, 0)])],
    kind: "tees",
    arcs: (n) => n.tees[0].arcs,
    designedIds: [],
  },
  {
    name: "drive into a parking pad — designed side road",
    els: () => [{ id: "PAD", type: "parking", z: 0, cx: 0, cy: 100, w: 400, h: 200, rot: 0 }, road("S", [P(0, -300), P(0, 10)], designed())],
    kind: "drives",
    arcs: (n) => n.drives[0].returns,
    designedIds: ["S"],
  },
  {
    name: "drive into a parking pad — plain side road",
    els: () => [{ id: "PAD", type: "parking", z: 0, cx: 0, cy: 100, w: 400, h: 200, rot: 0 }, road("S", [P(0, -300), P(0, 10)])],
    kind: "drives",
    arcs: (n) => n.drives[0].returns,
    designedIds: [],
  },
];

test.describe("NEW-1 — a junction's paved surface has no line between the road body and its curve", () => {
  for (const sc of SCENES) {
    test(sc.name, async ({ page }) => {
      const els = sc.els();
      const net = await open(page, els, sc.kind);
      expect(net.regions.length, "one dissolved pavement region").toBe(1);
      // 1. a road at a junction has a decoration domain, and none of its edges runs along the pavement
      const junctionRoads = sc.designedIds.length ? sc.designedIds : [];
      for (const id of junctionRoads) expect((net.deco || []).some((d) => d.id === id), `road ${id}: decoration domain exists (bounded at the throat)`).toBe(true);
      if (!junctionRoads.length) expect(net.deco, "the build exposes the decoration domains").toBeTruthy();
      expect(decoSeamViolations(net, net.roads), "a decoration edge runs along the pavement").toEqual([]);
      // 2. no face-of-curb stripe running through the interior
      expect(interiorStripePoints(net), "a curb stripe runs through the interior of the pavement").toEqual([]);
      // 3. the stripe follows the return(s), a curb-width inside the pavement
      expect(arcsWithoutStripe(net, sc.arcs(net)), "a curb return carries no stripe").toEqual([]);
    });
  }

  test("a designed road still paints its bands ABOVE the cluster's fill, and the bands are still drawn (B1958144 does not regress)", async ({ page }) => {
    await open(page, [road("G", [P(-300, 0), P(0, 0), P(300, 0)], designed()), road("S", [P(0, -250), P(0, 0)], designed())], "tees");
    await page.evaluate(() => window.__plannerView && window.__plannerView.centerOn(0, -40, 0.4));
    await page.waitForTimeout(700);
    const r = await page.evaluate(() => {
      const all = [...document.querySelectorAll('[data-testid="planner-canvas"] *')];
      const surface = document.querySelector('[data-testid="road-network-surface"]');
      return ["G", "S"].map((id) => {
        const deco = document.querySelector(`[data-road-deco="${id}"]`);
        const clip = document.getElementById(`xsclip-${id}`);
        return { id, after: !!deco && all.indexOf(deco) > all.indexOf(surface), fills: deco ? deco.querySelectorAll("polygon").length : 0, clipD: clip ? clip.querySelector("path").getAttribute("d") : null };
      });
    });
    for (const m of r) {
      expect(m.after, `${m.id}: decoration paints after the fill`).toBe(true);
      expect(m.fills, `${m.id}: band fills drawn`).toBeGreaterThan(0);
      expect(m.clipD, `${m.id}: bounded by a decoration domain`).toBeTruthy();
    }
  });
});
