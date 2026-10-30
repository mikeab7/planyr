/* measure-layer-pan-frames — PAN SMOOTHNESS WITH UTILITY LAYERS ON (NEW-1, 2026-10-30), measured LIVE on planyr.io signed in as the test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/measure-layer-pan-frames.mjs [https://planyr.io] [--arms off,water_sewer,…] [--zoom-ft <ppf>] [--reps 3] [--shots <dir>]
 *
 * The owner's report (Olive Branch, 8:41 AM CT): "click-and-drag panning is jumpy and doesn't track the pointer" with the water / sewer layers on.
 * For each ARM (a set of Layers rows) this opens a throwaway LOCATED plan at Olive Branch, switches the rows on, waits for the layers' downloads to settle,
 * then performs the SAME scripted real-mouse drag and records, for the drag only:
 *   - frame intervals (rAF deltas) → p50 / p95 / max and the count over 33 ms (a dropped frame at 60 Hz is > 25 ms);
 *   - the longest main-thread stall (a MessageChannel heartbeat, which a timer/rAF clamp cannot fake) and long tasks;
 *   - GIS requests ISSUED while the pointer was still down (the layer must not refetch per move; refresh may follow the release);
 *   - DOM mutation records, and Leaflet-pane child counts before/after (a re-laid-out label layer shows here).
 * Arms are interleaved with a baseline (`off`) before AND after, so a slow machine/network shows up as a drifting baseline instead of a verdict.
 * KNOWN-GOOD ARM: the baseline must report a plausible frame rate (rAF alive) or the run is VOID (FOREGROUND-OR-VOID).
 * Throwaway plans are deleted at the end and the deletion re-read (owner rule 15). */
