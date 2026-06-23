/* Edge-case stress test for the edge-run setback work (B213/B214/B215) on IRREGULAR
 * parcels: concave L-shapes, flag lots, curved frontage, dense survey boundaries, a
 * triangle. Logged-out, drives the built app. For each parcel it selects the parcel,
 * reads the on-canvas setback pills + run-length dims, and checks:
 *   • no NaN positions;
 *   • every setback pill lands on the INTERIOR side of its edge (the point-in-ring
 *     inward fix — the old "toward centroid" logic threw pills outside on concave lots);
 *   • the run-length dim lands on the EXTERIOR side (fanned, never stacked);
 *   • the run count is sane (logged for the curve-clutter assessment).
 * Saves a screenshot per shape for eyeball review.
 *
 * Run:  npm run build && npx vite preview --port 4176   (separate shell)
 *       BASE_URL=http://localhost:4176/ node ui-audit/verify-edge-runs-irregular.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4176/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const now = Date.now();

// Gentle arc of `n` segments spanning `sweepDeg`, radius r, centered (cx,cy), from a0.
function arc(cx, cy, r, a0Deg, sweepDeg, n) {
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const a = ((a0Deg + (sweepDeg * k) / n) * Math.PI) / 180;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

const SHAPES = {
  // Concave L — centroid sits in the notch (outside the polygon), the classic failure.
  Lshape: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 200 }, { x: 200, y: 200 }, { x: 200, y: 600 }, { x: 0, y: 600 }],
  // Flag lot — a narrow access pole into a wide rear flag (deeply concave, thin pole).
  flagLot: [{ x: 170, y: 0 }, { x: 230, y: 0 }, { x: 230, y: 300 }, { x: 430, y: 300 }, { x: 430, y: 560 }, { x: 0, y: 560 }, { x: 0, y: 300 }, { x: 170, y: 300 }],
  // Tight curved frontage — straight bottom/sides, top edge is a 10-segment tight arc
  // (~15°/segment → genuinely curved, stays per-segment under any grouping).
  curvedFront: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, ...arc(300, 300, 360, 11.3, 157.4, 10).slice(1, -1), { x: 0, y: 300 }],
  // Gentle curved frontage — top is a 16-segment SHALLOW arc (~1.6°/segment, a 50 ft
  // bulge over a 900 ft frontage) that should GROUP into one logical side, not 16 pills.
  gentleCurve: [{ x: 0, y: 0 }, { x: 900, y: 0 }, ...arc(450, 2200, 2050, -77.3, -25.4, 16)],
  // Dense irregular survey boundary — mixed straight runs + slight bends + a short jog.
  dense: [{ x: 0, y: 0 }, { x: 200, y: 8 }, { x: 400, y: 0 }, { x: 600, y: 12 }, { x: 760, y: 0 },
          { x: 760, y: 180 }, { x: 770, y: 360 }, { x: 760, y: 520 },
          { x: 500, y: 520 }, { x: 480, y: 460 }, { x: 300, y: 520 }, { x: 0, y: 520 }],
  triangle: [{ x: 0, y: 0 }, { x: 700, y: 0 }, { x: 350, y: 520 }],
};

const sites = {};
Object.entries(SHAPES).forEach(([k, points], i) => {
  sites[k] = { id: k, groupId: k, site: k, name: "Plan 1", origin: { lat: 29.78 + i * 0.02, lon: -95.83 },
    county: "harris", parcels: [{ id: "p", points }], els: [], measures: [], callouts: [], markups: [],
    settings: { showSetback: true, setback: 25 }, underlay: null, status: "active", updatedAt: now - i * 1000 };
});
const seed = `(()=>{try{localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify(sites)}));localStorage.removeItem('planarfit:currentSite:v1');}catch(e){}})();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const results = [];
const ok = (n, pass, d = "") => { results.push({ n, pass }); console.log(`  ${pass ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);

for (const name of Object.keys(SHAPES)) {
  // Open the shape's project from the breadcrumb.
  await page.locator('button[title="Choose a project"]:visible, button[title="Switch project"]:visible').first().click();
  await page.waitForTimeout(350);
  await page.locator(`button:has-text("${name}")`).first().click();
  await page.waitForTimeout(1200);
  await page.locator('button[title="Zoom to fit"]').click().catch(() => {});
  await page.waitForTimeout(700);

  // Select the parcel by clicking the midpoint of its first edge (always on the stroke).
  // B417: the parcel's grab target moved to a fat boundary hit-stroke, so the visible polygon is
  // now pointer-events:none — locate it by its parcel/selection stroke colour instead.
  const poly = await page.evaluate(() => {
    const p = document.querySelector('polygon[stroke="#5b6650" i], polygon[stroke="#c2410c" i]');
    return p ? p.getAttribute("points") : null;
  });
  if (!poly) { ok(`${name}: parcel rendered`, false); continue; }
  const verts = poly.trim().split(/\s+/).map((s) => { const [x, y] = s.split(",").map(Number); return { x, y }; });
  const pillCount = () => page.evaluate(() => document.querySelectorAll('rect[stroke="#b45309"]').length);
  // Select by clicking edge midpoints (each lies on the clickable stroke) until pills
  // appear — robust when the first edge sits under the header after fit, and avoids the
  // draggable acreage chip at the centroid.
  for (let e = 0; e < verts.length && (await pillCount()) === 0; e++) {
    const a = verts[e], b = verts[(e + 1) % verts.length];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (mid.y < 70) continue; // under the header — skip
    await page.mouse.click(mid.x, mid.y);
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: OUT + `irregular-${name}.png` });

  const data = await page.evaluate(() => {
    const polyEl = document.querySelector('polygon[stroke="#5b6650" i], polygon[stroke="#c2410c" i]'); // B417: parcel polygon by stroke colour (was pointer-events="all")
    const ring = polyEl.getAttribute("points").trim().split(/\s+/).map((s) => { const [x, y] = s.split(",").map(Number); return { x, y }; });
    const inPoly = (pt) => { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y; if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi)) inside = !inside; } return inside; };
    const pills = [...document.querySelectorAll('rect[stroke="#b45309"]')].map((r) => ({ x: +r.getAttribute("x") + 13, y: +r.getAttribute("y") + 9 }));
    const dims = [...document.querySelectorAll("text")].filter((t) => /^\d+′$/.test((t.textContent || "").trim()) && (t.getAttribute("fill") || "").toLowerCase() !== "#b45309").map((t) => ({ x: +t.getAttribute("x"), y: +t.getAttribute("y") }));
    const nan = [...pills, ...dims].some((p) => !isFinite(p.x) || !isFinite(p.y));
    return { runs: pills.length, dimCount: dims.length, pillsInside: pills.filter(inPoly).length, dimsOutside: dims.filter((d) => !inPoly(d)).length, nan };
  });
  console.log(`  · ${name}: ${data.runs} runs/pills, ${data.dimCount} dims`);
  ok(`${name}: no NaN positions`, !data.nan);
  ok(`${name}: setback pills on the INTERIOR side (${data.pillsInside}/${data.runs})`, data.runs > 0 && data.pillsInside === data.runs, `${data.pillsInside}/${data.runs} inside`);
  ok(`${name}: run-length dims on the EXTERIOR side (${data.dimsOutside}/${data.dimCount})`, data.dimCount > 0 && data.dimsOutside >= Math.ceil(data.dimCount * 0.8), `${data.dimsOutside}/${data.dimCount} outside`);
  if (name === "gentleCurve") ok(`gentleCurve: the shallow arc GROUPS into few sides (not one pill per segment)`, data.runs <= 6, `${data.runs} runs for ~19 edges`);
}

await ctx.close();
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log("FAILED:", failed.map((f) => f.n).join("; ")); process.exit(1); }
console.log("ALL PASS");
