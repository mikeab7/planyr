/* NEW-1 + NEW-5 headless gate — does the drawing stay welded to the basemap across a long
 * out-and-back pan, and does viewport culling leave the drawing (and the export) intact?
 *
 * This is the sandbox-runnable half of the live measurement. External tile hosts are
 * egress-blocked here so no aerial IMAGE ever paints — but the Leaflet map object itself is
 * fully live, and the lock is a property of its centre/zoom versus the SVG transform, not of
 * whether pixels arrived. So we can measure the exact thing the live session measured:
 *
 *   • drive a long north pan and back, then compare the basemap's centre + zoom, and the
 *     drawn geometry's own screen coordinates, against where they started. Before the fix
 *     the map came back short (measured live: -4.3 ft per ~89,000 ft excursion, cumulative,
 *     and the zoom didn't fully restore either: 13.5678 → 13.5652 → 13.5677).
 *   • confirm culling never blanks the drawing, and that what it hides comes back.
 *
 * Run: node ui-audit/diagnose-map-lock.mjs   (vite preview must be on :4173)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// A wide plan — elements spread far enough that a pan genuinely takes some off screen.
const els = [];
for (let i = 0; i < 60; i++) {
  els.push({ id: `e${i}`, type: "building", cx: (i % 10) * 900 - 4000, cy: Math.floor(i / 10) * 700 - 2000, w: 420, h: 180, rot: 0 });
}
const site = {
  id: "lock-demo", groupId: "lock-demo", site: "Lock Demo", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [{ id: "pc1", locked: false, points: [{ x: -440, y: -160 }, { x: 440, y: -160 }, { x: 440, y: 300 }, { x: -440, y: 300 }] }],
  els, measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try {
  window.__PLANYR_E2E = true;
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [site.id]: site })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
} catch (e) {} })();`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector("svg[role=application]", { timeout: 20000 });
await page.waitForTimeout(2500);

const svg = page.locator("svg[role=application]");
const box = await svg.boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

/* THE MEASUREMENT.
   "Locked to the imagery" is one statement: the basemap's zoom must be exactly the zoom at
   which its pixels-per-foot equals the drawing's — and that must hold at EVERY latitude the
   map is panned to, because the drawing's pixels-per-foot does not change when you pan.
   The pre-fix code re-derived the basemap's zoom at the PANNED-TO latitude while the drawing
   stayed put, so the two disagreed more and more the further north you went (measured live:
   +0.18% at the far position; this harness measured +0.52% over a longer excursion), and the
   round trip came back short by a few feet every time.

   The drawing's own scale is read off the rendered parcel, whose north edge is 880 ft by
   construction. Everything else comes from Leaflet's public API. Zooming OUT first is what
   makes the excursion long: one drag then covers tens of thousands of feet. */
const FT_PER_DEG = 365223, LAT0 = site.origin.lat;
const expectedZoom = (ppf) => Math.log2((ppf * FT_PER_DEG * Math.cos((LAT0 * Math.PI) / 180)) / (256 / 360));

const read = () => page.evaluate(() => {
  const m = window.__geoMap;
  const s = document.querySelector("svg[role=application]");
  if (!m || !s) return null;
  const pc = s.querySelector('[data-testid="parcel-outline"]');
  let edgePx = null;
  if (pc) {
    const p = pc.getAttribute("points").split(" ").map((q) => q.split(",").map(Number));
    edgePx = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]); // the 880 ft north edge
  }
  const c = m.getCenter();
  return { lat: c.lat, lng: c.lng, zoom: m.getZoom(), edgePx, drawn: s.querySelectorAll("g").length };
});

