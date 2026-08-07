#!/usr/bin/env node
/* diagnose-plan-switch-listeners — WHOLE-TREE listener census + Blink's own detached-tree roots.
 *
 * Written for B1439's fourth attempt (docs/PERF-PLAN-SWITCH.md §13) and kept because both readings
 * are generally useful and neither existed here before. B1439 itself is CLOSED — its cause was the
 * harness's own undisposed ElementHandle, not a listener — so treat what follows as a description of
 * two instruments, not of an open bug.
 *
 * READING 1. Every listener census in B1439's first three attempts covered `window` and
 * `document` ONLY, and Leaflet registers on its OWN container, which is neither. This walks the
 * whole live tree — `DOMDebugger.getEventListeners` with `depth: -1` from the document node, which
 * reports every listener in the subtree with the registering script position on each row — before
 * and after the cycle, and diffs it.
 *
 * AND THE QUESTION §9 DID NOT ASK, which is cheaper than all of it: `DOM.getDetachedDomNodes` asks
 * BLINK ITSELF for the detached trees it is holding, and reports each tree's ROOT. Three attempts
 * have characterised the island's interior (§4) and its live boundary (§8) without ever asking what
 * the TOP of it is. A root that is the planner's own mount point means something holds the React
 * tree; a root that is a Leaflet container means the map outlives its unmount; a root that is a
 * bare `<div>` names the thing to grep for. This is the one reading that tells the other two apart.
 *
 *   xvfb-run -a --server-args="-screen 0 1600x1000x24" node ui-audit/diagnose-plan-switch-listeners.mjs
 */
import { chromium } from "playwright";
import { perfScenarioSeedMulti, SCENARIO_ID, SCENARIO_ID_B } from "./lib/perf-scenario.mjs";
import { waitForSelectorReleased } from "./lib/waitRelease.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const CYCLES = Number(arg("--cycles", 1)) || 1;
const JSON_OUT = process.argv.includes("--json");

/* The whole-tree census. `depth: -1` reports the subtree, so one call from the document node covers
 * every live element — including Leaflet's containers, which window/document never did. Keyed by
 * type + registering script position so a diff names a SOURCE LINE and not just a count. */
async function treeCensus(cdp) {
  try {
    const { result } = await cdp.send("Runtime.evaluate", { expression: "document", returnByValue: false });
    if (!result?.objectId) return { ok: false, why: "could not resolve document" };
    const { listeners } = await cdp.send("DOMDebugger.getEventListeners", { objectId: result.objectId, depth: -1, pierce: true });
    const by = new Map();
    for (const l of listeners || []) {
      const key = `${l.type}  @${l.scriptId}:${(l.lineNumber ?? 0) + 1}:${(l.columnNumber ?? 0) + 1}${l.useCapture ? "  [capture]" : ""}`;
      by.set(key, (by.get(key) || 0) + 1);
    }
    return { ok: true, total: (listeners || []).length, by: Object.fromEntries(by) };
  } catch (e) { return { ok: false, why: String(e?.message || e) }; }
}

function growth(before, after) {
  if (!before?.ok || !after?.ok) return { ok: false, why: before?.why || after?.why };
  const rows = [];
  const keys = new Set([...Object.keys(before.by), ...Object.keys(after.by)]);
  for (const k of keys) {
    const was = before.by[k] || 0, now = after.by[k] || 0;
    if (now !== was) rows.push({ key: k, from: was, to: now, delta: now - was });
  }
  rows.sort((a, b) => b.delta - a.delta);
  return { ok: true, totalDelta: after.total - before.total, rows };
}

/* ASK BLINK, not the heap. `DOM.getDetachedDomNodes` is what the DevTools "Detached elements" panel
 * is built on: Blink reports the detached trees it is itself retaining, each as a root node id plus
 * the ids it retains. The root is the answer three attempts have never had. */
