/* verify-ramp-follows-wall-live — B2671194 (owner 2026-11-06): a drive-in ramp is never left off its building. THROWAWAY plan, REAL tools.
 *
 *   A  a plan that ALREADY holds a stranded ramp (Building 4's shape: ramps placed against a longer wall, door centre past the end) opens with every ramp
 *      on its wall — healed on open, by the same rule the "+" button uses
 *   B  draw a building, add a ramp at each end of a dock wall, then SHORTEN it by typing the Length box → the far-end ramp moves with the end, the near-end
 *      one stays, none is off the wall; LENGTHEN → the far one goes back out; Ctrl+Z twice → building and ramps exactly as before; reload → kept
 * KNOWN-GOOD ARM: the building really has ramps (VOID otherwise) and the stranded seed really is off its wall before the heal can be judged (read from the
 * seeded record itself). A throwaway plan only (never a real one): local seed, or with SIGNED_IN=1 a row inserted on the e2e test account that is DELETED
 * (trash first) AND VERIFIED GONE at the end (owner rule 15). Modes: BASE_URL (default local preview) · SIGNED_IN=1 · EXPECT_SHA=<merge sha> (read from
 * /version.json in the SAME call).
 *   PW_CHROME=/opt/pw-browsers/chromium node ui-audit/verify-ramp-follows-wall-live.mjs      (local)
 *   SIGNED_IN=1 BASE_URL=https://planyr.io EXPECT_SHA=<sha> SHOTS_DIR=/tmp/x node ui-audit/verify-ramp-follows-wall-live.mjs */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173").replace(/\/$/, "");
const SHOTS = process.env.SHOTS_DIR || "";
const EXPECT_SHA = process.env.EXPECT_SHA || "";
const SIGNED = !!process.env.SIGNED_IN;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Building 4's shape, read-only from the owner's rows: h 784, rot 89, cross dock along y; ramps at 68.16 / 718 (fine) and 850.84 (past the 784 end).
const SEED_B = { id: "zzb4", type: "building", cx: 1600, cy: 0, w: 400, h: 784, rot: 89, dock: "cross", dockAxis: "y", dockSide: "right" };
const SEED_RAMPS = [["zzr1", "right", 68.16], ["zzr2", "left", 68.16], ["zzr3", "right", 850.84], ["zzr4", "left", 850.84], ["zzr5", "right", 718], ["zzr6", "left", 718]]
  .map(([id, side, at]) => ({ id, type: "driveInRamp", attachedTo: "zzb4", noLabel: true, ramp: { side, at, width: 16, gradePct: 8, layout: "straight", dir: 1, door: "12x14", wings: true, bollards: true }, cx: 0, cy: 0, w: 16, h: 50, rot: 89 }));
const SEED_ELS = [SEED_B, ...SEED_RAMPS];
const SITE_ID = "zz-rampfollows-" + Math.random().toString(36).slice(2, 8);
const site = { id: SITE_ID, groupId: SITE_ID, site: "ZZ Ramp Follows Wall", name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "harris", parcels: [], els: SEED_ELS, measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12 };
const PPF = 1.5;

