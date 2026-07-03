/**
 * Verify B627 — the dedicated canvas right-click menu (never the browser's).
 *
 * Owner ask: "I should be able to right-click a parcel from a metes-and-bounds and delete it…
 * it should be a dedicated menu for something on the map. And even a right-click on empty map,
 * I'd rather it catch it before the Chrome menu."
 *
 * Logged-out headless (pure client UI). Seeds a site with a parcel + a plotted deed (boundary +
 * a save-and-except hole sharing one deedGroup), then:
 *   1. right-clicking the deed opens OUR menu (Align to county parcel + Delete deed + exceptions),
 *      and the native browser menu is suppressed (contextmenu defaultPrevented);
 *   2. "Delete deed + exceptions" removes the WHOLE group and tombstones both ids (B556/B612);
 *   3. right-clicking empty canvas opens the "Map" menu (Zoom to fit / Paste) — also suppressing
 *      the native menu.
 *
 * Run:  npm run build && npx vite preview --port 4188  (background), then
 *       BASE_URL=http://localhost:4188/ node ui-audit/verify-b627-context-menu.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4188/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const centroid = (pts) => { let x = 0, y = 0; for (const p of pts) { x += p.x; y += p.y; } return { x: x / pts.length, y: y / pts.length }; };
const rot = (pts, deg, piv) => { const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return pts.map((p) => { const dx = p.x - piv.x, dy = p.y - piv.y; return { x: piv.x + c * dx - s * dy, y: piv.y + s * dx + c * dy }; }); };

const PARCEL0 = [{ x: 0, y: 0 }, { x: 2600, y: 0 }, { x: 2350, y: 1650 }, { x: 150, y: 1950 }];
const C0 = centroid(PARCEL0);
const PARCEL = PARCEL0.map((p) => ({ x: p.x - C0.x, y: p.y - C0.y }));
const Cp = centroid(PARCEL);
const DEED = rot(PARCEL, 2.0, Cp); // slightly rotated (so Align has something to do) but overlapping
const HOLE = rot([{ x: 900, y: 700 }, { x: 1200, y: 700 }, { x: 1200, y: 1000 }, { x: 900, y: 1000 }].map((p) => ({ x: p.x - C0.x, y: p.y - C0.y })), 2.0, Cp);

const ring = (pts) => [...pts, pts[0]];
const mk = (id, pts, except) => ({
  id, kind: "encumbrance", pts, centerline: ring(pts), closed: true, calls: [],
  label: except ? "Save & except" : "Tract boundary", deedGroup: "g1", except,
  stroke: except ? "#b91c1c" : "#7c3aed", fill: except ? "#b91c1c" : "#7c3aed",
  fillOpacity: except ? 0.1 : 0.14, weight: 2, dash: except ? "6 4" : "solid",
});

const site = {
  s_ctx: {
    id: "s_ctx", groupId: "s_ctx", site: "Context Menu Test", name: "Plan 1", status: "active",
    origin: { lat: 29.80, lon: -94.87 }, county: "chambers",
    parcels: [{ id: "pA", points: PARCEL, locked: true }],
    els: [], measures: [], callouts: [],
    markups: [mk("deed_main", DEED, false), mk("deed_hole", HOLE, true)],
    deletedIds: [], settings: { showSetback: false }, underlay: null, updatedAt: Date.now(),
  },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(site)}));
  localStorage.setItem('planarfit:currentSite:v1', 's_ctx');
} catch (e) {} })();`;

const ok = (b) => (b ? "PASS" : "FAIL");
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${ok(cond)}] ${label}${extra ? ` — ${extra}` : ""}`); };

const persisted = (page) => page.evaluate(() => {
  try { const s = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}").s_ctx; return { markups: (s.markups || []).map((m) => m.id), deletedIds: s.deletedIds || [] }; }
  catch (e) { return null; }
});
// an OFF-CENTRE interior point of a rendered convex polygon (blend of centroid + a vertex),
// so we land on the deed body and not the parcel's centred acreage chip.
const interiorOf = (loc) => loc.evaluate((el) => {
  const pts = el.getAttribute("points").trim().split(/\s+/).map((s) => s.split(",").map(Number));
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const ix = cx + 0.5 * (pts[0][0] - cx), iy = cy + 0.5 * (pts[0][1] - cy); // toward the first vertex
  const m = el.getScreenCTM(), p = el.ownerSVGElement.createSVGPoint(); p.x = ix; p.y = iy;
  const v = p.matrixTransform(m); return { x: v.x, y: v.y };
});
const menuButtons = (page) => page.evaluate(() => [...document.querySelectorAll("div.menu button")].map((b) => (b.textContent || "").trim()));

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2800);
  await page.locator('svg[aria-label="Site plan canvas"]').waitFor({ timeout: 12000 });
  await page.getByRole("button", { name: "Zoom to fit" }).first().click().catch(() => {});
  await page.waitForTimeout(500);

  // ── 1. right-click the deed → OUR menu, native suppressed ──────────────────
  const deed = page.locator('[data-testid="deed-boundary"]').first();
  await deed.waitFor({ timeout: 8000 });
  const dp = await interiorOf(deed);
  await page.mouse.click(dp.x, dp.y, { button: "right" });
  await page.waitForTimeout(400);
  let btns = await menuButtons(page);
  expect("right-click the deed opens OUR menu (Align + Delete), not the browser's", btns.some((t) => /Delete deed/.test(t)) && btns.some((t) => /Align to county parcel/.test(t)), btns.join(" | "));

  // ── 2. Delete deed + exceptions → whole group gone AND tombstoned ──────────
  await page.getByRole("button", { name: /Delete deed/ }).click();
  await page.waitForTimeout(500);
  const after = await persisted(page);
  expect("Delete removes the deed AND its save-and-except hole", !after.markups.includes("deed_main") && !after.markups.includes("deed_hole"), `markups: [${after.markups.join(",")}]`);
  expect("both ids are tombstoned (won't resurrect on a cloud/tab merge)", after.deletedIds.includes("deed_main") && after.deletedIds.includes("deed_hole"), `deletedIds: [${after.deletedIds.join(",")}]`);

  // ── 3. right-click EMPTY canvas → the Map menu. The parcel's fill is pointer-inert (B420),
  // so an off-centre interior point falls through to the background → the empty-canvas menu. ──
  const ep = await interiorOf(page.locator('[data-testid="parcel-outline"]').first());
  await page.mouse.click(ep.x, ep.y, { button: "right" });
  await page.waitForTimeout(400);
  btns = await menuButtons(page);
  expect("right-click empty canvas opens the Map menu (Zoom to fit / Paste)", btns.some((t) => /Zoom to fit/.test(t)) && btns.some((t) => /Paste/.test(t)), btns.join(" | "));

  // ── 4. the native browser context menu is suppressed anywhere on the canvas ──
  // dispatch a real contextmenu on the canvas and confirm our handler cancelled it (preventDefault).
  const suppressed = await page.evaluate(() => {
    const svg = document.querySelector('svg[aria-label="Site plan canvas"]');
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 900, clientY: 650 });
    svg.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect("the native browser menu is suppressed on the canvas (contextmenu default-prevented)", suppressed === true);

  await browser.close();
  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
