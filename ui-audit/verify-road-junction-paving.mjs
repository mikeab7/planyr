#!/usr/bin/env node
/* NEW-4 — the acceptance test the dispatch asked be built BEFORE any geometry fix: flood-fill of
 * (pad ∪ every dissolved road surface), over a real, driven throwaway plan, with a mandatory
 * self-test control. Two prior rounds (B1645792, its ×2 amendment) shipped green test suites while
 * the deployed build stayed broken because the existing pure-JS check (`throatNotchCells` in
 * test/roadDriveJunctionFillet.test.js, now replaced) scanned only 12 ft around the tee point with a
 * one-step "are 3 of my 4 neighbours paved" heuristic — not a real flood fill, and blind to a notch
 * that reaches 30+ ft along the pad edge.
 *
 * THIS is the "against the geometry the RENDERER produces" half: it drives the real app (a fresh
 * throwaway plan — nothing here ever touches one of Michael's real projects), draws a real pad and a
 * real road with the real tools, and reads `window.__plannerRoadNet()` — the exact `{ outer, holes }`
 * region data the SVG `<path d>` is built from (`roadNetwork.regionPathD`), plus (NEW-4) the real
 * drive target's own paved ring. A flood fill over that data is equivalent in substance to the
 * dispatch's own "isPointInFill + inverted getScreenCTM" method — both ask "does the shape the
 * renderer actually computed cover this point" — but reads world-feet polygons directly rather than
 * SVG path strings, which is immune to screen-pixel rounding and zoom level.
 *
 * Usage: node ui-audit/verify-road-junction-paving.mjs [--base http://localhost:5183]
 * Exits non-zero (and prints which scenario failed) if any enclosed unpaved area is found, or if a
 * scenario's own self-test control fails to prove the scan can see a hole at all.
 */
import { chromium } from "playwright";
import { floodFillEnclosed, pavedPredicate, assertMeasurableFloodFill, enclosedAreaSqFt } from "./lib/paveFloodFill.mjs";
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

async function drawRectPad(page, box, kind) {
  await page.getByRole("button", { name: kind, exact: true }).click();
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.w * 0.4, box.y + box.h * 0.4, { steps: 5 });
  await page.mouse.move(box.x + box.w, box.y + box.h, { steps: 8 });
  await page.mouse.up();
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

// Run the flood-fill + self-test over one drive junction's real rendered geometry.
function scoreJunction(net, label) {
  if (!net || !net.drives.length) return { label, error: "no drive junction registered — connect never fired" };
  const pad = net.pads[0];
  if (!pad) return { label, error: "no pad ring exposed by the hook" };
  const isPaved = pavedPredicate([pad.ring], net.regions);
  // Centroid-ish anchor for the scan box + self-test disc: the pad ring's own bbox centre.
  const xs = pad.ring.map((p) => p.x), ys = pad.ring.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const half = Math.max(100, (Math.max(...xs) - Math.min(...xs)) * 0.7, (Math.max(...ys) - Math.min(...ys)) * 0.7);
  const bbox = { x0: cx - half, y0: cy - half, x1: cx + half, y1: cy + half };
  const step = 0.5;
  try {
    const { real } = assertMeasurableFloodFill(isPaved, bbox, step, { x: cx, y: cy }, 3, label);
    return { label, enclosedSqFt: enclosedAreaSqFt(real), regionOuterPts: net.regions[0] ? net.regions[0].outer.length : 0 };
  } catch (e) {
    return { label, error: e.message };
  }
}

async function main() {
  const browser = await chromium.launch({
    executablePath: EXEC,
    args: ["--no-sandbox", "--ignore-certificate-errors"],
  });
  const results = [];

  // Scenario 1 — NEW-1: oblique road into a rectangular truck-court pad.
  {
    const page = await newPage(browser);
    const box = await page.getByTestId("planner-canvas").boundingBox();
    await drawRectPad(page, { x: box.x + 300, y: box.y + 450, w: 300, h: 200 }, "Paving");
    const padTopMid = { x: box.x + 450, y: box.y + 450 };
    await drawRoad(page, { x: padTopMid.x - 220, y: padTopMid.y - 260 }, { x: padTopMid.x, y: padTopMid.y });
    await assertMeasurable(page, "verify-road-junction-paving");
    const net = await page.evaluate(() => (window.__plannerRoadNet ? window.__plannerRoadNet() : null));
    results.push(scoreJunction(net, "NEW-1 oblique truck-court"));
    await page.close();
  }
  // Scenario 2 — NEW-2: EXACTLY perpendicular road into a rect parking field's bottom edge.
  {
    const page = await newPage(browser);
    const box = await page.getByTestId("planner-canvas").boundingBox();
    await drawRectPad(page, { x: box.x + 300, y: box.y + 450, w: 300, h: 200 }, "Parking");
    const mid = { x: box.x + 450, y: box.y + 450 };
    await drawRoad(page, { x: mid.x, y: mid.y - 260 }, { x: mid.x, y: mid.y });
    await assertMeasurable(page, "verify-road-junction-paving");
    const net = await page.evaluate(() => (window.__plannerRoadNet ? window.__plannerRoadNet() : null));
    results.push(scoreJunction(net, "NEW-2 perpendicular regression"));
    await page.close();
  }
  // Scenario 3 — NEW-3: free-drawn (click-to-place-vertex) polygon parking field.
  {
    const page = await newPage(browser);
    const box = await page.getByTestId("planner-canvas").boundingBox();
    const A = { x: box.x + 250, y: box.y + 300 }, B = { x: box.x + 550, y: box.y + 300 };
    const C = { x: box.x + 550, y: box.y + 550 }, D = { x: box.x + 250, y: box.y + 550 };
    await drawPolygonPad(page, [A, B, C, D], "Parking");
    const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    await drawRoad(page, { x: mid.x - 60, y: mid.y - 150 }, mid);
    await assertMeasurable(page, "verify-road-junction-paving");
    const net = await page.evaluate(() => (window.__plannerRoadNet ? window.__plannerRoadNet() : null));
    results.push(scoreJunction(net, "NEW-3 free-drawn polygon field"));
    await page.close();
  }

  await browser.close();

  let failed = false;
  for (const r of results) {
    if (r.error) { failed = true; console.log(`✗ ${r.label}: ${r.error}`); continue; }
    const ok = r.enclosedSqFt === 0;
    if (!ok) failed = true;
    console.log(`${ok ? "✓" : "✗"} ${r.label}: enclosed unpaved area = ${r.enclosedSqFt.toFixed(1)} sq ft (region has ${r.regionOuterPts} outline points)`);
  }
  if (failed) { console.log("\nFAILED — at least one junction leaves an enclosed unpaved gap (or the scan itself is untrustworthy)."); process.exit(1); }
  console.log("\nAll junctions fully paved — zero enclosed cells, self-test confirmed the scan can see a hole.");
}

main().catch((e) => { console.error(e); process.exit(1); });
