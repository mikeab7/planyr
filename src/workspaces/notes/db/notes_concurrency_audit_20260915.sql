-- NEW-2 concurrency audit (B1629616, 2026-09-15) — THE APPLIED DDL, committed as a record.
--
-- ⛔ THIS FILE IS A RECORD, NOT A SCRIPT TO RUN AGAIN. It is the byte-for-byte DDL applied to
-- production (Supabase project `lyeqzkuiwngunutlkkmi`) via the Supabase MCP on 2026-09-15, as
-- part of an audit dispatched to answer one question: which cloud tables are exposed to a lost
-- update because they carry no version/rev token at all? For the three Notes tables the answer
-- is "none of them — they already have full protection," and this file's whole job is to record
-- WHY on the tables themselves, so a future audit does not re-derive it from scratch. `comment
-- on table` is idempotent (last write wins) and re-running this file is harmless.
--
-- See `docs/DATA.md` §8 for the full audit (all four tables named in the dispatch, the
-- corrected premise, and the two genuine gaps filed separately as B1629617/B1629618).

comment on table public.notes_pages is
  'B1629616 (NEW-2 concurrency audit, 2026-09-15): PROTECTED. rev is bumped server-side by the notes_touch_rev BEFORE INSERT/UPDATE trigger, and every client UPDATE guards on .eq("rev", <last-synced rev>) (notesCloud.js) -- zero rows updated means another device moved first, surfaced as a conflict, never clobbered. Do not re-file this as lacking a version column; rev IS the version token.';

comment on table public.notes_trees is
  'B1629616 (NEW-2 concurrency audit, 2026-09-15): PROTECTED, same shape as notes_pages -- whole-blob replace but rev-guarded (.eq("rev", baseRev) in notesCloud.js pushTree), with rev bumped server-side by notes_touch_rev. Not a gap.';

comment on table public.notes_images is
  'B1629616 (NEW-2 concurrency audit, 2026-09-15): PROTECTED STRUCTURALLY rather than by a guarded UPDATE. rev exists (bumped by notes_touch_rev) but the only UPDATE call sites touch deleted_at alone (bin/purge tombstones), which is idempotent regardless of write order; every content field (path/mime/bytes/width/height) is written once at INSERT and never updated again, so a lost update on content is not reachable through this table''s actual write pattern.';
