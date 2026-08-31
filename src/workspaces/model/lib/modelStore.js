/* Model workspace — persistence. Local storage is the WRITE-THROUGH, always-on save (works
 * signed out, works before any migration runs, never blocks on the network); the cloud push
 * is best-effort on top of it, through the SAME guarded save path every other cloud table in
 * this repo uses — never a bespoke one (the build brief is explicit that this repo has a
 * history of an unserialised save path silently losing writes: B528/B529, where a debounced
 * autosave racing a manual/unmount flush for the SAME key both read the same tracked
 * `version`, so the second write's compare-and-swap matched 0 rows and was wrongly reported
 * as a conflict — which then froze autosave until reload).
 *
 * The two shared primitives that fix exactly that (src/shared/cloud/):
 *   - serializeWrites.makeWriteSerializer() — same-key writes for THIS tab run strictly in
 *     submission order, so a tab can never race itself.
 *   - optimisticUpsert.casUpsert() — the version-guarded compare-and-swap every cloud table
 *     here already uses (public.sites, public.doc_reviews). A REAL cross-device conflict
 *     still surfaces (0 rows matched because another session moved the row) — this only
 *     stops a tab racing ITSELF from manufacturing a false one.
 *
 * db/model_sheets.sql mirrors doc_reviews.sql's ORIGINAL four-column CAS shape (id/user_id/
 * data jsonb/version int/updated_at, same plain-owner RLS) — not the live public.doc_reviews
 * table, which has since grown team_id/project_id/etc. through later migrations; this table is
 * deliberately private/per-user, with no team_id, matching the payload below exactly. It has
 * NOT been applied to production by this session — the
 * house rule for this task is read-only/SELECT-only on production data, and this repo's own
 * precedent (the Comps migrations, src/shared/CLAUDE.md) is that a session with read-only
 * production access hands a migration to the owner rather than applying it. Until it runs,
 * every cloud call below degrades to "not-provisioned" and the local save keeps working —
 * the exact shape doc-review's own AI-filing proxy uses for "not deployed yet" (a 503/absent
 * table means the feature is dormant, never a crash).
 */
import { supabase, supabaseConfigured } from "../../site-planner/lib/supabase.js";
import { casUpsert } from "../../../shared/cloud/optimisticUpsert.js";
import { makeWriteSerializer } from "../../../shared/cloud/serializeWrites.js";

const TABLE = "model_sheets";
const serializeWrite = makeWriteSerializer();

const localKey = (scope, projectId) => `planyr:model:sheet:v1:${scope}:${projectId}`;

/** Read the locally-saved sheet for this project, scoped by account (or "local" signed out) —
 *  same scoping shape as Notes' storage keys. Never throws; a corrupt/blocked store reads as
 *  "nothing saved yet" rather than crashing the workspace. */
export function readLocalSheet(userId, projectId) {
  if (!projectId) return null;
  try {
    const raw = localStorage.getItem(localKey(userId || "local", projectId));
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

/** Write-through, synchronous, every commit — never debounced (B400176's rule: the stored
 *  copy must never be staler than the screen). Returns false on a storage failure so the
 *  caller can surface it (LOUD-FAILURE) rather than silently believing it saved. */
export function writeLocalSheet(userId, projectId, sheet) {
  if (!projectId) return false;
  try { localStorage.setItem(localKey(userId || "local", projectId), JSON.stringify(sheet)); return true; }
  catch (_) { return false; }
}

// The table not existing at all (migration never run) is a DIFFERENT signal from casUpsert's
// own "version column missing" degrade, which assumes the table is there. Detected the same
// way this repo detects any not-yet-migrated column (optimisticUpsert.isMissingColumn), just
// without a column name to require in the message.
function isMissingRelation(error) {
  const msg = String((error && error.message) || error || "").toLowerCase();
  const code = String((error && error.code) || "").toLowerCase();
  return code === "42p01" || msg.includes("does not exist") || msg.includes("schema cache");
}

/** Load this project's cloud row, if the table exists and one has been saved. Returns one of:
 *  { ok:true, sheet, version } · { ok:true, sheet:null, version:null } (nothing saved yet) ·
 *  { ok:false, reason:"not-provisioned" } · { ok:false, reason:"unavailable" } (signed out /
 *  no Supabase config) · { ok:false, reason:"error", error }. */
export async function loadCloudSheet(projectId) {
  if (!supabaseConfigured() || !projectId) return { ok: false, reason: "unavailable" };
  const { data, error } = await supabase.from(TABLE).select("data, version").eq("id", projectId).maybeSingle();
  if (error) return isMissingRelation(error) ? { ok: false, reason: "not-provisioned" } : { ok: false, reason: "error", error: error.message };
  if (!data) return { ok: true, sheet: null, version: null };
  return { ok: true, sheet: data.data, version: data.version ?? null };
}

async function upsertCore({ uid, projectId, sheet, expected }) {
  const r = await casUpsert(supabase, TABLE, { uid, id: projectId, row: { data: sheet }, expected });
  if (r.degrade) {
    // The version column specifically is missing (a partially-applied migration) — never
    // regress a save into a crash; fall back to plain last-write-wins, exactly like
    // doc-review's own degrade path for the identical shape.
    const { error } = await supabase.from(TABLE).upsert({ id: projectId, user_id: uid, data: sheet }, { onConflict: "id" });
    return error
      ? (isMissingRelation(error) ? { ok: false, reason: "not-provisioned" } : { ok: false, reason: "error", error: error.message })
      : { ok: true, version: null };
  }
  if (!r.ok) {
    if (r.conflict) return { ok: false, reason: "conflict" };
    return isMissingRelation({ message: r.error }) ? { ok: false, reason: "not-provisioned" } : { ok: false, reason: "error", error: r.error };
  }
  return { ok: true, version: r.version };
}

/** Guarded cloud save. `expected` is the version this session last saw for this project (null
 *  = never synced, treated as a fresh insert). Writes for the SAME project always run through
 *  the one write serializer, so a debounced autosave and a beforeunload flush can never race
 *  each other into a false conflict. Never throws. */
export function saveCloudSheet({ uid, projectId, sheet, expected }) {
  if (!supabaseConfigured() || !uid || !projectId) return Promise.resolve({ ok: false, reason: "unavailable" });
  return serializeWrite(projectId, () => upsertCore({ uid, projectId, sheet, expected }));
}
