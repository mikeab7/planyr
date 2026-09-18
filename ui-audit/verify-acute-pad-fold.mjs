#!/usr/bin/env node
/* B<NEW-1> — ATTEMPT-BEFORE-YOU-PARK live check: drives the REAL, built, served app (never a
 * pure-function re-derivation) to confirm that an oblique road tee-ing into a real, drawn polygon
 * paving pad keeps a COMPLETE acute-side curb return.
 *
 * ⛔ WHAT CHANGED HERE AND WHY, because the previous version of this file PASSED on a build whose
 * returns were destroyed. It looked for a "fold" — a single boundary vertex turning more than 40 deg
 * between two substantial legs — and it carried an explicit exemption for turns within 1 deg of a
 * right angle ("a construction perpendicular by definition"). PR #1755 then shipped a build whose
 * acute-side return covered 0.008-0.041 deg of a required 116-125 deg — i.e. no return at all — and
 * left an exactly 89.95 deg corner where the arc used to be. That corner walked straight through the
 * right-angle exemption, so this harness reported "0 folds on either lean" on a build that had
 * deleted the feature it was built to protect. An ABSENCE check cannot be the guard for a thing that
 * fails by being absent.
 *
 * SO IT NOW MEASURES PRESENCE. For every curb return the app actually built, compare the finished
 * pavement edge against the fillet's own promise: a complete return of radius R across a wedge angle
 * phi stands exactly `R/sin(phi/2) - R` off its own corner, and a return that has been eaten leaves
 * the boundary running through the corner itself. On the shipped build (9962818) the median of that
 * ratio over a 7,200-case sweep was 0.001; with the fix it is 1.001.
 *
 * ⛔ AND IT PAINTS IN TWO STAGES, AS THE APP DOES. `roadNet` dissolves the road strips and curb-return
 * wedges ON THEIR OWN and paints that; the pad is a separate element painted OVER it (Z_LAYER 1
 * against the road network's 0). Re-unioning strips, wedges and pad in ONE pass is a different
 * computation that HIDES this defect completely — the pad fills the return's tangential cusp, so the
 * ring cleanup never cascades and every build looks clean. Measured: the one-pass form scored the
 * shipped build and the fixed build identically.
 *
 * Logged-out / no-cloud, per ATTEMPT-BEFORE-YOU-PARK (CLAUDE.md): drawing a blank throwaway plan and
 * reading its own rendered geometry needs no sign-in, so this is Claude-doable here and must not be
 * deferred. The REMAINING gap (a real freehand mouse-drawn pad on Michael's own account) still needs
 * a signed-in pass and stays recorded as this item's own `V` entry.
 *
 * DO NOT REPAIR HIS DATA: every page here is a fresh, isolated browser context (chromium.launch), so
 * nothing reachable is one of Michael's real projects — this sandbox cannot reach signed-in cloud
 * data at all. "Draw" adopts a session-local empty "Untitled site"; nothing is saved or synced.
 *
 * Usage: node ui-audit/verify-acute-pad-fold.mjs [--base http://localhost:4173]
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const baseIdx = args.indexOf("--base");
const BASE = baseIdx >= 0 ? args[baseIdx + 1] : (process.env.BASE_URL || "http://localhost:4173");
const EXEC = process.env.PW_CHROME || undefined;

/* THE BAR — chosen from two measured populations three orders of magnitude apart (0.001 against
 * 1.001), so where the line falls between them barely matters; 0.85 leaves room for clipper's
 * centi-foot grid and the dissolve's morphological close and still cannot be cleared by a
 * destroyed return. */
const DEPTH_RATIO_BAR = 0.85;

async function newPage(browser) {
  const page = await browser.newPage();
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.goto(BASE + "/");
  await page.getByTestId("map-toolbar-draw").click();
  await page.getByTestId("planner-canvas").waitFor({ state: "visible" });
  return page;
}

async function drawPolygonPad(page, pts, kind) {
  await page.getByRole("button", { name: kind, exact: true }).click();
  for (const p of pts) await page.mouse.click(p.x, p.y);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
}

async function drawRoad(page, from, to) {
  await page.getByRole("button", { name: "Road", exact: true }).click();
  await page.getByRole("button", { name: "Road presets" }).click();
  await page.getByRole("button", { name: /^\d+′$/ }).last().click();
  await page.mouse.click(from.x, from.y);
  await page.mouse.click(to.x, to.y);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
}

const hyp = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function segDist(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy;
  if (!(L > 1e-12)) return hyp(p, a);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / L;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}

/* The fillet's own promise for one corner, read off the app's own geometry. */
function filletPromise(corner, tanThrough, tanSide, arc) {
  if (!arc || arc.length < 5) return null;
  const v1 = { x: tanThrough.x - corner.x, y: tanThrough.y - corner.y };
  const v2 = { x: tanSide.x - corner.x, y: tanSide.y - corner.y };
  const n1 = Math.hypot(v1.x, v1.y), n2 = Math.hypot(v2.x, v2.y);
  if (!(n1 > 1e-9) || !(n2 > 1e-9)) return null;
  const phi = Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (n1 * n2)))) * 180 / Math.PI;
  const A = arc[0], B = arc[Math.floor(arc.length / 2)], C = arc[arc.length - 1];
  const den = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y));
  if (Math.abs(den) < 1e-9) return null;
  const ux = ((A.x * A.x + A.y * A.y) * (B.y - C.y) + (B.x * B.x + B.y * B.y) * (C.y - A.y) + (C.x * C.x + C.y * C.y) * (A.y - B.y)) / den;
  const uy = ((A.x * A.x + A.y * A.y) * (C.x - B.x) + (B.x * B.x + B.y * B.y) * (A.x - C.x) + (C.x * C.x + C.y * C.y) * (B.x - A.x)) / den;
  const R = Math.hypot(A.x - ux, A.y - uy);
  return { corner, phi, R, expect: R / Math.sin((phi * Math.PI) / 360) - R };
}

