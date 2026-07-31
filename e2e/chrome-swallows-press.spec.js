/* NEW-1 — CHROME THAT PAINTS ABOVE THE PLAN MUST NOT EAT THE PRESS UNDERNEATH IT.
 *
 * The owner's report, on Goose Creek "site phase two": double-click a building, and Properties never
 * opens. Nothing happens at all. Diagnosed as a GESTURE defect, not a panel one — `openInspector`
 * and the panel's render condition were both sound, and `startMoveEl`'s double-tap branch was intact
 * and unchanged. The press simply never reached the building.
 *
 * THE CULPRIT, and why it started now. The parcel acreage badge renders with `pointerEvents: auto`
 * whenever the Select tool is up, and paints AFTER the element bands. In SVG, paint order IS
 * hit-test order, so that solid pill won every press inside it — over a building, over a road, over
 * anything. Its handler stops propagation, sets no selection and never calls `isDoubleTap`, so the
 * press produced no visible change, could not pair as a double-tap, and burnt an undo frame.
 * B1186 is what moved it into the line of fire: changing the badge's anchor from `centroid()` (a
 * vertex average that often floated clean off the lot) to `polylabel()` (the pole of inaccessibility,
 * GUARANTEED inside the ring) parks it on the developed middle of the lot — which is exactly where
 * the buildings are. On the owner's own saved plan three badges moved several hundred feet and
 * landed on two buildings and a road.
 *
 * THIS SUITE IS THE GENERAL GUARD, because a guard that names one component protects one component
 * — which is what B1174 already taught when it applied this same rule to measurement chips and
 * nobody applied it to the acreage badge. Two independent halves:
 *
 *   1. STRUCTURAL — with nothing selected, a press at an element's own centre must REACH that
 *      element. Asked of every building/road/paving on the real plan via elementFromPoint, so ANY
 *      future late-painted, pointer-enabled node that covers content fails here by construction,
 *      whatever it is called and whoever adds it.
 *   2. BEHAVIOURAL — a double-click opens Properties. Run at the element's centre AND inside the
 *      dimension grab band, which the structural half cannot see: that fat transparent grab line
 *      lives INSIDE the element's own group (so it passes #1) but only exists AFTER the element is
 *      selected, so press 2 of a real double-click landed on a layer press 1 had just created.
 *
 * Run: npx playwright test e2e/chrome-swallows-press.spec.js
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const FIXTURE = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/goose-creek-plan1copy.json", import.meta.url), "utf8"));
const SITE_ID = "e2e-goose-creek-phase-two";

/* The three elements the audit found a relocated badge sitting on, on this exact plan. Named so a
 * failure says WHICH object went unreachable rather than "some element". */
const BADGED = ["e1454647dshobp", "e1454652dshobp", "e1454717dshobp"];