let browser, ctx, page, S = null, UID = null;
const errors = [];
if (SIGNED) {
  S = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; localStorage.setItem("planarfit:startHintDismissed", "1"); }, null]] });
  browser = S.browser; ctx = S.context; page = S.page;
} else {
  const exe = existsSync(chromium.executablePath()) ? undefined : (process.env.PW_CHROME || "/opt/pw-browsers/chromium");
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await page.addInitScript((s) => { try { window.__PLANYR_E2E = true; localStorage.setItem("planarfit:startHintDismissed", "1"); if (!localStorage.getItem("zz-seeded-" + s.id)) { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [s.id]: s })); localStorage.setItem("planarfit:currentSite:v1", s.id); localStorage.setItem("zz-seeded-" + s.id, "1"); } } catch (_) {} }, site);
}
page.on("pageerror", (e) => { if (!/infinite number of tiles/.test(String(e))) errors.push(String(e)); });
await page.route("**/*.jpg", (r) => r.abort());
const T = (id) => page.getByTestId(id);
const shot = async (n) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${n}.png` }); };
const net = () => page.evaluate(() => (window.__plannerRoadNet ? window.__plannerRoadNet() : null));
const view = () => page.evaluate(() => window.__plannerView.get());
let OFF = { x: 0, y: 0 };   // each case lives on its own patch of the plan, 400 ft apart, so one case's field never meets another's road
const at = async (fx, fy) => { const box = await T("planner-canvas").boundingBox(); const v = await view(); return { x: box.x + v.offX + (fx + OFF.x) * v.ppf, y: box.y + v.offY + (fy + OFF.y) * v.ppf }; };
const click = async (fx, fy, o) => { const p = await at(fx, fy); await page.mouse.click(p.x, p.y, o); };
const planEls = () => page.evaluate(([id, uid]) => { const keys = uid ? ["planarfit:sites:cloud:" + uid, "planarfit:sites:v1"] : ["planarfit:sites:v1"]; for (const k of keys) { const m = JSON.parse((globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))(k) || "{}"); if (m[id]) return m[id].els || []; } return []; }, [SITE_ID, UID]);
const clipOf = async (id) => ((await net())?.stallClips || []).find((c) => c.id === id) || null;
const center = (fx, fy, ppf = PPF) => page.evaluate(([x, y, p]) => window.__plannerView.centerOn(x, y, p), [fx + OFF.x, fy + OFF.y, ppf]);
const patch = async (ox, oy) => { OFF = { x: ox, y: oy }; await center(0, 0); await sleep(500); };
const seen = new Set();
const newField = async () => { const f = (await planEls()).find((e) => e.type === "parking" && !seen.has(e.id)); if (f) seen.add(f.id); return f; };
const drawField = async (x0, y0, x1, y1) => {
  await page.getByRole("button", { name: "Parking", exact: true }).click();
  const a = await at(x0, y0), b = await at(x1, y1);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 }); await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up(); await page.keyboard.press("Escape");
};
const drawRoad = async (pts) => {
  await page.getByRole("button", { name: "Road", exact: true }).click();
  for (const [x, y] of pts) await click(x, y);
  await page.keyboard.press("Enter"); await page.keyboard.press("Escape");
};
const clearPlan = async () => { await page.keyboard.press("Escape"); await page.keyboard.press("Control+a"); await page.keyboard.press("Delete"); await sleep(600); };
const openPlan = async () => {
  if (SIGNED) { await page.goto(`${BASE}/#/project/${SITE_ID}/site`, { waitUntil: "load" }); await page.reload({ waitUntil: "load" }); }
  else {
    await page.goto(BASE + "/", { waitUntil: "load" });
    await page.getByTestId("module-tab-site-planner").filter({ visible: true }).click().catch(() => {});
  }
  await T("planner-canvas").waitFor({ timeout: 45000 });
  await sleep(1500);
};

