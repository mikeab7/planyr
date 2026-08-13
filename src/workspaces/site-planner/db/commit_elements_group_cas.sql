-- B1341 STAGE 2 of 3 — GROUP CAS: one revision for a bonded assembly, behind a flag.
--
-- WHY THIS EXISTS (and why stage 1 had to come first)
-- ---------------------------------------------------
-- B1117 made a call ATOMIC: a batch either lands whole or not at all. That is one CALL being
-- all-or-nothing, and it is not the same as an assembly having one revision. Two calls can each be
-- internally atomic and still disagree with each other — writer A commits the host while writer B
-- commits the children, both calls succeed, and the assembly is torn with nothing anywhere having
-- failed. Every per-row rev guard passed, because each row really was at the rev its writer saw.
--
-- The missing question is "is this ASSEMBLY still in the state I based my edit on?", and until
-- stage 1 the database could not even ask it: the grouping lived inside `data->>'attachedTo'`,
-- which no statement could group on. `assembly_id` (stage 1, generated) is what makes this
-- possible; B1341 says explicitly *do not start at stage 2*, and this is why.
--
-- WHAT THIS ADDS
-- --------------
-- A FOURTH, DEFAULTED parameter: `p_groups jsonb default null`, an array of
--     [ { "assembly": "<assembly_id>", "expected": "<digest>" }, … ]
--
-- Before ANY op is applied, each named assembly's CURRENT digest is computed from its live rows.
-- If any differs from `expected`, nothing is written at all and the call returns
--     { "applied": false, "groupConflict": [ { assembly, expected, actual, members:[…] } ],
--       "results": [] }
-- so the client learns WHICH assembly moved and to what, and can re-read and re-commit the whole
-- group. On a match, the call delegates to the 3-arg atomic form, unchanged.
--
-- ⛔ THE DIGEST IS DERIVED, NOT STORED, AND THAT IS THE LOAD-BEARING CHOICE.
-- The obvious design is a `group_rev` column bumped by a trigger. It was rejected for the reason
-- this whole bug family exists: a stored group revision is a SECOND copy of a fact the row revs
-- already carry, maintained by a different code path, and two copies of one fact disagreeing under
-- a race is the defect, not the fix. This digest cannot drift from the revs it summarises because
-- it IS the revs:
--     string_agg(id || ':' || rev, ',' order by id)   over LIVE rows of that assembly
-- The client twin is `lib/assemblyDigest.js` and must stay character-for-character equivalent.
-- Live rows only, on both sides: a tombstone is not a member (the stage 1 index is partial for the
-- same reason), and counting one would make a delete look like a change to every sibling.
--
-- ⛔ IT IS A PLAIN STRING, NOT A HASH, DELIBERATELY. A mismatch is then readable off the wire —
-- which member moved, and to what — with no tooling. If it ever needs to be short, hash THIS
-- string; do not change the ordering or the separators.
--
-- ADDITIVE AND INERT UNTIL ASKED FOR
-- ----------------------------------
-- Nothing is dropped. The 2-arg and 3-arg forms are untouched and keep their exact behaviour, so
-- every client in the wild is unaffected. `p_groups` null or `[]` delegates immediately — the
-- group check costs a call that does not ask for it precisely nothing. The client sends it only
-- behind a kill switch that ships OFF (see `lib/groupCas.js`).
--
-- ⚠ WHAT THIS IS NOT, stated so the record cannot overstate it. This closes the window between two
-- CALLS. It does not make a torn assembly unrepresentable in the store — a writer that never sends
-- `p_groups` still commits per row, which is exactly why stage 3 (retire the per-row expectation
-- for bonded elements) is a separate stage and still open.
--
-- HOW TO APPLY: run this whole file once in the Supabase SQL editor. Idempotent.
-- HOW TO PROVE IT: `db/test/commit_elements_group_cas.test.sql` — a self-rolling-back test against
-- the real database that drives every outcome, INCLUDING the rejection path, and writes nothing.

