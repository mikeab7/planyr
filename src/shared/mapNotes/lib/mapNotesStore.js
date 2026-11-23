/* mapNotesStore — the one seam between the map-notes UI and Supabase's `public.map_notes` table.
 * Mirrors shared/comps/lib/compsStore.js exactly: every function returns { data, error } (or
 * { error }), nothing is swallowed, and the caller decides how to surface a failure (LOUD-FAILURE).
 *
 * Delete is SOFT, always — `deleteMapNote` stamps `deleted_at`, `fetchAllMapNotes` excludes those
 * rows, and `restoreMapNote` brings one back. The app has NO hard-delete path for a live note;
 * `permanentlyDeleteMapNote` exists for a future trash view's explicit purge and is not wired to
 * any control in this cut.
 *
 * ⛔ NOTHING HERE CREATES A SITE. `project_id` is written through untouched (null when the user
 * picked no site) — see db/map_notes.sql's header for why a note must never materialize one the
 * way B843792 has comps do.
 */
import { supabase } from "../../../workspaces/site-planner/lib/supabase.js";
import { rowToMapNote, mapNoteToRow } from "./mapNotes.js";

export { supabase };

const TABLE = "map_notes";
const SELECT_COLS =
  "id,user_id,team_id,project_id,title,body,anchor_kind,lat,lon,county,parcel_apn,parcel_geom,created_at,updated_at";

/** Every LIVE note the signed-in user can see (their own + their team's). Small personal/team
 * table — no pagination at any realistic scale, same call shape as fetchAllComps. */
export async function fetchAllMapNotes() {
  if (!supabase) return { data: [], error: null };
  const { data, error } = await supabase.from(TABLE).select(SELECT_COLS).is("deleted_at", null).order("updated_at", { ascending: false });
  if (error) return { data: [], error };
  return { data: (data || []).map(rowToMapNote), error: null };
}

export async function insertMapNote(note) {
  if (!supabase) return { data: null, error: new Error("Supabase not configured") };
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user?.id) return { data: null, error: new Error("Sign in to add a note") };
  const { data, error } = await supabase.from(TABLE).insert(mapNoteToRow(note)).select(SELECT_COLS).single();
  if (error) return { data: null, error };
  return { data: rowToMapNote(data), error: null };
}

export async function updateMapNote(id, note) {
  if (!supabase) return { data: null, error: new Error("Supabase not configured") };
  // RLS scopes the write to the caller's OWN rows — a teammate's update affects 0 rows rather than
  // throwing, so without this `!data` check a caller would silently believe a no-op saved (B209's
  // "saved ✓ that didn't save" is exactly the class this guard exists for).
  const { data, error } = await supabase.from(TABLE).update(mapNoteToRow(note)).eq("id", id).select(SELECT_COLS).maybeSingle();
  if (error) return { data: null, error };
  if (!data) return { data: null, error: new Error("Not saved — you can only edit notes you wrote") };
  return { data: rowToMapNote(data), error: null };
}

/** SOFT delete — keyed on (owner, id) by RLS's owner-only UPDATE policy, exactly as comps is.
 * Never a hard delete: the row stays, `deleted_at` is stamped, and restoreMapNote undoes it.
 *
 * ⛔ The success check verifies the RETURNED ROW, not just that the array is non-empty (B209's
 * class — a truthy-but-wrong response must never read as success). `.select("id")` with no
 * `.eq(...)` match returns `[]`, which the OLD `!data.length` check already caught; this additionally
 * refuses an array whose one element doesn't actually carry the id that was asked for, so a response
 * shape neither of us has seen yet still fails loud instead of silently closing the editor. */
export async function deleteMapNote(id) {
  if (!supabase) return { error: new Error("Supabase not configured") };
  const { data, error } = await supabase.from(TABLE).update({ deleted_at: new Date().toISOString() }).eq("id", id).select("id");
  if (error) return { error };
  if (!Array.isArray(data) || data[0]?.id !== id) return { error: new Error("Not deleted — you can only remove notes you wrote") };
  return { error: null };
}

/** Bring a soft-deleted note back. */
export async function restoreMapNote(id) {
  if (!supabase) return { error: new Error("Supabase not configured") };
  const { data, error } = await supabase.from(TABLE).update({ deleted_at: null }).eq("id", id).select("id");
  if (error) return { error };
  if (!Array.isArray(data) || data[0]?.id !== id) return { error: new Error("Not restored — you can only restore notes you wrote") };
  return { error: null };
}

/** The real DELETE, for a future trash view's explicit purge only. A note owns no Storage/Drive
 * file, so there is nothing else to clean up. */
export async function permanentlyDeleteMapNote(id) {
  if (!supabase) return { error: new Error("Supabase not configured") };
  const { error, count } = await supabase.from(TABLE).delete({ count: "exact" }).eq("id", id);
  if (error) return { error };
  if (!count) return { error: new Error("Not deleted — you can only remove notes you wrote") };
  return { error: null };
}
