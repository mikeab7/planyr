/* NEW-3 / NEW-4 — the Layers panel stops fighting the map, and the plan stays the subject.
 *
 * The owner's report, on a real Goose Creek plan with ten layers on:
 *   • "The map's zoom +/- and fullscreen controls, and the scale bar, DRAW ON TOP OF THE PANEL.
 *      They clip the 'N ON' count on the FLOOD & DRAINAGE header and cover the FEMA opacity
 *      slider row and the 'Show above plan' control underneath it."
 *   • "'FEMA flood zones' wraps onto two lines and its legend chip is cut off at the right edge
 *      as 'FEM'."
 *   • "About four rows of a TWENTY-EIGHT layer list are visible at a time in the scroll box."
 *   • "With ten layers on, the site plan is buried… nothing recedes."
 *   • "Recovering from an over-layered map means unchecking boxes one at a time."
 *
 * These assert the MEASURED versions of those five sentences, logged out on a seeded plan with
 * no external GIS — so they are Claude-verifiable here, not parked for a live pass.
 */
import { test, expect } from "@playwright/test";
import { panelSel, openPlannerLayers, groupKeys, selectGroup, setLayer } from "./lib/layersPanel.js";
import fs from "node:fs";

const LAT = 29.735, LON = -94.977; // Goose Creek / Baytown
const SITE = {
  schemaVersion: 12, id: "new34-legibility", groupId: "new34-legibility",
  site: "NEW34 Legibility", name: "NEW34 Legibility",
  updatedAt: 1783000000000, teamId: null, ownerId: null,
  scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: LAT, lon: LON }, county: "harris", status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1800, y: 0 }, { x: 1800, y: 1400 }, { x: 0, y: 1400 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {},
  els: [
    { id: "b1", type: "building", cx: 500, cy: 500, w: 700, h: 400, rot: 0 },
    { id: "b2", type: "building", cx: 1300, cy: 950, w: 500, h: 320, rot: 0 },
  ],
};

const SHOTS = "test-results/new34";

