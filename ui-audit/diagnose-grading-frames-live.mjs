/* diagnose-grading-frames-live — NEW-1 (graded plans slower than they should be on the owner's machine).
 *
 * WHAT THE OWNER'S OWN CAPTURE SAID, re-read from the client_errors rows (tab 30406f26, build c32db39): every one of the
 * 127 "long tasks" was a long-animation-frame entry of ~1000–1032 ms with blockingDuration 0 and NO script attribution, the
 * entries back to back (515, 1535, … 3555, 4559 …), and the recorder's 2 s counter timer firing on time throughout. That is
 * not JavaScript holding the main thread — it is a page that keeps ASKING for a frame while each frame takes ~1 s to be
 * delivered. This harness answers the two questions that follow, on the REAL deployed app:
 *   (1) WHAT keeps asking for frames while the plan sits idle with grading on (running animations, rAF callers, repeating
 *       timers), and
 *   (2) what each of those frames COSTS to draw (CDP trace: paint / raster / layer-tree per frame), idle and during the
 *       owner's gesture script (three wheel zoom-ins, two zoom-outs, two long pans).
 *
 *   node ui-audit/diagnose-grading-frames-live.mjs [--base https://planyr.io] [--throttle 4] [--out file.json]
 *
 * Grading is owner-only (constraint #25). Like diagnose-grading-freeze-live, this answers the is_admin RPC with `true` INSIDE
 * ITS OWN HEADLESS BROWSER ONLY (a Playwright route) — nothing in the product, the database or admin_users changes. The plan is
 * a throwaway copy of Concept A's geometry on the test account, deleted at the end and verified gone (constraint #15). */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { CHEHAW_CROSS_DOCK_ROWS } from "./lib/chehawCrossDock.mjs";
import { writeFileSync, readFileSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg("--base", "https://planyr.io");
const throttle = +arg("--throttle", "1");
const out = arg("--out", null);
const doProfile = process.argv.includes("--profile");
const gradingArm = arg("--grading", "on"); // "off" = the same plan with grading switched off (the control arm)
const RUN = Math.random().toString(36).slice(2, 6);
/* Concept A's parcel, the same ring diagnose-grading-freeze-live seeds (read from it so the two can never drift). */
const src = readFileSync(new URL("./diagnose-grading-freeze-live.mjs", import.meta.url), "utf8");
const PARCEL = JSON.parse(src.match(/const PARCEL = (\[\[.*?\]\])\.map/s)[1]).map(([x, y]) => ({ x, y }));
const SITE = (() => {
  const id = `zz-grframes-${RUN}`;
  return {
    id, groupId: id, site: `zz grading frames ${RUN}`, name: "Concept A", origin: { lat: 33.2458963792457, lon: -84.16362918465775 }, county: "ga_spalding",
    parcels: [{ id: "pc1", active: true, locked: false, points: PARCEL, setbacks: PARCEL.map(() => 25) }],
    els: CHEHAW_CROSS_DOCK_ROWS.map((e, i) => ({ ...e, z: i * 1024 })), measures: [], callouts: [], markups: [],
    settings: { setback: 25, truckCourtD: 135, trailerParkD: 50, grading: { enabled: gradingArm !== "off", layers: { buildable: false, cutfill: true, contours: true, paper: true, spots: true } } },
    underlay: null, updatedAt: Date.now(), status: "active",
  };
})();

/* In-page census, installed before the app: LoAF with render split, rAF callers, repeating timers. Harness-only wrappers. */
const initCensus = () => {
  const W = window;
  W.__census = { loaf: [], raf: new Map(), timers: new Map(), on: false };
  const site = () => { const st = (new Error().stack || "").split("\n").slice(3, 6).map((l) => l.trim().replace(/^at /, "").replace(/https?:\/\/[^/]+\/assets\//, "")).join(" < "); return st.slice(0, 220); };
  const rAF = W.requestAnimationFrame.bind(W);
  W.requestAnimationFrame = (cb) => { if (W.__census.on) { const k = site(); W.__census.raf.set(k, (W.__census.raf.get(k) || 0) + 1); } return rAF(cb); };
  const sI = W.setInterval.bind(W), sT = W.setTimeout.bind(W);
  W.setInterval = (cb, ms, ...a) => { const k = `interval ${ms}ms @ ${site()}`; const wrap = typeof cb === "function" ? (...x) => { if (W.__census.on) { const r = W.__census.timers.get(k) || { n: 0, ms: 0 }; const t = performance.now(); cb(...x); r.n++; r.ms += performance.now() - t; W.__census.timers.set(k, r); } else cb(...x); } : cb; return sI(wrap, ms, ...a); };
  W.setTimeout = (cb, ms, ...a) => { const k = `timeout ${ms | 0}ms @ ${site()}`; const wrap = typeof cb === "function" ? (...x) => { if (W.__census.on) { const r = W.__census.timers.get(k) || { n: 0, ms: 0 }; const t = performance.now(); cb(...x); r.n++; r.ms += performance.now() - t; W.__census.timers.set(k, r); } else cb(...x); } : cb; return sT(wrap, ms, ...a); };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) W.__census.loaf.push({ t: Math.round(e.startTime), dur: Math.round(e.duration), blk: Math.round(e.blockingDuration || 0), render: Math.round(e.renderStart ? e.startTime + e.duration - e.renderStart : 0), style: Math.round(e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0), scripts: (e.scripts || []).sort((a, b) => b.duration - a.duration).slice(0, 3).map((s) => ({ inv: s.invoker, type: s.invokerType, fn: s.sourceFunctionName, url: (s.sourceURL || "").split("/").pop(), dur: Math.round(s.duration), forced: Math.round(s.forcedStyleAndLayoutDuration || 0) })) }); }).observe({ type: "long-animation-frame", buffered: true });
  } catch (_) {}
};

