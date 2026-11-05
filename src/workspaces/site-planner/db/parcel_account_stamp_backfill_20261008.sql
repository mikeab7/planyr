-- parcel_account_stamp_backfill_20261008.sql (B2194740) — correct the ACCOUNT stamped on county lots by an older
-- build that wrote the layer's OBJECTID row number as the account (SCHIEL: acct "634440"; the county's HCAD
-- account is 0421030000123). Idempotent; changes only `data.acct`, only where the stored value EQUALS that lot's
-- own OBJECTID and the lot's county record carries a Harris `HCAD_NUM` — the one schema whose account column is
-- unambiguous in SQL. Rows on other schemas (TxGIO `PROP_ID`, Chambers `account`, …) are LISTED by the dry run and
-- left alone: choosing among several id-shaped columns is the app's `countyRecord` resolver's job (every display
-- already reads the attribute bag through it), not a SQL regex's.
--
-- STEP 0 — DRY RUN (read-only):
--   select site_id, id, data->>'acct' stored, data->'attrs'->>'HCAD_NUM' correct from public.site_elements
--    where kind = 'parcel' and deleted_at is null and data ? 'attrs'
--      and data->>'acct' = coalesce(data->'attrs'->>'OBJECTID', data->'attrs'->>'objectid', data->'attrs'->>'FID')
--      and data->'attrs'->>'HCAD_NUM' is not null and data->>'acct' <> data->'attrs'->>'HCAD_NUM';
-- Rollback: restore `before` from the snapshot (data), as in combined_madefrom_backfill_20261008.sql.

create table if not exists public.recovery_20261008_parcel_account_snapshot (
  taken_at timestamptz not null default now(),
  site_id  text        not null,
  row_id   text        not null,
  before   jsonb       not null,
  rev      bigint
);
alter table public.recovery_20261008_parcel_account_snapshot enable row level security;  -- no policy: service role only

create temp table _acct on commit drop as
select e.site_id, e.id from public.site_elements e
 where e.kind = 'parcel' and e.deleted_at is null and e.data ? 'attrs'
   and e.data->>'acct' = coalesce(e.data->'attrs'->>'OBJECTID', e.data->'attrs'->>'objectid', e.data->'attrs'->>'FID')
   and coalesce(e.data->'attrs'->>'HCAD_NUM', '') <> '' and e.data->>'acct' <> e.data->'attrs'->>'HCAD_NUM';

insert into public.recovery_20261008_parcel_account_snapshot (site_id, row_id, before, rev)
select e.site_id, e.id, e.data, e.rev from public.site_elements e join _acct a on a.site_id = e.site_id and a.id = e.id
 where not exists (select 1 from public.recovery_20261008_parcel_account_snapshot r where r.site_id = e.site_id and r.row_id = e.id);

update public.site_elements e set
  data = jsonb_set(e.data, '{acct}', to_jsonb(e.data->'attrs'->>'HCAD_NUM'), true),
  rev = e.rev + 1, updated_at = now(), op_kind = 'edit', op_id = 'op_backfill_acct_20261008'
from _acct a where a.site_id = e.site_id and a.id = e.id;
