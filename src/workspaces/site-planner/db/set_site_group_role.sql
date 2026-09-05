-- B843792 (NEW-1) — flip a site's ROLE (pursuit vs tracked) in ONE atomic statement across the
-- whole group, mirroring db/rename_site_group.sql exactly (same reasoning, same shape). Run ONCE
-- in the Supabase SQL editor. Idempotent; safe to re-run. ADDITIVE: adds a function, changes no
-- table, no column and no policy — `role` lives inside the existing `data` jsonb, the same place
-- `status` already does (see lib/siteStatus.js).
--
-- WHY THIS EXISTS
-- NEW-1's design requires that "a site can be flipped from tracked to pursuit later without
-- re-entering anything" — a REQUIRED outcome, not a nice-to-have. A site's role is denormalized
-- across every plan row in its group exactly like its name is, so a flip that only wrote the rows
-- one local browser happens to have hydrated could leave the group split (some plans "pursuit",
-- some still "tracked") — the same class of bug rename_site_group.sql was built to close for names.
-- This makes a role flip ONE UPDATE over the whole group, so it reaches every plan in the group
-- including ones the calling browser has never loaded, and can never half-land.
--
-- SECURITY
--   • SECURITY INVOKER (the default) — existing RLS on public.sites applies unchanged, so a
--     caller can only ever flip rows they are already permitted to update. No new surface.
--   • `search_path` is pinned, so the function body can't be redirected by a caller's search_path.
--   • It touches ONLY `data`, `version` and `updated_at` — never `team_id`, `user_id` or
--     `deleted_at` (same restraint as rename_site_group.sql, same reasons).
--   • `p_role` is validated against the exact two-value enum lib/siteStatus.js's ROLES exports —
--     an unrecognized role RAISES (below) rather than being silently written or silently matching
--     zero rows, so a caller can tell "bad role" from "no such group" (see NEW-2 below).
--
-- ⛔ B1165441-HARDENING (NEW-2, adversarial review of #1424/#1431) — TWO THINGS SETTLED HERE,
-- BOTH MEASURED AGAINST PRODUCTION, NOT ASSUMED:
--
-- (a) GROUP MATCHING IS SETTLED AS THE JSONB, `coalesce(s.data->>'groupId', s.id)` — NEVER the
-- `group_id` COLUMN — and this was already true of the deployed function; this is the header
-- finally SAYING so, per the report's own ask ("settle it, document it"). The column is a
-- denormalized mirror that is KNOWN TO DRIFT from the jsonb: measured live, `sites` row
-- `e2e-fixture-testfit` carries `group_id = 'e2e-fixture'` (the column) but
-- `data->>'groupId' = 'e2e-fixture-testfit'` (the jsonb, its own id — i.e. it thinks it anchors
-- its OWN group). That's a test fixture, not owner data, so nothing is broken today — but a
-- whole-group role flip keyed on the wrong field would be a SILENT PARTIAL WRITE (some plans
-- flipped, others not, with no error), which is exactly the failure mode rename_site_group.sql's
-- own header already documents this same choice to avoid. `rename_site_group.sql` matches on the
-- identical jsonb expression (confirmed against the live deployed function, 2026-09-05) — the two
-- functions AGREE, and must keep agreeing; do not "optimise" either one onto the column.
-- (b) AN INVALID `p_role` NOW RAISES instead of silently matching zero rows. The old SQL-language
-- function folded `p_role in ('pursuit','tracked')` into the WHERE clause, so a bad role and "no
-- such group" were indistinguishable — a caller had no way to tell them apart. This is now
-- `language plpgsql` (SQL-language functions can't branch/raise) and validates FIRST, raising
-- `errcode = '22023'` (invalid_parameter_value), matching soft_delete_site_plan_overlay.sql's own
-- style (a stated reason + a real errcode, not a bare `RAISE`).
--
-- GROUP MATCHING — `coalesce(data->>'groupId', id)`, exactly what the client's `groupOf()` reads
-- and exactly what rename_site_group.sql matches on (never the `group_id` COLUMN, a denormalized
-- mirror known to drift from the jsonb — see (a) above for the live production evidence).

create or replace function public.set_site_group_role(
  p_group_id text,
  p_role     text
)
returns table (id text, version integer)
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_role is null or p_role not in ('pursuit', 'tracked') then
    raise exception 'Not a valid role — must be "pursuit" or "tracked"' using errcode = '22023';
  end if;

  return query
  update public.sites s
     set data       = jsonb_set(
                         jsonb_set(coalesce(s.data, '{}'::jsonb), '{role}', to_jsonb(p_role), true),
                         '{updatedAt}', to_jsonb((extract(epoch from now()) * 1000)::bigint), true
                       ),
         version    = coalesce(s.version, 1) + 1,
         updated_at = now()
   where coalesce(s.data->>'groupId', s.id) = p_group_id
     and s.deleted_at is null
  returning s.id, s.version;
end;
$$;

comment on function public.set_site_group_role(text, text) is
  'Flip a site''s role (pursuit vs tracked) in one atomic statement across every plan row in its '
  'group. SECURITY INVOKER — existing RLS on public.sites decides what the caller may flip. '
  'Raises errcode 22023 for an unrecognized role.';

grant execute on function public.set_site_group_role(text, text) to authenticated;

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select proname, prokind, provolatile, prosecdef from pg_proc where proname = 'set_site_group_role';
--     -- expect 1 row, prokind='f' (function), prosecdef=false (SECURITY INVOKER)
--   select pg_get_functiondef(oid) from pg_proc where proname = 'set_site_group_role';
--     -- expect `language plpgsql` and the `if p_role is null or p_role not in (...)` guard