try {
  if (SIGNED) {
    UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
    const ins = await page.evaluate(async (st) => {
      const { data: u } = await window.pfSupabase.auth.getUser();
      const row = { id: st.id, group_id: st.groupId, site: st.site, name: st.name, county: st.county, updated_at: new Date().toISOString(), data: st, user_id: u.user.id };
      let r = await window.pfSupabase.from("sites").insert(row);
      if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
      return r.error ? String(r.error.message) : null;
    }, site);
    ok("throwaway plan written to the test account", !ins, ins || "");
  }
  // the known-good arm for A: the seeded record really holds a ramp past its wall
  ok("known-good arm: the seed holds ramps past the end of a 784-ft wall", SEED_RAMPS.filter((r) => r.ramp.at > 784).length === 2);
  await openPlan();
  await assertMeasurable(page, "verify-ramp-follows-wall-live");
  const served = await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build);
  console.log("served build", served);
  if (EXPECT_SHA) ok("the deploy is serving the merge commit", String(served || "").startsWith(EXPECT_SHA.slice(0, 7)), `served ${served}`);

  // ---- A · a plan that already holds stranded ramps opens healed ---------------------------------------------------------------------------
  const wallOf = (b, side) => (side === "top" || side === "bottom" ? b.w : b.h);
  await sleep(1500);
  let all = await planEls();
  const sb = all.find((e) => e.id === "zzb4"), sr = all.filter((e) => e.type === "driveInRamp" && e.attachedTo === "zzb4");
  ok("A: the seeded building is on the plan", !!sb);
  ok("A: no ramp of the stranded building is left past the end of its wall (healed on open)", !!sb && sr.length > 0 && sr.every((e) => e.ramp.at <= wallOf(sb, e.ramp.side) + 0.01 && e.ramp.at >= -0.01), sr.map((e) => `${e.ramp.side}:${e.ramp.at}`).join(" "));
  ok("A: the ramps already on the wall were not moved", [68.16, 718].every((v) => sr.some((e) => e.ramp.side === "right" && e.ramp.at === v)) , sr.map((e) => `${e.ramp.side}:${e.ramp.at}`).join(" "));
  ok("A: the pair that was past the end is no longer past it, and none sits on another ramp", !sr.some((e) => e.ramp.at > 784.01) && !sr.some((a, i) => sr.some((b, j) => j > i && a.ramp.side === b.ramp.side && Math.abs(a.ramp.at - b.ramp.at) < 16 - 0.5)), `${sr.length} ramps left`);

  // ---- B · shorten / lengthen a building carrying end ramps --------------------------------------------------------------------------------
  await center(0, 0, 3);
  await sleep(500);
  await page.getByRole("button", { name: /^Building$/ }).first().click();
  const a0 = await at(-120, -45), b0 = await at(120, 45);
  await page.mouse.move(a0.x, a0.y); await page.mouse.down();
  await page.mouse.move((a0.x + b0.x) / 2, (a0.y + b0.y) / 2, { steps: 4 }); await page.mouse.move(b0.x, b0.y, { steps: 6 });
  await page.mouse.up(); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Select V$/ }).click();
  await sleep(1200);
  const bl = (await planEls()).find((e) => e.type === "building" && !e.attachedTo && e.id !== "zzb4");
  ok("B: a building was drawn", !!bl);
  if (!bl) throw new Error("VOID: no building");
  const rampsOf = async () => (await planEls()).filter((e) => e.type === "driveInRamp" && e.attachedTo === bl.id);
  const buildingNow = async () => (await planEls()).find((e) => e.id === bl.id);
  for (const pick of ["first", "last"]) {
    const dx = pick === "first" ? -70 : 70;
    await page.evaluate(([x, y]) => window.__plannerView.centerOn(x, y, 3), [bl.cx + dx, bl.cy]);
    await sleep(500);
    const p = await at(bl.cx + dx - OFF.x, bl.cy - OFF.y);
    await page.mouse.click(p.x, p.y);
    await T("feature-edit-nodes").waitFor({ timeout: 8000 });
    const btns = (await page.evaluate(() => [...document.querySelectorAll('[data-ramp-add="1"]')].map((g) => { const r = g.querySelector("circle").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }))).sort((a, b) => a.y - b.y || a.x - b.x);
    const btn = pick === "first" ? btns[0] : btns[btns.length - 1];
    await page.mouse.click(btn.x, btn.y);
    await sleep(1100);
  }
  const before = await rampsOf();
  ok("B: known-good arm — the building carries two ramps, one at each end of a wall", before.length >= 2, before.map((r) => `${r.ramp.side}:${r.ramp.at}`).join(" "));
  if (before.length < 2) throw new Error("VOID: fewer than two ramps");
  const lenIsW = bl.w >= bl.h, L0 = lenIsW ? bl.w : bl.h, L1 = Math.round(L0 - 90);
  const wallLen = (side, b) => (side === "top" || side === "bottom" ? b.w : b.h);
  const typeLength = async (n) => {
    await page.evaluate(([x, y]) => window.__plannerView.centerOn(x, y, 3), [bl.cx + 70, bl.cy]);
    await sleep(400);
    const p = await at(bl.cx + 70 - OFF.x, bl.cy - OFF.y);
    await page.mouse.click(p.x, p.y);
    await T("footprint-length").waitFor({ timeout: 8000 });
    await T("footprint-length").fill(String(n)); await T("footprint-length").press("Enter");
    await sleep(1100);
  };
  await typeLength(L1);
  const nb = await buildingNow(), after = await rampsOf();
  ok("B: the building is shorter", Math.round(lenIsW ? nb.w : nb.h) === L1, `${Math.round(lenIsW ? nb.w : nb.h)} (asked ${L1})`);
  ok("B: every ramp is still there and none is off the end of the building", after.length === before.length && after.every((r) => r.ramp.at <= wallLen(r.ramp.side, nb) + 0.01 && r.ramp.at >= -0.01), after.map((r) => `${r.ramp.side}:${r.ramp.at}/${wallLen(r.ramp.side, nb)}`).join(" "));
  ok("B: each ramp keeps its distance from the end it was placed against", after.every((r) => { const w = before.find((q) => q.id === r.id); const far = w.ramp.at > wallLen(w.ramp.side, bl) / 2; return Math.abs(r.ramp.at - (far ? wallLen(r.ramp.side, nb) - (wallLen(w.ramp.side, bl) - w.ramp.at) : w.ramp.at)) < 0.2; }));
  await shot("B-shortened");
  await typeLength(Math.round(L0));
  ok("B: lengthening again puts the far-end ramps back out with the end", (await rampsOf()).every((r) => Math.abs(r.ramp.at - before.find((q) => q.id === r.id).ramp.at) < 0.2));
  await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press("Control+z"); await sleep(900);
  await page.keyboard.press("Control+z"); await sleep(900);
  const undone = await rampsOf(), ub = await buildingNow();
  ok("B: Ctrl+Z twice — the building and every ramp are exactly as they were", Math.round(lenIsW ? ub.w : ub.h) === Math.round(L0) && undone.map((r) => `${r.id}:${r.ramp.at}`).sort().join() === before.map((r) => `${r.id}:${r.ramp.at}`).sort().join());
  await page.keyboard.press("Control+y"); await sleep(1000);
  await sleep(1500);
  await openPlan();
  const rb = (await planEls()).find((e) => e.id === bl.id), reloaded = (await planEls()).filter((e) => e.type === "driveInRamp" && e.attachedTo === bl.id);
  ok("B: after a reload the ramps are still on the (shortened) building", reloaded.length === before.length && reloaded.every((r) => r.ramp.at <= wallLen(r.ramp.side, rb) + 0.01), reloaded.map((r) => `${r.ramp.side}:${r.ramp.at}`).join(" "));
  ok("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (e) {
  ok("harness ran to the end", false, String(e && e.stack || e).slice(0, 400));
} finally {
  if (SIGNED) {
    const gone = await page.evaluate(async (id) => {
      // the database refuses a permanent delete of a plan that is not in the trash first (sites_block_delete_live_group)
      try { await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id); } catch (_) {}
      try { await window.pfSupabase.from("site_elements").delete().eq("site_id", id); } catch (_) {}
      await window.pfSupabase.from("sites").delete().eq("id", id);
      const r = await window.pfSupabase.from("sites").select("id").eq("id", id);
      return { cloud: !!r.data && r.data.length === 0 };
    }, SITE_ID).catch((e) => ({ cloud: false, err: String(e) }));
    ok("throwaway plan deleted and verified gone", !!gone.cloud, JSON.stringify(gone));
  }
  await (S ? S.close() : browser.close());
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
