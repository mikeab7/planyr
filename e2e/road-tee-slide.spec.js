/* NEW-1 / NEW-2 — a road tee SLIDES along its host, driven as a REAL POINTER DRAG on the owner's plan.
 *
 * Owner report (Goose Creek, verbatim): "when I try connecting roads, it doesn't let me slide the
 * connection point along the road. It's kind of stuck. So for example if you look at Goose Creek, my
 * road between buildings is slightly angled and I don't want it to be, but it won't let me adjust the
 * tee to the correct spot." Correcting the follow-up reading: "not square to the host road, it's just
 * more angled with respect to N/S than I'd like."
 *
 * This spec exists because unit tests cannot prove this one. The whole defect lives in the gap between
 * what the DRAG shows and what the RELEASE keeps: the ghost tracked the cursor the entire way, and
 * `planRoadConnect` then welded the endpoint back onto the host vertex it started on. Only a real
 * press-move-release through the real handle can see that, so this runs the exact sequence the owner
 * described — select the connecting road, drag the tee along the host, let go — and reads the committed
 * model back out of storage.
 *
 * Geometry (production site sms69x8rb2qk, ui-audit/fixtures/goose-creek-tee-slide.json):
 *   e1454743ykduhm — the 40' aisle running between two buildings, teed onto…
 *   e1454717dshobp — …the 100' aisle, at ITS control point index 7. halfW there is 50.5 ft, so the
 *                    pre-fix collapse radius (travelW/4) was 25 FT: every correction the owner could
 *                    want was inside it and reverted on release. The correction itself is ~18 ft SOUTH
 *                    along the host — which is why it never had a chance.
 *
 * Run: npx playwright test e2e/road-tee-slide.spec.js
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const FIXTURE = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/goose-creek-tee-slide.json", import.meta.url), "utf8"));
const SITE_ID = "e2e-goose-creek-tee-slide";

const SIDE = "e1454743ykduhm";      // "my road between buildings" — the 40' aisle carrying the tee
const HOST = "e1454717dshobp";      // the 100' aisle it tees into
const TEE = { x: -1272.6739049081787, y: 0.35714051719406825 };   // the junction, in world feet
const PPF = 1.5;                    // pixels per foot — big enough that an 18 ft slide is a real gesture

/* The planner persists through a DEBOUNCED autosave, and the host's half of a connect is only written
 * on RELEASE — so a single read straight after mouse-up can catch the mid-drag state (where the side
 * road has already moved and the host has not). Every post-release assertion polls. */
const readRoad = (page, id) => page.evaluate((rid) => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const site = map[Object.keys(map)[0]] || {};
  const r = (site.els || []).find((e) => e.id === rid);
  return r ? { pts: r.pts.map((p) => ({ x: p.x, y: p.y })), vtx: r.vtx } : null;
}, id);