const emptyGrab = async (dy) => {
  // Leave room for the whole drag INSIDE the viewport (a drag that runs off the edge is
  // clamped and moves the view by far less than asked), and land on empty canvas (a press on
  // a building drags the building, not the view).
  const yFracs = dy > 0 ? [0.12, 0.06, 0.2] : [0.88, 0.94, 0.8];
  for (const fx of [0.08, 0.92, 0.5]) for (const fy of yFracs) {
    const x = box.x + box.width * fx, y = box.y + box.height * fy;
    const onCanvas = await page.evaluate(([px, py]) => {
      const el = document.elementFromPoint(px, py);
      return !!el && (el.tagName === "svg" || el.getAttribute("role") === "application");
    }, [x, y]);
    if (onCanvas) return { x, y };
  }
  return null;
};
const pan = async (dy) => {
  const g = await emptyGrab(dy);
  if (!g) return false;
  await page.keyboard.down("Space");
  await page.mouse.move(g.x, g.y); await page.mouse.down();
  await page.mouse.move(g.x, g.y + dy, { steps: 6 }); await page.mouse.up();
  await page.keyboard.up("Space");
  await page.waitForTimeout(700); // let the basemap commit (~160 ms debounce) settle
  return true;
};

// Zoom OUT so a single drag covers real ground. The wheel is the planner's zoom gesture.
await page.mouse.move(cx, cy);
for (let i = 0; i < 28; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(25); }
await page.waitForTimeout(900);

const STEP = Math.round(box.height * 0.6);
const start = await read();
if (!start || !start.edgePx) { console.log("SETUP FAILED — no parcel on screen to read the drawing's scale from"); await browser.close(); process.exit(2); }
if (!(await pan(STEP))) { console.log("SETUP FAILED — no empty canvas to grab for a pan"); await browser.close(); process.exit(2); }
const far = await read();
if (!(await pan(-STEP))) { console.log("SETUP FAILED — could not pan back"); await browser.close(); process.exit(2); }
const end = await read();

const ppfDrawn = start.edgePx / 880;                 // constant across a pure pan
const want = expectedZoom(ppfDrawn);
const travelledFt = Math.abs(far.lat - start.lat) * FT_PER_DEG;
const zoomErr = (s) => s.zoom - want;
const scalePct = (s) => (Math.pow(2, zoomErr(s)) - 1) * 100;
const returnFt = Math.hypot((end.lat - start.lat) * FT_PER_DEG, (end.lng - start.lng) * FT_PER_DEG * Math.cos((LAT0 * Math.PI) / 180));

const row = (l, s) => `${l.padEnd(6)} lat ${s.lat.toFixed(6)} · basemap zoom ${s.zoom.toFixed(9)} · needs ${want.toFixed(9)} · basemap is ${scalePct(s) >= 0 ? "+" : ""}${scalePct(s).toFixed(4)}% off the drawing · drawn <g> ${s.drawn}`;
console.log(`excursion : one drag of ${STEP} px ≈ ${Math.round(travelledFt).toLocaleString()} ft north, then back`);
console.log(row("start", start));
console.log(row("far", far));
console.log(row("end", end));
console.log(`round trip: the map centre came back ${returnFt.toFixed(3)} ft off  — live report measured -4.3 ft per excursion, cumulative`);
console.log(`zoom      : ${start.zoom.toFixed(9)} → ${far.zoom.toFixed(9)} → ${end.zoom.toFixed(9)}  — live report: 13.5678 → 13.5652 → 13.5677 (did NOT restore)`);
console.log(`culling   : drawn <g> ${start.drawn} → ${far.drawn} (panned away) → ${end.drawn} (back)`);
console.log(`errors    : ${errors.length ? errors.join(" | ") : "none"}`);

const fails = [];
if (travelledFt < 10000) fails.push(`excursion too short to be a real test (${Math.round(travelledFt)} ft) — the pan gesture did not drive`);
for (const [k, s] of [["start", start], ["far", far], ["end", end]]) {
  if (Math.abs(zoomErr(s)) > 1e-6) fails.push(`${k}: the basemap is scaled ${scalePct(s).toFixed(4)}% away from the drawing`);
}
if (returnFt > 0.5) fails.push(`the map came back ${returnFt.toFixed(2)} ft off where it started`);
if (Math.abs(end.zoom - start.zoom) > 1e-9) fails.push("zoom did not restore over the round trip");
if (end.drawn < start.drawn) fails.push(`culling did not restore the drawing (${start.drawn} → ${end.drawn})`);
if (errors.length) fails.push(`page errors: ${errors.join(" | ")}`);

console.log(fails.length ? "\nFAIL\n - " + fails.join("\n - ") : "\nPASS — the basemap stayed exactly at the drawing's scale throughout, and the round trip returned.");
await browser.close();
process.exit(fails.length ? 1 : 0);
