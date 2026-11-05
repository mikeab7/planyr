-- combined_madefrom_backfill_20261008.sql (NEW-3, B2191xxx) — give every COMBINED parcel made BEFORE PR #2082
-- the "Made from" record the combine now writes (`data.combined = { from: [...] }`), read back from the merge
-- history that is still in public.site_elements. Idempotent, non-destructive: it only ADDS `data.combined` to a
-- live parcel that has none, never edits a geometry or a typed value, and snapshots every row it changes first.
--
-- WHY IT CAN BE DONE: the old combine tombstoned its sources with `op_kind = 'merge'` and one shared `op_id` /
-- `deleted_at`, and wrote the tract in the same commit. The tract's own `op_id` has since been overwritten by later
-- edits (Goose Creek Phase II "Parcel 1" e1455065dultqq is on rev 6, op_kind 'edit'), so the link is rebuilt from
-- GEOMETRY instead, and only when it is unambiguous:
--   · a live parcel with no `combined` record, updated at/after the merge,
--   · whose drawn area equals the SUM of the merge group's source areas (within 0.5%, 0.05 ac floor — a combine
--     writes the union, and lots that share only an edge add exactly), and whose bounding box covers theirs,
--   · and the match is one-to-one (one group ↔ one tract). Anything else is LISTED as skipped, never guessed.
--
-- STEP 0 — DRY RUN (read-only, safe any time). Run this first; it lists what STEP 2 would change and what it
-- would leave alone. (STEP 2 builds the same `_cand` table.)
--   select * from (<the _cand query below>) ... order by site_id;
-- STEP 1 — recovery snapshot (create-once). STEP 2 — apply. Rollback: restore `before` from the snapshot, e.g.
--   update public.site_elements e set data = r.before from public.recovery_20261008_combined_madefrom_snapshot r
--    where r.site_id = e.site_id and r.row_id = e.id;     -- (rev stays bumped — clients adopt the restored row)

create table if not exists public.recovery_20261008_combined_madefrom_snapshot (
  taken_at timestamptz not null default now(),
  site_id  text        not null,
  row_id   text        not null,
  before   jsonb       not null,
  rev      bigint
);
alter table public.recovery_20261008_combined_madefrom_snapshot enable row level security;  -- no policy: service role only

