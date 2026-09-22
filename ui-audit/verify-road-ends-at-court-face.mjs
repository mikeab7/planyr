#!/usr/bin/env node
/* 2026-09-22 — PAINT-ORDER-INDEPENDENT acceptance for a road that tees into a paving pad / truck court.
 *
 * Draws a pad and a road in the app's REAL draw order (court first, then the road — the road is newest
 * and, since B1788912's creation-order stacking, paints ON TOP of the court) and asks the rendered
 * `road-network-surface` path itself whether it fills any point inside the pad. Whatever paints above
 * whatever, a road's pavement must END at the court face. Before this fix the road's overshoot, its
 * flat end cap and the wedge's tangent cusp all sat inside the pad and were only ever HIDDEN by the
 * pad painting over them; measured on unmodified main: 1,064 (perpendicular, deep endpoint) and 220
 * (oblique) filled sample points inside the pad. With the fix: 0. The same scan runs in the reverse
 * draw order too, so the answer is shown not to depend on who paints last.
 *
 * CONTROL: a point on the road just outside the face must be IN the fill, or the scan is void.
 * Also records whether an endpoint dropped inside the court was welded to the face at draw time.
 *
 * Fresh isolated browser contexts only — a session-local "Untitled site"; nothing saved or synced.
 * Usage: node ui-audit/verify-road-ends-at-court-face.mjs [--base http://127.0.0.1:4173] [--out dir]
 */
import { chromium } from "playwright";
import fs from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const BASE = opt("--base", process.env.BASE_URL || "http://localhost:4173");
const OUT = opt("--out", process.env.OUT_DIR || "ui-audit/screens/road-ends-at-court-face");
fs.mkdirSync(OUT, { recursive: true });

async function newPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.goto(BASE + "/");
  await page.getByTestId("map-toolbar-draw").click();
  await page.getByTestId("planner-canvas").waitFor({ state: "visible" });
  await page.waitForTimeout(400);
  return page;
}
async function drawPad(page, pts) {
  await page.getByRole("button", { name: "Paving", exact: true }).click();
  for (const p of pts) await page.mouse.click(p.x, p.y);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
}
async function drawRoad(page, pts) {
  await page.getByRole("button", { name: "Road", exact: true }).click();
  await page.getByRole("button", { name: "Road presets" }).click();
  await page.getByRole("button", { name: /^\d+′$/ }).last().click();
  for (const p of pts) await page.mouse.click(p.x, p.y);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}
async function deselect(page) {
  await page.keyboard.press("Escape");
  await page.mouse.click(30, 850); // empty canvas corner
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
}

