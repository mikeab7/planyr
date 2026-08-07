#!/usr/bin/env node
/* verify-plan-switch-release — B1439's REGRESSION GUARD. Does switching plans release the plan you left?
 *
 * B1439 ran to four attempts and ~a thousand lines of diagnosis before its cause was named, and the
 * cause turned out to be one ignored return value in the measuring harness. Both halves of that are
 * reasons this guard exists: the product property is worth pinning, and so is the instrument's
 * ability to see it.
 *
 * WHAT IT ASSERTS. An A→B→A plan switch must leave essentially no detached DOM behind, and
 * `rendererNodes` must return to where it started.
 *
 * WHY IT CANNOT ROT GREEN. It runs the cycle twice. The GUARDED arm disposes its handles and must
 * come back clean — that is the assertion. The CONTROL arm strands one ElementHandle per switch,
 * reproducing B1439's defect exactly, and must come back DIRTY — that is the positive control, and
 * if it comes back clean the guard fails as NOT OBSERVING rather than passing. It also refuses to
 * report anything unless the plan switch is PROVEN by the drawn-element count changing (plan B is
 * half of plan A by construction), so a scenario that silently stopped switching fails loudly too.
 *
 * The decision table is pure and unit-tested in test/planSwitchRelease.test.js; this file only
 * gathers the four numbers it needs.
 *
 *   npm run perf:planswitch          (needs a build being served at BASE_URL, default :4173)
 *   ... --json
 */
import { chromium } from "playwright";
import { perfScenarioSeedMulti, SCENARIO_ID, SCENARIO_ID_B } from "./lib/perf-scenario.mjs";
import { edgeIndex, detachedNodes } from "./lib/heapSnapshot.mjs";
import { waitForSelectorReleased } from "./lib/waitRelease.mjs";
import { releaseVerdict } from "./lib/planSwitchRelease.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const CYCLES = Number(arg("--cycles", 1)) || 1;
const JSON_OUT = process.argv.includes("--json");

async function measure(cdp) {
  const chunks = [];
  const onChunk = ({ chunk }) => chunks.push(chunk);
  cdp.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
  try {
    for (let i = 0; i < 3; i++) await cdp.send("HeapProfiler.collectGarbage").catch(() => {});
    await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false, treatGlobalObjectsAsRoots: true });
    const ix = edgeIndex(JSON.parse(chunks.join("")));
    if (!ix.ok) throw new Error(ix.why);
    const d = detachedNodes(ix, { limit: 40000 });
    /* If V8 stopped reporting the flag, say so — a guard that silently reads 0 from an unavailable
     * measurement is worse than no guard. */
    if (!d.detachedKnown) throw new Error(`detachedness unavailable: ${d.why}`);
    const m = {};
    for (const { name, value } of (await cdp.send("Performance.getMetrics")).metrics || []) m[name] = value;
    return { detached: d.total ?? 0, kb: +((d.totalBytes ?? 0) / 1024).toFixed(1), rendererNodes: m.Nodes ?? 0 };
  } finally { cdp.off("HeapProfiler.addHeapSnapshotChunk", onChunk); }
}

const drawn = (page) => page.evaluate(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  return svg ? svg.querySelectorAll("[data-el-id]").length : -1;
});

/** @param strand  true = reproduce B1439 (keep the ElementHandle); false = the correct behaviour. */
async function runArm(strand) {
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
  await cdp.send("Performance.enable").catch(() => {});
  await cdp.send("HeapProfiler.enable").catch(() => {});
  await page.goto(BASE, { waitUntil: "load" });
  await waitForSelectorReleased(page, '[data-testid="planner-canvas"]', { timeout: 60000 });
  await page.waitForTimeout(3000);

  const before = await measure(cdp);
  const seen = [];
  const stranded = [];        // held on purpose in the control arm; released with the browser
  for (let c = 0; c < CYCLES; c++) {
    for (const g of [SCENARIO_ID_B, SCENARIO_ID]) {
      await page.evaluate((gid) => { window.location.hash = `#/project/${gid}/site`; }, g);
      await page.waitForTimeout(2500);
      if (strand) {
        const h = await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 30000 }).catch(() => null); // B1439-CONTROL: stranded ON PURPOSE
        if (h) stranded.push(h);
      } else {
        await waitForSelectorReleased(page, '[data-testid="planner-canvas"]', { timeout: 30000 });
      }
      await page.waitForTimeout(1500);
      seen.push(await drawn(page));
    }
  }
  const after = await measure(cdp);
  await browser.close();
  return { before, after, seen };
}

const guardedArm = await runArm(false);
const controlArm = await runArm(true);

/* The switch is PROVEN, not assumed: plan B is half of plan A, so the drawn-element count must take
 * at least two distinct values across the cycle. */
const switchProven = new Set(guardedArm.seen.filter((n) => n >= 0)).size >= 2;

const v = releaseVerdict(
  { detachedBefore: guardedArm.before.detached, detachedAfter: guardedArm.after.detached, rendererBefore: guardedArm.before.rendererNodes, rendererAfter: guardedArm.after.rendererNodes },
  { detachedBefore: controlArm.before.detached, detachedAfter: controlArm.after.detached },
  switchProven,
);

if (JSON_OUT) { console.log(JSON.stringify({ guardedArm, controlArm, switchProven, verdict: v }, null, 2)); process.exit(v.ok ? 0 : 1); }

console.log(`B1439 GUARD — does an A→B→A plan switch release the plan you left?  (×${CYCLES} round trip)\n`);
console.log(`  arm                                    detached before → after      rendererNodes before → after`);
console.log(`  guarded (handles disposed)             ${String(guardedArm.before.detached).padStart(8)} → ${String(guardedArm.after.detached).padEnd(8)}      ${String(guardedArm.before.rendererNodes).padStart(8)} → ${guardedArm.after.rendererNodes}`);
console.log(`  control (one handle stranded/switch)   ${String(controlArm.before.detached).padStart(8)} → ${String(controlArm.after.detached).padEnd(8)}      (positive control — MUST be dirty)`);
console.log(`\n  plan switch proven by drawn-element count changing: ${switchProven ? "yes" : "NO"}   (counts seen: ${guardedArm.seen.join(", ")})`);
console.log(`  detached left by the guarded arm: ${v.detachedLeft}  (limit ${v.thresholds.maxDetached})`);
console.log(`  rendererNodes delta:              ${v.rendererDelta >= 0 ? "+" : ""}${v.rendererDelta}  (limit +${v.thresholds.maxRendererDelta})`);
console.log(`  positive control stranded:        ${v.controlLeft}  (must be ≥ ${v.thresholds.minControlDetached})`);
if (v.ok) console.log(`\n  ✅ PASS — the plan switch releases the previous plan, and the instrument proved it can still see retention.`);
else { console.log(`\n  ❌ FAIL`); for (const f of v.failures) console.log(`     • ${f}`); }
process.exit(v.ok ? 0 : 1);
