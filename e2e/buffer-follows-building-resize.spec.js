/* B2671304 (×2) — "pushing out or expanding the building will move the buffer out, but then shrinking the building
 * doesn't bring it back" (owner, 2026-11-24, recurrence of the detached landscaping buffer; PR 3006 only covered a
 * parking cfg edit). ROOT CAUSE: `wallStripBoxFor` placed a flush buffer with a one-directional clamp ("pushed out …
 * never pulled in"). FIX: one shared pack (lib/dogEar `repackFlushLayers`) run by every refit and the load heal.
 *
 * Through the real planner, on a ROTATED building's end wall with sidewalk + side parking + buffer:
 *   1. open a plan whose buffer is already detached → it is flush after load (self-repair on open)
 *   2. drag the building's end-wall edge OUT, then IN past where it started → flush after each
 *   3. Ctrl+Z / Ctrl+Shift+Z → flush after each
 *   4. reload → still flush
 * Logged out, local storage only. Verify: sandbox (+ live check on a throwaway duplicate, V#).
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks, openModule } from "./helpers.js";

const SITE_ID = "e2e-buffer-follows-resize";
const ROT = 30;
const B = { id: "hostB", type: "building", cx: 5000, cy: 5000, w: 400, h: 200, rot: ROT, dock: "both" };
const rot2 = (x, y, deg) => { const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return { x: x * c - y * s, y: x * s + y * c }; };
// A LEFT-wall child of depth d whose inner face is `inner` ft from the host centre (host-local), full wall run.
const leftKid = (id, type, d, inner, extra = {}) => {
  const o = rot2(-(inner + d / 2), 0, ROT);
  return { id, type, attachedTo: B.id, rot: ROT, cx: B.cx + o.x, cy: B.cy + o.y, w: d, h: B.h, ...extra };
};
const SW = leftKid("swL", "sidewalk", 5, 200, { sidewalkSide: "left" });
const PK = leftKid("pkL", "parking", 60, 205, { sideParkSide: "left" });
const BUF = leftKid("bufL", "landscape", 10, 265 + 40, { buffer: true });   // 40 ft of bare ground: already detached

const readEls = (page) => page.evaluate(({ key, siteId }) => {
  const rec = JSON.parse((globalThis.__planyrSitesRaw || ((k) => localStorage.getItem(k)))(key) || "{}")[siteId];
  return rec.els || [];
}, { key: "planarfit:sites:v1", siteId: SITE_ID });
// Bare ground (or overlap) between the parking's outer face and the buffer's inner face, measured on the host's axes.
const bufferGap = async (page) => {
  const els = await readEls(page), by = (id) => els.find((e) => e.id === id);
  const b = by(B.id), p = by(PK.id), f = by(BUF.id);
  const out = (k) => { const l = rot2(k.cx - b.cx, k.cy - b.cy, -b.rot); return -l.x; };   // outward = −x on the left wall
  const pkDepth = Math.abs(((p.rot - b.rot) % 180 + 180) % 180 - 90) < 45 ? p.h : p.w;
  const fDepth = Math.abs(((f.rot - b.rot) % 180 + 180) % 180 - 90) < 45 ? f.h : f.w;
  return { gap: (out(f) - fDepth / 2) - (out(p) + pkDepth / 2), bw: b.w };
};

test("the landscape buffer follows the building edge both ways: open, grow, shrink, undo, redo, reload", async ({ page }) => {
  await armPlannerHooks(page);
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Test", name: "Buffer follows resize", origin: null, county: "harris",
    parcels: [], els: [B, SW, PK, BUF], measures: [], callouts: [], markups: [],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: 1785500000000,
  };
  await page.addInitScript(([id, rec]) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto("/");
  await openModule(page, "site-planner");
  await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 45000 });
  await expect.poll(() => page.locator(`[data-el-id="${BUF.id}"]`).count(), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window.__plannerView ? 1 : 0)), { timeout: 20_000 }).toBe(1);
  await page.evaluate(([x, y]) => window.__plannerView.centerOn(x, y, 0.6), [B.cx, B.cy]);
  await page.waitForTimeout(200);

  // 1. Self-repair on open: the planner's open path ran the heal, so a single edit persists it — but even the
  //    in-memory plan must already be flush. Nudge-free check: drag nothing, read after the first save below.
  const centre = async () => page.evaluate((id) => {
    const r = document.querySelector(`[data-el-id="${id}"] rect`).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, B.id);
  const c = await centre();
  await page.mouse.click(c.x, c.y);
  await expect(page.locator('[data-handle="edge"][data-edge="-1,0"]').first()).toBeVisible({ timeout: 5_000 });

  const dragLeftEdge = async (px) => {
    const g = await page.locator('[data-handle="edge"][data-edge="-1,0"]').first().boundingBox();
    const hc = await centre();
    const x = g.x + g.width / 2, y = g.y + g.height / 2;
    const dx = x - hc.x, dy = y - hc.y, len = Math.hypot(dx, dy) || 1;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + (dx / len) * px / 2, y + (dy / len) * px / 2, { steps: 6 });
    await page.mouse.move(x + (dx / len) * px, y + (dy / len) * px, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(350);
  };

  // 2. Grow the building out on the buffer's wall, then shrink it in past where it started.
  await dragLeftEdge(50);
  let r = await bufferGap(page);
  expect(r.bw, "the building grew").toBeGreaterThan(B.w + 10);
  expect(Math.abs(r.gap), `after the grow the buffer is flush (also proves the open heal closed the 40 ft gap)`).toBeLessThan(0.5);
  const grownW = r.bw;
  await dragLeftEdge(-110);
  r = await bufferGap(page);
  expect(r.bw, "the building shrank below where it started").toBeLessThan(B.w - 10);
  expect(Math.abs(r.gap), "after the SHRINK the buffer came back in with the wall (the reported bug)").toBeLessThan(0.5);

  // 3. Undo / redo land on flush states.
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(350);
  r = await bufferGap(page);
  expect(r.bw).toBeCloseTo(grownW, 0);
  expect(Math.abs(r.gap), "after undo").toBeLessThan(0.5);
  await page.keyboard.press("Control+Shift+z");
  await page.waitForTimeout(350);
  r = await bufferGap(page);
  expect(r.bw).toBeLessThan(B.w - 10);
  expect(Math.abs(r.gap), "after redo").toBeLessThan(0.5);

  // 4. Reload: still flush.
  await page.reload();
  await openModule(page, "site-planner");
  await expect.poll(() => page.locator(`[data-el-id="${BUF.id}"]`).count(), { timeout: 20_000 }).toBeGreaterThan(0);
  r = await bufferGap(page);
  expect(Math.abs(r.gap), "after reload").toBeLessThan(0.5);
});
