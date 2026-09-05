-- Server-side signup volume cap (B1160721, NEW-2) — run ONCE in the Supabase SQL editor
-- (project lyeqzkuiwngunutlkkmi), idempotent, safe to re-run.
--
-- The owner's concern, verbatim: someone trying a thousand signups to crash it. Turnstile
-- (B1160720) stops bots that can't solve a challenge; this is the backstop for volume that
-- gets through anyway (a human clicking fast, a script that DOES solve the challenge, or
-- Turnstile itself being unreachable/misconfigured). It is enforced with a Postgres
-- trigger on auth.users, so no client — browser, curl, or a compromised build — can bypass
-- it; the only way to create a row in auth.users at all is through this trigger.
--
-- DEFAULTS: 20 signups/hour, 100/day. Reasoning: this project has 8 lifetime accounts over
-- ~3 months, so anything past a couple of dozen an hour is already far outside organic
-- growth for this product; 20/hour and 100/day both give a wide margin over any realistic
-- launch day (a demo to a room of people, a broker forwarding the link to a team) while
-- capping a script at roughly 2,400 accounts/day even if it evades Turnstile entirely —
-- down from unbounded. Both numbers are config, not code (see the toggle below).
--
-- SAFETY (non-negotiable, per the owner's own words):
--   - Reversible with ONE SQL statement: `update public.signup_rate_limit_config set
--     enabled = false where id = true;` immediately stops all enforcement, no deploy.
--   - FAILS OPEN: if the config row is missing, or reading/counting itself throws for any
--     reason, the trigger returns NEW (allows the insert) rather than blocking. A bug in
--     this trigger can therefore never brick signups the way a fail-closed design could.
--   - Only touches auth.users INSERT (account CREATION). It never runs on sign-in, token
--     refresh, or any existing account, so an already-registered user — Michael included —
--     can never be locked OUT by this; the worst case is a NEW account can't be created
--     until the next hour/day rolls over or an admin raises/disables the cap.

create table if not exists public.signup_rate_limit_config (
  id             boolean     primary key default true,
  enabled        boolean     not null default true,
  per_hour_limit int         not null default 20,
  per_day_limit  int         not null default 100,
  updated_at     timestamptz not null default now(),
  constraint signup_rate_limit_config_singleton check (id)
);
insert into public.signup_rate_limit_config (id) values (true) on conflict (id) do nothing;

alter table public.signup_rate_limit_config enable row level security;
-- Deliberately zero policies — same discipline as admin_users.sql: no role can read or
-- write this via PostgREST/supabase-js. Change it via the SQL editor (service role) only.
-- (The one-statement UPDATE above still works there — "no client write" is not "no write".)

-- Attempt log (timestamp, email DOMAIN only, outcome) — "so a flood is visible after the
-- fact rather than invisible." Never the full email address, for either outcome, on
-- purpose — a domain is enough to spot a flood ("500 rows from mailinator.com in an hour")
-- without holding a list of who tried and failed.
--
-- ⛔ ONLY 'created' rows are ever written FROM THIS TRIGGER, and that is a hard Postgres
-- constraint, not an oversight: a BEFORE INSERT trigger that RAISEs to abort the insert
-- runs inside the SAME statement/transaction it is blocking, so any row this trigger wrote
-- earlier in that same invocation is rolled back right along with it — there is no
-- autonomous-transaction primitive in plain plpgsql to write a log entry that survives an
-- abort it is itself part of (dblink/pg_background can do it, but need credentials or add
-- real per-signup latency/risk this backstop feature doesn't warrant). So "created" volume
-- is authoritative here; visibility into BLOCKED attempts comes from two other places
-- instead: the browser-driven path logs a 'signup-rate-limited' event to the existing
-- client_errors table (src/workspaces/site-planner/lib/auth.js), and any attempt — browser
-- or a direct API call that skips the app entirely — still shows up in Supabase's own
-- Auth/Postgres logs (dashboard → Logs), which is unaffected by this transactional limit.
-- The 'rate_limited' value stays in the CHECK for forward compatibility (a future direct
-- SQL mark, or a different enforcement point) even though this trigger cannot use it.
create table if not exists public.signup_attempts_log (
  id           bigint      generated always as identity primary key,
  at           timestamptz not null default now(),
  email_domain text,
  outcome      text        not null check (outcome in ('created', 'rate_limited'))
);
alter table public.signup_attempts_log enable row level security;
-- Zero client policies too — written only by the SECURITY DEFINER trigger below, read only
-- through admin_list_signup_attempts() (is_admin()-gated), same shape as client_errors /
-- problem_reports' "insert via a definer path, read via a definer RPC" pattern.
create index if not exists signup_attempts_log_at_idx on public.signup_attempts_log (at desc);

create or replace function public.enforce_signup_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  cfg        record;
  hour_count int;
  day_count  int;
  domain     text;
begin
  domain := nullif(split_part(coalesce(new.email, ''), '@', 2), '');

  -- FAIL OPEN: a broken config read must never block a real signup.
  begin
    select * into cfg from public.signup_rate_limit_config where id = true;
  exception when others then
    return new;
  end;

  if cfg is null or cfg.enabled is not true then
    return new;
  end if;

  begin
    select count(*) into hour_count from auth.users where created_at > now() - interval '1 hour';
    select count(*) into day_count  from auth.users where created_at > now() - interval '1 day';
  exception when others then
    return new; -- FAIL OPEN on any counting error too
  end;

  if hour_count >= cfg.per_hour_limit or day_count >= cfg.per_day_limit then
    -- Deliberately no log write here — see the table comment above for why a row inserted
    -- in this branch could never survive the RAISE that follows it in the same statement.
    raise exception 'Too many accounts have been created recently. Please try again later.'
      using errcode = 'P0001';
  end if;

  insert into public.signup_attempts_log (email_domain, outcome) values (domain, 'created');
  return new;
end;
$$;

drop trigger if exists trg_enforce_signup_rate_limit on auth.users;
create trigger trg_enforce_signup_rate_limit
  before insert on auth.users
  for each row execute function public.enforce_signup_rate_limit();

-- Admin visibility — same shape as admin_list_problem_reports(): a SECURITY DEFINER
-- function gated on is_admin() internally, never a client SELECT policy on the table.
create or replace function public.admin_list_signup_attempts(p_limit int default 200)
returns table (at timestamptz, email_domain text, outcome text)
language sql
security definer
set search_path = public
stable
as $$
  select at, email_domain, outcome
  from public.signup_attempts_log
  where public.is_admin()
  order by at desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;
revoke all on function public.admin_list_signup_attempts(int) from public;
grant execute on function public.admin_list_signup_attempts(int) to authenticated;
