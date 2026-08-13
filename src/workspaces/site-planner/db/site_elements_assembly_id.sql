-- B1341 STAGE 1 of 3 — NAME THE ASSEMBLY ON THE ROW.
--
-- WHY THIS EXISTS
-- ---------------
-- A bonded assembly — a building plus every element `attachedTo` it (truck court, trailer parking,
-- sidewalks, side parking, corner bump-outs) — is ONE object to the user and N+1 INDEPENDENT ROWS
-- here. Each row carries its own `rev`, is accepted or refused on its own guard, and echoes on its
-- own realtime event, so some interleaving always lands one row without the others. B1340 made
-- that state unobservable and unpersistable IN THE CLIENT; B1341 is about making it
-- unrepresentable in the DATABASE, which is a different and larger claim.
--
-- The staged plan on B1341 is deliberate and its first line is: **do not start at stage 2.**
-- Group CAS (stage 2) needs the server to know which rows form an assembly, and today it cannot
-- see that at all — the grouping lives inside `data->>'attachedTo'`, which no constraint, index or
-- statement can group on. Without stage 1 the client would have to SEND the membership on every
-- call, which is the same trust-the-client problem in a new place.
--
-- WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT
-- -------------------------------------------------
-- Adds ONE column, `assembly_id`: the host's id for a bonded element, the element's own id
-- otherwise. Read by nobody. Written by nothing. No behaviour changes, no client changes, no RPC
-- changes. Its whole job is to give the database the grouping it currently cannot see, so stage 2
-- has something to CAS against.
--
-- ⛔ ONE DELIBERATE DEVIATION FROM WHAT B1341 WROTE DOWN, recorded here rather than left implicit.
-- The item says "backfilled from `attachedTo`, written by the client". This ships it as a STORED
-- GENERATED column instead, so it is neither backfilled nor written by anyone: Postgres derives it
-- from `data` on every insert and update, for every row, forever. That is strictly better for the
-- one property stage 1 exists to establish — the grouping cannot DRIFT from the bonds it names.
-- A client-written column has exactly the failure mode this whole bug family is made of: two
-- copies of one fact, written by different paths, disagreeing under a race. There is no version of
-- "the client forgot to set assembly_id" to defend against, because the client cannot set it.
-- The cost is that the expression is fixed at migration time; changing it is another migration.
-- That is the right trade for a column whose expression is one `coalesce`.
--
-- SAFETY
-- ------
-- `add column ... generated always as (...) stored` rewrites the table and takes an ACCESS
-- EXCLUSIVE lock for the duration. Measured on production 2026-08-12 before applying: 2,457 rows,
-- 1,832 kB total relation size — a rewrite in the low milliseconds. On a table where that stops
-- being true, this would need `add column` + backfill + trigger instead; it is not true yet and
-- pretending otherwise would be premature.
--
-- Idempotent (`if not exists`), and reversible: see the drop at the bottom, commented out.
--
-- HOW TO APPLY
-- ------------
-- Run this whole file once (Supabase Dashboard → SQL Editor → New query → paste → Run).

alter table public.site_elements
  add column if not exists assembly_id text
    generated always as (coalesce(data->>'attachedTo', id)) stored;

-- The index stage 2 will read the group through. Partial on live rows: a tombstone is not a member
-- of an assembly, and every group question stage 2 asks is about rows that still exist.
create index if not exists site_elements_assembly_idx
  on public.site_elements (site_id, assembly_id)
  where deleted_at is null;

comment on column public.site_elements.assembly_id is
  'B1341 stage 1 — the bonded assembly this row belongs to: the host id for a bonded element, the '
  'element''s own id otherwise. GENERATED, so it can never drift from data->>''attachedTo''. Read '
  'by nobody today; it exists so stage 2 can CAS on the group instead of per row. Do not write it.';

-- ---- ROLLBACK (uncomment to reverse; nothing reads this column, so a drop is safe) --------------
-- drop index if exists public.site_elements_assembly_idx;
-- alter table public.site_elements drop column if exists assembly_id;
