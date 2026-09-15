-- NEW-2 concurrency audit (B1629616, 2026-09-15) — THE APPLIED DDL, committed as a record.
--
-- ⛔ THIS FILE IS A RECORD, NOT A SCRIPT TO RUN AGAIN. Applied to production (Supabase project
-- `lyeqzkuiwngunutlkkmi`) via the Supabase MCP on 2026-09-15. Unlike `notes_pages`/`site_elements`,
-- this table's absence of a version column is a REAL gap, not a stale premise — see
-- `docs/DATA.md` §8 for the measured write pattern (a full-row `.update(compToRow(comp))` with
-- no guard at all) and `BACKLOG.md` B1629617 for the filed fix (add a `version` column and route
-- `updateComp`/`insertComp` through the existing `shared/cloud/optimisticUpsert.js` primitive,
-- the same one `sites`/`doc_reviews`/`model_sheets` already share). Not implemented in this
-- migration — this file only records the finding on the table itself. `comment on table` is
-- idempotent; re-running this file is harmless.

comment on table public.comps is
  'B1629616 (NEW-2 concurrency audit, 2026-09-15): GENUINE GAP, filed as B1629617 (not implemented in B1629616). No rev/version column at all, and updateComp() (compsStore.js) issues a plain .update(compToRow(comp)).eq("id", id) that rewrites EVERY column from a full in-memory snapshot (compToRow serializes the whole comp, never a diff), with no concurrency guard. A save from a stale snapshot -- e.g. an edit-form tab left open on a second machine for days -- silently overwrites every field, including ones changed elsewhere in the interim, with that snapshot''s stale values. Needs the same protection sites/doc_reviews/model_sheets already share via shared/cloud/optimisticUpsert.js''s casUpsert (single-column "id" PK, straightforward fit).';
