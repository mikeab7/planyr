-- Site-plan overlay placement commit — atomic with dependent comps' recompute (B972512-HARDENING
-- item 1). Run once in the Supabase SQL editor AFTER site_plan_overlays.sql, comps.sql and
-- comps_site_plan_anchor.sql. Idempotent.
--
-- THE BUG THIS CLOSES: a 'site_plan'-anchored comp's lat/lon is the authoritative, DERIVED
-- position (see comps/lib/comps.js's `validAnchor` comment) — derived from `site_plan_point`
-- (the image-pixel point on the overlay; the real source of truth for WHERE on the plan the pin
-- sits) run through the overlay's own placement transform (center/scale/rotation,
-- shared/sitePlans/lib/overlayGeoref.js). Before this migration, dragging / corner-scaling /
-- rotating an overlay updated ONLY the overlay row — every comp pinned to it kept its OLD
-- lat/lon, silently wrong the moment the plan moved (a "silent wrong number" on the map and in
-- every distance/proximity screen that reads a comp's lat/lon).
--
-- WHY TWO RPCS AND NOT A TRIGGER, AND WHY THE MATH STAYS IN JS: the recompute math is a real,
-- zone-aware State Plane (Lambert Conformal Conic) projection (shared/coordinates/statePlane.js
-- + shared/sitePlans/lib/overlayGeoref.js), already built and unit-tested
-- (test/overlayGeoref.test.js, test/statePlane.test.js). Porting it into PL/pgSQL would duplicate
-- that math in a second language with no shared test coverage — a drift risk, not a safety gain.
-- So the CLIENT still computes every new lat/lon; these two functions exist only to let the
-- overlay's OWNER apply that result to every comp referencing the overlay, REGARDLESS of who
-- owns that comp. That "regardless of who owns it" is the reason this needs SECURITY DEFINER at
-- all: `comps` UPDATE (and SELECT of a non-team-shared row) is owner-only RLS (comps.sql), so
-- without this, moving a team-shared plan could only ever fix up the MOVER's own pins, silently
-- leaving every teammate's pin stale — which is exactly the bug being fixed, just narrowed to
-- "except when someone else drew it." Both functions are gated on "caller owns the overlay" (the
-- same rule that already gates moving the overlay at all — `site_plan_overlays`' own UPDATE
-- policy is owner-only), and both touch ONLY comp rows whose `site_plan_overlay_id` already
-- equals the overlay in question — never an arbitrary comp id the caller might pass.
--
-- `site_plan_overlay_comp_points` deliberately returns ONLY `id` + `site_plan_point` — never
-- comp_type, title, price, notes, party names, or anything else a teammate entered. The overlay
-- owner needs the plan-space point to recompute a position; nothing else about the comp is any
-- of their business, even though the read itself necessarily crosses the normal per-owner comps
-- RLS boundary (a deliberate, narrow, documented exception — not a general comps read hole).
--
-- ⛔ AUDIT-FIRST FINDING (live-tested while proving this migration, kept here rather than filed
-- silently): `revoke all on function ... from public` does NOT stop the `anon` role from
-- EXECUTING a function in this project — `has_function_privilege('anon', ..., 'EXECUTE')` reads
-- true for every function in this codebase that uses the "revoke from public; grant to
-- authenticated" pattern, INCLUDING the existing precedent `set_plan_lock`. Supabase's default
-- privileges grant EXECUTE to `anon` directly (not through the `public` pseudo-role), so
-- revoking from `public` alone never touches it. Every such function in this codebase is still
-- SAFE today only because each one independently checks `auth.uid() is null` and raises before
-- doing anything — not because the grant actually blocks anon. That's a real, systemic, quieter
-- gap worth knowing about (defense-in-depth is one auth.uid() check away from a real hole, repo
-- wide) but fixing every existing function is bigger than this session's scope; these two NEW
-- functions are hardened properly below (explicit `revoke ... from anon`), which costs nothing
-- and should be the template for new SECURITY DEFINER functions going forward.

-- `commit_site_plan_overlay_placement` does the overlay's own placement UPDATE and every
-- dependent comp's lat/lon UPDATE in the SAME function — one implicit transaction, so a plan's
-- new position and its pins' new positions commit together or not at all (the owner's explicit
-- ask: "make recomputation atomic with the transform change"). The placement-drag commit path
-- (SitePlansSection.jsx's `commitPlacementRef`) now calls this instead of a plain
-- `update site_plan_overlays`; every other overlay edit (opacity/visible/locked/doc_title/etc.,
-- which never move the plan and so never invalidate a pinned point) keeps going through the
-- ordinary `updateOverlay`/RLS path.

create or replace function public.site_plan_overlay_comp_points(p_overlay_id uuid)
returns table(id uuid, site_plan_point jsonb)
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not exists (
    select 1 from public.site_plan_overlays o where o.id = p_overlay_id and o.user_id = v_uid
  ) then
    raise exception 'That site plan is not yours to move.' using errcode = '42501';
  end if;
  return query
    select c.id, c.site_plan_point from public.comps c
    where c.site_plan_overlay_id = p_overlay_id and c.site_plan_point is not null;
end;
$$;
revoke all on function public.site_plan_overlay_comp_points(uuid) from public;
revoke all on function public.site_plan_overlay_comp_points(uuid) from anon;
grant execute on function public.site_plan_overlay_comp_points(uuid) to authenticated;

-- ⛔ B972512-HARDENING item 7 (added after the first version of this function shipped without
-- it) — `commit_site_plan_overlay_placement` is now VERSION-GUARDED, the same optimistic-
-- concurrency shape `sites`/`doc_reviews` already use (optimistic_concurrency.sql,
-- shared/cloud/optimisticUpsert.js) — a drag/scale/rotate commit carries the `version` the
-- client last saw and only applies if it still matches, bumping it atomically alongside the
-- placement fields. Multiple live sessions on the same plan are the owner's own stated, common
-- case ("3 here"); without this, two overlapping drags silently last-write-wins with no signal
-- to either side. Distinguishes "not yours to move" (42501, unchanged) from "changed elsewhere,
-- reload first" (40001 — Postgres' own serialization_failure code, the closest standard fit for
-- an optimistic-concurrency conflict) so the client can tell a permissions problem from a race.
drop function if exists public.commit_site_plan_overlay_placement(uuid, double precision, double precision, double precision, double precision, jsonb);

