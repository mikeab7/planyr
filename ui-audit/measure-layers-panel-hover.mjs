/* measure-layers-panel-hover — THE LAYERS PANEL MUST NOT MOVE WHEN THE POINTER MOVES OVER IT (NEW-2, 2026-10-30), measured LIVE on planyr.io signed in as the test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/measure-layers-panel-hover.mjs [https://planyr.io] [--layers on|off|both] [--shots <dir>]
 *
 * The owner's report: "the Layers panel shakes, mostly when hovering over the LEFT side (the group list), not the right-hand detail pane."
 * This opens a throwaway LOCATED plan at Olive Branch with the Layers panel up, then walks a real mouse slowly up and down (a) the left group list, (b) the right
 * rows and their chevrons, and on EVERY pointer step logs getBoundingClientRect of the panel root, the group nav, the divider, the rows pane and each scroll
 * ancestor, plus whether any of them carries a vertical scrollbar. ANY change in any rect (> 0.01 px) or a scrollbar appearing/disappearing between two steps is the bug.
 * It also counts React-level churn that would cause it: DOM mutations inside the panel and layout/style recalcs (CDP) per step.
 * KNOWN-GOOD ARM: the walk must visit ≥ 6 distinct group buttons (the pointer really crossed the list) and the instrument must report a deliberately forced 1 px change
 * (a style nudge the harness applies to the panel itself) or the run is VOID.
 * Throwaway plan deleted at the end and re-read (owner rule 15). */
import { mkdirSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { LIVE_PREFIX, throwawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const MODE = flag("--layers", "both");
const SHOTS = flag("--shots");
const REAL_SCROLLBARS = args.includes("--scrollbars");   // headless Chromium HIDES scrollbars; a Windows desktop shows 15 px ones that take layout width (a toggling scrollbar is a shake)
const DSF = Number(flag("--dsf", "1"));                  // the owner's display runs at a fractional pixel ratio (≈ 2.15)
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const OB = { lat: 34.95, lng: -89.83 };
let failed = 0, voided = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]], ...(REAL_SCROLLBARS ? { ignoreDefaultArgs: ["--hide-scrollbars"] } : {}), contextOptions: { deviceScaleFactor: DSF } });
const page = s.page;
await assertMeasurable(page, "measure-layers-panel-hover");
await page.setViewportSize({ width: 1400, height: 900 });
const served = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build);
console.log(`signed in as ${s.proof.email} · served build ${served}`);
const sleep = (ms) => page.waitForTimeout(ms);
const cleanupIds = [];
const cdp = await page.context().newCDPSession(page);

