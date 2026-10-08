/* NEW-1 / V1630096-companion — LIVE acceptance for "Michael chooses which projects sit at the top of the
 * Dashboard's Pursuits card". Signed in as the TEST account on THROWAWAY projects it creates and deletes:
 *   E2E_LOGIN_KEY=… node ui-audit/verify-dashboard-project-order.mjs [https://planyr.io] [<expected commit prefix>] [--webkit-phone]
 * Never opens, edits or reorders a real project; touches only the "ZZ Order …" projects it seeds and puts the
 * account's saved order back exactly as it found it. The order lives in profiles.prefs.dashboardProjectOrder.
 * Known-good arm (clause 6 of DRIVER-SCROLL…): the seeded rows must be present before any verdict is scored. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const phone = args.includes("--webkit-phone");
const pos = args.filter((a) => !a.startsWith("--"));
const base = pos[0] || "https://planyr.io";
const want = pos[1] || "";
const NAMES = ["ZZ Order Alpha", "ZZ Order Bravo", "ZZ Order Charlie"];
const DELTA = "ZZ Order Delta";
const ids = {}; // name -> site id (== group id)
const uid = () => "zzord" + Math.random().toString(36).slice(2, 10);
const recFor = (id, name) => ({ id, groupId: id, site: name, name: "Concept A", origin: { lat: 29.78, lon: -95.82 }, county: "harris", status: "pursuit", role: "pursuit",
  parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], sheetOverlays: [], updatedAt: Date.now() });

let s, failed = false, originalPref;
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) failed = true; };

try {
  s = await openSignedIn(phone ? { base, engine: "webkit", device: "iPhone 15" } : { base });
  const page = s.page;
  console.log("served build:", JSON.stringify(s.build), phone ? "(WebKit, iPhone 15 descriptor)" : "(Chromium desktop)");
  if (want && !JSON.stringify(s.build).includes(want)) throw new Error(`deployed build does not contain ${want} yet`);

  const prefsOf = () => page.evaluate(async () => { const { data: u } = await window.pfSupabase.auth.getUser(); const r = await window.pfSupabase.from("profiles").select("prefs").eq("id", u.user.id).maybeSingle(); return r.data && r.data.prefs ? r.data.prefs : {}; });
  const savedIds = async () => { const p = await prefsOf(); return (p.dashboardProjectOrder && p.dashboardProjectOrder.ids) || null; };
  const seed = async (name) => {
    const id = uid(); ids[name] = id;
    const e = await page.evaluate(async ([i, n, rec]) => (await window.pfSupabase.from("sites").upsert({ id: i, group_id: i, site: n, name: rec.name, county: "harris", updated_at: new Date().toISOString(), data: rec })).error, [id, name, recFor(id, name)]);
    if (e) throw new Error("seed " + name + ": " + (e.message || e));
  };

  originalPref = (await prefsOf()).dashboardProjectOrder ?? null; // put back exactly at the end
  // Start from "never positioned" so step 1 measures the no-saved-order behaviour.
  await page.evaluate(async () => { const { data: u } = await window.pfSupabase.auth.getUser(); const r = await window.pfSupabase.from("profiles").select("prefs").eq("id", u.user.id).maybeSingle(); const p = { ...((r.data && r.data.prefs) || {}) }; delete p.dashboardProjectOrder; await window.pfSupabase.from("profiles").upsert({ id: u.user.id, prefs: p, updated_at: new Date().toISOString() }, { onConflict: "id" }); });
  for (const n of NAMES) { await seed(n); await pacedWait(page, 1100); } // distinct created_at, Alpha oldest

  const open = async () => {
    await page.goto(`${base}/?cb=${Date.now()}#/dashboard`, { waitUntil: "domcontentloaded" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[data-card-key="pursuitsTable"]').first().waitFor({ state: "attached", timeout: 45000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-card-key="pursuitsTable"] [data-project-row]').length > 0, null, { timeout: 45000 });
    await pacedWait(page, 800);
    await assertMeasurable(page, "verify-dashboard-project-order");
  };
  const zzOrder = () => page.evaluate(() => [...document.querySelectorAll('[data-card-key="pursuitsTable"] [data-project-row]')].map((tr) => tr.querySelector("td:nth-child(2) div")?.textContent?.trim()).filter((t) => t && t.startsWith("ZZ Order")));
  const bringIntoView = async (sel) => { await page.evaluate((q) => document.querySelector(q)?.scrollIntoView({ block: "center" }), sel); await pacedWait(page, 300); }; // page-JS scroll, never the driver's
  const rowSel = (n) => `[data-project-row="${ids[n]}"]`;
  const settle = async (ms = 1500) => { await pacedWait(page, ms); };

  await open();
  // known-good arm: the throwaway rows must be on the card, or this run is vacuous
  const first = await zzOrder();
  check(NAMES.every((n) => first.includes(n)), `known-good arm: all three seeded projects are on the Pursuits card (${first.join(" | ")})`);
  check(first.join() === "ZZ Order Charlie,ZZ Order Bravo,ZZ Order Alpha", "1. no order set yet: newest projects land at the top (Charlie, Bravo, Alpha)");

  if (!phone) {
    // 2. drag Alpha (bottom) above Charlie (top) by its grip
    await bringIntoView(rowSel("ZZ Order Alpha"));
    const g = await page.locator(`[data-project-grip="${ids["ZZ Order Alpha"]}"]`).boundingBox();
    const t = await page.locator(rowSel("ZZ Order Charlie")).boundingBox();
    check(!!g && !!t && g.y > 0 && t.y > 0 && g.y < 900 && t.y < 900, "grip and target row are both inside the viewport before the drag (no driver scroll)");
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2, g.y - 10, { steps: 4 });
    await page.mouse.move(g.x + g.width / 2, t.y + 3, { steps: 8 });
    check(await page.evaluate(() => !!document.querySelector('[data-card-key="pursuitsTable"] td[style*="inset"]')), "2a. a drop line shows while dragging");
    await page.mouse.up();
    await settle();
    check((await zzOrder()).join() === "ZZ Order Alpha,ZZ Order Charlie,ZZ Order Bravo", `2b. drag Alpha to the top → Alpha, Charlie, Bravo (got ${(await zzOrder()).join(", ")})`);
    const sv = await savedIds();
    check(!!sv && sv.indexOf(ids["ZZ Order Alpha"]) < sv.indexOf(ids["ZZ Order Charlie"]) && sv.indexOf(ids["ZZ Order Charlie"]) < sv.indexOf(ids["ZZ Order Bravo"]), "2c. the new order is saved to the account (profiles.prefs)");
  }

  // 3. Move to top from the row menu
  await bringIntoView(rowSel("ZZ Order Bravo"));
  await page.locator(`${rowSel("ZZ Order Bravo")} button[aria-haspopup="menu"]`).click();
  await page.getByRole("button", { name: "Move to top" }).filter({ visible: true }).click();
  await settle();
  const afterTop = await zzOrder();
  check(afterTop[0] === "ZZ Order Bravo", `3. Move to top puts Bravo first (got ${afterTop.join(", ")})`);
  const wantOrder = afterTop.join();

  // 4. reload with a cache-busting query → the order held (read from the account, not this tab)
  await open();
  check((await zzOrder()).join() === wantOrder, "4. after a cache-busted reload the order held");
  // 4b. a SECOND, fresh browser = another device: same order
  const s2 = await openSignedIn(phone ? { base, engine: "webkit", device: "iPhone 15" } : { base });
  await s2.page.goto(`${base}/?cb=${Date.now()}#/dashboard`, { waitUntil: "domcontentloaded" });
  await s2.page.waitForFunction(() => document.querySelectorAll('[data-card-key="pursuitsTable"] [data-project-row]').length > 0, null, { timeout: 45000 });
  const other = await s2.page.evaluate(() => [...document.querySelectorAll('[data-card-key="pursuitsTable"] [data-project-row]')].map((tr) => tr.querySelector("td:nth-child(2) div")?.textContent?.trim()).filter((t) => t && t.startsWith("ZZ Order")));
  await s2.close();
  check(other.join() === wantOrder, `4b. a second sign-in on a fresh browser shows the same order (${other.join(", ")})`);

  // 5. rename one and open one: order does not move
  // The app's own rename path: the rename_site_group RPC (a plain write is refused by the DB's name guard).
  const renameErr = await page.evaluate(async ([id]) => {
    const r = await window.pfSupabase.rpc("rename_site_group", { p_group_id: id, p_site: "ZZ Order Charlie RENAMED", p_renamed_at: Date.now() });
    return r.error ? String(r.error.message) : "ok";
  }, [ids["ZZ Order Charlie"]]);
  check(renameErr === "ok", "5.0 the app's own rename RPC accepted the rename (" + renameErr + ")");
  await open();
  const afterRename = await zzOrder();
  check(afterRename.join() === wantOrder.replace("ZZ Order Charlie", "ZZ Order Charlie RENAMED"), `5a. renaming Charlie did not reshuffle (${afterRename.join(", ")})`);
  await bringIntoView(rowSel("ZZ Order Alpha"));
  await page.locator(`${rowSel("ZZ Order Alpha")} td:nth-child(2)`).click();
  await settle(4000);
  await open();
  check((await zzOrder()).join() === afterRename.join(), "5b. opening a project and coming back did not reshuffle");

  // 6. delete one: the list still renders, the rest keep their order
  await page.evaluate(async (id) => { await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id); }, ids["ZZ Order Charlie"]);
  await open();
  const afterDelete = await zzOrder();
  check(afterDelete.length === 2 && afterDelete.join() === afterRename.filter((n) => !/Charlie/.test(n)).join(), `6. deleting Charlie leaves the rest in order (${afterDelete.join(", ")})`);

  // 7. a project made AFTER the order was saved lands on top
  await seed(DELTA);
  await open();
  check((await zzOrder())[0] === DELTA, `7. a brand-new project lands at the top (got ${(await zzOrder()).join(", ")})`);

  // 8. a failed save is loud and keeps the on-screen order
  await page.route("**/rest/v1/profiles*", (route) => (["POST", "PATCH", "PUT"].includes(route.request().method()) ? route.abort("failed") : route.continue()));
  await bringIntoView(rowSel(DELTA));
  await page.locator(`${rowSel(DELTA)} button[aria-haspopup="menu"]`).click();
  await page.getByRole("button", { name: "Move to bottom" }).filter({ visible: true }).click();
  await settle(2500);
  const failedOrder = await zzOrder();
  check(failedOrder[failedOrder.length - 1] === DELTA, "8a. on-screen order moved even though the save is blocked");
  const alertText = await page.locator('[data-card-key="pursuitsTable"] [role="alert"]').innerText().catch(() => "");
  check(/save your project order/i.test(alertText), `8b. the failure is shown on the card ("${alertText.split("\n")[0]}")`);
  await page.unroute("**/rest/v1/profiles*");
  await page.locator('[data-card-key="pursuitsTable"] [role="alert"] button').click();
  await settle(2500);
  check(await page.locator('[data-card-key="pursuitsTable"] [role="alert"]').count() === 0, "8c. Retry clears the warning once the save works");
  const sv2 = await savedIds();
  check(!!sv2 && sv2.indexOf(ids[DELTA]) > sv2.indexOf(ids["ZZ Order Bravo"]), "8d. Retry really saved it to the account");
  await open();
  check((await zzOrder()).join() === failedOrder.join(), "8e. and it survives a reload");
} catch (e) { console.error("ERROR", e.message); failed = true; }
finally {
  if (s) {
    try {
      const left = await s.page.evaluate(async ([idList, orig]) => {
        await window.pfSupabase.auth.getUser();
        for (const id of idList) {
          await window.pfSupabase.from("site_elements").delete().eq("site_id", id);
          await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
          await window.pfSupabase.from("sites").delete().eq("id", id);
        }
        const { data: u } = await window.pfSupabase.auth.getUser();
        const r = await window.pfSupabase.from("profiles").select("prefs").eq("id", u.user.id).maybeSingle();
        const p = { ...((r.data && r.data.prefs) || {}) };
        if (orig === null || orig === undefined) delete p.dashboardProjectOrder; else p.dashboardProjectOrder = orig;
        await window.pfSupabase.from("profiles").upsert({ id: u.user.id, prefs: p, updated_at: new Date().toISOString() }, { onConflict: "id" });
        for (const k of ["planarfit:sites:v1", "planarfit:sites:history:v1"]) { try { const o = JSON.parse(localStorage.getItem(k) || "{}"); idList.forEach((i) => delete o[i]); localStorage.setItem(k, JSON.stringify(o)); } catch (_) {} }
        localStorage.removeItem("planarfit:currentSite:v1");
        const q = await window.pfSupabase.from("sites").select("id").in("id", idList);
        const pr = await window.pfSupabase.from("profiles").select("prefs").eq("id", u.user.id).maybeSingle();
        return { remaining: (q.data || []).length, prefRestored: JSON.stringify((pr.data && pr.data.prefs && pr.data.prefs.dashboardProjectOrder) ?? null) === JSON.stringify(orig ?? null) };
      }, [Object.values(ids), originalPref ?? null]);
      console.log("cleanup:", JSON.stringify(left));
      if (left.remaining !== 0 || !left.prefRestored) failed = true;
    } catch (e) { console.error("cleanup ERROR", e.message); failed = true; }
    await s.close();
  }
}
process.exit(failed ? 1 : 0);
