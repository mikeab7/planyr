/* NEW-1 (parcel ARRIVAL cost, 2026-10-04) — NEW parcel outlines landing must not block the main thread.
 * B2061600 (#1956) made SETTLING over lots already held free. What was left is the moment a /query response LANDS
 * (first view of a zoom level, or a pan onto new ground): Michael's Chrome, Bartow GA, build f853752, Long Animation
 * Frame blockingDuration — z15→14 onto new data frames of 57 + 101 ms · pan onto new ground one 79 ms frame ·
 * z14→15 first time one 89 ms frame · everything already cached: zero blocking frames.
 *
 * THE MEASUREMENT (two reads; the TASK read is the gate, the FRAME read is printed — see the canvas note below):
 *   (1) the longest SINGLE main-thread task, read from a Chrome trace (`toplevel` ThreadControllerImpl::RunTask events on CrRendererMain —
 *       script, GC, style, layout and paint alike) over the window after the response lands;
 *   (2) the longest gap between animation frames (rAF) — the hitch the eye sees even when no one task is long
 *       (six 10 ms tasks in one frame are a 60 ms frame).
 * A MessageChannel heartbeat was tried first and REJECTED as the gate: Chrome runs queued network/XHR tasks ahead of
 * posted messages, so the heartbeat read a whole busy BURST (110 ms) where the trace shows the longest task was 34 ms.
 * Also learned the hard way: NEVER `return` the Leaflet map from a page.evaluate — Playwright serialises the whole
 * object graph (every held lot) and that, not the app, was a multi-second "task".
 *
 * Hermetic: every GIS host is mocked; the Bartow /query mock serves a Bartow-density parcel grid of ~10-vertex lots
 * (not 5-point squares: parse/index/project cost scales with vertices), answered after a real-network-like delay.
 * It is SYNTHETIC — no recorded Bartow response is reachable from this sandbox (egress blocked); the live check on
 * Michael's Chrome is V-number in VERIFICATION.md.
 * LOT NUMBERS ARE ON: the mock publishes Bartow's real number field (PARCELID) so the label layer's debounced relayout (a setTimeout) really runs — the first version published only OBJECTID, so that whole path was dead in the harness and a ~300 ms timer task Michael saw live never appeared (B2092656 ×2).
 * KNOWN-GOOD ARMS: void unless (a) a deliberate 60 ms block is seen by BOTH reads and (b) the layer actually holds
 * ≥ 5,000 lots at z14 (a run over an empty layer measures nothing). NOPARCELS=1 runs the same steps with Select
 * parcels off (the map's own floor). PROFILE=1 prints top self/inclusive JS functions per step.
 * Run:
 *   VITE_SUPABASE_URL="https://x.supabase.co" VITE_SUPABASE_ANON_KEY="dummy" npx vite build
 *   node node_modules/vite/bin/vite.js preview --port 4188 --strictPort &
 *   node ui-audit/verify-parcel-arrival-cost.mjs
 * BUDGET: no single main-thread task > ARRIVAL_BUDGET_MS (default 33 = two 60 Hz frames; the largest task left after this change is ONE response's JSON parse + ArcGIS→GeoJSON conversion, ~15-25 ms here, which only a worker transport could split) and no
 * frame gap > ARRIVAL_FRAME_BUDGET_MS (default 50 = where Chrome starts calling a frame "blocking") in the window
 * after: zoom onto new data · pan onto new ground · first zoom to a new level.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4188/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BUDGET_MS = Number(process.env.ARRIVAL_BUDGET_MS || 33);
/* Turning Select parcels on is React's commit for the toggle plus ONE layer construction (~25 ms in the display sync, its own timer task since B2092656 ×2) plus whatever GC lands in it (a 22-33 ms major GC was seen inside it). Main measured 48-85 ms as ONE task. Gated looser than the arrival arms, and said so. */
const SELECT_ON_BUDGET_MS = Number(process.env.SELECT_ON_BUDGET_MS || 33); // B2092656 ×3: 50 → 33 (20 ms measured on both builds here; the live gap was the saved copies — see verify-select-parcels-on-cost.mjs)
const FRAME_BUDGET_MS = Number(process.env.ARRIVAL_FRAME_BUDGET_MS || 50);
const PROFILE = process.env.PROFILE === "1";
const BARTOW = { lat: 34.20, lng: -84.83 };
const STEP = 0.001;
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`); };

const META_OK = JSON.stringify({ name: "Parcels", type: "Feature Layer", geometryType: "esriGeometryPolygon", currentVersion: 11.1, capabilities: "Query", maxRecordCount: 100000, fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }, { name: "PARCELID", type: "esriFieldTypeString", alias: "PARCELID" }], extent: { xmin: -85.1, ymin: 34.0, xmax: -84.5, ymax: 34.5, spatialReference: { wkid: 4326 } } });
const EMPTY = JSON.stringify({ type: "FeatureCollection", features: [] });
const counts = { query: 0, lots: 0 };
// A lot as a ~10-vertex ring (chamfered rectangle, deterministic wobble) so vertex-proportional work is realistic.
function ringFor(x, y, h, seed) {
  const w = h * (0.85 + 0.15 * ((seed * 7) % 5) / 4), c = h * 0.18, j = (n) => ((seed * (n + 3)) % 7) * h * 0.004;
  return [[x + c, y], [x + w - c, y + j(1)], [x + w, y + c], [x + w + j(2), y + h / 2], [x + w, y + h - c], [x + w - c, y + h], [x + c, y + h + j(3)], [x, y + h - c], [x - j(4), y + h / 2], [x, y + c], [x + c, y]];
}
function parcelsIn(env) {
  const feats = [];
  const i0 = Math.floor(env.xmin / STEP), i1 = Math.ceil(env.xmax / STEP), j0 = Math.floor(env.ymin / STEP), j1 = Math.ceil(env.ymax / STEP);
  for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) {
    const id = (i + 100000) * 100000 + (j + 100000);
    feats.push({ type: "Feature", id, properties: { OBJECTID: id, PARCELID: `A${id}` }, geometry: { type: "Polygon", coordinates: [ringFor(i * STEP, j * STEP, STEP * 0.45, id)] } });
    if (feats.length > 30000) return feats;
  }
  return feats;
}
function envelopeOf(u) {
  const g = new URL(u).searchParams.get("geometry");
  if (!g) return null;
  try { const o = JSON.parse(g); if (o.xmin != null) return o; } catch (_) {}
  const p = g.split(",").map(Number); return p.length === 4 ? { xmin: p[0], ymin: p[1], xmax: p[2], ymax: p[3] } : null;
}

/* WHY THE FRAME READ IS NOT THE GATE HERE (measured 2026-10-04): this sandbox has no GPU, and both ways of running canvas
 * 2D without one distort frames — software canvas rasterises every changed tile on the main thread at commit (~30 ms
 * per dense tile, `ProduceCanvasResource`), accelerated-SwiftShader instead stalls frame PRODUCTION for hundreds of ms
 * to seconds. Neither is Michael's GPU. The JS task length is what the app owns and is the same in both, so it is the
 * gate; GATE_FRAMES=1 gates the frame read too (meaningful on a machine with a real GPU).
 * Canvas raster path. Plain headless Chromium rasterises every changed 2D canvas ON THE MAIN THREAD at commit
 * (`CanvasResourceProviderSharedImage::ProduceCanvasResource`, ~30 ms per dense 512 px tile — measured), which is
 * a sandbox artefact: Michael's Chrome has GPU canvas, where that work is off the main thread and what is left on it is
 * script. These flags put canvas 2D on an accelerated (SwiftShader-emulated, GPU-process) path so the gate reads the
 * script cost the app actually owns. SOFTWARE_CANVAS=1 turns them off (the pessimistic reading, printed for the record). */
const GPU_CANVAS_ARGS = ["--enable-gpu-rasterization", "--enable-accelerated-2d-canvas", "--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors", ...(process.env.SOFTWARE_CANVAS === "1" ? [] : GPU_CANVAS_ARGS)] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await assertMeasurable(page, "verify-parcel-arrival-cost");
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
await page.addInitScript(`(() => { try {
  window.__PLANYR_E2E = true;
  localStorage.setItem("planarfit:sites:v1", ${JSON.stringify(JSON.stringify({ s_bartow: { id: "s_bartow", groupId: "s_bartow", site: "Bartow Verify Site", name: "Plan 1", status: "active", origin: { lat: BARTOW.lat, lon: BARTOW.lng }, county: "ga_bartow", parcels: [], els: [], updatedAt: Date.now() } }))});
  localStorage.removeItem("planarfit:currentSite:v1");
} catch (e) {} })();`);
const RESPONSE_DELAY_MS = 350;
await page.route("**/*", async (route) => {
  const u = route.request().url();
  if (u.includes("bartowgis.org") && /\/query(\?|$)/i.test(u)) await new Promise((r) => setTimeout(r, RESPONSE_DELAY_MS));
  if (!/\/(MapServer|FeatureServer)\//i.test(u)) return route.continue();
  if (u.includes("bartowgis.org")) {
    if (/\/query(\?|$)/i.test(u)) {
      counts.query++;
      const env = envelopeOf(u);
      const feats = env ? parcelsIn(env) : [];
      counts.lots += feats.length;
      if (new URL(u).searchParams.get("f") === "geojson") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ type: "FeatureCollection", features: feats }) });
      const esri = feats.map((f) => ({ attributes: { OBJECTID: f.id, PARCELID: f.properties.PARCELID }, geometry: { rings: f.geometry.coordinates } }));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ objectIdFieldName: "OBJECTID", geometryType: "esriGeometryPolygon", spatialReference: { wkid: 4326 }, fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }, { name: "PARCELID", type: "esriFieldTypeString", alias: "PARCELID" }], features: esri }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: META_OK });
  }
  if (/\/query(\?|$)/i.test(u)) return route.fulfill({ status: 200, contentType: "application/json", body: EMPTY });
  if (/\/export(\?|$)/i.test(u)) return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") });
  return route.fulfill({ status: 200, contentType: "application/json", body: META_OK });
});
await page.goto(BASE + "#/site", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
const row = page.locator('div[title*="Open site"]').filter({ hasText: "Bartow Verify Site" }).first();
await row.hover();
await row.locator('[aria-label="Show on map"]').click();
await page.waitForTimeout(1500);
console.log("  served chunks:", (await page.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name.split("/").pop()).filter((n) => /^(SitePlannerApp|map-vendor|MapFinder)-.*\.js$/.test(n)))).join(", "));
await page.waitForTimeout(1500);

const FP = `(() => { const fp = window.__fp = { gaps: [], on: false, last: 0 }; const loop = (t) => { if (fp.on) { if (fp.last) fp.gaps.push(t - fp.last); fp.last = t; } requestAnimationFrame(loop); }; requestAnimationFrame(loop); })()`;
await page.evaluate(FP);
function longestTasks(events) {
  const names = new Map(); events.filter((e) => e.name === "thread_name").forEach((e) => names.set(`${e.pid}:${e.tid}`, e.args && e.args.name));
  const rend = events.filter((e) => e.ph === "X" && names.get(`${e.pid}:${e.tid}`) === "CrRendererMain");
  const tasks = rend.filter((e) => e.name === "ThreadControllerImpl::RunTask").sort((a, b) => b.dur - a.dur);
  if (process.env.TASK_DETAIL === "1") tasks.slice(0, 3).filter((t) => t.dur > BUDGET_MS * 1000).forEach((t) => { // what ran INSIDE the longest tasks (names are trace events, not minified)
    const inside = rend.filter((e) => e !== t && e.ts >= t.ts && e.ts + e.dur <= t.ts + t.dur && e.dur > 4000 && e.name !== "Receive mojo message").sort((a, b) => b.dur - a.dur).slice(0, 7);
    console.log(`        task ${(t.dur / 1000).toFixed(0)} ms ⊃ ${inside.map((e) => `${e.name} ${(e.dur / 1000).toFixed(0)}`).join(" · ")}`);
  });
  return tasks.map((e) => e.dur / 1000);
}
async function measureWindow(run, waitMs) {
  await browser.startTracing(page, { categories: process.env.TASK_DETAIL === "1" ? ["toplevel", "devtools.timeline", "v8", "cc", "blink", "gpu", "disabled-by-default-devtools.timeline"] : ["toplevel", "devtools.timeline", "v8"] });
  await page.evaluate(() => { window.__fp.gaps = []; window.__fp.last = 0; window.__fp.on = true; });
  await page.waitForTimeout(100); // let the frame probe record its first frame so a block right after is a measurable gap
  await run();
  await page.waitForTimeout(waitMs);
  const frames = await page.evaluate(() => { window.__fp.on = false; return window.__fp.gaps.slice(); });
  const tasks = longestTasks(JSON.parse((await browser.stopTracing()).toString()).traceEvents);
  return { tasks, frames };
}
// KNOWN-GOOD ARM: a deliberate 60 ms block must be seen by both reads.
const probe = await measureWindow(() => page.evaluate(() => { const t = performance.now(); while (performance.now() - t < 60); }), 300);
const pT = probe.tasks[0] || 0, pF = Math.max(0, ...probe.frames);
expect("KNOWN-GOOD ARM: a deliberate 60 ms block reads as a ~60 ms task AND a visible frame gap", pT >= 55 && pT <= 130 && pF >= 33, `task ${pT.toFixed(0)} ms, frame gap ${pF.toFixed(0)} ms`);
const idleW = await measureWindow(async () => {}, 1500);
console.log(`  idle control: longest task ${(idleW.tasks[0] || 0).toFixed(0)} ms, longest frame gap ${Math.max(0, ...idleW.frames).toFixed(0)} ms`);

let cdp = null;
if (PROFILE) { cdp = await page.context().newCDPSession(page); await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 200 }); }
async function printProfile() {
    const { profile } = await cdp.send("Profiler.stop");
    const key = (n) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`;
    const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n])), dt = profile.timeDeltas;
    profile.samples.forEach((id, i) => { const k = key(byId.get(id)); self.set(k, (self.get(k) || 0) + (dt[i] || 0) / 1000); });
    [...self.entries()].filter(([k]) => !/^\((idle|program)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([k, v]) => console.log(`      ${v.toFixed(0).padStart(5)} ms self  ${k}`));
    const parent = new Map(); profile.nodes.forEach((n) => (n.children || []).forEach((c) => parent.set(c, n.id)));
    const incl = new Map();
    profile.samples.forEach((id, i) => { const seen = new Set(); for (let cur = id; cur != null; cur = parent.get(cur)) { const k = key(byId.get(cur)); if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) || 0) + (dt[i] || 0) / 1000); } } });
    [...incl.entries()].filter(([k]) => !/^\((root|program|idle)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log(`      ${v.toFixed(0).padStart(5)} ms incl  ${k}`));
  }