try {
  const plan = { ...throwawayPlan(`${LIVE_PREFIX}panelhover-${Date.now().toString(36)}`), origin: { lat: OB.lat, lon: OB.lng }, site: "ZZ Live Check — panel hover" };
  const err = await page.evaluate(async ([pl]) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const { error } = await window.pfSupabase.from("sites").insert({ id: pl.id, group_id: pl.groupId, site: pl.site, name: pl.name, county: null, user_id: u.user.id, version: 1, data: pl });
    return error ? String(error.message) : null;
  }, [plan]);
  cleanupIds.push(plan.id);
  if (err) throw new Error("throwaway plan insert failed — " + err);

  async function openPanel() {
    await page.goto(`${BASE}/?planyrDiag=1#/project/${plan.id}/site`, { waitUntil: "domcontentloaded" });
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
  const turnOn = async (panel, group, id) => {
    await panel.getByTestId(`layer-group-${group}`).click(); await sleep(250);
    const cb = panel.locator(`[data-testid="layer-row-${id}"] input[type="checkbox"]`).first();
    if (await cb.count() && !(await cb.isChecked())) await cb.check();
  };

  /* one in-page probe: snapshot of every box that could move, taken on EVERY pointermove (capture, so nothing can stop it) */
  async function arm() {
    await page.evaluate(() => {
      const root = document.querySelector('[data-testid="layer-panel"][data-surface="planner"]');
      const nav = root.querySelector('[data-testid="layer-group-nav"]');
      const div = root.querySelector('[data-testid="layer-pane-divider"]');
      const pane = root.querySelector('[data-testid="layer-pane"]');
      const chain = []; for (let el = root; el && el !== document.body && chain.length < 8; el = el.parentElement) chain.push(el);
      const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 100) / 100); };
      const snap = () => ({
        root: box(root), nav: box(nav), div: box(div), pane: box(pane),
        navBtns: nav ? [...nav.children].map(box) : [],
        chain: chain.map((el) => ({ b: box(el), sbV: el.offsetWidth - el.clientWidth, sbH: el.offsetHeight - el.clientHeight, sh: el.scrollHeight, ch: el.clientHeight, st: el.scrollTop })),
        under: (() => { const e = document.elementFromPoint(window.__px || 0, window.__py || 0); return e ? (e.getAttribute("data-testid") || e.tagName) : null; })(),
      });
      const W = window.__hover = { steps: [], muts: 0, snap, shifts: [] };
      try { new PerformanceObserver((l) => l.getEntries().forEach((e) => W.shifts.push({ v: +e.value.toFixed(4), hadInput: e.hadRecentInput, src: (e.sources || []).map((x) => (x.node && (x.node.getAttribute && (x.node.getAttribute("data-testid") || x.node.className || x.node.tagName))) || "?").slice(0, 3) }))).observe({ type: "layout-shift", buffered: false }); } catch (_) { /* unsupported */ }
      W.mo = new MutationObserver((m) => { W.muts += m.filter((x) => root.contains(x.target)).length; });
      W.mo.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
      document.addEventListener("pointermove", (e) => { window.__px = e.clientX; window.__py = e.clientY; W.steps.push({ x: e.clientX, y: e.clientY, ...snap(), muts: W.muts }); }, true);
      W.base = snap();
    });
  }
  const diffs = (steps, base) => {
    const out = [];
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const prevOf = (i) => (i === 0 ? base : steps[i - 1]);
    steps.forEach((st, i) => {
      const p = prevOf(i), what = [];
      for (const k of ["root", "nav", "div", "pane"]) if (!eq(st[k], p[k])) what.push(`${k} ${JSON.stringify(p[k])}→${JSON.stringify(st[k])}`);
      if (!eq(st.navBtns, p.navBtns)) what.push("navBtns moved");
      st.chain.forEach((c, j) => { const q = p.chain[j]; if (!q) return; if (!eq(c.b, q.b)) what.push(`ancestor${j} box ${JSON.stringify(q.b)}→${JSON.stringify(c.b)}`); if (c.sbV !== q.sbV) what.push(`ancestor${j} scrollbar ${q.sbV}→${c.sbV}`); if (c.sh !== q.sh) what.push(`ancestor${j} scrollHeight ${q.sh}→${c.sh}`); });
      if (what.length) out.push({ i, x: st.x, y: st.y, under: st.under, what });
    });
    return out;
  };

  async function walk(panel, label) {
    await arm();
    const nav = await panel.getByTestId("layer-group-nav").boundingBox();
    const pane = await panel.getByTestId("layer-pane").boundingBox();
    const x1 = nav.x + nav.width / 2, x2 = pane.x + Math.min(pane.width / 2, 120);
    const yTop = nav.y + 4, yBot = nav.y + nav.height - 4;
    await page.mouse.move(x1, yTop);
    for (let rep = 0; rep < 3; rep++) { for (let i = 0; i <= 40; i++) { await page.mouse.move(x1, yTop + (yBot - yTop) * (i / 40)); await sleep(16); } for (let i = 40; i >= 0; i--) { await page.mouse.move(x1 - 4 + (i % 3) * 4, yTop + (yBot - yTop) * (i / 40)); await sleep(16); } }
    const leftN = await page.evaluate(() => window.__hover.steps.length);
    const leftUnder = await page.evaluate(() => [...new Set(window.__hover.steps.map((s) => s.under))]);
    // right pane: rows + chevrons
    const pb = await panel.getByTestId("layer-pane").boundingBox();
    for (let rep = 0; rep < 2; rep++) for (let i = 0; i <= 50; i++) { await page.mouse.move(x2 + (i % 5) * 18, pb.y + 4 + Math.min(pb.height - 8, 500) * (i / 50)); await sleep(16); }
    const r = await page.evaluate(() => { const W = window.__hover; return { steps: W.steps, base: W.base, muts: W.muts }; });
    const d = diffs(r.steps, r.base);
    const leftD = d.filter((x) => x.i < leftN), rightD = d.filter((x) => x.i >= leftN);
    console.log(`[${label}] pointer steps ${r.steps.length} (left list ${leftN}) · hovered ${leftUnder.length} distinct targets · mutations in panel ${r.muts}`);
    console.log(`[${label}] rect/scrollbar changes — LEFT list: ${leftD.length}, RIGHT pane: ${rightD.length}`);
    for (const x of d.slice(0, 6)) console.log(`   step ${x.i} @ (${x.x},${x.y}) over ${x.under}: ${x.what.join("; ")}`);
    const shifts = await page.evaluate(() => window.__hover.shifts);
    console.log(`[${label}] layout-shift entries during the walk: ${shifts.length}${shifts.length ? " " + JSON.stringify(shifts.slice(0, 4)) : ""}`);
    return { shifts: shifts.length, leftD: leftD.length, rightD: rightD.length, muts: r.muts, hoveredGroupButtons: leftUnder.filter((u) => /^layer-group-/.test(String(u))).length };
  }

  const arms = MODE === "both" ? ["off", "on"] : [MODE];
  for (const a of arms) {
    const panel = await openPanel();
    if (a === "on") { await turnOn(panel, "util", "ms_ob_gas_main"); await turnOn(panel, "util", "water_sewer"); await turnOn(panel, "jur", "ms_desoto_zoning"); await turnOn(panel, "jur", "counties_cities"); await sleep(9000); }
    await panel.getByTestId("layer-group-util").click(); await sleep(400);
    await page.mouse.move(700, 450); await sleep(600);
    const r = await walk(panel, `layers ${a}`);
    check(`KNOWN-GOOD · the walk crossed ≥ 6 group buttons (${a})`, r.hoveredGroupButtons >= 6, `${r.hoveredGroupButtons}`); if (r.hoveredGroupButtons < 6) voided++;
    check(`NEW-2 · hovering the group list changes no rect and toggles no scrollbar (${a})`, r.leftD === 0, `${r.leftD} changing steps`);
    check(`NEW-2 · hovering the rows and chevrons changes no rect (${a})`, r.rightD === 0, `${r.rightD} changing steps`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/hover-${a}.png` });
    /* STYLE PASS (the cause, read where it acts): while the pointer rests on a control INSIDE the panel its computed filter must be none and a PRESS must not move it. The global
     * button rules give every hovered button brightness(.97) and every pressed one a 0.5 px translate; a probe button OUTSIDE the panel is the KNOWN-GOOD arm (it must report the
     * global rule, or this pass cannot see the thing it is looking for). */
    {
      const read = async (loc, press) => { const el = loc.first(); const b = await el.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await sleep(350); if (press) await page.mouse.down(); await sleep(250);
        const v = await el.evaluate((n) => { const c = getComputedStyle(n); return { filter: c.filter, transform: c.transform }; }); if (press) await page.mouse.up(); return v; };
      await page.evaluate(() => { const b = document.createElement("button"); b.id = "zz-probe"; b.textContent = "probe"; b.style.cssText = "position:fixed;left:40px;top:300px;z-index:99999"; document.body.appendChild(b); });
      const probe = await read(page.locator("#zz-probe"), true);
      await page.evaluate(() => document.getElementById("zz-probe").remove());
      check(`KNOWN-GOOD · a button outside the panel shows the global hover filter and press nudge (${a})`, probe.filter !== "none" && probe.transform !== "none", JSON.stringify(probe)); if (!(probe.filter !== "none" && probe.transform !== "none")) voided++;
      const tab = await read(panel.locator('[role="tab"][aria-selected="false"]'), true);
      check(`NEW-2 · a group tab under the pointer has no filter and no press nudge (${a})`, tab.filter === "none" && tab.transform === "none", JSON.stringify(tab));
      const chev = panel.locator('[data-testid^="layer-row-"] button');
      if (await chev.count()) { const c = await read(chev, false); check(`NEW-2 · a row's dropdown chevron under the pointer has no filter (${a})`, c.filter === "none", JSON.stringify(c)); }
      const hide = await read(panel.getByTestId("layers-hide-toggle"), true);
      check(`NEW-2 · the Hide Layers pill and the more menu have no filter and no press nudge (${a})`, hide.filter === "none" && hide.transform === "none", JSON.stringify(hide));
      await page.mouse.move(700, 450); await sleep(300);
      if (await panel.getByTestId("layers-hide-toggle").getAttribute("aria-pressed") === "true") await panel.getByTestId("layers-hide-toggle").click();
    }
    /* PAINT PASS: which compositor layers get RE-PAINTED (CDP Layer.paintCount) while the pointer walks the left list? A hover that repaints hundreds of layers is a hover that can shake. */
    {
      let tree = []; const onTree = (e) => { if (e.layers) tree = e.layers; };
      cdp.on("LayerTree.layerTreeDidChange", onTree); await cdp.send("LayerTree.enable"); await sleep(1500);
      const before = new Map(tree.map((l) => [l.layerId, l.paintCount || 0]));
      const navBox = await panel.getByTestId("layer-group-nav").boundingBox();
      const x1 = navBox.x + navBox.width / 2, yT = navBox.y + 4, yB = navBox.y + navBox.height - 4;
      await page.mouse.move(x1, yT);
      for (let rep = 0; rep < 3; rep++) for (let i = 0; i <= 30; i++) { await page.mouse.move(x1, yT + (yB - yT) * (i / 30)); await sleep(20); }
      await sleep(1200);
      const repainted = tree.filter((l) => (l.paintCount || 0) > (before.get(l.layerId) ?? (l.paintCount || 0)));
      let total = 0; for (const l of tree) total += Math.max(0, (l.paintCount || 0) - (before.get(l.layerId) ?? (l.paintCount || 0)));
      const names = {};
      for (const l of repainted.slice(0, 40)) { if (!l.backendNodeId) { names["(no node)"] = (names["(no node)"] || 0) + 1; continue; } try { const { node } = await cdp.send("DOM.describeNode", { backendNodeId: l.backendNodeId }); const at = node.attributes || []; const ci = at.indexOf("class"); const ti = at.indexOf("data-testid"); const k = `${node.localName}${ti >= 0 ? "[" + at[ti + 1] + "]" : ""}.${ci >= 0 ? String(at[ci + 1]).split(/\s+/).slice(0, 2).join(".") : ""}`; names[k] = (names[k] || 0) + 1; } catch (_) { /* gone */ } }
      for (const l of repainted.slice(0, 3)) { try { const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: l.backendNodeId }); const info = await cdp.send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: "function(){ const chain=[]; for(let e=this;e&&e!==document.body&&chain.length<6;e=e.parentElement){chain.push((e.getAttribute('data-testid')||e.id||e.tagName.toLowerCase())+'.'+String(e.className).slice(0,24));} const r=this.getBoundingClientRect(); return JSON.stringify({chain, rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)], style:(this.getAttribute('style')||'').slice(0,200)}); }", returnByValue: true }); console.log("   repainted layer:", info.result.value); } catch (e) { console.log("   (could not resolve repainted layer)", String(e.message).slice(0, 80)); } }
      await cdp.send("LayerTree.disable"); cdp.off("LayerTree.layerTreeDidChange", onTree);
      console.log(`[layers ${a}] PAINT PASS: ${tree.length} compositor layers · ${repainted.length} re-painted during the hover walk (${total} paints)${repainted.length ? " · " + Object.entries(names).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, v]) => v + "× " + k).join(" | ") : ""}`);
    }
    /* PIXEL PASS (AGENT-RULES: a main-thread rect cannot see what the compositor drew). Screencast the COMPOSITED frames while the pointer walks the left group list, then
     * compare the nav strip's pixels frame to frame. The group buttons have no hover style, so ANY pixel that differs between two frames of the nav strip is the panel moving or
     * re-rastering under the pointer. KNOWN-GOOD: a frame pair taken across a forced 1 px shift of the nav must differ. */
    {
      const navBox = await panel.getByTestId("layer-group-nav").boundingBox();
      const frames = [];
      const onFrame = async (f) => { if (frames.length < 40) frames.push(f.data); try { await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }); } catch (_) { /* closed */ } };
      cdp.on("Page.screencastFrame", onFrame);
      await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: Math.round(1400 * DSF), maxHeight: Math.round(900 * DSF) });
      const x1 = navBox.x + navBox.width / 2, yT = navBox.y + 4, yB = navBox.y + navBox.height - 4;
      await page.mouse.move(x1, yT); await sleep(300);
      for (let rep = 0; rep < 3; rep++) { for (let i = 0; i <= 30; i++) { await page.mouse.move(x1, yT + (yB - yT) * (i / 30)); await sleep(20); } }
      await sleep(300);
      await cdp.send("Page.stopScreencast"); cdp.off("Page.screencastFrame", onFrame);
      const res = await page.evaluate(async ([frames, box]) => {
        const load = (b64) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.src = "data:image/png;base64," + b64; });
        const first = await load(frames[0]);
        const k = first.naturalWidth / window.innerWidth;   // screencast scale vs CSS px
        const reg = { x: Math.round(box.x * k), y: Math.round(box.y * k), w: Math.round(box.width * k), h: Math.round(box.height * k) };
        const px = async (im) => { const c = document.createElement("canvas"); c.width = reg.w; c.height = reg.h; const g = c.getContext("2d"); g.drawImage(im, reg.x, reg.y, reg.w, reg.h, 0, 0, reg.w, reg.h); return g.getImageData(0, 0, reg.w, reg.h).data; };
        const base = await px(first); let worst = 0, differing = 0; const per = [];
        for (let i = 1; i < frames.length; i++) {
          const cur = await px(await load(frames[i])); let n = 0;
          for (let j = 0; j < base.length; j += 4) if (Math.abs(base[j] - cur[j]) + Math.abs(base[j + 1] - cur[j + 1]) + Math.abs(base[j + 2] - cur[j + 2]) > 24) n++;
          per.push(n); worst = Math.max(worst, n); if (n > 0) differing++;
        }
        return { frames: frames.length, worst, differing, scale: k, reg };
      }, [frames, navBox]);
      console.log(`[layers ${a}] PIXEL PASS: ${res.frames} composited frames at ${res.scale.toFixed(2)}x · nav strip differs from frame 0 in ${res.differing} frames (worst ${res.worst} px)`);
      check(`KNOWN-GOOD · the screencast delivered ≥ 3 frames (${a})`, res.frames >= 3, `${res.frames}`); if (res.frames < 3) voided++;
      check(`NEW-2 · the composited nav strip is pixel-identical frame to frame while hovered (${a})`, res.differing === 0, `${res.differing} frames differ, worst ${res.worst} px`);
    }
    // POSITIVE CONTROL: the instrument must see a forced 1 px nudge of the panel itself
    await arm();
    await page.evaluate(() => { const r = document.querySelector('[data-testid="layer-panel"][data-surface="planner"]'); r.style.paddingTop = "1px"; });
    await page.mouse.move(100, 300); await page.mouse.move(110, 310); await sleep(100);
    const forced = await page.evaluate(() => window.__hover.steps.length);
    const dd = diffs(await page.evaluate(() => window.__hover.steps), await page.evaluate(() => window.__hover.base));
    check(`KNOWN-GOOD · the instrument reports a deliberately forced 1 px change (${a})`, forced > 0 && dd.length > 0, `${dd.length} steps flagged`); if (!(forced > 0 && dd.length > 0)) voided++;
  }
} finally {
  try {
    for (const id of cleanupIds) { const c = await cleanupLive(page, { planId: id }); const ok = c && c.left && c.left.site === 0 && !(c.errors || []).length; console.log(ok ? "throwaway plan deleted (re-read: gone)" : "CLEANUP INCOMPLETE — " + JSON.stringify(c)); if (!ok) failed++; }
  } catch (e) { console.log("CLEANUP FAILED — " + e.message); failed++; }
  await s.browser.close();
}
if (voided) console.log(`RUN VOID — ${voided} known-good arm(s) failed`);
process.exit(failed || voided ? 1 : 0);
