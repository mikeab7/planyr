-- Team invite MUST PROVE THE MAILBOX (NEW-1, 2026-11-02) — run ONCE in the Supabase SQL editor
-- (project lyeqzkuiwngunutlkkmi), AFTER db/teams.sql, team_invite_guard.sql, team_invite_inbox.sql,
-- team_invite_email.sql and team_invite_link.sql. Idempotent; safe to re-run. Drops no data and removes no member.
--
-- THE HOLE: `mailer_autoconfirm` is ON, so nobody proves they own the address they sign up with. Five doors
-- nevertheless treated "this account's address matches an open team_invites row" as proof of the mailbox:
--   1. handle_new_user()              joined a new account to every team that had invited that address;
--   2. claim_team_invites()           the same, on demand;
--   3. policy "self join via invite"  a raw client INSERT into team_members by address match;
--   4. policy "invitee reads own"     read the invite row (its id, team, role) by address match;
--   5. list_my_invites()/respond_to_invite()   listed and answered by address match.
-- A stranger who knew or guessed an invited address could sign up with it and be on the team.
--
-- THE RULE: the emailed LINK is the proof. Its id is the invite row's own random uuid (gen_random_uuid, v4: 122
-- random bits), it is only ever emailed to the invited address, and no open invite row is readable by anyone but
-- the team's admins (the "invitee reads own" policy is gone; list_my_invites withholds the id until proven).
-- Nobody joins by address alone.
--   * public.mailbox_proofs (user_id, email, via, proven_at)  — "this account proved THIS address". RLS on, no
--       policy, no client privilege: only the SECURITY DEFINER functions below (and, for a Planyr emailed link,
--       the service-role hook prove_mailbox) write it. A proof belongs to the address it was given for: change
--       the account's address and it stops counting.
--   * redeem_invite_link(invite, accept)  — the link holder, signed in as the invited address: proves the mailbox
--       and joins (or declines). Signed in as a DIFFERENT address -> 'wrong_account', nothing changes.
--   * respond_to_invite / list_my_invites — the account-menu inbox. A PROVEN mailbox sees and answers its invites
--       as before; an UNPROVEN one is told only that an invitation is waiting (no id, team, inviter or role).
--   * claim_invite_resend_for / release_invite_resend — service role only. The invitee-side "email me the invite
--       again", with the same 60 s server throttle as the admin's resend. Service-only on purpose: the invite id
--       must never reach an unproven browser.
--   * invite_signup_begin / invite_signup_finish — service role only. The Turnstile-free account creation for a
--       person arriving by a valid link (functions/api/auth/invite-signup.js), capped per invite.
--   * prove_mailbox — service role only. THE HOOK for any other Planyr emailed link (the "sign-in emails sent by
--       Planyr" feature): it verifies the address is the account's current one and records the proof.

-- 1) The proof table -----------------------------------------------------------------------------------------
create table if not exists public.mailbox_proofs (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  email      text        not null,                 -- lower(trim()) of the address that was proven
  via        text        not null,                 -- 'invite_link' | 'emailed_link' | ...
  proven_at  timestamptz not null default now(),
  primary key (user_id, email)
);
alter table public.mailbox_proofs enable row level security;       -- no policy: nothing is readable or writable by a client
revoke all on public.mailbox_proofs from public, anon, authenticated;

-- 2) Is this account's CURRENT address proven? (internal; not callable by a client) ----------------------------
create or replace function public.mailbox_is_proven(p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.mailbox_proofs m
    join auth.users u on u.id = m.user_id
    where m.user_id = p_uid and m.email = lower(trim(u.email))
  );
$$;
revoke all on function public.mailbox_is_proven(uuid) from public, anon, authenticated;

-- 3) The server-side hook for a Planyr emailed link ---------------------------------------------------------------
create or replace function public.prove_mailbox(p_user uuid, p_email text, p_via text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_given text := lower(trim(coalesce(p_email, '')));
begin
  select lower(trim(email)) into v_email from auth.users where id = p_user;
  if v_email is null or v_given = '' or v_email <> v_given then
    return jsonb_build_object('ok', false, 'reason', 'address_mismatch');
  end if;
  insert into public.mailbox_proofs (user_id, email, via)
    values (p_user, v_email, coalesce(nullif(trim(p_via), ''), 'emailed_link'))
    on conflict (user_id, email) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.prove_mailbox(uuid, text, text) from public, anon, authenticated;
grant execute on function public.prove_mailbox(uuid, text, text) to service_role;

-- 4) No address-match door into team_members or team_invites ------------------------------------------------------
drop policy if exists "self join via invite" on public.team_members;
drop policy if exists "invitee reads own"    on public.team_invites;

-- 4b) Sign-up no longer joins anyone. Same profile insert as db/profiles.sql / db/teams.sql, minus the team join: a new
-- account is NOT added to a team because its address matches an open invite (a stranger can type any address). The
-- trigger on_auth_user_created already points at this function name, so re-creating it is enough.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, first_name, last_name, org, email)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'first_name', ''),
    nullif(new.raw_user_meta_data ->> 'last_name', ''),
    nullif(new.raw_user_meta_data ->> 'org', ''),
    lower(new.email)
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

