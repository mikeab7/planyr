/* THE one serialized writer of the `public.profiles.prefs` blob (B2 audit 2026-11-20, item 1).
 *
 * Several modules own a key inside that one jsonb bag (site-planner prefs, dashboard layout,
 * dashboard project order, since-last-here, comps rate period). Each used to run its own
 * read -> merge -> upsert with its OWN write queue (or none), so two saves from different modules
 * could interleave: both read the same old row, each wrote its own key back over the other's —
 * a lost update (dashboard layout / Review tabs reverting).
 *
 * Every writer now goes through `updateProfilePrefs`: ONE module-level queue for all of them, and
 * each step does a FRESH read of the row immediately before its upsert. Dependency-light on purpose
 * (no site-planner prefs/normalizer code) so the dashboard chunk stays lean.
 *
 * LOUD-FAILURE: resolves { ok:false, error } — never throws, never reports a silent success.
 */
import { supabase } from "../../workspaces/site-planner/lib/supabase.js";
import { invalidateProfileRow } from "./profileRowCache.js";

let writeChain = Promise.resolve();

/** `reducer(rawPrefsObject) -> nextPrefsObject`, applied to the account row read fresh right now. */
export function updateProfilePrefs(uid, reducer) {
  if (!supabase || !uid) return Promise.resolve({ ok: false, error: "not signed in" });
  const run = async () => {
    try {
      const { data: row, error: readErr } = await supabase.from("profiles").select("prefs").eq("id", uid).maybeSingle();
      if (readErr) return { ok: false, error: readErr.message };
      const prev = (row?.prefs && typeof row.prefs === "object" && !Array.isArray(row.prefs)) ? row.prefs : {};
      const next = reducer(prev);
      const { error } = await supabase.from("profiles").upsert({ id: uid, prefs: next, updated_at: new Date().toISOString() }, { onConflict: "id" });
      if (error) return { ok: false, error: error.message };
      invalidateProfileRow(uid); // the next load must see this write, not a cached pre-write row
      return { ok: true, prefs: next };
    } catch (e) {
      return { ok: false, error: e?.message || "prefs save failed" };
    }
  };
  const p = writeChain.then(run, run);
  writeChain = p.catch(() => {});
  return p;
}
