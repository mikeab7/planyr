-- Team invite orphan guard (NEW-1 follow-up, 2026-11-03) — run ONCE in the Supabase SQL editor, AFTER db/team_invite_proof.sql.
-- Idempotent (create or replace only). Drops nothing, deletes no row, removes no member.
--
-- WHY: measured on production 2026-11-03 (planyr_production): `team_invites.team_id` and `team_members.team_id` have NO
-- foreign key to `teams` (the repo's db/teams.sql says ON DELETE CASCADE; the live database does not have it). So deleting a
-- team leaves its invites OPEN and its memberships behind. The link for such an invite previewed as "invited to the team"
-- with an Accept button, and accepting inserted a membership into a team that does not exist. Every path that reads a
-- team now treats a missing team as "this invitation is no longer available" (not_found):
--   invite_preview · redeem_invite_link · respond_to_invite · invite_signup_begin · claim_invite_resend_for · _join_via_invite (the one place a
--   membership is written). list_my_invites already inner-joins teams, so it never lists one.
-- NOT done here (needs an owner call, see B2635969): adding the missing foreign keys, which would have to delete or repair
-- the orphan rows that already exist.

create or replace function public._join_via_invite(p_inv public.team_invites, p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_team text;
  v_was  boolean;
begin
  select name into v_team from public.teams where id = p_inv.team_id;
  if v_team is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select exists (select 1 from public.team_members where team_id = p_inv.team_id and user_id = p_uid) into v_was;
  insert into public.team_members (team_id, user_id, role, added_by)
    values (p_inv.team_id, p_uid, p_inv.role, p_inv.invited_by)
    on conflict (team_id, user_id) do nothing;
  update public.team_invites set claimed_at = coalesce(claimed_at, now()) where id = p_inv.id;
  return jsonb_build_object('ok', true, 'status', 'accepted', 'team_id', p_inv.team_id, 'team_name', v_team,
                            'role', p_inv.role, 'already_member', v_was);
end;
$$;

create or replace function public.redeem_invite_link(p_invite uuid, p_accept boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_inv   public.team_invites%rowtype;
  v_team  text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  select lower(trim(email)) into v_email from auth.users where id = v_uid;
  select * into v_inv from public.team_invites where id = p_invite for update;
  if v_email is null or not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  -- Signed in as someone else: say so, change nothing, prove nothing. (The link's preview already shows the
  -- invited address to whoever holds the link, so naming the reason reveals nothing new.)
  if lower(trim(v_inv.email)) <> v_email then
    return jsonb_build_object('ok', false, 'reason', 'wrong_account');
  end if;

  -- Holding the link a signed-in account of THIS address presents = the mailbox is proven.
  insert into public.mailbox_proofs (user_id, email, via) values (v_uid, v_email, 'invite_link')
    on conflict (user_id, email) do nothing;

  select name into v_team from public.teams where id = v_inv.team_id;
  if v_team is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_inv.claimed_at is not null then
    if exists (select 1 from public.team_members where team_id = v_inv.team_id and user_id = v_uid) then
      return jsonb_build_object('ok', true, 'status', 'accepted', 'team_id', v_inv.team_id, 'team_name', v_team,
                                'role', v_inv.role, 'already_member', true);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'claimed', 'team_name', v_team);
  end if;
  if v_inv.declined_at is not null then
    if p_accept then return jsonb_build_object('ok', false, 'reason', 'declined', 'team_name', v_team); end if;
    return jsonb_build_object('ok', true, 'status', 'declined', 'team_id', v_inv.team_id, 'team_name', v_team);
  end if;

  if p_accept then return public._join_via_invite(v_inv, v_uid); end if;
  update public.team_invites set declined_at = now() where id = v_inv.id;
  return jsonb_build_object('ok', true, 'status', 'declined', 'team_id', v_inv.team_id, 'team_name', v_team);
end;
$$;

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
  -- An address match is not proof of the mailbox. Accept AND decline wait for the proof, or a stranger who signed
  -- up with the address could decline the real invitee's invitation out from under them.
  if not public.mailbox_is_proven(v_uid) then return jsonb_build_object('ok', false, 'reason', 'unproven'); end if;
  select name into v_team from public.teams where id = v_inv.team_id;
  if v_team is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  if v_inv.claimed_at is not null then
    if exists (select 1 from public.team_members where team_id = v_inv.team_id and user_id = v_uid) then
      return jsonb_build_object('ok', true, 'status', 'accepted', 'team_id', v_inv.team_id, 'team_name', v_team);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'claimed');
  end if;
  if v_inv.declined_at is not null then
    if p_accept then return jsonb_build_object('ok', false, 'reason', 'declined'); end if;
    return jsonb_build_object('ok', true, 'status', 'declined', 'team_id', v_inv.team_id, 'team_name', v_team);
  end if;

  if p_accept then return public._join_via_invite(v_inv, v_uid); end if;
  update public.team_invites set declined_at = now() where id = v_inv.id;
  return jsonb_build_object('ok', true, 'status', 'declined', 'team_id', v_inv.team_id, 'team_name', v_team);
end;
$$;

create or replace function public.invite_signup_begin(p_invite uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_cap constant int := 8;
  v_inv public.team_invites%rowtype;
  v_n   int;
begin
  select * into v_inv from public.team_invites where id = p_invite for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not exists (select 1 from public.teams t where t.id = v_inv.team_id) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_inv.claimed_at is not null or v_inv.declined_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_open');
  end if;
  if exists (select 1 from auth.users u where lower(trim(u.email)) = lower(trim(v_inv.email))) then
    return jsonb_build_object('ok', false, 'reason', 'has_account');
  end if;
  insert into public.invite_signup_attempts (invite_id, attempts, window_start) values (v_inv.id, 0, now())
    on conflict (invite_id) do update
      set attempts = case when invite_signup_attempts.window_start < now() - interval '24 hours' then 0 else invite_signup_attempts.attempts end,
          window_start = case when invite_signup_attempts.window_start < now() - interval '24 hours' then now() else invite_signup_attempts.window_start end;
  select attempts into v_n from public.invite_signup_attempts where invite_id = v_inv.id for update;
  if v_n >= c_cap then return jsonb_build_object('ok', false, 'reason', 'too_many'); end if;
  update public.invite_signup_attempts set attempts = attempts + 1 where invite_id = v_inv.id;
  return jsonb_build_object('ok', true, 'email', lower(trim(v_inv.email)), 'invite_id', v_inv.id);
end;
$$;

create or replace function public.invite_preview(p_invite uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_inv  public.team_invites%rowtype;
  v_team text;
  v_by   text;
  v_has  boolean;
begin
  if p_invite is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into v_inv from public.team_invites where id = p_invite;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  select name into v_team from public.teams where id = v_inv.team_id;
  if v_team is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_inv.claimed_at is not null then
    return jsonb_build_object('ok', true, 'status', 'claimed', 'team_name', coalesce(v_team, 'the team'));
  end if;
  if v_inv.declined_at is not null then
    return jsonb_build_object('ok', true, 'status', 'declined', 'team_name', coalesce(v_team, 'the team'));
  end if;

  select coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email, 'A teammate')
    into v_by from public.profiles p where p.id = v_inv.invited_by;
  select exists (select 1 from auth.users u where lower(trim(u.email)) = lower(trim(v_inv.email))) into v_has;

  return jsonb_build_object(
    'ok', true,
    'status', 'open',
    'invite_id', v_inv.id,
    'email', v_inv.email,
    'role', v_inv.role,
    'team_name', coalesce(v_team, 'the team'),
    'invited_by_name', coalesce(v_by, 'A teammate'),
    'has_account', coalesce(v_has, false)
  );
end;
$$;

create or replace function public.claim_invite_resend_for(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_window constant interval := interval '60 seconds';
  v_email text;
  v_items jsonb := '[]'::jsonb;
  v_wait  int := null;
  r       record;
  v_left  int;
begin
  select lower(trim(email)) into v_email from auth.users where id = p_user;
  if v_email is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not exists (select 1 from public.team_invites i join public.teams t on t.id = i.team_id
                 where lower(trim(i.email)) = v_email and i.claimed_at is null and i.declined_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'no_invites');
  end if;
  for r in
    select i.id, i.role, i.last_sent_at, t.name as team_name,
           coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email, 'A teammate') as inviter_name
    from public.team_invites i
    join public.teams t on t.id = i.team_id
    left join public.profiles p on p.id = i.invited_by
    where lower(trim(i.email)) = v_email and i.claimed_at is null and i.declined_at is null
    order by i.created_at
    for update of i
  loop
    if r.last_sent_at is not null and r.last_sent_at > now() - c_window then
      v_left := greatest(1, ceil(extract(epoch from (r.last_sent_at + c_window - now())))::int);
      v_wait := greatest(coalesce(v_wait, 0), v_left);
      continue;
    end if;
    update public.team_invites set last_sent_at = now() where id = r.id;
    v_items := v_items || jsonb_build_object('invite_id', r.id, 'team_name', r.team_name, 'role', r.role,
                                             'inviter_name', r.inviter_name, 'prev_sent_at', r.last_sent_at,
                                             'has_account', true);
  end loop;
  if jsonb_array_length(v_items) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'throttled', 'retry_after_seconds', coalesce(v_wait, 60));
  end if;
  return jsonb_build_object('ok', true, 'email', v_email, 'items', v_items);
end;
$$;
revoke all on function public.claim_invite_resend_for(uuid) from public, anon, authenticated;
grant execute on function public.claim_invite_resend_for(uuid) to service_role;

revoke all on function public._join_via_invite(public.team_invites, uuid) from public, anon, authenticated;
revoke all on function public.invite_signup_begin(uuid) from public, anon, authenticated;
grant execute on function public.invite_signup_begin(uuid) to service_role;
revoke all on function public.redeem_invite_link(uuid, boolean) from public, anon;
grant execute on function public.redeem_invite_link(uuid, boolean) to authenticated;
revoke all on function public.respond_to_invite(uuid, boolean) from public, anon;
grant execute on function public.respond_to_invite(uuid, boolean) to authenticated;
revoke all on function public.invite_preview(uuid) from public;
grant execute on function public.invite_preview(uuid) to anon, authenticated;
