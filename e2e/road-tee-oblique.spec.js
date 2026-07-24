/* NEW-1/NEW-2 — the road-connection recurrence guard, driven against the OWNER'S REAL PLAN.
 *
 * Nine prior attempts (B945/B946/B949/B953/B964/B971/B989/B1005/B1006) shipped green and rendered
 * broken. They all shared one testing mistake: they built a MOCK — a straight drive onto a rectangular
 * Car Parking field — and asserted that cover/return ELEMENTS existed. Both halves were wrong.
 *   • The mock never contained the topologies that actually broke: a tee onto a CURVED through road,
 *     a ROAD-TO-ROAD oblique tee, or a through road carrying near-duplicate vertices left behind by
 *     earlier connect attempts (which collapsed the return's reach clamp to ~2 ft and squared off
 *     every corner on the real plan while the mock's clean geometry sailed through).
 *   • Counting elements proves the render path ran, not that the junction LOOKS right. A cover patch
 *     exists in every broken screenshot the owner sent.
 * So this spec seeds the owner's actual Tsakiris / Concept A element set (pulled from the production
 * site record; see ui-audit/fixtures/tsakiris-concept-a.json) and asserts the DISSOLVED geometry:
 * connected roads become ONE pavement region, sliver-free, with real rounded curb returns at every
 * junction — straight, oblique, curved, road-to-road and road-to-drive alike.
 *
 * Run: npx playwright test e2e/road-tee-oblique.spec.js
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { armPlannerHooks, roadNetwork, netSurfaces, netEdges, ringArea } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const FIXTURE = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/tsakiris-concept-a.json", import.meta.url), "utf8"));
const SITE_ID = "e2e-tsakiris-concept-a";

// The junction ids under test, and what each one is (they are the three the owner screenshotted).
const STRAIGHT_TEE = { side: "e1454683splyoj", through: "e38duuwgj" };  // 40' aisle → 40' truck loop, ~90°
const OBLIQUE_TEE = { side: "e1454692rfhccx", through: "e1454683splyoj" }; // 36' aisle → 40' aisle, ~57°
const CURVED_TEE = { side: "e1454692rfhccx", through: "e38duuwgj" };   // 36' aisle → the loop, on its curve
const BIG_CLUSTER = ["e54duuwgj", "e38duuwgj", "e1454683splyoj", "e1454692rfhccx"];

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
  await expect.poll(async () => (await roadNetwork(page))?.regions.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);
}

test.describe("NEW-1/NEW-2 — road connections on the owner's real plan", () => {
  test("every connected road dissolves into ONE pavement region with ONE outline", async ({ page }) => {
    await loadOwnerPlan(page);
    const net = await roadNetwork(page);

    // The four connected roads (truck loop + aisle + skew aisle + welded stub) are ONE surface. Before
    // this change they rendered as four overlapping strips plus patches: the owner's "rectangle
    // intersecting a rectangle", and — because road fills are semi-transparent — a darker junction.
    const big = net.regions.filter((r) => BIG_CLUSTER.every((id) => r.ids.includes(id)));
    expect(big).toHaveLength(1);

    // One fill and one stroke per region: no second curb line anywhere in a junction.
    await expect(netSurfaces(page)).toHaveCount(net.regions.length);
    await expect(netEdges(page)).toHaveCount(net.regions.length);

    // The legacy patch render is gone for good — its presence is what let the seam survive.
    await expect(page.locator('[data-export="road-tee-cover"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="road-tee-return"]')).toHaveCount(0);
    await expect(page.locator("#tee-cover-knockout")).toHaveCount(0);
  });

  test("no sliver holes survive the dissolve — only real enclosed ground", async ({ page }) => {
    await loadOwnerPlan(page);
    const net = await roadNetwork(page);
    for (const region of net.regions) {
      for (const hole of region.holes) {
        // A courtyard genuinely enclosed by roads is thousands of sf. A hole of a few sf is a numerical
        // sliver between a tessellated strip and an analytic wedge, and it strokes as a hairline seam.
        expect(ringArea(hole)).toBeGreaterThan(200);
      }
    }
  });

  test("all three real tee topologies solve a REAL rounded curb return", async ({ page }) => {
    await loadOwnerPlan(page);
    const net = await roadNetwork(page);
    for (const j of [STRAIGHT_TEE, OBLIQUE_TEE, CURVED_TEE]) {
      const tee = net.tees.find((t) => t.sideId === j.side && t.throughId === j.through);
      expect(tee, `tee ${j.side}→${j.through} not detected`).toBeTruthy();
      expect(tee.wedges).toBe(2);                       // two additive curb-return wedges
      expect(tee.R).toBeGreaterThan(4);                 // a real radius, not a squared-off corner
      for (const n of tee.returns) expect(n).toBeGreaterThan(3);  // tessellated arcs, not 2-point chamfers
    }
  });

  test("vertex clutter on the through road no longer squares off the return (the real-plan trap)", async ({ page }) => {
    await loadOwnerPlan(page);
    const net = await roadNetwork(page);
    // e38duuwgj carries a run of near-duplicate vertices (three identical, others 0.4–2 ft apart) left by
    // repeated connect attempts. The reach clamp used to read the ADJACENT vertex distance, so it saw
    // ~1.9 ft of road and clamped the return to nothing. A mock road never has this. The straight tee
    // sits right in that clutter, so its radius is the canary.
    const tee = net.tees.find((t) => t.sideId === STRAIGHT_TEE.side && t.throughId === STRAIGHT_TEE.through);
    expect(tee.R).toBeGreaterThan(15);
  });

  test("drive junctions onto a court / parking field stay inside the target edge", async ({ page }) => {
    await loadOwnerPlan(page);
    const net = await roadNetwork(page);
    expect(net.drives.length).toBeGreaterThanOrEqual(1);
    for (const d of net.drives) {
      expect(d.wedges).toBe(2);
      expect(d.R).toBeGreaterThan(0);
    }
    // The fire lane meets its parking field a couple of feet from the field's END. A symmetric reach
    // clamp let that return sweep off the end of the field and hang in open ground (owner shot 1); the
    // per-direction clamp shrinks it instead.
    const fire = net.drives.find((d) => d.sideId === "e1454682splyoj");
    expect(fire).toBeTruthy();
    expect(fire.R).toBeLessThan(20);        // clamped down from the 20 ft stored seed
    expect(fire.R).toBeGreaterThan(2);      // but still a rounded corner, not a square one
  });

  test("a building over a junction still paints OVER the pavement (z-clip preserved)", async ({ page }) => {
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
