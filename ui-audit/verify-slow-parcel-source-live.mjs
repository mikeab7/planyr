/* NEW-1/NEW-2 (B2424384/B2424385, V1857328) — the LIVE half: a slow or silent parcel server on the DEPLOYED bundle, signed in as the test account, Map home only (no plan is created, nothing to clean up).
 *   1  Perry County id search, five fresh loads (the cold first ask is the case): the lot is found and selected, no failure toast.
 *   2  a Texas parcel search still works (known-good arm — Harris, by address).
 *   3  the state layer blocked (route abort, test only): the toast says the server didn't answer, has Try again, never "No Tennessee parcel"; unblocked + Try again finds the lot.
 *   4  an id that does not exist: "No Tennessee parcel with ID", no Try again (known-good arm for the not-found wording).
 *   5  Select parcels on, click the Perry lot: selected, never "No parcel right there".
 * The served build is read from /version.json in the SAME run as every row and must equal the expected commit; the new string literal "Still looking — the" is proven present in the served chunks.
 * Run: E2E_LOGIN_KEY=… node ui-audit/verify-slow-parcel-source-live.mjs <expectedBuildSha> [https://planyr.io] [--out f.json]
 * Exit 0 = all rows passed · 1 = a row failed · 2 = VOID (wrong build / map never came up). */
import { writeFileSync, readFileSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const EXPECT = args.find((a) => /^[0-9a-f]{7,40}$/i.test(a));
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const OUT = (args.find((a) => a.startsWith("--out=")) || "--out=slow-parcel-source-live.json").slice(6);
if (!EXPECT) { console.error("usage: verify-slow-parcel-source-live.mjs <expectedBuildSha> [base]"); process.exit(2); }
const FX = JSON.parse(readFileSync(new URL("../test/fixtures/tnSweepPoints.json", import.meta.url), "utf8"));
const PERRY = FX.counties.find((c) => c.name === "Perry");
const TN = /Tennessee_Property_Boundaries_Public_Use\/FeatureServer\/0\/query/;
const norm = (v) => String(v == null ? "" : v).toUpperCase().replace(/[^A-Z0-9]/g, "");

const s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const page = s.page;
await assertMeasurable(page, "verify-slow-parcel-source-live");
const rows = [];
const sleep = (ms) => page.waitForTimeout(ms);
const waitFor = async (fn, ms = 30000) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await sleep(250); } return v; };
const served = () => page.evaluate(async () => { const v = await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null); return v && v.build; });
const record = async (name, pass, detail) => { const b = await served(); rows.push({ name, pass, detail, build: b }); console.log(`${pass ? "✅" : "❌"} ${name} — ${detail} [build ${b}]`); };
const toast = () => page.evaluate(() => { const e = document.querySelector('[data-testid="map-status-toast"]'); return e ? e.textContent : ""; });
const held = () => page.evaluate(() => (window.__mapSelectedParcels ? window.__mapSelectedParcels() : null)).catch(() => null);
const freshMap = async (lat = 35.6387, lng = -87.8473, z = 15) => {
  await page.goto(`${BASE}/?cb=${Date.now()}#/site`);
  await page.waitForFunction(() => !!window.__mapFinderMap && !!document.querySelector('[data-testid="map-toolbar-select-parcels"]'), null, { timeout: 60000 });
  await page.evaluate(([a, b, zz]) => window.__mapFinderMap.setView([a, b], zz, { animate: false }), [lat, lng, z]);
  await sleep(1200);
};
const search = async (text) => { const box = page.locator('input[role="combobox"]').first(); await box.click(); await box.fill(text); await sleep(500); await box.press("Enter"); };
const isPerry = (h) => h && h.length && h.some((y) => String(y.county) === "tn_statewide" && [y.acct, ...Object.values(y.attrs || {})].some((v) => norm(v) && norm(v) === norm(PERRY.id)));

