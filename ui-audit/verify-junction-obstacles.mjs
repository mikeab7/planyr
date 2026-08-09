/* NEW-4 self-verification — the three junction defects the owner reported off his LIVE plan, plus the
 * silent corner-radius clamp behind them. Drives the REAL canvas against the REAL Tsakiris / Concept A
 * element set (ui-audit/fixtures/tsakiris-concept-a.json).
 *
 * Asserts, in order of how he reported them:
 *   1. NO junction pavement lies under ANY building footprint (his dock dog-ears). Sampled through the
 *      rendered road-network path itself with SVGGeometryElement.isPointInFill — the actual pixels, not
 *      a recomputation that could agree with a bug.
 *   2. A rect a drive tees into has its own outline INTERRUPTED across the opening (the truck-court
 *      line ruled across the mouth in his screenshot).
 *   3. Corners the app had to draw tighter than their class minimum are FLAGGED on the canvas.
 *
 * Run:  node ui-audit/verify-junction-obstacles.mjs      (needs preview on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync, readFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/road-junctions/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const fixture = JSON.parse(readFileSync(new URL("./fixtures/tsakiris-concept-a.json", import.meta.url), "utf8"));
const SITE_ID = "verify-junction-obstacles";
const site = {
  id: SITE_ID, groupId: SITE_ID, site: "Tsakiris", name: "Concept A", origin: null, county: "waller",
  parcels: [], els: fixture.els, measures: [], callouts: [], markups: [], settings: {},
  underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--ignore-certificate-errors"],
});
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
await ctx.addInitScript(`(() => { try {
  window.__PLANYR_E2E = true;
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [SITE_ID]: site })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(SITE_ID)});
} catch (e) {} })();`);
const page = await ctx.newPage();
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
   setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
   suspends requestAnimationFrame, so after a view change the app's state attributes update while the
   drawing never repaints — every box, position, hit test and screenshot then agrees with every other
   and describes a view the app already left. One precondition covers both, rAF liveness probe
   included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
await assertMeasurable(page, "verify-junction-obstacles");
const errors = [];
const NOISE = /ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION_CLOSED|ERR_CERT|Failed to load resource|net::/i;
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errors.push(m.text()); });

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(2500);
await page.waitForFunction(() => !!window.__plannerView, null, { timeout: 20000 });

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

// ---- 1. no junction pavement under a building --------------------------------------------------
const under = await page.evaluate(() => {
  const v = window.__plannerView.get();
  const f2p = (x, y) => new DOMPoint(x * v.ppf + v.offX, y * v.ppf + v.offY);
  const paths = [...document.querySelectorAll('[data-testid="road-network-surface"]')];
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const rec = Object.values(map)[0] || {};
  const out = [];
  for (const b of (rec.els || []).filter((e) => e.type === "building" && !e.points && e.w > 0 && e.h > 0)) {
    const rad = ((b.rot || 0) * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
    let hit = 0, tot = 0;
    for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) {
      const lx = -b.w / 2 + (b.w * (i + 0.5)) / 40, ly = -b.h / 2 + (b.h * (j + 0.5)) / 40;
      const wx = b.cx + (lx * c - ly * s), wy = b.cy + (lx * s + ly * c);
      tot++;
      if (paths.some((p) => { try { return p.isPointInFill(f2p(wx, wy)); } catch (e) { return false; } })) hit++;
    }
    if (hit) out.push({ id: b.id, sf: Math.round((b.w * b.h * hit) / tot) });
  }
  return out;
});
log(under.length === 0, `no road pavement under any building${under.length ? " — STILL UNDER: " + JSON.stringify(under) : ""}`);

// ---- 2. a drive target's outline is interrupted across the opening ------------------------------
const outline = await page.evaluate(() => {
  const g = [...document.querySelectorAll("svg polyline")].filter((n) => n.getAttribute("stroke") === "#9a9384");
  return { interruptedEdges: g.length, courtRect: !!document.querySelector('svg rect[stroke="none"]') };
});
log(outline.interruptedEdges >= 4, `drive target outline drawn as interrupted edges (${outline.interruptedEdges} segments)`);

// ---- 3. sub-minimum corners are flagged on the canvas -------------------------------------------
const flags = await page.evaluate(() => [...document.querySelectorAll("[data-road-radius-flag]")].map((n) => n.getAttribute("data-road-radius-flag")));
// Match by ROAD, never by `road:vertexIndex` — B1052 drops control points the owner never placed, so
// an interior vertex's index is not stable across a load and asserting on it tests the wrong thing.
const flaggedRoads = new Set(flags.map((f) => String(f).split(":")[0]));
log(flaggedRoads.has("e1454682splyoj"), `fire lane's clamped 28' corner is flagged on the plan (${JSON.stringify(flags)})`);
log(flaggedRoads.has("e54duuwgj"), "truck stub's sub-minimum corner is flagged on the plan");

// ---- shots -------------------------------------------------------------------------------------
for (const [k, x, y, ppf] of [["A-dogear-court", 735, -360, 1.6], ["B-employee-parking", -214, 442, 3.0], ["C-court-mouth", 748, -366, 3.0]]) {
  await page.evaluate(([a, b, c]) => window.__plannerView.centerOn(a, b, c), [x, y, ppf]);
  await page.waitForTimeout(500);
  await page.locator('[data-testid="planner-canvas"]').screenshot({ path: `${OUT}v4-${k}.png` });
}

if (errors.length) { console.log("\nPAGE ERRORS:\n" + errors.slice(0, 5).join("\n")); fail++; }
console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nall checks passed");
console.log(`screens → ${OUT}`);
await browser.close();
process.exit(fail ? 1 : 0);
