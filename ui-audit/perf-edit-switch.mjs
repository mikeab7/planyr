#!/usr/bin/env node
/* perf-edit-switch — ORDINARY EDITING + PLAN SWITCHES: do repeated edits hitch, and does the heap stay flat across switches?
 * (NEW-1, B217540 ×3 / B1317824 ×3 — follow-up to PR #2112.)
 *
 * ⛔ THE REPORT. problem_reports 0c68509b (2026-10-07 20:54Z, build a7f43c3, plan sms4zs8unbkg "Concept D - Sylvestri
 * Retail", 110 elements): after #2112 the near-freeze was gone but a 220 s session still held 160 long tasks / 20.8 s
 * and 248 jank frames — ~10 tasks of 255-275 ms (≈200 ms of it in ONE function) while edits ran ~1/s, repeating roughly
 * every 30-60 frames — and the heap read 157 → 399 MB in 8 s across three edits with the element count flat at 110.
 *
 * WHAT THIS DRIVES. Reached from `perf-edit-cycle.mjs --switches N` (same fixtures, same budget file, same
 * paced/visible-tab discipline), or directly. The owner's plan (the committed fixture pulled from public.sites JOIN
 * public.site_elements) plus two other real plans on the same device are visited in rotation: for each of N visits
 * switch to the plan (a route change, as the project switcher does), wait for the canvas, then make EDITS on it —
 * a real pointer drag of one element out, back, and out again. Per visit it records:
 *   · long tasks (PerformanceObserver) and the LONG-ANIMATION-FRAME script attribution (function, file, char offset)
 *     — the same source the owner's recorder uses for `ltNames`, so a name in his capture can be resolved here;
 *   · every frame over 100 ms from a rAF sampler, with its timestamp → the CADENCE of any recurring hitch;
 *   · heap AFTER a forced GC (what is RETAINED, not what has not been collected yet — B1439's trap) and DOM nodes.
 * At the end: a heap-snapshot DETACHED-node count (retained dead DOM) beside the post-GC heap slope.
 *
 *   xvfb-run -a --server-args="-screen 0 1800x1000x24" node ui-audit/perf-edit-switch.mjs [--switches 12] [--edits 3] [--store-kb 3000]
 *            [--json] [--assert] [--label x] [--out file.json] [--profile]
 */
import { chromium } from "playwright";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFixture, buildFixtureState } from "./lib/fixtureSeeding.mjs";
import { fixtureSite } from "./lib/planFixture.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { waitForSelectorReleased } from "./lib/waitRelease.mjs";
import { selfTimeByFunction } from "./lib/cpuProfile.mjs";
import { edgeIndex, detachedNodes } from "./lib/heapSnapshot.mjs";
import { editSwitchVerdict } from "./lib/editSwitch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const argOf = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d; };
const has = (f) => process.argv.includes(f);
const SWITCHES = Number(argOf("--switches", 12)) || 12;
const EDITS = Number(argOf("--edits", 3)) || 3;
const DPR = Number(argOf("--dpr", "2.15")) || 2.15;
const VW = Number(argOf("--vw", 1722)), VH = Number(argOf("--vh", 700));
const JSON_OUT = has("--json"), ASSERT = has("--assert"), PROFILE = has("--profile"), ALLOC = has("--alloc");
const STORE_KB = Number(argOf("--store-kb", 0)) || 0;   // other plans on the device, like his 143-plan account (1.30 MB of plan JSON; localStorage read 3.88 MB)
const LABEL = argOf("--label", "run"), OUT = argOf("--out", "");
const typeOf = new Map();   // element id → type, from the committed fixtures (the DOM carries ids only)
const HOME = "edit-cycle-plan";   // the owner's Sylvestri plan (primary fixture, carries the IndexedDB rasters)