const window_ = async (page, cdp, label, fn, { sampleFrames = false } = {}) => {
  await page.evaluate((sf) => { const c = window.__census; c.on = true; c.raf.clear(); c.timers.clear(); c.from = performance.now(); c.dts = [];
    if (sf) { let prev = 0; const id = (c.loopId = (c.loopId || 0) + 1); const loop = (t) => { if (!c.on || c.loopId !== id) return; if (prev) c.dts.push(t - prev); prev = t; requestAnimationFrame(loop); }; requestAnimationFrame(loop); } }, sampleFrames);
  await cdp.send("Tracing.start", { categories: "devtools.timeline,disabled-by-default-devtools.timeline.frame,cc,viz", transferMode: "ReturnAsStream" });
  if (doProfile) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 250 }); await cdp.send("Profiler.start"); }
  const t0 = Date.now();
  await fn();
  let prof = null; if (doProfile) prof = (await cdp.send("Profiler.stop")).profile;
  const wall = Date.now() - t0;
  const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
  await cdp.send("Tracing.end");
  const { stream } = await done;
  let txt = ""; for (;;) { const { data, eof } = await cdp.send("IO.read", { handle: stream }); txt += data; if (eof) break; }
  await cdp.send("IO.close", { handle: stream });
  const ev = JSON.parse(txt).traceEvents || JSON.parse(txt);
  const mainPid = (ev.find((e) => e.name === "TracingStartedInBrowser") || {}).args?.data?.frames?.[0]?.processId;
  const sum = {}; const cnt = {};
  for (const e of ev) {
    if (e.ph !== "X" || !e.dur) continue;
    if (!["Paint", "RasterTask", "UpdateLayerTree", "Layerize", "PrePaint", "Layout", "UpdateLayoutTree", "Commit", "FunctionCall", "TimerFire", "FireAnimationFrame", "EventDispatch", "GPUTask", "Decode Image", "ImageDecodeTask"].includes(e.name)) continue;
    if (mainPid && e.name !== "RasterTask" && e.name !== "GPUTask" && e.pid !== mainPid) continue;
    sum[e.name] = (sum[e.name] || 0) + e.dur / 1000; cnt[e.name] = (cnt[e.name] || 0) + 1;
  }
  const frames = ev.filter((e) => e.name === "BeginMainThreadFrame" || e.name === "BeginFrame").length;
  const drawn = ev.filter((e) => e.name === "DrawFrame").length;
  const census = await page.evaluate(() => { const c = window.__census; c.on = false; c.loopId = (c.loopId || 0) + 1; const from = c.from;
    const anims = document.getAnimations().filter((a) => a.playState === "running").map((a) => { const t = a.effect && a.effect.target; return `${a.animationName || a.constructor.name} on <${t ? t.tagName.toLowerCase() : "?"}${t && t.getAttribute("data-testid") ? " " + t.getAttribute("data-testid") : ""}${t && typeof t.className === "string" && t.className ? " ." + t.className.split(" ")[0] : ""}> iter=${a.effect && a.effect.getTiming().iterations}`; });
    const d = c.dts.slice().sort((a, b) => a - b); const q = (p) => (d.length ? Math.round(d[Math.min(d.length - 1, Math.floor(p * d.length))]) : null);
    return { frameN: d.length, p50: q(0.5), p95: q(0.95), maxDt: d.length ? Math.round(d[d.length - 1]) : null, raf: [...c.raf].sort((a, b) => b[1] - a[1]).slice(0, 8), timers: [...c.timers].sort((a, b) => b[1].ms - a[1].ms).slice(0, 10).map(([k, v]) => [k, v.n, Math.round(v.ms)]), loaf: c.loaf.filter((e) => e.t >= from), anims }; });
  let top = null;
  if (prof && arg("--profile-dir", null)) writeFileSync(`${arg("--profile-dir")}/${label.replace(/[^a-z0-9]+/gi, "_")}.cpuprofile`, JSON.stringify(prof));
  if (prof) {
    const byId = new Map(prof.nodes.map((n) => [n.id, n])); const parent = new Map(); for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);
    const key = (n) => `${n.callFrame.functionName || "(anon)"} @${(n.callFrame.url || "").split("/").pop()}:${n.callFrame.lineNumber + 1}:${n.callFrame.columnNumber + 1}`;
    const self = new Map(), total = new Map();
    prof.samples.forEach((id, i) => { const d = (prof.timeDeltas[i + 1] || 0) / 1000; const n = byId.get(id); if (!n) return; self.set(key(n), (self.get(key(n)) || 0) + d); const seen = new Set(); let cur = id; while (cur != null) { const k = key(byId.get(cur)); if (!seen.has(k)) { seen.add(k); total.set(k, (total.get(k) || 0) + d); } cur = parent.get(cur); } });
    const t = (m, n) => [...m].filter(([k]) => !/^\((program|idle|root|garbage collector)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${Math.round(v)} ms  ${k}`);
    top = { self: t(self, 25), total: t(total, 45) };
    console.log(`   PROFILE ${label} — self:\n     ` + top.self.join("\n     ") + "\n   total:\n     " + top.total.join("\n     "));
  }
  const r = { label, wall, top, frames, drawn, ms: Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, Math.round(v)])), cnt, ...census };
  console.log(`\n── ${label} · wall ${wall} ms · BeginFrame ${frames} · DrawFrame ${drawn}`);
  console.log("   main/raster ms:", JSON.stringify(r.ms), " counts:", JSON.stringify(cnt));
  if (r.frameN) console.log(`   frame intervals: n ${r.frameN} · p50 ${r.p50} · p95 ${r.p95} · max ${r.maxDt} ms`);
  console.log("   running animations:", r.anims.length ? r.anims.join(" | ") : "none");
  console.log("   rAF callers:", r.raf.length ? r.raf.map(([k, n]) => `${n}× ${k}`).join("\n                ") : "none");
  console.log("   timers (n, ms):", r.timers.length ? r.timers.map(([k, n, ms]) => `${n}× ${ms}ms ${k}`).join("\n                   ") : "none");
  const lf = r.loaf.filter((e) => e.dur >= 50);
  console.log(`   long frames ≥50: ${lf.length}, total ${lf.reduce((a, e) => a + e.dur, 0)} ms, blocking ${lf.reduce((a, e) => a + e.blk, 0)} ms, max ${Math.max(0, ...lf.map((e) => e.dur))}`);
  for (const e of lf.filter((x) => x.dur >= 150).slice(0, 8)) console.log(`     @${e.t} ${e.dur}ms blk ${e.blk} render ${e.render} style ${e.style} :: ${e.scripts.map((s) => `${s.type}/${s.inv}${s.fn ? " " + s.fn : ""} ${s.url} ${s.dur}ms`).join(" | ")}`);
  return r;
};

const s = await openSignedIn({ base, viewport: { width: 1913, height: 1000 }, contextOptions: { deviceScaleFactor: 2.15 }, initScripts: [[initCensus, null]] });
const { page, context } = s;
const results = [];
try {
  await assertMeasurable(page, "diagnose-grading-frames-live");
  const served = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build).catch(() => null));
  console.log("signed in as", s.proof.email, "| served build", served, "| throttle", throttle, "| grading", gradingArm, "| run", RUN);
  const ins = await page.evaluate(async (site) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const row = { id: site.id, group_id: site.groupId, site: site.site, name: site.name, county: site.county, updated_at: new Date().toISOString(), data: site, user_id: u.user.id };
    const r = await window.pfSupabase.from("sites").insert(row); return r.error ? String(r.error.message) : null;
  }, SITE);
  if (ins) throw new Error("insert failed: " + ins);
  await context.route(/\/rest\/v1\/rpc\/is_admin/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "true" }));
  const cdp = await context.newCDPSession(page);
  if (throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  // Arm the read-only diagnostics for this tab (diagArm: `?planyrDiag=1` latches into sessionStorage), so the run ends with the
  // app's own `window.__plannerPerf()` answer beside this harness's census.
  await page.goto(`${base}/?planyrDiag=1#/project/${SITE.id}/site`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 90000 });
  // the graded picture: the band painted
  const tOpen = Date.now(); let ready = false;
  for (let i = 0; i < 180 && !ready && gradingArm !== "off"; i++) { ready = await page.evaluate(() => !!document.querySelector('[data-layer="cutfill"][data-band-ready="1"]')); if (!ready) await page.waitForTimeout(500); }
  console.log(`graded picture ${ready ? "ready" : "NOT ready"} after ~${Date.now() - tOpen} ms (from canvas)`);
  results.push(await window_(page, cdp, "idle 5 s, Grading panel CLOSED", () => page.waitForTimeout(5000)));
  const btn = page.locator('button[title="Grading"], button[aria-label="Grading"], [data-panel-id="grading"]').first();
  const opened = await btn.click({ timeout: 10000 }).then(() => true).catch(() => false);
  console.log("Grading panel opened:", opened);
  await page.waitForTimeout(3000);
  results.push(await window_(page, cdp, "idle 5 s, Grading panel OPEN", () => page.waitForTimeout(5000)));
  const cv = await page.getByTestId("planner-canvas").boundingBox();
  const cx = cv.x + cv.width / 2, cy = cv.y + cv.height / 2;
  results.push(await window_(page, cdp, "3 zoom-ins + 2 zoom-outs (1.5 s apart)", async () => {
    await page.mouse.move(cx, cy);
    for (const d of [-120, -120, -120, 120, 120]) { await page.mouse.wheel(0, d); await page.waitForTimeout(1500); }
  }, { sampleFrames: true }));
  results.push(await window_(page, cdp, "2 long pans", async () => {
    for (const dx of [500, -500]) { await page.mouse.move(cx, cy); await page.mouse.down({ button: "middle" }); for (let k = 1; k <= 30; k++) await page.mouse.move(cx + (dx * k) / 30, cy + (dx * k) / 90); await page.mouse.up({ button: "middle" }); await page.waitForTimeout(800); }
  }, { sampleFrames: true }));
  results.push(await window_(page, cdp, "idle 5 s after the gestures", () => page.waitForTimeout(5000)));
  const perf = await page.evaluate(() => (typeof window.__plannerPerf === "function" ? window.__plannerPerf() : null));
  if (!perf) console.log("\n__plannerPerf(): NOT AVAILABLE (null or not installed) — the instrument did not answer");
  if (perf) { console.log("\n__plannerPerf():", JSON.stringify({ verdict: perf.verdict, observing: perf.observing, summary: perf.summary, recorder: perf.recorder, topScripts: (perf.topScripts || []).slice(0, 3), busyTimers: (perf.busyTimers || []).slice(0, 3), gradingLayersNow: perf.gradingLayersNow, planner: perf.planner }).slice(0, 2500)); results.push({ label: "__plannerPerf", perf }); }
} finally {
  try {
    await page.goto(`${base}/#/`, { waitUntil: "load" }); await page.waitForTimeout(2000);
    const gone = await page.evaluate(async (id) => {
      await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      await window.pfSupabase.from("sites").delete().eq("id", id);
      const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
      for (const k of Object.keys(localStorage)) { const v = localStorage.getItem(k) || ""; if (v.includes(id)) localStorage.removeItem(k); }
      return q.error ? "err:" + q.error.message : (q.data || []).length;
    }, SITE.id);
    console.log(`\ncleanup: throwaway sites left in the cloud = ${gone}`);
  } catch (e) { console.log("cleanup FAILED", String(e).slice(0, 200)); }
  if (out) writeFileSync(out, JSON.stringify(results, null, 1));
  await s.close().catch(() => {});
}
