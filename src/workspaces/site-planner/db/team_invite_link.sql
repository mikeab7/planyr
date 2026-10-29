-- Team invite LINK + account-aware email (NEW-2 / NEW-3, 2026-10-29) — run ONCE in the Supabase SQL
-- editor (project lyeqzkuiwngunutlkkmi), AFTER db/team_invite_email.sql and db/team_invite_inbox.sql.
-- Idempotent; safe to re-run. Purely additive: an older client/function that ignores the new keys works.
--
-- WHAT IT DOES
--   1) claim_invite_send() now also returns has_account — whether the invited address already has a
--      Planyr account. The Pages Function uses it to word the email ("Accept invitation" for someone
--      with an account, "Join team" for someone who must sign up). Read here, inside the SECURITY
--      DEFINER function, so the Cloudflare function never needs the service-role key.
--   2) invite_preview(invite_id) — what the invite LINK needs before anyone is signed in: the invited
--      address (to pre-fill the sign-in / sign-up form), the team, and whether the address already
--      has an account (to open the right tab). The key is the invite row's own random uuid (122 bits,
--      unguessable) — the link carries that id, never the email. Callable signed out (anon) because the
--      whole point is to pre-fill the sign-in screen. It reveals the address ONLY for an OPEN invite; a
--      claimed / declined / unknown id answers a status and nothing else. team_invites RLS is NOT widened.

create or replace function public.claim_invite_send(p_team uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_window constant interval := interval '60 seconds';
  v_uid   uuid := auth.uid();
  v_inv   public.team_invites%rowtype;
  v_team  text;
  v_name  text;
  v_left  int;
  v_has   boolean;
begin
  if v_uid is null or not public.is_team_admin(p_team) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select * into v_inv from public.team_invites
   where team_id = p_team and lower(email) = lower(trim(coalesce(p_email, '')))
     and claimed_at is null
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_inv.last_sent_at is not null and v_inv.last_sent_at > now() - c_window then
    v_left := greatest(1, ceil(extract(epoch from (v_inv.last_sent_at + c_window - now())))::int);
    return jsonb_build_object('ok', false, 'reason', 'throttled', 'retry_after_seconds', v_left);
  end if;

  update public.team_invites set last_sent_at = now() where id = v_inv.id;

  select name into v_team from public.teams where id = p_team;
  select coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email, 'A teammate')
    into v_name from public.profiles p where p.id = v_uid;
  select exists (select 1 from auth.users u where lower(trim(u.email)) = lower(trim(v_inv.email))) into v_has;

  return jsonb_build_object(
    'ok', true,
    'invite_id', v_inv.id,
    'email', v_inv.email,
    'role', v_inv.role,
    'team_name', coalesce(v_team, 'your team'),
    'inviter_name', coalesce(v_name, 'A teammate'),
    'prev_sent_at', v_inv.last_sent_at,
    'has_account', coalesce(v_has, false)
  );
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

revoke all on function public.claim_invite_send(uuid, text) from public;
grant execute on function public.claim_invite_send(uuid, text) to authenticated;
revoke all on function public.invite_preview(uuid) from public;
grant execute on function public.invite_preview(uuid) to anon, authenticated;