create or replace function public.commit_site_plan_overlay_placement(
  p_overlay_id uuid,
  p_center_lat double precision, p_center_lon double precision,
  p_ft_per_px double precision, p_rotation_deg double precision,
  p_comp_positions jsonb,  -- [{id, lat, lon}, ...] — the recomputed position for every comp this
                           -- placement change should carry along; anything the caller omits is
                           -- simply not touched (never nulled or dropped) and any id that turns
                           -- out not to reference this overlay is silently skipped (defense in
                           -- depth against a stale/forged list, not the primary check).
  p_expected_version integer  -- optimistic-concurrency guard (item 7) — the version this client
                               -- last saw for the overlay row.
) returns jsonb  -- {moved: <count of comps actually moved>, version: <new overlay version>}
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
      set lat = (v_item->>'lat')::double precision, lon = (v_item->>'lon')::double precision
      where id = (v_item->>'id')::uuid and site_plan_overlay_id = p_overlay_id;
    if found then v_moved := v_moved + 1; end if;
  end loop;

  return jsonb_build_object('moved', v_moved, 'version', v_new_version);
end;
$$;
revoke all on function public.commit_site_plan_overlay_placement(uuid, double precision, double precision, double precision, double precision, jsonb, integer) from public;
revoke all on function public.commit_site_plan_overlay_placement(uuid, double precision, double precision, double precision, double precision, jsonb, integer) from anon;
grant execute on function public.commit_site_plan_overlay_placement(uuid, double precision, double precision, double precision, double precision, jsonb, integer) to authenticated;

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select proname, prosecdef, proacl from pg_proc where proname in
--     ('site_plan_overlay_comp_points', 'commit_site_plan_overlay_placement');  -- prosecdef = true for both