-- The digest, as a function, so the RPC and the test cannot compute it two different ways.
create or replace function public.assembly_digest(p_site text, p_assembly text)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(string_agg(t.id || ':' || t.rev, ',' order by t.id), '')
    from public.site_elements t
   where t.site_id = p_site
     and t.assembly_id = p_assembly
     and t.deleted_at is null;
$$;

revoke execute on function public.assembly_digest(text, text) from public, anon;
grant  execute on function public.assembly_digest(text, text) to authenticated;

comment on function public.assembly_digest(text, text) is
  'B1341 stage 2 — the GROUP REVISION of a bonded assembly: id:rev pairs of its LIVE rows, sorted '
  'by id, comma-joined. Derived, never stored, so it cannot drift from the revs it summarises. '
  'Client twin: lib/assemblyDigest.js — keep them character-for-character equivalent.';

create or replace function public.commit_elements(p_site text, p_ops jsonb, p_atomic boolean, p_groups jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  g        jsonb;
  v_asm    text;
  v_want   text;
  v_have   text;
  bad      jsonb := '[]'::jsonb;
begin
  if p_site is null or p_ops is null or jsonb_typeof(p_ops) <> 'array' then
    raise exception 'commit_elements: p_site and a jsonb ARRAY of ops are required';
  end if;

  -- No groups named → this is a 3-arg call wearing a fourth parameter. Delegate untouched, so the
  -- new overload can never change the behaviour of a caller that does not opt in.
  if p_groups is null or jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) = 0 then
    return public.commit_elements(p_site, p_ops, coalesce(p_atomic, false));
  end if;

  -- Check EVERY named group before applying ANYTHING. Collecting all mismatches rather than
  -- returning on the first is deliberate: a client re-committing after a rejection wants to know
  -- about every group that moved, or it will simply be rejected again on the next one.
  for g in select value from jsonb_array_elements(p_groups) loop
    v_asm  := g->>'assembly';
    v_want := g->>'expected';
    if v_asm is null or v_want is null then
      raise exception 'commit_elements: every p_groups entry needs "assembly" and "expected" (got %)', g;
    end if;
    v_have := public.assembly_digest(p_site, v_asm);
    if v_have is distinct from v_want then
      bad := bad || jsonb_build_array(jsonb_build_object(
        'assembly', v_asm,
        'expected', v_want,
        'actual',   v_have,
        'members',  coalesce((
          select jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'rev', t.rev) order by t.id)
            from public.site_elements t
           where t.site_id = p_site and t.assembly_id = v_asm and t.deleted_at is null
        ), '[]'::jsonb)
      ));
    end if;
  end loop;

  if jsonb_array_length(bad) > 0 then
    -- NOTHING has been written — the loop above is read-only, so there is no rollback to perform
    -- and no chance of a partially applied batch. The shape mirrors the atomic-rollback reply the
    -- client already understands, with `groupConflict` naming what moved.
    return jsonb_build_object('applied', false, 'groupConflict', bad, 'results', '[]'::jsonb);
  end if;

  -- Every named group is still where the client left it. Apply through the atomic form, which is
  -- what makes "the group was current AND the whole batch landed" one guarantee instead of two.
  return public.commit_elements(p_site, p_ops, true);
end;
$$;

revoke execute on function public.commit_elements(text, jsonb, boolean, jsonb) from public, anon;
grant  execute on function public.commit_elements(text, jsonb, boolean, jsonb) to authenticated;

comment on function public.commit_elements(text, jsonb, boolean, jsonb) is
  'B1341 stage 2 — group CAS. p_groups = [{assembly, expected}]; the call is refused WHOLE (nothing '
  'written) if any named assembly''s live digest differs, returning {applied:false, groupConflict:[…]}. '
  'Null/empty p_groups delegates to the 3-arg form unchanged. Sent by the client only behind the '
  'lib/groupCas.js kill switch, which ships OFF.';

-- ---- ROLLBACK (uncomment to reverse; no caller depends on either function) ----------------------
-- drop function if exists public.commit_elements(text, jsonb, boolean, jsonb);
-- drop function if exists public.assembly_digest(text, text);
