-- Admin page panels (B711905 Usage · B711906 Issues · B711907 Support · B711908 Ops).
-- Idempotent. Applied to project lyeqzkuiwngunutlkkmi via the Supabase MCP (migration name
-- `admin_panels_20261005`). Every function is SECURITY DEFINER, checks public.is_admin() FIRST and
-- returns nothing / raises for a non-admin (fails closed) — never a SELECT policy on a table.
-- client_errors keeps its single INSERT policy; admin_users keeps zero policies.
-- Usage returns COUNTS and DATES only — never plan / project / file content (CLAUDE.md KEY DECISION).

-- ── Support: ticket state on the existing problem_reports (no second feedback path) ─────────────
alter table public.problem_reports add column if not exists status text not null default 'open';
alter table public.problem_reports add column if not exists closed_at timestamptz;
alter table public.problem_reports drop constraint if exists problem_reports_status_valid;
alter table public.problem_reports add constraint problem_reports_status_valid check (status in ('open', 'closed'));

-- Same rows as admin_list_problem_reports() plus ticket state. A NEW function rather than a change to
-- the old one: replacing its return type needs a DROP, which hung against the live database.
create or replace function public.admin_list_support_reports()
returns table (
  id uuid, at timestamptz, user_id uuid, user_email text, session_id text, category text,
  description text, context jsonb, build text, route text, status text, closed_at timestamptz
)
language sql security definer set search_path = public stable
as $$
  select id, at, user_id, user_email, session_id, category, description, context, build, route, status, closed_at
  from public.problem_reports
  where public.is_admin()
  order by (status = 'open') desc, at desc
  limit 500;
$$;
revoke all on function public.admin_list_support_reports() from public, anon;
grant execute on function public.admin_list_support_reports() to authenticated;

create or replace function public.admin_set_report_status(p_id uuid, p_status text)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_status not in ('open', 'closed') then raise exception 'bad status'; end if;
  update public.problem_reports
     set status = p_status, closed_at = case when p_status = 'closed' then now() else null end
   where id = p_id;
  return found;
end;
$$;
revoke all on function public.admin_set_report_status(uuid, text) from public, anon;
grant execute on function public.admin_set_report_status(uuid, text) to authenticated;

-- The reporter's recent errors, attached at READ time so a ticket arrives with context.
create or replace function public.admin_recent_errors_for_user(p_user uuid, p_limit int default 15)
returns table (id uuid, at timestamptz, build text, module text, source text, message text)
language sql security definer set search_path = public stable
as $$
  select id, at, build, module, source, left(message, 400)
  from public.client_errors
  where public.is_admin() and user_id = p_user and kind = 'error'
  order by at desc
  limit least(greatest(coalesce(p_limit, 15), 1), 50);
$$;
revoke all on function public.admin_recent_errors_for_user(uuid, int) from public, anon;
grant execute on function public.admin_recent_errors_for_user(uuid, int) to authenticated;

-- ── Issues: client_errors grouped by message ─────────────────────────────────────────────────────
-- p_kind: 'error' | 'event' | 'timing'. Newest-first by last_seen. Capped at 200 groups.
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
  limit 200;
$$;
revoke all on function public.admin_error_groups(text, int) from public, anon;
grant execute on function public.admin_error_groups(text, int) to authenticated;

-- One group's recent rows (the group key is source + message prefix, same as above).
create or replace function public.admin_error_group_rows(p_kind text, p_source text, p_message text, p_limit int default 25)
returns table (id uuid, at timestamptz, user_id uuid, build text, module text, url text, user_agent text, stack text)
language sql security definer set search_path = public stable
as $$
  select e.id, e.at, e.user_id, e.build, e.module, e.url, e.user_agent, left(e.stack, 4000)
  from public.client_errors e
  where public.is_admin()
    and e.kind = p_kind and e.source is not distinct from p_source
    and left(coalesce(e.message, ''), 300) = coalesce(p_message, '')
  order by e.at desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
$$;
revoke all on function public.admin_error_group_rows(text, text, text, int) from public, anon;
grant execute on function public.admin_error_group_rows(text, text, text, int) to authenticated;