try {
  await freshMap();
  const b0 = await served();
  if (!String(b0 || "").startsWith(EXPECT.slice(0, 7))) { console.log(`VOID: served build ${b0} is not ${EXPECT}`); process.exit(2); }
  console.log(`signed in as ${s.proof.email} · served build ${b0} · base ${BASE}`);

  for (let i = 1; i <= 5; i++) {
    await freshMap();
    const t0 = Date.now();
    await search(PERRY.id);
    const h = await waitFor(async () => { const x = await held(); return x && x.length ? x : null; }, 70000);
    const tt = await toast();
    await record(`1.${i} Perry id search (fresh load)`, isPerry(h) && !/didn't answer|No Tennessee parcel/.test(tt), `${isPerry(h) ? "found" : "NOT found"} in ${Math.round((Date.now() - t0) / 1000)}s · toast "${tt.slice(0, 80)}"`);
  }

  await freshMap(29.7604, -95.3698, 15);
  await search("1200 Smith St, Houston, TX");
  const hx = await waitFor(async () => { const x = await held(); return x && x.length ? x : null; }, 60000);
  await record("2 Texas address search still selects a lot", !!(hx && hx.length && /harris|txgio/i.test(String(hx[hx.length - 1].county))), hx && hx.length ? `landed in ${hx[hx.length - 1].county}` : "nothing selected");

  await freshMap();
  await page.route(TN, (r) => r.abort("failed"));
  await search(PERRY.id);
  const down = await waitFor(async () => { const t = await toast(); return /didn't answer/.test(t) ? t : null; }, 60000);
  const tryBtn = await page.locator('[data-testid="map-try-again"]').count();
  await record("3a blocked state layer → 'didn't answer' + Try again, never 'No Tennessee parcel'", !!down && tryBtn === 1 && !/No Tennessee parcel/.test(down), `toast "${(down || (await toast())).slice(0, 110)}" · Try again buttons ${tryBtn}`);
  await page.unroute(TN);
  await page.locator('[data-testid="map-try-again"]').click();
  const h3 = await waitFor(async () => { const x = await held(); return x && x.length ? x : null; }, 70000);
  await record("3b unblocked + Try again → the lot is found", isPerry(h3), isPerry(h3) ? "found" : "nothing selected");

  await freshMap();
  await search("068 066    00499 000 2026");
  const nf = await waitFor(async () => { const t = await toast(); return /No Tennessee parcel with ID/.test(t) ? t : null; }, 60000);
  await record("4 a genuinely absent id → 'No Tennessee parcel', no Try again", !!nf && (await page.locator('[data-testid="map-try-again"]').count()) === 0, nf ? nf.slice(0, 90) : `toast "${(await toast()).slice(0, 90)}"`);

  await freshMap(PERRY.lat, PERRY.lng, 17); // the zoom Select parcels clicks at (same set-up as verify-tn-counties-live, whose Perry row is a recorded pass)
  await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click({ timeout: 15000 });
  const disp = await waitFor(async () => { const d = await page.evaluate(() => (window.__mapParcelDisplay ? window.__mapParcelDisplay() : null)).catch(() => null); return d && d.held >= 3 ? d : null; }, 45000);
  if (!disp) console.log("  (outlines never reached 3 held lots — clicking anyway)");
  const pt = await page.evaluate(([a, b]) => { const m = window.__mapFinderMap, p = m.latLngToContainerPoint([a, b]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [PERRY.lat, PERRY.lng]);
  await page.mouse.click(pt.x, pt.y);
  // a click first paints the quick outline from the display layer, then replaces it with the full identified record — wait for the Perry record itself, not the first thing selected
  const h5 = await waitFor(async () => { const x = await held(); return isPerry(x) ? x : null; }, 70000) || await held();
  const t5 = await toast();
  if (!isPerry(h5)) { await page.screenshot({ path: OUT.replace(/\.json$/, "") + "-row5.png" }); console.log("  step5 body:", (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").slice(-600)); }
  await record("5 Select parcels click on the Perry lot", isPerry(h5) && !/No parcel right there/.test(t5), isPerry(h5) ? "selected" : `nothing selected · toast "${t5.slice(0, 80)}"`);

  const lit = await page.evaluate(async () => {
    const urls = performance.getEntriesByType("resource").map((e) => e.name).filter((u) => /\.js(\?|$)/.test(u));
    for (const u of urls) { try { const t = await fetch(u).then((r) => r.text()); if (t.includes("Still looking")) return u.split("/").pop(); } catch (_) {} }
    return null;
  });
  await record("0 the new string literal is in the served chunks", !!lit, lit ? `"Still looking" in ${lit}` : "not found in any loaded chunk");
} catch (e) {
  console.log("VOID/ERROR:", e.message); writeFileSync(OUT, JSON.stringify({ error: e.message, rows }, null, 2)); await s.close(); process.exit(2);
}
writeFileSync(OUT, JSON.stringify({ expect: EXPECT, rows }, null, 2));
await s.close();
const failed = rows.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : `\nall ${rows.length} rows passed`);
process.exit(failed.length ? 1 : 0);
