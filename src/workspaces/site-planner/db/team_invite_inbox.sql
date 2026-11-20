-- Team invite INBOX (NEW-1, 2026-10-28) — run ONCE in the Supabase SQL editor
-- (project lyeqzkuiwngunutlkkmi), AFTER db/teams.sql and db/team_invite_guard.sql. Idempotent.
--
-- WHAT IT DOES: someone who ALREADY has a Planyr account and is invited to a team afterwards now
-- sees that invite in the account menu (top right) and answers it — Accept or Decline — instead of
-- being added silently the next time the app loads.
--   1) team_invites.declined_at     — set when the invitee declines. NULL = still open (or accepted).
--   2) list_my_invites()            — the caller's OPEN invites (team, who invited, role). SECURITY
--                                     DEFINER, keyed on the caller's own auth email, trimmed and
--                                     case-insensitive. team_invites RLS is NOT widened.
--   3) respond_to_invite(id, bool)  — accept (adds the team_members row at the invited role and
--                                     stamps THAT invite claimed) or decline (stamps declined_at).
--                                     Per-invite, never claim-all. Another person's invite id
--                                     answers 'not_found' — it cannot be read or answered.
--   4) claim_team_invites() is a no-op and the "self join via invite" policy is gone (NEW-1, 2026-11-02): an
--      address match is not proof of the mailbox while email confirmation is off. handle_new_user() no
--      longer joins anyone either. See db/team_invite_proof.sql for how an invitee proves it (the emailed
--      link) — the functions below are re-created there with that rule.
-- team_invites still has no UPDATE policy: these SECURITY DEFINER functions are the only writers.

alter table public.team_invites add column if not exists declined_at timestamptz;

-- 4a) NEW-1 (2026-11-02): no client self-join policy (see db/team_invite_proof.sql). Dropped, never re-created.
drop policy if exists "self join via invite" on public.team_members;

-- 4b) claim-all is a NO-OP (NEW-1, 2026-11-02): it used to add the caller to every team whose open invite matched
-- their address, which is not proof of the mailbox while email confirmation is off. Kept (granted, returns 0)
-- so an older cached client calling it on load does not error.
create or replace function public.claim_team_invites()
returns integer language plpgsql security definer set search_path = public as $$
begin
  return 0;
end;
$$;

-- 2) The caller's open invites, newest first.
create or replace function public.list_my_invites()
returns table (invite_id uuid, team_id uuid, team_name text, role text,
               invited_by_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, i.team_id, t.name, i.role,
         coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email, 'A teammate'),
         i.created_at
  from public.team_invites i
  join public.teams t on t.id = i.team_id
  left join public.profiles p on p.id = i.invited_by
  where i.claimed_at is null and i.declined_at is null
    and lower(trim(i.email)) = (select lower(trim(u.email)) from auth.users u where u.id = auth.uid())
  order by i.created_at desc;
$$;

-- 3) Answer ONE invite. Returns {ok, status:'accepted'|'declined'} or {ok:false, reason}.
create or replace function public.respond_to_invite(p_invite uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_inv   public.team_invites%rowtype;
  v_team  text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  select lower(trim(email)) into v_email from auth.users where id = v_uid;
  if v_email is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  select * into v_inv from public.team_invites
   where id = p_invite and lower(trim(email)) = v_email
   for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select name into v_team from public.teams where id = v_inv.team_id;

  -- A double-click or a second tab answering the same invite is a no-op success, not an error.
  if v_inv.claimed_at is not null then
    return jsonb_build_object('ok', true, 'status', 'accepted', 'team_id', v_inv.team_id, 'team_name', v_team);
  end if;
  if v_inv.declined_at is not null then
    if p_accept then return jsonb_build_object('ok', false, 'reason', 'declined'); end if;
    return jsonb_build_object('ok', true, 'status', 'declined', 'team_id', v_inv.team_id, 'team_name', v_team);
  end if;

  if p_accept then
    insert into public.team_members (team_id, user_id, role, added_by)
      values (v_inv.team_id, v_uid, v_inv.role, v_inv.invited_by)
      on conflict (team_id, user_id) do nothing;
    update public.team_invites set claimed_at = now() where id = v_inv.id;
    return jsonb_build_object('ok', true, 'status', 'accepted', 'team_id', v_inv.team_id, 'team_name', v_team);
  end if;

  update public.team_invites set declined_at = now() where id = v_inv.id;
  return jsonb_build_object('ok', true, 'status', 'declined', 'team_id', v_inv.team_id, 'team_name', v_team);
end;
$$;

revoke all on function public.list_my_invites()                from public, anon;
revoke all on function public.respond_to_invite(uuid, boolean) from public, anon;
grant execute on function public.list_my_invites()                to authenticated;
grant execute on function public.respond_to_invite(uuid, boolean) to authenticated;
