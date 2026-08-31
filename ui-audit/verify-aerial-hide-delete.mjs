/* B688864 — LIVE proof that the References panel's "Aerial backdrop" Hide (eye) and Remove (✕)
 * controls actually change what's on screen, and that the change PERSISTS across a reload.
 *
 * THE BUG (AUDIT-FIRST, measured across the 54 production plans in Supabase project
 * lyeqzkuiwngunutlkkmi before a line of fix code was written): 48 of them carry `sites.data.underlay`
 * and every one of the 48 has `fromMap: true` — captured from the Map picker, which always sets a
 * real `origin`. On a georeferenced plan the app's LIVE Leaflet basemap tile layer takes over the
 * picture (`basemapOn = basemapSrc !== "off" && !!origin`), and the static `underlay` <image> the
 * References panel's opacity/Hide controls actually touch is unconditionally suppressed while it is
 * on screen (`!(origin && basemapOn)`). The panel's Hide toggle (`showAerial`) never touched the live
 * tile layer at all, so on every one of those 48 plans clicking it changed nothing visible — and it
 * was a bare `useState`, never persisted, so even the one thing it DID control reset to shown on
 * every reload. Remove cleared the archived snapshot and the identical-looking live aerial stayed on
 * screen — read by the owner as "clicking it does nothing" / "deleting it does nothing".
 *
 * THE FIX gates the live tile layer's `want` computation on the SAME persisted flag
 * (`settings.aerialHidden`, via lib/aerialVisibility.js `wantBasemapSrc`) that now backs the panel's
 * Hide toggle, so Hide/Remove silence the live tiles too, and the choice survives a reload.
 *
 * WHAT THIS HARNESS PROVES, behaviourally, against the real built app (never by reading source):
 *   1. A fromMap/georeferenced plan opens with the live aerial ON (the pre-existing default,
 *      unchanged) — a KNOWN-good arm, so a later "nothing renders" reading can't be mistaken for a
 *      broken test (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6 — prove the instrument sees the true case
 *      before trusting it on the case under investigation).
 *   2. Clicking Hide removes the live tiles from the DOM immediately.
 *   3. A reload keeps them hidden (persistence — the actual owner complaint).
 *   4. Clicking Show brings them back.
 *   5. Clicking Remove clears the row back to the empty state AND removes the live tiles.
 *   6. A reload keeps Remove's effect too (empty state + no tiles).
 *
 * The pre-fix/post-fix MUTATION proof for the underlying decision itself lives at the correct,
 * cheaper unit-testable boundary — test/aerialVisibility.test.js's "MUTATION CHECK" replays the exact
 * pre-fix formula (`basemapOn ? basemapSrc : null`, blind to Hide) and asserts it disagrees with the
 * fix on this exact regression case. This harness is the LIVE confirmation that the wiring behind
 * that decision actually reaches the rendered app end to end.
 *
 * Run:  npm run build && npm run preview &   # then:
 *       node ui-audit/verify-aerial-hide-delete.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// A tiny inline PNG — the static underlay's own image never needs the network; only the LIVE
// basemap tile layer (Esri) does, and this harness never asserts on whether those tiles finish
// loading — only on whether the DOM elements Leaflet creates for them exist at all (Leaflet
// synchronously creates + appends each tile's <img> before the network request settles, so this is
// unaffected by the sandbox's egress policy toward arcgisonline.com).
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGNgYGD4//8/w38gAGYAJv0H/dbCTPYAAAAASUVORK5CYII=";
const parcel = { id: "pc1", locked: false, points: [{ x: -360, y: -300 }, { x: 360, y: -300 }, { x: 360, y: 300 }, { x: -360, y: 300 }] };

const SITE_ID = "diag-frommap";
const site = {
  id: SITE_ID, groupId: SITE_ID, site: "Diag fromMap aerial", name: "Concept A",
  origin: { lat: 29.7858, lon: -95.8244 }, county: null,
  parcels: [parcel], els: [], measures: [], callouts: [], markups: [],
  settings: {}, sheetOverlays: [], parcelDrawings: [], updatedAt: 1,
  underlay: { src: PNG, imgW: 1000, imgH: 800, x: -300, y: -240, ftPerPx: 0.6, opacity: 1, locked: true, fromMap: true },
};

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

const seedScript = () => `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [SITE_ID]: site })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(SITE_ID)});
} catch (e) {} })();`;

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
// `window.__geoMap` (E2E-only, `SitePlanner.jsx`) exposes THIS plan's Leaflet basemap map instance —
// needed because `SitePlannerApp` keeps BOTH the Map picker (MapFinder) and the open plan
// (SitePlanner) mounted at once (the Map tab is `display:none`, not unmounted), and MapFinder runs
// its OWN independent Leaflet map with its own World_Imagery aerial tile layer for the picker UI.
// A document-wide tile query catches that unrelated map too — caught by debugging the first run of
// this exact harness (a residual tile that never went away no matter what the References panel did).
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
const page = await ctx.newPage();
await assertMeasurable(page, "verify-aerial-hide-delete");

const liveTileCount = () => page.evaluate(() => {
  const map = window.__geoMap;
  if (!map) return -1; // hook not armed / map not mounted — never a false "0"
  return [...map.getContainer().querySelectorAll(".leaflet-tile-pane img.leaflet-tile")]
    .filter((img) => (img.src || "").includes("/World_Imagery/")).length;
});

const openReferencesRow = async () => {
  await page.locator('button:has-text("Overlays")').first().click();
  await page.waitForTimeout(400);
  const expander = page.locator('button:has-text("Aerial backdrop")');
  if (await expander.count()) { await expander.first().click(); await page.waitForTimeout(200); }
};

// Seed via a real navigation + localStorage write, THEN reload — NOT `addInitScript`, which would
// re-fire (and re-clobber the app's own saved state back to the un-hidden original) on every later
// `page.reload()` this harness does to prove persistence.
await page.goto(BASE, { waitUntil: "load" });
await page.evaluate((s) => { try {
  localStorage.setItem("planarfit:sites:v1", JSON.stringify(s));
  localStorage.setItem("planarfit:currentSite:v1", "diag-frommap");
} catch (e) {} }, { [SITE_ID]: site });
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(2000); // let the map mount + the coarse backfill tile layer attach

const geoMapArmed = await page.evaluate(() => !!window.__geoMap);
log(geoMapArmed, "the E2E geo-map hook armed — without it every reading below would be vacuous");

// ── 1. KNOWN-GOOD ARM — the live aerial is ON by default on a georeferenced plan (unchanged). ──
const initialTiles = await liveTileCount();
log(initialTiles > 0, `known-good arm: a fromMap plan opens with the live basemap painting tiles (${initialTiles} tile node(s))`);
await page.screenshot({ path: `${OUT}aerial-hide-delete-1-initial.png` });

await openReferencesRow();

// ── 2. Hide removes the live tiles immediately. ──
const hideBtn = page.locator('button[title="Hide aerial"]');
log(await hideBtn.count() > 0, `Hide aerial button is present`);
await hideBtn.first().click();
await page.waitForTimeout(600);
const afterHide = await liveTileCount();
log(afterHide === 0, `Hide removes the LIVE basemap tiles from the DOM (was ${initialTiles}, now ${afterHide})`);
await page.screenshot({ path: `${OUT}aerial-hide-delete-2-hidden.png` });

// ── 3. Persists across a reload — this is the owner's actual complaint. ──
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(2000);
const afterReloadHidden = await liveTileCount();
log(afterReloadHidden === 0, `Hide SURVIVES a reload — tiles still absent (${afterReloadHidden})`);
await openReferencesRow();
const showBtnAfterReload = page.locator('button[title="Show aerial"]');
log(await showBtnAfterReload.count() > 0, `the eye icon reads "Show aerial" after reload (state round-tripped through storage)`);

// ── 4. Show brings the live tiles back. ──
await showBtnAfterReload.first().click();
await page.waitForTimeout(800);
const afterShow = await liveTileCount();
log(afterShow > 0, `Show restores the live basemap tiles (${afterShow} tile node(s))`);

// ── 5. Remove clears the row to the empty state AND removes the live tiles. ──
const removeBtn = page.locator('button[title="Remove"]');
log(await removeBtn.count() > 0, `Remove button is present`);
await removeBtn.first().click();
await page.waitForTimeout(600);
const afterRemove = await liveTileCount();
const emptyStateShown = await page.locator('text=Add an aerial').count();
log(afterRemove === 0, `Remove also silences the live basemap tiles, not just the archived snapshot (${afterRemove})`);
log(emptyStateShown > 0, `the row reverts to the empty ("Add an aerial") state`);
await page.screenshot({ path: `${OUT}aerial-hide-delete-3-removed.png` });

// ── 6. Persists across a reload — Remove sticks too. ──
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(2000);
const afterReloadRemoved = await liveTileCount();
await openReferencesRow(); // the panel doesn't reopen itself — must look before concluding "gone"
const emptyStateAfterReload = await page.locator('text=Add an aerial').count();
log(afterReloadRemoved === 0, `Remove SURVIVES a reload — no live tiles (${afterReloadRemoved})`);
log(emptyStateAfterReload > 0, `Remove SURVIVES a reload — still the empty state, not a regenerated aerial`);

console.log(fail ? `\n${fail} check(s) failed` : "\nAll checks passed");
await ctx.close();
await browser.close();
process.exit(fail ? 1 : 0);
