#!/usr/bin/env node
/* perf-edit-cycle — DOES AN EDIT CYCLE GET MORE EXPENSIVE THE MORE TIMES YOU REPEAT IT? (NEW-1, B217540)
 *
 * ⛔ THE REPORT. The owner's own "Something was slow just now" (problem_reports 5f82f13a, build 6338802, plan
 * smu1t5vcp73y "Phase II - 1.2M"): after ~5 minutes of Copy → paste of whole building assemblies, moves and road
 * resizes, 229 long tasks / 41.5 s of main-thread blocking, the biggest (940, 937, 714, 706 ms) attributed to `P0`,
 * which in that build's React bundle is `dispatchDiscreteEvent` — i.e. the SYNCHRONOUS render a click / key event
 * triggers. The heap read 136 → 344 MB in 11 s while the element count barely moved.
 *
 * THE QUESTION THIS ANSWERS, which no prior instrument asked: not "what does a pan cost" (B1432, flat) and not
 * "what grows over a mixed session" (session-growth.mjs), but **the SAME edit sequence repeated N times on the
 * owner's real plan — does cycle N cost more than cycle 1?** Cost per cycle is read three ways that cannot all be
 * artefacts of one instrument: main-thread work from CDP `Performance.getMetrics` (script + layout + style, µs
 * resolution), the long-task observer (what the owner's recorder reports), and a heap / DOM reading taken AFTER a
 * forced GC so it measures what is RETAINED rather than what has not been collected yet (B1439's trap).
 *
 * THE CYCLE (every input is REAL pointer / keyboard input through Playwright — a synthetic keystroke does not edit
 * the plan, SYNTHETIC-KEYS-DONT-EDIT):
 *   1. click a building assembly's host   2. Ctrl+C   3. Ctrl+V at the cursor (a whole assembly lands)
 *   4. drag the pasted building           5. drag a road's endpoint grip out and back (a RESIZE)
 *   6. Delete the pasted copy (so the MODEL stays the same size; `--keep` leaves the copies, which is what grew
 *      the owner's element count 62 → 66).
 *
 *   xvfb-run -a --server-args="-screen 0 1800x1000x24" node ui-audit/perf-edit-cycle.mjs [--cycles 10] [--keep]
 *            [--fixture goose2] [--profile] [--json] [--assert]
 *
 * ⚠ HEADED on a real X server (B1086: a hidden tab starves rAF; FOREGROUND-OR-VOID).
 * `--assert` makes it a GATE: it exits non-zero when the per-cycle cost slope or the retained-heap slope exceeds
 * the budget in ui-audit/perf-edit-cycle.budget.json (see that file for how the numbers were chosen).
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFixture, buildFixtureState } from "./lib/fixtureSeeding.mjs";
import { fixtureSite } from "./lib/planFixture.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { waitForSelectorReleased } from "./lib/waitRelease.mjs";
import { selfTimeByFunction } from "./lib/cpuProfile.mjs";
import { editCycleVerdict, linearFitXY } from "./lib/editCycle.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const argOf = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d; };
const has = (f) => process.argv.includes(f);
const CYCLES = Number(argOf("--cycles", 10)) || 10;
const FIXTURE = argOf("--fixture", "goose2");
const DPR = Number(argOf("--dpr", "2.15")) || 2.15;
const VW = Number(argOf("--vw", 1722)), VH = Number(argOf("--vh", 700));
const KEEP = has("--keep"), PROFILE = has("--profile"), JSON_OUT = has("--json"), ASSERT = has("--assert");
const STORE_KB = Number(argOf("--store-kb", 0)) || 0;     // extra device-store weight: other plans in localStorage, like his 143-plan account
const FAT_KB = Number(argOf("--fat-plan-kb", 0)) || 0;     // one plan carrying an inline blob (his largest cloud row is ~935 KB)
const WARMUP = Number(argOf("--warmup", 1));              // leading cycles excluded from the SLOPE: cycle 0 pays JIT + first-save costs no later cycle pays
const LABEL = argOf("--label", "run");
const OUT = argOf("--out", "");
const SITE = "edit-cycle-plan";
const HOST_BUILDING = "e1455330pwyncw";   // a real dock-door building with a full bonded assembly (court, trailers, sidewalks, parking)
const ROAD = "e1455353iiphwv";             // the long centreline road the owner resized

const INSTRUMENT = `(() => {
  window.__E2E = true;
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), +e.duration.toFixed(1)]); }).observe({ type: "longtask", buffered: true }); } catch (_) {}
  window.__ltReset = () => { window.__lt.length = 0; };
  window.__ltRead = () => window.__lt.slice();
})();`;

/* ── page-side helpers ───────────────────────────────────────────────────────────────────────── */

