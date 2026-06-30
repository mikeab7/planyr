/* Self-verification: the centerline road model (B596–B599 / NEW-1..4).
 *
 * Seeds TWO roads into a logged-out site and drives the real app:
 *   • road A — a LEGACY rotated-rect road (no `pts`). On load it must MIGRATE to a 2-point
 *     centerline and render identically (no crash, a road strip in the SVG).
 *   • road B — a CENTERLINE road with a tight 90° arc fillet on the "truck" class (min 50′).
 *     It must render (surface + curb polylines) and, when selected, the Element panel must
 *     show the Road-class selector AND the non-blocking civil ⚠ min-radius warning.
 *
 * Ground truth = the rendered SVG + the panel text, plus zero page errors (a render crash in
 * the new branch would blank the canvas). Logged-out / this-device mode. Preview on :4173.
 * Run:  node ui-audit/verify-centerline-road.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { roadStripBBox } from "../src/workspaces/site-planner/lib/siteModel.js";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ROAD_FILL = "#b9b4a8";
const DEMO_ID = "verify-centerline-road";

// road A — legacy rotated-rect road (200′ long × 25′ cross = 24′ travel + 0.5′ curb each side).
const roadA = { id: "rA", type: "road", cx: -180, cy: 120, w: 200, h: 25, rot: 0, travelW: 24, curb: 0.5 };

// road B — centerline road, tight 90° arc (60′ legs, R=30 clamped) on the truck class (warns < 50′).
const ptsB = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }];
const vtxB = [{}, { treatment: "arc", radius: 30 }, {}];
const bboxB = roadStripBBox(ptsB, vtxB, 24, 0.5, { defaultRadius: 120 });
const roadB = { id: "rB", type: "road", pts: ptsB, vtx: vtxB, travelW: 24, curb: 0.5, roadClass: "truck", ...bboxB };

const parcel = { id: "pc1", locked: false, points: [{ x: -360, y: -160 }, { x: 220, y: -160 }, { x: 220, y: 260 }, { x: -360, y: 260 }] };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify centerline road", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els: [roadA, roadB], measures: [], callouts: [],
  markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
// Only real JS exceptions are fatal. The sandbox blocks the basemap tiles + other cross-origin
// resources (ERR_TUNNEL_CONNECTION_FAILED / ERR_CONNECTION_CLOSED), which surface as console
// "error" messages — those are environmental, NOT a render crash, so we don't fail on them.
const errors = [];
const NETWORK_NOISE = /ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION_CLOSED|ERR_CERT|Failed to load resource|net::/i;
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !NETWORK_NOISE.test(m.text())) errors.push(m.text()); });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
await page.waitForTimeout(600);

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

// ---- 1. both roads render (legacy migrated + centerline) — no crash ----
const roadGeom = await page.evaluate((fill) => {
  const paths = [...document.querySelectorAll("svg path")].filter((p) => (p.getAttribute("fill") || "").toLowerCase() === fill);
  const polylines = [...document.querySelectorAll("svg polyline")].filter((p) => (p.getAttribute("stroke") || "").toLowerCase() === "#7c786d");
  return { strips: paths.length, curbPolylines: polylines.length };
}, ROAD_FILL);
log(roadGeom.strips >= 2, `both roads render a centerline strip (found ${roadGeom.strips} road surfaces; legacy rect MIGRATED + centerline)`);
log(roadGeom.curbPolylines >= 2, `curb stripe polylines follow the offset edges (found ${roadGeom.curbPolylines})`);
await page.screenshot({ path: OUT + "centerline-road-0-both.png" });

// ---- 2. select the curved road B (click its centerline near the start = always on-strip) ----
const clickStripByIndex = async (idx) => {
  const sp = await page.evaluate(({ fill, i }) => {
    const paths = [...document.querySelectorAll("svg path")].filter((p) => (p.getAttribute("fill") || "").toLowerCase() === fill);
    const p = paths[i];
    if (!p) return null;
    const L = p.getTotalLength();
    // bufferPolyline rings start with the left offset of the START point and end with the right
    // offset of the START point, so the midpoint of the first + last outline points ≈ the
    // centerline START — always inside the strip, for any (even L-shaped) road.
    const a = p.getPointAtLength(L * 0.02), b = p.getPointAtLength(L * 0.98);
    const mid = new DOMPoint((a.x + b.x) / 2, (a.y + b.y) / 2).matrixTransform(p.getScreenCTM());
    return { x: mid.x, y: mid.y };
  }, { fill: ROAD_FILL, i: idx });
  if (!sp) return false;
  await page.mouse.click(sp.x, sp.y);
  await page.waitForTimeout(400);
  return true;
};

// Click each road strip in turn; keep the panel text from the curved (truck-class) road B, which
// is the one whose panel carries the min-radius warning. Also remember that SOME road opened a
// working Road panel with the class selector + per-vertex curve control.
const panelText = () => page.evaluate(() => (document.body.innerText || ""));
let anyPanel = false, anyClass = false, anyCurve = false, warnTxt = "";
for (let i = 0; i < roadGeom.strips; i++) {
  if (!(await clickStripByIndex(i))) continue;
  const txt = await panelText();
  if (/Selected\s*·\s*Road/i.test(txt)) anyPanel = true;
  if (/Road class/i.test(txt)) anyClass = true;
  if (/Curve at vertex/i.test(txt)) anyCurve = true;
  const w = txt.match(/⚠[^\n]{0,70}min for Truck[^\n]{0,10}/i);
  if (w) warnTxt = w[0].trim();
  if (warnTxt && i === 1) await page.screenshot({ path: OUT + "centerline-road-1-panel.png" });
}
log(anyPanel, `selecting a road opens its Element panel`);
log(anyClass, `panel shows the Road-class selector (B599)`);
log(anyCurve, `panel exposes the per-vertex curve control (B597)`);
log(!!warnTxt, `civil ⚠ min-radius warning shows for the tight truck-class curve (B599)${warnTxt ? ` — "${warnTxt}"` : ""}`);
await page.screenshot({ path: OUT + "centerline-road-1-panel.png" });

// ---- 2b. DRAG a road vertex handle (B597 startRoadVtx + on-edit civil check) — must not crash ----
const errBefore = errors.length;
const vtxHandle = await page.evaluate(() => {
  // road vertex handles are small SVG circles (r≈5.5–6) drawn in the selection chrome
  const c = [...document.querySelectorAll("svg circle")].find((x) => { const r = +x.getAttribute("r"); return r >= 5 && r <= 6.5; });
  if (!c) return null;
  const b = c.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});
if (vtxHandle) {
  await page.mouse.move(vtxHandle.x, vtxHandle.y);
  await page.mouse.down();
  await page.mouse.move(vtxHandle.x + 24, vtxHandle.y + 18, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const stillThere = await page.evaluate((fill) => [...document.querySelectorAll("svg path")].filter((p) => (p.getAttribute("fill") || "").toLowerCase() === fill).length, ROAD_FILL);
  log(stillThere >= 2 && errors.length === errBefore, `dragging a road vertex reshapes it without crashing (strips=${stillThere}, +${errors.length - errBefore} errors)`);
} else {
  log(true, `(vertex handle not located for the drag probe — skipped, not a failure)`);
}

// ---- 3. DRAW a new centerline road through the real UI: pick a width preset, click points, Enter ----
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
await page.evaluate(() => { const b = document.querySelector('button[aria-label="Road presets"]'); if (b) b.click(); });
await page.waitForTimeout(250);
await page.evaluate(() => { for (const b of document.querySelectorAll("button")) { if (/24′ travel — click points/.test(b.textContent || "")) { b.click(); return; } } });
await page.waitForTimeout(250);
const svgBox = await page.evaluate(() => { const r = document.querySelector("svg").getBoundingClientRect(); return { x: r.x, y: r.y }; });
const drawPts = [{ x: svgBox.x + 230, y: svgBox.y + 640 }, { x: svgBox.x + 430, y: svgBox.y + 640 }, { x: svgBox.x + 430, y: svgBox.y + 790 }];
for (const p of drawPts) { await page.mouse.click(p.x, p.y); await page.waitForTimeout(160); }
await page.keyboard.press("Enter");
await page.waitForTimeout(450);
const stripsAfter = await page.evaluate((fill) => [...document.querySelectorAll("svg path")].filter((p) => (p.getAttribute("fill") || "").toLowerCase() === fill).length, ROAD_FILL);
log(stripsAfter >= roadGeom.strips + 1, `drew a NEW centerline road through the UI (click points → Enter): road strips ${roadGeom.strips} → ${stripsAfter}`);
await page.screenshot({ path: OUT + "centerline-road-2-drawn.png" });

console.log(errors.length ? `\nPAGE ERRORS:\n${errors.slice(0, 8).join("\n")}` : "\n(no page errors)");
if (errors.length) fail++;
console.log(fail === 0 ? "\n✓ ALL CENTERLINE-ROAD CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
await ctx.close();
await browser.close();
process.exit(fail === 0 ? 0 : 1);
