-- Problem / "something was slow" reports (B842866) — public.problem_reports
-- Run ONCE in the Supabase SQL editor. Idempotent (safe to re-run). Mirrors the
-- client_errors.sql / criteria_requests.sql migration style — an owner-reported symptom
-- (STANDING RULE #2) needs a write path that works even for a signed-out or half-broken
-- session, so this is INSERT-only under RLS with no client SELECT policy.
--
-- Filed from the global "help / report a problem" control in the app shell (every route,
-- including the map screen, where the always-on performance recorder previously had no
-- reachable manual trigger). Two categories: 'problem' (a free-text bug report) and
-- 'slow' ("something was slow just now" — pairs with a performance-recorder capture in
-- client_errors, correlated by `at`/`build`/`context->>'route'`, never duplicated here).

create table if not exists public.problem_reports (
  id          uuid        primary key default gen_random_uuid(),
  at          timestamptz not null default now(),
  user_id     uuid        default auth.uid(),  -- null for anonymous / signed-out reports
  user_email  text,                            -- denormalised at submit time (own session only —
                                                -- never looked up), so the admin list needs no join
                                                -- against auth.users
  session_id  text,                            -- client-generated id, for a signed-out reporter's
                                                -- own repeat visits; not a security boundary
  category    text        not null check (category in ('problem', 'slow')),
  description text,                            -- free text the user typed; null for a bare "slow" tap
  context     jsonb,                           -- route/module/build/viewport/browser/plan(sanitised)/
                                                -- layers — the same allowlist discipline as the perf
                                                -- recorder's capture payload; never drawing geometry,
                                                -- addresses or owner names
  build       text,                            -- build identifier (git short SHA), denormalised for
                                                -- a quick filter without unpacking context
  route       text                             -- workspace id at submit time, denormalised likewise
);

alter table public.problem_reports enable row level security;

-- INSERT-only for everyone (anon + authenticated) — same discipline as client_errors (B279)
-- and criteria_requests (B877440): no SELECT/UPDATE/DELETE policy, so a client can FILE a
-- report but never read the table back (no cross-user visibility, no read hole — not even
-- for the reporter's own other rows). Admin reads via admin_list_problem_reports() below.
drop policy if exists "anyone can file a problem report" on public.problem_reports;
create policy "anyone can file a problem report"
  on public.problem_reports
  for insert
  to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));

create index if not exists problem_reports_at_idx on public.problem_reports (at desc);

-- The admin read path — mirrors admin_users.sql / criteria_requests.sql: a SECURITY DEFINER
-- function that checks is_admin() internally and returns nothing to a non-admin caller,
-- rather than a SELECT policy on the table itself. Capped at 500 rows (most recent first) —
-- a triage list, not a full export.
create or replace function public.admin_list_problem_reports()
returns table (
  id          uuid,
  at          timestamptz,
  user_id     uuid,
  user_email  text,
  session_id  text,
  category    text,
  description text,
  context     jsonb,
  build       text,
  route       text
)
language sql
security definer
set search_path = public
stable
as $$
  select id, at, user_id, user_email, session_id, category, description, context, build, route
  from public.problem_reports
  where public.is_admin()
  order by at desc
  limit 500;
$$;

revoke all on function public.admin_list_problem_reports() from public, anon;
grant execute on function public.admin_list_problem_reports() to authenticated;
