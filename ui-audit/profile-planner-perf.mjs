/* profile-planner-perf — the Site Planner speed round's MEASURING half (NEW-1, 2026-10-31; owner 2026-10-30: "improve the speed of
 * the software"). There was no named culprit, so this instrument exists to find where the main-thread time goes before anything
 * is changed, and to print ONE cost table that every later fix is judged against.
 *
 * WHAT IT DRIVES. The grading harness (ui-audit/harness/grading-harness.jsx) with the owner's Concept A (?owner=2) on the real
 * Chehaw ground: the REAL GradingController + GradingCanvas, grading ON, proposed contours + cut/fill + paper on, at his screen
 * size and pixel ratio (1913 × 1000, DSF 2.15), the CPU throttled 4× (the honest stand-in for a weak machine — his own browser's
 * frame rate is not evidence of app cost, B2319137 ×4). Three views — the scale bar reading 500 ft, 125 ft and 50 ft — and both
 * limit modes. Five phases per (mode, view):
 *   open    navigation → the graded picture is up (the same READY predicate perf-grading-freeze uses)
 *   zoom    one wheel-notch zoom step (×1.25 about the centre) → the picture at the new zoom
 *   pan     a 20-step pan exactly as the planner pans (B1440's anchor: one translate per move, ONE re-bake at release)
 *   mode    the "Graded area" mode switch → the new mode's picture
 *   move    a building drag (10 moves) + release → the re-graded picture
 * Per phase, from a Chrome trace (CDP Tracing, devtools.timeline): main-thread ms (sum of the main thread's top-level tasks),
 * the longest task, self time split scripting / style+layout / paint / composite / gc / other; React commits (a devtools-hook
 * counter) and commits per pan move; DOM nodes total and in the canvas; <image> / <canvas> elements and their backing pixels;
 * how many grading-worker jobs of each kind ran and the bytes posted to them; how many times the graded surface was rebuilt.
 *
 * KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): before any table is printed, a deliberate 120 ms busy loop in a page task
 * must show up as a ≥ 120 ms longest task and ≥ 120 ms of scripting in the trace parser — otherwise the run is VOID (exit 2).
 *
 *   node ui-audit/profile-planner-perf.mjs [--throttle=4] [--views=500,125,50] [--modes=layout,boundary] [--json] [--md]
 * (starts its own vite on :5198) */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { summariseTrace } from "./lib/traceCost.mjs";

const PORT = 5198, BASE = `http://localhost:${PORT}`;
const EXEC = process.env.PW_CHROME || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const THROTTLE = +arg("throttle", 4);
const VIEWS = arg("views", "500,125,50").split(",");
const MODES = arg("modes", "layout,boundary").split(",");
const PHASES = arg("phases", "open,zoom,pan,mode,move").split(",");
const JSON_OUT = process.argv.includes("--json");
const MD_OUT = arg("md", "");
/* `--mutant`: the harness's KNOWN-SLOW arm (?perfMutant=1 — per-render busy work while a pan or a drag is in flight, and one picture
 * re-encode per drag move). verify-planner-perf runs it and requires it to FAIL; an instrument that cannot see it is VOID. */
const MUTANT = process.argv.includes("--mutant");

const READY = (want) => {
  const H = window.__harness; const s = H && H.gradeSurface, m = H && H.model;
  if (!s || !s.grid || !s.grid.limit || !m) return false;
  if (s.grid.limit.mode !== want || !m.limit || m.limit.mode !== want || m.limit.areaAc == null) return false;
  const ew = document.querySelector("[data-grading-earthwork]");
  if (!ew || ew.getAttribute("data-grading-earthwork") === "pending") return false;
  if (/Reading the ground/.test((document.getElementById("panel") || document.body).textContent)) return false;
  if (!m.contours || m.contours.key !== s.surfaceKey || !document.querySelector('[data-layer="contours"] path')) return false;
  if (!document.querySelector("[data-band-tint]")) return false;
  return true;
};

