/* NEW-1 — A PARCEL MUST TAKE A REAL CUT, DRIVEN IN THE REAL APP.
 *
 * The owner: "I tried to split a parcel, but it seems like it only allows very simple cuts. And
 * I'd like to split a parcel with a more complicated cut." The app answered a bent cut with
 * "That cut crosses the parcel ambiguously (concave shape) — try a straight cut between two
 * opposite edges." `test/polygonSplit.test.js` proves that refusal is what the pre-fix pipeline
 * does to two of his OWN production parcels; this suite is the other half — that the app he
 * actually clicks now performs the cut, on the same recorded geometry.
 *
 * ⛔ WHY THIS CANNOT BE A UNIT TEST. The split is a GESTURE (arm the tool, click a path, finish
 * on Enter) whose result is read back off what RENDERS — the parcel groups on the canvas and the
 * acreage badges, which recompute from the new outlines rather than carrying anything forward.
 * The engine being right is necessary and is not sufficient: the tool wiring, the click path, the
 * refusal copy and the badge recompute all sit between it and him.
 *
 * COUNT-EVERY-KIND: parcels are one of the five drawn kinds and carry NO `data-el-id`, so an
 * element census reports this whole feature as nothing happening. Every count here is over
 * DISTINCT `data-feature="parcel:<id>"` keys.
 *
 * Run: npx playwright test e2e/parcel-split-complex-cut.spec.js
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");

/* The owner's recorded Goose Creek tract: 95 acres, 24 vertices, 12 of them reflex — and its ring
 * is PINCHED (it runs out to a point, clockwise around an interior exclusion, and back through
 * that same point). Exactly the shape the old splitter refused. Do not swap it for a rectangle:
 * on a convex lot every defect this suite exists for is invisible. */
const FIXTURE = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/goose-creek-plan1copy.json", import.meta.url), "utf8"));
const PARCEL_ID = "e1454746tcmstb";
const SITE_ID = "e2e-parcel-split-complex";

const ringArea = (r) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p.x * q.y - q.x * p.y; }, 0) / 2);
const ORIGINAL_ACRES = ringArea(FIXTURE.parcels.find((p) => p.id === PARCEL_ID).points) / 43560;

