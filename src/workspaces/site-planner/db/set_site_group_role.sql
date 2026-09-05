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
--     an unrecognized role is REFUSED (0 rows touched, no error), never silently written, so a
--     client-side typo or a future third role added on one side only cannot corrupt data on the
--     other.
--
-- GROUP MATCHING — `coalesce(data->>'groupId', id)`, exactly what the client's `groupOf()` reads
-- and exactly what rename_site_group.sql matches on (never the `group_id` COLUMN, a denormalized
-- mirror known to drift from the jsonb — see that file's own header for the production evidence).

create or replace function public.set_site_group_role(
  p_group_id text,
  p_role     text
)
returns table (id text, version integer)
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$
  update public.sites s
     set data       = jsonb_set(coalesce(s.data, '{}'::jsonb), '{role}', to_jsonb(p_role), true),
         version    = coalesce(s.version, 1) + 1,
         updated_at = now()
   where coalesce(s.data->>'groupId', s.id) = p_group_id
     and s.deleted_at is null
     and p_role in ('pursuit', 'tracked')
  returning s.id, s.version;
$$;

comment on function public.set_site_group_role(text, text) is
  'Flip a site''s role (pursuit vs tracked) in one atomic statement across every plan row in its '
  'group. SECURITY INVOKER — existing RLS on public.sites decides what the caller may flip.';

grant execute on function public.set_site_group_role(text, text) to authenticated;

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select proname from pg_proc where proname = 'set_site_group_role';  -- expect 1 row
