-- single_source_backfill_20261004.sql (B2064896) — NON-DESTRUCTIVE backfill for the verdict-A copies the
-- 2026-10-04 production drift report (scripts/drift-report.sql) measured. Idempotent. NOT run by hand:
-- it goes through the normal migration deploy path. Nothing here deletes a row or overwrites a
-- user-typed value: it only (1) fills BLANK index fields from the record that owns them and (2) makes a
-- project's plans agree on the status the app already shows. Every changed row is first copied to a
-- recovery snapshot table.
--
-- Names in `schedules` / `doc_reviews` (D01 / D06) are NOT here — PR #1892's own backfill file covers them.
--
-- STEP 0 — read-only preview (safe any time; run before applying):
--   select 'file_facts to fill' what, count(*) from public.file_facts f join public.doc_reviews d on d.id = f.review_id and d.deleted_at is null
--    where (coalesce(f.item,'') = '' and coalesce(d.item,'') <> '') or (coalesce(f.revision,'') = '' and coalesce(d.revision,'') <> '')
--       or (f.doc_date is null and d.doc_date is not null) or (coalesce(f.discipline,'') in ('','Other') and coalesce(d.discipline,'') not in ('','Other'))
--   union all
--   select 'plans whose status disagrees with the project', count(*) from public.sites s
--    where s.deleted_at is null and s.data->>'status' is distinct from (
--      select p.data->>'status' from public.sites p where coalesce(p.data->>'groupId', p.id) = coalesce(s.data->>'groupId', s.id)
--        and p.deleted_at is null and p.data->>'status' is not null order by (p.data->>'updatedAt')::numeric desc nulls last, p.updated_at desc limit 1);

-- STEP 1 — recovery snapshot of every row this file may change (create-once, never read by the app).
create table if not exists public.recovery_20261004_single_source_snapshot (
  taken_at   timestamptz not null default now(),
  tbl        text        not null,
  row_id     text        not null,
  before     jsonb       not null
);
alter table public.recovery_20261004_single_source_snapshot enable row level security;  -- no policy: service role only

-- STEP 2 — file_facts: fill BLANKS from the owning review (a stated facts value is never replaced).
with todo as (
  select f.id from public.file_facts f join public.doc_reviews d on d.id = f.review_id and d.deleted_at is null
   where (coalesce(f.item,'') = '' and coalesce(d.item,'') <> '')
      or (coalesce(f.revision,'') = '' and coalesce(d.revision,'') <> '')
      or (f.doc_date is null and d.doc_date is not null)
      or (coalesce(f.discipline,'') in ('','Other') and coalesce(d.discipline,'') not in ('','Other'))
)
insert into public.recovery_20261004_single_source_snapshot (tbl, row_id, before)
select 'file_facts', f.id, to_jsonb(f) from public.file_facts f join todo t on t.id = f.id
 where not exists (select 1 from public.recovery_20261004_single_source_snapshot r where r.tbl = 'file_facts' and r.row_id = f.id);

update public.file_facts f set
  item       = case when coalesce(f.item,'') = '' and coalesce(d.item,'') <> '' then d.item else f.item end,
  revision   = case when coalesce(f.revision,'') = '' and coalesce(d.revision,'') <> '' then d.revision else f.revision end,
  doc_date   = coalesce(f.doc_date, d.doc_date),
  discipline = case when coalesce(f.discipline,'') in ('','Other') and coalesce(d.discipline,'') not in ('','Other') then d.discipline else f.discipline end
from public.doc_reviews d
where d.id = f.review_id and d.deleted_at is null
  and ( (coalesce(f.item,'') = '' and coalesce(d.item,'') <> '')
     or (coalesce(f.revision,'') = '' and coalesce(d.revision,'') <> '')
     or (f.doc_date is null and d.doc_date is not null)
     or (coalesce(f.discipline,'') in ('','Other') and coalesce(d.discipline,'') not in ('','Other')) );

-- STEP 3 — project status: a project whose plans disagree takes the status of its newest plan header (the
-- answer the app's groupStatusOf already gives). Each changed plan gets `data.updatedAt` stamped, or the
-- client merge (mergeSiteContent) would keep the stale local status forever (B1181104's lesson).
with winner as (
  select distinct on (coalesce(p.data->>'groupId', p.id))
         coalesce(p.data->>'groupId', p.id) gid, p.data->>'status' status
    from public.sites p
   where p.deleted_at is null and p.data->>'status' is not null
   order by coalesce(p.data->>'groupId', p.id), (p.data->>'updatedAt')::numeric desc nulls last, p.updated_at desc
), todo as (
  select s.id, w.status from public.sites s join winner w on w.gid = coalesce(s.data->>'groupId', s.id)
   where s.deleted_at is null and s.data->>'status' is distinct from w.status
)
insert into public.recovery_20261004_single_source_snapshot (tbl, row_id, before)
select 'sites', s.id, jsonb_build_object('status', s.data->>'status', 'updatedAt', s.data->>'updatedAt', 'version', s.version)
  from public.sites s join todo t on t.id = s.id
 where not exists (select 1 from public.recovery_20261004_single_source_snapshot r where r.tbl = 'sites' and r.row_id = s.id);

update public.sites s set
  data       = jsonb_set(jsonb_set(s.data, '{status}', to_jsonb(t.status), true),
                         '{updatedAt}', to_jsonb((extract(epoch from now()) * 1000)::bigint), true),
  version    = coalesce(s.version, 1) + 1,
  updated_at = now()
from (
  select s2.id, w.status from public.sites s2
    join (select distinct on (coalesce(p.data->>'groupId', p.id)) coalesce(p.data->>'groupId', p.id) gid, p.data->>'status' status
            from public.sites p where p.deleted_at is null and p.data->>'status' is not null
           order by coalesce(p.data->>'groupId', p.id), (p.data->>'updatedAt')::numeric desc nulls last, p.updated_at desc) w
      on w.gid = coalesce(s2.data->>'groupId', s2.id)
   where s2.deleted_at is null and s2.data->>'status' is distinct from w.status
) t
where s.id = t.id;

-- STEP 4 — verify (read-only): both counts below must be 0 after applying.
--   select count(*) from public.file_facts f join public.doc_reviews d on d.id = f.review_id and d.deleted_at is null where coalesce(f.item,'') = '' and coalesce(d.item,'') <> '';
--   (and re-run scripts/drift-report.sql: D08 and D15 read 0 drifted)
