-- B1116 — ATOMIC GROUP COMMIT for commit_elements (the server half of the assembly-tear fix).
--
-- WHY THIS EXISTS
-- ---------------
-- `commit_elements` has always been ONE transaction, but a per-op rev conflict does not abort it:
-- the loop records `{status:'conflict'}` for that op and carries on, so the ops that DID pass their
-- rev check still commit. For independent elements that is exactly right — one stale element must
-- not block thirty good ones.
--
-- For a BONDED ASSEMBLY it is catastrophic. Measured on production 2026-07-29: an undo sent one
-- 12-op batch (correct on the wire, verified), the server accepted the HOST's op and refused the
-- eleven bonded children, and the plan was left with the building restored and every child still
-- at the moved coordinates — the precise tear the batching exists to prevent. No amount of
-- client-side care can close this: the client cannot make the server's decisions atomic.
--
-- WHAT THIS ADDS
-- --------------
-- A third, DEFAULTED parameter: `p_atomic boolean default false`. The existing 2-argument call is
-- byte-for-byte unchanged in behaviour and signature — nothing that calls it today is affected, so
-- this migration is safe to apply BEFORE any client ships that uses it.
--
-- With `p_atomic => true`, the call is ALL-OR-NOTHING: if any op comes back non-`ok`, every write
-- in the call is rolled back and the caller receives
--     { "applied": false, "results": [ …the same per-op statuses… ] }
-- so the client learns exactly which ops failed AND knows that none of them landed. It can then
-- re-read the current revs and re-commit the whole assembly. With `p_atomic => false` (or omitted)
-- the return shape is the bare results array, exactly as today.
--
-- The rollback uses plpgsql's exception block, which is a SAVEPOINT: raising inside it undoes every
-- statement made since the block was entered, while `results` — a plpgsql variable, not table state
-- — survives, which is what lets the failure be reported precisely instead of as an opaque error.
--
-- HOW TO APPLY
-- ------------
-- Run this whole file once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste →
-- Run). It is idempotent: `create or replace` plus a `drop … if exists` for the old 2-arg overload
-- is deliberately NOT used — the 2-arg version must keep working until every client has moved on,
-- so this file only ADDS the 3-arg overload. Nothing is dropped and nothing is destructive.
--
-- ⚠ ORDER MATTERS: apply this BEFORE shipping a client that passes `p_atomic`. A client calling a
-- 3-arg overload that does not exist gets a PostgREST 404 on EVERY write.

create or replace function public.commit_elements(p_site text, p_ops jsonb, p_atomic boolean)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  results jsonb;
  bad     int;
begin
  if p_site is null or p_ops is null or jsonb_typeof(p_ops) <> 'array' then
    raise exception 'commit_elements: p_site and a jsonb ARRAY of ops are required';
  end if;

  if not coalesce(p_atomic, false) then
    return public.commit_elements(p_site, p_ops);   -- unchanged path, unchanged return shape
  end if;

  begin
    -- Everything below is inside an implicit SAVEPOINT: the raise unwinds it.
    results := public.commit_elements(p_site, p_ops);

    select count(*) into bad
      from jsonb_array_elements(results) x
     where coalesce(x->>'status', '') <> 'ok';

    if bad > 0 then
      -- Roll the whole group back. The message is matched below, never surfaced to the user.
      raise exception 'planyr-atomic-abort' using errcode = 'P0001';
    end if;
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'planyr-atomic-abort' then raise; end if;   -- a real P0001 from below still propagates
      return jsonb_build_object('applied', false, 'results', results);
  end;

  return jsonb_build_object('applied', true, 'results', results);
end;
$$;

revoke execute on function public.commit_elements(text, jsonb, boolean) from public, anon;
grant  execute on function public.commit_elements(text, jsonb, boolean) to authenticated;

comment on function public.commit_elements(text, jsonb, boolean) is
  'B1116 — all-or-nothing group commit. p_atomic=true rolls the whole call back if ANY op is '
  'non-ok and returns {applied:false, results:[…]}; p_atomic=false delegates to the 2-arg form '
  'unchanged. Exists so a bonded assembly cannot half-apply (the 1-of-12 tear, 2026-07-29).';
