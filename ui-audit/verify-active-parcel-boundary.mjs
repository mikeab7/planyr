/* B1923744 — Map view: draw a site record's selected parcel boundary at close zoom, alongside
 * the existing pin. Proven here on real, throwaway, LOCAL (signed-out) sites — never a real
 * plan — because the Map view's own sites overview renders logged-out from localStorage with
 * no external GIS involved (see ui-audit/verify-landing-view.mjs, the same seeding shape).
 *
 * Four cases, one page load each:
 *   A  a site with ONE ACTIVE, georeferenced parcel   → pin, then pin+boundary, then full plan
 *   B  a site with an INACTIVE-only parcel            → pin only at every zoom, never a boundary
 *   C  a site with NO parcels at all                  → pin only, no console error
 *   D  rapid zoom in/out around the reveal threshold   → never more than one boundary polygon
 *
 * Reads the map's own zoom the same way verify-landing-view.mjs does (the cursor lat/long chip,
 * no network needed), and drives real wheel-zoom gestures rather than any private test hook.
 *
 * Run:  npm run build && npx vite preview --port 4184   (separate shell)
 *       BASE_URL=http://localhost:4184/ node ui-audit/verify-active-parcel-boundary.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4184/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 1440, height: 900 };
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const sq = (ft) => [{ x: 0, y: 0 }, { x: ft, y: 0 }, { x: ft, y: ft }, { x: 0, y: ft }];
const ORIGIN = { lat: 29.76, lon: -95.36 }; // Houston-area, matches this repo's other fixtures

const baseSite = (id, name, parcels) => [id, {
  id, groupId: id, site: name, name, origin: ORIGIN, county: "harris",
  parcels, els: [], measures: [], callouts: [], markups: [],
  settings: {}, underlay: null, status: "active", updatedAt: Date.now(),
}];

const ACCOUNTS = {
  A_active: Object.fromEntries([baseSite("apa1", "Active Parcel Site", [{ id: "apa1p", active: true, points: sq(600) }])]),
  B_inactive: Object.fromEntries([baseSite("apb1", "Inactive Parcel Site", [{ id: "apb1p", active: false, points: sq(600) }])]),
  C_none: Object.fromEntries([baseSite("apc1", "No Parcel Site", [])]),
};

const results = [];
const ok = (t, pass, d = "") => { results.push({ t, pass }); console.log(`  ${pass ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

async function sampleAt(page, box, dx, dy) {
  await page.mouse.move(box.x + box.w / 2 + dx, box.y + box.h / 2 + dy);
  await page.waitForTimeout(180);
  const txt = await page.evaluate(() => {
    const chip = [...document.querySelectorAll("div")].find((d) => /^-?\d+\.\d{6}°,/.test((d.textContent || "").trim()));
    return chip ? chip.textContent.trim() : "";
  });
  const m = txt.match(/(-?\d+\.\d+)°,\s*(-?\d+\.\d+)°/);
  return m ? { lat: +m[1], lng: +m[2] } : null;
}

async function mapBox(page) {
  return page.evaluate(() => {
    const el = document.querySelector(".leaflet-container");
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
}

async function readZoom(page, box) {
  const c = await sampleAt(page, box, 0, 0);
  const r = await sampleAt(page, box, 300, 0);
  if (!c || !r) return null;
  const degPerPx = Math.abs(r.lng - c.lng) / 300;
  return Math.log2(360 / (degPerPx * 256));
}

// The STATUS pin (sitePinIcon) carries divIcon className "map-site-feature"; the full-plan
// view's own name-TAG marker (sitePlanLabelHtml) carries an empty className — same marker pane,
// so a bare ".leaflet-marker-icon" count can't tell "pin" from "plan swapped in its name tag".
const domCounts = (page) => page.evaluate(() => ({
  boundaries: document.querySelectorAll(".map-active-parcel-boundary").length,
  pins: document.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon.map-site-feature").length,
}));

async function open(account) {
  const seed = `(()=>{try{localStorage.clear();localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify(ACCOUNTS[account])}));}catch(e){}})();`;
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-active-parcel-boundary");
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  // With sites seeded, the default route lands on the Dashboard, not the Map — go straight to
  // the Site module's map route (a signed-out account with zero sites lands here by default,
  // which is why this wasn't needed in verify-landing-view.mjs's zero/one-site cases there).
  await page.goto(new URL("#/site", BASE).toString(), { waitUntil: "load" });
  await page.waitForSelector(".leaflet-container", { timeout: 20000 });
  await page.waitForTimeout(1800);
  return { ctx, page, errs };
}

/* Zoom IN via real wheel gestures at the map center, one notch at a time, until either the
 * given predicate is satisfied or a generous iteration ceiling is hit — never assumes a fixed
 * wheel-notches-per-zoom-level ratio (Leaflet's own zoomSnap/zoomDelta can vary this). */
async function zoomInUntil(page, box, predicate, maxSteps = 40) {
  for (let i = 0; i < maxSteps; i++) {
    const z = await readZoom(page, box);
    const counts = await domCounts(page);
    if (predicate(z, counts)) return { zoom: z, counts };
    await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
    await page.mouse.wheel(0, -140);
    await page.waitForTimeout(260);
  }
  return { zoom: await readZoom(page, box), counts: await domCounts(page) };
}