/** A screen point at which the app's OWN hit test answers `el:<id>` — never a re-implementation of it. */
const pointOnEl = (page, id, offCentre = false) => page.evaluate(([elId, off]) => {
  const n = document.querySelector(`[data-feature="el:${elId}"]`);
  if (!n || typeof window.__plannerHitTarget !== "function") return null;
  const r = n.getBoundingClientRect();
  const tryPt = (x, y) => { const t = window.__plannerHitTarget(x, y); return t && t.kind === "el" && t.id === elId; };
  for (let gy = 0.5, k = 0; k < 9; k++, gy = [0.5, 0.3, 0.7, 0.15, 0.85, 0.4, 0.6, 0.25, 0.75][k % 9])
    for (const gx of (off ? [0.2, 0.8, 0.3, 0.7, 0.12, 0.88, 0.4, 0.6] : [0.5, 0.3, 0.7, 0.15, 0.85, 0.4, 0.6, 0.25, 0.75, 0.05, 0.95])) {
      const x = r.left + r.width * gx, y = r.top + r.height * gy;
      if (x > 0 && y > 40 && x < innerWidth - 8 && y < innerHeight - 8 && tryPt(x, y)) return { x: Math.round(x), y: Math.round(y) };
    }
  return null;
}, [id, offCentre]);

const featureIds = (page) => page.evaluate(() => [...new Set([...document.querySelectorAll("[data-feature]")].map((n) => n.getAttribute("data-feature")))]);
const counters = (page) => page.evaluate(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  return {
    domNodes: document.getElementsByTagName("*").length,
    canvasNodes: svg ? svg.getElementsByTagName("*").length : 0,
    features: new Set([...document.querySelectorAll("[data-feature]")].map((n) => n.getAttribute("data-feature"))).size,
    /* what the device holds — the thing every whole-plan autosave re-reads and re-writes */
    lsKB: (() => { let n = 0; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); n += k.length + (localStorage.getItem(k) || "").length; } } catch (_) {} return Math.round(n / 1024); })(),
    sitesKB: (() => { try { return Math.round((localStorage.getItem("planarfit:sites:v1") || "").length / 1024); } catch (_) { return null; } })(),
    historyKB: (() => { try { return Math.round((localStorage.getItem("planarfit:sites:history:v1") || "").length / 1024); } catch (_) { return null; } })(),
  };
});
async function workMetrics(cdp) {
  const m = await cdp.send("Performance.getMetrics");
  const g = {}; for (const { name, value } of m.metrics || []) g[name] = value;
  return { script: (g.ScriptDuration || 0) * 1000, layout: (g.LayoutDuration || 0) * 1000, recalc: (g.RecalcStyleDuration || 0) * 1000, task: (g.TaskDuration || 0) * 1000, layoutCount: g.LayoutCount || 0, heap: g.JSHeapUsedSize || 0 };
}

/** Run one named step; return what it cost on the main thread. */
async function step(page, cdp, name, fn) {
  await page.evaluate(() => window.__ltReset());
  const w0 = await workMetrics(cdp);
  const t0 = Date.now();
  await fn();
  /* ⛔ a plain timer, NOT pacedWait: pacedWait spins a MessageChannel loop, and that loop is itself counted as
   * ScriptDuration — measured at ~450 ms of "script" per step on an idle page. The tab is asserted VISIBLE
   * (assertMeasurable), where a timer is not clamped, so it is the honest wait here. */
  await page.waitForTimeout(450);                 // let the debounced commit / recompute / re-render land INSIDE the window
  const wallMs = Date.now() - t0;
  const w1 = await workMetrics(cdp);
  const lt = await page.evaluate(() => window.__ltRead());
  return {
    name,
    scriptMs: +(w1.script - w0.script).toFixed(1), layoutMs: +(w1.layout - w0.layout).toFixed(1), recalcMs: +(w1.recalc - w0.recalc).toFixed(1),
    taskMs: +(w1.task - w0.task).toFixed(1),
    longTaskMs: +lt.reduce((a, x) => a + x[1], 0).toFixed(1), longTasks: lt.length, maxTaskMs: lt.length ? Math.max(...lt.map((x) => x[1])) : 0, wallMs,
  };
}