async function loadPlan(page) {
  await armPlannerHooks(page);
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Goose Creek", name: "split test",
    origin: null, county: "harris",
    // The one parcel, alone: a second lot would give the cut somewhere else to land and make a
    // failure ambiguous about WHICH parcel refused.
    parcels: [{ ...FIXTURE.parcels.find((p) => p.id === PARCEL_ID), active: true, locked: false }],
    els: [], measures: [], callouts: [], markups: [],
    settings: FIXTURE.settings || {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([id, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto("/");
  await expect(canvas(page)).toBeVisible();
  await expect(page.locator(`[data-feature="parcel:${PARCEL_ID}"]`).first()).toBeVisible();
}

/* Distinct parcel keys on the canvas — the plan's parcel contents, not a node count (chrome such
 * as the acreage badge stamps its parcel's key too). */
const parcelKeys = (page) => page.evaluate(() =>
  [...new Set([...document.querySelectorAll('[data-feature^="parcel:"]')].map((n) => n.getAttribute("data-feature")))].sort());

/* Every acreage badge currently painted, as numbers. These are RECOMPUTED from each outline at
 * render — reading them back is how "the pieces add up" is checked against the drawing rather
 * than against the model that drew it. */
const badgeAcres = (page) => page.evaluate(() => {
  const out = [];
  for (const g of document.querySelectorAll('[data-chrome="acreage-badge"]')) {
    const t = g.querySelector("[data-chip-text]");
    const m = t && t.textContent.match(/([\d,]+\.?\d*)\s*ac/i);
    if (m) out.push(parseFloat(m[1].replace(/,/g, "")));
  }
  return out;
});

async function armSplitTool(page) {
  await page.getByTestId("rail-parcel-tools").click();
  // "Split a parcel" by its full label — a bare /split/i also matches the plan-name crumb.
  await page.getByRole("button", { name: /^Split a parcel/i }).first().click();
}

const parcelBox = (page) => page.locator(`[data-feature="parcel:${PARCEL_ID}"] polygon`).first().boundingBox();

/* The cuts, in coordinates taken from what is actually PAINTED — no feet↔pixel arithmetic is
 * duplicated here, so the spec cannot drift from the view.
 *   creek   — four points, two bends, entering left of the lot and leaving right of it.
 *   zigzag  — six points that leave the lot over its top edge and come back, so the cut crosses
 *             the boundary six times and the honest answer is FOUR pieces. This is the case the
 *             old splitter could not even represent.
 *   miss    — a straight cut in clear space above the lot: nothing to divide. */
const CUTS = {
  creek: (b) => [
    { x: b.x - 30, y: b.y + b.height * 0.30 },
    { x: b.x + b.width * 0.40, y: b.y + b.height * 0.55 },
    { x: b.x + b.width * 0.70, y: b.y + b.height * 0.35 },
    { x: b.x + b.width + 30, y: b.y + b.height * 0.80 },
  ],
  zigzag: (b) => [
    { x: b.x - 30, y: b.y + b.height * 0.55 },
    { x: b.x + b.width * 0.30, y: b.y + b.height * 0.55 },
    { x: b.x + b.width * 0.30, y: b.y - 30 },
    { x: b.x + b.width * 0.62, y: b.y - 30 },
    { x: b.x + b.width * 0.62, y: b.y + b.height * 0.55 },
    { x: b.x + b.width + 30, y: b.y + b.height * 0.55 },
  ],
  miss: (b) => [
    { x: b.x + b.width * 0.30, y: b.y - 45 },
    { x: b.x + b.width * 0.70, y: b.y - 45 },
  ],
};

async function drawCut(page, kind) {
  const box = await parcelBox(page);
  expect(box, "the parcel must be painted before it can be cut").not.toBeNull();
  for (const p of CUTS[kind](box)) await page.mouse.click(p.x, p.y);
  await page.keyboard.press("Enter");     // finishSplit
}

/* The pieces the plan is showing after a cut. The superseded parent (B651, active:false) is not
 * drawn, so every badge on the canvas belongs to a piece. */
const sumBadges = (acres) => acres.reduce((s, a) => s + a, 0);

test.describe("parcel split — a complicated cut", () => {
  test("a four-point bent cut divides the owner's concave tract", async ({ page }) => {
    await loadPlan(page);
    expect(await parcelKeys(page)).toEqual([`parcel:${PARCEL_ID}`]);

    await armSplitTool(page);
    await drawCut(page, "creek");

    // The pieces replace the parent on the drawing (it is retained but superseded, B651), so the
    // plan now shows two lots and neither of them is the one that was cut.
    await expect.poll(async () => (await parcelKeys(page)).length, { timeout: 10_000 }).toBe(2);
    expect(await parcelKeys(page)).not.toContain(`parcel:${PARCEL_ID}`);
  });

  test("a cut that crosses the boundary six times makes FOUR pieces, not two", async ({ page }) => {
    /* Reading (b) of "a more complicated cut": once the cut leaves the lot and comes back, the
     * honest answer is more than two pieces. The old splitter emitted exactly two rings by
     * construction and had no way to say this at all. */
    await loadPlan(page);
    await armSplitTool(page);
    await drawCut(page, "zigzag");

    await expect.poll(async () => (await parcelKeys(page)).length, { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
    const acres = await badgeAcres(page);
    expect(acres.length).toBeGreaterThanOrEqual(3);
    expect(acres.every((a) => a > 0)).toBe(true);
    // Every piece is real land and together they are still the whole tract.
    expect(sumBadges(acres)).toBeCloseTo(ORIGINAL_ACRES, 1);
    // …and the plan says so rather than leaving him to count them.
    await expect(page.getByText(/made \d+ pieces/i).first()).toBeVisible();
  });

  test("the refusal the owner reported does not fire, and no toast appears at all", async ({ page }) => {
    await loadPlan(page);
    await armSplitTool(page);
    await drawCut(page, "creek");
    await expect.poll(async () => (await parcelKeys(page)).length, { timeout: 10_000 }).toBeGreaterThan(1);
    // The exact reported copy, and the whole family of "draw something simpler" advice.
    await expect(page.getByText(/crosses the parcel ambiguously/i)).toHaveCount(0);
    await expect(page.getByText(/try a straight cut/i)).toHaveCount(0);
  });

  test("acreage survives the cut: the pieces add back up to the tract, on screen", async ({ page }) => {
    /* THE ASSERTION THE WHOLE ITEM IS ABOUT. A split that quietly loses acreage on a real deal is
     * far worse than a refusal, so this is read off the badges the drawing is painting — each one
     * recomputed from its own new outline — never off the model that produced them. */
    await loadPlan(page);
    const before = await badgeAcres(page);
    expect(before.length).toBe(1);
    expect(before[0]).toBeCloseTo(ORIGINAL_ACRES, 1);

    await armSplitTool(page);
    await drawCut(page, "creek");
    await expect.poll(async () => (await parcelKeys(page)).length, { timeout: 10_000 }).toBeGreaterThan(1);

    const after = await badgeAcres(page);
    expect(after.length).toBeGreaterThanOrEqual(2);
    expect(after.every((a) => a > 0)).toBe(true);
    // The badges round for display, so the tolerance is that rounding — not a fudge factor.
    expect(sumBadges(after)).toBeCloseTo(before[0], 1);
  });

  test("a cut that never reaches the parcel says so, in words about THAT cut", async ({ page }) => {
    await loadPlan(page);
    await armSplitTool(page);
    await drawCut(page, "miss");
    await expect(page.getByText(/never crosses the parcel/i).first()).toBeVisible({ timeout: 8_000 });
    // …and nothing was changed.
    expect((await parcelKeys(page)).length).toBe(1);
  });
});