// ARM: turning Select parcels ON (Michael, build ccaca0c: frames of 283 and 211 ms). Everything is queued at once here:
// the metadata read, six cell queries, the first label layout.
let selectOn = { task: 0, frame: 0 };
if (process.env.NOPARCELS !== "1") {
  if (PROFILE) await cdp.send("Profiler.start");
  const w = await measureWindow(() => page.locator('[data-testid="map-toolbar-select-parcels"]').first().click(), 3500);
  selectOn = { task: w.tasks[0] || 0, frame: Math.max(0, ...w.frames) };
  if (PROFILE) await printProfile();
  console.log(`  Select parcels ON: longest task ${selectOn.task.toFixed(0)} ms · longest frame gap ${selectOn.frame.toFixed(0)} ms`);
}
const act = async (label, fn, waitMs = 3500) => {
  // The synchronous setView/panBy itself is the SETTLE (gated by verify-parcel-settle-cost); this gate is the
  // ARRIVAL, so measuring starts when the action's own call has returned.
  if (PROFILE) await cdp.send("Profiler.start");
  await page.evaluate(fn);
  const { tasks, frames } = await measureWindow(async () => {}, waitMs); // responses arrive (350 ms mock delay) and are absorbed
  const max = tasks[0] || 0, over = tasks.filter((g) => g > BUDGET_MS), maxFrame = Math.max(0, ...frames);
  console.log(`  ${label}: longest task ${max.toFixed(0)} ms · tasks over ${BUDGET_MS} ms: ${over.length} [${over.slice(0, 8).map((g) => g.toFixed(0)).join(", ")}] · longest frame gap ${maxFrame.toFixed(0)} ms (frames over ${FRAME_BUDGET_MS}: ${frames.filter((g) => g > FRAME_BUDGET_MS).length})`);
  if (PROFILE) await printProfile();
  return { task: max, frame: maxFrame };
};
// NB: never RETURN the Leaflet map from an evaluate (see header).
const setView = (lat, lng, z) => page.evaluate(([la, ln, zz]) => { window.__mapFinderMap.setView([la, ln], zz, { animate: false }); }, [lat, lng, z]);
const heldNow = () => page.evaluate(() => { const s = window.__mapParcelDisplay && window.__mapParcelDisplay(); return s ? s.held : 0; });
// "How many lots did the layer end up holding" — read once ingestion has STOPPED growing (a sliced response is, by design, still landing when the window ends).
const held = async () => { let cur = await heldNow(), same = 0; for (let i = 0; i < 60 && same < 5; i++) { await page.waitForTimeout(400); const n = await heldNow(); same = n === cur ? same + 1 : 0; cur = n; } return cur; };

