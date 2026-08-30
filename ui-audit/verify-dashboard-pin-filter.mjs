/* B881665 — the dashboard map's site pins ignore the "Filter by name…" box.
 *
 * Owner report (2026-08-30), live on planyr.io: typing in the filter box on the dashboard
 * (#/) narrows the Sites-panel LIST header from "28" to "1/28"/"2/28"/"0/28" — but every one
 * of the 29 map pins (28 sites + 1 comp, which reconciles) stays on the map, including the
 * 0-match case, where the map should have nothing left to draw. Clicking a filtered row still
 * navigates to the right project, so only the map is out of sync with the list.
 *
 * Root cause (confirmed by code reading): `MapFinder.jsx`'s site-pin paint effect built its
 * marker set from the raw `sites` array — `(showSitesLayer ? sites : []).forEach(...)` — while
 * the Sites-panel LIST and its count both already ran every row through `passName(s)`, the
 * name-filter predicate. The predicate existed and was applied in two of the three places that
 * needed it; the pin layer was the one that never got the filter passed in, and the effect's
 * own dependency array never named `nameFilter` either, so a rebuild wasn't even triggered by
 * typing.
 *
 * Fix: the pin-paint effect now filters `sites` through the SAME `passName` predicate
 * (`sites.filter(passName)`) and depends on `nameFilter`, so the map's pin set and the list's
 * row set can never drift apart again — same source, same predicate, both re-evaluated on every
 * keystroke.
 *
 * Pins are counted via `.leaflet-marker-icon.map-site-feature` — the stable class `sitePinIcon`
 * stamps on its divIcon (B834578) — at a zoom level where sites render as zoomed-out status
 * pins rather than full drawn plans, so this count is specific to the status-pin layer and
 * cannot be confused with a plan's parcel/element polygons (which paint as SVG `<path>`s, not
 * `.leaflet-marker-icon` divIcons) or the comp-marker layer (`map-comp-feature`, a different
 * class).
 *
 * Logged out, no external GIS, sites seeded from localStorage — Claude-verifiable here.
 *
 * MUTATION PROOF: run once as-is (green), then `git stash` the MapFinder.jsx fix, rebuild,
 * re-run (must go RED — the pin count stays at the total regardless of the filter text), then
 * `git stash pop` and rebuild again.
 *
 * Run:  npm run build && npx vite preview --port 4173   (then)   node ui-audit/verify-dashboard-pin-filter.mjs
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME
  || ["/opt/pw-browsers/chromium-1234/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1228/chrome-linux/chrome"].find(existsSync)
  || chromium.executablePath();

let fails = 0;
const ok = (cond, msg) => { if (!cond) fails++; console.log(`  ${cond ? "✓" : "✗ FAIL"} ${msg}`); };

// Real-shaped fixture sites, spread around Houston so they land on one screen at the app's own
// derived landing view (landingView.js) without any manual pan/zoom.
const sq = (ft) => [{ x: 0, y: 0 }, { x: ft, y: 0 }, { x: ft, y: ft }, { x: 0, y: ft }];
const site = (id, name, lat, lon, status = "active") => [id, {
  id, groupId: id, site: name, name, origin: { lat, lon }, county: "harris",
  parcels: [{ id: `${id}p`, points: sq(600) }], els: [], measures: [], callouts: [], markups: [],
  settings: {}, underlay: null, status, updatedAt: Date.now(),
}];
const SITES = Object.fromEntries([
  site("s1", "Goose Creek", 29.80, -95.10),
  site("s2", "Richfield", 29.74, -95.30),
  site("s3", "Sylvestri Tract", 29.86, -95.22),
  site("s4", "Bain Concept A", 29.78, -95.40),
]);

const seedScript = `(() => { try {
  localStorage.clear();
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(SITES)}));
} catch (e) {} })();`;

const pinCount = (page) => page.evaluate(() => document.querySelectorAll(".leaflet-marker-icon.map-site-feature").length);
const listHeader = (page) => page.evaluate(() => {
  const el = [...document.querySelectorAll("*")].find((n) => n.children.length === 0 && /^\d+(\/\d+)?$/.test((n.textContent || "").trim()));
  return el ? el.textContent.trim() : null;
});

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
mkdirSync(new URL("./screens/", import.meta.url).pathname, { recursive: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addInitScript(seedScript);
await ctx.route(/supabase\.co/, (r) => r.abort());
const page = await ctx.newPage();
await assertMeasurable(page, "verify-dashboard-pin-filter");
await page.goto(`${BASE}#/`, { waitUntil: "load" });
await page.waitForTimeout(2600);

const before = await pinCount(page);
ok(before === 4, `all 4 seeded sites paint as pins before any filter is typed (got ${before})`);

const input = page.locator('input[aria-label="Filter sites by name"]').first();
await input.waitFor({ state: "visible", timeout: 6000 });

// A filter that matches exactly one site.
await input.fill("Goose");
await page.waitForTimeout(600);
const oneMatch = await pinCount(page);
ok(oneMatch === 1, `filtering to "Goose" leaves exactly 1 pin on the map (got ${oneMatch})`);

// A filter that matches nothing — the map must have nothing left to draw, matching the
// owner's exact "0/28, all 29 pins remain" report.
await input.fill("zzzzznomatch");
await page.waitForTimeout(600);
const zeroMatch = await pinCount(page);
ok(zeroMatch === 0, `filtering to a non-matching string leaves 0 pins on the map (got ${zeroMatch})`);

// Clearing the filter restores every pin.
await input.fill("");
await page.waitForTimeout(600);
const restored = await pinCount(page);
ok(restored === 4, `clearing the filter restores all 4 pins (got ${restored})`);

await page.screenshot({ path: new URL("./screens/dashboard-pin-filter.png", import.meta.url).pathname });
await ctx.close();
await browser.close();

console.log("\n" + (fails === 0 ? "✅ PASS — the dashboard's map pins track the name filter, same as the Sites-panel list" : `❌ FAIL — ${fails} assertion(s)`));
process.exit(fails === 0 ? 0 : 1);
