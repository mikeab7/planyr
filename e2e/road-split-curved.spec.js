/* NEW-1 / NEW-2 — the road SPLIT, driven through the REAL render path on the owner's real plan.
 *
 * The lesson this family keeps re-teaching (B945…B1017) is that a mock cannot see these defects: on a
 * STRAIGHT road the chord between two control points IS the road, so a chord-based hit test and a
 * chord-based junction both look perfect. Goose Creek "Plan 1 (copy)" (production site sms69x8rb2qk,
 * ui-audit/fixtures/goose-creek-plan1-copy.json) contains the topology that breaks both:
 *
 *   • e1454749rlpiva — a 36' aisle running ~900 ft east off the 100' aisle, turning ~88° north through
 *     an ARC-treated vertex, and carrying a drive junction into a truck court at its far end;
 *   • e1454750rlpiva — the branch, welded to that same arc vertex and heading south. THE SPLIT.
 *
 * A 25 ft fillet at that vertex carries the drawn pavement ~10 ft clear of the node the branch hangs
 * off, so the branch's edges stepped against the through road's and one armpit got no curb return at
 * all. A junction is where two centerlines MEET: that vertex now renders as a hard corner and the
 * junction owns all the rounding.
 *
 * Run: npx playwright test e2e/road-split-curved.spec.js
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { armPlannerHooks, roadNetwork, netSurfaces, netEdges, ringArea } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const FIXTURE = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/goose-creek-plan1-copy.json", import.meta.url), "utf8"));
const SITE_ID = "e2e-goose-creek-plan1-copy";

const THROUGH = "e1454749rlpiva";   // the 36' aisle that bends ~88° at the split
const BRANCH = "e1454750rlpiva";    // the branch teed onto that bend
const SQUARE_TEE = { side: THROUGH, through: "e1454717dshobp" };   // 36' onto the 100' aisle, collinear vertex
const NODE = { x: -172.33983166519272, y: 791.4596954834877 };     // the split, in world feet
const HALF = 18.5;                                                 // 36' road + 6" curb each side

async function loadOwnerPlan(page) {
  await armPlannerHooks(page);
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Goose Creek", name: "Plan 1 (copy)", origin: null, county: "harris",
    parcels: [], els: FIXTURE.els, measures: [], callouts: [], markups: [], settings: {},
    underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([id, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto("/");
  await expect(canvas(page)).toBeVisible();
  await expect.poll(async () => (await roadNetwork(page))?.regions.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);
}

// The sharpest turn the dissolved outline makes within `rad` feet of `at`. A curb-return arc turns a
// few degrees per tessellation step; anything near a right angle is a STEP or a NOTCH.
const worstTurnNear = (regions, at, rad) => {
  const bearing = (ax, ay, bx, by) => (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
  let worst = 0;
  for (const region of regions) {
    const r = region.outer || [];
    for (let i = 0; i < r.length; i++) {
      const a = r[(i - 1 + r.length) % r.length], b = r[i], c = r[(i + 1) % r.length];
      if (Math.hypot(b.x - at.x, b.y - at.y) > rad) continue;
      const t = Math.abs((((bearing(b.x, b.y, c.x, c.y) - bearing(a.x, a.y, b.x, b.y)) + 540) % 360) - 180);
      if (t > worst) worst = t;
    }
  }
  return worst;
};

test.describe("NEW-2 — the road split resolves into one surface (owner's Goose Creek plan)", () => {
  test("the branch and its through road are ONE pavement region with ONE outline", async ({ page }) => {
    await loadOwnerPlan(page);
    const net = await roadNetwork(page);
    const together = net.regions.filter((r) => r.ids.includes(THROUGH) && r.ids.includes(BRANCH));
    expect(together, "the split is one surface, not two strips crossing").toHaveLength(1);
    // One fill and one stroke per region: never a second curb line inside a junction.
    await expect(netSurfaces(page)).toHaveCount(net.regions.length);
    await expect(netEdges(page)).toHaveCount(net.regions.length);
  });

  test("no STEP or NOTCH in the outline through the split", async ({ page }) => {
    await loadOwnerPlan(page);
    const net = await roadNetwork(page);
    const at = net.regions.filter((r) => r.ids.includes(BRANCH));
    expect(at.length).toBeGreaterThan(0);
    // Before this change the outline turned through better than a right angle TWICE within a lane of
    // the node — the owner's "it's not splitting correctly".
    expect(worstTurnNear(at, NODE, HALF * 1.5)).toBeLessThan(30);
  });

  test("BOTH armpits at the split get a real rounded curb return", async ({ page }) => {
    await loadOwnerPlan(page);
    const net = await roadNetwork(page);
    const tee = net.tees.find((t) => t.sideId === BRANCH && t.throughId === THROUGH);
    expect(tee, "the split is detected as a junction").toBeTruthy();
    expect(tee.wedges, "one additive curb-return wedge per armpit").toBe(2);
    expect(tee.R, "a real radius, not a squared-off corner").toBeGreaterThan(4);
    for (const n of tee.returns) expect(n, "a tessellated arc, not a chamfer").toBeGreaterThan(3);
  });

  test("no sliver holes survive the dissolve — only real enclosed ground", async ({ page }) => {
    await loadOwnerPlan(page);
    const net = await roadNetwork(page);
    for (const region of net.regions) {
      for (const hole of region.holes) expect(ringArea(hole)).toBeGreaterThan(200);
    }
  });

  test("a SQUARE tee at a collinear vertex is untouched by the flattening", async ({ page }) => {
    await loadOwnerPlan(page);
    const net = await roadNetwork(page);
    const tee = net.tees.find((t) => t.sideId === SQUARE_TEE.side && t.throughId === SQUARE_TEE.through);
    expect(tee, "the 36' aisle still tees onto the 100' aisle").toBeTruthy();
    expect(tee.wedges).toBe(2);
    expect(tee.R).toBeGreaterThan(4);
  });

  test("a branch off a road that ALSO carries a drive junction still solves both", async ({ page }) => {
    await loadOwnerPlan(page);
    const net = await roadNetwork(page);
    // e1454749rlpiva is teed onto by the branch AND drive-tees into truck court e1454739ykduhm.
    expect(net.tees.some((t) => t.throughId === THROUGH)).toBe(true);
    const drive = net.drives.find((d) => d.sideId === THROUGH);
    expect(drive, "its drive junction into the court survives").toBeTruthy();
    expect(drive.wedges).toBe(2);
    expect(drive.R).toBeGreaterThan(0);
  });

  test("a building over a junction still paints OVER the pavement (z-order preserved)", async ({ page }) => {
    await loadOwnerPlan(page);
    const order = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="planner-canvas"]');
      const net = svg && svg.querySelector('[data-testid="road-network-layer"]');
      const bldg = svg && svg.querySelector('g[filter="url(#bldgShadow)"]');
      if (!net || !bldg) return null;
      return !!(net.compareDocumentPosition(bldg) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(order).toBe(true);
  });
});
