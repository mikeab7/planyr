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
import { getProfileRow, invalidateProfileRow } from "../../../shared/profile/profileRowCache.js";
import { normalizeLayout, normalizeDismissed, appendNewCatalogCards, normalizeJumpBackInCount } from "./dashboardLayout.js";

const MIRROR_KEY = "planyr:dashboardLayout:v1";

const hasLS = () => { try { return typeof localStorage !== "undefined" && !!localStorage; } catch { return false; } };

// The mirror's shape grew a second field (B1422496 — `dismissed`, the deliberately-removed-card
// list catalog reconciliation needs; see dashboardLayout.js's own header) and a third (NEW-1,
// 2026-09-17 — `jumpBackInCount`, the Jump-back-in card's persisted row count; see that file's
// own header). A pre-existing mirror is just the bare layout array — read as
// `{ layout: <that array>, dismissed: undefined, jumpBackInCount: undefined }` so
// normalizeDismissed's / normalizeJumpBackInCount's own bootstrap defaults (see below) apply to
// it exactly as they do to a legacy cloud row.
function readMirror() {
  if (!hasLS()) return { layout: null, dismissed: undefined, jumpBackInCount: undefined };
  try {
    const raw = JSON.parse(localStorage.getItem(MIRROR_KEY) || "null");
    if (Array.isArray(raw)) return { layout: raw, dismissed: undefined, jumpBackInCount: undefined };
    if (raw && typeof raw === "object") return { layout: raw.layout ?? null, dismissed: raw.dismissed, jumpBackInCount: raw.jumpBackInCount };
    return { layout: null, dismissed: undefined, jumpBackInCount: undefined };
  } catch { return { layout: null, dismissed: undefined, jumpBackInCount: undefined }; }
}
function writeMirror(layout, dismissed, jumpBackInCount) {
  if (!hasLS()) return;
  try { localStorage.setItem(MIRROR_KEY, JSON.stringify({ layout, dismissed, jumpBackInCount })); } catch { /* quota / private mode */ }
}

/** Load the signed-in user's Dashboard layout, reconciled against the current card catalog
 * (B1422496 — appendNewCatalogCards adds any card the user hasn't placed or dismissed, so a card
 * shipped after this layout was last saved reaches it without the user opening Customize; see
 * dashboardLayout.js's own header for the full reasoning and the dismissed-card bootstrap rule).
 * Returns { layout, dismissed, jumpBackInCount, source } where source is "cloud" (the account
 * row) or "local" (mirror only — signed out, or the read failed). Never throws — a prefs read
 * can't be allowed to block the Dashboard from rendering its default. */
export async function loadDashboardLayout(uid) {
  const mirror = readMirror();
  const mirrorLayout = normalizeLayout(mirror.layout);
  const mirrorDismissed = normalizeDismissed(mirror.dismissed, mirrorLayout);
  const mirrorJumpBackInCount = normalizeJumpBackInCount(mirror.jumpBackInCount);
  if (!supabase || !uid) {
    return { layout: appendNewCatalogCards(mirrorLayout, mirrorDismissed), dismissed: mirrorDismissed, jumpBackInCount: mirrorJumpBackInCount, source: "local" };
  }
  try {
    // NEW-1 — shared, session-cached read (see profileRowCache.js): this and every other
    // reader of this row (userPrefs.js, compsRatePeriodPrefs.js, sinceLastHerePrefs) share one
    // fetch instead of each firing their own `profiles` read on mount.
    const row = await getProfileRow(uid);
    const rawLayout = normalizeLayout(row?.prefs?.dashboardLayout);
    const dismissed = normalizeDismissed(row?.prefs?.dashboardDismissedCards, rawLayout);
    const jumpBackInCount = normalizeJumpBackInCount(row?.prefs?.dashboardJumpBackInCount);
    const layout = appendNewCatalogCards(rawLayout, dismissed);
    writeMirror(layout, dismissed, jumpBackInCount);
    return { layout, dismissed, jumpBackInCount, source: "cloud" };
  } catch (e) {
    return { layout: appendNewCatalogCards(mirrorLayout, mirrorDismissed), dismissed: mirrorDismissed, jumpBackInCount: mirrorJumpBackInCount, source: "local", error: e?.message || "layout load failed" };
  }
}

/** Persist a layout + its dismissed-card list + the jump-back-in row count. Mirror first
 * (instant, and the signed-out fallback), then a read-modify-write of the cloud row so every
 * OTHER key already in `prefs` survives untouched. LOUD-FAILURE: a failed cloud write is
 * reported, never swallowed into a silent "saved". `dismissed`/`jumpBackInCount` are each
 * normalized against the caller's actual current value — never omit them, since an
 * omitted/undefined `dismissed` would re-trigger its bootstrap default and mark everything
 * currently missing as dismissed. */
export async function saveDashboardLayout(uid, layout, dismissed, jumpBackInCount) {
  const next = normalizeLayout(layout);
  const nextDismissed = normalizeDismissed(dismissed, next);
  const nextJumpBackInCount = normalizeJumpBackInCount(jumpBackInCount);
  writeMirror(next, nextDismissed, nextJumpBackInCount);
  if (!supabase || !uid) return { ok: false, layout: next, dismissed: nextDismissed, jumpBackInCount: nextJumpBackInCount, error: "not signed in" };
  try {
    const { data: row, error: readErr } = await supabase.from("profiles").select("prefs").eq("id", uid).maybeSingle();
    if (readErr) return { ok: false, layout: next, dismissed: nextDismissed, jumpBackInCount: nextJumpBackInCount, error: readErr.message };
    const prevPrefs = (row?.prefs && typeof row.prefs === "object") ? row.prefs : {};
    const { error } = await supabase
      .from("profiles")
      .upsert({ id: uid, prefs: { ...prevPrefs, dashboardLayout: next, dashboardDismissedCards: nextDismissed, dashboardJumpBackInCount: nextJumpBackInCount }, updated_at: new Date().toISOString() }, { onConflict: "id" });
    if (error) return { ok: false, layout: next, dismissed: nextDismissed, jumpBackInCount: nextJumpBackInCount, error: error.message };
    invalidateProfileRow(uid); // NEW-1 — the next load must see this write, not a cached pre-write row
    return { ok: true, layout: next, dismissed: nextDismissed, jumpBackInCount: nextJumpBackInCount };
  } catch (e) {
    return { ok: false, layout: next, dismissed: nextDismissed, jumpBackInCount: nextJumpBackInCount, error: e?.message || "layout save failed" };
  }
}
