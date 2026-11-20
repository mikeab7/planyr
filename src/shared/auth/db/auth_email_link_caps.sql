-- "Planyr emails you a sign-in / reset link" — send caps + existing-account lookup (NEW-1).
-- Run ONCE in the Supabase SQL editor / MCP apply_migration (project lyeqzkuiwngunutlkkmi).
-- Idempotent, additive, safe to re-run. Touches nothing that already exists.
--
-- WHAT IT IS FOR. POST /api/auth/email-link (functions/api/auth/email-link.js) mails an existing
-- account's own inbox a one-time link. It deliberately skips Turnstile, so THESE caps are the only thing
-- standing between that route and a stranger using it to fill someone's inbox. They are checked and
-- recorded in ONE function under ONE lock, so two simultaneous requests cannot both slip under a cap.
--
-- ONLY THE SERVER CAN CALL IT. RLS is on with ZERO policies on both tables and EXECUTE is revoked from
-- public / anon / authenticated on both functions; the Cloudflare Function reaches them with the
-- service-role key, which never leaves the server. Nothing here is readable or writable from a browser.
--
-- WHAT IS STORED. Keyed hashes only (HMAC of the address and of the IP, keyed by a server secret), never
-- an address and never an IP, and rows are deleted after a day.
--
-- THE LOOKUP. claim_auth_email_link() also answers "does an account with this address exist" (returns its
-- id or null). It is a SECURITY DEFINER read of auth.users, executable only by the service role, so it
-- is the server's private question — the route's reply to the browser is the same either way.
--
-- DEFAULTS (config table, one UPDATE to change, no deploy): 60 s between sends to one address, 3 per
-- address per hour, 10 per IP per hour, 60 per hour for the whole project. Google Workspace allows
-- ~2,000 sends a day, so the project-wide ceiling is far below the provider's own.
--
-- REVERSIBLE: drop function public.claim_auth_email_link(text,text,text,text);
--             drop function public.release_auth_email_link(bigint);
--             drop table public.auth_email_link_log; drop table public.auth_email_link_config;

create table if not exists public.auth_email_link_config (
  id                boolean     primary key default true,
  address_cooldown_s int        not null default 60,
  per_address_hour  int         not null default 3,
  per_ip_hour       int         not null default 10,
  global_hour       int         not null default 60,
  updated_at        timestamptz not null default now(),
  constraint auth_email_link_config_singleton check (id)
);
insert into public.auth_email_link_config (id) values (true) on conflict (id) do nothing;

create table if not exists public.auth_email_link_log (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  purpose    text        not null check (purpose in ('reset', 'signin')),
  email_key  text        not null,
  ip_key     text        not null
);
create index if not exists auth_email_link_log_email_idx on public.auth_email_link_log (email_key, created_at);
create index if not exists auth_email_link_log_ip_idx    on public.auth_email_link_log (ip_key, created_at);
create index if not exists auth_email_link_log_time_idx  on public.auth_email_link_log (created_at);

alter table public.auth_email_link_config enable row level security;
alter table public.auth_email_link_log    enable row level security;
-- Deliberately zero policies (same discipline as admin_users / signup_rate_limit_config).
revoke all on public.auth_email_link_config from public, anon, authenticated;
revoke all on public.auth_email_link_log    from public, anon, authenticated;

-- Claim one send. Returns jsonb:
--   { ok:false, reason:'address_cooldown'|'address_hour'|'ip_hour'|'global_hour', retry_after_seconds:n }
--   { ok:true,  claim_id:n, user_id: <uuid or null>, cooldown_seconds:n }
-- A refusal is decided BEFORE the lookup, and the same caps count an unknown address exactly like a real
-- one, so a refusal says nothing about whether an account exists.
create or replace function public.claim_auth_email_link(p_email text, p_email_key text, p_ip_key text, p_purpose text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cfg   public.auth_email_link_config%rowtype;
  v_now timestamptz := clock_timestamp();
  v_last timestamptz;
  v_n   int;
  v_oldest timestamptz;
  v_uid uuid;
  v_id  bigint;
begin
  if p_purpose is null or p_purpose not in ('reset', 'signin') then raise exception 'bad purpose'; end if;
  if coalesce(p_email_key, '') = '' or coalesce(p_ip_key, '') = '' then raise exception 'bad key'; end if;

  perform pg_advisory_xact_lock(hashtext('auth_email_link_claim'));
  select * into cfg from public.auth_email_link_config where id;
  if not found then raise exception 'auth_email_link_config missing'; end if;  -- fail CLOSED: the route refuses and logs
  delete from public.auth_email_link_log where created_at < v_now - interval '1 day';

  -- 1) one send per address per cooldown
  select max(created_at) into v_last from public.auth_email_link_log where email_key = p_email_key;
  if v_last is not null and v_last > v_now - make_interval(secs => cfg.address_cooldown_s) then
    return jsonb_build_object('ok', false, 'reason', 'address_cooldown',
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_last + make_interval(secs => cfg.address_cooldown_s) - v_now)))::int));
  end if;
  -- 2) per address per hour
  select count(*), min(created_at) into v_n, v_oldest from public.auth_email_link_log where email_key = p_email_key and created_at > v_now - interval '1 hour';
  if v_n >= cfg.per_address_hour then
    return jsonb_build_object('ok', false, 'reason', 'address_hour', 'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_oldest + interval '1 hour' - v_now)))::int));
  end if;
  -- 3) per IP per hour
  select count(*), min(created_at) into v_n, v_oldest from public.auth_email_link_log where ip_key = p_ip_key and created_at > v_now - interval '1 hour';
  if v_n >= cfg.per_ip_hour then
    return jsonb_build_object('ok', false, 'reason', 'ip_hour', 'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_oldest + interval '1 hour' - v_now)))::int));
  end if;
  -- 4) the whole project
  select count(*), min(created_at) into v_n, v_oldest from public.auth_email_link_log where created_at > v_now - interval '1 hour';
  if v_n >= cfg.global_hour then
    return jsonb_build_object('ok', false, 'reason', 'global_hour', 'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_oldest + interval '1 hour' - v_now)))::int));
  end if;

  select id into v_uid from auth.users where lower(email) = lower(btrim(p_email)) and deleted_at is null limit 1;
  insert into public.auth_email_link_log (purpose, email_key, ip_key) values (p_purpose, p_email_key, p_ip_key) returning id into v_id;
  return jsonb_build_object('ok', true, 'claim_id', v_id, 'user_id', v_uid, 'cooldown_seconds', cfg.address_cooldown_s);
end;
$$;

-- Give a claim back when the mail did NOT go out (link could not be made, Gmail refused): a failed send
-- must not spend the person's allowance. Deleting is safe — it only ever frees capacity for a retry.
create or replace function public.release_auth_email_link(p_claim_id bigint)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$ delete from public.auth_email_link_log where id = p_claim_id; $$;

revoke all on function public.claim_auth_email_link(text, text, text, text) from public, anon, authenticated;
revoke all on function public.release_auth_email_link(bigint) from public, anon, authenticated;
grant execute on function public.claim_auth_email_link(text, text, text, text) to service_role;
grant execute on function public.release_auth_email_link(bigint) to service_role;
