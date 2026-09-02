-- NEW-3 write-back reconciliation (B1037954 follow-up) — converge a site group's name across
-- EVERY row, including soft-deleted (binned) ones. Run ONCE in the Supabase SQL editor.
-- Idempotent; safe to re-run. ADDITIVE: adds a function, changes no table, no column and no policy.
--
-- WHY THIS IS A SEPARATE FUNCTION FROM rename_site_group()
-- rename_site_group() (db/rename_site_group.sql) is the INTERACTIVE rename a signed-in user
-- triggers from the app, and it deliberately excludes soft-deleted rows (`s.deleted_at is null`)
-- — an ordinary user-initiated rename has no business reaching into that user's trash, and that
-- stays correct and unchanged.
--
-- RECONCILIATION is a different operation, run by an operator/audit script, not the app: it
-- converges a group's rows onto its already-decided authoritative name (projectName.js's
-- nameAuthority — the newest siteRenamedAt stamp wins, majority is legacy-only for unstamped
-- groups, and an ambiguous group is never guessed at), including any soft-deleted sibling.
-- Excluding deleted rows is exactly what let a stale name sit invisibly on a binned row for
-- weeks: group smsrpaiqu5sv's own anchor row (id == groupId) was soft-deleted ~60s before the
-- rename that corrected its nine live siblings (confirmed live: only 6 of the group's 10 rows
-- match rename_site_group()'s own `deleted_at is null` predicate today), so every later
-- successful rename correctly — per rename_site_group's own contract — skipped it, and a plain
-- `group by data->>'site'` count over ALL rows (no deleted_at filter) kept reading the group as
-- split indefinitely. Reconciliation exists to close exactly that gap; the ordinary rename path
-- is untouched and still refuses to touch a user's trash.
--
-- SECURITY
--   • SECURITY INVOKER, same as rename_site_group — no new RLS bypass is introduced.
--   • NOT granted to `authenticated` — there is no legitimate reason a signed-in user's own
--     browser session should ever rename a row it cannot even see (a tombstoned one). Reachable
--     only by a service-role-authenticated caller (the audit/reconciliation script), never by the
--     client bundle.
--   • `search_path` is pinned, same reasoning as rename_site_group.
--   • Touches ONLY `site`, `data`, `version` and `updated_at` — never `deleted_at`, `team_id` or
--     `user_id`. It does not un-delete anything; a healed row stays exactly as deleted as it was.
--
-- GROUP MATCHING — identical to rename_site_group: `coalesce(data->>'groupId', id)`, never the
-- `group_id` column mirror, which is known to drift from the jsonb.

create or replace function public.reconcile_site_group_name(
  p_group_id   text,
  p_site       text,
  p_renamed_at bigint
)
returns table (id text, version integer, deleted boolean)
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$
  update public.sites s
     set site       = p_site,
         data       = jsonb_set(
                        jsonb_set(coalesce(s.data, '{}'::jsonb), '{site}', to_jsonb(p_site), true),
                        '{siteRenamedAt}', to_jsonb(p_renamed_at), true),
         version    = coalesce(s.version, 1) + 1,
         updated_at = now()
   where coalesce(s.data->>'groupId', s.id) = p_group_id
  returning s.id, s.version, (s.deleted_at is not null) as deleted;
$$;

comment on function public.reconcile_site_group_name(text, text, bigint) is
  'Converge every row in a site group (including soft-deleted) onto one authoritative name/stamp. '
  'SECURITY INVOKER. Not granted to authenticated — service-role/admin reconciliation use only.';

grant execute on function public.reconcile_site_group_name(text, text, bigint) to service_role;