async function scene(browser, label, order, roadPts, padPts, clip) {
  const page = await newPage(browser);
  if (order === "pad-then-road") { await drawPad(page, padPts); await drawRoad(page, roadPts); }
  else { await drawRoad(page, roadPts); await drawPad(page, padPts); }
  await deselect(page);
  await assertMeasurable(page, "verify-road-ends-at-court-face");
  const info = await page.evaluate(() => {
    const net = window.__plannerRoadNet ? window.__plannerRoadNet() : null;
    const surf = [...document.querySelectorAll('[data-testid="road-network-surface"]')];
    const order = [...document.querySelectorAll('[data-testid="road-network-surface"], [data-el-type], [data-el-id]')].map((n) => n.getAttribute("data-testid") || n.getAttribute("data-el-type") || n.tagName).slice(0, 12);
    /* PAINT-ORDER-INDEPENDENT ACCEPTANCE: sample the pad's interior (1.5 ft inside its edge) and
       ask the road-network surface path itself whether it fills any of those points. Whatever paints
       on top, a road's pavement must not exist inside the court. Control: a point on the road just
       outside the face MUST be in the fill, or the scan proves nothing. */
    let paveInsidePad = null;
    try {
      const store0 = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      const cur0 = store0[localStorage.getItem("planarfit:currentSite:v1")];
      const pad0 = (cur0 && cur0.els || []).find((e) => e.type === "paving");
      const view = window.__plannerView;
      if (pad0 && pad0.points && surf.length && view && view.get) {
        const v = view.get(); const f2p = (q) => ({ x: q.x * v.ppf + v.offX, y: q.y * v.ppf + v.offY });
        const xs = pad0.points.map((q) => q.x), ys = pad0.points.map((q) => q.y);
        const x0 = Math.min(...xs) + 1.5, x1 = Math.max(...xs) - 1.5, y0 = Math.min(...ys) + 1.5, y1 = Math.max(...ys) - 1.5;
        let hits = 0, n = 0;
        const svg = surf[0].ownerSVGElement;
        const pt = svg.createSVGPoint();
        for (let x = x0; x <= x1; x += 3) for (let y = y0; y <= y1; y += 3) {
          const q = f2p({ x, y }); pt.x = q.x; pt.y = q.y; n++;
          if (surf.some((s) => s.isPointInFill(pt))) hits++;
        }
        const road0 = (cur0 && cur0.els || []).find((e) => e.type === "road");
        let control = null;
        if (road0) { const a = road0.pts[0], b = road0.pts[road0.pts.length - 1]; const q = f2p({ x: a.x + (b.x - a.x) * 0.05, y: a.y + (b.y - a.y) * 0.05 }); pt.x = q.x; pt.y = q.y; control = surf.some((s) => s.isPointInFill(pt)); }
        paveInsidePad = { sampled: n, hits, controlOnRoad: control };
      }
    } catch (e) { paveInsidePad = String(e); }
    let endpoint = null;
    try {
      const store = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      const cur = store[localStorage.getItem("planarfit:currentSite:v1")];
      const road = (cur && cur.els || []).find((e) => e.type === "road");
      const pad = (cur && cur.els || []).find((e) => e.type === "paving");
      if (road && pad) {
        const xs = (pad.points || []).map((q) => q.x), ys = (pad.points || []).map((q) => q.y);
        const inside = (q) => q.x > Math.min(...xs) + 0.01 && q.x < Math.max(...xs) - 0.01 && q.y > Math.min(...ys) + 0.01 && q.y < Math.max(...ys) - 0.01;
        endpoint = { first: road.pts[0], last: road.pts[road.pts.length - 1], firstInside: inside(road.pts[0]), lastInside: inside(road.pts[road.pts.length - 1]), padX: [Math.min(...xs), Math.max(...xs)], padY: [Math.min(...ys), Math.max(...ys)] };
      }
    } catch (e) { endpoint = String(e); }
    return { regions: net && net.regions ? net.regions.length : null, drives: net && net.drives ? net.drives.length : null, surfaces: surf.length, order, endpoint, paveInsidePad };
  });
  await page.screenshot({ path: `${OUT}/${label}-${order}.png`, clip });
  await page.close();
  return info;
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  // Pad: a wide court. Road A: perpendicular, ends 60 px INSIDE the pad (his screenshot 2).
  // Road B: comes in at ~30° off perpendicular and ends 15 px inside (his screenshot 1).
  const pad = [{ x: 350, y: 250 }, { x: 1150, y: 250 }, { x: 1150, y: 420 }, { x: 350, y: 420 }];
  const roadA = [{ x: 120, y: 335 }, { x: 430, y: 335 }];
  const roadB = [{ x: 1050, y: 720 }, { x: 860, y: 405 }];
  const clipA = { x: 230, y: 200, width: 400, height: 280 };
  const clipB = { x: 700, y: 280, width: 420, height: 320 };
  const results = {};
  for (const order of ["pad-then-road", "road-then-pad"]) {
    results[`A-${order}`] = await scene(browser, "A-perp-deep", order, roadA, pad, clipA);
    results[`B-${order}`] = await scene(browser, "B-oblique", order, roadB, pad, clipB);
  }
  await browser.close();
  let failed = false;
  for (const [k, v] of Object.entries(results)) {
    const p = v.paveInsidePad;
    if (!p || typeof p === "string" || !p.sampled) { failed = true; console.log(`✗ ${k}: VOID — ${p && typeof p === "string" ? p : "nothing sampled"}`); continue; }
    if (!p.controlOnRoad) { failed = true; console.log(`✗ ${k}: VOID — the control point on the road was not in the fill`); continue; }
    const ok = p.hits === 0;
    if (!ok) failed = true;
    const ep = v.endpoint && typeof v.endpoint === "object" ? ` · endpoint on face: ${!v.endpoint.lastInside}` : "";
    console.log(`${ok ? "✓" : "✗"} ${k}: ${p.hits} of ${p.sampled} sample points inside the pad are paved by the road network${ep}`);
  }
  if (failed) { console.log("\nFAILED — road pavement inside the court (or a void scan)."); process.exit(1); }
  console.log("\nThe road ends at the court face in both draw orders.");
}
main().catch((e) => { console.error(e); process.exit(1); });
