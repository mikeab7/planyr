-- seed-fixtures.sql — seed the DENSE test-fit fixture for the Playwright harness (B278/B280 amendment).
--
-- Run in the Supabase SQL editor of planyr-production AFTER the e2e@planyr.test auth user exists
-- (same account as e2e/seed/seed.sql). Files one dense synthetic test-fit site (id e2e-fixture-testfit)
-- owned by that user so e2e/site-testfit.spec.js can open it. SYNTHETIC — no real parcel/address.
-- Idempotent + scoped delete-then-insert (cannot touch real data), same pattern + rationale as seed.sql.
-- The data blob is generated from e2e/fixtures/sites/dense-testfit.fixture.json — regenerate that fixture
-- (node scripts/build-fixtures.mjs) and re-emit this file if the fixture bumps.

with u as (select id from auth.users where email = 'e2e@planyr.test')
delete from public.sites
where id = 'e2e-fixture-testfit' and user_id in (select id from u);

with u as (select id from auth.users where email = 'e2e@planyr.test')
insert into public.sites (id, user_id, group_id, site, name, county, data)
select
  'e2e-fixture-testfit',
  u.id,
  'e2e-fixture',
  'E2E Dense Test-Fit',
  'E2E Dense Test-Fit',
  'Harris',
  '{"schemaVersion":10,"id":"e2e-fixture-testfit","groupId":"e2e-fixture-testfit","site":"E2E Dense Test-Fit","name":"E2E Dense Test-Fit","updatedAt":1783000000000,"teamId":null,"ownerId":null,"scheduleProjectId":null,"scheduleProjectName":null,"origin":null,"county":"Harris","status":"active","parcels":[{"id":"e2e-parcel-1","ring":[{"x":0,"y":0},{"x":1320,"y":0},{"x":1320,"y":1320},{"x":0,"y":1320}],"active":true}],"underlay":null,"sheetOverlays":[],"parcelDrawings":[],"settings":{},"els":[{"id":"e2e-bldg-1","type":"building","x":100,"y":100,"w":600,"h":300,"rot":0},{"id":"e2e-dogear-2","type":"building","dogEar":true,"attachedTo":"e2e-bldg-1","x":100,"y":60,"w":90,"h":40,"rot":0},{"id":"e2e-dogear-3","type":"building","dogEar":true,"attachedTo":"e2e-bldg-1","x":220,"y":60,"w":90,"h":40,"rot":0},{"id":"e2e-court-4","type":"truckCourt","forCourt":"e2e-bldg-1","x":100,"y":400,"w":600,"h":185},{"id":"e2e-parking-5","type":"parking","forTrailer":"e2e-bldg-1","x":100,"y":585,"w":600,"h":60,"stalls":50},{"id":"e2e-bldg-6","type":"building","x":800,"y":100,"w":240,"h":160,"rot":0},{"id":"e2e-dogear-7","type":"building","dogEar":true,"attachedTo":"e2e-bldg-6","x":800,"y":60,"w":90,"h":40,"rot":0},{"id":"e2e-dogear-8","type":"building","dogEar":true,"attachedTo":"e2e-bldg-6","x":920,"y":60,"w":90,"h":40,"rot":0},{"id":"e2e-court-9","type":"truckCourt","forCourt":"e2e-bldg-6","x":800,"y":260,"w":240,"h":185},{"id":"e2e-parking-10","type":"parking","forTrailer":"e2e-bldg-6","x":800,"y":445,"w":240,"h":60,"stalls":40},{"id":"e2e-bldg-11","type":"building","x":1500,"y":100,"w":200,"h":120,"rot":0},{"id":"e2e-dogear-12","type":"building","dogEar":true,"attachedTo":"e2e-bldg-11","x":1500,"y":60,"w":90,"h":40,"rot":0},{"id":"e2e-dogear-13","type":"building","dogEar":true,"attachedTo":"e2e-bldg-11","x":1620,"y":60,"w":90,"h":40,"rot":0},{"id":"e2e-court-14","type":"truckCourt","forCourt":"e2e-bldg-11","x":1500,"y":220,"w":200,"h":185},{"id":"e2e-parking-15","type":"parking","forTrailer":"e2e-bldg-11","x":1500,"y":405,"w":200,"h":60,"stalls":48},{"id":"e2e-setback-16","type":"line","x":619,"y":96,"w":0,"h":0},{"id":"e2e-setback-17","type":"line","x":419,"y":723,"w":0,"h":0},{"id":"e2e-setback-18","type":"line","x":114,"y":763,"w":0,"h":0},{"id":"e2e-setback-19","type":"line","x":717,"y":250,"w":0,"h":0},{"id":"e2e-setback-20","type":"line","x":217,"y":964,"w":0,"h":0},{"id":"e2e-setback-21","type":"line","x":1261,"y":843,"w":0,"h":0}],"markups":[{"id":"e2e-mk-22","kind":"polyline","pts":[{"x":0,"y":0},{"x":100,"y":100}]},{"id":"e2e-mk-23","kind":"easement","pts":[{"x":10,"y":10},{"x":200,"y":10}]}],"measures":[{"id":"e2e-meas-24","type":"distance","pts":[{"x":0,"y":0},{"x":300,"y":0}]}],"callouts":[{"id":"e2e-call-25","text":"E2E note","x":50,"y":50}],"deletedIds":["e2e-ghost-1","e2e-ghost-2"],"elevation":{"crossSections":[]},"constraints":{"liveLayers":[]}}'::jsonb
from u;

-- Sanity check — expect exactly one row.
select s.id, s.name, s.county, jsonb_array_length(s.data->'els') as el_count
from public.sites s join auth.users u on u.id = s.user_id
where u.email = 'e2e@planyr.test' and s.id = 'e2e-fixture-testfit';

-- B672 — explode this fixture's element collections into site_elements rows (per-element sync).
-- The planner now READS elements from rows (the blob is a slim-header format post-cutover), so a
-- seeded fixture without rows would open empty. Delete-then-explode, scoped to this fixture id
-- (never touches real data); mirrors db/site_elements_backfill.sql (z = index*1024, rev 1).
delete from public.site_elements where site_id = 'e2e-fixture-testfit';
insert into public.site_elements (site_id, id, kind, data, z_index, rev, updated_at, updated_by)
select s.id, e.value->>'id', k.kind, e.value, (e.ordinality - 1) * 1024, 1, s.updated_at, s.user_id
from public.sites s
cross join (values ('el','els'), ('markup','markups'), ('measure','measures'),
                   ('callout','callouts'), ('parcel','parcels')) as k(kind, field)
cross join lateral jsonb_array_elements(coalesce(s.data->k.field, '[]'::jsonb))
  with ordinality as e(value, ordinality)
where s.id = 'e2e-fixture-testfit' and e.value->>'id' is not null
  and not (coalesce(s.data->'deletedIds', '[]'::jsonb) ? (e.value->>'id'));
insert into public.site_elements (site_id, id, kind, data, z_index, rev, updated_at, updated_by, deleted_at, deleted_by)
select s.id, d.value, 'tombstone', null, 0, 1, s.updated_at, s.user_id, now(), s.user_id
from public.sites s
cross join lateral jsonb_array_elements_text(coalesce(s.data->'deletedIds', '[]'::jsonb)) as d(value)
where s.id = 'e2e-fixture-testfit' and d.value is not null and d.value <> ''
on conflict (site_id, kind, id) do nothing;
