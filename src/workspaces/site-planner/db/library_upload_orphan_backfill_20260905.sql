-- B1160480 — ONE-TIME DATA REPAIR: re-materialize the `public.sites` row for two projects that
-- were orphaned by the bug this item fixes (a project minted with no located origin has no
-- `sites` row until its first drawing save — see SitePlannerApp.jsx's `newBlankSite` — and a
-- Library upload used to write `doc_reviews`/`file_facts` rows keyed to that project id anyway,
-- with nothing to reopen the project from). Run ONCE against project lyeqzkuiwngunutlkkmi. This
-- file is a HISTORICAL RECORD of what was executed on 2026-09-05, not a reusable migration — but
-- it is idempotent by construction (each insert is guarded by `where not exists`), so a re-run
-- is harmless.
--
-- THE TWO ORPHANS, found by querying `public.file_facts`/`public.doc_reviews` for a `project_id`
-- with no matching `public.sites` row (both belong to the same owner, user_id
-- b147d90d-b610-423d-af65-7e004f0ad72f):
--   smqufythhwbt — 2 files (test-docA.pdf, test-docB.pdf), filed 2026-06-26, doc_reviews.project
--                  = "Untitled site"
--   smqwkiw5srf3 — 1 file (test-docA.pdf), filed 2026-06-27, doc_reviews.project = "Project"
--
-- WHAT THIS DOES: inserts a minimal `sites` row for each id (group_id = id, no drawn geometry —
-- there never was any, only a Library upload happened), named so the owner can immediately tell
-- these are recovered rather than confusing them with a real "Untitled site"/"Project" he made
-- elsewhere. Nothing is deleted, nothing existing is touched or overwritten — this only ever
-- INSERTs a row for an id that currently has none (guarded by `where not exists`).
--
-- SAFETY: a snapshot of `public.sites` is taken FIRST, unconditionally (`create table if not
-- exists`, so a second run can't overwrite the true pre-repair snapshot with an already-repaired
-- state).

create table if not exists public.recovery_b1160480_sites_snapshot as table public.sites;

insert into public.sites (id, user_id, group_id, site, name, county, updated_at, data, version)
select
  'smqufythhwbt', 'b147d90d-b610-423d-af65-7e004f0ad72f', 'smqufythhwbt',
  'Recovered project — 2026-06-26 Library upload', 'Concept A', null, now(),
  jsonb_build_object(
    'schemaVersion', 15,
    'id', 'smqufythhwbt',
    'groupId', 'smqufythhwbt',
    'site', 'Recovered project — 2026-06-26 Library upload',
    'name', 'Concept A',
    'role', 'pursuit',
    'updatedAt', (extract(epoch from now()) * 1000)::bigint,
    'els', '[]'::jsonb,
    'measures', '[]'::jsonb,
    'parcels', '[]'::jsonb,
    'settings', '{}'::jsonb
  ),
  1
where not exists (select 1 from public.sites where id = 'smqufythhwbt');

insert into public.sites (id, user_id, group_id, site, name, county, updated_at, data, version)
select
  'smqwkiw5srf3', 'b147d90d-b610-423d-af65-7e004f0ad72f', 'smqwkiw5srf3',
  'Recovered project — 2026-06-27 Library upload', 'Concept A', null, now(),
  jsonb_build_object(
    'schemaVersion', 15,
    'id', 'smqwkiw5srf3',
    'groupId', 'smqwkiw5srf3',
    'site', 'Recovered project — 2026-06-27 Library upload',
    'name', 'Concept A',
    'role', 'pursuit',
    'updatedAt', (extract(epoch from now()) * 1000)::bigint,
    'els', '[]'::jsonb,
    'measures', '[]'::jsonb,
    'parcels', '[]'::jsonb,
    'settings', '{}'::jsonb
  ),
  1
where not exists (select 1 from public.sites where id = 'smqwkiw5srf3');

-- Verify (read-only; safe to run any time) -------------------------------------------------------
--   select id, site, data->>'role' as role from public.sites where id in ('smqufythhwbt','smqwkiw5srf3');
--   select project_id, count(*) from public.file_facts where project_id in ('smqufythhwbt','smqwkiw5srf3') group by 1;