// Is any control point of `pts` sitting on `pt`? (the junction-coincidence test, in the browser)
const nodeAt = (pts, pt, tol = 1.5) => pts.findIndex((p) => Math.hypot(p.x - pt.x, p.y - pt.y) <= tol);
// Bearing clockwise from TRUE north — the feet frame is north-aligned, so page angles are compass angles.
const bearing = (a, b) => ((Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI + 360) % 360;
const offCardinal = (deg) => Math.abs(deg - Math.round(deg / 90) * 90);

async function loadOwnerPlan(page) {
  await armPlannerHooks(page);
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Goose Creek", name: "Plan II - 220K, 440K, 700K",
    origin: null, county: "harris", parcels: [], els: FIXTURE.els, measures: [], callouts: [],
    markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([id, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto("/");
  await expect(canvas(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window.__plannerView ? 1 : 0)), { timeout: 20_000 }).toBe(1);
  await expect.poll(() => page.locator(`[data-el-id="${SIDE}"]`).count(), { timeout: 20_000 }).toBeGreaterThan(0);
  await parkOnTee(page);
}

/* Park the viewport on the junction at a KNOWN scale, and do not proceed until the planner has
 * actually committed it. `centerOn` is a setState: reading `__plannerView.get()` in the same tick
 * returns the PREVIOUS view, and the plan's own fit-to-content pass can land after it — so a click
 * computed off a stale scale misses the road, and a drag sized in feet off a stale ppf travels a
 * wildly wrong distance (a 18 ft slide measured 226 ft that way). Assert the scale, then use the
 * LIVE one for every conversion. */
async function parkOnTee(page) {
  await expect.poll(async () => {
    await page.evaluate(([x, y, p]) => window.__plannerView.centerOn(x, y, p), [TEE.x, TEE.y, PPF]);
    return page.evaluate(() => window.__plannerView.get().ppf);
  }, { timeout: 20_000 }).toBeCloseTo(PPF, 6);
}
const livePpf = (page) => page.evaluate(() => window.__plannerView.get().ppf);

/* World feet -> screen pixels, through the planner's OWN numbers (the same `view` + SVG rect `p2f`
 * inverts), so a click lands where the drawing actually is rather than on a bounding-box corner. */
const feetToScreen = (page, pt) => page.evaluate((p) => {
  const v = window.__plannerView.get();
  const r = document.querySelector('[data-testid="planner-canvas"]').getBoundingClientRect();
  return { x: r.left + p.x * v.ppf + v.offX, y: r.top + p.y * v.ppf + v.offY };
}, pt);

/* Select the connecting road so its vertex handles render, then return the tee handle's box. The tee
 * is the LAST control point, so its handle is road-vtx-(n-1). The click lands ON the road's own
 * pavement, 40% along its first leg — clear of the 100 ft host, whose strip is 50 ft wide either side
 * of its centerline and would otherwise take the press and select ITSELF. */
async function grabTeeHandle(page) {
  await parkOnTee(page);
  const road = await readRoad(page, SIDE);
  const last = road.pts.length - 1;
  const a = road.pts[0], b = road.pts[1];
  const on = await feetToScreen(page, { x: a.x + (b.x - a.x) * 0.4, y: a.y + (b.y - a.y) * 0.4 });
  await page.mouse.click(on.x, on.y);
  // Guard the whole spec: the handles on screen must be THIS road's, not a neighbour's.
  await expect.poll(() => page.locator('[data-testid^="road-vtx-"]').count(), { timeout: 10_000 }).toBe(road.pts.length);
  const handle = page.getByTestId(`road-vtx-${last}`);
  await expect(handle).toBeVisible({ timeout: 10_000 });
  const b2 = await handle.boundingBox();
  return { last, cx: b2.x + b2.width / 2, cy: b2.y + b2.height / 2 };
}

/* The owner's exact gesture: press the tee handle, drag `ft` feet SOUTH along the host, release.
 * (+y is south in the feet frame, so south is DOWN the screen — and south is the way his correction
 * goes: the tee sits near the host's north end and has to come back down it to square the leg up.) */
async function dragTeeAlongHost(page, ft, opts = {}) {
  const h = await grabTeeHandle(page);
  const dy = ft * (await livePpf(page));
  await page.mouse.move(h.cx, h.cy);
  await page.mouse.down();
  if (opts.shift) await page.keyboard.down("Shift");
  await page.mouse.move(h.cx, h.cy + dy * 0.4, { steps: 5 });
  await page.mouse.move(h.cx, h.cy + dy, { steps: 8 });
  const mid = opts.probe ? await opts.probe() : null;
  await page.mouse.up();
  if (opts.shift) await page.keyboard.up("Shift");
  return { handle: h, mid };
}

test.describe("NEW-1 — the tee slides along its host road and stays put", () => {
  test("the plan opens with the tee welded to the host's control point 7", async ({ page }) => {
    await loadOwnerPlan(page);
    const side = await readRoad(page, SIDE);
    const host = await readRoad(page, HOST);
    expect(nodeAt(host.pts, side.pts[side.pts.length - 1])).toBe(7);
  });

  test("a SHORT slide — the ~18 ft the owner needs — actually moves the junction", async ({ page }) => {
    await loadOwnerPlan(page);
    const before = await readRoad(page, SIDE);
    await dragTeeAlongHost(page, 18);
    const after = await readRoad(page, SIDE);
    const moved = after.pts[after.pts.length - 1].y - before.pts[before.pts.length - 1].y;
    // PRE-FIX this was 0.00 — the whole report. Allow slop for pointer rounding at this zoom.
    expect(moved).toBeGreaterThan(12);
    expect(moved).toBeLessThan(26);
  });

  test("the junction MOVED rather than a second one being added — the host keeps 9 control points", async ({ page }) => {
    await loadOwnerPlan(page);
    await dragTeeAlongHost(page, 18);
    await expect.poll(() => readRoad(page, HOST).then((h) => nodeAt(h.pts, TEE)), { timeout: 10_000 })
      .toBe(-1);                                       // nothing left behind at the old spot
    const host = await readRoad(page, HOST);
    expect(host.pts).toHaveLength(9);
    expect(host.vtx).toHaveLength(9);
  });

  test("the two roads still meet at exactly one point — the drag never detaches the tee", async ({ page }) => {
    await loadOwnerPlan(page);
    await dragTeeAlongHost(page, 18);
    await expect.poll(async () => {
      const s2 = await readRoad(page, SIDE), h2 = await readRoad(page, HOST);
      return nodeAt(h2.pts, s2.pts[s2.pts.length - 1], 0.001);
    }, { timeout: 10_000 }).toBeGreaterThan(0);
    const side = await readRoad(page, SIDE);
    const host = await readRoad(page, HOST);
    const end = side.pts[side.pts.length - 1];
    expect(host.pts[nodeAt(host.pts, end, 0.001)]).toEqual(end);
  });

  test("a LONG slide moves it too, and still leaves no debris", async ({ page }) => {
    await loadOwnerPlan(page);
    const before = await readRoad(page, SIDE);
    await dragTeeAlongHost(page, 90);
    const after = await readRoad(page, SIDE);
    expect(after.pts[after.pts.length - 1].y - before.pts[before.pts.length - 1].y).toBeGreaterThan(70);
    await expect.poll(() => readRoad(page, HOST).then((h) => h.pts.length), { timeout: 10_000 }).toBe(9);
  });

  test("sliding the other way (north) works the same — the dead zone was symmetric", async ({ page }) => {
    await loadOwnerPlan(page);
    const before = await readRoad(page, SIDE);
    await dragTeeAlongHost(page, -14);
    const after = await readRoad(page, SIDE);
    expect(before.pts[before.pts.length - 1].y - after.pts[after.pts.length - 1].y).toBeGreaterThan(9);
    await expect.poll(() => readRoad(page, HOST).then((h) => h.pts.length), { timeout: 10_000 }).toBe(9);
  });

  test("the slide is what changes the road's BEARING — the reason he could not straighten it", async ({ page }) => {
    await loadOwnerPlan(page);
    const before = await readRoad(page, SIDE);
    const b0 = bearing(before.pts[before.pts.length - 2], before.pts[before.pts.length - 1]);
    expect(offCardinal(b0)).toBeGreaterThan(8);       // ~9.4 deg off the cardinal axis, as drawn
    await dragTeeAlongHost(page, 18);
    const after = await readRoad(page, SIDE);
    const b1 = bearing(after.pts[after.pts.length - 2], after.pts[after.pts.length - 1]);
    expect(offCardinal(b1)).toBeLessThan(offCardinal(b0) - 4);   // it swung toward the axis
  });
});

test.describe("NEW-2 — the drag reports its bearing, and Shift locks it to a cardinal", () => {
  test("a live bearing readout appears during the drag and clears on release", async ({ page }) => {
    await loadOwnerPlan(page);
    await expect(page.locator("[data-road-bearing]")).toHaveCount(0);
    const { mid } = await dragTeeAlongHost(page, 18, {
      probe: async () => page.locator("[data-road-bearing]").count(),
    });
    expect(mid, "no bearing readout while dragging the junction").toBeGreaterThan(0);
    await expect(page.locator("[data-road-bearing]")).toHaveCount(0);
  });

  test("holding Shift engages the cardinal lock and says so", async ({ page }) => {
    await loadOwnerPlan(page);
    const { mid } = await dragTeeAlongHost(page, 16, {
      shift: true,
      probe: async () => page.evaluate(() => ({
        snap: document.querySelector('[data-road-snap]')?.getAttribute("data-road-snap") || null,
        bearing: document.querySelector('[data-road-bearing]')?.getAttribute("data-road-bearing") || null,
      })),
    });
    expect(mid.snap, "the magnet never engaged at all").not.toBeNull();
    expect(mid.snap).toBe("cardinal");
    expect(mid.bearing).toBe("locked");
  });

  test("Shift lands the leg on a true cardinal, and it stays there on release", async ({ page }) => {
    await loadOwnerPlan(page);
    await dragTeeAlongHost(page, 16, { shift: true });
    await expect.poll(async () => {
      const s2 = await readRoad(page, SIDE);
      return offCardinal(bearing(s2.pts[s2.pts.length - 2], s2.pts[s2.pts.length - 1]));
    }, { timeout: 10_000 }).toBeLessThan(0.05);
    const side = await readRoad(page, SIDE);
    // …and it is still a tee: the locked point is ON the host, not floating beside it.
    await expect.poll(async () => {
      const s2 = await readRoad(page, SIDE), h2 = await readRoad(page, HOST);
      return nodeAt(h2.pts, s2.pts[s2.pts.length - 1], 0.001);
    }, { timeout: 10_000 }).toBeGreaterThan(0);
  });

  test("without Shift the lock does NOT fire — an oblique tee is still placeable", async ({ page }) => {
    await loadOwnerPlan(page);
    const { mid } = await dragTeeAlongHost(page, 16, {
      probe: async () => page.evaluate(() => document.querySelector('[data-road-snap]')?.getAttribute("data-road-snap") || null),
    });
    expect(mid).toBe("connect");
    const side = await readRoad(page, SIDE);
    expect(offCardinal(bearing(side.pts[side.pts.length - 2], side.pts[side.pts.length - 1]))).toBeGreaterThan(0.05);
  });
});