const INSTRUMENT = `(() => {
  window.__E2E = true;
  window.__lt = []; window.__loaf = []; window.__fr = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), +e.duration.toFixed(1)]); }).observe({ type: "longtask", buffered: true }); } catch (_) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__loaf.push({ t: Math.round(e.startTime), d: +e.duration.toFixed(1), b: +(e.blockingDuration || 0).toFixed(1), s: (e.scripts || []).map((s) => ({ fn: s.sourceFunctionName || "", inv: s.invoker || "", url: String(s.sourceURL || "").split("/").pop(), pos: s.sourceCharPosition, d: +s.duration.toFixed(1) })) }); }).observe({ type: "long-animation-frame", buffered: true }); } catch (_) {}
  let last = performance.now();
  const tick = (t) => { const dt = t - last; last = t; if (dt > 100) window.__fr.push([Math.round(t), Math.round(dt)]); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  /* COUNTS, not times: how many WHOLE-STORE-sized (> 500 KB) JSON.parse / JSON.stringify / localStorage.setItem calls ran. The
   * owner's ~200 ms hitch was exactly these, and a count is deterministic where a millisecond figure on a shared runner is not. */
  const BIG = 500000; window.__big = { parse: 0, stringify: 0, set: 0, setMs: 0 };
  window.__bigStacks = [];
  const P = JSON.parse; JSON.parse = function (t, ...r) { if (typeof t === "string" && t.length > BIG) { window.__big.parse++; if (window.__traceParse) window.__bigStacks.push(new Error().stack.split(String.fromCharCode(10)).slice(2, 7).map((x) => x.trim().split("/assets/").pop()).join(" < ")) } return P.call(this, t, ...r); };
  const S = JSON.stringify; JSON.stringify = function (...a) { const o = S.apply(this, a); if (typeof o === "string" && o.length > BIG) window.__big.stringify++; return o; };
  const SI = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (typeof v === "string" && v.length > BIG) { window.__big.set++; const t = performance.now(); try { return SI.call(this, k, v); } finally { window.__big.setMs += performance.now() - t; } } return SI.call(this, k, v); };
  window.__reset = () => { window.__lt.length = 0; window.__loaf.length = 0; window.__fr.length = 0; window.__big = { parse: 0, stringify: 0, set: 0, setMs: 0 }; window.__bigStacks.length = 0; };
  window.__read = () => ({ lt: window.__lt.slice(), loaf: window.__loaf.slice(), fr: window.__fr.slice(), big: { ...window.__big, setMs: +window.__big.setMs.toFixed(1) }, stacks: window.__bigStacks.slice() });
})();`;

const pointOnEl = (page, id) => page.evaluate((elId) => {
  const n = document.querySelector(`[data-feature="el:${elId}"]`);
  if (!n || typeof window.__plannerHitTarget !== "function") return null;
  const r = n.getBoundingClientRect();
  const ok = (x, y) => { const t = window.__plannerHitTarget(x, y); return t && t.kind === "el" && t.id === elId; };
  for (const gy of [0.5, 0.3, 0.7, 0.15, 0.85, 0.4, 0.6]) for (const gx of [0.5, 0.3, 0.7, 0.15, 0.85, 0.4, 0.6, 0.25, 0.75]) {
    const x = r.left + r.width * gx, y = r.top + r.height * gy;
    if (x > 40 && y > 80 && x < innerWidth - 40 && y < innerHeight - 40 && ok(x, y)) return { x: Math.round(x), y: Math.round(y) };
  }
  return null;
}, id);
const elIds = (page) => page.evaluate(() => [...new Set([...document.querySelectorAll('[data-feature^="el:"]')].map((n) => n.getAttribute("data-feature").slice(3)))]);
const featureCount = (page) => page.evaluate(() => new Set([...document.querySelectorAll("[data-feature]")].map((n) => n.getAttribute("data-feature"))).size);
const metrics = async (cdp) => { const g = {}; for (const { name, value } of (await cdp.send("Performance.getMetrics")).metrics || []) g[name] = value; return g; };