create temp table _cand on commit drop as
with merged as (            -- tombstoned sources, one group per (site, op_id, deleted_at)
  select e.site_id, e.op_id, e.deleted_at, e.id, e.data
    from public.site_elements e
   where e.kind = 'parcel' and e.op_kind = 'merge' and e.deleted_at is not null and e.op_id is not null
     and jsonb_typeof(e.data->'points') = 'array' and jsonb_array_length(e.data->'points') >= 3
), live as (                -- live parcels that carry no Made-from record yet
  select e.site_id, e.id, e.data, e.updated_at
    from public.site_elements e
   where e.kind = 'parcel' and e.deleted_at is null and not (e.data ? 'combined')
     and jsonb_typeof(e.data->'points') = 'array' and jsonb_array_length(e.data->'points') >= 3
     and exists (select 1 from merged m where m.site_id = e.site_id)
), pts_m as (
  select m.site_id, m.op_id, m.deleted_at, m.id, p.ord, (p.v->>'x')::float8 x, (p.v->>'y')::float8 y, jsonb_array_length(m.data->'points') n
    from merged m, jsonb_array_elements(m.data->'points') with ordinality p(v, ord)
), pts_l as (
  select l.site_id, l.id, p.ord, (p.v->>'x')::float8 x, (p.v->>'y')::float8 y, jsonb_array_length(l.data->'points') n
    from live l, jsonb_array_elements(l.data->'points') with ordinality p(v, ord)
), geo_m as (
  select a.site_id, a.op_id, a.deleted_at, a.id,
         abs(sum(a.x * b.y - b.x * a.y)) / 2 / 43560.0 ac, min(a.x) minx, max(a.x) maxx, min(a.y) miny, max(a.y) maxy
    from pts_m a join pts_m b on b.site_id = a.site_id and b.op_id = a.op_id and b.id = a.id and b.ord = (a.ord % a.n) + 1
   group by a.site_id, a.op_id, a.deleted_at, a.id
), geo_l as (
  select a.site_id, a.id,
         abs(sum(a.x * b.y - b.x * a.y)) / 2 / 43560.0 ac, min(a.x) minx, max(a.x) maxx, min(a.y) miny, max(a.y) maxy
    from pts_l a join pts_l b on b.site_id = a.site_id and b.id = a.id and b.ord = (a.ord % a.n) + 1
   group by a.site_id, a.id
), grp as (
  select site_id, op_id, deleted_at, count(*) n_src, sum(ac) ac, min(minx) minx, max(maxx) maxx, min(miny) miny, max(maxy) maxy
    from geo_m group by site_id, op_id, deleted_at having count(*) >= 2
), pair as (
  select g.site_id, g.op_id, g.deleted_at, g.n_src, g.ac src_ac, l.id tract_id, gl.ac tract_ac
    from grp g
    join live l on l.site_id = g.site_id and l.updated_at >= g.deleted_at
    join geo_l gl on gl.site_id = l.site_id and gl.id = l.id
   where abs(gl.ac - g.ac) <= greatest(0.05, 0.005 * g.ac)
     and gl.minx <= g.minx + 3 and gl.maxx >= g.maxx - 3 and gl.miny <= g.miny + 3 and gl.maxy >= g.maxy - 3
)
select p.*,
       count(*) over (partition by p.site_id, p.op_id, p.deleted_at) per_group,
       count(*) over (partition by p.site_id, p.tract_id) per_tract
  from pair p;

-- ---- STEP 0 output: what would change (one_to_one) and what is skipped as ambiguous --------------------------
-- select site_id, tract_id, n_src, round(src_ac::numeric, 2) src_ac, round(tract_ac::numeric, 2) tract_ac,
--        case when per_group = 1 and per_tract = 1 then 'APPLY' else 'SKIP (ambiguous)' end verdict from _cand order by 1, 2;

-- STEP 1 — snapshot the tracts that will change.
insert into public.recovery_20261008_combined_madefrom_snapshot (site_id, row_id, before, rev)
select e.site_id, e.id, e.data, e.rev
  from public.site_elements e join _cand c on c.site_id = e.site_id and c.tract_id = e.id and c.per_group = 1 and c.per_tract = 1
 where not exists (select 1 from public.recovery_20261008_combined_madefrom_snapshot r where r.site_id = e.site_id and r.row_id = e.id);

-- STEP 2 — stamp `combined.from` = a snapshot of each tombstoned source (active again: a combine refuses to
-- merge an inactive lot, and the `parcel_deleted_inactive` trigger forced the stored copy to false on delete).
update public.site_elements t set
  data      = t.data || jsonb_build_object('combined', jsonb_build_object('backfilled', '20261008', 'from', src.arr)),
  rev       = t.rev + 1,
  updated_at = now(),
  op_kind   = 'edit',
  op_id     = 'op_backfill_combined_20261008'
from _cand c
join lateral (
  select jsonb_agg(
           (m.data - 'combined' - 'splitFrom')
           || jsonb_build_object('active', true, 'snapName', coalesce(nullif(m.data->>'label', ''), 'Parcel ' || chr(64 + m.rn::int)))
           order by m.rn) arr
    from (select x.*, row_number() over (order by (x.data->>'z')::float8 nulls last, x.id) rn
            from public.site_elements x
           where x.site_id = c.site_id and x.kind = 'parcel' and x.op_id = c.op_id and x.op_kind = 'merge' and x.deleted_at = c.deleted_at) m
) src on true
where c.per_group = 1 and c.per_tract = 1
  and t.site_id = c.site_id and t.id = c.tract_id and not (t.data ? 'combined');
