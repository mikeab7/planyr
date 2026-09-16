#!/usr/bin/env node
/* B1713104 — live confirmation, against the real running app, that a road tee-ing into
 * ANOTHER ROAD gets a real curb return even when the through road carries no vertex at the tee
 * point (see BACKLOG.md and test/roadRoadTeeGeometricDetection.test.js for the full diagnosis: this
 * is the class of defect the dispatch reported live as "a plain rectangle simply overlapping the
 * other road, no arcs anywhere").
 *
 * This is deliberately NOT driven through the draw tool: the connect gesture (`findRoadConnect` /
 * `planRoadConnect`) always splices a vertex into the target road at the moment of connecting, so
 * the exact condition this item fixes — a through road with NO vertex at the tee point — is not
 * reachable by drawing two fresh roads with the mouse. It IS reachable on a real, older, heavily-
 * edited plan (a road redrawn or dragged after the original connect, a migrated/imported plan, or a
 * tee that predates the connect gesture), which is exactly the class of plan the dispatch's report
 * came from. So this seeds a throwaway plan's element array directly (the same `localStorage`
 * seeding e2e/assembly-missing-sibling.spec.js already uses) with a straight two-point through road
 * and a side road ending exactly on its middle, and reads the real render pipeline's own answer via
 * `window.__plannerRoadNet()` — never a drawn plan, never one of Michael's real projects.
 *
 * Usage: node ui-audit/verify-road-road-tee-unspliced.mjs [--base http://localhost:4173]
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const baseIdx = args.indexOf("--base");
const BASE = baseIdx >= 0 ? args[baseIdx + 1] : (process.env.BASE_URL || "http://localhost:4173");
const EXEC = process.env.PW_CHROME || undefined;

const SITE_KEY = "planarfit:sites:v1";
const SITE_ID = "e2e-road-road-tee-unspliced";

function scenario(label, { throughW, sideW, sideDeg = 90 }) {
  // Straight through road, NO interior vertex — a plain two-point run.
  const through = { id: "through", type: "road", pts: [{ x: -300, y: 0 }, { x: 300, y: 0 }], vtx: [{}, {}], travelW: throughW, curb: 0.5, roadClass: "aisle", z: 1 };
  const rad = (sideDeg * Math.PI) / 180;
  const far = { x: Math.cos(rad) * 300, y: Math.sin(rad) * 300 };
  // Side road's welded end sits EXACTLY at (0,0), on the through road's line, with NO connect ever
  // having been performed (no driveTee/tee stamp, and — the point of this fixture — no spliced vertex).
  const side = { id: "side", type: "road", pts: [far, { x: 0, y: 0 }], vtx: [{}, {}], travelW: sideW, curb: 0.5, roadClass: "aisle", z: 2 };
  return { label, els: [through, side] };
}

async function runScenario(browser, { label, els }) {
  const page = await browser.newPage();
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Verify Fixture", name: label, origin: null, county: "harris",
    parcels: [], els, measures: [], callouts: [], markups: [],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([key, id, rec]) => {
    localStorage.setItem(key, JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_KEY, SITE_ID, site]);
  await page.goto(BASE + "/");
  await page.getByText("Site", { exact: true }).first().click();
  await page.getByTestId("planner-canvas").waitFor({ state: "visible", timeout: 20000 });
  await page.waitForFunction(() => !!window.__plannerRoadNet, { timeout: 20000 });
  await assertMeasurable(page, "verify-road-road-tee-unspliced");
  const net = await page.evaluate(() => window.__plannerRoadNet());
  await page.close();
  return net;
}

async function main() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const scenarios = [
    scenario("36ft side into 24ft through, perpendicular", { throughW: 24, sideW: 36, sideDeg: 90 }),
    scenario("24ft side into 36ft through, perpendicular", { throughW: 36, sideW: 24, sideDeg: 90 }),
    scenario("36ft side into 24ft through, oblique 45deg", { throughW: 24, sideW: 36, sideDeg: 45 }),
  ];
  let failed = 0;
  for (const s of scenarios) {
    const net = await runScenario(browser, s);
    const tee = net && net.tees && net.tees.find((t) => t.sideId === "side" && t.throughId === "through");
    const regionCount = net ? net.regions.length : -1;
    const ok = !!tee && tee.wedges === 2 && tee.returns.every((n) => n > 1) && regionCount === 1;
    console.log(`${ok ? "PASS" : "FAIL"} — ${s.label}: tee=${JSON.stringify(tee)} regions=${regionCount}`);
    if (!ok) failed++;
  }
  await browser.close();
  if (failed) { console.error(`\n${failed}/${scenarios.length} scenario(s) FAILED.`); process.exit(1); }
  console.log(`\nAll ${scenarios.length} scenarios PASSED.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
