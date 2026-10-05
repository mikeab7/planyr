/* B2092656 ×3 — turning Select parcels ON must not freeze the map, measured with the RECORDED REAL saved copies.
 *
 * THE GAP THIS HARNESS EXISTS TO CLOSE. Michael's Chrome (build 947c0ff, Bartow GA 34.20/-84.83, 2026-10-04):
 * turning Select parcels on gave a 161 ms frame (108 blocking) then a 308 ms frame (256 blocking). The B2092656 ×2
 * synthetic harness (`verify-parcel-arrival-cost.mjs`) read 23–49 ms for the same toggle. Something on his session
 * was not in the instrument. Found by reading the toggle's own effect, then reproduced here:
 *
 *   entering select mode called `ensureSnapshot("chambers")` and `ensureSnapshot("waller")` UNCONDITIONALLY — the two
 *   TEXAS counties whose whole-county saved copy (B629) is kept in the browser — even with the map in Georgia. Each
 *   copy is ~37k / ~46k lots, 25 / 30 MB of GeoJSON (production, measured 2026-10-05). On a returning visit `idbGet`
 *   handed the whole object graph back to the main thread (a structured-clone deserialise — ONE long task per county:
 *   TWO long tasks, the shape of his two long frames); on a day the nightly job wrote a new vintage it was downloaded,
 *   `r.json()`-parsed and stored on the main thread. A signed-out, never-used-Texas harness has an empty IndexedDB, so
 *   that whole path was dead in the instrument. And a page HOLDING both copies paid for them in every later garbage
 *   collection: on main the zoom 15→14 right after Select-on read 98 ms here, 18 ms without them.
 *
 * WHAT IS RECORDED REAL DATA AND WHAT IS NOT, plainly: the Chambers and Waller saved copies are the REAL production
 * files, fetched once from https://planyr.io/api/parcel-cache/svc/<county> into RECORDED_DIR (55 MB, not committed).
 * The Bartow /query service is SYNTHETIC (Bartow-density, ~10-vertex lots, real PARCELID number field —
 * www.bartowgis.org is blocked by this sandbox's egress policy; see lib/bartowParcelMock.mjs).
 *
 * ONE SEQUENCE (a fresh browser profile each time; the longest SINGLE main-thread task in the window, Chrome trace):
 *   t1     Select-on over KATY (Waller is in view, and Waller's outlines come FROM its saved copy), IndexedDB empty →
 *          the copy is downloaded, parsed and stored. The map then visits Chambers so both copies end up stored — the
 *          state Michael's browser is in after any Texas session.
 *   g      reload, Select-on over BARTOW (the reported case: a returning visit with both copies stored).
 *   gZoom/gPanE/gPanS  then on the same page: zoom 15→14 onto new data · pan 500 px east · pan 350 px south.
 *   t2     reload, Select-on over KATY again (Waller's copy read back from storage).
 * KNOWN-GOOD ARMS (the run is VOID without them): a deliberate 60 ms block reads as ~60 ms; after t1 IndexedDB really
 * holds BOTH copies (else g measures an empty store — what hid this); Katy really DRAWS lots from Waller's copy in t1
 * and t2 (else t2 measured nothing); the Bartow layer really holds lots.
 * GATE (stated plainly): the sequence runs REPEAT times (default 3) and each arm is gated on its MEDIAN longest task,
 * ≤ BUDGET_MS (default 33 ms = two 60 Hz frames). Every run's number is printed. A median, because a full major GC
 * (45–55 ms here) lands at random in roughly one arm in five and is not a property of the code under test; it is
 * printed, never hidden. NOSNAP=1 serves "no saved copy" (the control). TASK_DETAIL=1 [DETAIL_OVER=ms] names what ran
 * inside each long task; PROFILE=1 prints the top JS functions per window (use an unminified build).
 * Run:
 *   VITE_SUPABASE_URL="https://x.supabase.co" VITE_SUPABASE_ANON_KEY="dummy" npx vite build
 *   node node_modules/vite/bin/vite.js preview --port 4188 --strictPort &
 *   node ui-audit/verify-select-parcels-on-cost.mjs
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { BARTOW, routeBartowGis, longestTasks } from "./lib/bartowParcelMock.mjs";

const KATY = { lat: 29.786, lng: -95.825 }; // inside Waller's area — Waller's outlines come from its saved copy
const CHAMBERS = { lat: 29.75, lng: -94.68 };
const BASE = process.env.BASE_URL || "http://localhost:4188/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BUDGET_MS = Number(process.env.SELECT_ON_BUDGET_MS || 33);
const REPEAT = Math.max(1, Number(process.env.REPEAT || 3));
const RECORDED_DIR = process.env.RECORDED_DIR || "/tmp/planyr-recorded-parcel-snapshots";
const NOSNAP = process.env.NOSNAP === "1";
const DETAIL = process.env.TASK_DETAIL === "1";
const COUNTIES = ["chambers", "waller"];
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`); };

/* ── the recorded real saved copies ── */
fs.mkdirSync(RECORDED_DIR, { recursive: true });
const recorded = {};
for (const c of COUNTIES) {
  const meta = path.join(RECORDED_DIR, `${c}.meta.json`), full = path.join(RECORDED_DIR, `${c}.json`);
  if (!fs.existsSync(full) || !fs.existsSync(meta)) {
    console.log(`  recording ${c} from planyr.io …`);
    const m = await fetch(`https://planyr.io/api/parcel-cache/svc/${c}?meta=1`); if (!m.ok) throw new Error(`meta ${c}: HTTP ${m.status}`);
    fs.writeFileSync(meta, await m.text());
    const f = await fetch(`https://planyr.io/api/parcel-cache/svc/${c}`); if (!f.ok) throw new Error(`full ${c}: HTTP ${f.status}`);
    fs.writeFileSync(full, Buffer.from(await f.arrayBuffer()));
  }
  recorded[c] = { meta: fs.readFileSync(meta, "utf8"), full: fs.readFileSync(full) };
  const m = JSON.parse(recorded[c].meta);
  console.log(`  recorded ${c}: ${m.count} lots, ${(recorded[c].full.length / 1e6).toFixed(1)} MB, vintage ${m.generatedAt}`);
}

