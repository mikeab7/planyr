/* Optimistic-concurrency upsert (B314) — a reusable compare-and-swap over a Supabase table
 * identified by an `id` (or, on a per-user table, a composite `user_id,id`) with an integer
 * `version` column. Used by the Site Planner (public.sites), Document Review
 * (public.doc_reviews) and the Model workspace (public.model_sheets) so the conflict semantics
 * are identical. This is the primitive the multi-user team-workspace feature builds on: the
 * UPDATE is scoped by (conflict-target columns, version) and access is enforced by RLS, so a
 * teammate can edit a shared row without a false conflict and without re-stamping the creator
 * (user_id).
 *
 * Contract: a write carries the `version` the client last synced. The DB applies it ONLY if
 * the stored version still matches — a single conditional UPDATE, atomic at the row level —
 * and bumps the version. If another session advanced the row in between, 0 rows match → the
 * write is REJECTED as a conflict (never a silent clobber); the caller surfaces a loud
 * "reload before saving" prompt. A brand-new row inserts at version 1.
 *
 * `conflictTarget` (default "id") is the caller's OWN row identity, PostgREST onConflict-style
 * — a comma-separated column list. sites/doc_reviews keep the default (single-column PK);
 * model_sheets' real primary key is COMPOSITE (user_id, id) and passes `"user_id,id"` explicitly
 * — see casUpsert's own comment for why this stopped being a safe assumption to bake in.
 *
 * Graceful degradation: until the migration adds the `version` column, the conditional update
 * errors with "column …version… does not exist" (Postgres 42703) — `casUpsert` reports
 * `{ degrade:true }` and the caller falls back to `degradeUpsert` (a plain upsert, today's
 * last-write-wins, targeting the SAME `conflictTarget`), so saving NEVER breaks before the
 * migration runs; the guard is simply dormant.
 *
 * Everything here is pure I/O over an injected `client`, and the result-interpreters are pure
 * functions, so the whole conflict/degrade/success matrix is unit-tested without a live DB.
 */

// The signal that the `version` column isn't there yet (migration not run). Must name the
// VERSION column specifically — a table can have OTHER optional columns that also 404 (e.g.
// doc_reviews' library columns), and those must NOT be mistaken for "degrade the version
// guard". Covers Postgres undefined-column (42703 "… does not exist") and the PostgREST
// schema-cache miss (PGRST204 "Could not find the 'version' column …").
// Generic "this column isn't migrated in yet" detector. Accepts a Supabase error object OR a
// plain message string (casUpsert surfaces `error` as a string). If `col` is given, the message
// must mention it — so a missing optional column (version, team_id, …) isn't confused with a
// different one. Covers Postgres undefined-column (42703 "… does not exist") and the PostgREST
// schema-cache miss (PGRST204 "Could not find the '…' column …").
export const isMissingColumn = (error, col) => {
  if (!error) return false;
  const msg = String((error && error.message) || error || "").toLowerCase();
  if (col && !msg.includes(String(col).toLowerCase())) return false;
  const code = String((error && error.code) || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("could not find") || code === "42703" || code === "pgrst204";
};
// The signal that the `version` column isn't there yet (migration not run). Must name the
// VERSION column specifically — a table can have OTHER optional columns that also 404 (e.g.
// doc_reviews' library columns), and those must NOT be mistaken for "degrade the version guard".
export const isMissingVersionColumn = (error) => isMissingColumn(error, "version");
// unique_violation (23505) — an INSERT hit an existing primary key: we thought the row was
// new but it already exists (another session created it) → treat as a conflict, not an error.
const isUniqueViolation = (error) => String((error && error.code) || "") === "23505";

// Pure: turn a conditional-UPDATE result into a typed outcome.
//   { degrade:true }            → version column absent; caller should plain-upsert
//   { ok:false, conflict:true } → stored version advanced (or row gone); reject loudly
//   { ok:false, error }         → some other write error
//   { ok:true, version }        → applied; the new (bumped) version
export function interpretCas(rows, error) {
  if (error) {
    if (isMissingVersionColumn(error)) return { degrade: true };
    return { ok: false, error: error.message || "write failed" };
  }
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, conflict: true };
  return { ok: true, version: rows[0].version };
}

