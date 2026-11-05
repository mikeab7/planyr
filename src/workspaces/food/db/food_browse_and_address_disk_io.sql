-- B2559168 (2026-10-30) — migration `food_browse_and_address_disk_io`, APPLIED to production
-- (planyr_production) the same day; folded into food.sql too (create or replace — safe to re-run,
-- either file). Two function bodies only: no table, no row, no policy and no grant changes.
--
-- WHY (Supabase emailed that planyr_production was exhausting its daily disk I/O burst budget).
-- MEASURED before any change, 2026-10-30, pg_stat_* read through the SQL API:
--   * WAL: 844 MB total in 24 days (~35 MB/day) — NOT the driver. The `sites` autosave (29,869 calls)
--     is 202 MB of WAL in 24 days (~8 MB/day); the Realtime WAL poll (2.25M calls) read 27 blocks
--     from disk. Disk READS: 96 MB total. checkpoints: 6,831 timed / 25 requested (normal).
--   * TEMP FILES: 26,439 files, 61 GB (pg_stat_database.temp_bytes) — ~70x the WAL. 38.8 GB of it
--     (34 GB written + 4.8 GB, read back ~48 GB) is food_places_in_bounds_sampled alone: 14,538
--     calls, ~2.7 MB written per call, because it counted + ranked EVERY place in the viewport
--     (33k wide rows for a Houston-wide view) through two window passes at work_mem = 2184 kB.
--   * EXPLAIN (ANALYZE, BUFFERS) of one metro-wide call, before: temp read=2361 written=1706 blocks
--     (~13 MB), "Sort Method: external merge Disk: 6640kB", 219 ms.
--     After (this file): no temp I/O at all, 196 ms.
--   * food_places_search_by_address: `not exists (select 1 from unnest(words) ... lower(address) not
--     like '%' || w || '%')` cannot use food_places_address_trgm_idx → Parallel Seq Scan of all 82k
--     rows per keystroke (~1,030 ms; 206 statement timeouts in client_errors since 10-08). With the
--     words inlined as literals: Bitmap Index Scan on food_places_address_trgm_idx, 44 ms.
--   * food_places_search_by_name(_fast/_raw) already USE food_places_name_trgm_idx (Bitmap Index Scan,
--     ~9 ms for the candidate set); their remaining cost is first-call warm-up, left unchanged.
--
-- BEHAVIOUR IS UNCHANGED: both functions were proven row-for-row, order-for-order identical to the
-- previous definitions in a rolled-back transaction on production — 8 viewport cases (metro, city,
-- one block, open ocean, whole snapshot, small cap, under cap, 1-cell grid) and 12 address queries
-- (with/without a centre, 1-char words, 9 words, blank, NULL, an apostrophe, a cap past the 100 limit).
--
-- The work_mem on the browse function is a per-function setting (applies only while it runs, then
-- reverts), sized to hold the narrow ranking in memory (3.6 MB used for the 33k-row metro view).
-- ⛔ Do not re-widen the matched CTE with the display columns: that is what spilled.

create or replace function public.food_places_in_bounds_sampled(
  p_south double precision, p_west double precision,
  p_north double precision, p_east double precision,
  p_cap integer default 2000, p_grid integer default 8
)
returns table (
  id text, name text, lat double precision, lon double precision,
  category text, cuisine text, address text, brand text,
  source text, source_licence text, total_matched bigint
)
language sql stable
set search_path = public, pg_temp
-- B2559168 (disk I/O): the ranking runs on NARROW rows (id + grid cell) and the wide columns are
-- joined back for only the <= p_cap survivors, and the sort budget is raised for THIS function
-- only. Before, every zoomed-out call sorted tens of thousands of wide rows through two window
-- passes at the default ~2 MB work_mem and spilled ~13 MB of temp files to disk per call (34 GB
-- written in 24 days). See food_browse_and_address_disk_io.sql for the measurements.
set work_mem = '12MB'
as $$
  with matched as (
    select id,
      width_bucket(lat, p_south, p_north, greatest(p_grid, 1))::int2 as gy,
      width_bucket(lon, p_west, p_east, greatest(p_grid, 1))::int2 as gx
    from public.food_places
    where geom OPERATOR(extensions.&&) extensions.st_makeenvelope(p_west, p_south, p_east, p_north, 4326)::extensions.geography
  ),
  ranked as (
    select id, gy, gx,
      count(*) over (partition by gy, gx) as cell_count,
      count(*) over () as total_matched,
      row_number() over (partition by gy, gx order by id) as rn
    from matched
  ),
  picked as (
    select id, gy, gx, rn, total_matched
    from ranked
    where rn <= greatest(1, ceil(p_cap::numeric * cell_count / greatest(total_matched, 1)))
    order by gy, gx, rn
    limit p_cap
  )
  select f.id, f.name, f.lat, f.lon, f.category, f.cuisine, f.address, f.brand, f.source, f.source_licence, p.total_matched
  from picked p
  join public.food_places f on f.id = p.id
  order by p.gy, p.gx, p.rn;
