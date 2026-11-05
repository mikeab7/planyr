-- Sign-in health (NEW-1, 2026-11-02 — after B2619760, when sign-in was dead for every signed-out person and nothing noticed).
-- Idempotent; run once in the Supabase SQL editor (or via the MCP). Read by NOBODY on the client: the alarm route
-- (functions/api/lib/signinHealthRoute.js) uses the service role. Zero policies on both tables, like admin_users.
--
--   signin_health_checks  one row per run of the hourly outside-in check (scripts/signin-health-check.mjs)
--   signin_incidents      one row per incident — the thing that makes "one incident, one email" true
--   signin_event_counts   the last hour's client-reported auth events, grouped (service role only)
--   client_errors cap     a server-side ceiling on `event:auth-*` inserts (the client's own caps are per page load,
--                         so a script could otherwise drown the alarm's signal)

create table if not exists public.signin_health_checks (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  overall    text        not null check (overall in ('pass', 'fail', 'unknown')),
  checks     jsonb       not null default '[]'::jsonb,
  run_url    text,
  synthetic  boolean     not null default false   -- the alarm DRILL: kept apart so a test never counts as a real result
);
create index if not exists signin_health_checks_at_idx on public.signin_health_checks (synthetic, at desc);
alter table public.signin_health_checks enable row level security;   -- no policies: service role only
revoke all on public.signin_health_checks from anon, authenticated;

create table if not exists public.signin_incidents (
  id                  uuid        primary key default gen_random_uuid(),
  opened_at           timestamptz not null default now(),
  closed_at           timestamptz,
  kind                text        not null check (kind in ('outside-in', 'client-rate', 'blind')),
  reason              text,
  alert_emailed_at    timestamptz,
  recovery_emailed_at timestamptz,
  synthetic           boolean     not null default false
);
-- At most ONE open incident per (synthetic) lane: the database, not just the code, refuses a second.
create unique index if not exists signin_incidents_one_open on public.signin_incidents (synthetic) where closed_at is null;
alter table public.signin_incidents enable row level security;
revoke all on public.signin_incidents from anon, authenticated;

-- The last p_minutes of client-reported auth events, grouped by source. SECURITY DEFINER only so the service role can
-- call it without a table grant dance; EXECUTE is revoked from everyone but service_role.
create or replace function public.signin_event_counts(p_minutes int default 60)
returns table (source text, n bigint)
language sql security definer set search_path = public as $$
  select ce.source, count(*)::bigint
    from public.client_errors ce
   where ce.source like 'event:auth-%'
     and ce.at > now() - make_interval(mins => greatest(1, least(coalesce(p_minutes, 60), 1440)))
   group by ce.source;
$$;
revoke all on function public.signin_event_counts(int) from public, anon, authenticated;
grant execute on function public.signin_event_counts(int) to service_role;

-- Abuse ceiling on the auth events. client_errors is insert-only for anon (it has to be: an auth failure happens before
-- any session exists), so nothing stops a script posting thousands of rows. This drops an `event:auth-*` row when the
-- same source already has 60 rows in the last minute. FAILS OPEN: any error in here lets the row through, so this can
-- never take error telemetry down. SECURITY DEFINER because anon cannot read the table it counts.
create or replace function public.client_errors_cap_auth_events()
returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if new.source is null or new.source not like 'event:auth-%' then return new; end if;
  begin
    select count(*) into n from public.client_errors where source = new.source and at > now() - interval '1 minute';
    if n >= 60 then return null; end if;
  exception when others then
    return new;
  end;
  return new;
end;
$$;
revoke all on function public.client_errors_cap_auth_events() from public, anon, authenticated;

drop trigger if exists client_errors_cap_auth_events on public.client_errors;
create trigger client_errors_cap_auth_events
  before insert on public.client_errors
  for each row execute function public.client_errors_cap_auth_events();
