-- Comps — comp_date becomes OPTIONAL (B986096-HARDENING-28, NEW-5 follow-up, owner decision
-- 2026-09-02). Run once in the Supabase SQL editor (project lyeqzkuiwngunutlkkmi), AFTER
-- comps.sql. Idempotent: DROP NOT NULL on an already-nullable column is a no-op, not an error.
--
-- WHY: the owner's own 2026-08-21 decision — "Date is REQUIRED on all three types... a comp that
-- can't be filtered by recency goes stale invisibly" — still holds as a GOAL. What changed is
-- HOW that goal is met. He first asked whether the app should just default Executed to today
-- when left blank; on reflection he rejected that himself: "the executed date is a fact about
-- the transaction; today is a fact about the typist. Defaulting silently fabricates deal data
-- that later cannot be told apart from real dates, and it defeats the recency filtering the
-- requirement exists for." The friction he was actually reacting to was the REQUIREMENT itself,
-- not the absence of a default — so the fix is to stop requiring it, never to guess it.
--
-- `created_at` (already NOT NULL, already DB-assigned, already immutable from the client — no
-- app code ever writes it) is what recency ordering falls back to for an undated comp
-- ("Date entered" in the UI, `lib/comps.js`'s `sortCompsByRecency`) — no new column needed for
-- that half of the ask.
--
-- The client-side half of this same relaxation is `lib/comps.js`'s `validateComp`, which no
-- longer lists a missing Executed date as a save-blocking error — kept in lockstep with this
-- migration; either alone leaves the two disagreeing about what a valid comp is.

alter table public.comps alter column comp_date drop not null;

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select is_nullable from information_schema.columns
--   where table_name = 'comps' and column_name = 'comp_date';
--   -- expect: YES