/* ── main ───────────────────────────────────────────────────────────────────────────────────── */
const browser = await chromium.launch({
  executablePath: EXEC, headless: false,
  args: ["--no-sandbox", "--ignore-certificate-errors", "--disable-dev-shm-usage", "--enable-precise-memory-info"],
});
const out = { label: LABEL, base: BASE, fixture: FIXTURE, cycles: CYCLES, keep: KEEP, dpr: DPR, viewport: [VW, VH], steps: [], perCycle: [], notes: [] };
try {
  const fixture = readFixture(FIXTURE);
  const built = await buildFixtureState(browser, { base: BASE, fixture, siteId: SITE, cacheDir: join(HERE, ".raster-cache"), viewport: { width: VW, height: VH } });
  const context = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR, ignoreHTTPSErrors: true, storageState: built.state });
  /* THE DEVICE STORE. Every whole-plan autosave reads and rewrites `planarfit:sites:v1`, which holds EVERY plan on
   * the device, not just the open one — so what an edit costs depends on how much ELSE is stored. His cloud account
   * (measured 2026-10-06): 143 plans, 1.30 MB of plan JSON, median 1.9 KB, largest 0.94 MB. `--store-kb` adds that
   * weight as other real plans (the committed fixtures, re-id'd); `--fat-plan-kb` adds one big record. */
  if (STORE_KB || FAT_KB) {
    const names = ["bain", "sylvestri", "richfield", "weld", "woods", "tsakiris"];
    const extra = {};
    let bytes = 0, i = 0;
    while (bytes < STORE_KB * 1024 && i < 400) {
      const fx = readFixture(names[i % names.length]);
      const rec = fixtureSite(fx, { id: `xtra-${i}`, name: `Extra ${i}`, site: `Extra ${i}` });
      rec.groupId = `xtra-g-${i}`;
      extra[rec.id] = rec; bytes += JSON.stringify(rec).length; i++;
    }
    if (FAT_KB) {
      const rec = fixtureSite(readFixture("bain"), { id: "xtra-fat", name: "Fat", site: "Fat" });
      rec.groupId = "xtra-fat"; rec.notes = "x".repeat(FAT_KB * 1024); extra[rec.id] = rec; bytes += FAT_KB * 1024;
    }
    out.store = { extraPlans: Object.keys(extra).length, extraKB: Math.round(bytes / 1024) };
    await context.addInitScript((x) => { try { const k = "planarfit:sites:v1"; const cur = JSON.parse(localStorage.getItem(k) || "{}"); localStorage.setItem(k, JSON.stringify({ ...x, ...cur })); } catch (_) {} }, extra);
  }
  await context.addInitScript(INSTRUMENT);
  await context.addInitScript(() => { window.__PLANYR_E2E = true; });
  await context.route("**/*", (route) => { const u = route.request().url(); return u.startsWith(BASE) || u.startsWith("data:") || u.startsWith("blob:") ? route.continue() : route.abort(); });
  const page = await context.newPage();
  await assertMeasurable(page, "perf-edit-cycle");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable"); await cdp.send("HeapProfiler.enable");
  await page.goto(`${BASE}#/project/${SITE}/site`, { waitUntil: "load" });
  await waitForSelectorReleased(page, '[data-testid="planner-canvas"]', { timeout: 60000 });   // never a bare waitForSelector: its ElementHandle retains the previous shell (B1439)
  await pacedWait(page, 3500);
  await assertMeasurable(page, "perf-edit-cycle");

  const baseline = await featureIds(page);
  out.baselineFeatures = baseline.length;
  if (!baseline.includes(`el:${HOST_BUILDING}`) || !baseline.includes(`el:${ROAD}`)) throw new Error(`the fixture plan did not render the host building / road (${baseline.length} features) — the harness cannot drive the owner's sequence`);

  if (PROFILE) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 200 }); await cdp.send("Profiler.start"); }

  const gc = async () => { try { await cdp.send("HeapProfiler.collectGarbage"); } catch (_) {} await pacedWait(page, 120); };
  await gc();
  const heap0 = (await workMetrics(cdp)).heap;
  out.heap0MB = +(heap0 / 1048576).toFixed(1);

  for (let c = 0; c < CYCLES; c++) {
    const steps = [];
    const before = await featureIds(page);

    const hp = await pointOnEl(page, HOST_BUILDING);
    if (!hp) throw new Error(`cycle ${c}: no point on the host building answers to it — view framing moved?`);
    steps.push(await step(page, cdp, "select+copy", async () => { await page.mouse.click(hp.x, hp.y); await page.keyboard.press("Control+c"); }));

    /* paste at a point clear of the host so the copy is hittable on its own; the app places it at the cursor */
    const px = Math.round(VW * 0.62), py = Math.round(VH * 0.38);
    steps.push(await step(page, cdp, "paste", async () => { await page.mouse.move(px, py); await page.keyboard.press("Control+v"); }));
    const after = await featureIds(page);
    const added = after.filter((f) => !before.includes(f));
    out.notes.length < 3 && out.notes.push(`cycle ${c}: paste added ${added.length} features`);

    /* drag the pasted BUILDING. ⛔ WRONG-CASE: two traps measured on this exact app. (1) a SELECTED element wears edge
     * grips and on-body "+/−" controls, so most points on it RESIZE or add a bump-out instead of dragging — and a
     * pasted assembly arrives selected; deselect first. (2) the centre of a building is its label and answers
     * nothing. So: Escape + a click on bare map, then ask the app's own hit test for a point that answers `el:<id>`,
     * and PROVE the element moved (its on-screen box before/after) — a harness that times a drag which moved
     * nothing reports a plausible number about the wrong gesture. */
    await page.keyboard.press("Escape"); await page.mouse.click(Math.round(VW * 0.04), Math.round(VH * 0.5)).catch(() => {});
    await page.waitForTimeout(250);
    let dragged = false;
    for (const f of added.filter((x) => x.startsWith("el:"))) {
      const id = f.slice(3);
      const p = await pointOnEl(page, id);
      if (!p) continue;
      const boxOf = () => page.evaluate((i) => { const n = document.querySelector(`[data-feature="el:${i}"]`); if (!n) return null; const r = n.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; }, id);
      const b0 = await boxOf();
      steps.push(await step(page, cdp, "move", async () => {
        await page.mouse.move(p.x, p.y); await page.mouse.down();
        await page.mouse.move(p.x + 70, p.y + 35, { steps: 8 }); await page.mouse.up();
      }));
      const b1 = await boxOf();
      const moved = b0 && b1 && (Math.abs(b1[0] - b0[0]) > 20 || Math.abs(b1[1] - b0[1]) > 10);
      if (!moved) out.notes.push(`cycle ${c}: the move step DID NOT MOVE ${id} (${JSON.stringify(b0)} → ${JSON.stringify(b1)}) — that cycle's move cost is void`);
      out.movedOk = (out.movedOk || 0) + (moved ? 1 : 0);
      dragged = true; break;
    }
    if (!dragged) out.notes.push(`cycle ${c}: nothing hittable to drag`);

    /* RESIZE a road: select it, drag its endpoint grip out, then back (so the geometry is the same each cycle) */
    await page.keyboard.press("Escape"); await pacedWait(page, 150);
    /* off-centre: a road's dimension chip is anchored at its centreline MIDPOINT (B50010) and a press there opens the width editor */
    const rp = await pointOnEl(page, ROAD, true);
    if (rp) {
      await page.mouse.click(rp.x, rp.y); await pacedWait(page, 250);
      const end = await page.evaluate(() => {
        const h = document.querySelector('[data-handle-layer] circle[data-road-endpoint="1"]');
        if (!h) return null; const b = h.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
      });
      if (end) {
        steps.push(await step(page, cdp, "resize-out", async () => { await page.mouse.move(end.x, end.y); await page.mouse.down(); await page.mouse.move(end.x - 40, end.y + 6, { steps: 8 }); await page.mouse.up(); }));
        const end2 = await page.evaluate(() => {
          const h = document.querySelector('[data-handle-layer] circle[data-road-endpoint="1"]');
          if (!h) return null; const b = h.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
        });
        if (!end2 || Math.abs(end2.x - end.x) < 20) out.notes.push(`cycle ${c}: the resize-out did not move the endpoint grip (${JSON.stringify(end)} → ${JSON.stringify(end2)}) — void`);
        else out.resizedOk = (out.resizedOk || 0) + 1;
        if (end2) steps.push(await step(page, cdp, "resize-back", async () => { await page.mouse.move(end2.x, end2.y); await page.mouse.down(); await page.mouse.move(end2.x + 40, end2.y - 6, { steps: 8 }); await page.mouse.up(); }));
      } else out.notes.push(`cycle ${c}: no endpoint grip`);
    } else out.notes.push(`cycle ${c}: road not hittable`);

    /* remove the pasted copy so the model is the same size next cycle (unless --keep) */
    if (!KEEP) {
      const nowIds = await featureIds(page);
      const mine = nowIds.filter((f) => !baseline.includes(f) && f.startsWith("el:"));
      for (const f of mine) {
        const p = await pointOnEl(page, f.slice(3));
        if (p) { steps.push(await step(page, cdp, "delete-copy", async () => { await page.mouse.click(p.x, p.y); await page.keyboard.press("Delete"); })); break; }
      }
      const left = (await featureIds(page)).filter((f) => !baseline.includes(f)).length;
      if (left) out.notes.push(`cycle ${c}: ${left} pasted features remained after Delete`);
    }

    await page.mouse.click(Math.round(VW * 0.9), Math.round(VH * 0.9)).catch(() => {});   // deselect on bare-ish canvas
    await gc();
    const m = await workMetrics(cdp);
    const cn = await counters(page);
    const sum = (k) => +steps.reduce((a, s) => a + (s[k] || 0), 0).toFixed(1);
    out.perCycle.push({
      cycle: c, workMs: +(sum("scriptMs") + sum("layoutMs") + sum("recalcMs")).toFixed(1), scriptMs: sum("scriptMs"), layoutMs: sum("layoutMs"), recalcMs: sum("recalcMs"),
      longTaskMs: sum("longTaskMs"), longTasks: sum("longTasks"), maxTaskMs: Math.max(0, ...steps.map((s) => s.maxTaskMs)),
      heapMB: +(m.heap / 1048576).toFixed(1), domNodes: cn.domNodes, canvasNodes: cn.canvasNodes, features: cn.features, lsKB: cn.lsKB, sitesKB: cn.sitesKB, historyKB: cn.historyKB,
      steps: steps.map((s) => ({ n: s.name, work: +(s.scriptMs + s.layoutMs + s.recalcMs).toFixed(1), lt: s.longTaskMs, max: s.maxTaskMs })),
    });
    if (!JSON_OUT) process.stderr.write(`· cycle ${String(c).padStart(2)}  work ${String(out.perCycle[c].workMs).padStart(7)} ms  longtask ${String(out.perCycle[c].longTaskMs).padStart(6)} ms (max ${out.perCycle[c].maxTaskMs})  heap ${out.perCycle[c].heapMB} MB  ls ${cn.lsKB} KB (sites ${cn.sitesKB}, hist ${cn.historyKB})\n`);
  }

  if (PROFILE) {
    const { profile } = await cdp.send("Profiler.stop");
    const top = [...selfTimeByFunction(profile).entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    out.profileTop = top.map(([k, v]) => [k, +v.toFixed(1)]);
    if (OUT) writeFileSync(OUT.replace(/\.json$/, "") + ".cpuprofile", JSON.stringify(profile));
  }
  out.verdict = editCycleVerdict(out.perCycle.slice(WARMUP), existsSync(join(HERE, "perf-edit-cycle.budget.json")) ? JSON.parse(readFileSync(join(HERE, "perf-edit-cycle.budget.json"), "utf8")) : {});
  await context.close();
} finally { await browser.close(); }

if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 1));
if (JSON_OUT) console.log(JSON.stringify(out, null, 1));
else {
  const v = out.verdict;
  console.log(`\n${LABEL}: ${CYCLES} cycles (first ${WARMUP} excluded from the slope) on ${FIXTURE} — work/cycle slope ${v.workSlopeMsPerCycle} ms (first ${v.firstWorkMs} → last ${v.lastWorkMs}), longtask slope ${v.longTaskSlopeMsPerCycle} ms, heap slope ${v.heapSlopeMBPerCycle} MB/cycle, dom slope ${v.domSlopePerCycle}/cycle`);
  console.log(v.lines.join("\n"));
  if (out.profileTop) console.log("\nTOP SELF TIME (ms)\n" + out.profileTop.map(([k, v2]) => `${String(v2).padStart(9)}  ${k}`).join("\n"));
}
if (ASSERT && !out.verdict.pass) process.exit(1);
