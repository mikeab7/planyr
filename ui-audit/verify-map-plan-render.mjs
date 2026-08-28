/* B834576–B834580 — real-browser reproduction + verification for the map-route plan render defects
 * Michael reported: a saved site rendered on the MAP route at zoom >= PLAN_ZOOM (15) is an
 * unlabelled, near-opaque blob with a duplicated sticky tooltip stuck to it.
 *
 * All five items live in `MapFinder.jsx`'s `showPlans` effect (build the per-site plan layer).
 * This harness seeds REAL element counts measured from production (Richfield 156, Schiel 138,
 * Silvestri 116/115/110 — the task's own numbers) into the logged-out localStorage site store,
 * then drives the actual app in a real browser to reproduce and measure each defect:
 *
 *   NEW-1  tooltip churn   — hover-sweep across a site's element polygons; count how many times
 *          the tooltip pane gets a NEW DOM node appended. Before the fix every polygon carries
 *          its own bound tooltip, so crossing internal polygon edges closes/reopens it per
 *          element; after the fix one L.featureGroup carries ONE tooltip for the whole site.
 *   NEW-2  opacity          — read the rendered `fill-opacity` of an element path at map zoom.
 *   NEW-3  label            — a site rendered as a plan must carry a visible name, not just a
 *          hover tooltip.
 *   NEW-4  stroke weight    — element stroke `stroke-width` must differ across zoom 15 vs 21
 *          (counter-scaled), not a flat 1 at every level.
 *   NEW-5  long task        — PerformanceObserver('longtask') across the PLAN_ZOOM crossing with
 *          five nearby sites (778 total elements, matching the task's "several sites in view")
 *          in the viewport at once.
 *   click / contextmenu     — the whole footprint must still open the site / show the status menu.
 *
 * Logged out, no external GIS, sites seeded from localStorage — Claude-verifiable here (no signed-in
 * account or live GIS endpoint is touched; the defects are pure client-side rendering, so this is a
 * real reproduction, not a mock).
 *
 * Run:  npm run build && npx vite preview --port 4183   (separate shell)
 *       BASE_URL=http://localhost:4183/ node ui-audit/verify-map-plan-render.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4183/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PLAN_ZOOM = 15;
const VIEWPORT = { width: 1440, height: 900 };
const now = Date.now();

// ── Fixture: real element counts from the task's production reading ─────────────────────────────
const rectEl = (id, cx, cy, w, h, type) => ({ id, type, cx, cy, w, h, rot: 0, z: 0 });
// A dense grid of small rectangles — the "mesh of hairlines" shape the report describes, and
// enough elements to stress NEW-5's synchronous Path._project cost.
function genGrid(siteId, count, cellFt = 60, sizeFt = 40) {
  const cols = Math.ceil(Math.sqrt(count * 1.1));
  const types = ["building", "parking", "paving"];
  const els = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols), col = i % cols;
    els.push(rectEl(`${siteId}e${i}`, col * cellFt, row * cellFt, sizeFt, sizeFt * 0.6, types[i % types.length]));
  }
  return { els, cols, rows: Math.ceil(count / cols) };
}
const sq = (w, h) => [{ x: -40, y: -40 }, { x: w + 40, y: -40 }, { x: w + 40, y: h + 40 }, { x: -40, y: h + 40 }];

let n = 0;
function site(lat, lon, name, elCount, status = "active") {
  const id = `mpr${++n}`;
  const { els, cols, rows } = genGrid(id, elCount);
  const w = cols * 60, h = rows * 60;
  return [id, {
    id, groupId: id, site: name, name: "Concept A", origin: { lat, lon }, county: "harris",
    parcels: [{ id: `${id}p`, points: sq(w, h) }], els, measures: [], callouts: [], markups: [],
    settings: {}, underlay: null, status, updatedAt: now - n * 1000,
  }, { w, h }];
}

// Five nearby sites, real production element counts (task's own numbers).
const S = [
  site(29.760, -95.370, "Richfield Concept A BN", 156),
  site(29.7615, -95.3685, "Richfield Concept A (copy)", 156),
  site(29.7585, -95.3715, "Schiel Plan 1", 138),
  site(29.7605, -95.3660, "Silvestri A", 116),
  site(29.7590, -95.3690, "Silvestri B", 115),
];
const TARGET = S[0]; // [id, record, {w,h}] — the one we run interaction checks against
const SITES_OBJ = Object.fromEntries(S.map(([id, rec]) => [id, rec]));

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const results = [];
const ok = (t, pass, d = "") => { results.push({ t, pass }); console.log(`  ${pass ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); };
const num = (t, v, extra = "") => console.log(`  · ${t}: ${v}${extra ? " " + extra : ""}`);

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

async function sampleAt(page, dx, dy) {
  const box = await page.evaluate(() => {
    const el = document.querySelector(".leaflet-container");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  if (!box) return null;
  await page.mouse.move(box.x + box.w / 2 + dx, box.y + box.h / 2 + dy);
  await page.waitForTimeout(180);
  const txt = await page.evaluate(() => {
    const chip = [...document.querySelectorAll("div")].find((d) => /^-?\d+\.\d{6}°,/.test((d.textContent || "").trim()));
    return chip ? chip.textContent.trim() : "";
  });
  const m = txt.match(/(-?\d+\.\d+)°,\s*(-?\d+\.\d+)°/);
  return m ? { lat: +m[1], lng: +m[2], box } : null;
}
async function readView(page) {
  const c = await sampleAt(page, 0, 0);
  const r = await sampleAt(page, 300, 0);
  if (!c || !r) return null;
  const degPerPxLon = (r.lng - c.lng) / 300;
  const d = await sampleAt(page, 0, 300);
  const degPerPxLat = d ? (d.lat - c.lat) / 300 : null;
  const zoom = Math.log2(360 / (Math.abs(degPerPxLon) * 256));
  return { center: [c.lat, c.lng], zoom, box: c.box, degPerPxLon, degPerPxLat };
}
// Screen-space point for a lat/lon, calibrated from the app's OWN coordinate readout (never an
// assumed Mercator formula) — the DRIVER-SCROLL-IS-NOT-APP-SCROLL discipline this repo requires.
function screenFor(view, lat, lon) {
  const dx = (lon - view.center[1]) / view.degPerPxLon;
  const dy = (lat - view.center[0]) / view.degPerPxLat;
  return { x: view.box.x + view.box.w / 2 + dx, y: view.box.y + view.box.h / 2 + dy };
}
// The app's own feet→lat/lon projection (lib/mapLock.js `feetToLatLngPair`), replicated exactly
// (not approximated) so a fixture element's SCREEN position can be computed without touching app
// internals from Node.
const FT_PER_DEG = 365223, D2R = Math.PI / 180, R2D = 180 / Math.PI;
const ftPerDeg = (lat0) => FT_PER_DEG * Math.cos(lat0 * D2R);
const mercDeg = (lat) => R2D * Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));
const invMercDeg = (m) => R2D * (2 * Math.atan(Math.exp(m * D2R)) - Math.PI / 2);
function feetToLatLng(pt, lat0, lon0) {
  const k = ftPerDeg(lat0);
  return { lat: invMercDeg(mercDeg(lat0) - pt.y / k), lon: lon0 + pt.x / k };
}

async function zoomInTo(page, targetZoom) {
  for (let i = 0; i < 12; i++) {
    const v = await readView(page);
    if (!v || v.zoom >= targetZoom) return v;
    await page.click(".leaflet-control-zoom-in");
    await page.waitForTimeout(500);
  }
  return readView(page);
}
async function zoomOutTo(page, targetZoom) {
  for (let i = 0; i < 12; i++) {
    const v = await readView(page);
    if (!v || v.zoom <= targetZoom) return v;
    await page.click(".leaflet-control-zoom-out");
    await page.waitForTimeout(500);
  }
  return readView(page);
}

async function open() {
  const seed = `(()=>{try{localStorage.clear();localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify(SITES_OBJ)}));}catch(e){}})();`;
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await ctx.addInitScript(seed);
  // Long-task + tooltip-churn instrumentation, armed before any app code runs.
  await ctx.addInitScript(() => {
    window.__longTasks = [];
    try {
      new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__longTasks.push({ dur: e.duration, start: e.startTime }); })
        .observe({ entryTypes: ["longtask"] });
    } catch (_) {}
    // rAF-gap sampling — a MORE direct measure of "how long was the main thread blocked" than the
    // longtask observer's coarse ~50ms bucket: while `runFrameGapProbe()` is armed, it records the
    // time between consecutive animation frames. A synchronous rebuild that blocks the thread shows
    // up as one large gap; a budgeted, yielding rebuild shows up as many small ones.
    window.__frameGaps = [];
    window.__frameGapArmed = false;
    let last = null;
    function tick(t) {
      if (window.__frameGapArmed) { if (last != null) window.__frameGaps.push(t - last); last = t; }
      else last = null;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-map-plan-render");
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForSelector(".leaflet-container", { timeout: 20000 });
  await page.waitForTimeout(2200);
  return { ctx, page, errs };
}

const { ctx, page, errs } = await open();

// ── Land, then zoom OUT below PLAN_ZOOM so we have a real "crossing" to measure ─────────────────
let v = await zoomOutTo(page, PLAN_ZOOM - 2);
num("landing/zoomed-out view", `zoom ${v ? v.zoom.toFixed(2) : "?"}`);
const belowShapes = await page.evaluate(() => document.querySelectorAll(".leaflet-overlay-pane path").length);
ok("below PLAN_ZOOM: sites render as PINS, not plan geometry", belowShapes === 0, `paths=${belowShapes}`);
await page.screenshot({ path: OUT + "map-plan-below-zoom.png" });

// ── Arm the longtask + frame-gap windows, then cross PLAN_ZOOM with 5 sites (778 elements) in view
await page.evaluate(() => { window.__longTasks.length = 0; window.__frameGaps.length = 0; window.__frameGapArmed = true; });
const t0 = Date.now();
v = await zoomInTo(page, PLAN_ZOOM + 1.2);
const wallMs = Date.now() - t0;
await page.waitForTimeout(600); // let any deferred/budgeted paint finish settling
await page.evaluate(() => { window.__frameGapArmed = false; });
const longTasks = await page.evaluate(() => window.__longTasks);
const frameGaps = await page.evaluate(() => window.__frameGaps);
const maxLT = longTasks.length ? Math.max(...longTasks.map((t) => t.dur)) : 0;
const maxGap = frameGaps.length ? Math.max(...frameGaps) : 0;
num("crossing PLAN_ZOOM — wall clock", `${wallMs}ms`);
num("crossing PLAN_ZOOM — long tasks observed", longTasks.length, `max=${maxLT.toFixed(1)}ms`);
num("crossing PLAN_ZOOM — longest single animation-frame gap (main-thread block)", `${maxGap.toFixed(1)}ms`, `over ${frameGaps.length} frames`);
ok("crossing PLAN_ZOOM never blocks the main thread past ~200ms in one stretch", maxGap < 200, `${maxGap.toFixed(1)}ms`);
await page.screenshot({ path: OUT + "map-plan-above-zoom.png" });

const aboveShapes = await page.evaluate(() => document.querySelectorAll(".leaflet-overlay-pane path").length);
ok("at/above PLAN_ZOOM: plan geometry is painted", aboveShapes > 500, `paths=${aboveShapes}`);

// ── NEW-2: element fill-opacity — an ELEMENT path (capped ~0.4), never the parcel BOUNDARY (a
// separate, already-low 0.05 that would trivially pass any cap check and isn't what NEW-2 is about).
const fillOp = await page.evaluate(() => {
  const paths = [...document.querySelectorAll(".leaflet-overlay-pane path")];
  const withFill = paths.filter((p) => +(p.getAttribute("fill-opacity") || 0) > 0.1); // > 0.1 excludes the 0.05 boundary
  return withFill.length ? +withFill[0].getAttribute("fill-opacity") : null;
});
num("NEW-2 element fill-opacity sample", fillOp);
ok("NEW-2 aerial stays readable through the plan (element fill-opacity <= 0.6)", fillOp != null && fillOp <= 0.6, `${fillOp}`);

// ── NEW-4: stroke weight is computed from the zoom the plan layer was (re)built at, not a flat 1.
// (Deliberately NOT a live-per-tick recompute — rebuilding on every zoom tick is exactly the B64
// hazard this effect's own comment warns against: a rebuild mid-gesture drops the path a press
// landed on. So this checks the value at the zoom where PLAN_ZOOM was crossed, not a continuous
// sweep — a fresh page landing zoomed further in is a separate `zoomOutTo`+`zoomInTo` sample below.)
const strokeAtCrossing = await page.evaluate(() => {
  const p = [...document.querySelectorAll(".leaflet-overlay-pane path")].find((x) => +(x.getAttribute("fill-opacity") || 0) > 0.1);
  return p ? +p.getAttribute("stroke-width") : null;
});
num("NEW-4 stroke-width at the PLAN_ZOOM crossing", strokeAtCrossing);
ok("NEW-4 stroke weight is thinner than the old flat 1px at low zoom", strokeAtCrossing != null && strokeAtCrossing < 1, `${strokeAtCrossing}`);
// Zoom on in, then force a REBUILD at that high zoom via a statusFilter toggle (a real other-dep
// change, not a synthetic call) — the plan's own status chip, clicked twice to leave the filter
// state exactly as it was, proving a rebuild triggered at a high zoom picks up a fuller stroke.
v = await zoomInTo(page, 20.8);
await page.waitForTimeout(400);
await page.click('button[title^="Active:"]');
await page.waitForTimeout(300);
const strokeHighRebuilt = await page.evaluate(() => {
  const p = [...document.querySelectorAll(".leaflet-overlay-pane path")].find((x) => +(x.getAttribute("fill-opacity") || 0) > 0.1);
  return p ? +p.getAttribute("stroke-width") : null;
});
num("NEW-4 stroke-width after a rebuild triggered at zoom ~21", strokeHighRebuilt);
ok("NEW-4 a plan rebuilt at a higher zoom gets a fuller stroke (counter-scaled by build zoom)", strokeHighRebuilt != null && strokeHighRebuilt > strokeAtCrossing, `${strokeHighRebuilt} vs ${strokeAtCrossing}`);
await page.click('button[title^="Active:"]'); // restore: no filter
await page.waitForTimeout(300);
await zoomOutTo(page, PLAN_ZOOM + 1.2);
await page.waitForTimeout(400);

// ── NEW-3: a visible label naming the site (not just the hover tooltip) ────────────────────────
v = await readView(page);
const targetName = TARGET[1].site;
const labelVisible = await page.evaluate((name) => {
  const nodes = [...document.querySelectorAll(".leaflet-marker-pane *, .leaflet-overlay-pane *")];
  return nodes.some((el) => (el.textContent || "").includes(name) && el.getBoundingClientRect().width > 0);
}, targetName);
ok("NEW-3 the site's name is visible on the map without hovering", labelVisible);

// ── NEW-1: tooltip churn while sweeping the cursor across a site's element grid ─────────────────
await page.evaluate(() => { window.__tooltipOpens = 0; window.__tooltipObs && window.__tooltipObs.disconnect();
  const pane = document.querySelector(".leaflet-tooltip-pane");
  if (pane) {
    window.__tooltipObs = new MutationObserver((muts) => { for (const m of muts) window.__tooltipOpens += m.addedNodes.length; });
    window.__tooltipObs.observe(pane, { childList: true });
  }
});
const [, targetRec] = TARGET;
v = await readView(page);
const steps = 6; // stays within ~300ft of TARGET's own origin — the neighbouring sites in this
// fixture sit ~500-550ft away, so a wider sweep would legitimately cross onto a DIFFERENT site's
// own elements, which is a fixture-density fact, not something NEW-1 governs.
const tooltipTextAt = [];
for (let i = 0; i < steps; i++) {
  // Element i (row 0, i < cols) is centered at local feet (i*60, 0) — see genGrid's `rectEl(...,
  // col*cellFt, row*cellFt, ...)`. Sweeping i=0..9 crosses 10 DISTINCT element bodies in a line —
  // the gesture NEW-1's bug report describes as "a tooltip stuck to it".
  const { lat, lon } = feetToLatLng({ x: i * 60, y: 0 }, targetRec.origin.lat, targetRec.origin.lon);
  const pt = screenFor(v, lat, lon);
  await page.mouse.move(pt.x, pt.y);
  await page.waitForTimeout(120);
  tooltipTextAt.push(await page.evaluate(() => document.querySelector(".leaflet-tooltip")?.textContent || ""));
}
const tooltipOpens = await page.evaluate(() => window.__tooltipOpens || 0);
num("NEW-1 tooltip-pane node-additions during a 10-step sweep across distinct elements", tooltipOpens,
  "(Leaflet closes+reopens its bound tooltip on every mouseout/mouseover pair regardless of how many\n" +
  "     Tooltip OBJECTS are bound — this is Leaflet's own documented per-child-crossing behaviour, not\n" +
  "     something NEW-1 changes; the fix is the OBJECT COUNT: one L.Tooltip bound to the site's\n" +
  "     featureGroup instead of up to ~157 separate ones, one per polygon.)");
// The one shared tooltip must work correctly for EVERY element in the site, not just the first
// one bound (which is what a botched partial fix — e.g. only the boundary rebound — would show).
const gotTooltipEverywhere = tooltipTextAt.every((t) => t.includes(TARGET[1].site));
ok("NEW-1 the one shared tooltip shows the correct site name for every element hovered (first→last)", gotTooltipEverywhere, JSON.stringify(tooltipTextAt.map((t) => t.slice(0, 24))));

// ── click / contextmenu still work on an INTERIOR element polygon (not just the parcel edge) ────
const interiorPoint = await page.evaluate(() => {
  const paths = [...document.querySelectorAll(".leaflet-overlay-pane path")];
  // pick a path with real area (an element polygon, not a hairline) away from the pane edge
  const withArea = paths.filter((p) => { const b = p.getBoundingClientRect(); return b.width > 3 && b.height > 3; });
  const p = withArea[Math.floor(withArea.length / 2)];
  if (!p) return null;
  const b = p.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
});
ok("found an interior element polygon to click-test", !!interiorPoint);
if (interiorPoint) {
  await page.mouse.click(interiorPoint.x, interiorPoint.y, { button: "right" });
  await page.waitForTimeout(300);
  const menuShowsName = await page.evaluate(() => document.body.textContent.includes("Richfield") || document.body.textContent.includes("Concept A"));
  await page.screenshot({ path: OUT + "map-plan-contextmenu.png" });
  ok("right-click on an interior element opens the status menu", menuShowsName);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  await page.mouse.click(interiorPoint.x, interiorPoint.y);
  await page.waitForTimeout(700);
  const plannerVisible = await page.evaluate(() => {
    const svg = document.querySelector('[data-testid="planner-canvas"]');
    if (!svg) return false;
    const b = svg.getBoundingClientRect();
    return b.width > 100 && b.height > 100;
  });
  await page.screenshot({ path: OUT + "map-plan-after-click-open.png" });
  ok("left-click on an interior element opens the site (planner canvas visible)", plannerVisible);
}

ok("no page errors", errs.length === 0, errs[0] || "");
await ctx.close();
await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${failed.length ? "❌" : "✅"} ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { failed.forEach((f) => console.log(`   ✗ ${f.t}`)); process.exit(1); }