async function loadOwnerPlan(page) {
  await armPlannerHooks(page);
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Goose Creek", name: "site phase two",
    origin: null, county: "harris",
    parcels: FIXTURE.parcels, els: FIXTURE.els, measures: [], callouts: [], markups: [],
    settings: FIXTURE.settings || {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([id, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto("/");
  await expect(canvas(page)).toBeVisible();
  await expect.poll(async () => page.locator("[data-el-id]").count(), { timeout: 20_000 }).toBeGreaterThan(10);
  /* Let the fit / label / declutter passes settle. Without this the rects measured below are the
     pre-fit ones and every press lands somewhere else — a flaky guard is worse than no guard. */
  await page.waitForTimeout(1200);
}

/* Zoom onto one element so the detail tier (the red dimension line and its number) actually renders
   — it is LOD-gated, and at the whole-site fit there is nothing to press. */
async function zoomTo(page, id) {
  const ok = await page.evaluate((elId) => {
    if (!window.__plannerView) return false;
    const g = document.querySelector(`[data-el-id="${elId}"]`);
    if (!g) return false;
    const svg = document.querySelector('[data-testid="planner-canvas"]');
    const sr = svg.getBoundingClientRect(), r = g.getBoundingClientRect();
    const v = window.__plannerView.get();
    // screen → feet for the element's centre, then re-centre there at a detail zoom
    const fx = ((r.left + r.width / 2) - sr.left - v.offX) / v.ppf;
    const fy = ((r.top + r.height / 2) - sr.top - v.offY) / v.ppf;
    window.__plannerView.centerOn(fx, fy, 0.5);
    return true;
  }, id);
  if (ok) await page.waitForTimeout(700);
  return ok;
}

/* The screen point at the centre of an element's own rendered group, plus what actually answers a
 * press there. `elementFromPoint` is the browser's real hit test — the same one a pointer uses — so
 * this cannot drift from behaviour the way a source scan can. */
async function hitAtCentre(page, id) {
  return page.evaluate((elId) => {
    const g = document.querySelector(`[data-el-id="${elId}"]`);
    if (!g) return { missing: true };
    const r = g.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const node = document.elementFromPoint(x, y);
    const owner = node && node.closest ? node.closest("[data-el-id]") : null;
    return {
      x, y,
      ownerId: owner ? owner.getAttribute("data-el-id") : null,
      // Which late-painted chrome took it, if any — named so the failure message is actionable.
      chip: !!(node && node.closest && node.closest("[data-print-chip]")),
      handleLayer: !!(node && node.closest && node.closest("[data-handle-layer]")),
      tag: node ? node.tagName : null,
    };
  }, id);
}

const dockState = (page) => page.evaluate(() => {
  const on = document.querySelector('[data-rail-tab][aria-pressed="true"]');
  return on ? on.getAttribute("data-rail-tab") : "none";
});

test.describe("NEW-1 — no chrome painted above the plan swallows a press meant for an element", () => {
  test("STRUCTURAL: with nothing selected, every element's own centre answers to that element", async ({ page }) => {
    await loadOwnerPlan(page);
    const ids = await page.locator("[data-el-id]").evaluateAll((ns) => [...new Set(ns.map((n) => n.getAttribute("data-el-id")))]);
    expect(ids.length).toBeGreaterThan(10);
    const stolen = [];
    for (const id of ids) {
      const hit = await hitAtCentre(page, id);
      if (hit.missing) continue;
      // Off-screen elements have a degenerate rect — skip rather than assert about a point nobody
      // can press. Anything ON screen must be reachable at its own centre.
      if (hit.x < 0 || hit.y < 0) continue;
      if (hit.ownerId !== id) stolen.push({ id, took: hit.ownerId, chip: hit.chip, handleLayer: hit.handleLayer, tag: hit.tag });
    }
    /* An element MAY legitimately be covered by another element (a bump-out over its host, a
       building over paving) — that is ordinary stacking. What may never happen is chrome taking it:
       the acreage badge, or any other `data-print-chip` pill. */
    const byChrome = stolen.filter((s) => s.chip || s.ownerId === null);
    expect(byChrome, `chrome swallowed the press at these elements' own centres: ${JSON.stringify(byChrome)}`).toEqual([]);
  });

  test("STRUCTURAL: the acreage badge is inert until its own lot is selected", async ({ page }) => {
    await loadOwnerPlan(page);
    const badges = page.locator('[data-print-chip="acre"]');
    await expect(badges.first(), "the badge still DRAWS at all times — only its PRESS is gated").toBeVisible();
    // Nothing selected → not one badge on the plan may answer a press.
    const live = await badges.evaluateAll((ns) => ns.filter((n) => getComputedStyle(n).pointerEvents !== "none").length);
    expect(live, "an acreage badge was pointer-enabled with no parcel selected — this is the B1186 regression").toBe(0);
  });

  test("BEHAVIOURAL: double-clicking a badged building opens Properties (the owner's report)", async ({ page }) => {
    await loadOwnerPlan(page);
    for (const id of BADGED) {
      await zoomTo(page, id);                       // detail zoom, so the press is unambiguous
      const hit = await hitAtCentre(page, id);      // measured AFTER the zoom, never before
      if (hit.missing) continue;
      expect(hit.chip, `the acreage badge is still covering ${id}'s centre`).toBe(false);
      await page.mouse.move(hit.x, hit.y);
      await page.mouse.dblclick(hit.x, hit.y);
      await page.waitForTimeout(250);
      expect(await dockState(page), `double-click on ${id} did not open Properties`).toBe("properties");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
    }
  });

  test("BEHAVIOURAL: a double-click in the dimension band opens something instead of dying", async ({ page }) => {
    await loadOwnerPlan(page);
    /* The defect this covers is invisible to the structural half. The fat transparent grab line and
       the dimension number both live INSIDE the element's own group (so they pass #1), but the grab
       line renders only ONCE THE ELEMENT IS SELECTED — so press 2 of a real double-click lands on a
       layer press 1 has just created, and `startDimMove` swallowed it. The number had the twin
       defect: it keyed the gesture on a PRIVATE `eldim:` id, which both broke its own pairing with a
       body press and clobbered the single shared tap record.
       Driven on the element the owner's badge was found sitting on, at a detail zoom (the dimension
       tier is LOD-gated and renders nothing at the whole-site fit). */
    const ID = BADGED[0];
    expect(await zoomTo(page, ID), "could not zoom to the target element").toBe(true);
    /* Find the grab band's own screen position. It renders only while the element is SELECTED, so
       select, measure, then DESELECT — the repro needs the band absent when press 1 lands and
       present when press 2 does, which is precisely the shape that made the double-click undeliverable. */
    const c = await page.evaluate((id) => {
      const r = document.querySelector(`[data-el-id="${id}"]`).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, ID);
    await page.mouse.click(c.x, c.y);
    await page.waitForTimeout(350);
    const band = await page.evaluate((id) => {
      const g = document.querySelector(`[data-el-id="${id}"] [data-testid="el-dim-grab"]`);
      if (!g) return null;
      const r = g.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, ID);
    expect(band, "no dimension grab band rendered on the selected element — the LOD zoom needs revisiting").toBeTruthy();
    await page.keyboard.press("Escape");            // deselect: the band goes away again
    await page.waitForTimeout(300);
    expect(await dockState(page)).toBe("none");
    /* ONE double-click, straight onto the band's position. Press 1 hits the element body and selects
       it — which MINTS the band under the cursor — and press 2 lands on that brand-new band. */
    await page.mouse.dblclick(band.x, band.y);
    await page.waitForTimeout(350);
    const opened = await page.evaluate(() => ({
      dock: (document.querySelector('[data-rail-tab][aria-pressed="true"]') || { getAttribute: () => "none" }).getAttribute("data-rail-tab"),
      inline: !!document.querySelector('foreignObject input[type="number"]'),
    }));
    /* EITHER surface is a pass — Properties, or the inline length editor the number owns. What is
       NOT a pass is the pre-fix behaviour: a double-click in this band that opened nothing at all. */
    expect(opened.dock === "properties" || opened.inline, `a double-click in the dimension band opened nothing: ${JSON.stringify(opened)}`).toBeTruthy();
  });
});