import { mkdirSync, writeFileSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { LIVE_PREFIX, throwawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const ARMS = (flag("--arms", "off,ms_ob_gas_main,water_sewer,ms_psc_water,ms_psc_sewer,ms_ob_water_service,all,off") || "").split(",").map((x) => x.trim()).filter(Boolean);
const REPS = Number(flag("--reps", "2"));
const SHOTS = flag("--shots");
const OUT = flag("--json");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const OB = { lat: 34.95, lng: -89.83 };
const ALL = ["water_sewer", "ms_ob_water_service", "ms_ob_sewer_service", "ms_ob_gas_main"];
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const page = s.page;
await assertMeasurable(page, "measure-layer-pan-frames");
await page.setViewportSize({ width: 1400, height: 900 });
const served = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build);
console.log(`signed in as ${s.proof.email} · served build ${served}`);
const sleep = (ms) => page.waitForTimeout(ms);

let netLog = [];
page.on("request", (r) => { const u = r.url(); if (/gis-proxy|arcgis|FeatureServer|MapServer/.test(u)) netLog.push({ t: Date.now(), url: u }); });

const cleanupIds = [];
const results = [];
const layerCounts = {};   // arm → compositor layers on the settled page
const MAX_EXTRA = Number(flag("--max-extra-layers", "150"));   // pre-fix this was +514 (every label its own layer); what remains is Chrome promoting the labels that sit over the visible imagery tiles (~100 in a 1400-wide view)
try {
  const plan = { ...throwawayPlan(`${LIVE_PREFIX}panframes-${Date.now().toString(36)}`), origin: { lat: OB.lat, lon: OB.lng }, site: "ZZ Live Check — pan frames" };
  const err = await page.evaluate(async ([pl]) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const { error } = await window.pfSupabase.from("sites").insert({ id: pl.id, group_id: pl.groupId, site: pl.site, name: pl.name, county: null, user_id: u.user.id, version: 1, data: pl });
    return error ? String(error.message) : null;
  }, [plan]);
  cleanupIds.push(plan.id);
  if (err) throw new Error("throwaway plan insert failed — " + err);

  async function freshPlan() {
    const pl = { ...throwawayPlan(`${LIVE_PREFIX}panframes-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`), origin: { lat: OB.lat, lon: OB.lng }, site: "ZZ Live Check — pan frames" };
    const e = await page.evaluate(async ([p2]) => { const { data: u } = await window.pfSupabase.auth.getUser(); const { error } = await window.pfSupabase.from("sites").insert({ id: p2.id, group_id: p2.groupId, site: p2.site, name: p2.name, county: null, user_id: u.user.id, version: 1, data: p2 }); return error ? String(error.message) : null; }, [pl]);
    cleanupIds.push(pl.id);
    if (e) throw new Error("throwaway plan insert failed — " + e);
    return pl;
  }
  let plan2cur = plan;
  async function openFresh() {
    await page.goto(`${BASE}/?planyrDiag=1#/project/${plan2cur.id}/site`, { waitUntil: "domcontentloaded" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 });
    await sleep(2500);
    const chip = page.getByTestId("layers-expand").filter({ visible: true });
    if (await chip.count()) await chip.first().click();
    const panel = page.locator('[data-testid="layer-panel"][data-surface="planner"]').first();
    await panel.waitFor({ state: "visible", timeout: 20000 });
    await sleep(900);
    return panel;
  }
  const rowGroup = { water_sewer: "util", ms_ob_water_service: "util", ms_ob_sewer_service: "util", ms_ob_gas_main: "util", ms_psc_water: "util", ms_psc_sewer: "util" };
  async function turnOn(panel, id) {
    await panel.getByTestId(`layer-group-${rowGroup[id] || "util"}`).click(); await sleep(250);
    const cb = panel.locator(`[data-testid="layer-row-${id}"] input[type="checkbox"]`).first();
    if (!(await cb.count())) return false;
    if (!(await cb.isChecked())) await cb.check();
    return true;
  }
  /* zoom the planner to a site-planning view where every label/line gate is open (labels gate at z17). */
  async function setView() {
    await page.evaluate(() => window.__plannerView && window.__plannerView.centerOn && window.__plannerView.centerOn(0, 0, 0.36));
    await sleep(2500);
  }
  async function settle(maxMs = 25000) {
    const t0 = Date.now(); let last = netLog.length, quietSince = Date.now();
    while (Date.now() - t0 < maxMs) {
      await sleep(500);
      if (netLog.length !== last) { last = netLog.length; quietSince = Date.now(); }
      if (Date.now() - quietSince > 3000) break;
    }
    await sleep(1500);
  }

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  async function dragOnce(label, dir = -1) {
    const box = await page.getByTestId("planner-canvas").boundingBox();
    const cx = box.x + box.width * 0.62, cy = box.y + box.height * 0.5;   // right of the docked panel, on open canvas
    await page.evaluate(() => {
      const R = window.__pan = { dts: [], last: 0, stall: 0, hb: performance.now(), long: [], muts: 0, on: true, panes: null };
      const tick = (t) => { if (!R.on) return; if (R.last) R.dts.push(t - R.last); R.last = t; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      const ch = new MessageChannel();
      ch.port1.onmessage = () => { if (!R.on) return; const n = performance.now(); R.stall = Math.max(R.stall, n - R.hb); R.hb = n; setTimeout(() => ch.port2.postMessage(0), 8); };
      ch.port2.postMessage(0);
      try { new PerformanceObserver((l) => l.getEntries().forEach((e) => R.long.push(Math.round(e.duration)))).observe({ entryTypes: ["longtask"] }); } catch (_) { /* none */ }
      const mo = new MutationObserver((m) => { R.muts += m.length; });
      mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      R.mo = mo;
      const count = () => [...document.querySelectorAll(".leaflet-pane")].map((p) => `${p.className.replace("leaflet-pane ", "")}:${p.querySelectorAll("*").length}`).join(" ");
      R.count = count; R.panes = count();
    });
    await page.mouse.move(cx, cy);
    const netBefore = netLog.length;
    const m0 = await metrics();
    await page.mouse.down();
    const t0 = Date.now();
    const STEPS = 75;
    for (let i = 1; i <= STEPS; i++) {
      await page.mouse.move(cx + dir * i * 8, cy + Math.sin(i / 6) * 30, { steps: 1 });
      await sleep(14);   // ≈ a 60 Hz pointer; CDP latency is small next to it, and the page's frames are counted by its own rAF
    }
    const during = netLog.length - netBefore;
    const dragMs = Date.now() - t0;
    const m1 = await metrics();
    await page.mouse.up();
    const r = await page.evaluate(() => { const R = window.__pan; R.on = false; R.mo.disconnect(); return { dts: R.dts, stall: Math.round(R.stall), long: R.long, muts: R.muts, panesBefore: R.panes, panesAfter: R.count() }; });
    const d = [...r.dts].sort((a, b) => a - b), q = (p) => d.length ? +d[Math.min(d.length - 1, Math.floor(p * d.length))].toFixed(1) : null;
    await sleep(1500);
    const afterRelease = netLog.length - netBefore - during;
    return { label, frames: d.length, p50: q(0.5), p95: q(0.95), max: d.length ? +d[d.length - 1].toFixed(1) : null, over33: d.filter((x) => x > 33).length,
      stallMs: r.stall, longTasks: r.long.length, longMax: r.long.length ? Math.max(...r.long) : 0, mutations: r.muts, reqDuring: during, reqAfter: afterRelease, dragMs,
      panesBefore: r.panesBefore, panesAfter: r.panesAfter,
      scriptMs: Math.round((m1.ScriptDuration - m0.ScriptDuration) * 1000), layoutMs: Math.round((m1.LayoutDuration - m0.LayoutDuration) * 1000), styleMs: Math.round((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000),
      layouts: m1.LayoutCount - m0.LayoutCount, styles: m1.RecalcStyleCount - m0.RecalcStyleCount };
  }

  /* DIAGNOSTIC VARIANTS (arm "id@nolabels" / "id@nolines" / "id@nogis"): hide ONE class of drawn thing with CSS after the layers settled, to attribute the cost to labels or strokes. */
  const VARIANT_CSS = { nolabels: ".leaflet-gisLineLabel-pane,.leaflet-gisAreaLabel-pane,.pf-line-label{display:none !important}", nolines: ".leaflet-gisLine-pane{display:none !important}", nogis: ".leaflet-gisLine-pane,.leaflet-gisLineLabel-pane,.leaflet-gisArea-pane,.leaflet-gisAreaLabel-pane{display:none !important}" };
  for (const armSpec of ARMS) {
    const [arm, variant] = armSpec.split("@");
    plan2cur = await freshPlan();   // each arm gets its OWN plan: the Layers panel remembers per plan, so a reused plan would carry the previous arm's layers into `off`
    const panel = await openFresh();
    netLog = [];
    if (arm !== "off") {
      const ids = arm === "all" ? ALL.concat(["ms_psc_water", "ms_psc_sewer"]) : [arm];
      for (const id of ids) { const ok = await turnOn(panel, id); if (!ok) console.log(`(row ${id} not found — arm ${arm} partial)`); }
    }
    await setView();
    await settle();
    if (variant === "flat") {
      // DIAGNOSTIC: swap each label's translate3d (which gives it its own compositor layer) for a 2D translate — is the layer count the cost?
      const n = await page.evaluate(() => { let n = 0; document.querySelectorAll(".pf-line-label").forEach((el) => { const t = el.style.transform; if (/translate3d/.test(t)) { el.style.transform = t.replace(/translate3d\(([^,]+),\s*([^,]+),\s*[^)]+\)/, "translate($1, $2)"); n++; } }); return n; });
      console.log(`(flattened ${n} label transforms)`);
    } else if (variant) { await page.addStyleTag({ content: VARIANT_CSS[variant] }); await sleep(800); }
    {
      let layers = null, tree = []; const onTree = (e) => { layers = (e.layers || []).length; tree = e.layers || []; };
      cdp.on("LayerTree.layerTreeDidChange", onTree); await cdp.send("LayerTree.enable"); await sleep(Number(flag("--tree-wait", "1200")));
      // attribute each compositor layer to the element that owns it (class names), so a layer count has a NAME next to it
      await cdp.send("DOM.enable");
      const byClass = {};
      for (const l of tree) {
        if (!l.backendNodeId) { byClass["(no node)"] = (byClass["(no node)"] || 0) + 1; continue; }
        try { const { node } = await cdp.send("DOM.describeNode", { backendNodeId: l.backendNodeId }); const a = node.attributes || []; const ci = a.indexOf("class"); const k = `${node.localName}.${ci >= 0 ? String(a[ci + 1]).replace(/\s+/g, ".").slice(0, 60) : ""}`; byClass[k] = (byClass[k] || 0) + 1; } catch (_) { byClass["(gone)"] = (byClass["(gone)"] || 0) + 1; }
      }
      { const t = await page.evaluate(() => { const els = [...document.querySelectorAll(".pf-line-label")]; const g = (re) => els.filter((e) => re.test(e.style.transform)).length; const ex = els.find((e) => /translate3d/.test(e.style.transform)); return { total: els.length, flat: g(/^translate\(/), threeD: g(/translate3d/), none: els.filter((e) => !e.style.transform).length, example: ex ? ex.outerHTML.slice(0, 260) : null }; }); console.log(`   label transforms: ${JSON.stringify(t)}`); }
      // WHY is a layer a layer? ask Chrome for the compositing reasons of up to 3 label layers (empty when labels are no longer promoted)
      let shown = 0;
      for (const l of tree) { if (shown >= 3) break; if (!l.backendNodeId) continue; try { const { node } = await cdp.send("DOM.describeNode", { backendNodeId: l.backendNodeId }); const a = node.attributes || []; const ci = a.indexOf("class"); if (ci < 0 || !/pf-line-label/.test(a[ci + 1])) continue; const r = await cdp.send("LayerTree.compositingReasons", { layerId: l.layerId }); console.log(`   label layer reasons: ${JSON.stringify(r.compositingReasonIds || r.compositingReasons)}`); shown++;
        try { const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: l.backendNodeId }); const info = await cdp.send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: "function(){ const c=getComputedStyle(this); return JSON.stringify({inline:this.style.cssText.slice(0,160), computedTransform:c.transform, willChange:c.willChange, transition:c.transitionProperty+' '+c.transitionDuration, anims:this.getAnimations().length, opacity:c.opacity, cls:this.className}); }", returnByValue: true }); console.log("      " + info.result.value); } catch (_) { /* node gone */ } } catch (_) { /* gone */ } }
      await cdp.send("LayerTree.disable"); cdp.off("LayerTree.layerTreeDidChange", onTree);
      layerCounts[armSpec] = layers;
      console.log(`[${armSpec}] compositor layers: ${layers}  ${Object.entries(byClass).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${v}× ${k}`).join(" | ")}`);
    }
    // move the pointer off the panel so a hover cannot be mistaken for pan cost
    // cold = new ground (the layers must fetch it); warm = back over ground already loaded (the layers must do NOTHING per move)
    const plan2 = [["cold", -1], ["warm", +1], ["warm", -1]].slice(0, Math.max(1, REPS + 1));
    for (let k = 0; k < plan2.length; k++) {
      const [kind, dir] = plan2[k];
      const r = await dragOnce(`${armSpec}/${kind}`, dir);
      results.push({ arm: armSpec, kind, ...r });
      console.log(`${armSpec.padEnd(20)} ${kind.padEnd(4)} frames ${String(r.frames).padStart(3)} p50 ${r.p50} p95 ${r.p95} max ${r.max} >33ms ${r.over33} stall ${r.stallMs}ms long ${r.longTasks}(${r.longMax}) mut ${r.mutations} | script ${r.scriptMs} layout ${r.layoutMs}(${r.layouts}) style ${r.styleMs}(${r.styles}) | req during ${r.reqDuring} after ${r.reqAfter}`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${arm}-${kind}-${k}.png` });
    }
    console.log(`   panes (children): ${results[results.length - 1].panesAfter}`);
  }
  const med = (a) => { const d = a.filter((x) => x != null).sort((x, y) => x - y); return d.length ? d[Math.floor(d.length / 2)] : null; };
  const base = results.filter((r) => r.arm === "off");
  const baseLayers = layerCounts.off ?? null;
  console.log("\nSUMMARY (median across the drags of each arm; baseline = `off`)");
  for (const arm of [...new Set(results.map((r) => r.arm))]) { const rs = results.filter((r) => r.arm === arm); console.log(`  ${arm.padEnd(22)} layers ${String(layerCounts[arm] ?? "?").padStart(4)}  p95 ${med(rs.map((r) => r.p95))}  stall ${med(rs.map((r) => r.stallMs))}ms  frames>33ms ${med(rs.map((r) => r.over33))}  mutations ${med(rs.map((r) => r.mutations))}`); }
  for (const arm of Object.keys(layerCounts)) if (arm !== "off" && baseLayers != null && !arm.includes("@")) check(`NEW-1 · "${arm}" adds at most ${MAX_EXTRA} compositor layers over the layers-off page (was +514 with one layer per label)`, layerCounts[arm] - baseLayers <= MAX_EXTRA, `${layerCounts[arm]} vs ${baseLayers} off`);
  for (const r of results) if (r.arm !== "off") check(`NEW-1 · no GIS request while the pointer is down (${r.arm}/${r.kind})`, r.reqDuring === 0, `${r.reqDuring} issued`);
  check("KNOWN-GOOD · the baseline drag produced a plausible frame stream (rAF alive, > 20 frames)", base.length > 0 && base.every((r) => r.frames > 20), base.map((r) => r.frames).join(","));
  if (OUT) writeFileSync(OUT, JSON.stringify({ served, results }, null, 1));
} finally {
  try {
    for (const id of cleanupIds) { const c = await cleanupLive(page, { planId: id }); const ok = c && c.left && c.left.site === 0 && !(c.errors || []).length; console.log(ok ? "throwaway plan deleted (re-read: gone)" : "CLEANUP INCOMPLETE — " + JSON.stringify(c)); if (!ok) failed++; }
  } catch (e) { console.log("CLEANUP FAILED — " + e.message); failed++; }
  await s.browser.close();
}
process.exit(failed ? 1 : 0);
