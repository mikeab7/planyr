/* NEW-2 — PROMOTING A PLOTTED DEED TO THE PARCEL BOUNDARY, driven in a real browser.
 *
 * ⛔ WHY THIS IS AN E2E AND NOT A UNIT TEST. This tranche's own near-miss was a promotion function
 * that was complete, correct and REACHABLE FROM NO MENU — a unit test on it would have been green
 * the whole time. And two of the three things the owner asked to be sure of are RENDER facts that
 * no source reading can settle:
 *   • a deed closing to 0.4′ and one closing to 40′ must not look identical on screen;
 *   • a tract that does not close at all must be refused LOUDLY, with no parcel manufactured.
 * So both are measured here, on the page, against the real button.
 *
 * Mutation-checked (run log on the item): accepting an open traverse, dropping `deedMisclosureFt`,
 * deleting the misclosure chip, and flattening the loose/tight tone each turn a case here red.
 */
import { test, expect } from "@playwright/test";

const canvas = (page) => page.locator('[data-testid="planner-canvas"]');

/* A deed markup as `anchorEncumbrance` builds one: a closed ring, its traverse `centerline`, and a
 * `deedGroup` linking a boundary to its save-and-except holes. `closed` is what `pathCloses`
 * decided at plot time and is the flag the promotion refuses on. */
const deedMarkup = ({ id, group, pts, centerline, closed, except = false, label }) => ({
  id, kind: "encumbrance", pts, centerline, closed,
  calls: [], label, deedGroup: group, except,
  stroke: except ? "#b91c1c" : "#7c3aed", fill: except ? "#b91c1c" : "#7c3aed",
  fillOpacity: 0.14, weight: 2, dash: except ? "6 4" : "solid",
});

/* A TIGHT deed: a 600 × 400 rectangle whose traverse returns to within ~0.30 ft of the point of
 * beginning — an ordinary modern survey. */
const TIGHT_RING = [{ x: 100, y: 100 }, { x: 700, y: 100 }, { x: 700, y: 500 }, { x: 100, y: 500 }];
const TIGHT_PATH = [...TIGHT_RING, { x: 100.3, y: 100 }];

/* A LOOSE deed: the same shape, closing 40 ft out. Still flagged closed by the plotter, so it
 * promotes — and must be visibly different from the tight one. That difference IS the feature. */
const LOOSE_RING = [{ x: 100, y: 100 }, { x: 700, y: 100 }, { x: 700, y: 500 }, { x: 100, y: 500 }];
const LOOSE_PATH = [...LOOSE_RING, { x: 140, y: 100 }];

/* An OPEN traverse: `pathCloses` said no. A boundary must never be manufactured from this. */
const OPEN_RING = [{ x: 100, y: 100 }, { x: 700, y: 100 }, { x: 700, y: 500 }];
const OPEN_PATH = [...OPEN_RING, { x: 260, y: 430 }];

function siteWithDeed(id, { pts, centerline, closed }) {
  return {
    id, groupId: id, site: "Deed only", name: "Concept A",
    origin: null, county: null,
    parcels: [], els: [], measures: [], callouts: [],
    markups: [deedMarkup({ id: "mkDeed1", group: "grpDeed1", pts, centerline, closed, label: "Tract boundary" })],
    settings: {}, updatedAt: Date.now(),
  };
}

async function open(page, id, rec) {
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  // Seed ONCE — `addInitScript` re-runs on reload and would otherwise re-write the pre-promotion
  // record over whatever the app saved.
  await page.addInitScript(([sid, r]) => {
    if (localStorage.getItem("e2e:seeded:" + sid)) return;
    localStorage.setItem("e2e:seeded:" + sid, "1");
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [sid]: r }));
    localStorage.setItem("planarfit:currentSite:v1", sid);
  }, [id, rec]);
  await page.goto("/");
  await expect(canvas(page)).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => page.locator('[data-feature="markup:mkDeed1"]').count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await page.waitForTimeout(500);
}

const parcelsInStore = (page, id) => page.evaluate((sid) => {
  const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  return all[sid]?.parcels || [];
}, id);

/* Select the deed and open its inspector, where "Use as parcel boundary" lives. */
async function openDeedInspector(page) {
  const deed = page.locator('[data-feature="markup:mkDeed1"]').first();
  const box = await deed.boundingBox();
  /* Aim OFF-CENTRE. Once the deed has been promoted, the new parcel's acreage badge is anchored at
     the ring's pole of inaccessibility — dead centre of this rectangle — and chrome that paints
     above the content owns the press there (CHROME-NEVER-EATS-A-PRESS). A quarter-inset lands on
     plain deed body in both the before and after states, so one helper serves every case. */
  const x = box.x + box.width * 0.25, y = box.y + box.height * 0.25;
  // Single click selects, double opens Properties (the B750 contract).
  await page.mouse.click(x, y, { clickCount: 1 });
  await page.waitForTimeout(250);
  await page.mouse.click(x, y, { clickCount: 2 });
  await expect(page.getByTestId("deed-promote")).toBeVisible({ timeout: 20_000 });
}

