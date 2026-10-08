/* liveFixtures — throwaway rows a LIVE signed-in check (openSignedIn) needs, and the cleanup that PROVES they are gone.
 * Owner rule 15 (2026-10-05): test artifacts are always cleared, never asked about; delete-must-verify.
 * Everything is written/removed through the page's own Supabase client AS the test account, so RLS bounds it to that
 * account's rows (it cannot touch anyone else's). The account is SHARED with other sessions' fixtures
 * (e2e-fixture-site, zz-sweep-*), so cleanup removes ONLY rows this module made (ids carry LIVE_PREFIX) or — for the
 * schedule the UI creates — ids that were not there before the run. */
export const LIVE_PREFIX = "zz-livechk-";

/** A plan in the planner's current element shape: one parcel, one building (synthetic — no real data). */
export function throwawayPlan(id, now = Date.now()) {
  return {
    id, groupId: id, site: "ZZ Live Check", name: "Concept A", role: "pursuit", status: "pursuit", county: null,
    origin: null, schemaVersion: 15, elementsInRows: false, updatedAt: now,
    parcels: [{ id: "p1", points: [{ x: -600, y: -600 }, { x: 600, y: -600 }, { x: 600, y: 600 }, { x: -600, y: 600 }], active: true, z: 0 }],
    els: [{ id: "b1", type: "building", cx: 0, cy: 0, w: 500, h: 300, rot: 0, z: 1 }],
    measures: [], callouts: [], markups: [], sheetOverlays: [], settings: {}, elevation: { crossSections: [] }, layerAbove: {}, layerOverrides: {}, parcelDrawings: [],
  };
}

export async function seedThrowawayPlan(page, id) {
  return page.evaluate(async ([plan]) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const { error } = await window.pfSupabase.from("sites").insert({ id: plan.id, group_id: plan.groupId, site: plan.site, name: plan.name, county: plan.county, user_id: u.user.id, version: 1, data: plan });
    return error ? String(error.message) : null;
  }, [throwawayPlan(id)]).then((e) => { if (e) throw new Error("seedThrowawayPlan failed — " + e); });
}

export async function listIds(page, table) {
  return page.evaluate(async (t) => { const q = await window.pfSupabase.from(t).select("id"); return q.error ? null : q.data.map((r) => r.id); }, table);
}

/** Delete this module's plan (+ any element rows the app migrated it into) and every schedule not in `scheduleIdsBefore`;
 *  then re-read and report what is left (must be empty). */
export async function cleanupLive(page, { planId, scheduleIdsBefore = null }) {
  return page.evaluate(async ([planId, before]) => {
    const c = window.pfSupabase, out = { errors: [] };
    const run = async (label, p) => { const r = await p; if (r && r.error) out.errors.push(label + ": " + r.error.message); return r; };
    await run("site_elements", c.from("site_elements").delete().eq("site_id", planId));
    // the table refuses a permanent delete of a live row (sites_block_delete_live_group): trash it first, as the app does
    await run("sites trash", c.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", planId));
    await run("sites", c.from("sites").delete().eq("id", planId));
    if (before) {
      const now = await c.from("schedules").select("id");
      for (const r of (now.data || [])) if (!before.includes(r.id)) {
        await run("schedules trash", c.from("schedules").update({ deleted_at: new Date().toISOString() }).eq("id", r.id));
        await run("schedules", c.from("schedules").delete().eq("id", r.id));
      }
    }
    const left = { site: (await c.from("sites").select("id").eq("id", planId)).data?.length ?? "?" };
    if (before) left.schedules = ((await c.from("schedules").select("id")).data || []).filter((r) => !before.includes(r.id)).length;
    out.left = left; return out;
  }, [planId, scheduleIdsBefore]);
}
