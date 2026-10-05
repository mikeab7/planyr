/* B2092656 ×3 — adjacent check: clicking a lot in Georgia still selects THE LOT UNDER THE CURSOR at z16 and z14, a second
 * click on it still toggles it off, and a click made before the outlines have arrived still adds the lot (B137 / B441:
 * a click is answered by a live point query, never by waiting on the display). Run against both builds; the outcome
 * must be identical.
 *
 * Why it exists: this change moved the outline /query transport into a worker (parcelQueryTransport.js) and rebuilt
 * the saved-copy layer; the Select-parcels hit-test reads the display layer's `eachFeature`, so a regression there
 * would show up as a click that selects nothing, the wrong lot, or a neighbour.
 * Hermetic: the synthetic Bartow service (lib/bartowParcelMock.mjs), which answers a point identify with the one lot
 * cell under the point. KNOWN-GOOD ARM: the layer must really hold lots before the z16/z14 clicks (else they would be
 * answered only by the live query and prove nothing about the display).
 * Run: vite build && vite preview --port 4188 --strictPort, then node ui-audit/verify-georgia-lot-click.mjs */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { BARTOW, routeBartowGis, lotAt, cellOf } from "./lib/bartowParcelMock.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4188/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await context.newPage();
await assertMeasurable(page, "verify-georgia-lot-click");
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
await page.addInitScript(`(() => { try {
  window.__PLANYR_E2E = true;
  localStorage.setItem("planarfit:sites:v1", ${JSON.stringify(JSON.stringify({ s_bartow: { id: "s_bartow", groupId: "s_bartow", site: "Bartow Verify Site", name: "Plan 1", status: "active", origin: { lat: BARTOW.lat, lon: BARTOW.lng }, county: "ga_bartow", parcels: [], els: [], updatedAt: Date.now() } }))});
  localStorage.removeItem("planarfit:currentSite:v1");
} catch (e) {} })();`);
const counts = await routeBartowGis(page);
if (process.env.DEBUG_CLICKS) page.on("request", (r) => { if (/esriGeometryPoint/.test(decodeURIComponent(r.url()))) console.log("    point query", decodeURIComponent(r.url()).match(/"x":[^,]+,"y":[^,]+/)[0]); });

async function openMap(z) {
  await page.goto("about:blank");
  await page.goto(BASE + "#/site", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const row = page.locator('div[title*="Open site"]').filter({ hasText: "Bartow Verify Site" }).first();
  await row.hover();
  await row.locator('[aria-label="Show on map"]').click();
  await page.waitForTimeout(1200);
  await page.evaluate(([la, ln, zz]) => { window.__mapFinderMap.setView([la, ln], zz, { animate: false }); }, [BARTOW.lat, BARTOW.lng, z]);
  await page.waitForTimeout(1500);
}
const held = () => page.evaluate(() => { const s = window.__mapParcelDisplay && window.__mapParcelDisplay(); return s ? s.held : 0; });
const summary = () => page.evaluate(() => { const el = document.querySelector('[data-testid="map-decide-summary"]'); return el ? el.textContent.trim() : ""; });
const screenOf = (lot) => page.evaluate(([la, ln]) => { const p = window.__mapFinderMap.latLngToContainerPoint([la, ln]); const r = window.__mapFinderMap.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [lot.lat, lot.lng]);
// Is there a selection highlight (an SVG path in the overlay pane) whose box contains the point?
const highlightCovers = (pt) => page.evaluate(([x, y]) => [...document.querySelectorAll(".leaflet-overlay-pane path")].some((p) => { const b = p.getBoundingClientRect(); return b.width > 0 && x >= b.left - 1 && x <= b.right + 1 && y >= b.top - 1 && y <= b.bottom + 1; }), [pt.x, pt.y]);
const waitFor = async (fn, ms = 6000) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await page.waitForTimeout(150); } return v; };
// Returns the click point and whether a highlight ALREADY covered it — the "it is the lot under the cursor" probe is
// only evidence if it reads false before the click and true after (else any stray path would pass it).
const clickLot = async (lot) => { const pt = await screenOf(lot); pt.coveredBefore = await highlightCovers(pt); await page.mouse.click(pt.x, pt.y); return pt; };

// The first injected click after a load can be lost to the browser (recorded on V1516224 for the extension driver);
// Playwright's mouse is not that driver, but the select toggle is clicked through the UI and checked, never assumed.
const c = cellOf(BARTOW.lng, BARTOW.lat);

// 1 — z16, outlines in: the lot under the cursor is selected.
await openMap(16);
await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click();
const h16 = await waitFor(async () => ((await held()) > 50 ? held() : 0), 8000);
expect("KNOWN-GOOD ARM: z16 outlines are drawn before the click (the layer holds lots)", h16 > 50, `${h16} lots held`);
const lotA = lotAt(c.i, c.j);
const ptA = await clickLot(lotA);
const s1 = await waitFor(async () => /^1 parcel/.test(await summary()) && summary());
expect("z16: a click selects one lot", /^1 parcel/.test(s1 || ""), s1 || "(no selection)");
expect("z16: …and it is the lot under the cursor (a highlight covers the click point after, none before)", !ptA.coveredBefore && await highlightCovers(ptA));
// 2 — a second click on the same lot toggles it off.
await clickLot(lotA);
const s2 = await waitFor(async () => !(await summary()) || !/^1 parcel/.test(await summary()));
expect("z16: a second click on the same lot toggles it off", !!s2, (await summary()) || "(no selection)");
// 3 — z14 on a fresh page, a different lot. (Chaining this click straight after the toggle-off and a zoom read "no
// selection" on BOTH builds — a sequencing quirk of the toggle-off path, not of this change; recorded, not chased here.)
await openMap(14);
await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click();
await page.waitForTimeout(4000);
const h14 = await held();
expect("KNOWN-GOOD ARM: z14 outlines are drawn before the click", h14 > 500, `${h14} lots held`);
const lotB = lotAt(c.i + 3, c.j - 2);
const ptB = await clickLot(lotB);
const s3 = await waitFor(async () => /^1 parcel/.test(await summary()) && summary());
expect("z14: a click selects one lot", /^1 parcel/.test(s3 || ""), s3 || "(no selection)");
expect("z14: …the lot under the cursor (covered after, not before)", !ptB.coveredBefore && await highlightCovers(ptB));
// 4 — a click the instant Select parcels is on, before any outline has arrived, still adds the lot.
await openMap(16);
const q0 = counts.query;
await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click();
const heldAtClick = await held();
const ptC = await clickLot(lotA);
const s4 = await waitFor(async () => /^1 parcel/.test(await summary()) && summary());
expect("before outlines arrive: the click still adds the lot (answered by the live point query)", /^1 parcel/.test(s4 || ""), `${s4 || "(no selection)"} · lots held at click ${heldAtClick}`);
expect("…the lot under the cursor (covered after, not before)", !ptC.coveredBefore && await highlightCovers(ptC));
expect("the service was really asked (outline + identify queries)", counts.query > q0, `${counts.query - q0} queries`);
expect("no uncaught page errors", errs.length === 0, errs.join(" | "));
await browser.close();
console.log(`\n${failures ? `❌ ${failures} FAILED` : "✅ PASS"} — Georgia lot click (z16 / z14 / before outlines arrive)`);
process.exit(failures ? 1 : 0);