/* Installed before any page script: the React commit counter, the grading-worker job/bytes counter, the surface-rebuild counter. */
const PROBE = () => {
  window.__perf = { commits: 0, jobs: {}, jobBytes: 0, surfaces: 0, lastSurface: null };
  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || {
    renderers: new Map(), supportsFiber: true, inject(r) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id; },
    onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {}, isDisabled: false,
  };
  const prev = hook.onCommitFiberRoot;
  hook.onCommitFiberRoot = function (...a) { window.__perf.commits++; return prev && prev.apply(this, a); };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  const bytesOf = (v, seen = new Set(), depth = 0) => {
    if (!v || typeof v !== "object" || seen.has(v) || depth > 6) return 0; seen.add(v);
    if (ArrayBuffer.isView(v)) return v.byteLength;
    if (v instanceof ArrayBuffer) return v.byteLength;
    let n = 0; for (const k in v) n += bytesOf(v[k], seen, depth + 1); return n;
  };
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (msg, ...rest) {
    if (msg && msg.kind) { window.__perf.jobs[msg.kind] = (window.__perf.jobs[msg.kind] || 0) + 1; window.__perf.jobBytes += bytesOf(msg); }
    return post.call(this, msg, ...rest);
  };
  window.__perf.dataUrls = 0;
  const tdu = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (...a) { window.__perf.dataUrls++; return tdu.apply(this, a); };
  const tick = () => { const s = window.__harness && window.__harness.gradeSurface; if (s && s !== window.__perf.lastSurface) { window.__perf.lastSurface = s; window.__perf.surfaces++; } setTimeout(tick, 5); };
  tick();
};

const census = () => {
  const c = document.getElementById("canvas");
  const imgs = [...document.querySelectorAll("#canvas image")].map((e) => { const r = e.getBoundingClientRect(); return Math.round(r.width * devicePixelRatio) * Math.round(r.height * devicePixelRatio); });
  const cvs = [...document.querySelectorAll("canvas")].map((e) => e.width * e.height);
  return { dom: document.getElementsByTagName("*").length, canvasDom: c ? c.getElementsByTagName("*").length : 0,
    images: imgs.length, imagePx: imgs.reduce((a, b) => a + b, 0), canvases: cvs.length, canvasPx: cvs.reduce((a, b) => a + b, 0),
    contourPaths: document.querySelectorAll('[data-layer="contours"] path').length };
};
const counters = (page) => page.evaluate(() => ({ commits: window.__perf.commits, jobs: { ...window.__perf.jobs }, jobBytes: window.__perf.jobBytes, surfaces: window.__perf.surfaces, dataUrls: window.__perf.dataUrls }));
const diff = (a, b) => {
  const jobs = {}; for (const k of new Set([...Object.keys(a.jobs), ...Object.keys(b.jobs)])) { const d = (b.jobs[k] || 0) - (a.jobs[k] || 0); if (d) jobs[k] = d; }
  return { commits: b.commits - a.commits, jobs, jobBytes: b.jobBytes - a.jobBytes, surfaces: b.surfaces - a.surfaces, dataUrls: b.dataUrls - a.dataUrls };
};

/* `--prod` (the default for judged numbers): the harness is BUILT the way planyr.io is (vite build, minified, React's production
 * build — dev React spends most of a re-render on prop validation) and served by `vite preview`; `--dev` runs the dev server. */
