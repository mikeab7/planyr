/* render-drive-cases — draw every road→parking approach case from test/helpers/driveMatrix.js in the REAL app and save a PNG
 * per case (the picture is the acceptance test; the numbers in test/driveParkingMatrix.test.js are a proxy for it).
 *
 *   node ui-audit/render-drive-cases.mjs [--base http://localhost:4173] [--out <dir>] [--only <substring>] [--rot 0]
 *
 * Seeds one plan per case through localStorage (the same seeding junction-outline-cut.spec.js uses), frames it, and
 * screenshots the canvas. FOREGROUND-OR-VOID: asserts the tab is visible and rAF is live before it measures. */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { makeField, makeRoad, makeAlongRoad, makeThroughRoad, SETTINGS } from "../test/helpers/driveMatrix.js";
import { driveJunctionsOf } from "../src/workspaces/site-planner/lib/roadJunctions.js";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("base", "http://localhost:4173");
const OUT = arg("out", "/tmp/claude-0/drive-cases");
const ONLY = arg("only", "");
const ROT = +arg("rot", "0");
const PPF = +arg("ppf", "7");   // px per foot of the close-up (0 = leave the fitted view)
mkdirSync(OUT, { recursive: true });

const AISLE_Y = SETTINGS.stallDepth + SETTINGS.aisle / 2;
export const VISUAL_CASES = [
  ["c1-aisle-end-centred", {}, [{ face: "left", along: AISLE_Y }]],
  ["c1b-aisle-end-3ft-off", {}, [{ face: "left", along: AISLE_Y + 3 }]],
  ["c2-row-side", {}, [{ face: "top", along: 100 }]],
  ["c3-oblique-aisle-45", {}, [{ face: "left", along: AISLE_Y, angle: 45 }]],
  ["c3-oblique-row-45", {}, [{ face: "top", along: 100, angle: -45 }]],
  ["c3-near-parallel-85", {}, [{ face: "top", along: 100, angle: 85 }]],
  ["c4-near-corner-row", {}, [{ face: "top", along: 10 }]],
  ["c6-inside-30", {}, [{ face: "top", along: 100, insideFt: 30 }]],
  ["c9-two-modules", { h: 120 }, [{ face: "left", along: AISLE_Y + 60 }]],
  ["c5-perimeter-drive", { h: 120 }, [{ kind: "along", face: "left" }]],
  ["c7-through", {}, [{ kind: "through", at: 100 }]],
  ["c8-two-ends", {}, [{ kind: "both" }]],
  ["c9b-single-loaded-lane-end-24", { h: 42 }, [{ face: "left", along: 30, travelW: 24 }]],
  ["c9c-single-loaded-lane-end-tilt6", { h: 42 }, [{ face: "left", along: 30, travelW: 24, angle: 6 }]],
  ["c9d-single-loaded-row-side", { h: 42 }, [{ face: "top", along: 100 }]],
];

const browser = await chromium.launch({ args: ["--ignore-certificate-errors"], ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}) });
for (const [name, fo, ros] of VISUAL_CASES) {
  if (ONLY && !name.includes(ONLY)) continue;
  const field = makeField({ ...fo, rot: ROT });
  const roads = ros.map((r, i) => (r.kind === "along" ? makeAlongRoad(field, { id: `R${i}`, ...r }) : r.kind === "through" ? makeThroughRoad(field, { id: `R${i}`, ...r }) : makeRoad(field, { id: `R${i}`, ...r })));
  if (ros[0] && ros[0].kind === "both") { roads.length = 0; roads.push(makeRoad(field, { id: "R0", face: "left", along: AISLE_Y })); }
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  const id = `render-${name}`;
  const site = { id, groupId: id, site: "Drive cases", name, origin: null, county: "harris", parcels: [], els: [field, ...roads], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
  await page.addInitScript(([i, rec]) => { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [i]: rec })); localStorage.setItem("planarfit:currentSite:v1", i); }, [id, site]);
  await page.goto(BASE + "/");
  await page.getByTestId("module-tab-site-planner").filter({ visible: true }).click().catch(() => {});
  await page.getByTestId("planner-canvas").waitFor({ timeout: 20000 }).catch(async (e) => { await page.screenshot({ path: join(OUT, "FAILED-" + name + ".png") }); throw e; });
  await assertMeasurable(page, "render-drive-cases");
  await page.getByRole("button", { name: "Zoom to fit" }).first().click(); await page.waitForTimeout(600);
  await page.waitForTimeout(1500);
  if (PPF > 0) {
    const j = driveJunctionsOf([field, ...roads], SETTINGS)[0];
    const r0 = roads[0], at = j ? j.junctionPt : (r0 ? { x: (r0.pts[0].x + r0.pts[r0.pts.length - 1].x) / 2, y: (r0.pts[0].y + r0.pts[r0.pts.length - 1].y) / 2 } : { x: field.cx || 0, y: field.cy || 0 });
    await page.evaluate(([x, y, ppf]) => window.__plannerView.centerOn(x, y, ppf), [at.x, at.y, PPF]);
    await page.waitForTimeout(1200);
  }
  if (process.env.DBG) console.log(JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => (b.getAttribute('aria-label') || b.title || b.textContent || '').slice(0, 30)).filter((t) => /fit|zoom/i.test(t)))));
  if (process.env.DBG) console.log(JSON.stringify(await page.evaluate(() => ({ net: window.__plannerRoadNet ? window.__plannerRoadNet() : "nohook", keys: Object.keys(localStorage).filter((k) => k.includes("planarfit")).slice(0, 12) }))).slice(0, 800));
  await page.screenshot({ path: join(OUT, `${name}-rot${ROT}.png`) });
  console.log("wrote", join(OUT, `${name}-rot${ROT}.png`));
  await ctx.close();
}
await browser.close();
