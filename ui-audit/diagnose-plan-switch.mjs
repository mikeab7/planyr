#!/usr/bin/env node
/* diagnose-plan-switch — B1439, SECOND ATTEMPT: name the mechanism, or say what was ruled out.
 *
 * THE SIGNATURE, unchanged and reproducible. A → B → A leaves `rendererNodes` **+93.9 / +97.1 /
 * +96.6 / +95.2%** across four independent runs of the B1436 probe, while `documentNodes` and
 * `canvasNodes` return exactly. Renderer-wide nodes nearly doubling while ATTACHED nodes stay flat
 * is the signature of DOM the renderer is still keeping alive that is no longer in the document —
 * i.e. the plan you switched away from. **It was correctly NOT fixed**: B1434's rule is that a fix
 * shipped against a signal nobody can explain is not a fix, and `rendererNodes` also counts nodes
 * held only by JS, so the signature alone convicts nothing.
 *
 * WHAT THIS ADDS THAT THE FIRST ATTEMPT DID NOT HAVE. The probe could only compare COUNTERS. This
 * takes a real V8 heap snapshot on each side of the cycle and asks the two questions a counter
 * cannot answer:
 *   1. Does V8's own per-node `detachedness` flag say there are detached DOM nodes after the round
 *      trip, and how many? (B1433 measured this at ZERO across INTERACTION on one plan — never
 *      across a plan SWITCH, which is a different lifecycle entirely.)
 *   2. For the heaviest detached classes, WHO IS HOLDING THEM — the shortest retaining chain from a
 *      GC root, with the edge names, from `retainingPath` in lib/heapSnapshot.mjs.
 *
 * ⛔ IF THE MECHANISM CANNOT BE NAMED, THIS SCRIPT SAYS SO AND SAYS WHAT IT RULED OUT. That is a
 * result and it is written down so a third attempt does not start from zero. No fix is shipped
 * against an unexplained signal — B1434's rule stands.
 *
 *   xvfb-run -a --server-args="-screen 0 1600x1000x24" node ui-audit/diagnose-plan-switch.mjs
 *   ... --cycles 2 --json
 */
import { chromium } from "playwright";
import { perfScenarioSeedMulti, SCENARIO_ID, SCENARIO_ID_B } from "./lib/perf-scenario.mjs";
import { aggregateSnapshot, diffAggregates, edgeIndex, retainerIndex, holderOf, retainingPath, detachedNodes, detachedByClass, liveEntryPoints } from "./lib/heapSnapshot.mjs";
import { waitForSelectorReleased } from "./lib/waitRelease.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const CYCLES = Number(arg("--cycles", 1)) || 1;
const JSON_OUT = process.argv.includes("--json");
const PATHS = Number(arg("--paths", 6)) || 6;
/* ⛔ THE ARM THAT HAD TO EXIST. Every harness in this repo sets `window.__PLANYR_E2E`, which arms
 * four `window.__planner*` self-audit hooks inside SitePlanner. If those hooks strand the tree they
 * close over, then B1439's whole signature could be the INSTRUMENT rather than the product — and a
 * measurement that cannot tell those apart is worthless. `--no-e2e` runs the identical cycle with
 * the hooks absent. The route switch does not need them (it is a plain `location.hash` write), so
 * the arm is a true control and not a different experiment. */
const NO_E2E = process.argv.includes("--no-e2e");

const COUNTERS = `(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  return {
    documentNodes: document.getElementsByTagName("*").length,
    canvasNodes: svg ? svg.getElementsByTagName("*").length : 0,
    elementsDrawn: svg ? svg.querySelectorAll("[data-el-id]").length : 0,
    leafletTiles: document.querySelectorAll("img.leaflet-tile").length,
    leafletContainers: document.querySelectorAll(".leaflet-container").length,
  };
})()`;

async function counters(page, cdp) {
  try { for (let i = 0; i < 3; i++) await cdp.send("HeapProfiler.collectGarbage"); } catch (_) {}
  await page.waitForTimeout(300);
  const page_ = await page.evaluate(COUNTERS);
  const m = {};
  try { for (const { name, value } of (await cdp.send("Performance.getMetrics")).metrics || []) m[name] = value; } catch (_) {}
  return {
    ...page_,
    rendererNodes: m.Nodes ?? null,
    jsEventListeners: m.JSEventListeners ?? null,
    layoutObjects: m.LayoutObjects ?? null,
    heapMB: m.JSHeapUsedSize != null ? +(m.JSHeapUsedSize / 1048576).toFixed(2) : null,
  };
}

/* The snapshot arrives as a stream of JSON chunks over CDP — there is no single call that returns
 * one. Forced GC first, three times, so what is left is RETENTION and not uncollected garbage. */