$$;

create or replace function public.food_places_search_by_address(
  p_query text, p_cap integer default 15,
  p_center_lat double precision default null, p_center_lon double precision default null
)
returns table (
  id text, name text, lat double precision, lon double precision,
  category text, cuisine text, address text, brand text,
  source text, source_licence text, metro text, confidence double precision,
  sim real, distance_km double precision
)
language plpgsql stable
set search_path = public, extensions, pg_temp
as $fn$
#variable_conflict use_column
-- B2559168: the same filter as before, but each typed word becomes a LITERAL `lower(address) like
-- '%word%'` in dynamic SQL, because a pattern built per row from unnest() cannot use the trigram
-- GIN index above — the old form seq-scanned all 82k rows on every keystroke (~1,000 ms; 206
-- statement timeouts logged). With literals the planner uses a Bitmap Index Scan (~44 ms).
-- Words are [a-z0-9] only and are quoted with %L, so nothing typed can act as a pattern or SQL.
declare
  v_words text[];
  v_like text;
begin
  v_words := array(
    select distinct w from unnest(string_to_array(
      btrim(regexp_replace(lower(coalesce(p_query, '')), '[^a-z0-9]+', ' ', 'g')), ' ')) w
    where w <> ''
  );
  if cardinality(v_words) not between 1 and 8 then return; end if;
  if not exists (select 1 from unnest(v_words) w where length(w) >= 3) then return; end if;
  select string_agg(format('lower(fp.address) like %L', '%' || w || '%'), ' and ')
    into v_like from unnest(v_words) w;
  return query execute format($q$
    select m.id, m.name, m.lat, m.lon, m.category, m.cuisine, m.address, m.brand,
      m.source, m.source_licence, m.metro, m.confidence, 0.95::real as sim,
      case when $1 is null or $2 is null then null
        else extensions.st_distance(
          m.geom,
          extensions.st_setsrid(extensions.st_makepoint($2, $1), 4326)::extensions.geography
        ) / 1000.0
      end as distance_km
    from (
      -- Rank on a CHEAP flat-earth distance (no PostGIS per row: a city word like "Dallas" matches
      -- ~30k rows, and a true geography distance on each measured 412 ms); only the p_cap survivors
      -- get the exact st_distance above. Flat-earth ordering is exact enough to pick the nearest.
      select fp.*
      from public.food_places fp
      where fp.address is not null
        and %s
        and fp.address !~ '\d{5}(-\d{4})?\s+and\s+\d+\s+\S'
      order by case when $1 is null or $2 is null then 0
        else power(fp.lat - $1, 2) + power((fp.lon - $2) * cos(radians($1)), 2) end asc,
        fp.name asc
      limit least(greatest(1, $3), 100)
    ) m
    order by distance_km asc nulls last, m.name asc
  $q$, v_like) using p_center_lat, p_center_lon, p_cap;
end;
$fn$;

grant execute on function public.food_places_in_bounds_sampled(
  double precision, double precision, double precision, double precision, integer, integer
) to anon, authenticated;
grant execute on function public.food_places_search_by_address(text, integer, double precision, double precision) to anon, authenticated;
