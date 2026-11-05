/* NEW-1 — LIVE acceptance for the Task Report's standard Filter dropdown (Status + Project checkboxes with counts, beside Group by / Show / Columns).
 * Signed in as the TEST account on THROWAWAY projects + schedules it creates and removes:
 *   E2E_LOGIN_KEY=… node ui-audit/verify-task-report-status-filter-live.mjs [https://planyr.io] [<expected commit prefix>] [--webkit-phone]
 * Never opens or edits a real project; touches only the "ZZ StatusFilter …" projects it seeds and removes them (and puts the
 * account's schedule index row back) at the end. Independent ground truth: with the control on "All" it reads the status pill every
 * seeded task shows, then asserts every combination against those pills. Known-good arm: the three seeded groups and all 8
 * seeded tasks must be on the report under "All" before anything is scored — otherwise the run is VACUOUS and says so.
 * The build served is read in the same call as the assertions and printed. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const phone = args.includes("--webkit-phone");
const pos = args.filter((a) => !a.startsWith("--"));
const base = pos[0] || "https://planyr.io";
const want = pos[1] || "";
const PROJECTS = [
  ["ZZ StatusFilter Alpha", ["red", "yellow", "gray", "green"]],
  ["ZZ StatusFilter Bravo", ["yellow", "yellow"]],
  ["ZZ StatusFilter Charlie", ["green", "gray"]],   // no In Progress / Needs Attention task: must vanish under any single-status pick
];
const ids = {}, schedIds = {};
const uid = () => "zzsf" + Math.random().toString(36).slice(2, 10);
const recFor = (id, name) => ({ id, groupId: id, site: name, name: "Concept A", origin: { lat: 29.78, lon: -95.82 }, county: "harris", status: "pursuit", role: "pursuit",
  parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], sheetOverlays: [], updatedAt: Date.now() });

let s, failed = false, origIndex;
const gotoSafe = async (page, url) => {
  for (let n = 0; n < 4; n++) {
    try { await page.goto(url, { waitUntil: "domcontentloaded" }); await page.reload({ waitUntil: "domcontentloaded" }); return; }
    catch (e) { if (!/interrupted by another navigation|Navigation.*(failed|aborted)/i.test(String(e.message)) || n === 3) throw e; await page.waitForTimeout(3000); }
  }
};
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) failed = true; return ok; };
const sameSet = (a, b) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

try {
  s = await openSignedIn(phone ? { base, engine: "webkit", device: "iPhone 15" } : { base });
  const page = s.page;
  console.log("served build:", JSON.stringify(s.build), phone ? "(WebKit, iPhone 15 descriptor — emulated device)" : "(Chromium desktop)");
  if (want && !JSON.stringify(s.build).includes(want)) throw new Error(`deployed build does not contain ${want} yet`);

  const seed = async (name, healths) => {
    const id = uid(); ids[name] = id;
    const r = await page.evaluate(async ([i, n, hs, rec]) => {
      const sb = window.pfSupabase; const { data: u } = await sb.auth.getUser();
      const e1 = (await sb.from("sites").upsert({ id: i, user_id: u.user.id, group_id: i, site: n, name: rec.name, county: "harris", updated_at: new Date().toISOString(), data: rec })).error;
      if (e1) return { error: "site: " + e1.message };
      const tasks = hs.map((h, k) => ({ id: k + 1, name: `${n} #${k + 1} ${h}`, start: "2026-12-27", end: "2026-12-28", duration: 2, predecessors: [], health: h, percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true }));
      const base = { name: "Master Schedule", ownerKind: "site", linkedSiteId: i, linkedSiteName: n, tasks };
      const want = 910000 + Math.floor(Math.random() * 80000);
      let sc = await sb.from("schedules").insert({ id: want, user_id: u.user.id, linked_site_id: i, linked_site_name: n, name: "Master Schedule", data: { ...base, id: want } }).select("id").single();
      if (sc.error) {
        sc = await sb.from("schedules").insert({ user_id: u.user.id, linked_site_id: i, linked_site_name: n, name: "Master Schedule", data: base }).select("id").single();
        if (sc.error) return { error: "schedule: " + sc.error.message };
        const up = await sb.from("schedules").update({ data: { ...base, id: sc.data.id } }).eq("id", sc.data.id).select("data");
        if (up.error || !up.data || !up.data.length || up.data[0].data.id !== sc.data.id) return { error: "patch data.id refused: " + (up.error ? up.error.message : "0 rows updated") };
      }
      return { sid: sc.data.id };
    }, [id, name, healths, recFor(id, name)]);
    if (r.error) throw new Error("seed " + name + ": " + r.error);
    schedIds[name] = r.sid;
  };
  const seedIndex = async () => {
    const r = await page.evaluate(async ([sids]) => {
      const sb = window.pfSupabase; const { data: u } = await sb.auth.getUser();
      const cur = await sb.from("schedule_account_index").select("*").eq("user_id", u.user.id).maybeSingle();
      const first = Math.min(...sids), next = Math.max(...sids) + 1;
      const row = {
        user_id: u.user.id, n_pid: next, n_tid: Object.fromEntries(sids.map((i) => [i, 10])), last_active_by_site: {},
        settings: { defaultSplit: 60, snapDefault: true, holidays: {}, customHealth: [], healthLabelOverrides: {} },
        migration_flags: { aPid: first, view: "grid", section: "projects", editProjId: null, healthColStyle: "stoplight", masterHealthFilter: true },   // legacy `true` — today's default
        rev: (cur.data ? cur.data.rev : 0) + 1,
      };
      const w = cur.data ? await sb.from("schedule_account_index").update(row).eq("user_id", u.user.id) : await sb.from("schedule_account_index").insert(row);
      return w.error ? { error: w.error.message } : { orig: cur.data || null };
    }, [Object.values(schedIds)]);
    if (r.error) throw new Error("index row: " + r.error);
    origIndex = r.orig;
  };

  for (const [n, hs] of PROJECTS) { await seed(n, hs); await pacedWait(page, 1100); }
  await seedIndex();
  await page.evaluate(() => localStorage.setItem("planar:scheduleRowsRead", "1"));   // the page's own local override: read schedule ROWS

  const frameOf = async () => (await (await page.waitForSelector("iframe", { timeout: 45000 })).contentFrame());
  const openReport = async () => {
    await gotoSafe(page, `${base}/?cb=${Date.now()}#/schedule`);
    const frame = await frameOf();
    await frame.waitForFunction(() => !!document.body && /TASK|Group by/i.test(document.body.innerText), null, { timeout: 60000, polling: 250 }).catch(async (e) => {
      console.log("report page text after open:", JSON.stringify((await frame.evaluate(() => document.body.innerText)).slice(0, 600)), "| url:", page.url());
      throw e;
    });
    await page.evaluate(() => { const f = document.querySelector("iframe"); f.contentWindow.postMessage({ source: "planar-shell", type: "planar:nav-dashboard" }, location.origin); });
    await frame.waitForFunction(() => /TASK REPORT/.test(document.body.innerText), null, { timeout: 30000, polling: 250 }).catch(async (e) => {
      console.log("no TASK REPORT; page text:", JSON.stringify((await frame.evaluate(() => document.body.innerText)).slice(0, 600)));
      throw e;
    });
    await frame.locator('[data-tr-btn="group"]').click(); await frame.locator('[data-group-opt="project"]').click();   // Group by is a dropdown now
    await frame.waitForSelector("tr[data-grp-site]", { timeout: 30000 });
    await pacedWait(page, 1500);
    await assertMeasurable(page, "verify-task-report-status-filter-live");
    return frame;
  };
  const snap = (frame) => frame.evaluate(() => {
    const ths = [...document.querySelectorAll("thead th")].map((t) => t.textContent.trim());
    const ti = ths.findIndex((t) => t.startsWith("Task")), si = ths.findIndex((t) => t.startsWith("Status"));
    const hs = [...document.querySelectorAll("span")].find((x) => x.textContent.trim() === "TASK REPORT");
    const headerPill = hs ? Number(hs.nextElementSibling.textContent) : NaN;
    const groups = [], rows = []; let cur = null;
    [...document.querySelectorAll("tbody tr")].forEach((tr) => {
      const tds = tr.querySelectorAll("td");
      if (tr.hasAttribute("data-grp-site")) { const num = [...tds[0].querySelectorAll("span")].map((p) => p.textContent.trim()).filter((t) => /^\d+$/.test(t)); cur = { label: tds[0].textContent.replace(/[⠿⋯]/g, "").trim(), pill: Number(num[num.length - 1]), rows: 0 }; groups.push(cur); return; }
      if (tds.length < 4) return;
      rows.push({ name: tds[ti].textContent.trim(), status: tds[si].textContent.trim(), grp: cur ? cur.label : "" }); if (cur) cur.rows++;
    });
    const badge = document.querySelector("[data-filter-badge]");
    const fb = document.querySelector('[data-tr-btn="filter"]');
    const st = {}, pr = {};
    document.querySelectorAll("[data-filter-status]").forEach((i) => { st[i.dataset.filterStatus] = { on: i.checked, n: Number(i.closest("label").querySelector("[data-filter-count]").textContent) }; });
    document.querySelectorAll("[data-filter-project]").forEach((i) => { pr[i.dataset.filterProject] = { on: i.checked, n: Number(i.closest("label").querySelector("[data-filter-count]").textContent), label: i.closest("label").textContent }; });
    return { headerPill, groups, rows, badge: badge ? badge.textContent.trim() : null, on: !!fb && fb.getAttribute("data-active") === "1", st, pr,
      groupBtn: (document.querySelector('[data-tr-btn="group"]') || {}).textContent || null, empty: document.querySelector("[data-filter-empty]") ? document.querySelector("[data-filter-empty]").textContent : null,
      oldControl: !!document.querySelector("[data-status-seg]") };
  });
  const tap = async (frame, sel) => { const loc = frame.locator(sel); await loc.evaluate((el) => el.scrollIntoView({ block: "center" })); if (phone) await loc.tap(); else await loc.click(); await pacedWait(page, 350); };
  const openF = async (frame) => { if (!(await frame.locator('[data-tr-panel="filter"]').count())) await tap(frame, '[data-tr-btn="filter"]'); };
  const clearAll = async (frame) => { await openF(frame); await tap(frame, "[data-filter-clear]"); };

  let frame = await openReport();
  await openF(frame);
  const first = await snap(frame);
  if (!check(!first.oldControl && Object.keys(first.st).length >= 5 && !!first.groupBtn, `the Filter dropdown is on the page, the old Status segments are gone (statuses: ${Object.keys(first.st).join(", ") || "none"}; ${first.groupBtn && first.groupBtn.replace(/\s+/g, " ")})`)) throw new Error("no Filter control on this build — VOID");
  check(first.st.yellow.on && first.st.red.on && !first.st.gray.on && !first.st.green.on && !first.st.paused.on && first.badge === "1" && first.on, `a saved legacy "both" opens as In Progress + Needs Attention checked, badge 1 (${JSON.stringify(Object.fromEntries(Object.entries(first.st).map(([k, v]) => [k, v.on])))})`);
  await clearAll(frame);
  const all = await snap(frame);
  const zzRows = (sn) => sn.rows.filter((r) => r.name.startsWith("ZZ StatusFilter"));
  const truth = Object.fromEntries(zzRows(all).map((r) => [r.name, { status: r.status, proj: (r.grp.match(/ZZ StatusFilter (\w+)/) || [])[1] }]));
  const SEEDED = PROJECTS.flatMap(([n, hs]) => hs.map((h, k) => `${n} #${k + 1} ${h}`));
  if (!check(sameSet(Object.keys(truth), SEEDED) && all.badge === null && !all.on, `known-good arm: Clear all lists all ${SEEDED.length} seeded tasks (${Object.keys(truth).length} read) and the badge is gone`)) throw new Error("VACUOUS run — seeded tasks not all on the report");
  const PILL = { gray: "Not Started", yellow: "In Progress", red: "Needs Attn.", green: "Complete", paused: "Paused" };
  const keyOf = (n) => Object.keys(PILL).find((k) => PILL[k] === truth[n].status);
  const projKey = {}; Object.entries(all.pr).forEach(([id, v]) => { const m = v.label.match(/ZZ StatusFilter (\w+)/); if (m) projKey[m[1]] = id; });
  check(Object.keys(projKey).length === 3, `the three ZZ projects are in the Project list (${Object.keys(projKey).join(", ")})`);
  let sS = new Set(), pS = new Set();
  const verify = async (label) => {
    await openF(frame);
    const sn = await snap(frame);
    const want = SEEDED.filter((n) => (sS.size === 0 || sS.has(keyOf(n))) && (pS.size === 0 || pS.has(truth[n].proj)));
    check(sameSet(zzRows(sn).map((r) => r.name), want), `${label}: seeded rows = exactly the matching tasks (${want.length})`);
    check(sn.headerPill === sn.rows.length && sn.groups.every((g) => g.pill === g.rows && g.rows > 0) && sn.groups.reduce((n, g) => n + g.pill, 0) === sn.rows.length, `${label}: header pill ${sn.headerPill} = rows ${sn.rows.length}; each group pill = its rows; no empty group header`);
    const wantBadge = (sS.size ? 1 : 0) + (pS.size ? 1 : 0);
    check((sn.badge === null ? 0 : Number(sn.badge)) === wantBadge && sn.on === (wantBadge > 0), `${label}: badge ${wantBadge || "absent"}`);
    const stOk = ["gray", "yellow", "red", "green", "paused"].every((k) => sn.st[k].on === sS.has(k));
    const cStatus = Object.keys(PILL).every((k) => sn.st[k].n >= SEEDED.filter((n) => keyOf(n) === k && (pS.size === 0 || pS.has(truth[n].proj))).length);   // the account may hold other schedules; ZZ rows are a lower bound
    const cProj = Object.entries(projKey).every(([nm, id]) => sn.pr[id].on === pS.has(nm) && sn.pr[id].n === SEEDED.filter((n) => truth[n].proj === nm && (sS.size === 0 || sS.has(keyOf(n)))).length);
    check(stOk && cStatus && cProj, `${label}: ticked boxes = the selection; the ZZ project counts equal the rows they would show`);
    return sn;
  };
  const tS = async (k) => { await openF(frame); await tap(frame, `[data-filter-status="${k}"]`); sS.has(k) ? sS.delete(k) : sS.add(k); };
  const tP = async (nm) => { await openF(frame); await tap(frame, `[data-filter-project="${projKey[nm]}"]`); pS.has(nm) ? pS.delete(nm) : pS.add(nm); };

  await verify("nothing checked");
  for (const k of ["gray", "yellow", "red", "green", "paused"]) { await tS(k); await verify(`status alone: ${PILL[k]}`); await tS(k); }
  await tS("yellow"); await tS("red"); await verify("several statuses: In Progress + Needs Attention");
  await tS("green"); await verify("three statuses");
  await clearAll(frame); sS = new Set(); await verify("Clear all");
  for (const nm of ["Alpha", "Bravo", "Charlie"]) { await tP(nm); await verify(`project alone: ${nm}`); await tP(nm); }
  await tS("yellow"); await tS("red"); await tP("Bravo"); const sp = await verify("Status (In Progress + Needs Attention) + Project (Bravo)");
  check(sp.badge === "2", "Status + Project: badge is 2");
  await tP("Bravo"); await tS("yellow"); const na = await verify("only Needs Attention");
  check(!na.groups.some((g) => /Bravo|Charlie/.test(g.label)), "a group with no matching task disappears (Bravo has only In Progress, Charlie only Complete/Not Started)");
  await tS("yellow"); await tP("Charlie"); const none = await verify("Needs Attention + In Progress in Charlie (matches nothing)");
  check(!!none.empty && /No tasks match the filter/.test(none.empty) && /Charlie/.test(none.empty), `nothing matches → the empty state names the filter (${none.empty})`);
  await frame.locator("[data-filter-empty-clear]").evaluate((el) => el.click()); await pacedWait(page, 350);
  const afterClear = await snap(frame);
  check(afterClear.badge === null && zzRows(afterClear).length === SEEDED.length, `"Clear filter" in the empty state brings every task back (${zzRows(afterClear).length})`);
  sS = new Set(); pS = new Set();

  // Group by None / Project with filters on
  await tS("red"); await tP("Alpha");
  await tap(frame, '[data-tr-btn="group"]'); await tap(frame, '[data-group-opt="none"]');
  let g = await snap(frame);
  check(g.groups.length === 0 && /Group by:\s*None/.test(g.groupBtn) && sameSet(zzRows(g).map((r) => r.name), SEEDED.filter((n) => keyOf(n) === "red" && truth[n].proj === "Alpha")), `Group by: None with Status + Project on → a flat list of the matching rows (${g.groupBtn.replace(/\s+/g, " ")})`);
  await tap(frame, '[data-tr-btn="group"]'); await tap(frame, '[data-group-opt="project"]');
  g = await snap(frame);
  check(g.groups.filter((x) => /ZZ StatusFilter/.test(x.label)).length === 1 && g.groups.every((x) => x.pill === x.rows), "Group by: Project with the same filters → one ZZ group, pill = rows");

  // dropdown mechanics: one closes another; Esc; outside press
  await openF(frame);
  await tap(frame, '[data-tr-btn="show"]');
  check(!(await frame.locator('[data-tr-panel="filter"]').count()) && (await frame.locator('[data-tr-panel="show"]').count()) === 1, "opening Show closes Filter, in one click");
  await tap(frame, '[data-tr-btn="columns"]');
  check(!(await frame.locator('[data-tr-panel="show"]').count()) && (await frame.locator('[data-tr-panel="columns"]').count()) === 1, "opening Columns closes Show");
  const colText = await frame.locator('[data-tr-panel="columns"]').innerText();
  check(/Show \/ Hide Columns/i.test(colText) && /Reset to default/.test(colText), "Columns keeps its contents");
  await page.keyboard.press("Escape"); await frame.locator("body").evaluate((b) => b.focus && 0); await pacedWait(page, 250);
  if (await frame.locator('[data-tr-panel="columns"]').count()) { await frame.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); await pacedWait(page, 250); }
  check(!(await frame.locator('[data-tr-panel]').count()), "Esc closes the open dropdown");
  await openF(frame); await frame.locator("thead th").first().evaluate((el) => el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))); await pacedWait(page, 250);
  check(!(await frame.locator('[data-tr-panel]').count()), "a press outside closes the dropdown");
  await tap(frame, '[data-tr-btn="show"]');
  await frame.evaluate(() => [...document.querySelectorAll('[data-tr-panel="show"] label')].find((l) => /Action items only/.test(l.textContent)).querySelector("input").click()); await pacedWait(page, 350);
  const sh = await snap(frame);
  check(sh.headerPill === sh.rows.length, `Show › Action items only still works with the Filter on (header pill ${sh.headerPill} = rows ${sh.rows.length})`);
  await frame.evaluate(() => [...document.querySelectorAll('[data-tr-panel="show"] span')].find((l) => l.textContent.trim() === "Show all").click()); await pacedWait(page, 250);
  await frame.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); await pacedWait(page, 200);

  // reload keeps the selection; and what the OLD control saved (a bare ['red'] in the saved view prefs) opens as its checkbox
  await clearAll(frame); await tS("red"); sS = new Set(["red"]); pS = new Set(); await tP("Alpha");
  frame = await openReport(); await openF(frame);
  const rl = await snap(frame);
  check(rl.st.red.on && !rl.st.yellow.on && rl.pr[projKey.Alpha] && rl.pr[projKey.Alpha].on && rl.badge === "2", `a cache-busted reload keeps Needs Attention + Alpha (badge ${rl.badge})`);
  await page.evaluate(() => { const k = "planar:viewPrefs:v1"; const o = JSON.parse(localStorage.getItem(k) || "{}"); o.masterHealthFilter = ["red"]; delete o.masterProjectFilter; localStorage.setItem(k, JSON.stringify(o)); });
  frame = await openReport(); await openF(frame);
  const mg = await snap(frame);
  check(mg.st.red.on && !mg.st.yellow.on && !mg.st.gray.on && !mg.st.green.on && !mg.st.paused.on && Object.values(mg.pr).every((p) => !p.on) && mg.badge === "1", "migration: the old control's saved ['red'] opens as only Needs Attention checked, no project, badge 1");
  await page.evaluate(() => { const k = "planar:viewPrefs:v1"; const o = JSON.parse(localStorage.getItem(k) || "{}"); o.masterHealthFilter = false; localStorage.setItem(k, JSON.stringify(o)); });
  frame = await openReport(); await openF(frame);
  const mg2 = await snap(frame);
  check(Object.values(mg2.st).every((v) => !v.on) && mg2.badge === null && zzRows(mg2).length === SEEDED.length, "migration: the old 'All Statuses' (saved false) opens with nothing checked and every task listed");

  // phone layout: four buttons fit inside the screen, none overlapping, the panel inside the screen, no sideways scroll
  await frame.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); await pacedWait(page, 200);
  const geo = await frame.evaluate(() => { const bs = [...document.querySelectorAll("[data-tr-btn]")].map((b) => { const r = b.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
    const hit = (a, c) => !(a.r <= c.l + 0.5 || a.l >= c.r - 0.5 || a.b <= c.t + 0.5 || a.t >= c.b - 0.5); let overlap = false; bs.forEach((a, i) => bs.forEach((c, j) => { if (i < j && hit(a, c)) overlap = true; }));
    const t = [...document.querySelectorAll("span")].find((x) => x.textContent.trim() === "TASK REPORT"); const tr = t.getBoundingClientRect(), pr = t.nextElementSibling.getBoundingClientRect();
    const crowd = bs.some((b) => hit(b, { l: tr.left, r: tr.right, t: tr.top, b: tr.bottom }) || hit(b, { l: pr.left, r: pr.right, t: pr.top, b: pr.bottom }));
    return { n: bs.length, inside: bs.every((b) => b.l >= 0 && b.r <= innerWidth + 0.5), overlap, crowd, sideways: document.documentElement.scrollWidth > innerWidth + 1 }; });
  check(geo.n === 4 && geo.inside && !geo.overlap && !geo.crowd && !geo.sideways, `the four buttons fit at this width without overlap, crowding the title, or sideways scroll (${JSON.stringify(geo)})`);
  await openF(frame);
  const pin = await frame.evaluate(() => { const r = document.querySelector('[data-tr-panel="filter"]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5; });
  check(pin, "the open Filter panel stays inside the window");
  await page.screenshot({ path: `/tmp/task-report-filter-live-${phone ? "phone" : "desktop"}.png` });
} catch (e) { console.error("ERROR", e.message); failed = true; }
finally {
  if (s) {
    try {
      await s.page.waitForLoadState("domcontentloaded").catch(() => {}); await s.page.waitForFunction(() => !!window.pfSupabase, null, { timeout: 30000, polling: 250 }).catch(() => {});
      const left = await s.page.evaluate(async ([idList, schedList, origIdx]) => {
        const sb = window.pfSupabase; await sb.auth.getUser();
        try { localStorage.removeItem("planar:scheduleRowsRead"); localStorage.removeItem("planar:viewPrefs:v1"); } catch (_) {}
        { const { data: uu } = await sb.auth.getUser();
          const back = origIdx ? { n_pid: origIdx.n_pid, n_tid: origIdx.n_tid, last_active_by_site: origIdx.last_active_by_site, settings: origIdx.settings, migration_flags: origIdx.migration_flags }
            : { n_pid: 1, n_tid: {}, last_active_by_site: {}, settings: {}, migration_flags: {} };
          await sb.from("schedule_account_index").update({ ...back, rev: 1000 + Date.now() % 100000 }).eq("user_id", uu.user.id); }
        for (const sid of schedList) await sb.from("schedules").update({ deleted_at: new Date().toISOString() }).eq("id", sid);
        for (const id of idList) {
          await sb.from("schedules").update({ deleted_at: new Date().toISOString() }).eq("linked_site_id", id);
          await sb.from("site_elements").delete().eq("site_id", id);
          await sb.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
          await sb.from("sites").delete().eq("id", id);
        }
        for (const k of ["planarfit:sites:v1", "planarfit:sites:history:v1"]) { try { const o = JSON.parse((globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))(k) || "{}"); idList.forEach((i) => delete o[i]); localStorage.setItem(k, JSON.stringify(o)); } catch (_) {} }
        localStorage.removeItem("planarfit:currentSite:v1");
        const q = await sb.from("sites").select("id").in("id", idList);
        const live = await sb.from("schedules").select("id").in("linked_site_id", idList).is("deleted_at", null);
        return { sitesRemaining: (q.data || []).length, liveSchedulesRemaining: (live.data || []).length };
      }, [Object.values(ids), Object.values(schedIds), origIndex ?? null]);
      console.log("cleanup:", JSON.stringify(left));
      if (left.sitesRemaining !== 0 || left.liveSchedulesRemaining !== 0) failed = true;
    } catch (e) { console.error("cleanup ERROR", e.message); failed = true; }
    await s.close();
  }
}
process.exit(failed ? 1 : 0);