-- ── Usage: counts + dates only, from data the DB already has ─────────────────────────────────────
create or replace function public.admin_usage_overview()
returns jsonb
language plpgsql security definer set search_path = public, auth stable
as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  select jsonb_build_object(
    'generated_at', now(),
    'totals', jsonb_build_object(
      'accounts',        (select count(*) from auth.users),
      'active_7d',       (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
      'active_30d',      (select count(*) from auth.users where last_sign_in_at > now() - interval '30 days'),
      'projects',        (select count(distinct coalesce(group_id::text, id::text)) from public.sites where deleted_at is null),
      'plans',           (select count(*) from public.sites where deleted_at is null),
      'reviews',         (select count(*) from public.doc_reviews where deleted_at is null),
      'files',           (select count(*) from public.drive_files),
      'schedules',       (select count(*) from public.schedules where deleted_at is null),
      'teams',           (select count(*) from public.teams),
      'team_members',    (select count(*) from public.team_members),
      'pending_invites', (select count(*) from public.team_invites where claimed_at is null)
    ),
    'weekly', coalesce((
      select jsonb_agg(jsonb_build_object(
               'week', to_char(w.wk, 'YYYY-MM-DD'),
               'signups',       (select count(*) from auth.users u where u.created_at >= w.wk and u.created_at < w.wk + interval '7 days'),
               'plans_created', (select count(*) from public.sites s where s.created_at >= w.wk and s.created_at < w.wk + interval '7 days'),
               'plans_edited',  (select count(*) from public.sites s where s.deleted_at is null and s.updated_at >= w.wk and s.updated_at < w.wk + interval '7 days')
             ) order by w.wk)
      from (select generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') as wk) w
    ), '[]'::jsonb),
    'accounts', coalesce((
      select jsonb_agg(a order by a.last_sign_in_at desc nulls last) from (
        select u.id, u.email, u.created_at, u.last_sign_in_at,
               (select count(*) from public.sites s where s.user_id = u.id and s.deleted_at is null) as plans,
               (select count(distinct coalesce(s.group_id::text, s.id::text)) from public.sites s where s.user_id = u.id and s.deleted_at is null) as projects,
               (select count(*) from public.drive_files f where f.user_id = u.id) as files,
               (select max(s.updated_at) from public.sites s where s.user_id = u.id) as last_plan_edit
        from auth.users u order by u.last_sign_in_at desc nulls last limit 200
      ) a
    ), '[]'::jsonb)
  ) into r;
  return r;
end;
$$;
revoke all on function public.admin_usage_overview() from public, anon;
grant execute on function public.admin_usage_overview() to authenticated;

-- ── Ops: a snapshot of outstanding work + a session-sweep log, both read/written only by admins ──
create table if not exists public.ops_snapshots (
  key        text        primary key,           -- 'backlog' | 'verification'
  payload    jsonb       not null,
  updated_at timestamptz not null default now()
);
alter table public.ops_snapshots enable row level security;   -- zero policies, like admin_users

create table if not exists public.ops_session_sweeps (
  id       uuid        primary key default gen_random_uuid(),
  at       timestamptz not null default now(),
  archived int         not null default 0,
  still_open jsonb     not null default '[]'::jsonb,  -- [{title, waiting_on}]
  note     text
);
alter table public.ops_session_sweeps enable row level security;  -- zero policies

create or replace function public.admin_get_ops()
returns jsonb
language plpgsql security definer set search_path = public stable
as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return jsonb_build_object(
    'snapshots', coalesce((select jsonb_object_agg(key, jsonb_build_object('payload', payload, 'updated_at', updated_at)) from public.ops_snapshots), '{}'::jsonb),
    'sweeps', coalesce((select jsonb_agg(s order by s.at desc) from (select * from public.ops_session_sweeps order by at desc limit 12) s), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_get_ops() from public, anon;
grant execute on function public.admin_get_ops() to authenticated;

create or replace function public.admin_set_ops_snapshot(p_key text, p_payload jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_key not in ('backlog', 'verification') then raise exception 'bad key'; end if;
  insert into public.ops_snapshots(key, payload, updated_at) values (p_key, p_payload, now())
  on conflict (key) do update set payload = excluded.payload, updated_at = now();
end;
$$;
revoke all on function public.admin_set_ops_snapshot(text, jsonb) from public, anon;
grant execute on function public.admin_set_ops_snapshot(text, jsonb) to authenticated;

create or replace function public.admin_record_session_sweep(p_archived int, p_still_open jsonb, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v uuid;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  insert into public.ops_session_sweeps(archived, still_open, note)
  values (greatest(coalesce(p_archived, 0), 0), coalesce(p_still_open, '[]'::jsonb), p_note)
  returning id into v;
  return v;
end;
$$;
revoke all on function public.admin_record_session_sweep(int, jsonb, text) from public, anon;
grant execute on function public.admin_record_session_sweep(int, jsonb, text) to authenticated;
