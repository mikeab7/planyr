/* dashboardPrefs — per-user persisted Dashboard card layout (B1213313, NEW-2).
 *
 * Reuses the SAME account-scoped store the Site Planner's Standards panel uses
 * (`public.profiles.prefs` jsonb, own-row RLS — src/workspaces/site-planner/db/user_prefs.sql)
 * so no new migration is needed: this just adds one more top-level key, `dashboardLayout`.
 *
 * Deliberately does NOT import `site-planner/lib/userPrefs.js`, even though it manages the
 * same column: that module's `applyPrefs()` also pushes plan-standards defaults into
 * `planStyle.js`/`measureStyle.js`, which pulls a good slice of the Site Planner's rendering
 * code into whatever chunk imports it. The Dashboard has nothing to do with plan styling, so
 * it talks to `profiles.prefs` directly — the same jsonb bag, a different, independent reader/
 * writer, touching only its own key. A read-modify-write (never a bare `{dashboardLayout}`
 * write) is what keeps this from clobbering the OTHER keys (planStandards, sitesPanel, …) a
 * concurrent Site Planner session might be writing to the same row.
 *
 * Same shape as userPrefs.js on purpose (mirror-then-cloud, LOUD-FAILURE, a `source` the UI can
 * report) — proven pattern, just narrower.
 */
import { supabase } from "../../site-planner/lib/supabase.js";
import { normalizeLayout } from "./dashboardLayout.js";

const MIRROR_KEY = "planyr:dashboardLayout:v1";

const hasLS = () => { try { return typeof localStorage !== "undefined" && !!localStorage; } catch { return false; } };

function readMirror() {
  if (!hasLS()) return null;
  try { return JSON.parse(localStorage.getItem(MIRROR_KEY) || "null"); } catch { return null; }
}
function writeMirror(layout) {
  if (!hasLS()) return;
  try { localStorage.setItem(MIRROR_KEY, JSON.stringify(layout)); } catch { /* quota / private mode */ }
}

/** Load the signed-in user's Dashboard layout. Returns { layout, source } where source is
 * "cloud" (the account row) or "local" (mirror only — signed out, or the read failed). Never
 * throws — a prefs read can't be allowed to block the Dashboard from rendering its default. */
export async function loadDashboardLayout(uid) {
  const mirrorLayout = normalizeLayout(readMirror());
  if (!supabase || !uid) return { layout: mirrorLayout, source: "local" };
  try {
    const { data, error } = await supabase.from("profiles").select("prefs").eq("id", uid).maybeSingle();
    if (error) return { layout: mirrorLayout, source: "local", error: error.message };
    const layout = normalizeLayout(data?.prefs?.dashboardLayout);
    writeMirror(layout);
    return { layout, source: "cloud" };
  } catch (e) {
    return { layout: mirrorLayout, source: "local", error: e?.message || "layout load failed" };
  }
}

/** Persist a layout. Mirror first (instant, and the signed-out fallback), then a read-modify-
 * write of the cloud row so every OTHER key already in `prefs` survives untouched. LOUD-FAILURE:
 * a failed cloud write is reported, never swallowed into a silent "saved". */
export async function saveDashboardLayout(uid, layout) {
  const next = normalizeLayout(layout);
  writeMirror(next);
  if (!supabase || !uid) return { ok: false, layout: next, error: "not signed in" };
  try {
    const { data: row, error: readErr } = await supabase.from("profiles").select("prefs").eq("id", uid).maybeSingle();
    if (readErr) return { ok: false, layout: next, error: readErr.message };
    const prevPrefs = (row?.prefs && typeof row.prefs === "object") ? row.prefs : {};
    const { error } = await supabase
      .from("profiles")
      .upsert({ id: uid, prefs: { ...prevPrefs, dashboardLayout: next }, updated_at: new Date().toISOString() }, { onConflict: "id" });
    if (error) return { ok: false, layout: next, error: error.message };
    return { ok: true, layout: next };
  } catch (e) {
    return { ok: false, layout: next, error: e?.message || "layout save failed" };
  }
}
