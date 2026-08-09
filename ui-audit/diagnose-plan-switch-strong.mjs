#!/usr/bin/env node
/* B1439, FOURTH ATTEMPT — STEP 11. STRONG reachability. The formulation §8 got one rule wrong on.
 *
 * WHY §8's ANSWER WAS INCOMPLETE. §8 walked forward from the GC roots and reported the edges
 * crossing into the detached island, under two rules: never expand a detached node (right), and
 * **never traverse THROUGH a handle table** (wrong here). Its stated reason for the second rule was
 * that every DOM wrapper sits in a handle table, so traversing them reaches every leaked node in two
 * steps and names the table — the always-true, never-useful answer §4a warned about.
 *
 * But that rule throws away the one thing it most needed to see. A BLINK-SIDE retention is exactly
 * what a strong handle-table edge looks like: Blink holds a `TracedReference` to the wrapper, and
 * the snapshot renders that as an edge from `(Traced handles)`. By refusing to traverse the tables,
 * §8 could only ever conclude "nothing live points into the island" — which is what it concluded,
 * and it then correctly inferred a Blink-side holder it could not name. It was one rule away.
 *
 * THE RIGHT RULE IS NOT "SKIP HANDLE TABLES", IT IS "SKIP WEAK EDGES." A `weak:` edge does not
 * retain — that is what weak means — so a path through one proves nothing, and §8's six crossings
 * every one bottomed out through a `weak:` edge, which is precisely why they explained nothing.
 * Traversing handle tables by their STRONG edges only keeps the useful case and drops the useless
 * one, instead of dropping both.
 *
 * So: the set strongly reachable from the GC roots, over non-weak edges, never expanding a detached
 * node. Everything in it is genuinely retained. The crossings out of it into the island are the
 * leak, and each names a holder that is strongly alive by construction — including native and
 * synthetic holders, which are reported here rather than filtered, because after steps 1/3/6/10
 * ruled out animations, listeners, observers and stack pinning, a Blink object IS the expected
 * answer and filtering it away is how three attempts kept arriving at "not named".
 *
 *   xvfb-run -a --server-args="-screen 0 1600x1000x24" node ui-audit/diagnose-plan-switch-strong.mjs
 */
import { chromium } from "playwright";
import { perfScenarioSeedMulti, SCENARIO_ID, SCENARIO_ID_B } from "./lib/perf-scenario.mjs";
import { edgeIndex, retainerIndex } from "./lib/heapSnapshot.mjs";
import { waitForSelectorReleased } from "./lib/waitRelease.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const CYCLES = Number(arg("--cycles", 1)) || 1;

async function snapshot(cdp) {
  const chunks = [];
  const onChunk = ({ chunk }) => chunks.push(chunk);
  cdp.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
  try {
    for (let i = 0; i < 3; i++) await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false, treatGlobalObjectsAsRoots: true });
    return JSON.parse(chunks.join(""));
  } finally { cdp.off("HeapProfiler.addHeapSnapshotChunk", onChunk); }
}

