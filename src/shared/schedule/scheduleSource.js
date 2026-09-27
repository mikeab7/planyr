/* scheduleSource — resolves which storage the Schedule module's data should be read FROM: the
 * per-schedule `public.schedules` / `public.schedule_account_index` rows once an account is
 * flipped (see `schedules_authority_flip.sql`), or the legacy whole-account `public.planar_data`
 * blob (key "hs-v1") before that.
 *
 * B1927952 (NEW-1, 2026-09-27) — the Dashboard's Schedule health / Needs Attention / "Since you
 * were last here" cards read ONLY the retired blob (`dashboardScheduleFetch.js`), so on a flipped
 * account (Michael's own — `schedule_account_index.rows_authoritative = true` since 2026-09-25)
 * they froze on whatever the blob held at the moment of the flip (2026-09-22) while the scheduler
 * grid, the Reports tab, and every real edit moved on to the rows. Every OTHER caller that needs
 * "the current schedule projects map" — today just the Dashboard — should go through this module
 * instead of reading `planar_data` directly, so a flipped account never sees that frozen snapshot
 * through a NEW blind spot either.
 *
 * This is the READ-ONLY counterpart of the embedded Scheduler's own `readFromScheduleRows`
 * (public/sequence/index.html) — that function is inlined there because the standalone page
 * can't import from src/, and it ALSO seeds the write-path baselines (scheduleKnownRev/
 * scheduleBase/rev) a real editing session needs. A read-only caller never saves anything, so
 * this module deliberately does not replicate that half — lifting the embed's own copy into this
 * file wholesale was ruled out this session as more invasive than the one caller this fixes
 * needs; if a second read-only consumer shows up, revisit (see BACKLOG.md B1927952).
 *
 * No `user_id` filter appears anywhere below, by design — same convention as every other
 * dashboard fetch module (`dashboardSitesFetch.js` etc.): RLS ("select own schedule" / "select
 * own schedule index", both `user_id = auth.uid()`, `schedules_normalization.sql`) already scopes
 * every query to the signed-in caller, so a second, client-side filter would be redundant, not
 * safer.
 */

/** True once this account's Schedule reads/writes are authoritative on the normalized rows
 * rather than the legacy blob (mirrors `schedule_rows_authoritative(uuid)` — read directly
 * rather than via that RPC, since RLS already scopes the row and a second round trip buys
 * nothing). Returns false — never throws — on any absence/error: the honest default for an
 * account that hasn't been migrated, or a read that failed for any reason. */
export async function isScheduleRowsAuthoritative(supabase) {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase
      .from("schedule_account_index")
      .select("rows_authoritative")
      .maybeSingle();
    if (error || !data) return false;
    return !!data.rows_authoritative;
  } catch (_) {
    return false;
  }
}

/** The "hs-v1" projects map — `{ [scheduleId]: projectObject }` — composed from
 * `public.schedules`' non-deleted rows only (a soft-deleted schedule must never resurface — id 31
 * "Operations (Copy)" on production is the live case). Each entry is the COMPLETE, untouched
 * project object exactly as `schedules.data` stores it (id/name/linkedSiteId/linkedSiteName/
 * ownerKind/tasks included) — the SAME shape `recomposeFromRows` (public/sequence/index.html)
 * builds at `.projects`, so every existing consumer of that shape (`crossScheduleLabel`/`ownerOf`
 * in `scheduleOwnership.js`, `scheduleHealth.js`, `needsAttentionList.js`) needs no change.
 * Returns null on any absence/error — never a partial map. An account with zero live schedules
 * returns `{}` (a real, empty answer — distinct from null, which means the read itself failed). */
export async function fetchScheduleProjectsFromRows(supabase) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("schedules")
      .select("id, data")
      .is("deleted_at", null);
    if (error || !Array.isArray(data)) return null;
    const projects = {};
    for (const row of data) {
      if (!row || row.id == null) continue;
      projects[String(row.id)] = row.data;
    }
    return projects;
  } catch (_) {
    return null;
  }
}

/** The exact moment this account's schedule data was last written: `max(updated_at)` across
 * `public.schedules`' non-deleted rows and the account's `public.schedule_account_index` row.
 * Unlike the legacy `planar_history` read this replaces on a flipped account, this is an EXACT
 * write time, not an inferred upper bound — each row's own `updated_at` is stamped by a database
 * trigger (`schedules_touch_updated_at` / `schedule_account_index_touch_updated_at`,
 * `schedules_normalization.sql`) at the moment that row was actually written, not read off a
 * separate, differently-timed snapshot ring. Returns null on any absence/error. */
export async function fetchScheduleLastWriteAtFromRows(supabase) {
  if (!supabase) return null;
  try {
    const [schedRes, idxRes] = await Promise.all([
      supabase
        .from("schedules")
        .select("updated_at")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("schedule_account_index").select("updated_at").maybeSingle(),
    ]);
    if (schedRes.error || idxRes.error) return null;
    const times = [schedRes.data?.updated_at, idxRes.data?.updated_at]
      .map((v) => Date.parse(v || ""))
      .filter((ms) => Number.isFinite(ms));
    return times.length ? Math.max(...times) : null;
  } catch (_) {
    return null;
  }
}
