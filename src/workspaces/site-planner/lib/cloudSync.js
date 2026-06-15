/* Cloud sync (Phase 4) — read/write the user's sites in Supabase, RLS-scoped to
 * the signed-in user (each user only ever touches their own rows). The serialized
 * Site Model lives in the `data` jsonb column; a few columns are duplicated for
 * querying. No migration of legacy localStorage sites — cloud is the home for a
 * logged-in user's data; localStorage remains the store when logged out.
 */
import { supabase } from "./supabase.js";

// Don't push a huge embedded screenshot dataURL into a DB row — keep the underlay
// placement but drop the inline image (map-sourced underlays use a URL, not a
// dataURL, so those are preserved). Geometry/metrics are unaffected.
function slimForCloud(model) {
  const u = model && model.underlay;
  if (u && typeof u.src === "string" && u.src.startsWith("data:"))
    return { ...model, underlay: { ...u, src: null, strippedForCloud: true } };
  return model;
}

export async function cloudUpsert(uid, model) {
  if (!supabase || !uid || !model || !model.id) return { ok: false, error: "not ready" };
  const m = slimForCloud(model);
  const row = {
    id: m.id, user_id: uid,
    group_id: m.groupId || null, site: m.site || null, name: m.name || null, county: m.county || null,
    updated_at: new Date(m.updatedAt || Date.now()).toISOString(),
    data: m,
  };
  const { error } = await supabase.from("sites").upsert(row, { onConflict: "user_id,id" });
  return { ok: !error, error: error ? error.message : null };
}

export async function cloudDelete(uid, id) {
  if (!supabase || !uid || !id) return { ok: false };
  // Scope by user_id AND id (defense-in-depth — don't rely on RLS alone).
  const { error } = await supabase.from("sites").delete().eq("user_id", uid).eq("id", id);
  return { ok: !error, error: error ? error.message : null };
}

// Every site row for the signed-in user (RLS returns only their own). Returns the
// array of serialized Site Models (the `data` column).
export async function cloudList(uid) {
  if (!supabase || !uid) return [];
  const { data, error } = await supabase.from("sites").select("data").order("updated_at", { ascending: false });
  if (error || !data) return [];
  return data.map((r) => r.data).filter(Boolean);
}
