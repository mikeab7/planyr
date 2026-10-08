/* NEW-1 / B2211120 / V1630224-companion — LIVE acceptance for "the Task Report's project groups follow Michael's project
 * order, with reorder controls on the group headers". Signed in as the TEST account, on THROWAWAY projects + schedules it
 * creates and removes:
 *   E2E_LOGIN_KEY=… node ui-audit/verify-task-report-project-order-live.mjs [https://planyr.io] [<expected commit prefix>] [--webkit-phone]
 * Never opens, edits or reorders a real project; touches only the "ZZ TaskRpt …" projects it seeds and puts the account's saved
 * order back exactly as it found it. The order lives in profiles.prefs.dashboardProjectOrder (shared with the Dashboard).
 * Known-good arm (clause 6 of DRIVER-SCROLL…): the three seeded groups must be on the report before any verdict is scored,
 * and the Dashboard must show the same three — otherwise the run is VACUOUS and says so. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const phone = args.includes("--webkit-phone");
const pos = args.filter((a) => !a.startsWith("--"));
const base = pos[0] || "https://planyr.io";
const want = pos[1] || "";
const NAMES = ["ZZ TaskRpt Alpha", "ZZ TaskRpt Bravo", "ZZ TaskRpt Charlie"];
const ids = {};      // name -> site id (== group id)
const schedIds = {}; // name -> schedule row id
const uid = () => "zztr" + Math.random().toString(36).slice(2, 10);
const recFor = (id, name) => ({ id, groupId: id, site: name, name: "Concept A", origin: { lat: 29.78, lon: -95.82 }, county: "harris", status: "pursuit", role: "pursuit",
  parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], sheetOverlays: [], updatedAt: Date.now() });

let s, failed = false, originalPref, origIndex;
// The app reloads itself (`_r=`) when a newer build deploys mid-run; a navigation interrupted by that is retried, not failed.
const gotoSafe = async (page, url) => {
  for (let n = 0; n < 4; n++) {
    try { await page.goto(url, { waitUntil: "domcontentloaded" }); await page.reload({ waitUntil: "domcontentloaded" }); return; }
    catch (e) { if (!/interrupted by another navigation|Navigation.*(failed|aborted)/i.test(String(e.message)) || n === 3) throw e; await page.waitForTimeout(3000); }
  }
};
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) failed = true; };

try {
  s = await openSignedIn(phone ? { base, engine: "webkit", device: "iPhone 15" } : { base });
  const page = s.page;
  console.log("served build:", JSON.stringify(s.build), phone ? "(WebKit, iPhone 15 descriptor)" : "(Chromium desktop)");
  if (want && !JSON.stringify(s.build).includes(want)) throw new Error(`deployed build does not contain ${want} yet`);

  const prefsOf = () => page.evaluate(async () => { const { data: u } = await window.pfSupabase.auth.getUser(); const r = await window.pfSupabase.from("profiles").select("prefs").eq("id", u.user.id).maybeSingle(); return r.data && r.data.prefs ? r.data.prefs : {}; });
  const savedIds = async () => { const p = await prefsOf(); return (p.dashboardProjectOrder && p.dashboardProjectOrder.ids) || null; };
  // The test account has NO stored schedule document and is not rows-authoritative (measured), so its Task Report shows
  // the built-in demo data. The page has a local test override that reads schedule ROWS instead (localStorage
  // `planar:scheduleRowsRead`), which needs the account's own (empty, non-authoritative) schedule_account_index row — the
  // account may insert it but not delete it, so that one empty row stays (harmless: not authoritative = unchanged behaviour).
  const seed = async (name) => {
    const id = uid(); ids[name] = id;
    const r = await page.evaluate(async ([i, n, rec]) => {
      const sb = window.pfSupabase; const { data: u } = await sb.auth.getUser();
      const e1 = (await sb.from("sites").upsert({ id: i, user_id: u.user.id, group_id: i, site: n, name: rec.name, county: "harris", updated_at: new Date().toISOString(), data: rec })).error;
      if (e1) return { error: "site: " + e1.message };
      const task = { id: 1, name: n + " task", start: "2026-12-27", end: "2026-12-28", duration: 2, predecessors: [], health: "red", percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true };
      const base = { name: "Master Schedule", ownerKind: "site", linkedSiteId: i, linkedSiteName: n, tasks: [task] };
      const want = 910000 + Math.floor(Math.random() * 80000); // an id of its own, so data.id can be set at insert time
      let sc = await sb.from("schedules").insert({ id: want, user_id: u.user.id, linked_site_id: i, linked_site_name: n, name: "Master Schedule", data: { ...base, id: want } }).select("id").single();
      if (sc.error) { // identity column refuses explicit ids: insert, then patch data.id and VERIFY it took
        sc = await sb.from("schedules").insert({ user_id: u.user.id, linked_site_id: i, linked_site_name: n, name: "Master Schedule", data: base }).select("id").single();
        if (sc.error) return { error: "schedule: " + sc.error.message };
        const up = await sb.from("schedules").update({ data: { ...base, id: sc.data.id } }).eq("id", sc.data.id).select("data");
        if (up.error || !up.data || !up.data.length || up.data[0].data.id !== sc.data.id) return { error: "patch data.id refused: " + (up.error ? up.error.message : "0 rows updated") };
      }
      return { sid: sc.data.id };
    }, [id, name, recFor(id, name)]);
    if (r.error) throw new Error("seed " + name + ": " + r.error);
    schedIds[name] = r.sid;
  };

  // The account-wide index row a rows account carries (view settings + flags live there). Original kept; reset at cleanup.
  const seedIndex = async () => {
    const r = await page.evaluate(async ([sids]) => {
      const sb = window.pfSupabase; const { data: u } = await sb.auth.getUser();
      const cur = await sb.from("schedule_account_index").select("*").eq("user_id", u.user.id).maybeSingle();
      const first = Math.min(...sids), next = Math.max(...sids) + 1;
      const row = {
        user_id: u.user.id, n_pid: next, n_tid: Object.fromEntries(sids.map((i) => [i, 2])), last_active_by_site: {},
        settings: { defaultSplit: 60, snapDefault: true, holidays: {}, customHealth: [], healthLabelOverrides: {} },
        migration_flags: { aPid: first, view: "grid", section: "projects", editProjId: null, healthColStyle: "stoplight", masterHealthFilter: true },
        rev: (cur.data ? cur.data.rev : 0) + 1,
      };
      const w = cur.data ? await sb.from("schedule_account_index").update(row).eq("user_id", u.user.id) : await sb.from("schedule_account_index").insert(row);
      return w.error ? { error: w.error.message } : { orig: cur.data || null };
    }, [Object.values(schedIds)]);
    if (r.error) throw new Error("index row: " + r.error);
    origIndex = r.orig;
  };

  originalPref = (await prefsOf()).dashboardProjectOrder ?? null; // put back exactly at the end
  await page.evaluate(async () => { const { data: u } = await window.pfSupabase.auth.getUser(); const r = await window.pfSupabase.from("profiles").select("prefs").eq("id", u.user.id).maybeSingle(); const p = { ...((r.data && r.data.prefs) || {}) }; delete p.dashboardProjectOrder; await window.pfSupabase.from("profiles").upsert({ id: u.user.id, prefs: p, updated_at: new Date().toISOString() }, { onConflict: "id" }); });
  for (const n of NAMES) { await seed(n); await pacedWait(page, 1100); } // distinct created_at, Alpha oldest
  await seedIndex();

  await page.evaluate(() => localStorage.setItem("planar:scheduleRowsRead", "1")); // the page's own local override: read schedule ROWS
  const frameOf = async () => (await (await page.waitForSelector("iframe", { timeout: 45000 })).contentFrame());
  const openReport = async () => {
    await gotoSafe(page, `${base}/?cb=${Date.now()}#/schedule`);
    const frame = await frameOf();
    await frame.waitForFunction(() => !!document.body && /TASK|Group by/i.test(document.body.innerText), null, { timeout: 60000 });
    // reach the Task Report the way the shell's Dashboard/Reports press does
    await page.evaluate(() => { const f = document.querySelector("iframe"); f.contentWindow.postMessage({ source: "planar-shell", type: "planar:nav-dashboard" }, location.origin); });
    await frame.waitForFunction(() => /TASK REPORT/.test(document.body.innerText), null, { timeout: 30000 }).catch(async (e) => {
      console.log("report page text:", JSON.stringify((await frame.evaluate(() => document.body.innerText)).slice(0, 500)));
      throw e;
    });
    // show every status so the seeded tasks are listed whatever the filter pill defaulted to, and group by project
    await frame.evaluate(() => {
      const pill = [...document.querySelectorAll("button")].find((b) => /In Progress/.test(b.textContent)); void pill;
      const m = [...document.querySelectorAll("span")].find((x) => x.textContent.trim() === "Group by");
      const seg = m && [...m.parentElement.querySelectorAll("span")].find((x) => x.textContent.trim() === "Project");
      if (seg) seg.click();
    });
    await frame.waitForSelector("tr[data-grp-site]", { timeout: 30000 }).catch(async (e) => {
      console.log("no group headers; report page text:", JSON.stringify((await frame.evaluate(() => document.body.innerText)).slice(0, 400)), "| groupBy buttons:", JSON.stringify(await frame.evaluate(() => [...document.querySelectorAll("span")].filter((x) => ["None", "Project"].includes(x.textContent.trim())).map((x) => x.textContent.trim() + ":" + getComputedStyle(x).backgroundColor))));
      throw e;
    });
    await pacedWait(page, 1500);
    await assertMeasurable(page, "verify-task-report-project-order-live");
    return frame;
  };
  const zz = (frame) => frame.evaluate(() => [...document.querySelectorAll("tr[data-grp-site]")].map((tr) => tr.textContent.replace(/[⠿⋯]/g, "").trim()).filter((t) => t.startsWith("ZZ TaskRpt")).map((t) => t.replace(/ \/ .*/, "")));
  const pick = async (frame, name, label) => {
    const sel = `tr[data-grp-site="${ids[name]}"] [data-grp-menu-btn]`;
    await frame.evaluate((q) => document.querySelector(q)?.scrollIntoView({ block: "center" }), sel); // page-JS scroll, never the driver's
    await pacedWait(page, 300);
    await frame.click(sel); await pacedWait(page, 200);
    await frame.click(`[role="menuitem"]:has-text("${label}")`); await pacedWait(page, 2000);
  };

  let frame = await openReport();
  console.log("all group headers:", JSON.stringify(await frame.evaluate(() => [...document.querySelectorAll("tr[data-grp-site]")].map((t) => t.textContent.replace(/[⠿⋯]/g, "").trim()))), "rows:", JSON.stringify(await page.evaluate(async () => (await window.pfSupabase.from("schedules").select("id,linked_site_name,deleted_at").is("deleted_at", null)).data)));
  const first = await zz(frame);
  check(NAMES.every((n) => first.includes(n)), `known-good arm: all three seeded projects are group headers on the Task Report (${first.join(" | ")})`);
  check(first.join() === "ZZ TaskRpt Charlie,ZZ TaskRpt Bravo,ZZ TaskRpt Alpha", "1. no order saved yet: new projects land on top, newest first (Charlie, Bravo, Alpha)");
  check(await frame.evaluate((i) => !!document.querySelector(`[data-grp-grip="${i}"]`) && !!document.querySelector(`tr[data-grp-site="${i}"] [data-grp-menu-btn]`), ids["ZZ TaskRpt Alpha"]), "2. each project group header has a grip and a ⋯ menu");

  // 3. Move to top from the header menu
  await pick(frame, "ZZ TaskRpt Alpha", "Move to top");
  check((await zz(frame))[0] === "ZZ TaskRpt Alpha", `3. ⋯ → Move to top puts Alpha first (got ${(await zz(frame)).join(", ")})`);
  const sv = await savedIds();
  check(!!sv && sv[0] === ids["ZZ TaskRpt Alpha"], "3b. the order was saved to the account (profiles.prefs)");

  // 4. grip drag (desktop only: WebKit has no touch-drag primitive)
  if (!phone) {
    const g = await frame.evaluate((i) => { document.querySelector(`[data-grp-grip="${i}"]`).scrollIntoView({ block: "center" }); const r = document.querySelector(`[data-grp-grip="${i}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, ids["ZZ TaskRpt Charlie"]);
    const t = await frame.evaluate((i) => { const r = document.querySelector(`tr[data-grp-site="${i}"]`).getBoundingClientRect(); return { y: r.y + 3 }; }, ids["ZZ TaskRpt Alpha"]);
    const fb = await page.locator("iframe").first().boundingBox();
    await page.mouse.move(fb.x + g.x, fb.y + g.y); await page.mouse.down();
    await page.mouse.move(fb.x + g.x, fb.y + g.y - 8, { steps: 3 });
    await page.mouse.move(fb.x + g.x, fb.y + t.y, { steps: 8 });
    await pacedWait(page, 250);
    check(await frame.evaluate(() => !!document.querySelector("td[colspan][style*='inset']")), "4a. a drop line shows while dragging");
    await page.mouse.up(); await pacedWait(page, 2000);
    check((await zz(frame))[0] === "ZZ TaskRpt Charlie", `4b. dragging Charlie's grip above Alpha puts Charlie first (got ${(await zz(frame)).join(", ")})`);
  }
  const want1 = (await zz(frame)).join();

  // 5. the Dashboard's Pursuits card shows the SAME order (one store)
  await gotoSafe(page, `${base}/?cb=${Date.now()}#/dashboard`);
  await page.waitForFunction(() => document.querySelectorAll('[data-card-key="pursuitsTable"] [data-project-row]').length > 0, null, { timeout: 45000 });
  await pacedWait(page, 800);
  const dash = () => page.evaluate(() => [...document.querySelectorAll('[data-card-key="pursuitsTable"] [data-project-row]')].map((tr) => tr.querySelector("td:nth-child(2) div")?.textContent?.trim()).filter((t) => t && t.startsWith("ZZ TaskRpt")));
  check((await dash()).join() === want1, `5. the Dashboard Pursuits card shows the same order as the Task Report (${(await dash()).join(", ")})`);

  // 6. reorder on the Dashboard → the Task Report follows
  await page.evaluate((i) => document.querySelector(`[data-project-row="${i}"]`)?.scrollIntoView({ block: "center" }), ids["ZZ TaskRpt Bravo"]);
  await pacedWait(page, 300);
  await page.locator(`[data-project-row="${ids["ZZ TaskRpt Bravo"]}"] button[aria-haspopup="menu"]`).click();
  await page.getByRole("button", { name: "Move to top" }).filter({ visible: true }).click();
  await pacedWait(page, 2000);
  frame = await openReport(); // cache-busted reload
  check((await zz(frame))[0] === "ZZ TaskRpt Bravo", `6. Move to top on the Dashboard → the Task Report follows after a cache-busted reload (${(await zz(frame)).join(", ")})`);

  // 7. sorting a column never moves a group
  const before = (await zz(frame)).join();
  for (let i = 0; i < 2; i++) { await frame.evaluate(() => { const th = [...document.querySelectorAll("thead th")].find((t) => /^TASK/i.test(t.textContent.trim())); if (th) th.click(); }); await pacedWait(page, 300); }
  check((await zz(frame)).join() === before, "7. a column sort leaves the group order alone");

  // 8. a blocked save is loud and keeps the new order on screen; Retry saves it
  await page.route("**/rest/v1/profiles*", (route) => (["POST", "PATCH", "PUT"].includes(route.request().method()) ? route.abort("failed") : route.continue()));
  await pick(frame, "ZZ TaskRpt Bravo", "Move to bottom");
  const failedOrder = await zz(frame);
  check(failedOrder[failedOrder.length - 1] === "ZZ TaskRpt Bravo", "8a. on-screen order moved even though the save is blocked");
  check(await frame.evaluate(() => /Couldn't save your project order/.test(document.body.innerText)), "8b. the failure is shown on the report");
  await page.unroute("**/rest/v1/profiles*");
  await frame.click('button:has-text("Retry")'); await pacedWait(page, 2500);
  check(await frame.evaluate(() => !/Couldn't save your project order/.test(document.body.innerText)), "8c. Retry clears the warning once the save works");
  const sv2 = await savedIds();
  check(!!sv2 && sv2.indexOf(ids["ZZ TaskRpt Bravo"]) > sv2.indexOf(ids["ZZ TaskRpt Alpha"]), "8d. Retry really saved it to the account");
  frame = await openReport();
  check((await zz(frame)).join() === failedOrder.join(), "8e. and it survives a cache-busted reload");
} catch (e) { console.error("ERROR", e.message); failed = true; }
finally {
  if (s) {
    try {
      await s.page.waitForLoadState("domcontentloaded").catch(() => {}); await s.page.waitForFunction(() => !!window.pfSupabase, null, { timeout: 30000 }).catch(() => {});
      const left = await s.page.evaluate(async ([idList, schedList, orig, origIdx]) => {
        const sb = window.pfSupabase; await sb.auth.getUser();
        try { localStorage.removeItem("planar:scheduleRowsRead"); } catch (_) {}
        { // reset the index row to what it was (it cannot be deleted by this account: empty defaults when it did not exist)
          const { data: uu } = await sb.auth.getUser();
          const back = origIdx ? { n_pid: origIdx.n_pid, n_tid: origIdx.n_tid, last_active_by_site: origIdx.last_active_by_site, settings: origIdx.settings, migration_flags: origIdx.migration_flags }
            : { n_pid: 1, n_tid: {}, last_active_by_site: {}, settings: {}, migration_flags: {} };
          await sb.from("schedule_account_index").update({ ...back, rev: 1000 + Date.now() % 100000 }).eq("user_id", uu.user.id);
        }
        for (const sid of schedList) await sb.from("schedules").update({ deleted_at: new Date().toISOString() }).eq("id", sid);
        for (const id of idList) {
          await sb.from("schedules").update({ deleted_at: new Date().toISOString() }).eq("linked_site_id", id);
          await sb.from("site_elements").delete().eq("site_id", id);
          await sb.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
          await sb.from("sites").delete().eq("id", id);
        }
        const { data: u } = await sb.auth.getUser();
        const r = await sb.from("profiles").select("prefs").eq("id", u.user.id).maybeSingle();
        const p = { ...((r.data && r.data.prefs) || {}) };
        if (orig === null || orig === undefined) delete p.dashboardProjectOrder; else p.dashboardProjectOrder = orig;
        await sb.from("profiles").upsert({ id: u.user.id, prefs: p, updated_at: new Date().toISOString() }, { onConflict: "id" });
        for (const k of ["planarfit:sites:v1", "planarfit:sites:history:v1"]) { try { const o = JSON.parse(localStorage.getItem(k) || "{}"); idList.forEach((i) => delete o[i]); localStorage.setItem(k, JSON.stringify(o)); } catch (_) {} }
        localStorage.removeItem("planarfit:currentSite:v1");
        const q = await sb.from("sites").select("id").in("id", idList);
        const live = await sb.from("schedules").select("id").in("linked_site_id", idList).is("deleted_at", null);
        const pr = await sb.from("profiles").select("prefs").eq("id", u.user.id).maybeSingle();
        return { sitesRemaining: (q.data || []).length, liveSchedulesRemaining: (live.data || []).length, prefRestored: JSON.stringify((pr.data && pr.data.prefs && pr.data.prefs.dashboardProjectOrder) ?? null) === JSON.stringify(orig ?? null) };
      }, [Object.values(ids), Object.values(schedIds), originalPref ?? null, origIndex ?? null]);
      console.log("cleanup:", JSON.stringify(left));
      if (left.sitesRemaining !== 0 || left.liveSchedulesRemaining !== 0 || !left.prefRestored) failed = true;
    } catch (e) { console.error("cleanup ERROR", e.message); failed = true; }
    await s.close();
  }
}
process.exit(failed ? 1 : 0);
