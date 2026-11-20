-- One-off cleanup of the two throwaway real-inbox accounts made for V2070800 / V2080640 (2026-11-04, B2656784).
-- Run ONCE in the Supabase SQL editor (project lyeqzkuiwngunutlkkmi) by the dispatching chat — the session that wrote
-- it could not apply it: the database connector's confirmation went unanswered (230 s timeout). Test artifacts are
-- cleared, never asked about (owner constraint #15).
--
-- SCOPE. Exactly two addresses, matched exactly (lower-cased), nothing else:
--     michael+resettest@planyr.io    (id 141ebf81-ec9a-474a-8850-7effad9aebc0)
--     michael+invitetest@planyr.io   (id cf6c9c16-21f6-45fa-a1bb-d0cabe22a785)
-- The block ASSERTS before it deletes and aborts (rolling everything back) if it finds anything unexpected.
--
-- NOT DELETED, and why: public.auth_email_link_log holds only keyed HMAC hashes of the address (server secret), so
-- rows from these two addresses cannot be picked out in SQL without hitting other people's — they expire by
-- themselves after a day (see auth_email_link_caps.sql). The throwaway team "ZZ inbox proof 1104" was already
-- deleted through the app (0 rows left). Nothing here touches e2e@planyr.test.
--
-- PART 1 (optional, run INSTEAD OF part 2 if the resend half of V2080640 step 8 is to be re-run): remove the
-- invite-test account's mailbox proof so its mailbox reads UNPROVEN again —
--     delete from public.mailbox_proofs
--      where email = 'michael+invitetest@planyr.io' and user_id = 'cf6c9c16-21f6-45fa-a1bb-d0cabe22a785';
-- (then tell the session; the resend check needs that account to still exist, so do part 2 only afterwards).
--
-- PART 2 — the cleanup:
do $$
declare
  v_ids uuid[];
  n_users int;
begin
  select coalesce(array_agg(id), '{}') into v_ids from auth.users
   where lower(email) in ('michael+resettest@planyr.io', 'michael+invitetest@planyr.io');
  n_users := coalesce(array_length(v_ids, 1), 0);
  if n_users > 2 then
    raise exception 'refusing: % users match the two addresses (expected at most 2)', n_users;
  end if;
  if exists (select 1 from auth.users where id = any (v_ids)
              and lower(email) not in ('michael+resettest@planyr.io', 'michael+invitetest@planyr.io')) then
    raise exception 'refusing: a matched id has a different address';
  end if;

  delete from public.mailbox_proofs
   where user_id = any (v_ids) and lower(email) in ('michael+resettest@planyr.io', 'michael+invitetest@planyr.io');
  delete from public.team_members     where user_id = any (v_ids);
  delete from public.team_invites     where lower(email) in ('michael+resettest@planyr.io', 'michael+invitetest@planyr.io');
  -- A foreign key from a table that does not cascade (teams.created_by, invited_by …) makes this fail LOUDLY and
  -- the whole block rolls back — nothing is half-deleted. Neither account created a team that still exists.
  delete from auth.users where id = any (v_ids);

  if exists (select 1 from auth.users where lower(email) in ('michael+resettest@planyr.io', 'michael+invitetest@planyr.io'))
     or exists (select 1 from public.mailbox_proofs where lower(email) in ('michael+resettest@planyr.io', 'michael+invitetest@planyr.io')) then
    raise exception 'cleanup incomplete';
  end if;
  raise notice 'cleaned % throwaway account(s)', n_users;
end $$;

-- Read-only confirmation (expected: 0, 0, 0):
select (select count(*) from auth.users where lower(email) in ('michael+resettest@planyr.io', 'michael+invitetest@planyr.io')) as users_left,
       (select count(*) from public.mailbox_proofs where lower(email) in ('michael+resettest@planyr.io', 'michael+invitetest@planyr.io')) as proofs_left,
       (select count(*) from public.team_invites where lower(email) in ('michael+resettest@planyr.io', 'michael+invitetest@planyr.io')) as invites_left;
