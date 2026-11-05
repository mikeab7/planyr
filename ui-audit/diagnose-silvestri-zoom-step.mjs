/* NEW-1 (Silvestri ~300 ms freeze per zoom step) — per-zoom-step main-thread block time, with the CPU
 * profile resolved through the build's SOURCEMAP so the minified "U" / "t" / "Lv" in the owner's perfcap
 * finally gets a real name.
 *
 * WHAT IT DRIVES. The owner's REAL Silvestri plan (ui-audit/fixtures/sylvestri-concept-d-full.json, the
 * redacted pull of his plan — no synthesized geometry), his measured scene (dpr 2.125, 904×416 viewport,
 * four layers on), real mouse-wheel zoom steps on the canvas, a settle between each. Per step it reports
 * the long-task ms (PerformanceObserver `longtask` + `long-animation-frame`) that landed inside it.
 * A V8 sampling profile spans the whole zoom phase and is folded to SELF TIME per
 * `function @ original-source:line`, plus the heaviest resolved call stacks.
 *
 * Run:  BASE_URL=http://localhost:4190/ node ui-audit/diagnose-silvestri-zoom-step.mjs [--steps 8] [--notches 2]
 *       [--dpr 2.125] [--check <maxBlockMs>]   (--check exits 1 when any step blocks longer — the perf guard)
 * The served build needs `vite build --sourcemap true` for the profile to resolve to src/ paths; without
 * maps the run still measures per-step block time and says the names are unresolved.
 *
 * ⛔ FOREGROUND-OR-VOID: assertMeasurable before any measurement; waits are MessageChannel-paced.
 */
import { chromium } from "playwright";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeTilePng, parseTileUrl } from "./lib/fakeTile.mjs";
import { fixtureSeedMulti, withLayerArm, annotationArmFixture } from "./lib/planFixture.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { makeSourceLocator } from "./lib/sourceMapIndex.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = (process.env.BASE_URL || "http://localhost:4190/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const STEPS = +arg("--steps", 8), NOTCHES = +arg("--notches", 2), DPR = +arg("--dpr", 2.125);
const VW = +arg("--vw", 904), VH = +arg("--vh", 416);
const CHECK = arg("--check", null);
const FIXTURE_FILE = arg("--fixture", join(HERE, "fixtures", "sylvestri-concept-d-full.json"));
const SITE_ID = "sms4zs8unbkg";
const CPU = +arg("--cpu", 1);
const DIST = arg("--dist", null);
const TOP = +arg("--top", 30), ALLFRAMES = process.argv.includes("--all-frames");

/* --arm: ablate a tier (no-callouts | no-markups | no-measures | no-annotations) to attribute the per-step cost;
 * --layers none: turn the four GIS layers off. Defaults are the owner's scene (everything on). */
const ARM = arg("--arm", "sylvestri");
let fixture = JSON.parse(readFileSync(FIXTURE_FILE, "utf8"));
if (ARM !== "sylvestri") fixture = annotationArmFixture(fixture, ARM);
fixture = withLayerArm(fixture, arg("--layers", "owner-4"));
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--enable-precise-memory-info"] });
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR });
/* --store-mb N: the owner's device holds MANY saved plans (3.9 MB of localStorage over 156 keys at last measure) and
 * `readSites()` JSON-parses the WHOLE sites blob on every call — so an App render costs in proportion to his
 * store, which a one-plan sandbox store hides. This pads the store with COPIES OF THE OTHER COMMITTED REAL PLANS
 * (nothing synthesized) under fresh ids until the seeded blob reaches N MB. Sylvestri stays the open plan. */
