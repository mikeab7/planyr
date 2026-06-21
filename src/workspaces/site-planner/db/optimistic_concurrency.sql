-- Optimistic concurrency / "reject stale saves" (B314) — run ONCE in the Supabase SQL
-- editor. Idempotent; safe to re-run. ADDITIVE: adds an integer `version` column to the
-- two user-data tables so a save can be rejected when another session advanced the row in
-- between (no silent last-write-wins clobber). RLS is UNCHANGED — the existing per-user
-- row policies already cover the new column, and the conditional UPDATE the client issues
-- runs as the signed-in user.
--
-- How it works with the client (src/shared/cloud/optimisticUpsert.js):
--   • The client tracks the `version` it last synced for each row.
--   • A save is a conditional UPDATE … WHERE user_id = … AND id = … AND version = <expected>,
--     setting version = <expected> + 1. Postgres applies that single statement atomically, so
--     exactly one of two racing saves wins; the loser matches 0 rows → the client treats it as
--     a CONFLICT and prompts "reload before saving" instead of overwriting.
--   • A brand-new row inserts at version 1.
--
-- BEFORE this runs, the client degrades to a plain upsert (today's behaviour) — so saving is
-- never blocked by the feature being un-migrated; it simply isn't guarded yet.

alter table public.sites       add column if not exists version integer not null default 1;
alter table public.doc_reviews add column if not exists version integer not null default 1;

-- (No index needed: every guarded write already filters on the (user_id, id) primary key,
--  and `version` is just an extra equality on that same already-located row.)
