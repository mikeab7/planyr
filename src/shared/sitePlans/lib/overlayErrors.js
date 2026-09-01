/* friendlySaveError — turns a raw Postgres/PostgREST error into a sentence Michael can act on
 * (B972225 NEW-4). He hit `null value in column "review_user_id" of relation
 * "site_plan_overlays" violates not-null constraint` rendered verbatim into the panel — a real
 * bug (see site_plan_overlays_drop_review_user_id.sql), but the standing rule this closes is
 * broader than that one column: no raw constraint text may ever reach him, from THIS save path
 * or a future one. Pure — no Supabase import, so it's trivially unit-tested against fixture
 * error shapes rather than a live database.
 *
 * A caller may also pass an already-hand-written Error (e.g. `new Error("Couldn't upload the
 * brochure.")`) rather than a raw Supabase/Postgres one — those must pass through UNCHANGED
 * rather than be flattened to a generic sentence. The distinguisher: a real Postgres/PostgREST
 * error always carries a `.code` (a 5-char SQLSTATE like "23502", or a "PGRST…" code) or reads
 * as SQL-technical text; a hand-written Error has neither.
 */
const TECHNICAL_WORDS = ["relation", "syntax error", "duplicate key", "invalid input syntax", "constraint", "schema cache"];

export function friendlySaveError(error) {
  if (!error) return "Something went wrong saving that — try again.";
  const code = String(error.code || "").toLowerCase();
  const msg = String(error.message || error || "").toLowerCase();

  // These two are checked BEFORE the generic SQLSTATE branches below: both raw messages also
  // contain generic phrasing ("violates check constraint" / "violates foreign key constraint")
  // that would otherwise match the more generic rule first and give a less specific, less
  // actionable sentence.
  //
  // B972512-HARDENING item 5 — deleting a site plan that still has comps pinned to it hits this
  // exact constraint (comps_parcel_anchor_has_identity, comps_site_plan_anchor.sql): the FK's
  // `on delete set null` tries to null out the deleted comp's site_plan_overlay_id, which then
  // fails the CHECK requiring a 'site_plan' anchor to carry one. The app now checks for this
  // proactively before attempting a delete (SitePlansSection.jsx), but this stays as the honest
  // fallback for a race (a comp pinned between the check and the delete) — never the raw
  // "violates check constraint" text.
  if (msg.includes("comps_parcel_anchor_has_identity")) {
    return "Can't delete this site plan — one or more comps are still pinned to it. Remove or re-pin them first.";
  }
  // B972512-HARDENING new finding 2 — deleting a brochure forever ("Delete forever" in the
  // Library, or the 30-day lazy purge) that still has a site-plan overlay built from it hits
  // this FK (site_plan_overlays_review_id_fkey, changed CASCADE -> RESTRICT so a brochure purge
  // can never silently destroy a placed plan or the comps pinned to it).
  if (msg.includes("site_plan_overlays_review_id_fkey")) {
    return "Can't delete this document forever — a site plan on the map is still built from it. Delete that site plan first, then try again.";
  }

  if (code === "23502" || msg.includes("violates not-null constraint")) {
    return "Couldn't save — something needed was left blank. This looks like a bug on our end; try again, and let us know if it keeps happening.";
  }
  if (code === "23503" || msg.includes("violates foreign key constraint")) {
    return "Couldn't save — the document this points to may have been removed. Try reopening it.";
  }
  if (code === "23505" || msg.includes("duplicate key value") || msg.includes("violates unique constraint")) {
    return "That's already been added.";
  }
  if (code === "23514" || msg.includes("violates check constraint")) {
    return "Couldn't save — one of the values isn't valid. Double-check what you entered and try again.";
  }
  if (code === "42501" || msg.includes("row-level security") || msg.includes("permission denied")) {
    return "You don't have permission to do that.";
  }
  if (code === "pgrst204" || msg.includes("schema cache") || msg.includes("could not find the")) {
    return "The app needs a refresh to pick up a recent update — please reload the page and try again.";
  }
  if (msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("timeout")) {
    return "Couldn't save — check your connection and try again.";
  }

  // No SQLSTATE/PostgREST code and nothing that reads as raw database wording — this is very
  // likely one of our own hand-written, already-plain-English Errors (e.g. "Couldn't upload the
  // brochure."). Pass it through rather than flatten it to a generic sentence.
  const looksTechnical = /^[0-9]{5}$/.test(code) || code.startsWith("pgrst") || TECHNICAL_WORDS.some((w) => msg.includes(w));
  if (!looksTechnical && error.message) return error.message;

  // Deliberately unmatched (a recognizably technical shape we don't have a specific line for):
  // callers still log `error` itself to the console/telemetry for us — this function only
  // decides what Michael SEES, never what gets recorded (LOUD-FAILURE: surface the failure,
  // not the raw SQL/Postgres wording).
  return "Something went wrong saving that — try again, and let us know if it keeps happening.";
}
