-- "Request criteria for this county" (B877440/B877441) — public.criteria_requests
-- Run ONCE in the Supabase SQL editor. Idempotent (safe to re-run). Mirrors the
-- client_errors.sql / admin_users.sql migration style.
--
-- When a plan's county has no detention / easement / pond criteria on file, the app shows an
-- honest "no data available" state instead of a fabricated Houston-derived number, with ONE
-- action: file a request Michael can see and act on from the admin page (B877442). This table
-- is that request queue. The useful payload is the COUNTY, not the person — user_id rides along
-- only so a signed-in user's own repeat click can be recognised as a duplicate, never displayed.

create table if not exists public.criteria_requests (
  id           uuid        primary key default gen_random_uuid(),
  at           timestamptz not null default now(),
  user_id      uuid        default auth.uid(),  -- null for anonymous / pre-login requests
  site_id      text,                            -- the plan id, best-effort (nullable — a request
                                                 -- is about the COUNTY, not tied to one plan)
  county_key   text        not null,            -- normalised county routing key (shared/gis/countyKeys.js)
  county_label text,                            -- display name at request time, e.g. "Tarrant County"
  state        text,                            -- "TX" | "CO" | null
  family       text        not null             -- which criteria family was asked for
    check (family in ('detention', 'easement', 'pond', 'floodplain'))
);

alter table public.criteria_requests enable row level security;

-- INSERT-only for everyone (anon + authenticated) — same discipline as client_errors (B279):
-- no SELECT/UPDATE/DELETE policy, so a client can FILE a request but never read the queue back
-- (no cross-user visibility, no read hole). Admin reads via admin_list_criteria_requests() below,
-- a SECURITY DEFINER RPC gated on is_admin() (admin_users.sql's pattern) — never a client policy.
drop policy if exists "anyone can request criteria" on public.criteria_requests;
create policy "anyone can request criteria"
  on public.criteria_requests
  for insert
  to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));

-- One request per (signed-in user, county, family) — a second click reports a duplicate via the
-- unique-violation the client already checks for (23505), rather than filing a second row. Left
-- unconstrained for anonymous requests (user_id null; Postgres treats each NULL as distinct), which
-- is an acceptable low-stakes duplicate given this is a request queue, not billing.
create unique index if not exists criteria_requests_user_county_family_uniq
  on public.criteria_requests (user_id, county_key, family)
  where user_id is not null;

create index if not exists criteria_requests_at_idx on public.criteria_requests (at desc);
create index if not exists criteria_requests_county_idx on public.criteria_requests (county_key, family);

-- The admin read path (B877442) — mirrors admin_users.sql: a SECURITY DEFINER function that
-- checks is_admin() internally and returns nothing to a non-admin caller, rather than a SELECT
-- policy on the table itself. One row per (county, family): request count, state, first/last
-- asked. "Wired" (criteria have since landed) is decided by the ADMIN APP, not this function —
-- it has no way to know what DETENTION_CRITERIA/DEFAULT_EASEMENT_RULES/DEFAULT_POND_CRITERIA
-- carry in a given deploy, so it reports the raw queue and lets the page cross-reference it
-- against the modeled-jurisdiction keys it already ships with.
create or replace function public.admin_list_criteria_requests()
returns table (
  county_key text,
  county_label text,
  state text,
  family text,
  request_count bigint,
  first_asked timestamptz,
  last_asked timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    county_key,
    -- most recent non-null label wins, in case an early request predates a label fix
    (array_agg(county_label order by at desc) filter (where county_label is not null))[1] as county_label,
    (array_agg(state order by at desc) filter (where state is not null))[1] as state,
    family,
    count(*) as request_count,
    min(at) as first_asked,
    max(at) as last_asked
  from public.criteria_requests
  where public.is_admin()
  group by county_key, family
  order by count(*) desc, max(at) desc;
$$;

revoke all on function public.admin_list_criteria_requests() from public;
grant execute on function public.admin_list_criteria_requests() to authenticated;