const browser = await chromium.launch({
  executablePath: EXEC, headless: false,
  args: ["--no-sandbox", "--ignore-certificate-errors", "--disable-dev-shm-usage", "--enable-precise-memory-info"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
await ctx.addInitScript(perfScenarioSeedMulti());
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
   setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
   suspends requestAnimationFrame, so after a view change the app's state attributes update while the
   drawing never repaints — every box, position, hit test and screenshot then agrees with every other
   and describes a view the app already left. One precondition covers both, rAF liveness probe
   included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
await assertMeasurable(page, "diagnose-plan-switch-strong");
const cdp = await ctx.newCDPSession(page);
await cdp.send("HeapProfiler.enable").catch(() => {});
await page.goto(BASE, { waitUntil: "load" });
await waitForSelectorReleased(page, '[data-testid="planner-canvas"]', { timeout: 60000 });
await page.waitForTimeout(3000);
for (let c = 0; c < CYCLES; c++) {
  for (const g of [SCENARIO_ID_B, SCENARIO_ID]) {
    await page.evaluate((gg) => { window.location.hash = `#/project/${gg}/site`; }, g);
    await page.waitForTimeout(2500);
    await waitForSelectorReleased(page, '[data-testid="planner-canvas"]', { timeout: 30000 }); // B1439 — never strand the handle
    await page.waitForTimeout(1500);
  }
}
const snap = await snapshot(cdp);
await browser.close();

const ix0 = edgeIndex(snap);
if (!ix0.ok) { console.log(`⚠ ${ix0.why}`); process.exit(1); }
const ix = retainerIndex(ix0);
const NW = ix.NW, EW = ix.EW;
const nName = (n) => ix.strings[ix.nodes[n * NW + ix.iName]] ?? "(unknown)";
const nType = (n) => ix.nodeTypes[ix.nodes[n * NW + ix.iType]] ?? "";
const nDet = (n) => ix.iDet >= 0 && ix.nodes[n * NW + ix.iDet] === 2;
const eType = (e) => ix.edgeTypes[ix.edges[e * EW + ix.iEType]] ?? "";
const eLabel = (e) => {
  const t = eType(e), raw = ix.edges[e * EW + ix.iEName];
  return `${t}:${t === "element" || t === "hidden" ? `[${raw}]` : (ix.strings[raw] ?? `#${raw}`)}`;
};
const label = (n) => `${nName(n)}${nType(n) !== "object" ? ` [${nType(n)}]` : ""}${nDet(n) ? "  ⟨DETACHED⟩" : ""}`;

/* STRONG forward closure from node 0 (the snapshot root), skipping `weak:` edges and never
 * expanding a detached node. Everything visited is genuinely retained; the detached nodes touched
 * from it are the island's true entry points. */
const alive = new Uint8Array(ix.nodeCount);
const prev = new Int32Array(ix.nodeCount).fill(-1);
const prevEdge = new Int32Array(ix.nodeCount).fill(-1);
const q = [0]; alive[0] = 1;
const crossings = [];
for (let qi = 0; qi < q.length; qi++) {
  const n = q[qi];
  for (let e = ix.firstEdge[n]; e < ix.firstEdge[n + 1]; e++) {
    if (eType(e) === "weak") continue;
    const to = Math.floor((ix.edges[e * EW + ix.iToNode] || 0) / NW);
    if (to < 0 || to >= ix.nodeCount || alive[to]) continue;
    if (nDet(to)) { crossings.push([n, e, to]); continue; }   // record the boundary, never expand it
    alive[to] = 1; prev[to] = n; prevEdge[to] = e; q.push(to);
  }
}
const detachedTotal = (() => { let c = 0; for (let n = 0; n < ix.nodeCount; n++) if (nDet(n)) c++; return c; })();

console.log(`B1439 STEP 11 — ×${CYCLES} A→B→A.  ${q.length.toLocaleString()} nodes are STRONGLY reachable from the GC roots (weak edges excluded, handle tables INCLUDED).`);
console.log(`${detachedTotal} detached wrappers; ${crossings.length} strong crossing(s) from the live set into the island.\n`);

const agg = new Map();
for (const [from, e, to] of crossings) {
  const key = `${label(from)}  ──${eLabel(e)}──▶  ${nName(to)}`;
  const cur = agg.get(key) || { count: 0, from, e, to };
  cur.count++; agg.set(key, cur);
}
const rows = [...agg.values()].sort((a, b) => b.count - a.count);
console.log(`THE STRONG BOUNDARY, by (holder ──edge──▶ held):`);
for (const r of rows.slice(0, 25)) console.log(`  ${String(r.count).padStart(5)} ×   ${label(r.from)}  ──${eLabel(r.e)}──▶  ${nName(r.to)}`);

console.log(`\nAND FOR EACH DISTINCT HOLDER, THE STRONG CHAIN FROM A GC ROOT DOWN TO IT — this is the retaining path,`);
console.log(`and unlike every path printed in attempts 1–3 every edge on it is STRONG, so it actually explains the retention:\n`);
const shown = new Set();
for (const r of rows.slice(0, 12)) {
  if (shown.has(r.from)) continue;
  shown.add(r.from);
  const chain = [];
  for (let n = r.from; n !== -1; n = prev[n]) { chain.push([n, prevEdge[n]]); if (chain.length > 40) break; }
  chain.reverse();
  console.log(`  ── holder: ${label(r.from)}   (${r.count} crossing(s))`);
  for (const [i, [n, e]] of chain.entries()) console.log(`     ${"  ".repeat(Math.min(i, 20))}${e >= 0 ? `${eLabel(e)} → ` : ""}${label(n)}`);
  console.log("");
}
