/* NEW-1 — LIVE acceptance for the Task Report's status filter (In Progress / Needs Attention, independently selectable).
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
    await frame.evaluate(() => { const m = [...document.querySelectorAll("span")].find((x) => x.textContent.trim() === "Group by"); const seg = m && [...m.parentElement.querySelectorAll("span")].find((x) => x.textContent.trim() === "Project"); if (seg) seg.click(); });
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
      rows.push({ name: tds[ti].textContent.trim(), status: tds[si].textContent.trim() }); if (cur) cur.rows++;
    });
    const segs = Object.fromEntries([...document.querySelectorAll("[data-status-seg]")].map((b) => [b.dataset.statusSeg, b.getAttribute("aria-pressed") === "true"]));
    return { headerPill, groups, rows, segs, empty: document.querySelector("[data-status-empty]")?.textContent.trim() || null };
  });
  const press = async (frame, seg) => {
    const loc = frame.locator(`[data-status-seg="${seg}"]`);
    await loc.evaluate((el) => el.scrollIntoView({ block: "center" })); // page-JS scroll, never the driver's
    if (phone) await loc.tap(); else await loc.click();
    await pacedWait(page, 350);
  };

  let frame = await openReport();
  const first = await snap(frame);
  if (!check(Object.keys(first.segs).length === 3, `the Status control is on the page (segments: ${Object.keys(first.segs).join(", ") || "none"})`)) throw new Error("no Status control on this build — VOID");
  check(first.segs.yellow && first.segs.red && !first.segs.all, `a saved legacy "both" opens as In Progress + Needs Attention on (${JSON.stringify(first.segs)})`);
  await press(frame, "all");
  const all = await snap(frame);
  const zzRows = (sn) => sn.rows.filter((r) => r.name.startsWith("ZZ StatusFilter"));
  const truth = Object.fromEntries(zzRows(all).map((r) => [r.name, r.status]));
  const SEEDED = PROJECTS.flatMap(([n, hs]) => hs.map((h, k) => `${n} #${k + 1} ${h}`));
  if (!check(sameSet(Object.keys(truth), SEEDED) && all.segs.all, `known-good arm: "All" lists all ${SEEDED.length} seeded tasks (${Object.keys(truth).length} read) and All is pressed`)) throw new Error("VACUOUS run — seeded tasks not all on the report");
  const LABEL = { yellow: "In Progress", red: "Needs Attn." };
  const EVERY = new Set(Object.values(truth));
  const verify = async (label, wantSet, sel) => {
    const sn = await snap(frame);
    const wantNames = SEEDED.filter((n) => wantSet.has(truth[n]));
    const total = sn.rows.length;
    const gz = sn.groups.filter((g) => g.label.startsWith("ZZ StatusFilter"));
    check(sameSet(zzRows(sn).map((r) => r.name), wantNames), `${label}: seeded rows = exactly the tasks whose pill matches (${wantNames.length})`);
    check(sn.headerPill === total && sn.groups.every((g) => g.pill === g.rows && g.rows > 0) && sn.groups.reduce((n, g) => n + g.pill, 0) === total, `${label}: header pill ${sn.headerPill} = rows ${total}; each group pill = its rows; no empty group header`);
    check(sameSet(Object.entries(sn.segs).filter(([, v]) => v).map(([k]) => k), sel), `${label}: pressed = ${JSON.stringify(sel)}`);
    return { sn, gz };
  };
  const IP = new Set(["In Progress"]), NA = new Set(["Needs Attn."]), BOTH = new Set(["In Progress", "Needs Attn."]);

  await press(frame, "yellow"); await verify("only In Progress", IP, ["yellow"]);
  await press(frame, "yellow"); await verify("In Progress off → All (no dead end)", EVERY, ["all"]);
  await press(frame, "red");    const na = await verify("only Needs Attention", NA, ["red"]);
  check(!na.gz.some((g) => /Charlie/.test(g.label)) && !na.gz.some((g) => /Bravo/.test(g.label)), "a group with no matching task disappears (Bravo has only In Progress, Charlie only Complete/Not Started)");
  await press(frame, "yellow"); await verify("both", BOTH, ["yellow", "red"]);
  await press(frame, "red");    await verify("both → only In Progress", IP, ["yellow"]);
  await press(frame, "red");    await verify("both again", BOTH, ["yellow", "red"]);
  await press(frame, "all");    await verify("All", EVERY, ["all"]);
  let sel = new Set(), rseed = 11, walkOk = true, detail = ""; const rnd = () => (rseed = (rseed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 14 && walkOk; i++) {
    const k = ["yellow", "red", "all"][Math.floor(rnd() * 3)]; await press(frame, k);
    if (k === "all") sel = new Set(); else sel.has(k) ? sel.delete(k) : sel.add(k);
    const w = sel.size ? new Set([...sel].map((x) => LABEL[x])) : EVERY; const sn = await snap(frame);
    const wn = SEEDED.filter((n) => w.has(truth[n]));
    if (!(sameSet(zzRows(sn).map((r) => r.name), wn) && sn.headerPill === sn.rows.length && sn.groups.every((g) => g.pill === g.rows && g.rows > 0))) { walkOk = false; detail = `step ${i} (${k})`; }
  }
  check(walkOk, `14 random switches in a row stay consistent ${detail}`);

  // reload keeps the selection (saved view preference)
  await press(frame, "all"); await press(frame, "red");
  frame = await openReport();
  const rl = await snap(frame);
  check(sameSet(Object.entries(rl.segs).filter(([, v]) => v).map(([k]) => k), ["red"]) && zzRows(rl).every((r) => r.status === "Needs Attn."), `a cache-busted reload keeps "only Needs Attention" (${JSON.stringify(rl.segs)})`);

  // phone layout: the control sits inside the screen and overlaps nothing in the header
  const geo = await frame.evaluate(() => { const el = document.querySelector("[data-status-filter]"); const r = el.getBoundingClientRect(); const sibs = [...el.parentElement.children].filter((c) => c !== el).map((c) => c.getBoundingClientRect()).filter((b) => b.width > 0);
    return { left: r.left, right: r.right, vw: innerWidth, overlap: sibs.some((b) => !(b.right <= r.left + 0.5 || b.left >= r.right - 0.5 || b.bottom <= r.top + 0.5 || b.top >= r.bottom - 0.5)), sideways: document.documentElement.scrollWidth > innerWidth + 1 }; });
  check(geo.left >= 0 && geo.right <= geo.vw + 0.5 && !geo.overlap && !geo.sideways, `the control fits the header at this width without overlap or sideways scroll (${JSON.stringify(geo)})`);
  await page.screenshot({ path: `/tmp/task-report-status-live-${phone ? "phone" : "desktop"}.png` });
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
        for (const k of ["planarfit:sites:v1", "planarfit:sites:history:v1"]) { try { const o = JSON.parse(localStorage.getItem(k) || "{}"); idList.forEach((i) => delete o[i]); localStorage.setItem(k, JSON.stringify(o)); } catch (_) {} }
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