async function main() {
  const browser = await chromium.launch({
    executablePath: EXEC,
    args: ["--no-sandbox", "--ignore-certificate-errors"],
  });
  const { dissolveRings } = await import("../src/workspaces/site-planner/lib/roadNetwork.js");
  const results = [];

  // A wide, shallow polygon pad (matching the dispatch's own 839x120 ft proportions in spirit), a
  // road connecting near the LEFT end of its bottom edge at a shallow (acute-producing) angle —
  // leaning toward the corner one way or the other, which is what makes ONE side of the junction
  // acute. This is the configuration the dispatch measured the fold on.
  for (const label of ["lean-left-shallow", "lean-right-shallow"]) {
    const page = await newPage(browser);
    const box = await page.getByTestId("planner-canvas").boundingBox();
    const A = { x: box.x + 150, y: box.y + 250 }, B = { x: box.x + 650, y: box.y + 250 };
    const C = { x: box.x + 650, y: box.y + 330 }, D = { x: box.x + 150, y: box.y + 330 };
    await drawPolygonPad(page, [A, B, C, D], "Paving");
    // ⛔ THE ROAD MUST STOP AT THE PAD'S NEAR EDGE, NOT RUN THROUGH THE PAD. The version of this
    // harness that shipped with PR #1755 ended the road on the pad's FAR edge, so it crossed the
    // whole pad and the junction resolved at the near face with the strip continuing out the other
    // side — a different configuration from the one reported, and one whose finished boundary cannot
    // be read at the corner at all (measured: 0.00 ft off the corner on the obtuse side, on a build
    // whose returns are correct). WRONG-CASE: the fixture has to be the scene that was reported.
    const P = { x: D.x + 60, y: D.y };                  // on the pad's BOTTOM edge
    const lean = label === "lean-left-shallow" ? -1 : 1;
    const far = { x: P.x + lean * 90, y: P.y + 220 };   // ~22 deg off perpendicular, coming from below
    await drawRoad(page, far, P);
    await assertMeasurable(page, "verify-acute-pad-fold");
    const net = await page.evaluate(() => (window.__plannerRoadNet ? window.__plannerRoadNet() : null));
    await page.close();
    if (!net || !net.regions || !net.regions.length) {
      results.push({ label, error: "no dissolved region registered — the road/pad connect never fired" });
      continue;
    }
    if (!net.drives || !net.drives.length) {
      results.push({ label, error: "no drive junction registered — nothing to measure" });
      continue;
    }
    // Paint in two stages, exactly as the app does: the road network's own dissolved regions, then
    // the pad unioned onto that result.
    const padRing = (net.pads && net.pads[0] && net.pads[0].ring) || null;
    if (!padRing) { results.push({ label, error: "the pad's own ring was not registered" }); continue; }
    const visible = dissolveRings([padRing, ...net.regions.map((r) => r.outer)]);
    if (visible.length !== 1) { results.push({ label, error: `pavement dissolved to ${visible.length} regions, expected one` }); continue; }
    const outer = visible[0].outer;

    const returns = [];
    for (const d of net.drives) {
      for (let k = 0; k < 2; k++) {
        const f = filletPromise(d.corners[k], d.throughTangents[k], d.sideTangents[k], d.returns[k]);
        if (!f || !(f.R >= 5) || !(f.expect > 0.5)) continue;   // a corner the reach clamp legitimately left sharp
        let got = Infinity;
        for (let i = 0; i < outer.length; i++) got = Math.min(got, segDist(f.corner, outer[i], outer[(i + 1) % outer.length]));
        returns.push({ k, phi: f.phi, R: f.R, expect: f.expect, got, ratio: got / f.expect });
      }
    }
    results.push({ label, returns, outerPts: outer.length });
  }

  await browser.close();

  let failed = false;
  for (const r of results) {
    if (r.error) { failed = true; console.log(`✗ ${r.label}: ${r.error}`); continue; }
    // VACUITY GUARD — a run that found no real return proves nothing and must say so, not score.
    if (!r.returns.length) { failed = true; console.log(`✗ ${r.label}: VOID — no real curb return was built, so nothing was measured`); continue; }
    for (const t of r.returns) {
      const ok = t.ratio > DEPTH_RATIO_BAR;
      if (!ok) failed = true;
      console.log(`${ok ? "✓" : "✗"} ${r.label} corner ${t.k}: wedge ${t.phi.toFixed(1)}°, R ${t.R.toFixed(2)} ft — boundary stands ${t.got.toFixed(2)} ft off the corner, a complete return needs ${t.expect.toFixed(2)} ft (${(t.ratio * 100).toFixed(0)}%)`);
    }
  }
  if (failed) { console.log("\nFAILED — at least one curb return is missing or shallow on the real rendered geometry."); process.exit(1); }
  console.log("\nEvery curb return reaches its full depth on both leans — real rendered geometry confirms the fix.");
}

main().catch((e) => { console.error(e); process.exit(1); });