const STORE_MB = +arg("--store-mb", 0);
const entries = [{ fixture, id: SITE_ID, name: "Concept D - Retail", site: "Silvestri" }];
if (STORE_MB > 0) {
  const fdir = join(HERE, "fixtures");
  const others = readdirSync(fdir).filter((f) => f.endsWith(".json") && !f.startsWith("sylvestri") && !f.startsWith("jurisdiction"))
    .map((f) => { try { return { f, j: JSON.parse(readFileSync(join(fdir, f), "utf8")) }; } catch (_) { return null; } })
    .filter((x) => x && Array.isArray(x.j.els) && x.j.origin);
  let k = 0;
  const size = () => fixtureSeedMulti(entries).length;
  while (size() < STORE_MB * 1048576 && k < 400) {
    const o = others[k % others.length]; k++;
    entries.push({ fixture: o.j, id: `pad${k}`, name: `${o.f.replace(".json", "")} #${k}`, site: `Pad ${k}` });
  }
  console.log(`store padded to ${(size() / 1048576).toFixed(2)} MB across ${entries.length} saved plans`);
}
await ctx.addInitScript(fixtureSeedMulti(entries, SITE_ID));
await ctx.addInitScript(() => {
  /* React commit counter via the DevTools global hook (React calls it in production builds too): how many
   * commits a zoom step costs, and what the root commits were, is the part a CPU profile cannot say. */
  window.__commits = 0;
  const hook = { supportsFiber: true, renderers: new Map(), inject(r) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id; },
    onCommitFiberRoot(id, root) {
      window.__commits++; (window.__ct = window.__ct || []).push(performance.now());
      /* WHICH useState/useReducer changed in this commit (state hooks have a .queue): the trigger of the render. */
      try {
        const out = []; const stack = [root.current];
        const sum = (v) => { try { const t = typeof v; if (v == null || t === "number" || t === "boolean") return String(v); if (t === "string") return JSON.stringify(v.slice(0, 24)); if (Array.isArray(v)) return "arr" + v.length; if (t === "object") return "{" + Object.keys(v).slice(0, 5).join(",") + "}"; return t; } catch (_) { return "?"; } };
        while (stack.length) {
          const f = stack.pop(); if (!f) continue;
          if (f.child) stack.push(f.child); if (f.sibling) stack.push(f.sibling);
          if ((f.tag === 0 || f.tag === 11 || f.tag === 15) && (f.flags & 1) && f.alternate && typeof f.type === "function") {
            let h = f.memoizedState, a = f.alternate.memoizedState, i = 0; const ch = [];
            while (h && a) { if (h.queue && !Object.is(h.memoizedState, a.memoizedState)) ch.push(i + "=" + sum(a.memoizedState) + "→" + sum(h.memoizedState)); h = h.next; a = a.next; i++; }
            if (ch.length) out.push((f.type.name || "anon") + "[" + ch.join(" ; ") + "]");
          }
        }
        (window.__why = window.__why || []).push({ t: performance.now(), why: out.slice(0, 12) });
      } catch (e) { (window.__why = window.__why || []).push({ t: performance.now(), why: ["probe-error " + e.message] }); }
    }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {} };
  Object.defineProperty(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__", { value: hook, configurable: true });
  window.__lt = []; window.__loaf = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ s: e.startTime, d: e.duration }); }).observe({ type: "longtask", buffered: true }); } catch (_) {}
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__loaf.push({ s: e.startTime, d: e.duration, blk: e.blockingDuration,
      scripts: (e.scripts || []).map((x) => ({ d: Math.round(x.duration), fn: x.sourceFunctionName, url: (x.sourceURL || "").replace(/^.*\//, ""), pos: x.sourceCharPosition, inv: x.invoker, type: x.invokerType })) }); }).observe({ type: "long-animation-frame", buffered: true });
  } catch (_) {}
});
let tiles = 0;
await ctx.route(/^https?:\/\//, (route) => {
  const url = route.request().url();
  if (url.startsWith(BASE)) return route.continue();
  const t = parseTileUrl(url);
  if (t) { tiles++; return route.fulfill({ status: 200, headers: { "content-type": "image/png", "access-control-allow-origin": "*", "cache-control": "no-store" }, body: fakeTilePng(t.z, t.x, t.y) }); }
  return route.abort();
});
const page = await ctx.newPage();
await assertMeasurable(page, "diagnose-silvestri-zoom-step");
const cdp = await ctx.newCDPSession(page);
if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
await page.goto(`${BASE}#/project/${SITE_ID}/site`, { waitUntil: "load" });
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
await pacedWait(page, 3000);
await assertMeasurable(page, "diagnose-silvestri-zoom-step (post-boot)");

/* el-tier: scene description printed beside the run; the element tier is one reported field, not a plan census. */
const census = await page.evaluate(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  return { elementsDrawn: svg.querySelectorAll("[data-el-id]").length, canvasNodes: svg.getElementsByTagName("*").length,
    docNodes: document.getElementsByTagName("*").length, tiles: document.querySelectorAll(".leaflet-tile").length,
    ppf: svg.getAttribute("data-view-ppf"), reveal: svg.getAttribute("data-planner-reveal"),
    layers: [...document.querySelectorAll(".leaflet-layer, .leaflet-pane > *")].length };
});
const box = await page.locator('[data-testid="planner-canvas"]').boundingBox();
const ax = Math.round(box.x + box.width * 0.6), ay = Math.round(box.y + box.height * 0.5);

await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 250 });
await cdp.send("Profiler.start");
const anchorNow = await page.evaluate(() => performance.now());   // page clock at (just after) profiler start
const steps = [];
for (let i = 0; i < STEPS; i++) {
  const dir = i < STEPS / 2 ? -1 : 1;                 // in for the first half, back out for the second
  const c0 = await page.evaluate(() => window.__commits);
  const t0 = await page.evaluate(() => performance.now());
  const p0 = await page.evaluate(() => document.querySelector('[data-testid="planner-canvas"]').getAttribute("data-view-ppf"));
  await page.mouse.move(ax, ay);
  for (let n = 0; n < NOTCHES; n++) await page.mouse.wheel(0, dir * 100);
  await pacedWait(page, 900);
  const t1 = await page.evaluate(() => performance.now());
  const p1 = await page.evaluate(() => document.querySelector('[data-testid="planner-canvas"]').getAttribute("data-view-ppf"));
  const c1 = await page.evaluate(() => window.__commits);
  steps.push({ i, dir: dir < 0 ? "in" : "out", t0, t1, p0, p1, commits: c1 - c0 });
}
const { profile } = await cdp.send("Profiler.stop");
await assertMeasurable(page, "diagnose-silvestri-zoom-step (post-run)");
const { lt, loaf, ct, why } = await page.evaluate(() => ({ lt: window.__lt, loaf: window.__loaf, ct: window.__ct || [], why: window.__why || [] }));

