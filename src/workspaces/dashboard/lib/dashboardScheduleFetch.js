/* dashboardScheduleFetch — the one Supabase read the "Schedule health" card needs.
 *
 * `public.planar_data` holds exactly one row per account (key: the fixed literal "hs-v1",
 * used identically for every user — RLS on `user_id = auth.uid()` does the account-scoping, not
 * the key itself; see src/workspaces/scheduler/db/planar_tables_owner_only_no_team_default.sql).
 * `value` is a ~350 KB jsonb document; `value.projects` is what scheduleHealth.js summarizes.
 *
 * This mirrors the exact call the embedded Scheduler itself makes
 * (public/sequence/index.html's `window.storage.get("hs-v1")`, backed by
 * `.from("planar_data").select("value").eq("key", k).single()`) — same table, same key, same
 * RLS — just a second, independent, read-only caller. Fetched once per Dashboard mount, never
 * on a timer or per-render: the embedded app itself only re-reads on its own load.
 */
import { supabase } from "../../site-planner/lib/supabase.js";

const SCHEDULE_KEY = "hs-v1";

/** Returns the raw `value.projects` map, or null if there's no schedule yet / the read failed
 * (never throws — a Dashboard card degrades to "no data" rather than crashing the page). */
export async function fetchScheduleProjects() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.from("planar_data").select("value").eq("key", SCHEDULE_KEY).maybeSingle();
    if (error || !data?.value) return null;
    return data.value.projects || null;
  } catch (_) {
    return null;
  }
}
