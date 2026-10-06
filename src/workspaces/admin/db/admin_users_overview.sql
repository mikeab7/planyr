-- Admin Users section (B2125600-series, NEW-3): who has signed up and who is using it.
-- Idempotent. Applied to project lyeqzkuiwngunutlkkmi via the Supabase MCP (migration
-- `admin_users_overview_20261005`). SECURITY DEFINER, public.is_admin() FIRST, fails closed (raises 42501) — never a
-- SELECT policy. COUNTS AND DATES ONLY: never plan / project / file / review content (CLAUDE.md KEY DECISION).

create or replace function public.admin_users_overview()
returns jsonb
language plpgsql security definer set search_path = public, auth stable
as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(a order by a.last_activity desc nulls last, a.created_at desc), '[]'::jsonb) into r from (
    select u.id, u.email, u.created_at, u.last_sign_in_at, u.email_confirmed_at,
           coalesce(u.raw_app_meta_data->>'provider', 'email') as provider,
           nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') as name,
           nullif(p.org, '') as org,
           (select t.name from public.team_members m join public.teams t on t.id = m.team_id where m.user_id = u.id order by m.added_at limit 1) as team,
           (select m.role from public.team_members m where m.user_id = u.id order by m.added_at limit 1) as team_role,
           (select count(distinct coalesce(s.group_id::text, s.id::text)) from public.sites s where s.user_id = u.id and s.deleted_at is null) as projects,
           (select count(*) from public.sites s where s.user_id = u.id and s.deleted_at is null) as plans,
           (select count(*) from public.drive_files f where f.user_id = u.id) as files,
           (select count(*) from public.doc_reviews d where d.user_id = u.id and d.deleted_at is null) as reviews,
           (select count(*) from public.schedules c where c.user_id = u.id and c.deleted_at is null) as schedules,
           greatest(
             (select max(s.updated_at) from public.sites s where s.user_id = u.id),
             (select max(d.updated_at) from public.doc_reviews d where d.user_id = u.id),
             (select max(c.updated_at) from public.schedules c where c.user_id = u.id),
             (select max(f.updated_at) from public.drive_files f where f.user_id = u.id)
           ) as last_activity
    from auth.users u left join public.profiles p on p.id = u.id
    order by u.created_at desc
    limit 1000
  ) a;
  return r;
end;
$$;
revoke all on function public.admin_users_overview() from public, anon;
grant execute on function public.admin_users_overview() to authenticated;

-- One account's last 10 edit dates per kind of thing they own. DATES ONLY — no titles, no content.
create or replace function public.admin_user_activity(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public stable
as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return jsonb_build_object(
    'plans',     coalesce((select jsonb_agg(x.at) from (select updated_at as at from public.sites where user_id = p_user and deleted_at is null order by updated_at desc limit 10) x), '[]'::jsonb),
    'reviews',   coalesce((select jsonb_agg(x.at) from (select updated_at as at from public.doc_reviews where user_id = p_user and deleted_at is null order by updated_at desc limit 10) x), '[]'::jsonb),
    'schedules', coalesce((select jsonb_agg(x.at) from (select updated_at as at from public.schedules where user_id = p_user and deleted_at is null order by updated_at desc limit 10) x), '[]'::jsonb),
    'files',     coalesce((select jsonb_agg(x.at) from (select updated_at as at from public.drive_files where user_id = p_user order by updated_at desc limit 10) x), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_user_activity(uuid) from public, anon;
grant execute on function public.admin_user_activity(uuid) to authenticated;

-- Issues: raise the group cap (a 90-day window passed the old 200 and silently dropped the tail).
create or replace function public.admin_error_groups(p_kind text default 'error', p_days int default 30)
returns table (
  kind text, source text, module text, message text, occurrences bigint, accounts bigint,
  first_seen timestamptz, last_seen timestamptz, last_build text, builds bigint
)
language sql security definer set search_path = public stable
as $$
  select e.kind, e.source, max(e.module) as module, left(coalesce(e.message, ''), 300) as message,
         count(*) as occurrences, count(distinct e.user_id) as accounts,
         min(e.at) as first_seen, max(e.at) as last_seen,
         (array_agg(e.build order by e.at desc))[1] as last_build,
         count(distinct e.build) as builds
  from public.client_errors e
  where public.is_admin()
    and e.kind = p_kind
    and e.at > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365))
  group by e.kind, e.source, left(coalesce(e.message, ''), 300)
  order by max(e.at) desc
  limit 1000;
$$;
