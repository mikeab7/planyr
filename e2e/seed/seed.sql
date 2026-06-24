-- B280 — seed the e2e fixture project for the Playwright harness (B278).
--
-- Run this in the Supabase SQL editor of the LIVE project (planyr-production,
-- ref lyeqzkuiwngunutlkkmi) AFTER you've created the auth user e2e@planyr.test
-- (Authentication → Users → Add user — set a password; that password is E2E_PASSWORD).
--
-- It files one fixture site owned by that user, with a known 500 ft × 400 ft parcel
-- (= 200,000 sf ≈ 4.59 ac) so the measure assertions have a fixed expected value.
-- Idempotent: re-running replaces the fixture in place, never duplicates it. RLS is
-- untouched — this writes a normal own-row into public.sites, exactly like the app would.
--
-- NOTE (why delete-then-insert, not ON CONFLICT): an earlier version upserted with
-- `on conflict (user_id, id)`, which failed on the live DB with 42P10 ("no unique or
-- exclusion constraint matching the ON CONFLICT specification") — the live public.sites
-- primary key is NOT the (user_id, id) pair the docs claim. This form needs no constraint
-- target, so it works regardless of the real PK and stays idempotent. The delete is scoped
-- to the fixture id + the e2e user, so it can never touch real customer data. See
-- HANDOFF-onconflict.md in this folder for the full diagnosis.

-- 1) Clear any prior fixture row for this user (scoped — cannot hit real data).
with u as (
  select id from auth.users where email = 'e2e@planyr.test'
)
delete from public.sites
where id = 'e2e-fixture-site'
  and user_id in (select id from u);

-- 2) Insert the fixture fresh.
with u as (
  select id from auth.users where email = 'e2e@planyr.test'
)
insert into public.sites (id, user_id, group_id, site, name, county, data)
select
  'e2e-fixture-site',
  u.id,
  'e2e-fixture',
  'E2E Fixture',
  'E2E Fixture — Markup Harness',
  'Harris',
  jsonb_build_object(
    'schemaVersion', 2,
    'id',      'e2e-fixture-site',
    'groupId', 'e2e-fixture',
    'site',    'E2E Fixture',
    'name',    'E2E Fixture — Markup Harness',
    'county',  'Harris',
    'status',  'active',
    'origin',  jsonb_build_object('lat', 29.76, 'lon', -95.37),
    'parcels', jsonb_build_array(
      jsonb_build_object(
        'id', 'e2e-parcel',
        'locked', false,
        'points', jsonb_build_array(
          jsonb_build_object('x', -250, 'y', -200),
          jsonb_build_object('x',  250, 'y', -200),
          jsonb_build_object('x',  250, 'y',  200),
          jsonb_build_object('x', -250, 'y',  200)
        )
      )
    ),
    'els',      '[]'::jsonb,
    'markups',  '[]'::jsonb,
    'measures', '[]'::jsonb,
    'callouts', '[]'::jsonb
  )
from u;

-- Sanity check — this SELECT should return exactly one row. If it returns ZERO,
-- the auth user e2e@planyr.test doesn't exist yet: create it first, then re-run.
select s.id, s.user_id, s.name, s.county
from public.sites s
join auth.users u on u.id = s.user_id
where u.email = 'e2e@planyr.test' and s.id = 'e2e-fixture-site';
