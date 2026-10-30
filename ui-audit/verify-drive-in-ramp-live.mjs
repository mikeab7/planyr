/* verify-drive-in-ramp-live — NEW-1…NEW-3 (owner 2026-10-30): drive-in ramps on dock walls, on a THROWAWAY plan with the REAL tools.
 *
 *   1  draw + select a building       → the small ramp "+" sits beside the dock-wall pair and each purple corner "+"; no two discs on the building overlap
 *   2  press a wall's ramp "+"        → ONE ramp child: 16 ft wide, 8 %, straight-in, 50 ft long; Properties open; the door belt lost the doors under it
 *   3  Along the wall                 → the footprint is 50 along × 16 out and lies ON the wall (no "runs past the end" flag)
 *   4  grade 12 %                     → the amber flag; 8 % clears it
 *   5  Delete, then Ctrl+Z            → the doors come back; undo restores the ramp
 * KNOWN-GOOD ARM: the building really shows dock doors before the ramp (VOID otherwise). Grading (owner-only) is NOT reachable on the test account: its
 * plane is proved in test/driveInRamp.test.js and is a step of V2015200 on the owner's account.
 * A throwaway plan only (never a real one): local seed, or with SIGNED_IN=1 a row inserted on the e2e test account that is DELETED (trash first) AND VERIFIED
 * GONE at the end (owner rule 15). Modes: BASE_URL (default local preview) · SIGNED_IN=1 · EXPECT_SHA=<merge sha> (read from /version.json in the SAME call).
 *   PW_CHROME=/opt/pw-browsers/chromium node ui-audit/verify-drive-in-ramp-live.mjs      (local)
 *   SIGNED_IN=1 BASE_URL=https://planyr.io EXPECT_SHA=<sha> SHOTS_DIR=/tmp/x node ui-audit/verify-drive-in-ramp-live.mjs */
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
const SITE_ID = "zz-driveinramp-" + Math.random().toString(36).slice(2, 8);
const site = { id: SITE_ID, groupId: SITE_ID, site: "ZZ Drive-in Ramp", name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12 };
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
const planEls = () => page.evaluate(([id, uid]) => { const keys = uid ? ["planarfit:sites:cloud:" + uid, "planarfit:sites:v1"] : ["planarfit:sites:v1"]; for (const k of keys) { const m = JSON.parse(localStorage.getItem(k) || "{}"); if (m[id]) return m[id].els || []; } return []; }, [SITE_ID, UID]);
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
  await openPlan();
  await assertMeasurable(page, "verify-drive-in-ramp-live");
  const served = await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build);
  console.log("served build", served);
  if (EXPECT_SHA) ok("the deploy is serving the merge commit", String(served || "").startsWith(EXPECT_SHA.slice(0, 7)), `served ${served}`);
  await center(0, 0, 3);
  await sleep(500);

  // ---- a building, selected ----------------------------------------------------------------------------------------------------------
  await page.getByRole("button", { name: /^Building$/ }).first().click();
  const a0 = await at(-120, -45), b0 = await at(120, 45);
  await page.mouse.move(a0.x, a0.y); await page.mouse.down();
  await page.mouse.move((a0.x + b0.x) / 2, (a0.y + b0.y) / 2, { steps: 4 }); await page.mouse.move(b0.x, b0.y, { steps: 6 });
  await page.mouse.up(); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Select V$/ }).click();
  await sleep(1200);
  const bl = (await planEls()).find((e) => e.type === "building" && !e.attachedTo);
  ok("a building was drawn", !!bl);
  if (!bl) throw new Error("VOID: no building");
  await page.evaluate(([x, y]) => window.__plannerView.centerOn(x, y, 3), [bl.cx, bl.cy]);
  await sleep(500);
  const mid = await at(bl.cx - OFF.x, bl.cy - OFF.y);
  await page.mouse.click(mid.x, mid.y);
  await T("feature-edit-nodes").waitFor({ timeout: 8000 });
  const leaves = (id) => page.evaluate((i) => document.querySelectorAll(`[data-el-id="${i}"] rect[fill="#c2c9d2"]`).length, id);
  const before = await leaves(bl.id);
  ok("known-good arm: the building shows dock doors", before > 4, `${before} door leaves`);
  if (!(before > 4)) throw new Error("VOID: no dock doors");

  // ---- 1 · the buttons ---------------------------------------------------------------------------------------------------------------
  const btns = await page.evaluate(() => [...document.querySelectorAll('[data-ramp-add="1"]')].map((g) => { const r = g.querySelector("circle").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, title: (g.querySelector("title") || {}).textContent || "" }; }));
  ok("ramp '+' buttons are on the building (wall + corner)", btns.length >= 2 && btns.every((b) => /drive-in/i.test(b.title)), btns.map((b) => b.title).join(" | "));
  const discs = await page.evaluate(() => [...document.querySelectorAll('[data-testid="feature-edit-nodes"] g[data-el-action="1"]')].map((g) => { const r = g.querySelector("circle").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, r: r.width / 2 }; }));
  let overlap = 0;
  for (let i = 0; i < discs.length; i++) for (let j = i + 1; j < discs.length; j++) if (Math.hypot(discs[i].x - discs[j].x, discs[i].y - discs[j].y) < discs[i].r + discs[j].r - 0.5) overlap++;
  ok("no two buttons on the building overlap", overlap === 0, `${overlap} overlapping pair(s) of ${discs.length}`);
  await shot("1-buttons");

  // ---- 2 · add a straight-in ramp mid-wall ----------------------------------------------------------------------------------------------
  const wallBtn = btns.filter((b) => Math.abs(b.x - mid.x) < 60).sort((a, b) => b.y - a.y)[0];
  await page.mouse.click(wallBtn.x, wallBtn.y);
  await sleep(1200);
  const ramps = async () => (await planEls()).filter((e) => e.type === "driveInRamp");
  let rs = await ramps();
  ok("one ramp was added, attached to the building", rs.length === 1 && rs[0].attachedTo === bl.id, `${rs.length}`);
  const r = rs[0];
  const horiz = r && (r.ramp.side === "top" || r.ramp.side === "bottom");
  ok("defaults: 16 ft wide, 8 %, straight-in, 50 ft long", !!r && r.ramp.width === 16 && r.ramp.gradePct === 8 && r.ramp.layout === "straight" && Math.round(horiz ? r.h : r.w) === 50 && Math.round(horiz ? r.w : r.h) === 16, r ? JSON.stringify(r.ramp) : "");
  ok("Properties show the ramp (length 50 ft)", (await T("ramp-length").textContent().catch(() => "")).trim() === "50 ft");
  const after = await leaves(bl.id);
  ok("the door belt lost the doors under the ramp", after < before && after >= before - 3, `${before} → ${after}`);
  ok("the ramp is drawn with its label", /RAMP/.test((await page.locator(`[data-el-id="${r.id}"] [data-ramp-label]`).first().textContent().catch(() => "")) || ""));
  await page.evaluate(([x, y]) => window.__plannerView.centerOn(x, y, 8), [r.cx, r.cy]);
  await sleep(500); await shot("2-straight-in");

  // ---- 3 · along the wall ------------------------------------------------------------------------------------------------------------
  await T("ramp-layout-along").click(); await sleep(900);
  const al = (await ramps())[0];
  ok("along the wall: 50 along × 16 out", al.ramp.layout === "along" && Math.round(horiz ? al.w : al.h) === 50 && Math.round(horiz ? al.h : al.w) === 16, JSON.stringify([al.w, al.h]));
  ok("…and it lies on the wall (no overrun flag)", (await T("ramp-flag-off-wall").count()) === 0);
  await shot("3-along");
  await T("ramp-layout-straight").click(); await sleep(600);

  // ---- 4 · the grade flag ------------------------------------------------------------------------------------------------------------
  await page.getByLabel("Ramp grade").fill("12"); await page.getByLabel("Ramp grade").press("Enter"); await sleep(700);
  ok("grade 12 % raises the amber flag", (await T("ramp-flag-grade").count()) === 1);
  await page.getByLabel("Ramp grade").fill("8"); await page.getByLabel("Ramp grade").press("Enter"); await sleep(700);
  ok("8 % clears it", (await T("ramp-flag-grade").count()) === 0);

  // ---- 5 · delete, undo --------------------------------------------------------------------------------------------------------------
  await T("ramp-delete").click(); await sleep(1000);
  ok("deleting the ramp brings the doors back", (await ramps()).length === 0 && (await leaves(bl.id)) === before, `${await leaves(bl.id)} vs ${before}`);
  await page.keyboard.press("Control+z"); await sleep(1000);
  ok("Ctrl+Z restores the ramp (and takes its doors again)", (await ramps()).length === 1 && (await leaves(bl.id)) < before);
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
