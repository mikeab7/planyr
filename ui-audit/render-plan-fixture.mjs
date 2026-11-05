/* render-plan-fixture — open a committed plan fixture (ui-audit/fixtures/*.json) in the REAL app and save a close-up PNG around a point.
 *   node ui-audit/render-plan-fixture.mjs --fixture tsakiris-concept-a-2026-10-29 --at -216,422 --ppf 6 --out <dir> [--snap-end <roadId>]
 * `--snap-end <roadId>` first moves that road's welded END onto the aisle centreline (what the connect gesture now does) so before/after can be compared. */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { driveJunctionsOf } from "../src/workspaces/site-planner/lib/roadJunctions.js";
import { snapToAisle } from "../src/workspaces/site-planner/lib/parkingApproach.js";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("base", "http://localhost:4173"), OUT = arg("out", "/tmp/claude-0/plan-fixture"), NAME = arg("fixture", "tsakiris-concept-a-2026-10-29");
const [ax, ay] = arg("at", "0,0").split(",").map(Number), PPF = +arg("ppf", "6"), SNAP = arg("snap-end", "");
mkdirSync(OUT, { recursive: true });
const fx = JSON.parse(readFileSync(new URL(`./fixtures/${NAME}.json`, import.meta.url), "utf8"));
let els = fx.els;
if (SNAP) {
  const j = driveJunctionsOf(els, {}).find((x) => x.sideId === SNAP);
  const tgt = els.find((e) => e.id === j.targetId), sn = snapToAisle(tgt, {}, j.junctionPt);
  if (!sn) throw new Error("no aisle to snap to");
  els = els.map((e) => (e.id === SNAP ? { ...e, pts: e.pts.map((p, i) => (i === (j.endIdx) ? { x: sn.pt.x, y: sn.pt.y } : p)) } : e));
}
const browser = await chromium.launch({ args: ["--ignore-certificate-errors"], ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}) });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
const id = `render-${NAME}`;
const site = { id, groupId: id, site: "Fixture", name: NAME, origin: null, county: "waller", parcels: [], els, measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
await page.addInitScript(([i, rec]) => { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [i]: rec })); localStorage.setItem("planarfit:currentSite:v1", i); }, [id, site]);
await page.goto(BASE + "/");
await page.getByTestId("module-tab-site-planner").filter({ visible: true }).click().catch(() => {});
await page.getByTestId("planner-canvas").waitFor({ timeout: 20000 });
await assertMeasurable(page, "render-plan-fixture");
await page.getByRole("button", { name: "Zoom to fit" }).first().click();
await page.waitForTimeout(1200);
await page.evaluate(([x, y, ppf]) => window.__plannerView.centerOn(x, y, ppf), [ax, ay, PPF]);
await page.waitForTimeout(1500);
const file = join(OUT, `${NAME}${SNAP ? "-snapped" : ""}.png`);
await page.screenshot({ path: file });
console.log("wrote", file);
await browser.close();
