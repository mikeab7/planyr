/* verify-parcel-delete-flow — NEW-1 (2026-10-22): parcel delete is ONE path, ONE menu, Undo everywhere.
 *
 * Drives every door a parcel delete can come through and requires the SAME behaviour from each — deleted AT ONCE (no confirm), a
 * "Deleted …" toast carrying Undo, Undo puts it back whole, and the result survives a reload:
 *   1 row ⋯ menu            (k1; delete -> Undo -> delete -> reload: stays deleted)
 *   2 right-click a row     (k2, a LOCKED parcel: it deletes like any other; the menu has the same items, same order, as the ⋯)
 *   3 right-click on the map(k4: the checkbox must NOT get ticked; same items, same order)
 *   4 the Delete key        (k5 selected on the map -> real key press; and Delete on a focused panel row, k7)
 *   5 the rail's Parcel tools -> Delete parcel (k6; delete -> Undo -> reload: stays restored)
 *   6 the checked bar       (k3 inactive + setbacks, d1 drawn: ONE step, ONE toast "Deleted 2 parcels", ONE Undo restores both whole)
 *   + the parcel's own page closes when its parcel is deleted · Un-combine ("Brings back the 2 lots") · the Parcel tool has no Remove
 *   · deleting every parcel leaves a sane panel (0.00 AC) and Undo brings them all back.
 * KNOWN-GOOD ARM: VOID unless the 9 seeded rows (a locked one, an inactive one with setbacks, a combined tract) are present.
 * A throwaway plan only (never a real one) — local seed, or with SIGNED_IN=1 a row inserted on the e2e test account that is DELETED
 * AND VERIFIED GONE at the end (owner rule 15). Modes: BASE_URL (default local preview) · SIGNED_IN=1 · EXPECT_SHA=<merge sha>.
 */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173").replace(/\/$/, "");
const SHOTS = process.env.SHOTS_DIR || "";
const EXPECT_SHA = process.env.EXPECT_SHA || "";
const SIGNED = !!process.env.SIGNED_IN;
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sq = (x, y, id, extra = {}) => ({ id, points: [{ x, y }, { x: x + 300, y }, { x: x + 300, y: y + 300 }, { x, y: y + 300 }], source: "county", ...extra });
const snap = (p, name) => ({ ...p, snapName: name });
const SITE_ID = "zz-pdel-" + Math.random().toString(36).slice(2, 8);
const SETBACKS = [25, 10, 30, 10];
const site = {
  id: SITE_ID, groupId: SITE_ID, site: "ZZ Parcel Delete", name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "chambers",
  parcels: [
    sq(0, 0, "k1", { label: "KILGORE PKWY", gisKey: "k1", attrs: { OWNER: "A" } }),
    sq(400, 0, "k2", { label: "LIBERTY DR", gisKey: "k2", attrs: { OWNER: "B" }, locked: true, lockSem: 2 }),
    sq(800, 0, "k3", { label: "MAIN ST", gisKey: "k3", attrs: { OWNER: "C" }, active: false, setbacks: SETBACKS }),
    sq(1200, 0, "k4", { label: "OAK LN", gisKey: "k4", attrs: { OWNER: "D" } }),
    sq(0, 400, "k5", { label: "PINE RD", gisKey: "k5", attrs: { OWNER: "E" } }),
    sq(400, 400, "k6", { label: "ELM CT", gisKey: "k6", attrs: { OWNER: "F" } }),
    sq(800, 400, "k7", { label: "CEDAR WAY", gisKey: "k7", attrs: { OWNER: "G" } }),
    { id: "c1", label: "Tract A", ...sq(1200, 400, "c1"), source: undefined, combined: { from: [snap(sq(1200, 400, "c1a"), "Lot A"), snap(sq(1350, 400, "c1b"), "Lot B")] } },
    sq(0, 800, "d1", { source: "drawn" }),
  ],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12,
};
const NAMES = { k1: "KILGORE PKWY", k2: "LIBERTY DR", k3: "MAIN ST", k4: "OAK LN", k5: "PINE RD", k6: "ELM CT", k7: "CEDAR WAY" };

