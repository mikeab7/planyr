-- Sign-in health, the FAST check + the per-source dead-man's switch (NEW-1, 2026-11-04, B2650848).
-- Idempotent and ADDITIVE: it changes nothing the existing hourly runner path reads or writes (the new column defaults to
-- 'runner'), so it is safe to apply BEFORE the code that uses it deploys. Run once in the Supabase SQL editor (or the MCP).
-- Zero client policies, like the rest of signin_health.sql — the Pages Function uses the service role.
--
--   signin_health_checks.source   who made the report: 'runner' (the browser check on GitHub) or 'edge' (the fast check that
--                                 Planyr's own server runs every 15 minutes). Each source keeps its own streak and its own clock.
--   signin_stop_alerts            one row per source that can STOP: `since` is set while it is flagged stopped, `emailed_at` once
--                                 the owner has been told — the thing that makes "a stopped check emails once" true.
--
-- The schedule that calls the fast check is a separate file, signin_health_edge_cron.sql, applied AFTER the route is live.

alter table public.signin_health_checks
  add column if not exists source text not null default 'runner';
alter table public.signin_health_checks drop constraint if exists signin_health_checks_source_check;
alter table public.signin_health_checks
  add constraint signin_health_checks_source_check check (source in ('runner', 'edge'));
create index if not exists signin_health_checks_source_at_idx on public.signin_health_checks (synthetic, source, at desc);

create table if not exists public.signin_stop_alerts (
  source      text        primary key check (source in ('edge', 'runner', 'drill')),   -- 'drill' = the alarm drill's own lane
  since       timestamptz,                                                               -- null = running
  emailed_at  timestamptz,
  cleared_at  timestamptz,
  updated_at  timestamptz not null default now()
);
alter table public.signin_stop_alerts enable row level security;   -- no policies: service role only
revoke all on public.signin_stop_alerts from anon, authenticated;