const GPU_CANVAS_ARGS = ["--enable-gpu-rasterization", "--enable-accelerated-2d-canvas", "--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", ...(process.env.SOFTWARE_CANVAS === "1" ? [] : GPU_CANVAS_ARGS)] });
const ARMS = [
  ["t1", "TEXAS · Select-on over Katy, saved copy new today"],
  ["g", "GEORGIA · Select-on over Bartow, returning visit (the reported case)"],
  ["gZoom", "GEORGIA · then zoom 15 → 14 onto new data"],
  ["gPanE", "GEORGIA · then pan 500 px east onto new ground"],
  ["gPanS", "GEORGIA · then pan 350 px south onto new ground"],
  ["t2", "TEXAS · Select-on over Katy, returning visit"],
];
const all = Object.fromEntries(ARMS.map(([k]) => [k, []]));
const goods = []; // [label, ok, detail] per run

async function runOnce(run) {
  console.log(`\n── run ${run}/${REPEAT} (fresh browser profile)`);
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } }); // ONE context per run: IndexedDB survives the reloads inside it
  const page = await context.newPage();
  await assertMeasurable(page, "verify-select-parcels-on-cost");
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.addInitScript(`(() => { try {
    window.__PLANYR_E2E = true;
    localStorage.setItem("planarfit:sites:v1", ${JSON.stringify(JSON.stringify({ s_bartow: { id: "s_bartow", groupId: "s_bartow", site: "Bartow Verify Site", name: "Plan 1", status: "active", origin: { lat: BARTOW.lat, lon: BARTOW.lng }, county: "ga_bartow", parcels: [], els: [], updatedAt: Date.now() } }))});
    localStorage.removeItem("planarfit:currentSite:v1");
  } catch (e) {} })();`);
  const counts = await routeBartowGis(page);
  const snapHits = { meta: 0, full: 0 };
  await page.route(/\/api\/parcel-cache\/svc\//, (route) => {
    const u = new URL(route.request().url());
    const c = u.pathname.split("/").pop();
    if (NOSNAP || !recorded[c]) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cached: false }) });
    if (u.searchParams.get("meta") === "1") { snapHits.meta++; return route.fulfill({ status: 200, contentType: "application/json", body: recorded[c].meta }); }
    snapHits.full++;
    return route.fulfill({ status: 200, contentType: "application/json", body: recorded[c].full });
  });

  let cdp = null;
  async function printProfile() { // PROFILE=1: top inclusive JS over the window (read with an unminified build)
    const { profile } = await cdp.send("Profiler.stop");
    const key = (n) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`;
    const byId = new Map(profile.nodes.map((n) => [n.id, n])), dt = profile.timeDeltas;
    const parent = new Map(); profile.nodes.forEach((n) => (n.children || []).forEach((c) => parent.set(c, n.id)));
    const incl = new Map();
    profile.samples.forEach((id, i) => { const seen = new Set(); for (let cur = id; cur != null; cur = parent.get(cur)) { const k = key(byId.get(cur)); if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) || 0) + (dt[i] || 0) / 1000); } } });
    [...incl.entries()].filter(([k]) => !/^\((root|program|idle)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 14).forEach(([k, v]) => console.log(`      ${v.toFixed(0).padStart(5)} ms incl  ${k}`));
  }
  async function measureWindow(act, waitMs) {
    if (process.env.PROFILE === "1") { if (!cdp) { cdp = await context.newCDPSession(page); await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 200 }); } await cdp.send("Profiler.start"); }
    await browser.startTracing(page, { categories: DETAIL ? ["toplevel", "devtools.timeline", "v8", "blink", "disabled-by-default-devtools.timeline"] : ["toplevel", "devtools.timeline", "v8"] });
    await page.waitForTimeout(100);
    await act();
    await page.waitForTimeout(waitMs);
    if (process.env.PROFILE === "1") await printProfile();
    return longestTasks(JSON.parse((await browser.stopTracing()).toString()).traceEvents, { detailOver: DETAIL ? Number(process.env.DETAIL_OVER || BUDGET_MS) : Infinity });
  }
  async function openMap(lat, lng) {
    await page.goto("about:blank"); // a hash-only goto is a same-document navigation — it would NOT reload, and each arm needs a fresh page (empty memory, IndexedDB kept)
    await page.goto(BASE + "#/site", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const row = page.locator('div[title*="Open site"]').filter({ hasText: "Bartow Verify Site" }).first();
    await row.hover();
    await row.locator('[aria-label="Show on map"]').click();
    await page.waitForTimeout(1200);
    await page.evaluate(([la, ln]) => { window.__mapFinderMap.setView([la, ln], 15, { animate: false }); }, [lat, lng]); // NB: never RETURN the map from an evaluate (Playwright serialises every held lot)
    await page.waitForTimeout(2500);
    if (run === 1) console.log("  served chunks:", (await page.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name.split("/").pop()).filter((n) => /^(SitePlannerApp|MapFinder)-.*\.js$/.test(n)))).join(", "));
  }
  // Which saved-copy keys IndexedDB holds (keys only — reading a value would deserialise it).
  const idbKeys = () => page.evaluate(() => new Promise((res) => {
    const out = [];
    let req; try { req = indexedDB.open("planyr"); } catch (_) { return res(out); }
    req.onerror = () => res(out);
    req.onsuccess = () => {
      const db = req.result; const names = [...db.objectStoreNames];
      if (!names.length) { db.close(); return res(out); }
      const tx = db.transaction(names, "readonly");
      names.forEach((n) => { const k = tx.objectStore(n).getAllKeys(); k.onsuccess = () => { k.result.filter((x) => String(x).startsWith("parcel-snapshot:")).forEach((x) => out.push(String(x))); }; });
      tx.oncomplete = () => { db.close(); res(out); };
      tx.onerror = () => { db.close(); res(out); };
    };
  }));
  const storedCounties = (keys) => COUNTIES.filter((c) => keys.some((k) => k.includes(`:${c}:`) && /:(full|meta)$/.test(k)));
  const heldNow = () => page.evaluate(() => { const s = window.__mapParcelDisplay && window.__mapParcelDisplay(); return s ? s.held : 0; });
  const wallerDrawn = async () => { for (let i = 0; i < 20; i++) { const n = await page.evaluate(() => { const s = window.__mapParcelDisplay && window.__mapParcelDisplay(); const l = s && s.layers.find((x) => x.key === "waller"); return l ? l.drawn : 0; }); if (n > 0) return n; await page.waitForTimeout(250); } return 0; };
  const clickSelect = () => page.locator('[data-testid="map-toolbar-select-parcels"]').first().click();
  const note = (k, t, extra = "") => { all[k].push(t[0] || 0); console.log(`  ${k.padEnd(5)} longest ${(t[0] || 0).toFixed(0).padStart(3)} ms · next [${t.slice(1, 4).map((x) => x.toFixed(0)).join(", ")}]${extra}`); };

  // t1
  await openMap(KATY.lat, KATY.lng);
  const probe = await measureWindow(() => page.evaluate(() => { const t = performance.now(); while (performance.now() - t < 60); }), 300);
  goods.push(["a deliberate 60 ms block reads as a ~60 ms task", probe[0] >= 55 && probe[0] <= 130, `${(probe[0] || 0).toFixed(0)} ms`]);
  note("t1", await measureWindow(clickSelect, 7000), ` · saved-copy requests meta=${snapHits.meta} full=${snapHits.full}`);
  const t1Drawn = await wallerDrawn();
  await page.evaluate(([la, ln]) => { window.__mapFinderMap.setView([la, ln], 15, { animate: false }); }, [CHAMBERS.lat, CHAMBERS.lng]);
  let keys = [];
  for (let i = 0; i < 40; i++) { await page.waitForTimeout(500); keys = await idbKeys(); if (storedCounties(keys).length === COUNTIES.length) break; }
  if (!NOSNAP) {
    goods.push(["after a Texas session IndexedDB holds BOTH real saved copies (else g measures an empty store — what hid this)", storedCounties(keys).length === COUNTIES.length, storedCounties(keys).join(", ") || "none"]);
    goods.push(["t1: Katy really DRAWS lots from Waller's saved copy", t1Drawn > 100, `${t1Drawn} drawn`]);
  }
  // g, then the arrival arms on the same page
  await openMap(BARTOW.lat, BARTOW.lng);
  let before = { ...snapHits };
  note("g", await measureWindow(clickSelect, 7000), ` · saved-copy requests meta=${snapHits.meta - before.meta} full=${snapHits.full - before.full}`);
  goods.push(["g: the Bartow layer really holds lots after the toggle", (await heldNow()) > 500 && counts.query > 0, `queries ${counts.query}`]);
  await page.waitForTimeout(2500);
  const after = async (k, fn) => { await page.evaluate(fn); note(k, await measureWindow(async () => {}, 3500)); };
  await after("gZoom", () => { window.__mapFinderMap.setView(window.__mapFinderMap.getCenter(), 14, { animate: false }); });
  await after("gPanE", () => { window.__mapFinderMap.panBy([500, 0], { animate: false }); });
  await after("gPanS", () => { window.__mapFinderMap.panBy([0, 350], { animate: false }); });
  // t2
  await openMap(KATY.lat, KATY.lng);
  before = { ...snapHits };
  note("t2", await measureWindow(clickSelect, 7000), ` · saved-copy requests meta=${snapHits.meta - before.meta} full=${snapHits.full - before.full}`);
  const t2Drawn = await wallerDrawn();
  if (!NOSNAP) goods.push(["t2: Katy draws lots from Waller's copy read back from storage (no re-download)", t2Drawn > 100 && snapHits.full - before.full === 0, `${t2Drawn} drawn, downloads ${snapHits.full - before.full}`]);
  goods.push(["no uncaught page errors", errs.length === 0, errs.join(" | ")]);
  await context.close();
}

for (let r = 1; r <= REPEAT; r++) await runOnce(r);
await browser.close();

console.log("\n── known-good arms (every run)");
const byLabel = new Map();
goods.forEach(([l, ok, d]) => { const e = byLabel.get(l) || { ok: true, d: [] }; e.ok = e.ok && ok; e.d.push(d); byLabel.set(l, e); });
byLabel.forEach((e, l) => expect(`KNOWN-GOOD: ${l}`, e.ok, e.d.join(" | ")));
console.log(`── gate: median of ${REPEAT} run(s), ≤ ${BUDGET_MS} ms`);
const median = (a) => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
for (const [k, label] of ARMS) expect(`${label}: median longest main-thread task ≤ ${BUDGET_MS} ms`, median(all[k]) <= BUDGET_MS, `median ${median(all[k]).toFixed(0)} ms · runs [${all[k].map((x) => x.toFixed(0)).join(", ")}]`);
console.log(`\n${failures ? `❌ ${failures} FAILED` : "✅ PASS"} — Select parcels on (recorded real saved copies${NOSNAP ? ", NOSNAP control" : ""})`);
process.exit(failures ? 1 : 0);