async function snapshot(cdp) {
  const chunks = [];
  const onChunk = ({ chunk }) => chunks.push(chunk);
  cdp.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
  try {
    for (let i = 0; i < 3; i++) await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false, treatGlobalObjectsAsRoots: true });
    return JSON.parse(chunks.join(""));
  } catch (e) {
    return { __failed: `heap snapshot failed: ${e?.message || e}` };
  } finally {
    cdp.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
  }
}

/* ⛔ THE LISTENER CENSUS — the step that turns "something is holding the old tree" into a NAME.
 *
 * The retaining paths below bottom out at V8's own handle tables ("Traced handles" / "Global
 * handles"), which is what a DOM wrapper looks like when the thing keeping it alive is on the
 * BLINK side rather than at the end of a JS property chain. The commonest Blink-side holder by far
 * is an event listener that was never removed: Blink's EventTarget registry holds a traced
 * reference to the listener function, the function's closure holds the old component's refs, and
 * the whole detached tree rides along. So the useful question is not "which JS object points at
 * this node" — it is "which listeners are still registered that should not be".
 *
 * `DOMDebugger.getEventListeners` answers it exactly, with the registering script's line, which is
 * a source position and not a guess. Counted on the long-lived targets (window / document), because
 * a listener on a target that OUTLIVES the component is precisely the one whose cleanup failing is
 * invisible in every other measurement.
 */
async function listenerCensus(cdp, expression) {
  try {
    const { result } = await cdp.send("Runtime.evaluate", { expression, returnByValue: false });
    if (!result?.objectId) return { ok: false, why: `could not resolve ${expression}` };
    const { listeners } = await cdp.send("DOMDebugger.getEventListeners", { objectId: result.objectId, depth: 0 });
    const by = new Map();
    for (const l of listeners || []) {
      const key = `${l.type}  @${l.scriptId}:${(l.lineNumber ?? 0) + 1}:${(l.columnNumber ?? 0) + 1}${l.useCapture ? "  [capture]" : ""}`;
      by.set(key, (by.get(key) || 0) + 1);
    }
    return { ok: true, total: (listeners || []).length, by: Object.fromEntries(by) };
  } catch (e) { return { ok: false, why: String(e?.message || e) }; }
}

function listenerGrowth(before, after) {
  if (!before?.ok || !after?.ok) return { ok: false, why: before?.why || after?.why };
  const rows = [];
  for (const [k, n] of Object.entries(after.by)) {
    const was = before.by[k] || 0;
    if (n !== was) rows.push({ key: k, from: was, to: n, delta: n - was });
  }
  rows.sort((a, b) => b.delta - a.delta);
  return { ok: true, totalDelta: after.total - before.total, rows };
}

/* ⛔ B1439, RESOLVED — AND THIS FUNCTION WAS THE BUG. The line below used to read
 * `await page.waitForSelector(...)` with the return value ignored. `waitForSelector` returns an
 * ElementHandle, which is a STRONG V8 global handle in the inspector's object group, and Playwright
 * never disposes it for you. A Blink `Node` holds its PARENT strongly, so that one stranded handle
 * on the canvas `<svg>` pinned the whole previous plan's shell — header, rail, panels, all of it.
 * Twice per A→B→A round trip, which is exactly the "linear, ~2,342 nodes per round trip, released
 * never" signature this script was written to explain. Disposing it takes the detached count to 0
 * and `rendererNodes`/`jsEventListeners` to identical before/after. See lib/waitRelease.mjs and
 * §12–§15 of docs/PERF-PLAN-SWITCH.md. */
async function switchPlan(page, groupId) {
  await page.evaluate((g) => { window.location.hash = `#/project/${g}/site`; }, groupId);
  await page.waitForTimeout(2500);
  await waitForSelectorReleased(page, '[data-testid="planner-canvas"]', { timeout: 30000 });
  await page.waitForTimeout(1500);
}

