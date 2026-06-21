/* Optimistic-concurrency upsert (B314) — a reusable compare-and-swap over a Supabase table
 * keyed by (user_id, id) with an integer `version` column. Used by BOTH the Site Planner
 * (public.sites) and Document Review (public.doc_reviews) so the conflict semantics are
 * identical and the primitive is ready for the DEFERRED multi-user team-workspace feature.
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
export const isMissingVersionColumn = (error) => {
  if (!error) return false;
  const msg = String(error.message || "").toLowerCase();
  if (!msg.includes("version")) return false;
  const code = String(error.code || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("could not find") || code === "42703" || code === "pgrst204";
};
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
// `row` = the column payload (id, user_id, data, + any duplicated columns — NOT version);
// `expected` = the version the client last synced (null/undefined ⇒ treat as a brand-new row).
// Returns the typed outcome above and never throws.
export async function casUpsert(client, table, { uid, id, row, expected }) {
  try {
    if (expected == null) {
      const { data, error } = await client.from(table).insert({ ...row, version: 1 }).select("version");
      return interpretInsert(data, error);
    }
    const { data, error } = await client.from(table)
      .update({ ...row, version: expected + 1 })
      .eq("user_id", uid).eq("id", id).eq("version", expected)
      .select("version");
    return interpretCas(data, error);
  } catch (e) {
    return { ok: false, error: (e && e.message) || "write threw" };
  }
}
