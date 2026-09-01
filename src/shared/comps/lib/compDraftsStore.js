/* compDraftsStore — the Supabase seam for `public.comp_import_drafts` (B849233/NEW-2). Mirrors
 * compsStore.js's shape: every function returns { data, error } (or { error } for delete),
 * nothing swallowed (LOUD-FAILURE).
 */
import { supabase } from "../../../workspaces/site-planner/lib/supabase.js";
import { rowToImportDraft, importDraftToInsertRow } from "./compDrafts.js";
import { insertComp } from "./compsStore.js";
import { validateComp } from "./comps.js";

const TABLE = "comp_import_drafts";
const SELECT_COLS =
  "id,user_id,source,source_file,raw_name,raw_description,raw_geometry,proposed,status," +
  "promoted_comp_id,promote_error,created_at,updated_at";

/** Every draft the signed-in user owns — RLS already scopes this to owner-only (no team
 * composition at all, per the leasing spec's "excluded from what teammates can see"). */
export async function fetchMyDrafts() {
  if (!supabase) return { data: [], error: null };
  const { data, error } = await supabase.from(TABLE).select(SELECT_COLS).order("created_at", { ascending: false });
  if (error) return { data: [], error };
  return { data: (data || []).map(rowToImportDraft), error: null };
}

/** Bulk insert, one round trip for a whole KML import. */
export async function insertDrafts(rows) {
  if (!supabase) return { data: null, error: new Error("Supabase not configured") };
  if (!rows?.length) return { data: [], error: null };
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user?.id) return { data: null, error: new Error("Sign in to import comps") };
  const { data, error } = await supabase.from(TABLE).insert(rows.map(importDraftToInsertRow)).select(SELECT_COLS);
  if (error) return { data: null, error };
  return { data: (data || []).map(rowToImportDraft), error: null };
}

/** Save an in-progress edit to a draft's proposed values (the review row's own typed corrections
 * before promotion) without promoting it yet. */
export async function updateDraftProposed(id, proposed) {
  if (!supabase) return { data: null, error: new Error("Supabase not configured") };
  const { data, error } = await supabase.from(TABLE).update({ proposed }).eq("id", id).select(SELECT_COLS).maybeSingle();
  if (error) return { data: null, error };
  if (!data) return { data: null, error: new Error("Not saved — draft not found") };
  return { data: rowToImportDraft(data), error: null };
}

/** Reject/discard a draft outright — never promoted, removed from the holding area. */
export async function deleteDraft(id) {
  if (!supabase) return { error: new Error("Supabase not configured") };
  const { error, count } = await supabase.from(TABLE).delete({ count: "exact" }).eq("id", id);
  if (error) return { error };
  if (!count) return { error: new Error("Not deleted") };
  return { error: null };
}

/** Promotion — the moment `comps`' strict constraints get enforced (this table's whole reason
 * for existing). Validates client-side first (fast, no round trip for an obviously-incomplete
 * row: no date, no anchor), then attempts the real insert. On EITHER failure, the reason is
 * written back onto the draft row (`promote_error`) so it's shown against the row rather than
 * lost in a toast — a draft that can't satisfy the real table's constraints stays a draft,
 * loudly, never silently retried or downgraded. */
export async function promoteDraft(draftId, comp) {
  if (!supabase) return { data: null, error: new Error("Supabase not configured") };
  const errs = validateComp(comp);
  if (errs.length) {
    const reason = errs.join(" ");
    await supabase.from(TABLE).update({ promote_error: reason }).eq("id", draftId);
    return { data: null, error: new Error(reason) };
  }
  const result = await insertComp(comp);
  if (result.error) {
    const reason = result.error.message || "Promotion failed";
    await supabase.from(TABLE).update({ promote_error: reason }).eq("id", draftId);
    return { data: null, error: new Error(reason) };
  }
  const { data, error } = await supabase.from(TABLE)
    .update({ status: "promoted", promoted_comp_id: result.data.id, promote_error: null })
    .eq("id", draftId).select(SELECT_COLS).maybeSingle();
  // The comp itself WAS created even if this bookkeeping update somehow fails — report both
  // facts rather than let a failed status-flip make a real promotion look like it never happened.
  if (error) return { data: { comp: result.data, draft: null }, error };
  return { data: { comp: result.data, draft: data ? rowToImportDraft(data) : null }, error: null };
}