const browser = await chromium.launch({
  executablePath: EXEC, headless: false,
  args: ["--no-sandbox", "--ignore-certificate-errors", "--disable-dev-shm-usage", "--enable-precise-memory-info"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
if (!NO_E2E) await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
await ctx.addInitScript(perfScenarioSeedMulti());
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
   setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
   suspends requestAnimationFrame, so after a view change the app's state attributes update while the
   drawing never repaints — every box, position, hit test and screenshot then agrees with every other
   and describes a view the app already left. One precondition covers both, rAF liveness probe
   included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
await assertMeasurable(page, "diagnose-plan-switch");
const cdp = await ctx.newCDPSession(page);
await cdp.send("Performance.enable").catch(() => {});
await cdp.send("HeapProfiler.enable").catch(() => {});
await page.goto(BASE, { waitUntil: "load" });
await waitForSelectorReleased(page, '[data-testid="planner-canvas"]', { timeout: 60000 });
await page.waitForTimeout(3000);

const a0 = await counters(page, cdp);
const listenersBefore = { window: await listenerCensus(cdp, "window"), document: await listenerCensus(cdp, "document") };
const snapBefore = await snapshot(cdp);
for (let c = 0; c < CYCLES; c++) {
  await switchPlan(page, SCENARIO_ID_B);
  await switchPlan(page, SCENARIO_ID);
}
const a1 = await counters(page, cdp);
const listenersAfter = { window: await listenerCensus(cdp, "window"), document: await listenerCensus(cdp, "document") };
const snapAfter = await snapshot(cdp);
await browser.close();

/* THE SWITCH HAS TO BE PROVEN. Plan B is half of plan A by construction, so if the element count
 * never moved the route change did not take and everything below describes plan A twice. */
const out = {
  cycles: CYCLES, a0, a1,
  listeners: {
    window: listenerGrowth(listenersBefore.window, listenersAfter.window),
    document: listenerGrowth(listenersBefore.document, listenersAfter.document),
  },
};
const failed = snapBefore.__failed || snapAfter.__failed;

const aggBefore = failed ? null : aggregateSnapshot(snapBefore);
const aggAfter = failed ? null : aggregateSnapshot(snapAfter);
out.growth = aggBefore && aggAfter ? diffAggregates(aggBefore, aggAfter, { minBytes: 8192, limit: 14 }) : { ok: false, why: failed };

let det = null, rix = null;
if (!failed) {
  const ix = edgeIndex(snapAfter);
  if (ix.ok) { rix = retainerIndex(ix); det = detachedNodes(ix, { limit: 4000 }); }
  else out.indexWhy = ix.why;
}
out.detached = det ? { known: det.detachedKnown, total: det.total ?? 0, totalBytes: det.totalBytes ?? 0, why: det.why || null } : null;
out.detachedBefore = (() => {
  if (failed) return null;
  const ixb = edgeIndex(snapBefore);
  if (!ixb.ok) return null;
  const d = detachedNodes(ixb, { limit: 4000 });
  return { known: d.detachedKnown, total: d.total ?? 0, totalBytes: d.totalBytes ?? 0 };
})();
out.detachedClasses = det ? detachedByClass(det, { limit: 10 }) : [];
out.paths = [];
if (rix && det?.detachedKnown) {
  for (const c of out.detachedClasses.slice(0, PATHS)) {
    out.paths.push({ klass: c.klass, nodes: c.nodes, bytes: c.bytes, ...holderOf(rix, c.sample) });
  }
}
/* NEW-3 — THE THIRD ATTEMPT'S QUESTION, and it is the complement of `holderOf`'s.
 * `holderOf` walks backwards out of the island and stops at the first retainer that is not FLAGGED
 * detached — but V8 flags only DOM wrappers, so a closure that is itself garbage satisfies that
 * rule and gets reported as the holder. This walks FORWARD from the GC roots refusing to pass
 * through anything detached, so every node it reaches is provably alive, and reports the edges that
 * cross from that live set into the island. See lib/heapSnapshot.mjs → liveEntryPoints. */
out.liveEntries = rix && det?.detachedKnown ? liveEntryPoints(rix, { limit: 30 }) : null;
/* And for each crossing, the chain from a GC ROOT down to the live holder — because "a live
 * CSSStyleDeclaration points at a detached div" names the boundary but not the owner, and the
 * owner is the source line this item is for. `retainingPath` is the RIGHT tool here and the wrong
 * one for a detached node (see its own note): the holder is alive, so its shortest chain from a
 * root is a real answer rather than the handle table every wrapper shares. */
if (out.liveEntries?.entries?.length) {
  for (const e of out.liveEntries.entries) e.holderPath = retainingPath(rix, e.holderIdx, { maxDepth: 14 });
}

if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }

const pct = (a, b) => (a && b ? `${(((b - a) / a) * 100).toFixed(1)}%` : "—");
console.log(`B1439 — plan A → B → A, ×${CYCLES}${NO_E2E ? "  [--no-e2e: the __PLANYR_E2E self-audit hooks are ABSENT]" : "  [__PLANYR_E2E hooks ARMED, as in every harness here]"}: does the plan you left stay alive in the renderer?\n`);
console.log(`  counter                 before      after      change`);
for (const k of ["rendererNodes", "documentNodes", "canvasNodes", "elementsDrawn", "layoutObjects", "jsEventListeners", "leafletTiles", "leafletContainers", "heapMB"]) {
  console.log(`  ${k.padEnd(20)} ${String(a0[k] ?? "—").padStart(9)}  ${String(a1[k] ?? "—").padStart(9)}   ${pct(a0[k], a1[k]).padStart(8)}`);
}
if (a1.elementsDrawn !== a0.elementsDrawn) console.log(`\n  ⚠ the round trip did not return to plan A's element count (${a0.elementsDrawn} → ${a1.elementsDrawn}) — treat every number above with that in mind.`);

console.log(`\n  LISTENERS STILL REGISTERED ON THE LONG-LIVED TARGETS after the round trip (source position from DOMDebugger, not a guess):`);
for (const [target, g] of Object.entries(out.listeners)) {
  if (!g.ok) { console.log(`     ${target}: ⚠ ${g.why}`); continue; }
  console.log(`     ${target}: net ${g.totalDelta >= 0 ? "+" : ""}${g.totalDelta} listener(s)${g.rows.length ? "" : " — nothing changed"}`);
  for (const r of g.rows.slice(0, 12)) console.log(`        ${r.delta > 0 ? "+" : ""}${String(r.delta).padStart(3)}   ${r.from} → ${r.to}   ${r.key}`);
}

console.log(`\n  DETACHED DOM, from V8's own per-node flag (not the rendererNodes-minus-attached proxy):`);
if (!out.detached) console.log(`     ⚠ UNAVAILABLE — ${failed || out.indexWhy || "the snapshot could not be indexed"}`);
else if (!out.detached.known) console.log(`     ⚠ UNKNOWN — ${out.detached.why}`);
else {
  console.log(`     before the cycle: ${out.detachedBefore?.total ?? "—"} nodes, ${((out.detachedBefore?.totalBytes ?? 0) / 1024).toFixed(1)} KB`);
  console.log(`     after  the cycle: ${out.detached.total} nodes, ${(out.detached.totalBytes / 1024).toFixed(1)} KB`);
}
if (out.detachedClasses.length) {
  console.log(`\n  THE HEAVIEST DETACHED CLASSES, and the first NON-DETACHED thing holding a sample of each:`);
  for (const p of out.paths) {
    console.log(`\n     ${p.klass} — ${p.nodes} node(s), ${(p.bytes / 1024).toFixed(1)} KB`);
    if (!p.ok) { console.log(`        ⚠ ${p.why}`); continue; }
    if (!p.held) { console.log(`        ⛔ ${p.why}`); continue; }
    for (const [i, s] of p.chain.entries()) {
      console.log(`        ${"  ".repeat(Math.min(i, 8))}${i ? "└ " : "HOLDER: "}${s.via ? `${s.via} → ` : ""}${s.node}${s.detached ? "  [detached]" : ""}${s.retainers > 1 ? `   (${s.retainers} retainers)` : ""}`);
    }
  }
}
console.log(`\n  WHERE THE LIVE HEAP TOUCHES THE DETACHED ISLAND (forward from the GC roots, never through a detached node —`);
console.log(`  so every holder below is PROVABLY ALIVE, which is the thing holderOf above cannot establish):`);
if (!out.liveEntries) console.log(`     ⚠ UNAVAILABLE — the snapshot could not be indexed`);
else if (!out.liveEntries.known) console.log(`     ⚠ UNKNOWN — ${out.liveEntries.why}`);
else if (!out.liveEntries.entries.length) console.log(`     ⛔ ${out.liveEntries.why}`);
else {
  console.log(`     ${out.liveEntries.crossings} crossing(s) from ${out.liveEntries.liveVisited.toLocaleString()} live nodes${out.liveEntries.truncated ? "  ⚠ TRUNCATED — the live walk hit its node ceiling, so this list may be incomplete" : ""}`);
  for (const e of out.liveEntries.entries) {
    console.log(`     ${(e.heldBytes / 1024).toFixed(1).padStart(8)} KB   ${e.holder}${e.holderNative ? " [native]" : ""}${e.holderSynthetic ? " [synthetic]" : ""}`);
    console.log(`                    └ ${e.via} → ${e.held}  [detached]`);
    if (e.holderPath?.ok) {
      console.log(`                    held from a GC root by:`);
      for (const s2 of e.holderPath.path) console.log(`                       ${s2.via ? `${s2.via} → ` : ""}${s2.node}${s2.retainers > 1 ? `   (${s2.retainers} retainers)` : ""}`);
    }
  }
}

console.log(`\n  WHAT GREW ACROSS THE CYCLE (self bytes by class, ≥8 KB):`);
if (!out.growth.ok) console.log(`     ⚠ ${out.growth.why}`);
else for (const r of out.growth.rows) console.log(`     ${(r.bytes.delta / 1024).toFixed(1).padStart(9)} KB   ${String(r.nodes.delta).padStart(7)} nodes   ${r.klass}`);
console.log(`\n  ⚠ A retaining path is the SHORTEST chain from a root, which is what DevTools shows and is usually the holder — it is not a dominator tree. Where a node has several retainers the count is printed beside it.`);
