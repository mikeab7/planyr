/* V1512592 (B2087648 / B2087649) — a project and its schedule live and die together, proven signed in on the
 * throwaway test account against a real deploy:
 *   E2E_LOGIN_KEY=… node ui-audit/verify-project-schedule-cascade.mjs [https://planyr.io]
 * Creates ONE throwaway project + schedule on e2e@planyr.test, deletes the project the way the app does
 * (sites.deleted_at), checks the live-schedule reader (what the Dashboard lists) no longer sees the schedule
 * and the plan's "has a schedule" hint is gone, restores it and checks both come back, then ALWAYS removes
 * everything it made. Known-good arm: the standing e2e fixture project is untouched throughout.
 * Never touches any account but the test account. Prints the served build in the same call as the assertions. */
import { openSignedIn, FIXTURE_SITE_ID } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io";
const TMP = "v1512592-throwaway";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok }); console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " — " + detail : "")); };

const s = await openSignedIn({ base });
let exit = 0;
try {
  await assertMeasurable(s.page, "verify-project-schedule-cascade");
  console.log("build:", JSON.stringify(s.build), "| signed in as", s.proof.email);
  const r = await s.page.evaluate(async ({ TMP, FIX }) => {
    const sb = window.pfSupabase; const out = {}; const log = (k, v) => { out[k] = v; };
    const { data: u } = await sb.auth.getUser(); const uid = u.user.id;
    const live = async (site) => (await sb.from("schedules").select("id,deleted_at,deleted_with_project").eq("linked_site_id", site)).data || [];
    const hintOf = async () => { const { data } = await sb.from("sites").select("version,deleted_at,data").eq("id", TMP).maybeSingle(); return data; };
    const cleanup = async () => {
      const rows = await live(TMP);
      // Schedules are soft-delete-only for the app's own role (no DELETE policy) — exactly what the app does.
      for (const x of rows) if (!x.deleted_at) await sb.from("schedules").update({ deleted_at: new Date().toISOString() }).eq("id", x.id);
      await sb.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", TMP);
      await sb.from("sites").delete().eq("id", TMP);
      return { schedulesLive: (await live(TMP)).filter((x) => !x.deleted_at).length, siteLeft: !!(await hintOf()) };
    };
    try {
      await cleanup(); // leftovers of an earlier failed run
      const fixBefore = (await live(FIX)).map((x) => [x.id, x.deleted_at]);
      const ins = await sb.from("sites").insert({ id: TMP, user_id: uid, group_id: TMP, site: "V1512592 throwaway", name: "A", updated_at: new Date().toISOString(), data: { id: TMP, groupId: TMP, site: "V1512592 throwaway", name: "A" } });
      if (ins.error) throw new Error("site insert: " + ins.error.message);
      const sc = await sb.from("schedules").insert({ user_id: uid, linked_site_id: TMP, linked_site_name: "V1512592 throwaway", name: "V1512592 schedule", data: { name: "V1512592 schedule", linkedSiteId: TMP, linkedSiteName: "V1512592 throwaway", tasks: [] }, rev: 0 }).select("id").single();
      if (sc.error) throw new Error("schedule insert: " + sc.error.message);
      const sid = sc.data.id;
      await sb.from("sites").update({ version: 2, data: { id: TMP, groupId: TMP, site: "V1512592 throwaway", name: "A", scheduleProjectId: sid } }).eq("id", TMP);
      log("sid", sid);
      log("before", { live: (await live(TMP)).filter((x) => !x.deleted_at).length, hint: (await hintOf())?.data?.scheduleProjectId ?? null });
      // DELETE the project the way the app does (cloudSync cloudDelete)
      const del = await sb.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", TMP);
      log("delErr", del.error ? del.error.message : null);
      const afterDel = await live(TMP); const hd = await hintOf();
      log("afterDelete", { liveSchedules: afterDel.filter((x) => !x.deleted_at).length, tag: afterDel[0]?.deleted_with_project ?? null, hint: hd?.data?.scheduleProjectId ?? null, version: hd?.version ?? null });
      // RESTORE
      const res = await sb.from("sites").update({ deleted_at: null }).eq("id", TMP);
      log("resErr", res.error ? res.error.message : null);
      const afterRes = await live(TMP);
      log("afterRestore", { liveSchedules: afterRes.filter((x) => !x.deleted_at).length, tag: afterRes[0]?.deleted_with_project ?? null });
      log("fixture", { before: fixBefore, after: (await live(FIX)).map((x) => [x.id, x.deleted_at]) });
    } catch (e) { log("error", String(e.message || e)); }
    log("cleanup", await cleanup());
    return out;
  }, { TMP, FIX: FIXTURE_SITE_ID });
  console.log(JSON.stringify(r));
  check("setup: throwaway project + schedule created, schedule live, hint set", !r.error && r.before?.live === 1 && String(r.before?.hint) === String(r.sid), r.error || "");
  check("delete: no error", r.delErr == null);
  check("delete: the schedule is gone from the live reader (Dashboard)", r.afterDelete?.liveSchedules === 0);
  check("delete: tagged as deleted with its project", r.afterDelete?.tag === TMP);
  check("delete: the plan's 'has a schedule' hint is cleared (and version bumped)", r.afterDelete?.hint == null && (r.afterDelete?.version ?? 0) >= 3);
  check("restore: no error", r.resErr == null);
  check("restore: the schedule is live again, tag cleared", r.afterRestore?.liveSchedules === 1 && r.afterRestore?.tag == null);
  check("known-good arm: the standing fixture's schedules were not touched", JSON.stringify(r.fixture?.before) === JSON.stringify(r.fixture?.after));
  check("cleanup: no live schedule and no project row of the throwaway remains (its soft-deleted schedule tombstone is by design)", r.cleanup?.schedulesLive === 0 && r.cleanup?.siteLeft === false, JSON.stringify(r.cleanup));
  if (results.some((x) => !x.ok)) exit = 1;
} catch (e) { console.error("FAIL", e.message); exit = 1; }
await s.close();
process.exit(exit);