async function detachedTrees(cdp) {
  try {
    await cdp.send("DOM.enable").catch(() => {});
    await cdp.send("DOM.getDocument", { depth: -1, pierce: true }).catch(() => {});
    const res = await cdp.send("DOM.getDetachedDomNodes");
    const trees = [];
    for (const t of res.detachedNodes || []) {
      const root = t.treeNode || {};
      const describe = (n) => {
        if (!n) return "(none)";
        const attrs = [];
        for (let i = 0; i < (n.attributes || []).length; i += 2) attrs.push(`${n.attributes[i]}="${n.attributes[i + 1]}"`);
        return `<${(n.nodeName || "?").toLowerCase()}${attrs.length ? " " + attrs.slice(0, 4).join(" ") : ""}>`;
      };
      const countAll = (n) => 1 + (n.children || []).reduce((s, c) => s + countAll(c), 0);
      trees.push({ root: describe(root), retained: (t.retainedNodeIds || []).length, subtreeNodes: countAll(root), childSample: (root.children || []).slice(0, 6).map(describe) });
    }
    return { ok: true, trees };
  } catch (e) { return { ok: false, why: String(e?.message || e) }; }
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
const cdp = await ctx.newCDPSession(page);
await cdp.send("HeapProfiler.enable").catch(() => {});
await page.goto(BASE, { waitUntil: "load" });
await waitForSelectorReleased(page, '[data-testid="planner-canvas"]', { timeout: 60000 });
await page.waitForTimeout(3000);

const before = await treeCensus(cdp);
for (let c = 0; c < CYCLES; c++) {
  for (const g of [SCENARIO_ID_B, SCENARIO_ID]) {
    await page.evaluate((gg) => { window.location.hash = `#/project/${gg}/site`; }, g);
    await page.waitForTimeout(2500);
    await waitForSelectorReleased(page, '[data-testid="planner-canvas"]', { timeout: 30000 }); // B1439 — never strand the handle
    await page.waitForTimeout(1500);
  }
}
for (let i = 0; i < 3; i++) await cdp.send("HeapProfiler.collectGarbage").catch(() => {});
await page.waitForTimeout(500);
const after = await treeCensus(cdp);
const trees = await detachedTrees(cdp);
await browser.close();

const g = growth(before, after);
if (JSON_OUT) { console.log(JSON.stringify({ cycles: CYCLES, growth: g, trees }, null, 2)); process.exit(0); }

console.log(`Listener census over EVERY live element (not just window/document), across ×${CYCLES} A→B→A\n`);
if (!g.ok) console.log(`  ⚠ ${g.why}`);
else {
  console.log(`  whole-tree listener total: ${before.total} → ${after.total}   (net ${g.totalDelta >= 0 ? "+" : ""}${g.totalDelta})`);
  console.log(`  rows that changed (registering script position from DOMDebugger, not a guess):`);
  if (!g.rows.length) console.log(`     — nothing changed anywhere in the live tree.`);
  for (const r of g.rows.slice(0, 25)) console.log(`     ${r.delta > 0 ? "+" : ""}${String(r.delta).padStart(4)}   ${String(r.from).padStart(4)} → ${String(r.to).padStart(4)}   ${r.key}`);
}

console.log(`\n  WHAT BLINK ITSELF SAYS IT IS HOLDING — DOM.getDetachedDomNodes (the DevTools "Detached elements" panel's own source).`);
console.log(`  Each detached tree is reported by its ROOT, which is the reading a heap snapshot cannot give you:`);
if (!trees.ok) console.log(`     ⚠ ${trees.why}`);
else if (!trees.trees.length) console.log(`     ⛔ Blink reports NO detached trees — which contradicts the heap snapshot's 2,342 and is itself a finding.`);
else {
  console.log(`     ${trees.trees.length} detached tree(s):`);
  for (const t of trees.trees.slice(0, 20)) {
    console.log(`        ${String(t.subtreeNodes).padStart(5)} nodes   root ${t.root}`);
    if (t.childSample.length) console.log(`                       children: ${t.childSample.join("  ")}`);
  }
}