const browser = await chromium.launch({ executablePath: EXEC, headless: false, args: ["--no-sandbox", "--ignore-certificate-errors", "--disable-dev-shm-usage", "--enable-precise-memory-info"] });
const out = { label: LABEL, base: BASE, switches: SWITCHES, edits: EDITS, dpr: DPR, viewport: [VW, VH], visits: [], notes: [] };
try {
  for (const fx of ["sylvestri", "bain", "woods", "richfield"]) { try { for (const e of readFixture(fx).els || []) typeOf.set(e.id, e.type); } catch (_) {} }
  const built = await buildFixtureState(browser, { base: BASE, fixture: readFixture("sylvestri"), siteId: HOME, cacheDir: join(HERE, ".raster-cache"), viewport: { width: VW, height: VH } });
  const context = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR, ignoreHTTPSErrors: true, storageState: built.state });
  /* The other plans on the device: real fixtures, re-id'd, each its own project so a route change IS a plan switch. */
  const extra = {};
  for (const [fx, id] of [["bain", "sw-bain"], ["woods", "sw-woods"], ["richfield", "sw-richfield"]]) {
    try { const rec = fixtureSite(readFixture(fx), { id, name: `Switch ${fx}`, site: `Switch ${fx}` }); rec.groupId = id; rec.status = rec.status || "pursuit"; rec.role = rec.role || "pursuit"; extra[id] = rec; } catch (e) { out.notes.push(`fixture ${fx} unavailable: ${e.message}`); }
  }
  const OTHERS = Object.keys(extra);
  if (STORE_KB) {
    const names = ["bain", "sylvestri", "richfield", "weld", "woods", "tsakiris"];
    let bytes = 0, i = 0;
    while (bytes < STORE_KB * 1024 && i < 600) {
      const rec = fixtureSite(readFixture(names[i % names.length]), { id: `xtra-${i}`, name: `Extra ${i}`, site: `Extra ${i}` });
      rec.groupId = `xtra-g-${i}`; rec.status = rec.status || "pursuit"; rec.role = rec.role || "pursuit"; extra[rec.id] = rec; bytes += JSON.stringify(rec).length; i++;
    }
    out.store = { extraPlans: i, extraKB: Math.round(bytes / 1024) };
  }
  await context.addInitScript((x) => { try { const k = "planarfit:sites:v1"; const cur = JSON.parse(localStorage.getItem(k) || "{}"); localStorage.setItem(k, JSON.stringify({ ...x, ...cur })); } catch (_) {} }, extra);
  await context.addInitScript(INSTRUMENT);
  await context.addInitScript(() => { window.__PLANYR_E2E = true; });
  await context.route("**/*", (route) => { const u = route.request().url(); return u.startsWith(BASE) || u.startsWith("data:") || u.startsWith("blob:") ? route.continue() : route.abort(); });
  const page = await context.newPage();
  await assertMeasurable(page, "perf-edit-switch");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable"); await cdp.send("HeapProfiler.enable");

  const go = async (id) => {
    await page.evaluate((g) => { window.location.hash = `#/project/${g}/site`; }, id);
    await waitForSelectorReleased(page, '[data-testid="planner-canvas"]', { timeout: 60000 });   // never a bare waitForSelector (B1439)
    await pacedWait(page, 2500);
  };
  if (has("--trace-parse")) await page.addInitScript(() => { window.__traceParse = true; });
  await page.goto(`${BASE}#/project/${HOME}/site`, { waitUntil: "load" });
  await waitForSelectorReleased(page, '[data-testid="planner-canvas"]', { timeout: 60000 });
  await pacedWait(page, 3500);
  await assertMeasurable(page, "perf-edit-switch");

  const gc = async () => { for (let i = 0; i < 2; i++) { try { await cdp.send("HeapProfiler.collectGarbage"); } catch (_) {} await pacedWait(page, 120); } };
  const settle = async () => { await page.keyboard.press("Escape"); await page.mouse.click(Math.round(VW * 0.04), Math.round(VH * 0.5)).catch(() => {}); await page.waitForTimeout(250); };
  if (PROFILE) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 200 }); await cdp.send("Profiler.start"); }
  if (ALLOC) await cdp.send("HeapProfiler.startSampling", { samplingInterval: 8192, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  await gc();
  out.heap0MB = +((await metrics(cdp)).JSHeapUsedSize / 1048576).toFixed(1);
  const featuresSeen = [await featureCount(page)];
  let edits = 0, editedOk = 0;
  const editLog = [];    // one row per edit: { visit, plan, ms (wall of the gesture + settle), lt: [dur..], loaf: [...] }

  for (let v = 0; v < SWITCHES; v++) {
    const toPlan = v % 2 === 0 ? OTHERS[(v / 2) % OTHERS.length] : HOME;      // other, HOME, other, HOME… (HOME is where he edits)
    await go(toPlan);
    featuresSeen.push(await featureCount(page));
    await settle();
    /* candidates: rotate over element TYPES so the run does not only ever edit the same kind (a building drag is cheap,
     * the owner's slow edits were not — which kind is slow is itself a finding, reported per type) */
    const ids = await elIds(page);
    const byType = new Map();
    for (const id of ids) { const t = typeOf.get(id) || "other"; if (!byType.has(t)) byType.set(t, []); byType.get(t).push(id); }
    const order = []; for (let k = 0; order.length < ids.length; k++) { let any = false; for (const list of byType.values()) if (list[k] !== undefined) { order.push(list[k]); any = true; } if (!any) break; }
    let did = 0, tries = 0;
    for (const id of order) {
      if (did >= EDITS || tries >= EDITS * 4) break;
      const p = await pointOnEl(page, id);
      if (!p) continue;
      tries++;
      const box = () => page.evaluate((i) => { const n = document.querySelector(`[data-feature="el:${i}"]`); if (!n) return null; const r = n.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; }, id);
      const b0 = await box();
      const dx = did % 2 === 0 ? 60 : -60;
      await page.evaluate(() => window.__reset());
      const t0 = Date.now();
      await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + dx, p.y + 30, { steps: 8 }); await page.mouse.up();
      await page.waitForTimeout(600);           // let the commit's effects / debounced work land INSIDE the window
      const r = await page.evaluate(() => window.__read());
      const b1 = await box();
      const moved = b0 && b1 && (Math.abs(b1[0] - b0[0]) > 20 || Math.abs(b1[1] - b0[1]) > 10);
      /* a drag that moved nothing is a press on chrome / a locked or bonded member — not an edit, and its cost is not counted */
      if (!moved) { await settle(); continue; }
      edits++; editedOk++;
      editLog.push({ visit: v, plan: toPlan, id, type: typeOf.get(id) || "other", moved: true, wallMs: Date.now() - t0, lt: r.lt, loaf: r.loaf, fr: r.fr, big: r.big, ...(has("--trace-parse") ? { stacks: r.stacks } : {}) });
      did++;
      await settle();
    }
    if (did < EDITS) out.notes.push(`visit ${v} (${toPlan}): only ${did} of ${EDITS} edits could be made`);
    await gc();
    const m = await metrics(cdp);
    out.visits.push({ visit: v, plan: toPlan, edits: did, heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), nodes: m.Nodes, listeners: m.JSEventListeners });
    if (!JSON_OUT) process.stderr.write(`· visit ${String(v).padStart(2)} ${toPlan.padEnd(14)} edits ${did}  heap(post-GC) ${out.visits[v].heapMB} MB  nodes ${m.Nodes}  listeners ${m.JSEventListeners}\n`);
  }

  /* retained dead DOM at the end — a heap snapshot's `detachedness` flag */
  const chunks = []; const onChunk = ({ chunk }) => chunks.push(chunk);
  cdp.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
  for (let i = 0; i < 3; i++) await cdp.send("HeapProfiler.collectGarbage").catch(() => {});
  await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false, treatGlobalObjectsAsRoots: true });
  const ix = edgeIndex(JSON.parse(chunks.join(""))); cdp.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
  const det = ix.ok ? detachedNodes(ix, { limit: 40000 }) : { total: null, detachedKnown: false };
  out.detachedNodes = det.detachedKnown ? det.total : null;
  out.featuresSeen = featuresSeen;
  out.switchProven = new Set(featuresSeen).size >= 2;
  out.edits = edits; out.editedOk = editedOk;
  out.editLog = editLog;

  if (ALLOC) {
    /* bytes ALLOCATED during the run (collected ones included), by function — the garbage the heap spikes are made of */
    const { profile } = await cdp.send("HeapProfiler.stopSampling");
    const byFn = new Map(); let total = 0;
    const walk = (n) => { const cf = n.callFrame || {}; const k = `${cf.functionName || "(anon)"} @ ${String(cf.url || "").split("/").pop()}:${cf.lineNumber}`; byFn.set(k, (byFn.get(k) || 0) + (n.selfSize || 0)); total += n.selfSize || 0; for (const c of n.children || []) walk(c); };
    walk(profile.head);
    out.allocMB = +(total / 1048576).toFixed(0);
    out.allocTop = [...byFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, +(v / 1048576).toFixed(1)]);
  }
  if (PROFILE) {
    const { profile } = await cdp.send("Profiler.stop");
    out.profileTop = [...selfTimeByFunction(profile).entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => [k, +v.toFixed(1)]);
    if (OUT) writeFileSync(OUT.replace(/\.json$/, "") + ".cpuprofile", JSON.stringify(profile));
  }
  const budget = join(HERE, "perf-edit-switch.budget.json");
  out.verdict = editSwitchVerdict(out, existsSync(budget) ? JSON.parse(readFileSync(budget, "utf8")) : {});
  await context.close();
} finally { await browser.close(); }

if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 1));
if (JSON_OUT) console.log(JSON.stringify(out, null, 1));
else {
  const v = out.verdict;
  console.log(`\n${LABEL}: ${SWITCHES} plan switches, ${out.edits} edits (${out.editedOk} proven to move something)`);
  console.log(v.lines.join("\n"));
  if (out.allocTop) console.log(`\nALLOCATED ${out.allocMB} MB over the run (collected included)\n` + out.allocTop.map(([k, v2]) => `${String(v2).padStart(9)} MB  ${k}`).join("\n"));
  if (out.profileTop) console.log("\nTOP SELF TIME (ms)\n" + out.profileTop.map(([k, v2]) => `${String(v2).padStart(9)}  ${k}`).join("\n"));
}
if (ASSERT && !out.verdict.pass) process.exit(1);
