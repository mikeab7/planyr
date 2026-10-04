/* verify-one-label-per-city — a city is labelled ONCE, however many label passes exist (NEW-2, 2026-09-30).
 *
 * Owner-reported live on planyr.io (build 65f911c, around Lewisville/Carrollton): Lewisville, Flower Mound,
 * Carrollton, Coppell, Southlake, The Colony and Hebron each showed TWO copies of their name, stacked. Cause: two
 * independent passes label a city in the same zoom band — the City-names canvas layer and the city-limits overlay's
 * own labels — and neither knew about the other.
 *
 * Drives the REAL overlay engine plus the REAL City-names canvas layer over the LIVE city-limits service, and counts
 * every label, per name, across both passes. Passes only if no name is drawn twice AND every city the boundary layer
 * anchors still has exactly one label (a city must not LOSE its name to the dedupe).
 *
 * Run:  npx vite --port 5199 --strictPort &   then   NODE_USE_ENV_PROXY=1 node ui-audit/verify-one-label-per-city.mjs
 * `EXPECT_DUPLICATES=1` inverts the assertion — used ONCE to prove the check goes RED on the un-fixed code.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const BASE = process.env.BASE_URL || "http://localhost:5199";
const EXPECT_DUP = !!process.env.EXPECT_DUPLICATES;
const results = [];
const ok = (name, cond, detail = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`); };
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox", "--ignore-certificate-errors"] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, ignoreHTTPSErrors: true });
  await assertMeasurable(page, "verify-one-label-per-city");
  for (const z of [11, 12]) {
    await page.goto(`${BASE}/ui-audit/dfw-etj-map-harness.html?lat=33.03&lng=-97.0&z=${z}&layers=jur_city&placenames=1`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__READY__ === true, { timeout: 20000 });
    await page.waitForFunction(() => window.__status.jur_city && ["loaded", "empty", "failed"].includes(window.__status.jur_city.state), { timeout: 90000 }).catch(() => {});
    // let the canvas layer load its dataset, lay out, and fade its names in; its set is published as it settles
    await page.waitForFunction(() => { const p = document.querySelector(".leaflet-placenames-pane"); return p && p.__drawn && p.__drawn.filter((l) => l.a > 0.05).length > 3; }, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const canvas = ((document.querySelector(".leaflet-placenames-pane") || {}).__drawn || []).filter((l) => l.a > 0.05).map((l) => l.name);
      const boundary = [...document.querySelectorAll("#map .leaflet-boundarylabels-pane span")].map((n) => n.textContent.trim()).filter((t) => t && !/ ETJ$/.test(t) && !/ETJ undetermined|release area/.test(t));
      return { canvas, boundary, state: window.__status.jur_city };
    });
    const count = new Map();
    for (const n of [...r.canvas, ...r.boundary]) { const k = n.toLowerCase(); count.set(k, (count.get(k) || 0) + 1); }
    const dups = [...count.entries()].filter(([, c]) => c > 1).map(([k]) => k);
    ok(`z${z}: city limits loaded`, r.state.state === "loaded", JSON.stringify(r.state));
    ok(`z${z}: both passes are actually drawing (else the check is vacuous)`, r.canvas.length >= 4 && r.boundary.length >= 1, `canvas=${r.canvas.length} [${r.canvas.slice(0, 8).join(", ")}] boundary=${r.boundary.length} [${r.boundary.slice(0, 8).join(", ")}]`);
    if (EXPECT_DUP) ok(`z${z}: (teeth) un-fixed code DOES double-label`, dups.length > 0, `doubled: ${dups.join(", ")}`);
    else ok(`z${z}: no city is labelled twice`, dups.length === 0, dups.length ? `doubled: ${dups.join(", ")}` : `${count.size} distinct names, each once`);
  }
  // The seven names from the owner's report, at the view they were reported in (each must appear exactly once when present).
  await page.goto(`${BASE}/ui-audit/dfw-etj-map-harness.html?lat=33.03&lng=-97.0&z=11&layers=jur_city&placenames=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__status && window.__status.jur_city && window.__status.jur_city.state === "loaded", { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const seen = await page.evaluate(() => {
    const c = ((document.querySelector(".leaflet-placenames-pane") || {}).__drawn || []).filter((l) => l.a > 0.05).map((l) => l.name);
    const b = [...document.querySelectorAll("#map .leaflet-boundarylabels-pane span")].map((n) => n.textContent.trim());
    return [...c, ...b];
  });
  for (const n of ["Lewisville", "Flower Mound", "Carrollton", "Coppell", "Southlake", "The Colony", "Hebron"]) {
    const c = seen.filter((t) => t.toLowerCase() === n.toLowerCase()).length;
    if (c === 0) console.log(`•  ${n}: not in this view (not counted)`);
    else if (EXPECT_DUP) ok(`${n}: (teeth) label count on un-fixed code`, true, String(c));
    else ok(`${n}: exactly one label`, c === 1, String(c));
  }
} finally { await browser.close(); }
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : `\nAll ${results.length} label checks passed.`);
process.exit(failed.length ? 1 : 0);
