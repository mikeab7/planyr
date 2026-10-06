/* dashboardScheduleFetch — the one read the "Schedule health" / "Needs attention" / "Since you
 * were last here" cards need for the current schedule projects map and its last-write time.
 *
 * ⛔ B1927952 (NEW-1, 2026-09-27) — THIS FILE USED TO READ ONLY `public.planar_data` (key
 * "hs-v1"), which is the RETIRED whole-account blob once an account is flipped to
 * `schedule_account_index.rows_authoritative = true` (`schedules_authority_flip.sql`) — the
 * scheduler grid and the Reports tab already read the per-schedule `public.schedules` rows in
 * that state (public/sequence/index.html's `readFromScheduleRows`), so a flipped account's
 * Dashboard cards silently froze on whatever the blob held at the moment of the flip. Both
 * functions below now check the flip flag first (`isScheduleRowsAuthoritative`, shared with the
 * embedded Scheduler's own read path via `src/shared/schedule/scheduleSource.js`) and, when
 * flipped, compose their answer from the rows instead — the blob read that follows is now the
 * FALLBACK for an account that hasn't been migrated, not the primary path for everyone.
 *
 * For an unflipped account, `public.planar_data` still holds exactly one row per account (key:
 * the fixed literal "hs-v1", used identically for every user — RLS on `user_id = auth.uid()`
 * does the account-scoping, not the key itself; see
 * src/workspaces/scheduler/db/planar_tables_owner_only_no_team_default.sql). `value` is a
 * ~350 KB jsonb document; `value.projects` is what scheduleHealth.js summarizes. This mirrors the
 * exact call the embedded Scheduler itself makes on that path (public/sequence/index.html's
 * `window.storage.get("hs-v1")`, backed by `.from("planar_data").select("value").eq("key",
 * k).single()`) — same table, same key, same RLS — just a second, independent, read-only caller.
 *
 * Fetched once per Dashboard mount, never on a timer or per-render: the embedded app itself only
 * re-reads on its own load.
 */
import { supabase } from "../../site-planner/lib/supabase.js";
import {
  isScheduleRowsAuthoritative,
  fetchScheduleProjectsFromRows,
  fetchScheduleLastWriteAtFromRows,
} from "../../../shared/schedule/scheduleSource.js";

import { dropSchedulesOfDeletedProjects } from "../../../shared/schedule/scheduleLiveness.js";

const SCHEDULE_KEY = "hs-v1";

/* NEW-1 (2026-10-05) — never list a schedule whose project is deleted. The cascade trigger
 * (site-planner/db/project_schedule_cascade.sql) makes this true at the source; this is the reader's own
 * check, so a row that predates it (or an account without the migration) still cannot reach a card. A failed
 * `sites` read leaves the map untouched — the check can only remove, never invent. */
async function withoutDeletedProjectSchedules(projects) {
  if (!projects || !supabase) return projects;
  try {
    const { data, error } = await supabase.from("sites").select("id, group_id, deleted_at");
    if (error || !Array.isArray(data)) return projects;
    return dropSchedulesOfDeletedProjects(projects, data);
  } catch (_) {
    return projects;
  }
}

/** Returns the current `hs-v1` projects map, or null if there's no schedule yet / the read
 * failed (never throws — a Dashboard card degrades to "no data" rather than crashing the page).
 * Rows-authoritative accounts (B1927952) read `public.schedules` via `scheduleSource.js`; every
 * other account still reads the legacy `planar_data` blob. */
export async function fetchScheduleProjects() {
  if (!supabase) return null;
  try {
    if (await isScheduleRowsAuthoritative(supabase)) {
      return await withoutDeletedProjectSchedules(await fetchScheduleProjectsFromRows(supabase));
    }
    const { data, error } = await supabase.from("planar_data").select("value").eq("key", SCHEDULE_KEY).maybeSingle();
    if (error || !data?.value) return null;
    return await withoutDeletedProjectSchedules(data.value.projects || null);
  } catch (_) {
    return null;
  }
}

/** The schedule document's `settings` (its `healthRules` — the SAME rules the grid evaluates), or
 * null when unknown / the read failed. B1953795 (S4/S5): the Dashboard's health cards evaluate
 * through the shared rule engine with these. Rows-authoritative accounts keep settings on
 * `schedule_account_index`; every other account on the legacy blob (json-path select, so the
 * ~350 KB document is not fetched a second time). */
export async function fetchScheduleSettings() {
  if (!supabase) return null;
  try {
    if (await isScheduleRowsAuthoritative(supabase)) {
      const { data, error } = await supabase.from("schedule_account_index").select("settings").maybeSingle();
      if (error || !data) return null;
      return data.settings && typeof data.settings === "object" ? data.settings : null;
    }
    const { data, error } = await supabase.from("planar_data").select("settings:value->settings").eq("key", SCHEDULE_KEY).maybeSingle();
    if (error || !data) return null;
    const st = data.settings ?? data.value?.settings;
    return st && typeof st === "object" ? st : null;
  } catch (_) {
    return null;
  }
}

/** The moment this account's schedule data was last WRITTEN, in ms — or null when unknown.
 *
 * ⛔ B1927952 — ON A ROWS-AUTHORITATIVE ACCOUNT THIS IS NOW AN EXACT WRITE TIME, NOT AN UPPER
 * BOUND. `scheduleSource.js`'s `fetchScheduleLastWriteAtFromRows` reads `max(updated_at)` across
 * `public.schedules`' non-deleted rows and the account's `schedule_account_index` row — each
 * stamped by a database trigger at the moment that exact row was written
 * (`schedules_normalization.sql`), not inferred from a separately-timed ring. "Since you were
 * last here" (`sinceLastHereFeed.js`) still treats it as an upper bound for uniformity with the
 * unflipped path below (and because "exact" here means "exact write instant," not "exact cause" —
 * a task's `end` date could have moved in the same write as an unrelated field) — see that file's
 * own header for the reasoning that changed.
 *
 * For an account that hasn't been flipped, `public.planar_data` carries no `updated_at` column
 * and no task object carries a temporal field (both re-confirmed against production, 2026-09-08),
 * so `public.planar_history` — the append-only ring the embedded Scheduler writes a dated
 * snapshot into on every save (public/sequence/index.html's `_snapshot`, same "hs-v1" key, same
 * own-row RLS) — is the only recorded evidence of when a schedule change happened, and it can
 * only give a tightest measured UPPER BOUND, never an exact instant (the snapshot postdates the
 * edit by however long the save/history-write took).
 *
 * Deliberately selects `created_at` ONLY on that fallback path, never `value`: the newest
 * snapshot's own payload is a ~216 KB jsonb copy of the whole schedule, and this needs one
 * indexed timestamp. Never throws — a null degrades the stamp to `now` (a looser but still true
 * bound), never to a guess. */
export async function fetchScheduleLastWriteAt() {
  if (!supabase) return null;
  try {
    if (await isScheduleRowsAuthoritative(supabase)) {
      return await fetchScheduleLastWriteAtFromRows(supabase);
    }
    const { data, error } = await supabase
      .from("planar_history")
      .select("created_at")
      .eq("key", SCHEDULE_KEY)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data?.created_at) return null;
    const ms = Date.parse(data.created_at);
    return Number.isFinite(ms) ? ms : null;
  } catch (_) {
    return null;
  }
}