const results = {};
await setView(BARTOW.lat, BARTOW.lng, 15); await page.waitForTimeout(3500);
results.zoomOutNew = await act("zoom 15 → 14 onto NEW data", () => { window.__mapFinderMap.setView(window.__mapFinderMap.getCenter(), 14, { animate: false }); });
const heldZ14 = await held();
results.panNew = await act("pan 500 px onto NEW ground (z14)", () => { window.__mapFinderMap.panBy([500, 0], { animate: false }); });
results.panCached = await act("pan back onto loaded ground (control: cached)", () => { window.__mapFinderMap.panBy([-500, 0], { animate: false }); }, 1500);
await setView(BARTOW.lat + 0.2, BARTOW.lng + 0.2, 15); await page.waitForTimeout(3500); // far away: fresh ground at z15
results.zoomInNew = await act("zoom 15 → 16 first time (new ground)", () => { window.__mapFinderMap.setView(window.__mapFinderMap.getCenter(), 16, { animate: false }); });
if (PROFILE) await cdp.send("Profiler.disable");

if (process.env.NOPARCELS !== "1") expect("KNOWN-GOOD ARM: the mocked Bartow service answered and a z14-scale number of lots is held (else the run is void)", counts.query > 0 && heldZ14 >= 5000, `queries=${counts.query}, lots served=${counts.lots}, held@z14=${heldZ14}`);
results.selectOn = selectOn;
for (const [k, label, budget = BUDGET_MS] of [["selectOn", "turning Select parcels on", SELECT_ON_BUDGET_MS], ["zoomOutNew", "zoom onto new data"], ["panNew", "pan onto new ground"], ["zoomInNew", "zoom to a new level"]]) {
  expect(`${label}: no single main-thread task over ${budget} ms while the response is absorbed`, results[k].task <= budget, `${results[k].task.toFixed(0)} ms`);
  if (process.env.GATE_FRAMES === "1") expect(`${label}: no frame gap over ${FRAME_BUDGET_MS} ms (a blocking frame) while the response is absorbed`, results[k].frame <= FRAME_BUDGET_MS, `${results[k].frame.toFixed(0)} ms`);
}
expect("no uncaught page errors", errs.length === 0, errs.join(" | "));
await browser.close();
console.log(`\n${failures ? `❌ ${failures} FAILED` : "✅ PASS"} — parcel arrival cost`);
process.exit(failures ? 1 : 0);