const PROD = !process.argv.includes("--dev");
const OUT = ".perf/grading-harness-prod";
if (PROD) {
  const { build } = await import("vite");
  const { cpSync, mkdirSync, readdirSync } = await import("node:fs");
  await build({ logLevel: "warn", build: { outDir: OUT, emptyOutDir: true, rollupOptions: { input: { harness: "ui-audit/harness/grading-harness.html" } } } });
  mkdirSync(`${OUT}/test/fixtures`, { recursive: true });
  for (const f of readdirSync("test/fixtures")) if (f.startsWith("chehaw-218-02007")) cpSync(`test/fixtures/${f}`, `${OUT}/test/fixtures/${f}`);
}
const vite = spawn("npx", PROD ? ["vite", "preview", "--outDir", OUT, "--port", String(PORT), "--strictPort"] : ["vite", "--port", String(PORT), "--strictPort"], { stdio: "ignore", detached: true });
const stopVite = () => { try { process.kill(-vite.pid); } catch { try { vite.kill(); } catch {} } };

/* one traced window: start tracing, run `act`, wait for `done`, stop; returns the trace summary + the wall time to `done` */
const CPU_PHASES = arg("cpuprofile", "").split(",").filter(Boolean);
/* `--cpuprofile=pan,move` — also sample the JS (CDP Profiler, 100 µs) and print the heaviest SELF functions of those phases */
function topSelf(profile, n = 14) {
  const byId = new Map(profile.nodes.map((x) => [x.id, x])), cnt = new Map(), self = new Map();
  const dt = (profile.endTime - profile.startTime) / 1000 / Math.max(1, profile.samples.length);
  for (const id of profile.samples) cnt.set(id, (cnt.get(id) || 0) + 1);
  for (const [id, c] of cnt) { const f = byId.get(id).callFrame; const k = `${f.functionName || "(anon)"} ${f.url.split("/").pop().split("?")[0]}:${f.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + c * dt); }
  return [...self].filter(([k]) => !/^\((idle|program|garbage collector)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, Math.round(v)]);
}
/* INCLUSIVE time of the grading pipeline's named stages (a sample counts once per stage on its stack) */
const STAGES = ["buildProposedSurfaceSteps", "suggestFfe", "findFfeFix", "findMoveFix", "contourLatticeSteps", "bandField", "cellsPixels", "pixelsToDataUrl", "maskHatchPixels", "unionRings", "bufferRings", "cardEarthwork", "courtReport", "planContourDraw", "placeContourLabels", "resolveGradingLimit", "limitGridSteps", "renderWithHooks", "commitRoot"];
function stageTimes(profile) {
  const byId = new Map(profile.nodes.map((x) => [x.id, x])), parent = new Map();
  for (const nd of profile.nodes) for (const c of nd.children || []) parent.set(c, nd.id);
  const dt = (profile.endTime - profile.startTime) / 1000 / Math.max(1, profile.samples.length);
  const out = new Map(), memo = new Map();
  const stagesOf = (id) => { if (memo.has(id)) return memo.get(id); const nd = byId.get(id); const p = parent.get(id); const s = new Set(p != null ? stagesOf(p) : []); if (STAGES.includes(nd.callFrame.functionName)) s.add(nd.callFrame.functionName); memo.set(id, s); return s; };
  for (const id of profile.samples) for (const st of stagesOf(id)) out.set(st, (out.get(st) || 0) + dt);
  return [...out].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v)]);
}
async function traced(cdp, page, act, done, phase = "") {
  const prof = CPU_PHASES.includes(phase);
  if (prof) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 100 }); await cdp.send("Profiler.start"); }
  const events = [];
  const onData = (e) => { for (const x of e.value) events.push(x); };
  cdp.on("Tracing.dataCollected", onData);
  const finished = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
  await cdp.send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "v8.execute", "toplevel", "blink.user_timing"] }, transferMode: "ReportEvents" });
  const t0 = Date.now();
  await act();
  const ok = await done();
  const wall = ok === false ? null : Date.now() - t0;
  await cdp.send("Tracing.end");
  await finished;
  cdp.off("Tracing.dataCollected", onData);
  const prf = prof ? (await cdp.send("Profiler.stop")).profile : null;
  return { wall, ...summariseTrace(events), ...(prf ? { cpu: topSelf(prf), stages: stageTimes(prf) } : {}) };
}

const rows = [];
let browser;
try {
  for (let i = 0; i < 120; i++) { try { const r = await fetch(`${BASE}/ui-audit/harness/grading-harness.html`); if (r.ok) break; } catch {} await sleep(300); }
  browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const open = async (mode, view) => {
    const ctx = await browser.newContext({ viewport: { width: 1913, height: 1000 }, deviceScaleFactor: 2.15 });
    await ctx.addInitScript(PROBE);
    const page = await ctx.newPage();
    const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
    return { ctx, page, cdp, errs, url: `${BASE}/ui-audit/harness/grading-harness.html?owner=2&sel=none&buildable=0&contours=1&scale=${view}&mode=${mode}${MUTANT ? "&perfMutant=1" : ""}` };
  };
  const waitReady = (page, want, timeout = 240000) => page.waitForFunction(READY, want, { timeout, polling: 100 }).then(() => true, () => false);

  // ---- known-good arm: the parser must see a deliberate 120 ms block as a ≥ 120 ms task and ≥ 120 ms of scripting
  {
    const { ctx, page, cdp, url } = await open("layout", "125");
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await page.goto(url); await assertMeasurable(page, "profile-planner-perf");
    const s = await traced(cdp, page, () => page.evaluate(() => new Promise((r) => setTimeout(() => { const t = performance.now(); while (performance.now() - t < 120) {} r(); }, 0))), async () => { await sleep(200); return true; });
    if (!(s.longestTask >= 120 && s.scripting >= 110)) { console.error(`VOID — the trace parser did not see a known 120 ms block (longest ${s.longestTask}, scripting ${s.scripting})`); process.exitCode = 2; throw new Error("void"); }
    if (!JSON_OUT) console.log(`✓ known-good arm: a 120 ms block read as longest task ${s.longestTask} ms, scripting ${s.scripting} ms`);
    await ctx.close();
  }

  for (const mode of MODES) for (const view of VIEWS) {
    const other = mode === "layout" ? "boundary" : "layout";
    const { ctx, page, cdp, errs, url } = await open(mode, view);
    const rec = async (phase, act, want) => {
      const c0 = await counters(page);
      const s = await traced(cdp, page, act, want ? () => waitReady(page, want) : async () => { await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); return true; }, phase);
      const c1 = await counters(page);
      const row = { mode, view, phase, ...s, ...diff(c0, c1), ...(await page.evaluate(census)) };
      rows.push(row);
      if (!JSON_OUT) { console.log(fmtRow(row)); if (row.cpu) console.log(`    cpu self: ${row.cpu.map(([k, v]) => `${k} ${v}`).join(" · ")}\n    stages (inclusive): ${row.stages.map(([k, v]) => `${k} ${v}`).join(" · ")}`); }
      return row;
    };
    if (PHASES.includes("open")) await rec("open", async () => { await page.goto(url); await assertMeasurable(page, "profile-planner-perf"); }, mode);
    else { await page.goto(url); await assertMeasurable(page, "profile-planner-perf"); await waitReady(page, mode); }
    if (PHASES.includes("zoom")) {
      // one wheel-notch zoom in, then back out (two steps, so the next phase starts at the asked view)
      await rec("zoom-in", () => page.evaluate(() => window.__harness.zoomBy(1.25)), mode);
      await rec("zoom-out", () => page.evaluate(() => window.__harness.zoomBy(0.8)), mode);
    }
    if (PHASES.includes("pan")) {
      await rec("pan", async () => {
        await page.evaluate(() => window.__harnessPan.start());
        for (let i = 0; i < 20; i++) await page.evaluate(() => new Promise((r) => { window.__harnessPan.move(12, 6); requestAnimationFrame(() => r()); }));
        await page.evaluate(() => window.__harnessPan.end());
      }, mode);
      const p = rows[rows.length - 1]; p.perMove = { commits: +(p.commits / 20).toFixed(2), mainMs: +(p.mainMs / 21).toFixed(1) };
    }
    if (PHASES.includes("mode")) {
      await rec("mode", () => page.click(`[data-testid="grading-limit-mode"] button:${other === "boundary" ? "last" : "first"}-child`), other);
      await page.click(`[data-testid="grading-limit-mode"] button:${mode === "boundary" ? "last" : "first"}-child`); await waitReady(page, mode);
    }
    if (PHASES.includes("move")) {
      let during = null;
      await rec("move", async () => {
        await page.evaluate(() => window.__harness.dragStart());
        const c0 = await counters(page);
        for (let i = 0; i < 10; i++) await page.evaluate(() => new Promise((r) => { window.__harness.applyMove(4, 0); requestAnimationFrame(() => r()); }));
        during = diff(c0, await counters(page));
        await page.evaluate(() => window.__harness.dragEnd());
      }, mode);
      // what the 10 pointer moves cost BEFORE the release (the release legitimately rebuilds the surface)
      rows[rows.length - 1].duringMoves = during;
    }
    if (errs.length) console.log(`  ! page errors: ${errs.slice(0, 3).join(" | ")}`);
    await ctx.close();
  }
} catch (e) {
  if (String(e && e.message) !== "void") { console.error(e); process.exitCode = 1; }
} finally {
  if (browser) await browser.close();
  stopVite();
}

function fmtRow(r) {
  const j = Object.entries(r.jobs || {}).map(([k, v]) => `${k}×${v}`).join(" ") || "—";
  return `${r.mode.padEnd(8)} ${String(r.view).padStart(3)}ft ${r.phase.padEnd(8)} wall ${String(r.wall ?? "∞").padStart(6)} ms · main ${String(r.mainMs).padStart(6)} · longest ${String(r.longestTask).padStart(5)} · `
    + `script ${r.scripting} style+layout ${r.styleLayout} paint ${r.paint} composite ${r.composite} gc ${r.gc} other ${r.other} · commits ${r.commits}`
    + `${r.perMove ? ` (${r.perMove.commits}/move, ${r.perMove.mainMs} ms/move)` : ""} · surfaces ${r.surfaces} · jobs ${j} ${(r.jobBytes / 1e6).toFixed(2)} MB · dom ${r.dom}/${r.canvasDom} · contour paths ${r.contourPaths} · images ${r.images} (${(r.imagePx / 1e6).toFixed(1)} Mpx)`
    + ` · top: ${(r.top || []).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(", ")}` + (r.longestTask > 50 ? ` · longest task was: ${(r.longestWhat || []).join(" / ")}` : "");
}
if (JSON_OUT) console.log(JSON.stringify({ throttle: THROTTLE, rows }, null, 1));
if (arg("out", "")) writeFileSync(arg("out", ""), JSON.stringify({ throttle: THROTTLE, mutant: MUTANT, rows, exitCode: process.exitCode || 0 }, null, 1));
if (MD_OUT) {
  const head = "| mode | view | phase | wall ms | main ms | longest task | script | style+layout | paint | composite | gc | React commits | surfaces | worker jobs | job MB | DOM (canvas) | contour paths | images (Mpx) |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n";
  const body = rows.map((r) => `| ${r.mode} | ${r.view} | ${r.phase} | ${r.wall ?? "∞"} | ${r.mainMs} | ${r.longestTask} | ${r.scripting} | ${r.styleLayout} | ${r.paint} | ${r.composite} | ${r.gc} | ${r.commits}${r.perMove ? ` (${r.perMove.commits}/move)` : ""} | ${r.surfaces} | ${Object.entries(r.jobs || {}).map(([k, v]) => `${k}×${v}`).join(" ") || "—"} | ${(r.jobBytes / 1e6).toFixed(2)} | ${r.dom} (${r.canvasDom}) | ${r.contourPaths} | ${r.images} (${(r.imagePx / 1e6).toFixed(1)}) |`).join("\n");
  writeFileSync(MD_OUT, head + body + "\n");
}
