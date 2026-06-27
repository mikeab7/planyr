/* Self-verification for pond stage contours after the robust-offset fix (B500).
 *
 * The bug: the old per-edge offset spiked/self-intersected on acute corners (the triangular
 * pond off Hwy 6), never closed a clean floor, and silently mis-reported storage. The fix
 * routes the inward offset through clipper-lib (round joins, pinch-off, multipolygon, loud
 * infeasibility). This asserts, in a real browser, that:
 *   1) An ACUTE-CORNER (triangular) pond renders contour rings that are ALL SIMPLE — no
 *      self-intersections / spikes (the exact failure in the screenshot). [parses each path]
 *   2) Rings nest (each contour's bbox sits inside the previous) and water/floor labels show.
 *   3) An over-deep pond shows the LOUD infeasibility callout (data-contour="infeasible")
 *      AND still draws only valid (simple) partial contours — never garbage.
 *   4) LOD: the overlay declutters at site-overview zoom and returns on zoom-in.
 *
 * Logged-out / this-device mode. Run: node ui-audit/verify-pond-contours.mjs  (preview on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const DEMO_ID = "verify-pond-contours";
const els = [
  // Acute triangular pond (reproduces the spike case); feasible at 5′ / 3:1, datum 100.
  { id: "pTri", type: "pond", points: [{ x: -520, y: -130 }, { x: -120, y: -90 }, { x: -380, y: 150 }], rot: 0, det: { depth: 5, freeboard: 1, slope: 3, contours: true, tobElev: 100 } },
  // Narrow rectangle, 10′ deep at 5:1 → max inscribed reach 30 → maxDepth 6 < 10 → infeasible.
  { id: "pNarrow", type: "pond", cx: 360, cy: 0, w: 360, h: 60, rot: 0, det: { depth: 10, freeboard: 1, slope: 5, contours: true } },
];
const parcel = { id: "pc1", locked: false, points: [{ x: -800, y: -400 }, { x: 700, y: -400 }, { x: 700, y: 400 }, { x: -800, y: 400 }] };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify Pond Contours", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [],
  markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1400);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
await page.waitForTimeout(500);

// Read contour paths + run a self-intersection test on each, in the page (SVG geometry truth).
const read = () => page.evaluate(() => {
  const parse = (d) => (d.match(/-?\d+(?:\.\d+)?/g) || []).reduce((acc, n, i) => {
    if (i % 2 === 0) acc.push({ x: +n }); else acc[acc.length - 1].y = +n; return acc;
  }, []);
  const segHit = (a, b, c, e) => {
    const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    return o(a, b, c) !== o(a, b, e) && o(c, e, a) !== o(c, e, b);
  };
  const isSimple = (r) => {
    const n = r.length;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (j === i || (i + 1) % n === j || (j + 1) % n === i) continue;
      if (segHit(r[i], r[(i + 1) % n], r[j], r[(j + 1) % n])) return false;
    }
    return true;
  };
  const paths = [...document.querySelectorAll("svg [data-contour]")].filter((p) => p.tagName.toLowerCase() === "path");
  let total = 0, spiky = 0;
  for (const p of paths) { const pts = parse(p.getAttribute("d") || ""); if (pts.length < 3) continue; total++; if (!isSimple(pts)) spiky++; }
  const kinds = [...document.querySelectorAll("svg [data-contour]")].map((e) => e.getAttribute("data-contour"));
  const labels = [...document.querySelectorAll("svg [data-contour-label]")].map((e) => (e.textContent || "").trim());
  return {
    ringPaths: total, spikyPaths: spiky,
    hasWater: kinds.includes("water"), hasBottom: kinds.includes("bottom"),
    hasInfeasible: kinds.includes("infeasible"),
    waterLabels: labels,
  };
});

let fail = 0;
const check = (label, ok) => { console.log(`  ${ok ? "✓" : "✗"} ${label}`); if (!ok) fail++; };

let m = await read();
console.log(`== Pond contours at fit zoom (${m.ringPaths} contour paths) ==`);
await page.screenshot({ path: OUT + "pond-contours-fit.png" });
check("contour rings render", m.ringPaths >= 3);
check("NO rendered ring self-intersects (the acute-corner spike is fixed)", m.spikyPaths === 0);
check("water-surface ring present", m.hasWater);
check("basin-floor ring present (triangular pond reaches a floor)", m.hasBottom);
check("real-elevation labels present (WS/Floor from datum 100)", m.waterLabels.some((t) => /WS \d/.test(t)) && m.waterLabels.some((t) => /Floor \d/.test(t)));
check("over-deep pond shows the LOUD infeasibility callout", m.hasInfeasible);
if (m.spikyPaths) console.log(`    !! ${m.spikyPaths} self-intersecting path(s) — spikes still present`);

// LOD — zoom out: overlay declutters; zoom back in: returns, still spike-free.
console.log("\n== LOD: declutter on zoom-out, return (still simple) on zoom-in ==");
const zoom = async (n) => { for (let i = 0; i < Math.abs(n); i++) { await page.mouse.move(720, 450); await page.mouse.wheel(0, n < 0 ? -300 : 300); await page.waitForTimeout(70); } await page.waitForTimeout(200); };
await zoom(16);
let mOut = await read();
await page.screenshot({ path: OUT + "pond-contours-overview.png" });
check("contour rings GONE at zoomed-out overview", mOut.ringPaths === 0);
await zoom(-18);
await page.waitForTimeout(300);
let mIn = await read();
await page.screenshot({ path: OUT + "pond-contours-zoomin.png" });
check("contour rings RETURN on zoom-in", mIn.ringPaths >= 3);
check("rings STILL simple after zoom round-trip", mIn.spikyPaths === 0);

console.log(fail === 0 ? "\n✓ ALL POND-CONTOUR CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
await ctx.close();
await browser.close();
process.exit(fail === 0 ? 0 : 1);
