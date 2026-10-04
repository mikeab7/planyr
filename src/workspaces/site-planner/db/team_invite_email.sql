-- Team invite EMAILS (NEW-1, 2026-10-04) — run ONCE in the Supabase SQL editor
-- (project lyeqzkuiwngunutlkkmi), AFTER db/teams.sql. Idempotent; safe to re-run.
--
-- WHAT IT DOES: lets the /api/team/invite-email Pages Function record "this invite was just
-- emailed" and refuse a second send inside the throttle window — enforced HERE, in the database,
-- so a client that skips the button's disabled state still can't spam an inbox.
--   1) team_invites.last_sent_at  — when the invite was last emailed. NULL = never emailed.
--      Existing pending invites stay NULL: nothing is emailed by this migration.
--   2) claim_invite_send()   — admin-only. Atomically checks the 60 s window and, if clear,
--      stamps last_sent_at = now() and returns what the email needs (inviter, team, role).
--      Two simultaneous calls cannot both win (row lock).
--   3) release_invite_send() — admin-only. If the provider then FAILS, the function gives the
--      slot back (restores the previous stamp) so "Try Resend" isn't blocked by an email
--      that never left.
-- team_invites still has no UPDATE policy: these SECURITY DEFINER functions are the only writers.

alter table public.team_invites add column if not exists last_sent_at timestamptz;

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

  return jsonb_build_object(
    'ok', true,
    'invite_id', v_inv.id,
    'email', v_inv.email,
    'role', v_inv.role,
    'team_name', coalesce(v_team, 'your team'),
    'inviter_name', coalesce(v_name, 'A teammate'),
    'prev_sent_at', v_inv.last_sent_at
  );
end;
$$;

create or replace function public.release_invite_send(p_invite uuid, p_prev timestamptz)
returns void
language sql
security definer
set search_path = public
as $$
  update public.team_invites set last_sent_at = p_prev
   where id = p_invite and public.is_team_admin(team_id);
$$;

revoke all on function public.claim_invite_send(uuid, text)         from public;
revoke all on function public.release_invite_send(uuid, timestamptz) from public;
grant execute on function public.claim_invite_send(uuid, text)         to authenticated;
grant execute on function public.release_invite_send(uuid, timestamptz) to authenticated;
