/* B1871472 — "Clicking 'Map' in the breadcrumb zooms out too far."
 *
 * THE REPRO: a session that opens straight into a project (`bootResume.js`'s resume — the normal
 * case for the owner, who almost always comes back to whatever he was last working on) never shows
 * the Map view until he clicks the "Map" breadcrumb from INSIDE that project. That is the FIRST
 * time this SESSION the landing-view effect (`MapFinder.jsx`) ever runs, and it used to frame the
 * DENSEST CLUSTER of the owner's whole pursuit portfolio — on his real ~35-site Houston-area
 * account that is a metro-wide fit (zoom ~9-10, spanning Katy to Baytown), not the project he was
 * just standing in. That reads exactly as reported: "I clicked Map and it zoomed out way too far,
 * my sites are tiny."
 *
 * ⛔ WHAT THIS IS NOT: production data pulled from `planyr_production` (queried directly via the
 * Supabase MCP as part of diagnosing this) shows no corrupted/outlier geometry — the owner's three
 * Colorado sites and one far-NE-Texas site are real, legitimate business locations, and they lose
 * the "densest cluster" tie-break to the ~35-site Houston cluster exactly as `landingView.js`
 * documents ("one distant outlier cannot drag the camera"). There is no stray coordinate to trim.
 * The defect is TIMING/CONTEXT, not data: the one-time landing fit doesn't know it is being shown
 * as a RETURN from a specific project rather than a cold open.
 *
 * THE FIX (`MapFinder.jsx`'s landing effect): when `activeSiteId` is still set at landing time (the
 * project the user just left — `goMap` deliberately keeps it, the Leaflet keep-alive optimization),
 * frame just THAT one project (the same "exactly one site → metro scale" case `landingView.js`
 * already implements) instead of the whole portfolio. A cold, no-project open is untouched.
 *
 * THIS HARNESS drives the real repro end-to-end: seed a realistic multi-site Houston-area portfolio
 * PLUS one project sitting well off the portfolio's own centroid, navigate the browser straight into
 * THAT project's route (`bootResume`'s exact shape — the same `openProject` pattern
 * `e2e/map-crumb-bounce.spec.js` uses), click the real "Map" breadcrumb, and read where the map
 * actually lands — via the app's own cursor coordinate readout, same technique as
 * `verify-landing-view.mjs`, so no tile network is needed and this runs signed-out.
 *
 * Run:  npm run build && npx vite preview --port 4184   (separate shell)
 *       BASE_URL=http://localhost:4184/ node ui-audit/verify-map-return-from-project.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4184/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const now = Date.now();

const LANDING_MAX_ZOOM = 11;
const VIEWPORT = { width: 1440, height: 900 };
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const sq = (ft) => [{ x: 0, y: 0 }, { x: ft, y: 0 }, { x: ft, y: ft }, { x: 0, y: ft }];
let n = 0;
const site = (lat, lon, name, at, groupId) => {
  const id = groupId || `mrfp${++n}`;
  return [id, {
    id, groupId: id, site: name, name, origin: { lat, lon }, county: "harris",
    parcels: [{ id: `${id}p`, points: sq(600) }], els: [], measures: [], callouts: [], markups: [],
    settings: {}, underlay: null, status: "active", updatedAt: at,
  }];
};
const spread = (count, lat0, lon0, dLat, dLon, label, at0) =>
  Array.from({ length: count }, (_, i) =>
    site(lat0 + ((i % 5) - 2) * dLat, lon0 + ((i % 4) - 1.5) * dLon, `${label} ${i + 1}`, at0 + i * 1000));

/* The owner's real shape: a wide Houston-area spread, one project — "Grand Port" — sitting well
 * out toward the metro's own edge (~34 miles from the portfolio's own densest-cluster centre,
 * matching the real distance measured from production between the portfolio centroid and the
 * owner's actual eastern-most site). This is the project we navigate directly into. */
const PORTFOLIO = [
  ...spread(14, 29.80, -95.55, 0.05, 0.07, "Katy area", now - 900_000),
  ...spread(10, 29.95, -95.45, 0.04, 0.06, "North Houston", now - 800_000),
  ...spread(6, 29.60, -95.40, 0.04, 0.05, "South Houston", now - 700_000),
  ...spread(4, 29.95, -95.78, 0.04, 0.05, "Waller", now - 600_000),
];
const ACTIVE_GID = "g-grandport-active";
const ACTIVE_SITE = site(29.807276, -94.877079, "Grand Port", now, ACTIVE_GID);
const ALL_SITES = Object.fromEntries([...PORTFOLIO, ACTIVE_SITE]);

const results = [];
const ok = (t, pass, d = "") => { results.push({ t, pass }); console.log(`  ${pass ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); };

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
  await page.waitForTimeout(220);
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
  const degPerPx = Math.abs(r.lng - c.lng) / 300;
  const zoom = Math.log2(360 / (degPerPx * 256));
  return { center: [c.lat, c.lng], zoom };
}

const milesBetween = (a, b) => {
  const rad = (d) => (d * Math.PI) / 180;
  const R = 3958.7613;
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
};

const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
await ctx.addInitScript((sites) => {
  try { localStorage.clear(); localStorage.setItem("planarfit:sites:v1", JSON.stringify(sites)); } catch (_) {}
}, ALL_SITES);
const page = await ctx.newPage();
await assertMeasurable(page, "verify-map-return-from-project");
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));

// Boot straight into the active project — the exact bootResume.js shape a returning owner sees,
// and the same direct-navigation pattern e2e/map-crumb-bounce.spec.js's openProject() uses.
await page.goto(`${BASE}#/project/${ACTIVE_GID}/site`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 30_000 });
ok("boots straight into the active project (plan mode, not map)", true);

const crumb = page.locator('[data-testid="dashboard-crumb"]:visible');
await crumb.waitFor({ state: "visible", timeout: 15_000 });
await crumb.click();
await page.waitForSelector(".leaflet-container", { timeout: 20_000 });
await page.waitForTimeout(2200); // let the landing effect settle, same margin verify-landing-view.mjs uses

const v = await readView(page);
await page.screenshot({ path: OUT + "map-return-from-project.png" });
console.log(`  · view after clicking Map from inside Grand Port: center ${v ? v.center.map((x) => x.toFixed(3)).join(", ") : "?"} · zoom ${v ? v.zoom.toFixed(2) : "?"}`);

const distFromActive = v && milesBetween(v.center, [29.807276, -94.877079]);
const distFromPortfolioCentre = v && milesBetween(v.center, [29.85, -95.55]); // roughly the whole-portfolio centroid

ok("reads a view at all", !!v);
ok("centers on the RETURNING project (Grand Port), not the whole portfolio", !!v && distFromActive < 3, v && `${distFromActive.toFixed(1)} mi from Grand Port`);
ok("does NOT center on the portfolio's own centroid", !!v && distFromPortfolioCentre > 15, v && `${distFromPortfolioCentre.toFixed(1)} mi from the portfolio centroid`);
ok("held at the single-site metro clamp, not a wider portfolio fit", !!v && Math.abs(v.zoom - LANDING_MAX_ZOOM) < 0.3, v && `zoom ${v.zoom.toFixed(2)}`);
ok("no page errors", errs.length === 0, errs[0] || "");

await ctx.close();
await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${failed.length ? "❌" : "✅"} ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { failed.forEach((f) => console.log(`   ✗ ${f.t}`)); process.exit(1); }
