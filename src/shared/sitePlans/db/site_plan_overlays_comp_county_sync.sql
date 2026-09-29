-- B1953796 (R9) — a site-plan overlay move now re-syncs each pinned comp's COUNTY, not just lat/lon.
--
-- site_plan_overlays_comp_sync.sql's commit_site_plan_overlay_placement moved a comp's lat/lon when
-- its plan was dragged, but left comps.county as whatever it was at pin time — so a plan moved across
-- a county line kept the OLD county on every pinned comp (comps are grouped/filtered by county).
--
-- The client resolves the new county (best-effort, from the moved position) and adds an OPTIONAL
-- "county" key to each p_comp_positions item: [{id, lat, lon, county?}, ...]. A missing / empty county
-- leaves the stored value untouched (never nulled) — an unresolved lookup must not erase a real one.
-- Everything else is byte-for-byte the previous definition (same signature, same guards, same grants).
-- Additive and idempotent (create or replace); safe to re-run. NOT auto-applied — run it once in the
-- Supabase SQL editor.

create or replace function public.commit_site_plan_overlay_placement(
  p_overlay_id uuid,
  p_center_lat double precision, p_center_lon double precision,
  p_ft_per_px double precision, p_rotation_deg double precision,
  p_comp_positions jsonb,
  p_expected_version integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ok integer := 0;
  v_moved integer := 0;
  v_item jsonb;
  v_new_version integer;
  v_owned boolean;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;

  update public.site_plan_overlays
    set center_lat = p_center_lat, center_lon = p_center_lon,
        ft_per_px = p_ft_per_px, rotation_deg = coalesce(p_rotation_deg, 0),
        version = version + 1
    where id = p_overlay_id and user_id = v_uid and version = p_expected_version
    returning version into v_new_version;
  get diagnostics v_ok = row_count;

  if v_ok = 0 then
    select exists(select 1 from public.site_plan_overlays o where o.id = p_overlay_id and o.user_id = v_uid) into v_owned;
    if not v_owned then
      raise exception 'That site plan is not yours to move.' using errcode = '42501';
    else
      raise exception 'This site plan changed elsewhere — reload before moving it again.' using errcode = '40001';
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_comp_positions, '[]'::jsonb))
  loop
    if (v_item->>'id') is null or (v_item->>'lat') is null or (v_item->>'lon') is null then
      continue;
    end if;
    update public.comps
      set lat = (v_item->>'lat')::double precision, lon = (v_item->>'lon')::double precision,
          county = coalesce(nullif(v_item->>'county', ''), county)
      where id = (v_item->>'id')::uuid and site_plan_overlay_id = p_overlay_id;
    if found then v_moved := v_moved + 1; end if;
  end loop;

  return jsonb_build_object('moved', v_moved, 'version', v_new_version);
end;
$$;
revoke all on function public.commit_site_plan_overlay_placement(uuid, double precision, double precision, double precision, double precision, jsonb, integer) from public;
revoke all on function public.commit_site_plan_overlay_placement(uuid, double precision, double precision, double precision, double precision, jsonb, integer) from anon;
grant execute on function public.commit_site_plan_overlay_placement(uuid, double precision, double precision, double precision, double precision, jsonb, integer) to authenticated;
