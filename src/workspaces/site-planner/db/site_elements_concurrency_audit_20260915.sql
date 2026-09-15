-- NEW-2 concurrency audit (B1629616, 2026-09-15) — THE APPLIED DDL, committed as a record.
--
-- ⛔ THIS FILE IS A RECORD, NOT A SCRIPT TO RUN AGAIN. Applied to production (Supabase project
-- `lyeqzkuiwngunutlkkmi`) via the Supabase MCP on 2026-09-15. `site_elements` was one of the four
-- tables an owner dispatch named as apparently lacking a version column; the finding is that it
-- already has the MOST granular protection of any table in the schema (per-row `rev`, not a
-- single table-level counter), via `commit_elements()`'s mandatory `expected` rev on every
-- update/delete op. See `docs/DATA.md` §8 for the full four-table audit. `comment on table` is
-- idempotent; re-running this file is harmless.

comment on table public.site_elements is
  'B1629616 (NEW-2 concurrency audit, 2026-09-15): PROTECTED, and more granular than sites.version -- rev bigint per (site_id, kind, id) row, and commit_elements() REQUIRES "expected" (the client''s last-seen rev) for every update/delete op, raising if omitted, and reports status="conflict" (never clobbering) on a mismatch. This is the per-element analogue of sites.version. Do not read the absence of a table-level "version" column as a gap.';
