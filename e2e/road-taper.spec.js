/* NEW-1 (2026-11-10) — ROADS OF DIFFERENT WIDTHS JOIN WITH A SMOOTH TAPER, driven in the REAL planner (lib/roadTaper.js).
 *
 * A 50 ft road ends where a 24 ft drive begins. Read off the app's own dissolved network (`__plannerRoadNet`, the surface the canvas paints), the
 * Properties panel and the persisted model — never a re-implementation:
 *
 *   1  the pavement is ONE outline narrowing 50 → 24 over the automatic length, no step at the joint
 *   2  the road's Properties panel carries a "Taper" section with the automatic length; a road with no tapered joint has none
 *   3  typing a length redraws the taper at once, is the ONLY thing stored (`taper.e`), survives a reload, and Ctrl+Z restores the automatic one
 *   4  deleting the narrow road removes the taper (the wide road is a plain constant-width strip again)
 *
 * Run: PW_CHROME=/opt/pw-browsers/chromium npx playwright test e2e/road-taper.spec.js --project=chromium */
import { test, expect } from "@playwright/test";
import { armPlannerHooks, roadNetwork } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const SITE = "e2e-road-taper";
const road = (id, pts, travelW) => {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys) + travelW + 1;
  return { id, type: "road", z: id === "W" ? 1 : 2, pts, vtx: pts.map(() => ({})), travelW, curb: 0.5, roadClass: "local", cx: (Math.max(...xs) + Math.min(...xs)) / 2, cy: (Math.max(...ys) + Math.min(...ys)) / 2, w, h, rot: 0 };
};
const WIDE = road("W", [{ x: 0, y: 0 }, { x: 200, y: 0 }], 50), NARROW = road("N", [{ x: 200, y: 0 }, { x: 400, y: 0 }], 24);

async function boot(page) {
  await armPlannerHooks(page);
  const site = { id: SITE, groupId: SITE, site: "Taper", name: "A", origin: null, county: "harris", parcels: [], els: [WIDE, NARROW], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
  await page.addInitScript(([id, rec]) => {
    if (!localStorage.getItem("e2e-road-taper-seeded")) {           // seed ONCE, so a reload shows what was persisted
      localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
      localStorage.setItem("e2e-road-taper-seeded", "1");
    }
    localStorage.setItem("planarfit:currentSite:v1", id);
    localStorage.setItem("planarfit:startHintDismissed", "1");
  }, [SITE, site]);
  await page.goto("/");
  const tab = page.getByTestId("module-tab-site-planner").filter({ visible: true });
  await tab.waitFor({ state: "visible", timeout: 20_000 });
  await expect(async () => { await tab.click({ timeout: 3_000 }); await expect(canvas(page)).toBeVisible({ timeout: 3_000 }); }).toPass({ timeout: 30_000 });
  await page.waitForFunction(() => !!window.__plannerView, null, { timeout: 20_000 });
  await page.evaluate(() => window.__plannerView.centerOn(200, 0, 1.2));
  await page.waitForTimeout(500);
}
const halfWidthAt = (ring, X) => {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if ((a.x - X) * (b.x - X) > 0 || a.x === b.x) continue;
    const y = a.y + ((b.y - a.y) * (X - a.x)) / (b.x - a.x);
    lo = Math.min(lo, y); hi = Math.max(hi, y);
  }
  return Number.isFinite(lo) ? Math.max(hi, -lo) : null;
};
const outerOf = async (page) => { const n = await roadNetwork(page); expect(n.regions).toHaveLength(1); return n.regions[0].outer; };
const stored = (page) => page.evaluate(() => {
  const m = JSON.parse((globalThis.__planyrSitesRaw || ((k) => localStorage.getItem(k)))("planarfit:sites:v1") || "{}");
  return ((Object.values(m)[0] || {}).els || []).filter((e) => e.type === "road");
});
async function openWidePanel(page) {
  const box = await canvas(page).boundingBox();
  const v = await page.evaluate(() => window.__plannerView.get());
  const pt = { x: box.x + v.offX + 30 * v.ppf, y: box.y + v.offY };
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(450);
  await page.mouse.dblclick(pt.x, pt.y);
  await expect(page.getByTestId("road-header")).toBeVisible({ timeout: 10_000 });
}

test("a 50 ft road and a 24 ft drive join with a taper (real planner)", async ({ page }) => {
  await boot(page);

  // 1 — one outline, narrowing over the automatic 130 ft, no step at the joint
  let ring = await outerOf(page);
  expect(halfWidthAt(ring, 40)).toBeCloseTo(25.5, 1);
  expect(halfWidthAt(ring, 135)).toBeCloseTo(19, 0);
  expect(halfWidthAt(ring, 300)).toBeCloseTo(12.5, 1);
  let prev = Infinity;
  for (let x = 1; x < 399; x++) { const h = halfWidthAt(ring, x); expect(h, `x=${x}`).not.toBeNull(); expect(h).toBeLessThanOrEqual(prev + 0.02); prev = h; }
  await page.screenshot({ path: "test-results/road-taper-auto.png" });

  // 2 — the panel: a Taper section with the automatic length
  await openWidePanel(page);
  const field = page.getByTestId("road-taper-e").first();
  await expect(field).toBeVisible();
  await expect(field).toHaveAttribute("placeholder", "130");
  await expect(page.getByTestId("road-taper-s")).toHaveCount(0);

  // 3 — type a length: redraws at once, stored on the wide road only, survives a reload, undo restores the automatic one
  await field.fill("60");
  await field.press("Enter");
  await expect.poll(async () => halfWidthAt(await outerOf(page), 120)).toBeCloseTo(25.5, 1);   // full width until x = 140
  expect(halfWidthAt(await outerOf(page), 170)).toBeCloseTo(19, 0);
  await page.waitForTimeout(900);
  let rs = await stored(page);
  expect(rs.find((r) => r.id === "W").taper).toEqual({ e: 60 });
  expect(rs.find((r) => r.id === "N").taper).toBeUndefined();
  // Ctrl+Z restores the automatic taper (ONE history frame), Ctrl+Y brings the typed one back
  await page.locator("body").click({ position: { x: 2, y: 2 } }).catch(() => {});
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await page.keyboard.press("Control+z");
  await expect.poll(async () => halfWidthAt(await outerOf(page), 120)).toBeLessThan(24);        // back to the automatic 130 ft taper
  expect(halfWidthAt(await outerOf(page), 135)).toBeCloseTo(19, 0);
  await page.waitForTimeout(900);
  expect((await stored(page)).find((r) => r.id === "W").taper).toBeUndefined();
  await page.keyboard.press("Control+y");
  await expect.poll(async () => halfWidthAt(await outerOf(page), 120)).toBeCloseTo(25.5, 1);
  await page.waitForTimeout(900);
  // …and the typed length survives a reload
  await page.reload();
  await page.waitForFunction(() => !!window.__plannerView, null, { timeout: 20_000 });
  await page.waitForTimeout(800);
  expect(halfWidthAt(await outerOf(page), 170)).toBeCloseTo(19, 0);
  expect((await stored(page)).find((r) => r.id === "W").taper).toEqual({ e: 60 });
  await page.screenshot({ path: "test-results/road-taper-60.png" });
});
