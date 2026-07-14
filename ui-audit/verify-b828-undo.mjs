/* Verify B828 — the undo BUTTON records + reverts edits that previously slipped the history stack.
 * Drives the REAL built Site Planner (vite preview :4173) LOGGED OUT and proves the headline case
 * of the "undo doesn't work" report end-to-end: the parcel fill "Translucence" slider.
 *
 * Before B828 the Translucence range had a bare onChange → setSelParcel (which never pushes history),
 * so dragging it recorded NO undo frame — clicking Undo either did nothing or jumped back past the
 * fill. Now it spreads {...sliderHistory(...)} like every other opacity slider, so one drag = one
 * undo frame. This script draws a parcel, enables fill, drags Translucence, then clicks the toolbar
 * Undo button and asserts the opacity reverts in ONE step while the parcel + fill survive; Redo
 * restores it. On-disk truth is read from localStorage (planarfit:sites:v1).
 *
 * The other three B828 fixes (raster overlay Width input, Stitcher auto-calibrate checkpoint, and the
 * DocReview/Stitcher render-time undo mirror) are the same proven patterns and are locked by
 * test/undoHistoryWiring.test.js; this is the end-to-end guard for the headline slider case.
 *
 * Run:  npm run build && npx vite preview --port 4173   (one shell)
 *       node ui-audit/verify-b828-undo.mjs              (another)
 */
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const results = [];
const ok = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? "PASS ✅" : "FAIL ❌"}  ${name}  —  ${detail}`); };
const settle = (page, ms = 250) => page.waitForTimeout(ms);

// The first parcel's fill state, straight from the on-disk site model.
const parcel0 = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const site = map[Object.keys(map)[0]] || {};
  const p = (site.parcels || [])[0] || null;
  return p ? { count: (site.parcels || []).length, fill: p.fill ?? null, fillOpacity: (p.fillOpacity === undefined ? null : p.fillOpacity) } : { count: 0, fill: null, fillOpacity: null };
});
async function poll(fn, pred, ms = 4000) { const t0 = Date.now(); let last; while (Date.now() - t0 < ms) { last = await fn(); if (pred(last)) return last; await new Promise((r) => setTimeout(r, 150)); } return last; }

const undoBtn = (page) => page.getByRole("button", { name: "Undo", exact: true });
const redoBtn = (page) => page.getByRole("button", { name: "Redo", exact: true });

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
const canvas = () => page.getByTestId("planner-canvas");

try {
  await page.goto(BASE, { waitUntil: "load" });
  await settle(page, 700);
  await page.getByRole("button", { name: /Start blank/i }).click();
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 10000 });
  await settle(page, 500);
  const box = await canvas().boundingBox();
  const clk = (x, y) => page.mouse.click(box.x + x, box.y + y);

  // Draw a parcel: the rail "Parcel ▾" button is a dropdown — open it, click "Draw new parcel",
  // drop 4 points, Enter to close.
  await page.getByRole("button", { name: /Parcel/ }).first().click();
  await settle(page, 200);
  await page.getByText("Draw new parcel", { exact: true }).click();
  await settle(page, 250);
  for (const [x, y] of [[300, 250], [560, 250], [560, 470], [300, 470]]) { await clk(x, y); await settle(page, 120); }
  await page.keyboard.press("Enter");
  await settle(page, 400);
  const drawn = await poll(() => parcel0(page), (p) => p.count >= 1);
  ok("parcel drawn", drawn.count >= 1, `parcels=${drawn.count}`);

  // Exit the Parcel tool (Esc → Select). closePoly runs requestFit(), so the parcel re-centres — select
  // it at an EXACT boundary point computed from the polygon geometry + the SVG screen CTM (a guessed
  // pixel misses the thin hit-stroke). Selecting a parcel auto-opens its panel, which has the Fill control.
  await page.keyboard.press("Escape");
  await settle(page, 400);
  const edgePts = await page.evaluate(() => {
    const poly = document.querySelector('[data-testid="parcel-outline"]');
    const m = poly.getScreenCTM();
    const pts = poly.getAttribute("points").trim().split(/\s+/).map((p) => { const [x, y] = p.split(",").map(Number); return { x, y }; });
    return pts.map((a, i) => { const b = pts[(i + 1) % pts.length]; const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; return { x: m.a * mx + m.c * my + m.e, y: m.b * mx + m.d * my + m.f }; });
  });
  const fillText = page.getByText(/Fill the parcel/i);
  for (const p of edgePts) { await page.mouse.click(p.x, p.y); await settle(page, 350); if (await fillText.count() > 0) break; }
  await fillText.first().click().catch(() => {});
  await settle(page, 300);
  const filled = await poll(() => parcel0(page), (p) => p.fill);
  ok("fill enabled on parcel", !!filled.fill, `fill=${filled.fill} fillOpacity=${filled.fillOpacity}`);

  // Drag the Translucence slider (the only range with max=0.6): ArrowRight ×6 = a burst of change
  // events, exactly what sliderHistory coalesces into ONE undo frame.
  const slider = page.locator('input[type="range"][max="0.6"]');
  await slider.focus();
  for (let i = 0; i < 6; i++) { await page.keyboard.press("ArrowRight"); await settle(page, 70); }
  await settle(page, 300);
  const dragged = await poll(() => parcel0(page), (p) => typeof p.fillOpacity === "number" && p.fillOpacity > 0.12);
  ok("dragging Translucence raised fillOpacity", typeof dragged.fillOpacity === "number" && dragged.fillOpacity > 0.12, `fillOpacity=${dragged.fillOpacity}`);
  const raised = dragged.fillOpacity;

  // Click the toolbar Undo button once → the whole translucence drag reverts in ONE step; the parcel +
  // fill survive (the pre-B828 bug: Undo did nothing here, or jumped back past the fill).
  ok("Undo button enabled", (await undoBtn(page).isDisabled()) === false, `disabled=${await undoBtn(page).isDisabled()}`);
  await undoBtn(page).click();
  await settle(page, 400);
  const undone = await poll(() => parcel0(page), (p) => p.fillOpacity == null || p.fillOpacity < raised);
  ok("CLICK Undo reverts Translucence in one step", undone.fillOpacity == null || undone.fillOpacity < raised, `fillOpacity ${raised} → ${undone.fillOpacity}`);
  ok("parcel + fill survive the undo (no overshoot)", undone.count >= 1 && !!undone.fill, `count=${undone.count} fill=${undone.fill}`);

  // Redo restores the raised translucence.
  await redoBtn(page).click();
  await settle(page, 400);
  const redone = await poll(() => parcel0(page), (p) => typeof p.fillOpacity === "number" && p.fillOpacity >= raised - 0.001);
  ok("Redo restores the raised Translucence", typeof redone.fillOpacity === "number" && redone.fillOpacity >= raised - 0.001, `fillOpacity=${redone.fillOpacity}`);

  ok("no page errors", pageErrors.length === 0, pageErrors.length ? pageErrors.slice(0, 3).join(" | ") : "clean");
} catch (e) {
  ok("harness ran", false, String(e && e.stack || e));
} finally {
  await browser.close();
}
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