/* ---- per-step block time ---- */
let worst = 0, grand = 0, movedSteps = 0;
console.log(`\nscene: ${JSON.stringify(census)}  viewport ${VW}x${VH} dpr ${DPR} cpu×${CPU} fakeTilesServed ${tiles}`);
console.log("\nper-step main-thread block (long tasks ≥50 ms starting inside the step):");
for (const s of steps) {
  const inStep = lt.filter((e) => e.s >= s.t0 && e.s < s.t1);
  const sum = inStep.reduce((a, e) => a + e.d, 0), max = inStep.reduce((a, e) => Math.max(a, e.d), 0);
  const lf = loaf.filter((e) => e.s >= s.t0 && e.s < s.t1);
  worst = Math.max(worst, max); grand += sum;
  const moved = s.p0 !== s.p1; if (moved) movedSteps++;
  console.log(`  step ${s.i} ${s.dir.padEnd(3)} ppf ${s.p0} → ${s.p1}${moved ? "" : "  (VIEW DID NOT MOVE — step void)"}  commits ${s.commits}  tasks ${inStep.length}  total ${sum.toFixed(0)} ms  max ${max.toFixed(0)} ms  loaf ${lf.map((e) => e.d.toFixed(0)).join("/")}`);
}
console.log("\nlong tasks in the zoom phase, with the React commits that FINISHED inside each (commit timestamps from the DevTools hook):");
for (const e of lt.filter((x) => x.s >= steps[0].t0).sort((a, b) => a.s - b.s)) {
  const n = ct.filter((t) => t >= e.s && t <= e.s + e.d + 2).length;
  console.log(`  @${e.s.toFixed(0).padStart(6)}  ${e.d.toFixed(0).padStart(4)} ms  commits ${n}`);
  if (process.argv.includes("--why")) for (const w of why.filter((x) => x.t >= e.s && x.t <= e.s + e.d + 2)) console.log(`        state changed: ${w.why.join("  |  ") || "(no state hook changed — props/context/parent)"}`);
}
console.log(`\nWORST single task in a zoom step: ${worst.toFixed(0)} ms`);
console.log(`SUMMARY steps_moved=${movedSteps}/${STEPS} mean_block_per_step_ms=${(grand / STEPS).toFixed(0)} worst_task_ms=${worst.toFixed(0)}`);
console.log("\nLoAF script attribution (top by duration per frame, raw as the recorder sees it):");
for (const e of loaf.filter((x) => x.s >= steps[0].t0).sort((a, b) => b.d - a.d).slice(0, 6))
  console.log(`  ${e.d.toFixed(0)} ms  ${e.scripts.sort((a, b) => b.d - a.d).slice(0, 2).map((x) => `${x.d}ms fn=${JSON.stringify(x.fn)} ${x.url}@${x.pos} ${x.type}:${x.inv}`).join(" | ")}`);

