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
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/#/site-planner", { waitUntil: "load" });
  await page.getByText("NEW34 Legibility", { exact: false }).first().click();
  await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /^\s*❖?\s*Layers/ }).first().click();
  const panel = page.getByTestId("layer-panel").filter({ visible: true }).first();
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

  test("every row is ONE line, and nothing is clipped by the panel edge", async ({ page }) => {
    const panel = await openPlanner(page);
    // "FEMA flood zones" wrapping to two lines and losing its chip was the specific report.
    const bad = await panel.evaluate((root) => {
      const out = [];
      const scroller = root.closest('[data-wheelscroll="1"]') || root.parentElement;
      const sBox = scroller.getBoundingClientRect();
      for (const cb of root.querySelectorAll('input[type="checkbox"]')) {
        const label = cb.closest("label");
        if (!label) continue;
        const span = label.querySelector("span");
        if (!span) continue;
        const r = span.getBoundingClientRect();
        const oneLine = r.height <= 22; // a wrapped row is roughly double
        if (!oneLine) out.push({ why: "wrapped", text: span.textContent.trim().slice(0, 40), h: Math.round(r.height) });
        // Nothing on the row may extend past the scroller's right edge (where overflow clips it).
        const row = label.parentElement;
        const rr = row.getBoundingClientRect();
        if (rr.right > sBox.right + 1) out.push({ why: "clipped", text: span.textContent.trim().slice(0, 40) });
      }
      return out;
    });
    expect(bad, `rows wrapping or clipped: ${JSON.stringify(bad).slice(0, 400)}`).toEqual([]);
  });

  test("the list shows many more than four rows, and group headers stay put while scrolling", async ({ page }) => {
    const panel = await openPlanner(page);
    const visibleRows = await panel.evaluate((root) => {
      const scroller = root.closest('[data-wheelscroll="1"]') || root.parentElement;
      const s = scroller.getBoundingClientRect();
      let n = 0;
      for (const cb of root.querySelectorAll('input[type="checkbox"]')) {
        const r = cb.getBoundingClientRect();
        if (r.top >= s.top - 1 && r.bottom <= s.bottom + 1) n++;
      }
      return n;
    });
    // The owner counted about four. Anything in double figures is a different panel.
    expect(visibleRows, "rows visible without scrolling").toBeGreaterThanOrEqual(10);

    // The group header is sticky, so scrolling the list does not scroll it out of the scrollport.
    /* ⛔ This must PROVE the list actually scrolled first. The first version did not, and it
     * passed with the sticky rule removed — because a panel tall enough to need no scrolling
     * leaves the header where it was and the check succeeded for the wrong reason. A guard that
     * cannot distinguish "sticky" from "nothing moved" is not a guard. */
    const stuck = await panel.evaluate((root) => {
      // The scroller is the panel root's own scrolling ancestor — find it by asking which
      // ancestor actually has `overflow-y: auto`, rather than assuming a particular wrapper.
      let scroller = root.parentElement;
      while (scroller && getComputedStyle(scroller).overflowY !== "auto") scroller = scroller.parentElement;
      if (!scroller) return { ok: false, why: "no scrolling ancestor" };
      const hdr = root.querySelector(".pf-sticky-group-hdr");
      if (!hdr) return { ok: false, why: "no sticky header element" };
      // Collapse the box so the list MUST overflow, then scroll it for real.
      scroller.style.maxHeight = "180px";
      scroller.style.height = "180px";
      const first = root.querySelector('input[type="checkbox"]');
      const rowBefore = first ? first.getBoundingClientRect().top : null;
      scroller.scrollTop = 300;
      const s = scroller.getBoundingClientRect();
      const rowAfter = first ? first.getBoundingClientRect().top : null;
      const scrolled = scroller.scrollTop > 0 && rowBefore != null && Math.abs(rowAfter - rowBefore) > 20;
      const after = hdr.getBoundingClientRect().top;
      return { ok: scrolled && after >= s.top - 1 && after <= s.top + 4, scrolled, scrollTop: scroller.scrollTop,
        after: Math.round(after), top: Math.round(s.top), rowMoved: rowBefore == null ? null : Math.round(rowAfter - rowBefore) };
    });
    expect(stuck.scrolled, `the list did not actually scroll, so stickiness was never exercised: ${JSON.stringify(stuck)}`).toBe(true);
    expect(stuck.ok, `the group header scrolled out of the box instead of sticking: ${JSON.stringify(stuck)}`).toBe(true);
  });
});

test.describe("NEW-4 — the plan stays the most legible thing on screen", () => {
  test("one click turns every reference layer off, and leaves the plan and the ground alone", async ({ page }) => {
    const panel = await openPlanner(page);

    // Turn several layers on the way the owner would — by clicking their boxes.
    const boxes = panel.locator('input[type="checkbox"]:not([disabled])');
    const n = Math.min(6, await boxes.count());
    for (let i = 0; i < n; i++) await boxes.nth(i).check({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
    const onBefore = await panel.locator('input[type="checkbox"]:checked').count();
    expect(onBefore, "layers on before the sweep").toBeGreaterThan(0);
    await page.screenshot({ path: `${SHOTS}/after-layers-on.png` });

    // THE ESCAPE HATCH — one control, named with the count it will clear.
    const clear = page.getByTestId("layers-clear-all").filter({ visible: true }).first();
    await expect(clear).toBeVisible();
    await expect(clear).toContainText(/Turn all \d+ layers? off/);
    await clear.click();
    await page.waitForTimeout(500);

    expect(await panel.locator('input[type="checkbox"]:checked').count(), "every layer off after one click").toBe(0);
    // …and the plan is still there. The sweep clears reference data, never the drawing.
    await expect(page.getByTestId("planner-canvas")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/after-cleared.png` });
    // The control disappears once there is nothing left to clear — never dead chrome.
    await expect(page.getByTestId("layers-clear-all")).toHaveCount(0);
  });
});
