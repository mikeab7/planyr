/* NEW-1 (2026-09-28) — before/after screenshots + DOM-order check for the B1788912 regression where a
 * dissolved road cluster's plain fill buried its member roads' cross-section decoration.
 * Logged-out, throwaway seeded plan. Run against a served build:
 *   BASE_URL=http://localhost:4173/ node ui-audit/verify-road-xsection-paint-order.mjs [label]
 * Shots land in ui-audit/screens/road-xsection-paint-order/<label>-zoom<N>.png at three wheel-zoom steps. */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const { chromium } = pw;
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const LABEL = process.argv[2] || "run";
const OUT = new URL("./screens/road-xsection-paint-order/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BANDS = [{ type: "travel", w: 12 }, { type: "travel", w: 12 }, { type: "median", w: 20 }, { type: "travel", w: 12 }, { type: "travel", w: 12 }];
const road = { id: "dsg", type: "road", z: 5, pts: [{ x: -300, y: 0 }, { x: 300, y: 0 }], vtx: [{}, {}], travelW: 68, curb: 0.5, roadClass: "local", cx: 0, cy: 0, w: 600, h: 80, rot: 0, xsection: { bands: BANDS, rowDesignFt: 100 } };
const ID = "verify-xsec-paint-order";
const site = { id: ID, groupId: ID, site: "xsec paint order", name: "Plan 1", origin: null, county: null,
  parcels: [{ id: "pc1", locked: false, points: [{ x: -700, y: -300 }, { x: 700, y: -300 }, { x: 700, y: 900 }, { x: -700, y: 900 }] }],
  els: [road], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
await ctx.addInitScript(([id, s]) => { try { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: s })); localStorage.setItem("planarfit:currentSite:v1", id); } catch (e) { /* */ } }, [ID, site]);
const page = await ctx.newPage();
await assertMeasurable(page, "verify-road-xsection-paint-order");
await page.goto(BASE, { waitUntil: "load" });
await page.getByTestId("module-tab-site-planner").filter({ visible: true }).click({ timeout: 8000 }).catch(() => {});
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 20000 });
await page.waitForTimeout(800);
const box = await page.getByTestId("planner-canvas").boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.mouse.move(cx, cy);
let fail = 0;
for (let z = 0; z < 3; z++) {
  const r = await page.evaluate(() => {
    const all = [...document.querySelectorAll('[data-testid="planner-canvas"] *')];
    const surf = document.querySelector('[data-testid="road-network-surface"]');
    const deco = document.querySelector('[data-road-deco="dsg"]') || document.querySelector('[data-el-id="dsg"]');
    return { after: all.indexOf(deco) > all.indexOf(surf), fills: deco.querySelectorAll("polygon").length,
      marks: [...deco.querySelectorAll("polyline")].filter((p) => p.getAttribute("stroke") === "#f2f2f2").length };
  });
  console.log(`zoom step ${z}: decoration above fill=${r.after} bandFills=${r.fills} laneMarks=${r.marks}`);
  if (!r.after) fail++;
  const sb = await page.evaluate(() => { const b = document.querySelector('[data-testid="road-network-surface"]').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  const ppf = await page.getByTestId("planner-canvas").getAttribute("data-render-ppf");
  console.log(`  ppf=${ppf} road box=${JSON.stringify(sb)}`);
  const clip = { x: Math.max(0, Math.min(box.x + box.width - 500, sb.x + sb.w / 2 - 250)), y: Math.max(0, sb.y + sb.h / 2 - 100), width: 500, height: 200 };
  await page.screenshot({ path: `${OUT}${LABEL}-zoom${z}.png`, clip });
  await page.mouse.move(sb.x + sb.w / 2, sb.y + sb.h / 2);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(60); }
  await page.waitForTimeout(500);
}
// PDF-PARITY — the REAL built sheet (window.__plannerExportSvg), not the clone argued from the live DOM.
const exp = await page.evaluate(async () => {
  const html = window.__plannerExportSvg ? await window.__plannerExportSvg() : null;
  if (!html) return null;
  const surf = html.indexOf('data-export="road-network"');
  const deco = html.indexOf('data-road-deco="dsg"');
  return { surf, deco, marks: (html.slice(deco).match(/#f2f2f2/g) || []).length };
});
console.log("export sheet:", JSON.stringify(exp));
if (!exp || exp.surf < 0 || exp.deco < exp.surf || exp.marks < 1) { console.log("❌ PDF-PARITY: decoration missing or under the fill on the exported sheet"); fail++; }
else console.log("✅ PDF-PARITY: decoration follows the road-network fill on the exported sheet");
await browser.close();
process.exit(fail ? 1 : 0);