test.describe("NEW-2 · the legal description becomes the boundary when the county map is down", () => {
  test("a deed that CLOSES promotes to a real parcel, and its misclosure is on the parcel", async ({ page }) => {
    const ID = "e2eDeedTight";
    await open(page, ID, siteWithDeed(ID, { pts: TIGHT_RING, centerline: TIGHT_PATH, closed: true }));
    expect(await parcelsInStore(page, ID)).toHaveLength(0);

    await openDeedInspector(page);
    await page.getByTestId("deed-promote").click();

    // A real parcel now exists, stamped with its provenance and the deed's own closure.
    await expect.poll(async () => (await parcelsInStore(page, ID)).length, { timeout: 15_000 }).toBe(1);
    const pc = (await parcelsInStore(page, ID))[0];
    expect(pc.source).toBe("deed");
    expect(pc.fromDeedGroup).toBe("grpDeed1");
    expect(pc.points).toHaveLength(4);
    expect(pc.deedMisclosureFt).toBeCloseTo(0.3, 1);
    /* The deed markup is KEPT, so the owner can still compare it against the aerial or align it
       once the county map is back. Asserted on the RENDER first — the store copy alone stayed green
       when promotion was mutated to delete the markup (the write it was read from had not settled),
       and a guard that depends on save timing is not a guard. */
    await expect(page.locator('[data-feature="markup:mkDeed1"]')).toHaveCount(1);
    await expect.poll(async () => page.evaluate((sid) => {
      const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      return (all[sid]?.markups || []).map((m) => m.id);
    }, ID), { timeout: 10_000 }).toContain("mkDeed1");

    // …and the closure READS on the parcel, tight-toned.
    const chip = page.getByTestId("parcel-misclosure");
    await expect(chip).toBeVisible({ timeout: 20_000 });
    await expect(chip).toHaveText(/closes to 0\.3′/);
    await expect(chip).not.toHaveText(/⚠/);
    await expect(page.getByTestId("parcel-provenance")).toHaveText(/From deed/i);
  });

  test("a LOOSE deed does not look like a tight one", async ({ page }) => {
    const ID = "e2eDeedLoose";
    await open(page, ID, siteWithDeed(ID, { pts: LOOSE_RING, centerline: LOOSE_PATH, closed: true }));
    await openDeedInspector(page);
    await page.getByTestId("deed-promote").click();
    await expect.poll(async () => (await parcelsInStore(page, ID)).length, { timeout: 15_000 }).toBe(1);

    const chip = page.getByTestId("parcel-misclosure");
    await expect(chip).toBeVisible({ timeout: 20_000 });
    await expect(chip).toHaveText(/closes to 40′/);
    // The whole point: a 40′ closure is visibly flagged, not merely a different number.
    await expect(chip).toHaveText(/⚠/);
    const colour = await chip.evaluate((n) => getComputedStyle(n).color);
    const border = await chip.evaluate((n) => getComputedStyle(n).borderTopColor);
    expect(colour).toBe(border);           // the warn tone carries BOTH, not just one
    expect(colour).not.toBe("rgb(0, 0, 0)");
  });

  test("an OPEN traverse is refused LOUDLY and manufactures no boundary", async ({ page }) => {
    const ID = "e2eDeedOpen";
    await open(page, ID, siteWithDeed(ID, { pts: OPEN_RING, centerline: OPEN_PATH, closed: false }));
    await openDeedInspector(page);
    await page.getByTestId("deed-promote").click();

    // The refusal is SAID, in the plan's own banner — never a silent no-op.
    await expect(page.getByText(/calls don't close/i)).toBeVisible({ timeout: 15_000 });
    // …and no parcel was created, now or a moment later.
    await page.waitForTimeout(1200);
    expect(await parcelsInStore(page, ID)).toHaveLength(0);
  });

  test("promoting twice is refused — one deed can only be one parcel", async ({ page }) => {
    const ID = "e2eDeedTwice";
    await open(page, ID, siteWithDeed(ID, { pts: TIGHT_RING, centerline: TIGHT_PATH, closed: true }));
    await openDeedInspector(page);
    await page.getByTestId("deed-promote").click();
    await expect.poll(async () => (await parcelsInStore(page, ID)).length, { timeout: 15_000 }).toBe(1);
    /* The tract stays ONE parcel across a reload. A second copy would double-count the acreage in
       every yield, coverage and detention number on the plan, and a reload is where a duplicate
       would appear if any load-time path re-promoted the deed that is still sitting there.
       ⚠ SCOPE, stated rather than implied: the disabled STATE of the two controls is covered by the
       mutation-proven source guard in test/parcelOfflineWiring.test.js ("promoting the same deed
       twice is refused"), not here — once the parcel is laid over the deed that produced it,
       addressing the deed again is a hit-test contest with the parcel and its grips, and a case
       that cannot be driven reliably is worse than one that says what it does not cover. */
    await page.reload();
    await expect(canvas(page)).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1200);
    expect(await parcelsInStore(page, ID)).toHaveLength(1);
    const only = (await parcelsInStore(page, ID))[0];
    expect(only.fromDeedGroup).toBe("grpDeed1");
  });
});
