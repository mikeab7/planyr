-- Admin password reset (B1160722, NEW-3) — run ONCE in the Supabase SQL editor
-- (project lyeqzkuiwngunutlkkmi), idempotent, safe to re-run.
--
-- WHY: Supabase's password-reset EMAIL goes through the same rate-capped, "not for
-- production" built-in mailer as the confirmation email (see OWNER-TODO.md's B1167 item),
-- so an admin needs a way to reset a teammate's password with no email involved at all —
-- generate a new one, read it to them over the phone/Slack, done. This never displays an
-- EXISTING password (they're bcrypt-hashed and genuinely unrecoverable, by design); it
-- only ever generates and stores a brand new one.
--
-- ACCESS: gated on is_admin() INSIDE the function itself (raises for a non-admin caller),
-- the same door every other admin RPC in this repo uses — never a client-visible button
-- that merely hides itself, and never a SELECT policy on admin_users. A non-admin who
-- somehow calls this RPC directly gets an error, not a password.
--
-- HOW A PASSWORD IS SET WITHOUT the service-role admin API: Supabase Auth (GoTrue) stores
-- password hashes in auth.users.encrypted_password using bcrypt via pgcrypto's crypt()/
-- gen_salt('bf') — the SAME algorithm and column a normal signIn checks against — so a
-- SECURITY DEFINER function can write a new hash directly and GoTrue accepts it on the
-- next sign-in with no other change needed. pgcrypto is already installed on this project.

create table if not exists public.admin_password_resets (
  id             uuid        primary key default gen_random_uuid(),
  admin_id       uuid        references auth.users(id) on delete cascade,
  target_user_id uuid        not null references auth.users(id) on delete cascade,
  at             timestamptz not null default now()
);
alter table public.admin_password_resets enable row level security;
-- Deliberately zero policies — same discipline as admin_users.sql. Written only by the
-- SECURITY DEFINER function below; read only through admin_list_password_resets().
create index if not exists admin_password_resets_at_idx on public.admin_password_resets (at desc);

-- A readable, high-entropy temporary password: 16 characters from a 55-character
-- unambiguous alphabet (no 0/O/1/l/I — easy to read aloud or re-type), grouped in 4s,
-- drawn from pgcrypto's gen_random_bytes (a real CSPRNG, not plpgsql's random()).
-- ~92 bits of entropy; a small modulo bias from 256 not dividing evenly by 55 is
-- immaterial for a one-time, admin-read, immediately-changeable credential.
create or replace function public.admin_generate_password()
returns text
language plpgsql
set search_path = public, extensions
as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  alen     int  := length(alphabet);
  raw      bytea := extensions.gen_random_bytes(16);
  result   text := '';
  i        int;
begin
  for i in 0..15 loop
    result := result || substr(alphabet, 1 + (get_byte(raw, i) % alen), 1);
    if i in (3, 7, 11) then result := result || '-'; end if;
  end loop;
  return result;
end;
$$;
revoke all on function public.admin_generate_password() from public;

create or replace function public.admin_reset_user_password(p_target_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  new_password text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  if p_target_user_id is null or not exists (select 1 from auth.users where id = p_target_user_id) then
    raise exception 'No such user.' using errcode = 'P0002';
  end if;

  new_password := public.admin_generate_password();

  update auth.users
     set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_target_user_id;

  insert into public.admin_password_resets (admin_id, target_user_id)
  values (auth.uid(), p_target_user_id);

  return new_password;
end;
$$;
revoke all on function public.admin_reset_user_password(uuid) from public;
grant execute on function public.admin_reset_user_password(uuid) to authenticated;

-- The picker: every account (id/email/name), admin-gated. No SELECT policy is ever added
-- to auth.users or profiles for this — this RPC is the only door, matching admin_users.sql.
create or replace function public.admin_list_users()
returns table (id uuid, email text, first_name text, last_name text, org text, created_at timestamptz)
language sql
security definer
set search_path = public, auth
stable
as $$
  select u.id, u.email, p.first_name, p.last_name, p.org, u.created_at
  from auth.users u
  left join public.profiles p on p.id = u.id
  where public.is_admin()
  order by u.created_at desc;
$$;
revoke all on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated;

-- Audit trail read — "record who reset whom and when," made visible without SQL.
create or replace function public.admin_list_password_resets(p_limit int default 100)
returns table (at timestamptz, admin_email text, target_email text)
language sql
security definer
set search_path = public, auth
stable
as $$
  select r.at,
         (select email from auth.users where id = r.admin_id) as admin_email,
         (select email from auth.users where id = r.target_user_id) as target_email
  from public.admin_password_resets r
  where public.is_admin()
  order by r.at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;
revoke all on function public.admin_list_password_resets(int) from public;
grant execute on function public.admin_list_password_resets(int) to authenticated;