// Pure: turn an INSERT-of-a-new-row result into a typed outcome (PK collision ⇒ conflict).
export function interpretInsert(rows, error) {
  if (error) {
    if (isMissingVersionColumn(error)) return { degrade: true };
    if (isUniqueViolation(error)) return { ok: false, conflict: true };
    return { ok: false, error: error.message || "insert failed" };
  }
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: "insert returned no row" };
  return { ok: true, version: rows[0].version };
}

// Perform the guarded write. `client` = a supabase client; `table` = "sites"|"doc_reviews"|
// "model_sheets"|…; `row` = the column payload (id, data, + any duplicated columns — NOT
// user_id, NOT version); `uid` = the signed-in user, stamped as user_id (creator) ONLY on the
// insert branch; `expected` = the version the client last synced (null/undefined ⇒ treat as a
// brand-new row). Returns the typed outcome above and never throws.
//
// `conflictTarget` — PostgREST onConflict-style, comma-separated column list identifying THIS
// ROW (default "id", matching sites/doc_reviews' single-column PK). ⛔ B891184-FOLLOWUP-2 /
// model_sheets (2026-09-01): this helper was written against doc_reviews' single-column PK and
// every caller — insert filter, CAS update filter, the degrade-fallback upsert below — silently
// assumed "id" names the row. model_sheets' real primary key is COMPOSITE, (user_id, id)
// (deliberately: it scopes a sheet to one user × one project, so two users can each hold their
// own model for the same project id — that composite scoping is a real safety property, not
// something to weaken away). A caller on a composite-keyed table must pass its OWN target
// explicitly rather than relying on the "id" assumption; nothing here may re-derive one.
// TEAM NOTE: for the default single-column target, the conditional UPDATE filters on (id,
// version) only — NOT user_id. Once a project is shared, a teammate's uid differs from the row's
// creator (user_id), so a bare user_id filter would match 0 rows and report a false conflict.
// Access scoping is enforced by RLS (own row OR a row shared with a team you're in). A caller
// whose conflictTarget names "user_id" (a private, per-user composite key — never a shared-row
// table) DOES filter on it, because there the column identifies the row rather than gating team
// access. We also DON'T send user_id in the UPDATE payload, so a teammate edit never re-stamps
// the creator.
function conflictColumns(conflictTarget) {
  return String(conflictTarget || "id").split(",").map((s) => s.trim()).filter(Boolean);
}
// Resolve one conflict-target column to its filter value for THIS write. Only the two column
// names every conflict target in this codebase is built from are meaningful here: "id" (the
// `id` param) and "user_id" (the `uid` param, the composite key's other half on a per-user
// table like model_sheets). Anything else would need a value the row payload doesn't reliably
// carry post-spread, so it is refused rather than guessed at.
function conflictValue(col, id, uid) {
  if (col === "id") return id;
  if (col === "user_id") return uid;
  throw new Error(`optimisticUpsert: unsupported conflict-target column "${col}"`);
}
/* Fire-and-forget keepalive CAS write that SURVIVES a page navigation (B452).
 *
 * A forced reload (chunk-recovery reloadFresh / ErrorBoundary reload) aborts a normal
 * in-flight async upsert; fetch({keepalive:true}) is allowed to outlive the unload. This
 * is the same compare-and-swap as casUpsert — a conditional PATCH guarded by the version
 * the client last synced — so a stale flush CANNOT clobber a newer cloud row (a wrong
 * `expected` matches 0 rows and writes nothing). We can't read the response (the page is
 * leaving), so it's intentionally guard-only, never an insert: a brand-new row (no tracked
 * version) is left to the synchronous local save + the next-load boot merge.
 *
 * Returns true if a request was dispatched, false if it lacked what it needs (no fetch /
 * url / anon / token / tracked version / row) — in which case the local save + boot merge
 * remain the guarantee. Subject to the browser's ~64KB keepalive budget, so it may quietly
 * no-op for a very large plan; that's acceptable for a last-ditch safety net. Never throws.
 * Pure over an injected `fetchImpl`, so the URL/headers/guard shape is unit-tested. */