// ── A — an active, georeferenced parcel: pin → pin+boundary → full plan, in that order ────────
{
  const { ctx, page, errs } = await open("A_active");
  const box = await mapBox(page);

  const start = await domCounts(page);
  await page.screenshot({ path: OUT + "active-parcel-a-start.png" });
  ok("A · starts pin-only at the landing (metro) zoom — no boundary yet", start.pins === 1 && start.boundaries === 0, JSON.stringify(start));

  const revealed = await zoomInUntil(page, box, (z, c) => c.boundaries > 0);
  await page.screenshot({ path: OUT + "active-parcel-a-revealed.png" });
  ok("A · the boundary reveals while the pin is STILL on screen (never both replaced)", revealed.counts.boundaries === 1 && revealed.counts.pins === 1,
     `zoom ${revealed.zoom?.toFixed(2)} · ${JSON.stringify(revealed.counts)}`);

  const fullPlan = await zoomInUntil(page, box, (z, c) => c.pins === 0);
  await page.screenshot({ path: OUT + "active-parcel-a-fullplan.png" });
  ok("A · zooming further swaps to the full-plan view — pin gone, no leftover boundary-only polygon",
     fullPlan.counts.pins === 0 && fullPlan.counts.boundaries === 0, `zoom ${fullPlan.zoom?.toFixed(2)} · ${JSON.stringify(fullPlan.counts)}`);
  const hasFullPlanShape = await page.evaluate(() => document.querySelectorAll(".map-site-feature").length > 0);
  ok("A · the full-plan view itself still draws something (this is a swap, not a disappearance)", hasFullPlanShape);

  // zoom back OUT past the reveal band and confirm the boundary hides again with the pin back
  let backOut = null;
  for (let i = 0; i < 30; i++) {
    await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
    await page.mouse.wheel(0, 140);
    await page.waitForTimeout(260);
    backOut = await domCounts(page);
    if (backOut.pins === 1 && backOut.boundaries === 0) break;
  }
  await page.screenshot({ path: OUT + "active-parcel-a-back-out.png" });
  ok("A · zooming back out returns to pin-only — the boundary hides again", backOut && backOut.pins === 1 && backOut.boundaries === 0, JSON.stringify(backOut));

  ok("A · no page errors through the whole zoom sweep", errs.length === 0, errs[0] || "");
  await ctx.close();
}

/* Zoom in one small notch at a time, checking EVERY step, up to (but stopping at) the full-plan
 * swap (pins hits 0) or a step ceiling — rather than jumping to one target zoom, which a single
 * wheel gesture can overshoot past the PARCEL_ZOOM..PLAN_ZOOM band entirely. Returns the worst
 * (max) boundary count seen anywhere along the way, so a false positive at ANY intermediate
 * zoom is caught, not just at wherever the loop happened to land. */
async function zoomStepwiseNoBoundaryUntilFullPlan(page, box, maxSteps = 60) {
  let maxBoundaries = 0;
  let lastCounts = await domCounts(page);
  let lastZoom = await readZoom(page, box);
  for (let i = 0; i < maxSteps; i++) {
    lastCounts = await domCounts(page);
    lastZoom = await readZoom(page, box);
    maxBoundaries = Math.max(maxBoundaries, lastCounts.boundaries);
    if (lastCounts.pins === 0) break; // reached the full-plan swap — nothing left to check
    await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
    await page.mouse.wheel(0, -60);
    await page.waitForTimeout(220);
  }
  return { maxBoundaries, lastCounts, lastZoom };
}

// ── B — an INACTIVE-only parcel: pin only, at every zoom, never a boundary ─────────────────────
{
  const { ctx, page, errs } = await open("B_inactive");
  const box = await mapBox(page);
  const swept = await zoomStepwiseNoBoundaryUntilFullPlan(page, box);
  await page.screenshot({ path: OUT + "active-parcel-b-inactive.png" });
  ok("B · an inactive-only parcel never draws a boundary at ANY zoom on the way to the full-plan swap",
     swept.maxBoundaries === 0, `up to zoom ${swept.lastZoom?.toFixed(2)} · ended ${JSON.stringify(swept.lastCounts)}`);
  ok("B · no page errors", errs.length === 0, errs[0] || "");
  await ctx.close();
}

// ── C — no parcel on the record at all: pin only, no console error ─────────────────────────────
{
  const { ctx, page, errs } = await open("C_none");
  const box = await mapBox(page);
  const swept = await zoomStepwiseNoBoundaryUntilFullPlan(page, box);
  await page.screenshot({ path: OUT + "active-parcel-c-none.png" });
  ok("C · a record with no parcel at all stays pin-only at every zoom — not a failure, no boundary",
     swept.maxBoundaries === 0, `up to zoom ${swept.lastZoom?.toFixed(2)} · ended ${JSON.stringify(swept.lastCounts)}`);
  ok("C · no page errors", errs.length === 0, errs[0] || "");
  await ctx.close();
}

// ── D — rapid zoom in/out across the reveal threshold: never a duplicate/leaked layer ──────────
{
  const { ctx, page, errs } = await open("A_active");
  const box = await mapBox(page);
  await zoomInUntil(page, box, (z, c) => c.boundaries > 0);
  const seen = [];
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
    await page.mouse.wheel(0, i % 2 === 0 ? -140 : 140);
    await page.waitForTimeout(220);
    seen.push((await domCounts(page)).boundaries);
  }
  await page.screenshot({ path: OUT + "active-parcel-d-rapid-zoom.png" });
  ok("D · rapid zoom in/out never leaves more than one boundary polygon at a time", seen.every((n) => n <= 1), JSON.stringify(seen));
  ok("D · no page errors across rapid zoom", errs.length === 0, errs[0] || "");
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${failed.length ? "❌" : "✅"} ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { failed.forEach((f) => console.log(`   ✗ ${f.t}`)); process.exit(1); }