let browser, ctx, page, UID = null, served = null, S = null;
const errors = [];
if (SIGNED) {
  S = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
  browser = S.browser; ctx = S.context; page = S.page;
} else {
  const exe = existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium";
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await page.addInitScript((s) => { try { window.__PLANYR_E2E = true; if (!localStorage.getItem("zz-seeded-" + s.id)) { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [s.id]: s })); localStorage.setItem("planarfit:currentSite:v1", s.id); localStorage.setItem("zz-seeded-" + s.id, "1"); } } catch (_) {} }, site);
}
page.on("pageerror", (e) => { if (!/infinite number of tiles/.test(String(e))) errors.push(String(e)); });
await page.route("**/*.jpg", (r) => r.abort());
const T = (id) => page.getByTestId(id);
const shot = async (n) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${n}.png` }); };
const storedLocal = () => page.evaluate(([id, uid]) => { const keys = uid ? ["planarfit:sites:cloud:" + uid] : ["planarfit:sites:v1"]; for (const k of keys) { const m = JSON.parse(localStorage.getItem(k) || "{}"); if (m[id]) return m[id].parcels || []; } return []; }, [SITE_ID, UID]);
const storedCloud = () => page.evaluate(async (id) => { const r = await window.pfSupabase.from("sites").select("data").eq("id", id).maybeSingle(); return r.data && r.data.data ? (r.data.data.parcels || []) : null; }, SITE_ID);
const stored = async () => (SIGNED ? ((await storedCloud()) || (await storedLocal())) : storedLocal());
const rowIds = () => page.locator('[data-testid^="parcel-table-row-"]').evaluateAll((e) => e.map((n) => n.getAttribute("data-testid").replace("parcel-table-row-", "")));
const has = async (id) => (await rowIds()).includes(id);
const toasts = () => page.getByTestId("sync-toast");
const toastTexts = async () => (await toasts().allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
const undoInToast = async (re) => { const t = toasts().filter({ hasText: re }).last(); await t.getByRole("button", { name: "Undo" }).click(); await sleep(700); };
const menuIds = (testId) => page.getByTestId(testId).locator('[role="menuitem"]').evaluateAll((e) => e.map((n) => n.getAttribute("data-testid").split("-").pop()));
/* points ON a parcel's boundary (the midpoint of each edge) through the live SVG transform — never boundingBox() (selection thickens the stroke) */
const edgePoints = (id) => page.evaluate((pid) => {
  const g = document.querySelector(`[data-feature="parcel:${pid}"]`); if (!g) return [];
  const poly = g.querySelector('[data-testid="parcel-outline"]'); if (!poly) return [];
  const pts = poly.getAttribute("points").trim().split(/\s+/).map((s) => s.split(",").map(Number));
  return pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const p = poly.ownerSVGElement.createSVGPoint(); p.x = (a[0] + b[0]) / 2; p.y = (a[1] + b[1]) / 2;
    const s = p.matrixTransform(poly.getScreenCTM()); return [Math.round(s.x), Math.round(s.y)];
  });
}, id);
/* the point on a parcel's boundary, re-read until the page's own hit test says it IS that parcel (the view may still be settling after an Undo / reload) */
const settledEdgePoint = async (id) => {
  for (let i = 0; i < 20; i++) {
    for (const at of await edgePoints(id)) {
      const top = await page.evaluate(([x, y]) => { const n = document.elementFromPoint(x, y); const f = n && n.closest && n.closest("[data-feature]"); return f ? f.getAttribute("data-feature") : null; }, at);
      if (top === `parcel:${id}`) return at;
    }
    await sleep(250);
    if (i === 3) { await page.getByRole("button", { name: "Zoom to fit" }).first().click(); await sleep(600); } // the docked panel can cover this lot: fit like a user would
  }
  const dbg = await page.evaluate((pid) => { const g = document.querySelector(`[data-feature="parcel:${pid}"]`); return { has: !!g, feats: [...document.querySelectorAll("[data-feature]")].map((n) => n.getAttribute("data-feature")).join(",") }; }, id);
  throw new Error(`VOID: could not find a settled hit point on parcel ${id} :: ${JSON.stringify(dbg)} :: ${JSON.stringify(await Promise.all((await edgePoints(id)).map(async (at) => [at, await page.evaluate(([x, y]) => document.elementsFromPoint(x, y).slice(0, 3).map((n) => n.tagName + "." + (n.getAttribute("data-testid") || n.className || "")).join(">"), at)])))}`);
};
const openPlan = async () => {
  if (SIGNED) await page.goto(`${BASE}/#/project/${SITE_ID}/site`, { waitUntil: "load" });
  else { await page.goto(BASE + "/#/site-planner", { waitUntil: "load" }); }
  if (!(await T("planner-canvas").isVisible().catch(() => false))) {
    const entry = page.getByText("ZZ Parcel Delete", { exact: false }).first();
    await entry.waitFor({ timeout: 25000 });
    await entry.click();
  }
  await T("planner-canvas").waitFor({ timeout: 45000 });
  await sleep(1500);
  await page.locator('[data-rail-tab="parcel"]').first().click();
  await T("parcels-panel").waitFor({ timeout: 15000 });
};
const reloadPlan = async () => { await page.reload({ waitUntil: "load" }); await sleep(2500); if (SIGNED) await openPlan(); else { await openPlan(); } };

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
  await assertMeasurable(page, "verify-parcel-delete-flow");
  served = await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build);
  console.log("served build", served);
  if (EXPECT_SHA) ok("the deploy is serving the merge commit", String(served || "").startsWith(EXPECT_SHA.slice(0, 7)), `served ${served}`);
  const ids0 = await rowIds();
  if (ids0.length < 9) throw new Error(`VOID: expected the 9 seeded rows, saw ${ids0.length}`);
  ok("known-good arm: 9 seeded rows incl. a locked one, an inactive one and a combined tract", (await T("parcel-row-lock-k2").getAttribute("data-locked")) === "1" && (await T("parcel-row-eye-k3").getAttribute("data-included")) === "0" && /Tract A/.test(await T("parcel-row-c1").innerText()));
  ok("the row ⋯ is ALWAYS visible (not hover-only): opacity 1 with the pointer elsewhere", await T("parcel-row-more-k1").evaluate((n) => getComputedStyle(n).opacity === "1"));

  const BASE_SEEDED = ids0.length; // k1 is deleted for good in step 1 (reload proves it), so every later count is one fewer
  const KEEP = BASE_SEEDED - 1;
  // ---- 1 · row ⋯ ------------------------------------------------------------------------------------------------------------------
  await T("parcel-row-more-k1").click(); await sleep(200);
  const rowMenuK1 = await menuIds("parcel-row-menu-k1");
  ok("⋯ menu: Properties · Zoom to · Lock · Hide label · rule · Delete (no Rename on a county lot, no 'Delete…', no confirm)", JSON.stringify(rowMenuK1) === JSON.stringify(["properties", "zoom", "lock", "chip", "delete"]), JSON.stringify(rowMenuK1));
  ok("Delete parcel is the red last row with the Del hint", /Delete parcel\s*Del/.test((await T("parcel-row-menu-k1-delete").innerText()).replace(/\s+/g, " ")));
  await shot("menu");
  await T("parcel-row-menu-k1-delete").click(); await sleep(600);
  ok("1 row ⋯ → Delete parcel deletes AT ONCE (no confirm step) and stores the removal", !(await has("k1")) && (await T("parcel-row-delete-confirm-k1").count()) === 0 && !(await stored()).some((p) => p.id === "k1"));
  ok("1 …a 'Deleted KILGORE PKWY' toast carries Undo", (await toastTexts()).some((t) => /Deleted KILGORE PKWY/.test(t) && /Undo/.test(t)), JSON.stringify(await toastTexts()));
  await undoInToast(/Deleted KILGORE PKWY/);
  ok("1 …Undo brings it back (list + storage)", (await has("k1")) && (await stored()).some((p) => p.id === "k1"));
  await T("parcel-row-more-k1").click(); await T("parcel-row-menu-k1-delete").click(); await sleep(2500);
  await reloadPlan();
  ok("1 …delete then RELOAD: stays deleted (tombstone)", !(await has("k1")), JSON.stringify(await rowIds()));

  // ---- 2 · right-click a panel row (a LOCKED parcel) ----------------------------------------------------------------------------
  await T("parcel-row-name-k2").click({ button: "right" }); await sleep(250);
  const ctxIds = await menuIds("parcel-row-menu-k2");
  ok("2 right-click on a row opens the SAME menu, same items in the same order as the ⋯", JSON.stringify(ctxIds) === JSON.stringify(rowMenuK1), JSON.stringify(ctxIds));
  ok("2 …a locked parcel's Delete is not greyed and has no 'Unlock to delete' hint", (await T("parcel-row-menu-k2-delete").isEnabled()) && !/unlock to delete/i.test(await T("parcel-row-menu-k2").innerText()) && /Unlock/.test(await T("parcel-row-menu-k2-lock").innerText()));
  await T("parcel-row-menu-k2-delete").click(); await sleep(600);
  ok("2 …Delete removes the LOCKED parcel like any other, with a toast", !(await has("k2")) && (await toastTexts()).some((t) => /Deleted LIBERTY DR/.test(t)));
  await undoInToast(/Deleted LIBERTY DR/);
  ok("2 …Undo restores it still locked", (await has("k2")) && (await T("parcel-row-lock-k2").getAttribute("data-locked")) === "1" && (await stored()).find((p) => p.id === "k2").locked === true);

  // ---- 3 · right-click on the map ------------------------------------------------------------------------------------------------
  await page.keyboard.press("Escape"); await sleep(150);
  const at4 = await settledEdgePoint("k4");
  ok("known-good arm: parcel k4's boundary is on screen", !!at4 && at4[0] > 0 && at4[1] > 0, JSON.stringify(at4));
  await page.mouse.move(at4[0], at4[1]); await page.mouse.click(at4[0], at4[1], { button: "right" }); await sleep(300);
  ok("3 map right-click opens the menu", (await T("parcel-menu").count()) === 1);
  ok("3 …and does NOT tick the parcel's checkbox (it used to add it to the merge set)", !(await T("parcel-row-check-k4").isChecked()) && (await T("parcels-action-bar").count()) === 0);
  const mapIds = await menuIds("parcel-menu");
  ok("3 …the SAME items in the SAME order as the row menu", JSON.stringify(mapIds) === JSON.stringify(rowMenuK1), JSON.stringify(mapIds));
  ok("3 …no stray 'Shift-click parcels to add more' hint line", !/Shift-click parcels/.test(await T("parcel-menu").innerText()));
  await T("parcel-menu-delete").click(); await sleep(600);
  ok("3 …Delete parcel deletes at once with a toast", !(await has("k4")) && (await toastTexts()).some((t) => /Deleted OAK LN/.test(t)));
  await undoInToast(/Deleted OAK LN/);
  ok("3 …Undo restores it", await has("k4"));

  // ---- 4 · the Delete key (map selection, then a focused panel row) ---------------------------------------------------------------
  await page.keyboard.press("Escape"); await sleep(150);
  const at5 = await settledEdgePoint("k5"); await page.mouse.click(at5[0], at5[1]); await sleep(300);
  ok("known-good arm: clicking k5's boundary selected it (with the Land panel open it shows k5's page)", /PINE RD/.test(await T("parcel-page-name").innerText().catch(() => "")));
  await page.keyboard.press("Delete"); await sleep(600);
  ok("4 the Delete key deletes the selected parcel with a toast + Undo (a real key press)", !(await has("k5")) && (await toastTexts()).some((t) => /Deleted PINE RD/.test(t) && /Undo/.test(t)), JSON.stringify(await toastTexts()));
  await undoInToast(/Deleted PINE RD/);
  ok("4 …Undo restores it", await has("k5"));
  await T("parcel-row-k7").focus(); await page.keyboard.press("Delete"); await sleep(600);
  ok("4 Delete on a focused panel row deletes at once too (no confirm), with a toast", !(await has("k7")) && (await T("parcel-row-delete-confirm-k7").count()) === 0 && (await toastTexts()).some((t) => /Deleted CEDAR WAY/.test(t)));
  await undoInToast(/Deleted CEDAR WAY/);
  ok("4 …Undo restores it", await has("k7"));

  // ---- 5 · the rail's Parcel tools -> Delete parcel -------------------------------------------------------------------------------
  await page.keyboard.press("Escape"); await sleep(150);
  const at6 = await settledEdgePoint("k6"); await page.mouse.click(at6[0], at6[1]); await sleep(300);
  await T("rail-parcel-tools").click(); await sleep(250);
  await page.locator('[data-parcel-action="deleteSelected"]').click(); await sleep(600);
  ok("5 rail Parcel tools → Delete parcel deletes the selected parcel with a toast + Undo", !(await has("k6")) && (await toastTexts()).some((t) => /Deleted ELM CT/.test(t) && /Undo/.test(t)), JSON.stringify(await toastTexts()));
  await undoInToast(/Deleted ELM CT/);
  ok("5 …Undo restores it", await has("k6"));
  await sleep(2500);
  await reloadPlan();
  ok("5 …delete, Undo, RELOAD: stays restored", await has("k6"));

  // ---- 6 · the checked bar ---------------------------------------------------------------------------------------------------------
  await T("parcel-row-check-k3").check(); await sleep(150);
  ok("6 one checked parcel shows no bar", (await T("parcels-action-bar").count()) === 0);
  await T("parcel-row-check-d1").check(); await sleep(250);
  ok("6 two checked: the bar shows '2 selected' + Combine + Delete (danger colour)", /2 selected/.test(await T("parcels-action-bar").innerText()) && (await T("parcels-bar-combine").count()) === 1 && (await T("parcels-bar-delete").count()) === 1 && (await T("parcels-bar-delete").evaluate((n) => getComputedStyle(n).color)) !== (await T("parcels-bar-combine").evaluate((n) => getComputedStyle(n).color)));
  await shot("bar");
  await T("parcels-bar-delete").click(); await sleep(700);
  ok("6 Delete removes ALL checked parcels at once", !(await has("k3")) && !(await has("d1")) && (await T("parcels-action-bar").count()) === 0 && !(await stored()).some((p) => p.id === "k3" || p.id === "d1"));
  const tx = await toastTexts();
  ok("6 …ONE toast 'Deleted 2 parcels' with Undo (not two toasts)", tx.filter((t) => /Deleted 2 parcels/.test(t)).length === 1 && !tx.some((t) => /Deleted MAIN ST/.test(t)), JSON.stringify(tx));
  await undoInToast(/Deleted 2 parcels/);
  const back = await stored();
  const k3 = back.find((p) => p.id === "k3");
  ok("6 …ONE Undo restores BOTH, whole: names, the inactive state and the setbacks", (await has("k3")) && (await has("d1")) && !!k3 && k3.label === "MAIN ST" && k3.active === false && JSON.stringify(k3.setbacks) === JSON.stringify(SETBACKS), JSON.stringify(k3 && { l: k3.label, a: k3.active, s: k3.setbacks }));

  // ---- the parcel's own page closes with its parcel ---------------------------------------------------------------------------------
  await T("parcel-row-name-k5").click(); await T("parcel-page").waitFor({ timeout: 8000 });
  ok("a row opens the parcel's page", /PINE RD/.test(await T("parcel-page-name").innerText()));
  await T("parcel-page-more").click(); await T("parcel-page-delete").click(); await sleep(600);
  ok("deleting the parcel whose page is open closes the page (no page for a parcel that is gone)", (await T("parcel-page").count()) === 0 && !(await has("k5")) && (await T("parcels-panel").count()) === 1);
  await undoInToast(/Deleted PINE RD/);
  ok("…Undo restores it", await has("k5"));

  // ---- Un-combine -------------------------------------------------------------------------------------------------------------------
  await T("parcel-row-more-c1").click(); await sleep(200);
  const c1Ids = await menuIds("parcel-row-menu-c1");
  ok("a combined tract's menu: Rename above Zoom to, and Un-combine between the rule and Delete", JSON.stringify(c1Ids) === JSON.stringify(["properties", "rename", "zoom", "lock", "chip", "uncombine", "delete"]), JSON.stringify(c1Ids));
  ok("Un-combine says 'Brings back the 2 lots'", /Brings back the 2 lots/.test(await T("parcel-row-menu-c1-uncombine").innerText()));
  await T("parcel-row-menu-c1-uncombine").click(); await sleep(700);
  const afterUn = await rowIds();
  ok("Un-combine brings the 2 lots back (tract gone, two new rows)", !afterUn.includes("c1") && afterUn.length === KEEP + 1, JSON.stringify(afterUn));
  await undoInToast(/Restored 2 originals/);
  ok("…Undo puts the tract back", (await has("c1")) && (await rowIds()).length === KEEP);

  // ---- the Parcel tool has no Remove -----------------------------------------------------------------------------------------------
  await T("rail-parcel-tools").click(); await sleep(250);
  await page.locator('[data-parcel-action="draw"]').click(); await sleep(300);
  ok("the Parcel tool's banner has Done but NO Remove, and no 'click a parcel to delete it'", (await page.getByRole("button", { name: /^Done$/ }).count()) >= 1 && (await page.getByRole("button", { name: /Remove/ }).count()) === 0 && (await page.getByText(/click a parcel to delete it/i).count()) === 0);
  await page.keyboard.press("Escape"); await sleep(200);

  // ---- delete EVERY parcel: a sane empty panel, then Undo brings them all back ------------------------------------------------------
  const allIds = await rowIds();
  for (const id of allIds) await T("parcel-row-check-" + id).check();
  await sleep(250);
  await T("parcels-bar-delete").click(); await sleep(800);
  const emptyText = await page.locator("body").innerText();
  ok("deleting the last parcels leaves an empty list and the empty state ('No land in this plan yet'), no NaN anywhere", (await rowIds()).length === 0 && /No land in this plan yet/.test(emptyText) && !/NaN/.test(emptyText));
  await shot("empty");
  await undoInToast(new RegExp(`Deleted ${KEEP} parcels`));
  ok(`…one Undo brings all ${KEEP} back, with the site line again`, (await rowIds()).length === KEEP && /AC in site/.test(await T("parcels-summary").innerText()));
  ok("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
} catch (e) {
  console.log("ERROR", e.message); results.push({ name: "harness error: " + e.message, pass: false });
} finally {
  if (SIGNED) {
    const gone = await page.evaluate(async (id) => {
      try {
        for (const k of Object.keys(localStorage)) {
          if (!/^planarfit:sites:/.test(k)) continue;
          try { const m = JSON.parse(localStorage.getItem(k) || "{}"); if (m && m[id]) { delete m[id]; localStorage.setItem(k, JSON.stringify(m)); } } catch (_) {}
        }
        await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
        await window.pfSupabase.from("sites").delete().eq("id", id);
        const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
        return { cloud: !(q.data && q.data.length) };
      } catch (e) { return { error: String(e) }; }
    }, SITE_ID).catch((e) => ({ error: String(e) }));
    ok("throwaway plan deleted and verified gone", !!gone.cloud, JSON.stringify(gone));
    await S.close().catch(() => {});
  } else await browser.close();
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