/* ---- resolve the profile through sourcemaps ---- */
const mapCache = new Map();
async function locatorFor(url) {
  if (!url || !url.startsWith(BASE)) return null;
  if (!mapCache.has(url)) {
    let loc = null;
    try {
      /* Read the map off DISK when --dist is given (the sandbox's HTTP proxy env can swallow a node fetch to
       * localhost, which silently left every frame unresolved), else fetch it from the served build. */
      if (DIST) loc = makeSourceLocator(JSON.parse(readFileSync(join(DIST, url.slice(BASE.length).replace(/[?#].*$/, "") + ".map"), "utf8")));
      else { const r = await fetch(url + ".map"); if (r.ok) loc = makeSourceLocator(await r.json()); }
    } catch (_) {}
    mapCache.set(url, loc);
  }
  return mapCache.get(url);
}
const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
const frameName = new Map();
let resolved = 0, unresolved = 0;
for (const n of profile.nodes) {
  const cf = n.callFrame; const loc = await locatorFor(cf.url);
  const at = loc ? loc(cf.lineNumber, cf.columnNumber) : null;
  if (at) resolved++; else if (cf.url) unresolved++;
  const short = cf.url ? cf.url.replace(/^.*\//, "") : "(native)";
  frameName.set(n.id, `${cf.functionName || "(anon)"} @ ${at ? `${at.source}:${at.line}` : `${short}:${cf.lineNumber + 1}:${cf.columnNumber}`}`);
}
console.log(`\nsourcemap: ${resolved} frames resolved to source, ${unresolved} with a url but no mapping${resolved ? "" : "  ⚠ NO MAPS — names are minified"}`);
const self = new Map(), leafStacks = new Map();
let busy = 0;
for (let i = 0; i < profile.samples.length; i++) {
  const n = nodes.get(profile.samples[i]); const ms = (profile.timeDeltas[i] || 0) / 1000;
  const fn = n.callFrame.functionName;
  if (fn === "(idle)" || fn === "(program)" || fn === "(garbage collector)" && false) continue;
  busy += ms;
  const k = frameName.get(n.id); self.set(k, (self.get(k) || 0) + ms);
  const stack = []; for (let id = n.id, d = 0; id && d < 7; id = parent.get(id), d++) stack.push(frameName.get(id));
  const sk = stack.join("\n      ← "); leafStacks.set(sk, (leafStacks.get(sk) || 0) + ms);
}
console.log(`\nbusy (non-idle) sampled time across the zoom phase: ${busy.toFixed(0)} ms\nTOP SELF TIME:`);
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log(`  ${v.toFixed(0).padStart(6)} ms  ${k}`);
console.log("\nHEAVIEST LEAF STACKS (leaf ← callers):");
for (const [k, v] of [...leafStacks].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`  ${v.toFixed(0)} ms\n      ${k}`);
// inclusive time by resolved function (a function's samples + all descendants), de-duplicated per sample
const incl = new Map();
for (let i = 0; i < profile.samples.length; i++) {
  const ms = (profile.timeDeltas[i] || 0) / 1000; const seen = new Set();
  for (let id = profile.samples[i]; id; id = parent.get(id)) { const k = frameName.get(id); if (seen.has(k)) continue; seen.add(k); incl.set(k, (incl.get(k) || 0) + ms); }
}
console.log("\nTOP INCLUSIVE (callers included — the call path):");
for (const [k, v] of [...incl].sort((a, b) => b[1] - a[1]).filter(([k]) => !/\(root\)|\(idle\)|\(program\)/.test(k) && (ALLFRAMES || !/node_modules\/(react-dom|react|scheduler)\//.test(k))).slice(0, TOP)) console.log(`  ${v.toFixed(0).padStart(6)} ms  ${k}`);
/* ---- per-LONG-TASK attribution: which app frames own the samples inside each of the worst tasks ---- */
{
  const off = profile.startTime / 1000 - anchorNow;                 // profile monotonic ms → page performance.now ms
  const times = []; { let t = profile.startTime / 1000; for (const d of profile.timeDeltas) { t += d / 1000; times.push(t - off); } }
  const inZoom = lt.filter((e) => e.s >= steps[0].t0).sort((a, b) => b.d - a.d).slice(0, 5);
  {
    const all = lt.filter((e) => e.s >= steps[0].t0); const acc = new Map(); let tot = 0;
    for (let i = 0; i < times.length; i++) {
      if (!all.some((e) => times[i] >= e.s && times[i] <= e.s + e.d)) continue;
      const ms = (profile.timeDeltas[i] || 0) / 1000; tot += ms; const seen = new Set();
      for (let id = profile.samples[i]; id; id = parent.get(id)) { const k = frameName.get(id); if (seen.has(k)) continue; seen.add(k); acc.set(k, (acc.get(k) || 0) + ms); }
    }
    console.log(`\nALL ${all.length} LONG TASKS COMBINED (sampled ${tot.toFixed(0)} ms) — inclusive app frames:`);
    for (const [k, v] of [...acc].sort((a, b) => b[1] - a[1]).filter(([k]) => !/\(root\)|\(idle\)|\(program\)|node_modules\/(react-dom|react|scheduler)\/|\(native\)/.test(k)).slice(0, 28)) console.log(`      ${v.toFixed(0).padStart(5)} ms  ${k}`);
  }
  console.log("\nWORST LONG TASKS — inclusive app frames inside each window (react-dom/scheduler hidden):");
  for (const e of inZoom) {
    const acc = new Map(); let tot = 0;
    for (let i = 0; i < times.length; i++) {
      if (times[i] < e.s || times[i] > e.s + e.d) continue;
      const ms = (profile.timeDeltas[i] || 0) / 1000; tot += ms; const seen = new Set();
      for (let id = profile.samples[i]; id; id = parent.get(id)) { const k = frameName.get(id); if (seen.has(k)) continue; seen.add(k); acc.set(k, (acc.get(k) || 0) + ms); }
    }
    console.log(`  task ${e.d.toFixed(0)} ms @${e.s.toFixed(0)} (sampled ${tot.toFixed(0)} ms)`);
    for (const [k, v] of [...acc].sort((a, b) => b[1] - a[1]).filter(([k]) => !/\(root\)|\(idle\)|\(program\)|node_modules\/(react-dom|react|scheduler)\/|\(native\)/.test(k)).slice(0, 7)) console.log(`      ${v.toFixed(0).padStart(5)} ms  ${k}`);
  }
}
await browser.close();
if (CHECK != null && worst > +CHECK) { console.error(`\nFAIL: worst zoom-step task ${worst.toFixed(0)} ms > budget ${CHECK} ms`); process.exit(1); }
