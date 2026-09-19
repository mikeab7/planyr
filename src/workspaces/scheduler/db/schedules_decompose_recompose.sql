-- B1777120 -- the migration itself: decompose planar_data's whole-account blob into
-- public.schedules + public.schedule_account_index rows, and the reverse (recompose) path
-- used both to PROVE the decomposition is lossless and as the real rollback mechanism if the
-- normalized shape is ever abandoned. Both functions are idempotent / pure-ish and safe to
-- re-run; see BACKLOG.md B1777120 for the acceptance criteria this file exists to satisfy
-- ("the migration, run twice, produces the same result" / "the reverse path must be
-- EXERCISED in this session, not merely described").
--
-- Locked down to service-role/ops use only (not granted to authenticated/anon) -- this is a
-- migration tool run by hand via the Supabase MCP, not a client-facing RPC. The client's own
-- dual-write path (public/sequence/index.html) does its OWN decomposition in JS rather than
-- calling this function, so an ordinary save never pays a round-trip through PL/pgSQL.

begin;

create or replace function public.schedules_decompose_from_planar_data()
returns table(planar_key text, owner_user_id uuid, schedules_upserted integer, schedules_soft_deleted integer)
language plpgsql
as $$
declare
  r record;
  proj record;
  present_ids bigint[];
  n_up integer;
  n_del integer;
begin
  for r in select key, value, user_id, team_id from public.planar_data loop
    if r.user_id is null then
      -- No owner to attribute rows to (should not happen post-B778, but a migration must
      -- never guess an owner) -- skip this row rather than mint an unowned schedule.
      continue;
    end if;

    insert into public.schedule_account_index
      (user_id, team_id, n_pid, n_tid, last_active_by_site, settings, migration_flags, rev)
    values (
      r.user_id,
      r.team_id,
      coalesce((r.value->>'nPid')::integer, 1),
      coalesce(r.value->'nTid', '{}'::jsonb),
      coalesce(r.value->'lastActiveBySite', '{}'::jsonb),
      coalesce(r.value->'settings', '{}'::jsonb),
      coalesce(r.value, '{}'::jsonb) - 'projects' - 'nPid' - 'nTid' - 'lastActiveBySite' - 'settings' - '__rev',
      0
    )
    on conflict (user_id) do update set
      team_id              = excluded.team_id,
      n_pid                = excluded.n_pid,
      n_tid                = excluded.n_tid,
      last_active_by_site  = excluded.last_active_by_site,
      settings             = excluded.settings,
      migration_flags      = excluded.migration_flags,
      rev                  = public.schedule_account_index.rev + 1;

    present_ids := array[]::bigint[];
    n_up := 0;

    for proj in select * from jsonb_each(coalesce(r.value->'projects', '{}'::jsonb)) loop
      present_ids := present_ids || (proj.key)::bigint;

      insert into public.schedules
        (id, user_id, team_id, linked_site_id, linked_site_name, name, data, rev, deleted_at)
      values (
        (proj.key)::bigint,
        r.user_id,
        r.team_id,
        proj.value->>'linkedSiteId',
        proj.value->>'linkedSiteName',
        coalesce(proj.value->>'name', ''),
        proj.value,
        0,
        null
      )
      on conflict (id) do update set
        user_id           = excluded.user_id,
        team_id           = excluded.team_id,
        linked_site_id    = excluded.linked_site_id,
        linked_site_name  = excluded.linked_site_name,
        name              = excluded.name,
        data              = excluded.data,
        -- Strictly-increasing on every re-run so schedules_enforce_version_monotonic never
        -- refuses this write; harmless when data is unchanged (the trigger's own
        -- "data is not distinct from old.data" exemption fires first in that case).
        rev               = public.schedules.rev + 1,
        deleted_at        = null;

      n_up := n_up + 1;
    end loop;

    -- Tombstone (never hard-delete -- TOMBSTONE-DELETES) any previously-decomposed schedule
    -- for this owner that the blob no longer lists (a project deleted since the last run).
    update public.schedules
      set deleted_at = now()
      where user_id = r.user_id and deleted_at is null
        and not (id = any(present_ids));
    get diagnostics n_del = row_count;

    planar_key := r.key;
    owner_user_id := r.user_id;
    schedules_upserted := n_up;
    schedules_soft_deleted := n_del;
    return next;
  end loop;

  -- Keep the identity sequence ahead of every legacy-seeded id (including soft-deleted ones,
  -- which must never be reused) so a future real INSERT (post-flip) can never collide with a
  -- pid this migration just seeded explicitly.
  perform setval(
    pg_get_serial_sequence('public.schedules', 'id'),
    greatest(1, (select coalesce(max(id), 0) from public.schedules)),
    true
  );
end;
$$;

comment on function public.schedules_decompose_from_planar_data() is
  'B1777120 -- decomposes every planar_data row into schedules + schedule_account_index rows. '
  'Idempotent (upsert throughout); run by hand via the Supabase MCP, never client-facing.';

revoke execute on function public.schedules_decompose_from_planar_data() from public;

-- The reverse path: rebuild the ORIGINAL blob shape (minus __rev -- see the comparison note
-- below) for one owner from the current schedules + schedule_account_index rows. Used both to
-- PROVE decomposition losslessness (compare against the pre-migration snapshot) and as the
-- actual rollback mechanism (write the result back to planar_data.value if the normalized
-- shape is ever abandoned).
--
-- __rev is deliberately NOT reconstructed here: it was the OLD document-wide write-counter,
-- not an account-wide FACT, and this repo's own client code already treats an __rev-stripped
-- comparison as the correct equality notion for this document (public/sequence/index.html's
-- `_mStripRev`/`_mEq`, used throughout the merge/save path for exactly this reason). A caller
-- restoring this into planar_data.value for a real rollback stamps a fresh __rev itself, the
-- same way every other write to that table already does.
create or replace function public.schedules_recompose_to_planar_data(p_user_id uuid)
returns jsonb
language sql
stable
as $$
  select
    coalesce(idx.migration_flags, '{}'::jsonb)
    || jsonb_build_object(
         'nPid', idx.n_pid,
         'nTid', coalesce(idx.n_tid, '{}'::jsonb),
         'lastActiveBySite', coalesce(idx.last_active_by_site, '{}'::jsonb),
         'settings', coalesce(idx.settings, '{}'::jsonb),
         'projects', coalesce(
           (select jsonb_object_agg(s.id::text, s.data)
            from public.schedules s
            where s.user_id = p_user_id and s.deleted_at is null),
           '{}'::jsonb
         )
       )
  from public.schedule_account_index idx
  where idx.user_id = p_user_id;
$$;

comment on function public.schedules_recompose_to_planar_data(uuid) is
  'B1777120 -- reverse of schedules_decompose_from_planar_data: rebuilds the planar_data '
  'blob shape (minus __rev) for one owner from the current normalized rows. Used to prove the '
  'decomposition is lossless and as the real rollback path.';

revoke execute on function public.schedules_recompose_to_planar_data(uuid) from public;

commit;
