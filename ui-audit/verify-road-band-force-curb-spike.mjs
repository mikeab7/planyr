#!/usr/bin/env node
/* B1752240 (2026-09-18) — live proof, on a real headless browser against a throwaway plan (never one
 * of Michael's real projects — B822), that forcing a sharp-cornered road out of its type band
 * ("Properties → Draw order → Back", i.e. `setElBand(id, "back")`) no longer makes part of its curb
 * line render far outside the road's own true pavement — the defect reported live on the owner's
 * Goose Creek Commerce Center Phase II plan.
 *
 * Root cause: SitePlanner.jsx shadowed the shared, already-fixed `roadCurbLines`
 * (lib/siteGeometry.js, B1612608 — offsetPolylineMiterLimit) with its own module-scope copy that
 * still called the raw, pre-fix `offsetPolyline` (a per-vertex bisector-and-clamp that spikes to up
 * to 3x the offset distance at a sharp turn). A road that is a member of the dissolved road network
 * never reaches that function at all — but a road forced OUT of the network (via the "Back"/"Front"
 * band override, or hidden, or bonded) does, and if it still carries a sharp-corner treatment the
 * spike paints straight through whatever sits beneath it. Fix: delete the stale duplicate, import
 * the shared one (test/roadSurfaceJoin.test.js carries the pure-function mutation-proof and a
 * source-sweep guard against the shadow returning).
 *
 * This harness drives the REAL running app end to end: seeds a single sharp-bent road (an explicit
 * per-vertex "sharp corner" treatment — the same real product feature a user reaches by right-
 * clicking a road vertex), selects it, forces it to "Back" through the real Properties panel
 * control, and reads the REAL rendered curb `<polyline>` geometry back out of the DOM — never a
 * re-implementation of the geometry math.
 *
 * Usage: node ui-audit/verify-road-band-force-curb-spike.mjs [--base http://localhost:4173]
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const baseIdx = args.indexOf("--base");
const BASE = baseIdx >= 0 ? args[baseIdx + 1] : (process.env.BASE_URL || "http://localhost:4173");
const EXEC = process.env.PW_CHROME || undefined;

// The exact fixture shape test/roadSurfaceJoin.test.js's `bentRoad`/`sharpRoadEl` use — a two-leg
// road A→P→C, 15° interior angle at P (the sharpest angle that suite sweeps), both legs 300 ft,
// travel width 36 ft (half-width 18 ft) — MEASURED (ui-audit run, see the mint session) to put the
// pre-fix spike at 47-54 ft off the true edge.
const THETA_DEG = 15, LEG_FT = 300, TRAVEL_W = 36;
const rot = (v, rad) => ({ x: v.x * Math.cos(rad) - v.y * Math.sin(rad), y: v.x * Math.sin(rad) + v.y * Math.cos(rad) });
const deflect = ((180 - THETA_DEG) * Math.PI) / 180;
const d1 = { x: 0, y: 1 }, d2 = rot(d1, deflect);
const A = { x: 0, y: 0 }, P = { x: 0, y: LEG_FT }, C = { x: P.x + d2.x * LEG_FT, y: P.y + d2.y * LEG_FT };

const ROAD_ID = "zzroad1";
const SITE_ID = "zz-band-force-curb-spike";
const site = {
  id: SITE_ID, groupId: SITE_ID, site: "ZZ band-force curb spike", name: "Plan 1",
  origin: null, county: null, parcels: [],
  els: [{ id: ROAD_ID, type: "road", pts: [A, P, C], vtx: [{}, { treatment: "sharp" }, {}], travelW: TRAVEL_W, curb: 0.5, roadClass: "aisle", z: 0 }],
  markups: [], callouts: [], measures: [], settings: { showDims: false }, updatedAt: Date.now(),
};

// Point-to-segment distance (feet), same shape as the pure test's `distToSeg`.
const distToSeg = (p, a, b) => {
  const vx = b.x - a.x, vy = b.y - a.y, wx = p.x - a.x, wy = p.y - a.y;
  const len2 = vx * vx + vy * vy;
  let t = len2 ? (wx * vx + wy * vy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
};

const results = [];
const ok = (name, pass, extra = "") => { results.push({ name, pass }); console.log(`${pass ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); };

async function main() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript(`(() => { try {
    window.__PLANYR_E2E = true;
    localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [SITE_ID]: site })}));
    localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(SITE_ID)});
  } catch (e) {} })();`);
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForTimeout(1500);
  // The dashboard shell lands on the Overview tab first — the "Site" tab is what opens the actual
  // planner canvas for the current plan (`#/project/<id>/site`).
  await page.getByText("Site", { exact: true }).first().click();
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 25000 });
  await page.waitForTimeout(1200);

  if (pageErrors.length) {
    console.log("⛔ THE FIXTURE CRASHED THE RENDER — results below would be meaningless:");
    pageErrors.slice(0, 3).forEach((e) => console.log("   " + e.slice(0, 300)));
    process.exit(1);
  }

  // Frame the view directly through the E2E view hook (`window.__plannerView.centerOn`) rather than
  // "Zoom to fit" — a road-only fixture with no cx/cy/w/h leaves the fit computation degenerate
  // (NaN), which is a fixture-framing artifact, not the defect under test.
  const centered = await page.evaluate(({ cx, cy }) => {
    if (!window.__plannerView) return false;
    window.__plannerView.centerOn(cx, cy, 1.0);
    return true;
  }, { cx: (A.x + C.x) / 2 + 40, cy: (A.y + C.y) / 2 });
  ok("the view hook is available and framed the fixture (E2E-gated)", !!centered);
  await page.waitForTimeout(400);

  await assertMeasurable(page, "verify-road-band-force-curb-spike");

  const elGroup = await page.locator(`[data-el-id="${ROAD_ID}"]`).count();
  ok("the seeded road rendered on screen", elGroup > 0, `count=${elGroup}`);

  const view = await page.evaluate(() => (window.__plannerView ? window.__plannerView.get() : null));
  ok("the view hook reports a valid (non-NaN) frame", !!view && Number.isFinite(view.ppf) && Number.isFinite(view.offX), JSON.stringify(view));

  // Select the road by clicking a point along its SECOND leg (P→C), well clear of the corner, then
  // open its Properties panel and force it to "Back" — the owner's actual gesture, per the app's own
  // Properties-panel control (relocated from the right-click menu, B845584).
  const f2p = (p) => ({ x: p.x * view.ppf + view.offX, y: p.y * view.ppf + view.offY });
  const midLegPt = { x: (P.x + C.x) / 2, y: (P.y + C.y) / 2 };
  const canvasBox = await page.getByTestId("planner-canvas").boundingBox();
  const screenPt = f2p(midLegPt);
  const clickX = canvasBox.x + screenPt.x, clickY = canvasBox.y + screenPt.y;

  await page.mouse.click(clickX, clickY, { button: "right" });
  await page.waitForTimeout(350);
  const propsRow = page.locator(".menu button", { hasText: "Properties…" }).first();
  const hasPropsRow = await propsRow.count();
  ok("right-click on the road offers Properties…", hasPropsRow > 0);
  if (hasPropsRow) await propsRow.click();
  await page.waitForTimeout(500);

  const backBtn = page.locator('[data-testid="el-band-force-back"]');
  const hasBackBtn = await backBtn.count();
  ok('the Properties panel offers the "Back" draw-order control', hasBackBtn > 0);
  if (hasBackBtn) await backBtn.click();
  await page.waitForTimeout(600);

  const forcedNote = await page.locator('[data-testid="el-band-forced-note"]').count();
  ok("the panel confirms the element is now forced out of its normal layer", forcedNote > 0);

  // Read the REAL rendered curb polyline points straight out of the DOM, convert back to world feet
  // via the SAME view the app just used to draw them, and measure how far each point strays from
  // whichever true leg it should be tracking — never a re-implementation of the offset math.
  const measurement = await page.evaluate((roadId) => {
    const g = document.querySelector(`[data-el-id="${roadId}"]`);
    if (!g) return null;
    const lines = [...g.querySelectorAll("polyline")].map((pl) =>
      (pl.getAttribute("points") || "").trim().split(/\s+/).filter(Boolean).map((pair) => {
        const [x, y] = pair.split(",").map(Number);
        return { x, y };
      }));
    return { lineCount: lines.length, lines };
  }, ROAD_ID);

  ok("the forced road still renders curb stripe line(s)", !!measurement && measurement.lineCount > 0, JSON.stringify({ lineCount: measurement?.lineCount }));

  // Re-read the view NOW — opening the Properties panel resizes the canvas area (the side panel
  // takes width), which shifts view.offX. Converting with the view captured before that would
  // measure the harness's own stale coordinate frame, not the app.
  const viewNow = await page.evaluate(() => (window.__plannerView ? window.__plannerView.get() : null));
  ok("the view hook still reports a valid frame after forcing", !!viewNow && Number.isFinite(viewNow.ppf) && Number.isFinite(viewNow.offX), JSON.stringify(viewNow));

  if (measurement && measurement.lineCount > 0 && viewNow) {
    const p2f = (p) => ({ x: (p.x - viewNow.offX) / viewNow.ppf, y: (p.y - viewNow.offY) / viewNow.ppf });
    const hw = TRAVEL_W / 2;
    let worst = 0;
    for (const line of measurement.lines) {
      for (const sp of line) {
        const fp = p2f(sp);
        const d = Math.min(distToSeg(fp, A, P), distToSeg(fp, P, C));
        if (d > worst) worst = d;
      }
    }
    ok(`no curb point strays more than ${hw + 2} ft from the road's own true edge (worst measured: ${worst.toFixed(1)} ft)`,
      worst <= hw + 2, `worst=${worst.toFixed(2)}ft, hw=${hw}ft — a pre-fix run measures 47-54 ft here`);
  }

  await page.close();
  await browser.close();

  const fails = results.filter((r) => !r.pass);
  console.log(`\n${results.length - fails.length}/${results.length} passed.`);
  if (fails.length) { console.log("FAILED:", fails.map((f) => f.name).join("; ")); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