-- 5) Joining. ONE internal routine used by every proven path; callers are SECURITY DEFINER functions only. -----
create or replace function public._join_via_invite(p_inv public.team_invites, p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_team text;
  v_was  boolean;
begin
  select name into v_team from public.teams where id = p_inv.team_id;
  select exists (select 1 from public.team_members where team_id = p_inv.team_id and user_id = p_uid) into v_was;
  insert into public.team_members (team_id, user_id, role, added_by)
    values (p_inv.team_id, p_uid, p_inv.role, p_inv.invited_by)
    on conflict (team_id, user_id) do nothing;
  update public.team_invites set claimed_at = coalesce(claimed_at, now()) where id = p_inv.id;
  return jsonb_build_object('ok', true, 'status', 'accepted', 'team_id', p_inv.team_id, 'team_name', v_team,
                            'role', p_inv.role, 'already_member', v_was);
end;
$$;
revoke all on function public._join_via_invite(public.team_invites, uuid) from public, anon, authenticated;

-- 6) The link holder: prove the mailbox, then join (or decline). ---------------------------------------------------
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
revoke all on function public.redeem_invite_link(uuid, boolean) from public, anon;
grant execute on function public.redeem_invite_link(uuid, boolean) to authenticated;

-- 7) The account-menu inbox ----------------------------------------------------------------------------------------
-- Proven mailbox: the full row. Unproven: ONE row per waiting invitation with everything identifying withheld
-- (the id is the bearer secret in the emailed link; the team name would tell a stranger which team invited them).
drop function if exists public.list_my_invites();
create function public.list_my_invites()
returns table (invite_id uuid, team_id uuid, team_name text, role text,
               invited_by_name text, created_at timestamptz, proven boolean)
language sql stable security definer set search_path = public as $$
  with me as (
    select u.id as uid, lower(trim(u.email)) as email, public.mailbox_is_proven(u.id) as ok
    from auth.users u where u.id = auth.uid()
  )
  select case when me.ok then i.id end,
         case when me.ok then i.team_id end,
         case when me.ok then t.name end,
         case when me.ok then i.role end,
         case when me.ok then coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email, 'A teammate') end,
         i.created_at,
         me.ok
  from me
  join public.team_invites i on lower(trim(i.email)) = me.email
  join public.teams t on t.id = i.team_id
  left join public.profiles p on p.id = i.invited_by
  where i.claimed_at is null and i.declined_at is null
  order by i.created_at desc;
$$;
revoke all on function public.list_my_invites() from public, anon;
grant execute on function public.list_my_invites() to authenticated;

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
revoke all on function public.respond_to_invite(uuid, boolean) from public, anon;
grant execute on function public.respond_to_invite(uuid, boolean) to authenticated;

-- claim-all stays a no-op (also set in db/teams.sql and db/team_invite_inbox.sql).
create or replace function public.claim_team_invites()
returns integer language plpgsql security definer set search_path = public as $$
begin
  return 0;
end;
$$;

-- 8) "Email me the invitation again" for an account that has not proven the mailbox — SERVICE ROLE ONLY -----------
-- The Pages Function (functions/api/team/invite-resend.js) verifies the caller's token, then calls this with the
-- caller's user id. Same 60 s window as claim_invite_send, per invite; if EVERY open invite is inside the window the
-- answer is 'throttled'. The invite ids it returns go to the email, never to the browser.
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
  if not exists (select 1 from public.team_invites i
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

create or replace function public.release_invite_resend(p_invite uuid, p_prev timestamptz)
returns void language sql security definer set search_path = public as $$
  update public.team_invites set last_sent_at = p_prev where id = p_invite;
$$;
revoke all on function public.claim_invite_resend_for(uuid)            from public, anon, authenticated;
revoke all on function public.release_invite_resend(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_invite_resend_for(uuid)            to service_role;
grant execute on function public.release_invite_resend(uuid, timestamptz) to service_role;

-- 9) Turnstile-free account creation for a link holder — SERVICE ROLE ONLY, capped per invite ----------------------
-- A person blocked from Cloudflare cannot pass Turnstile, so cannot sign up. The invite link already proves they
-- hold a mailbox the team wrote to, so the Pages Function creates the account through the admin API instead.
-- begin() counts every attempt against the invite (cap 8 per rolling 24 h); finish() proves + joins.
create table if not exists public.invite_signup_attempts (
  invite_id uuid primary key references public.team_invites(id) on delete cascade,
  attempts  int not null default 0,
  window_start timestamptz not null default now()
);
alter table public.invite_signup_attempts enable row level security;
revoke all on public.invite_signup_attempts from public, anon, authenticated;

create or replace function public.invite_signup_begin(p_invite uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_cap constant int := 8;
  v_inv public.team_invites%rowtype;
  v_n   int;
begin
  select * into v_inv from public.team_invites where id = p_invite for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
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

create or replace function public.invite_signup_finish(p_invite uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_inv   public.team_invites%rowtype;
  v_email text;
begin
  select * into v_inv from public.team_invites where id = p_invite for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select lower(trim(email)) into v_email from auth.users where id = p_user;
  if v_email is null or v_email <> lower(trim(v_inv.email)) then
    return jsonb_build_object('ok', false, 'reason', 'wrong_account');
  end if;
  insert into public.mailbox_proofs (user_id, email, via) values (p_user, v_email, 'invite_link')
    on conflict (user_id, email) do nothing;
  if v_inv.declined_at is not null then return jsonb_build_object('ok', false, 'reason', 'declined'); end if;
  return public._join_via_invite(v_inv, p_user);
end;
$$;
revoke all on function public.invite_signup_begin(uuid)         from public, anon, authenticated;
revoke all on function public.invite_signup_finish(uuid, uuid)  from public, anon, authenticated;
grant execute on function public.invite_signup_begin(uuid)         to service_role;
grant execute on function public.invite_signup_finish(uuid, uuid)  to service_role;
