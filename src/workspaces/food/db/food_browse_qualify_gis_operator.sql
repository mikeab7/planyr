-- B<PENDING> (2026-10-04) — migration `food_places_in_bounds_sampled_qualify_gis_operator`,
-- ALREADY APPLIED to production (planyr_production) on 2026-10-04; kept here so the repo's record
-- matches the live database. The same definition is folded into food.sql (idempotent: create or
-- replace), so re-running either file is safe.
--
-- WHY: B1205298 pinned this function's search_path to `public, pg_temp`. PostGIS lives in the
-- `extensions` schema, and an OPERATOR (unlike a function call) cannot carry a schema prefix in
-- plain syntax, so `geom && extensions.st_makeenvelope(...)::extensions.geography` stopped
-- resolving: 42883 "operator does not exist: extensions.geography && extensions.geography". The
-- RPC errored on every call and the Food map got no browse pins. OPERATOR(extensions.&&) still
-- uses the GIST index (same operator, just explicitly qualified).
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
as $$
  with matched as (
    select id, name, lat, lon, category, cuisine, address, brand, source, source_licence,
      width_bucket(lat, p_south, p_north, greatest(p_grid, 1)) as gy,
      width_bucket(lon, p_west, p_east, greatest(p_grid, 1)) as gx
    from public.food_places
    where geom OPERATOR(extensions.&&) extensions.st_makeenvelope(p_west, p_south, p_east, p_north, 4326)::extensions.geography
  ),
  counted as (
    select *,
      count(*) over (partition by gy, gx) as cell_count,
      count(*) over () as total_matched
    from matched
  ),
  ranked as (
    select *, row_number() over (partition by gy, gx order by id) as rn
    from counted
  )
  select id, name, lat, lon, category, cuisine, address, brand, source, source_licence, total_matched
  from ranked
  where rn <= greatest(1, ceil(p_cap::numeric * cell_count / greatest(total_matched, 1)))
  order by gy, gx, rn
  limit p_cap;
$$;

grant execute on function public.food_places_in_bounds_sampled(
  double precision, double precision, double precision, double precision, integer, integer
) to anon, authenticated;
