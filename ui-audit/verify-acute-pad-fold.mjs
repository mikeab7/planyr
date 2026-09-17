#!/usr/bin/env node
/* B1717616 (×3) — ATTEMPT-BEFORE-YOU-PARK live check: drives the REAL, built, served app (never a
 * pure-function re-derivation) to confirm the acute-side curb-return FOLD (a single dissolved-
 * boundary vertex turning 87–108° mid-run) is gone on a road tee-ing obliquely into a real,
 * freehand-drawn polygon paving pad near its own corner — the exact shape the dispatch measured.
 *
 * Logged-out / no-cloud, per this class's own ATTEMPT-BEFORE-YOU-PARK rule (CLAUDE.md): drawing a
 * blank throwaway plan and reading its own rendered geometry needs no sign-in, so this is
 * Claude-doable here and must not be deferred as "needs a live pass" on its own — the REMAINING gap
 * (a real freehand mouse-drawn pad at Michael's own hand, on his own account) still needs a signed-in
 * pass and stays recorded as V1229136's own `Blocker: real-data`.
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

// Per-vertex signed turn (degrees) around a closed world-feet ring, paired with both adjoining
// segment lengths — the same fold-detector shape as test/roadDriveJunctionAcuteFold.test.js.
function ringTurns(ring) {
  const n = ring.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n], b = ring[i], c = ring[(i + 1) % n];
    const v1 = { x: b.x - a.x, y: b.y - a.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
    const len1 = Math.hypot(v1.x, v1.y), len2 = Math.hypot(v2.x, v2.y);
    if (!(len1 > 1e-9) || !(len2 > 1e-9)) continue;
    const turnDeg = Math.abs(Math.atan2(v1.x * v2.y - v1.y * v2.x, v1.x * v2.x + v1.y * v2.y)) * 180 / Math.PI;
    out.push({ i, turnDeg, len1, len2 });
  }
  return out;
}
const MAX_SINGLE_TURN_DEG = 40, BENIGN_CLOSING_LEG_FT = 3, JUNCTION_SCALE_FT = 60, RIGHT_ANGLE_TOL_DEG = 1;
function foldTurns(ring) {
  return ringTurns(ring).filter((t) => t.turnDeg > MAX_SINGLE_TURN_DEG
    && t.len1 > BENIGN_CLOSING_LEG_FT && t.len2 > BENIGN_CLOSING_LEG_FT
    && t.len1 < JUNCTION_SCALE_FT && t.len2 < JUNCTION_SCALE_FT
    && Math.abs(t.turnDeg - 90) > RIGHT_ANGLE_TOL_DEG);
}

async function main() {
  const browser = await chromium.launch({
    executablePath: EXEC,
    args: ["--no-sandbox", "--ignore-certificate-errors"],
  });
  const results = [];

  // A wide, shallow polygon pad (matching the dispatch's own 839×120 ft proportions in spirit), a
  // road connecting near the LEFT end of its bottom edge at a shallow (acute-producing) angle —
  // leaning toward the corner, exactly the configuration that produced the 87–108° fold pre-fix.
  for (const label of ["lean-left-shallow", "lean-right-shallow"]) {
    const page = await newPage(browser);
    const box = await page.getByTestId("planner-canvas").boundingBox();
    const A = { x: box.x + 150, y: box.y + 350 }, B = { x: box.x + 650, y: box.y + 350 };
    const C = { x: box.x + 650, y: box.y + 420 }, D = { x: box.x + 150, y: box.y + 420 };
    await drawPolygonPad(page, [A, B, C, D], "Paving");
    // Connect point near the LEFT corner of the bottom edge (A–B), well inside it.
    const P = { x: A.x + 60, y: A.y };
    // A shallow angle off vertical (perpendicular), leaning toward the near corner one way or the
    // other — this is what makes ONE side of the junction acute.
    const lean = label === "lean-left-shallow" ? -1 : 1;
    const dxScreen = lean * 90, dyScreen = 220; // ~22° off perpendicular in screen space
    const far = { x: P.x + dxScreen, y: P.y + dyScreen };
    await drawRoad(page, far, P);
    await assertMeasurable(page, "verify-acute-pad-fold");
    const net = await page.evaluate(() => (window.__plannerRoadNet ? window.__plannerRoadNet() : null));
    if (!net || !net.regions || !net.regions.length) {
      results.push({ label, error: "no dissolved region registered — connect never fired" });
      await page.close();
      continue;
    }
    const folds = net.regions.flatMap((r) => foldTurns(r.outer));
    results.push({ label, folds, outerPts: net.regions[0].outer.length });
    await page.close();
  }

  await browser.close();

  let failed = false;
  for (const r of results) {
    if (r.error) { failed = true; console.log(`✗ ${r.label}: ${r.error}`); continue; }
    const ok = r.folds.length === 0;
    if (!ok) failed = true;
    console.log(`${ok ? "✓" : "✗"} ${r.label}: outline pts=${r.outerPts}, folds=${JSON.stringify(r.folds.map((f) => ({ turnDeg: +f.turnDeg.toFixed(1), len1: +f.len1.toFixed(2), len2: +f.len2.toFixed(2) })))}`);
  }
  if (failed) { console.log("\nFAILED — at least one junction still shows a fold (a single vertex turning sharply between two substantial legs)."); process.exit(1); }
  console.log("\nNo folds on either acute-side junction — real rendered geometry confirms the fix.");
}

main().catch((e) => { console.error(e); process.exit(1); });
