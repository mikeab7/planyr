-- backfill_group_id_column.sql — NEW-3 (2026-09-12 owner review, "too many sources of truth").
-- Converge the `group_id` COLUMN back onto its jsonb source of truth, `coalesce(data->>'groupId',
-- id)`, for one row. Run ONCE in the Supabase SQL editor. Idempotent; safe to re-run. ADDITIVE:
-- adds one function, changes no table, no column and no policy.
--
-- WHY THIS EXISTS
-- `group_id` is a denormalized mirror of `data->>'groupId'`. Every RPC that decides which rows
-- belong to a project (`rename_site_group`, `reconcile_site_group_name`, `set_project_team_state`)
-- already keys on the jsonb, never the column — those files' own headers say the column is "known
-- to drift" and must not be matched on. This function is the backfill half of that same rule: it
-- converges the COLUMN back onto the jsonb for one named row, so a client-side resolver that still
-- reads the column (there are several in storage.js/cloudSync.js — see
-- scripts/audit-name-group-integrity.mjs) gets the right answer without first having to be
-- rewritten. It writes ONLY `group_id`; it never touches `data`, `site`, `version` or `updated_at`.
--
-- MEASURED DRIFT (2026-09-12, read-only query against planyr_production): exactly one row in the
-- whole account, `e2e-fixture-testfit` — a seeded e2e test fixture, not owner data — where
-- `group_id='e2e-fixture'` disagrees with `data->>'groupId'='e2e-fixture-testfit'` (a typo in
-- e2e/seed/seed-fixtures.sql, fixed alongside this migration). Every one of the owner's own 34 real
-- project groups already agrees (B366386's own sweep, unaffected by this file).
--
-- SECURITY
--   • SECURITY INVOKER — existing RLS on public.sites decides what the caller may update. No new
--     surface: a caller can only ever backfill a row they could already UPDATE directly.
--   • NOT granted to `authenticated` — a signed-in user's own browser has no legitimate reason to
--     correct this bookkeeping column itself; it is operator/reconciliation tooling only, reachable
--     by a service-role caller (`scripts/audit-name-group-integrity.mjs --fix`), same shape as
--     `reconcile_site_group_name()`.
--   • `search_path` is pinned, same reasoning as every sibling function in this folder.
--
-- DELIBERATE SCOPE: this backfills `group_id` only. It never touches a `site`/`data.site`
-- disagreement (nameGroupIntegrity.nameMismatch) — see the audit script's own header for why that
-- one is reported, never auto-fixed.

create or replace function public.backfill_group_id_column(p_id text)
returns table (id text, group_id text)
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$
  update public.sites s
     set group_id = coalesce(s.data->>'groupId', s.id)
   where s.id = p_id
     and coalesce(s.group_id, s.id) is distinct from coalesce(s.data->>'groupId', s.id)
  returning s.id, s.group_id;
$$;

comment on function public.backfill_group_id_column(text) is
  'Converge the group_id COLUMN mirror back onto its jsonb source of truth for one row. '
  'SECURITY INVOKER. Not granted to authenticated — service-role reconciliation tooling only.';

grant execute on function public.backfill_group_id_column(text) to service_role;