export function keepaliveCasPush({ fetchImpl, url, anon, token, table, id, row, expected }) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f || !url || !anon || !token || !table || id == null || expected == null || !row) return false;
  try {
    f(`${url}/rest/v1/${encodeURIComponent(table)}?id=eq.${encodeURIComponent(id)}&version=eq.${expected}`, {
      method: "PATCH",
      keepalive: true,
      headers: {
        apikey: anon,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ ...row, version: expected + 1 }),
    }).catch(() => { /* fire-and-forget; the page is navigating away */ });
    return true;
  } catch { return false; }
}

export async function casUpsert(client, table, { uid, id, row, expected, conflictTarget = "id" }) {
  try {
    if (expected == null) {
      // Insert: stamp the creator here (callers omit user_id from `row` so an UPDATE can't clobber it).
      // `id` is spread AFTER `row` (never trust the caller already put it there — B891184-FOLLOWUP-2:
      // model_sheets shipped a caller whose `row` was just `{ data }`, so every first-ever insert hit
      // the table's `id text not null` constraint (23502) in total silence — no console log anywhere on
      // this path surfaced it. `id` is already a required param here; spreading it defensively into the
      // payload costs nothing for a caller that already includes it (same value, harmless overwrite) and
      // closes the landmine for good, rather than trusting every future caller to remember the contract.
      const { data, error } = await client.from(table).insert({ ...row, id, user_id: uid, version: 1 }).select("version");
      return interpretInsert(data, error);
    }
    // The CAS filter names EVERY column of the caller's conflict target, not just "id" — on the
    // default single-column target this is exactly the old `.eq("id", id)`. On a composite target
    // (model_sheets: "user_id,id") this also filters on user_id, matching the row's real identity
    // instead of leaning on RLS alone to keep two users' same-id rows apart.
    let q = client.from(table).update({ ...row, version: expected + 1 });
    for (const col of conflictColumns(conflictTarget)) q = q.eq(col, conflictValue(col, id, uid));
    const { data, error } = await q.eq("version", expected).select("version");
    return interpretCas(data, error);
  } catch (e) {
    return { ok: false, error: (e && e.message) || "write threw" };
  }
}

/* The shared degrade-fallback write: `version` column absent (a partially-applied migration) →
 * plain last-write-wins upsert, exactly the shape every cloud table's degrade branch already
 * used — except the ON CONFLICT target now comes from the SAME `conflictTarget` the caller
 * passed to casUpsert, instead of each caller re-typing (and risking re-typing wrong) the
 * literal column list. This is the ONE place PostgREST's ON CONFLICT syntax appears in this
 * module: PostgREST turns `{ onConflict: X }` into `ON CONFLICT (X)`, and Postgres raises 42P10
 * ("no unique or exclusion constraint matching the ON CONFLICT specification") if X doesn't name
 * the table's real unique constraint — exactly what model_sheets' dormant degrade path did before
 * B891184-FOLLOWUP-2 (`onConflict: "id"` against a table whose real key is (user_id, id)).
 * `row` must already carry every conflict-target column (id, user_id, …) — same contract as
 * casUpsert's insert branch. Never throws. */
export async function degradeUpsert(client, table, { row, conflictTarget = "id" }) {
  try {
    const { error } = await client.from(table).upsert(row, { onConflict: conflictTarget });
    return { ok: !error, error: error ? error.message : null };
  } catch (e) {
    return { ok: false, error: (e && e.message) || "write threw" };
  }
}
