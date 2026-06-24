/* Optimistic-concurrency upsert (B314) — a reusable compare-and-swap over a Supabase table
 * keyed by `id` with an integer `version` column. Used by BOTH the Site Planner
 * (public.sites) and Document Review (public.doc_reviews) so the conflict semantics are
 * identical. This is the primitive the multi-user team-workspace feature builds on: the
 * UPDATE is scoped by (id, version) and access is enforced by RLS, so a teammate can edit a
 * shared row without a false conflict and without re-stamping the creator (user_id).
 *
 * Contract: a write carries the `version` the client last synced. The DB applies it ONLY if
 * the stored version still matches — a single conditional UPDATE, atomic at the row level —
 * and bumps the version. If another session advanced the row in between, 0 rows match → the
 * write is REJECTED as a conflict (never a silent clobber); the caller surfaces a loud
 * "reload before saving" prompt. A brand-new row inserts at version 1.
 *
 * Graceful degradation: until the migration adds the `version` column, the conditional update
 * errors with "column …version… does not exist" (Postgres 42703) — `casUpsert` reports
 * `{ degrade:true }` and the caller falls back to a plain upsert (today's last-write-wins), so
 * saving NEVER breaks before the migration runs; the guard is simply dormant.
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

// Perform the guarded write. `client` = a supabase client; `table` = "sites"|"doc_reviews";
// `row` = the column payload (id, data, + any duplicated columns — NOT user_id, NOT version);
// `uid` = the signed-in user, stamped as user_id (creator) ONLY on the insert branch;
// `expected` = the version the client last synced (null/undefined ⇒ treat as a brand-new row).
// Returns the typed outcome above and never throws.
//
// TEAM NOTE: the conditional UPDATE filters on (id, version) only — NOT user_id. Once a project
// is shared, a teammate's uid differs from the row's creator (user_id), so a user_id filter would
// match 0 rows and report a false conflict. Access scoping is enforced by RLS (own row OR a row
// shared with a team you're in); `id` is the primary key, `version` is the concurrency guard. We
// also DON'T send user_id in the UPDATE payload, so a teammate edit never re-stamps the creator.
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

export async function casUpsert(client, table, { uid, id, row, expected }) {
  try {
    if (expected == null) {
      // Insert: stamp the creator here (callers omit user_id from `row` so an UPDATE can't clobber it).
      const { data, error } = await client.from(table).insert({ ...row, user_id: uid, version: 1 }).select("version");
      return interpretInsert(data, error);
    }
    const { data, error } = await client.from(table)
      .update({ ...row, version: expected + 1 })
      .eq("id", id).eq("version", expected)
      .select("version");
    return interpretCas(data, error);
  } catch (e) {
    return { ok: false, error: (e && e.message) || "write threw" };
  }
}
