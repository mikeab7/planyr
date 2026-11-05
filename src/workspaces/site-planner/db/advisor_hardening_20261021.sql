-- B2404338 (NEW-3, DB hardening block 2026-10-21) — Supabase security advisor, measured 2026-10-19/21.
--
-- (a) `anon_security_definer_function_executable`: 23 SECURITY DEFINER functions could be called signed
--     out via /rest/v1/rpc. The fourteen below are ordinary RPCs with no business being reachable by
--     `anon` — each is safe today only because auth.uid() is NULL for anon, which is one missed
--     `coalesce` away from a hole (set_plan_lock already relies on an explicit null check). Measured ACLs:
--     every one granted EXECUTE to anon, and FOUR (claim_team_invites, list_team_members,
--     can_read_shared_review_file, folder_set_drive_meta) ALSO carried the implicit PUBLIC grant (`=X`),
--     so a bare `revoke … from anon` would have left has_function_privilege('anon', …) TRUE through
--     PUBLIC. Hence: revoke from public AND anon, then re-grant authenticated + service_role explicitly.
--     Measured 2026-10-21: no RLS policy (public or storage) that a `public`/`anon` role can reach calls
--     any of these functions, so nothing signed-out loses a path it had.
--   LEFT ALONE, on purpose:
--     • ops_ingest_snapshots(text, jsonb) — token-gated (sha256 of a secret in ops_ingest_tokens, raises
--       42501 without it) and called SIGNED-OUT by design from scripts/ops-snapshot.mjs with the anon
--       key (read 2026-10-21). Revoking anon would break the ops digest push.
--     • every TRIGGER / EVENT TRIGGER function (handle_new_user, sync_profile_email,
--       guard_overlay_object_release, planar_history_stamp_owner, rls_auto_enable,
--       schedules_clear_plan_hints, sites_cascade_schedules, enforce_signup_rate_limit) — PostgREST cannot
--       call a trigger-returning function ("trigger functions can only be called as triggers", proven in
--       security_definer_ownership_audit.test.sql Case 0), and revoking EXECUTE on one can stop the
--       trigger firing for that role. Not touched without a branch proof that DML by anon and
--       authenticated still fires them.
--     • `SECURITY DEFINER` is NOT changed to INVOKER anywhere — the definer functions ARE the sharing
--       model; the lint's suggestion is wrong for this schema.
-- (b) `function_search_path_mutable`: seven functions with no pinned search_path. Each body was read
--     first: food_places_search_by_name, schedules_decompose_from_planar_data and
--     schedules_recompose_to_planar_data already schema-qualify every reference; planar_data_rev_of,
--     _site_plan_overlay_crop_poly_valid and the two touch_updated_at triggers reference nothing outside
--     pg_catalog. `public, pg_temp` (pg_temp LAST — a temp-schema object can otherwise shadow a public
--     one) is the repo's existing convention (sites_enforce_version_monotonic) and is correct for all.
-- (c) `extension_in_public` (pg_trgm) — DELIBERATELY SKIPPED: relocating an extension that backs the
--     food search trigram index is not worth the risk to that index for a lint; the finding stays.
-- (d) `rls_enabled_no_policy` (21 INFO rows: recovery_* snapshots, admin_users, ops_* …) — by design
--     (zero-policy tables are reachable only through SECURITY DEFINER RPCs); unchanged.
--
-- Idempotent (REVOKE/GRANT/ALTER are all repeatable). Applied to production by the shipping session;
-- before/after advisor counts are on B2404338. Guard: security_definer_ownership_audit.test.sql stays
-- green (it asserts anon cannot reach purge_one_deleted_plan / sites_referencing_storage_key, which are
-- unchanged here).

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.claim_invite_send(uuid, text)',
    'public.claim_team_invites()',
    'public.create_team(text)',
    'public.folder_set_drive_meta(uuid, jsonb)',
    'public.is_admin()',
    'public.is_team_admin(uuid)',
    'public.is_team_member(uuid)',
    'public.list_my_teams()',
    'public.list_team_members(uuid)',
    'public.release_invite_send(uuid, timestamptz)',
    'public.set_plan_lock(text, boolean)',
    'public.set_project_team(text, uuid)',
    'public.set_project_team_state(text, uuid)',
    'public.can_read_shared_review_file(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

alter function public.food_places_search_by_name(text, integer, double precision, double precision)
  set search_path = public, pg_temp;
alter function public.planar_data_rev_of(jsonb)                          set search_path = public, pg_temp;
alter function public.schedule_account_index_touch_updated_at()          set search_path = public, pg_temp;
alter function public.schedules_touch_updated_at()                       set search_path = public, pg_temp;
alter function public.schedules_decompose_from_planar_data()             set search_path = public, pg_temp;
alter function public.schedules_recompose_to_planar_data(uuid)           set search_path = public, pg_temp;
alter function public._site_plan_overlay_crop_poly_valid(jsonb)          set search_path = public, pg_temp;

-- Read-only confirmation (expected: anon_exec = false on all fourteen; proconfig set on all seven):
--   select p.oid::regprocedure, has_function_privilege('anon', p.oid, 'execute') as anon_exec,
--          has_function_privilege('authenticated', p.oid, 'execute') as auth_exec, p.proconfig
--     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (…);