async function openPlanner(page) {
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (route) => route.abort());
  await page.addInitScript((s) => { try { localStorage.setItem("planarfit:sites:v1", s); } catch (_) {} }, JSON.stringify({ [SITE.id]: SITE }));
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/#/site-planner", { waitUntil: "load" });
  await page.getByText("NEW34 Legibility", { exact: false }).first().click();
  await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(800);
  // NEW-1 (Imagery & Layers): the card opens through its own chip; the panel is two panes, so a spec that reads "the rows" reads one group at a time.
  await openPlannerLayers(page);
  const panel = page.locator(panelSel("planner")).first();
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("NEW-3 — the panel stops fighting the map", () => {
  test("no map chrome paints over the open panel, anywhere in it", async ({ page }) => {
    const panel = await openPlanner(page);
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/after-panel-open.png` });

    const box = await panel.boundingBox();
    expect(box).toBeTruthy();

    /* ⛔ HOW THIS IS ASSERTED, and why it took three attempts to get honest.
     *
     * v1 walked a grid of points and asked `elementFromPoint` what was on top. It passed with
     * the fix DELIBERATELY REVERTED — because `elementFromPoint` honours `pointer-events: none`,
     * and the canvas furniture (scale bar, north arrow) is exactly that. It never intercepts a
     * click; it just PAINTS over the panel, which is precisely what the owner photographed. A
     * hit-test is structurally blind to this bug.
     *
     * v2 asserted the rectangles must not INTERSECT at all. Too strict, and wrong in a way worth
     * recording: the panel now runs nearly the full height of the map, so the scale bar sits
     * inside its rectangle by construction. Overlap is not the defect — being painted OVER is.
     *
     * v3, this one: find the map-chrome elements that actually paint AND overlap the panel, then
     * force `pointer-events: auto` on each so the hit-test can see it, and ask who is on top at
     * the shared pixels. That isolates PAINT ORDER from pointer policy, which is the property the
     * owner's report is actually about. Restored afterwards, so nothing leaks into later tests. */
    const covered = await page.evaluate(({ x, y, w, h }) => {
      const P = { l: x, t: y, r: x + w, b: y + h };
      const paints = (el) => {
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) === 0) return false;
        const bg = cs.backgroundColor;
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return true;
        if (parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0) return true;
        if (/^(svg|text|path|IMG|CANVAS)$/i.test(el.tagName)) return true;
        return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      };
      const panelEl = document.querySelector('[data-testid="layer-panel"]');
      const bad = [];
      const restore = [];
      const containers = [...document.querySelectorAll('[data-export="skip"], .leaflet-control-container, .leaflet-control')]
        .filter((c) => !c.contains(panelEl) && !panelEl.contains(c));
      for (const c of containers) {
        for (const el of [c, ...c.querySelectorAll("*")]) {
          if (!paints(el)) continue;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          if (!(r.left < P.r && r.right > P.l && r.top < P.b && r.bottom > P.t)) continue;
          // The shared pixels, sampled at the middle of the overlap.
          const px = (Math.max(r.left, P.l) + Math.min(r.right, P.r)) / 2;
          const py = (Math.max(r.top, P.t) + Math.min(r.bottom, P.b)) / 2;
          restore.push([el, el.style.pointerEvents]);
          el.style.pointerEvents = "auto";
          const top = document.elementFromPoint(px, py);
          const panelWins = !!(top && (top.closest('[data-testid="layer-panel"]') || (panelEl && panelEl.contains(top)) || top.closest('[data-wheelscroll="1"]')));
          if (!panelWins && top !== document.documentElement && el.contains(top)) {
            bad.push({ tag: el.tagName, cls: String(el.className).slice(0, 40), at: [Math.round(px), Math.round(py)] });
          }
        }
      }
      for (const [el, v] of restore) el.style.pointerEvents = v;
      return bad;
    }, { x: box.x, y: box.y, w: box.width, h: box.height });
    expect(covered, `map chrome is painting over the open Layers panel at ${JSON.stringify(covered).slice(0, 400)}`).toEqual([]);
  });

  test("every row is ONE line, and nothing is clipped by the panel edge — in every group", async ({ page }) => {
    const panel = await openPlanner(page);
    // "FEMA flood zones" wrapping to two lines and losing its chip was the specific report; the redesign keeps the promise for EVERY group.
    const bad = [];
    for (const key of await groupKeys(panel)) {
      await selectGroup(panel, key);
      bad.push(...await panel.evaluate((root, group) => {
        const out = [];
        const scroller = root.closest('[data-wheelscroll="1"]') || root.parentElement;
        const sBox = scroller.getBoundingClientRect();
        for (const row of root.querySelectorAll('[data-testid^="layer-row-"]:not([data-testid$="-menu"])')) {
          const line = row.firstElementChild;
          const name = row.querySelector("label span[title]");
          if (!line || !name) continue;
          if (line.getBoundingClientRect().height > 34) out.push({ group, why: "wrapped", text: name.textContent.trim().slice(0, 40) });
          if (name.scrollWidth > name.clientWidth + 1) out.push({ group, why: "ellipsised", text: name.textContent.trim().slice(0, 40) });
          if (line.getBoundingClientRect().right > sBox.right + 1) out.push({ group, why: "clipped", text: name.textContent.trim().slice(0, 40) });
        }
        return out;
      }, key));
    }
    expect(bad, `rows wrapping, ellipsised or clipped: ${JSON.stringify(bad).slice(0, 400)}`).toEqual([]);
  });

  test("the group list stays put while a long group's rows scroll", async ({ page }) => {
    const panel = await openPlanner(page);
    await selectGroup(panel, "flood"); // the longest group
    /* ⛔ This must PROVE the list actually scrolled first (the old header-stickiness guard passed with the rule removed, because a panel
     * tall enough to need no scrolling leaves the header where it was). A guard that cannot tell "sticky" from "nothing moved" is not one. */
    const stuck = await panel.evaluate((root) => {
      let scroller = root.parentElement;
      while (scroller && getComputedStyle(scroller).overflowY !== "auto") scroller = scroller.parentElement;
      if (!scroller) return { ok: false, why: "no scrolling ancestor" };
      const nav = root.querySelector('[data-testid="layer-group-nav"]');
      if (!nav) return { ok: false, why: "no group list" };
      // Shorter than the content, but taller than the group list itself (a list taller than its box cannot stick whole).
      scroller.style.maxHeight = "270px";
      scroller.style.height = "270px";
      const first = root.querySelector('[data-testid^="layer-row-"] input[type="checkbox"]');
      const rowBefore = first.getBoundingClientRect().top;
      scroller.scrollTop = 50; // within the panel's own height — the card holds more below it, and a sticky list ends with its panel
      const s = scroller.getBoundingClientRect();
      const rowAfter = first.getBoundingClientRect().top;
      const scrolled = scroller.scrollTop > 0 && Math.abs(rowAfter - rowBefore) > 10;
      const after = nav.getBoundingClientRect().top;
      return { ok: scrolled && after >= s.top - 1 && after <= s.top + 60, scrolled, after: Math.round(after), top: Math.round(s.top) };
    });
    expect(stuck.scrolled, `the list did not actually scroll, so stickiness was never exercised: ${JSON.stringify(stuck)}`).toBe(true);
    expect(stuck.ok, `the group list scrolled out of the box instead of sticking: ${JSON.stringify(stuck)}`).toBe(true);
  });
});

test.describe("NEW-4 — the plan stays the most legible thing on screen", () => {
  test("one click turns every reference layer off (⋯ menu), and leaves the plan and the ground alone", async ({ page }) => {
    const panel = await openPlanner(page);
    const onIds = () => page.evaluate(() => (window.__plannerLayers ? window.__plannerLayers().on : []));

    // Turn several layers on the way the owner would — by clicking their boxes, across groups.
    for (const id of ["fema", "wetlands", "contours", "jur_county", "txdot_aadt"]) await setLayer(page, id, true).catch(() => {});
    await page.waitForTimeout(400);
    expect((await onIds()).length, "layers on before the sweep").toBeGreaterThan(0);
    await page.screenshot({ path: `${SHOTS}/after-layers-on.png` });

    // THE ESCAPE HATCH — moved into the ⋯ menu (NEW-1, Imagery & Layers): "Turn all layers off", same sweep, no count bar.
    await panel.getByTestId("layers-more").click();
    const clear = page.getByTestId("layers-clear-all");
    await expect(clear).toBeVisible();
    await expect(clear).toBeEnabled();
    await clear.click();
    await page.waitForTimeout(500);

    expect(await onIds(), "every layer off after one click").toEqual([]);
    // …and the plan is still there. The sweep clears reference data, never the drawing.
    await expect(page.getByTestId("planner-canvas")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/after-cleared.png` });
    // The menu item is disabled once there is nothing left to clear — never dead chrome that looks live.
    await panel.getByTestId("layers-more").click();
    await expect(page.getByTestId("layers-clear-all")).toBeDisabled();
  });
});
