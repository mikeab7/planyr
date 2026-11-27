-- "Connect to Claude": per-person, read-only OAuth for Planyr's MCP connector (AI agent access, part 2, 2026-11-27).
-- Run ONCE via the Supabase MCP apply_migration (project lyeqzkuiwngunutlkkmi). Idempotent and additive: it creates
-- new tables, new functions, one new NOLOGIN role and one trigger on auth.users, and changes nothing that exists.
--
-- THE THREE RULES (adversarial review "AI agent access", blockers A1-A3):
--   1. ROW-LEVEL SECURITY DECIDES WHAT CLAUDE SEES. Every connector read runs in public.mcp_read(), a SECURITY DEFINER
--      function OWNED BY the role mcp_reader. That role is NOLOGIN, NOBYPASSRLS and a member of `authenticated`, and
--      the function sets the request's JWT claims to the grant's user. Inside it, current_user = mcp_reader and
--      auth.uid() = the person, so the SAME policies that guard the app (own rows + team-shared rows) decide every row.
--      There is no user_id filter to forget, and a query bug cannot reach a stranger's rows.
--   2. CLAUDE'S TOKEN CANNOT WRITE ANYTHING. Tokens are opaque random strings, stored only as SHA-256 hashes, that only
--      /api/mcp understands. They are not JWTs: PostgREST, Storage and every other /api route refuse them. mcp_read is
--      STABLE (Postgres refuses INSERT/UPDATE/DELETE inside it) and answers a fixed list of named SELECTs.
--   3. DISCONNECT STOPS THE NEXT CALL. Every /api/mcp call runs mcp_oauth_check(), which reads the grant row live.
--      Disconnect, "sign out on all devices", a password change and account deletion each end the grant and delete
--      its tokens.
--
-- WHO MAY CALL WHAT. RLS is ON with ZERO policies on every table here, and EXECUTE is revoked from public/anon/
-- authenticated on every server function. Only the Cloudflare Functions (service-role key, server-only) call them.
-- Five functions are for the signed-in person, from the app: mcp_oauth_request_info, mcp_oauth_decide,
-- mcp_oauth_my_grants, mcp_oauth_revoke_my_grant and mcp_oauth_revoke_all_my_grants. Each of those acts only on auth.uid()'s own rows.
--
-- LIFETIMES: consent request 10 min · authorization code 10 min, single use · access token 1 hour ·
-- refresh token 30 days, rotated on every use, and a reused refresh token or code revokes the whole grant.
--
-- REVERSIBLE: drop trigger mcp_oauth_password_changed on auth.users; drop function public.mcp_oauth_* and
-- public.mcp_read; drop table public.mcp_oauth_tokens, public.mcp_oauth_codes, public.mcp_oauth_grants,
-- public.mcp_oauth_requests, public.mcp_oauth_clients; revoke authenticated from mcp_reader; drop role mcp_reader.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'mcp_reader') then
    create role mcp_reader nologin nobypassrls inherit;
  end if;
end $$;
-- INHERIT is what lets mcp_reader use authenticated's table grants AND match policies written `to authenticated`
-- (a policy's role list is matched with has_privs_of_role, which honours inheritance).
alter role mcp_reader nologin nobypassrls inherit;
grant authenticated to mcp_reader with inherit true;

create table if not exists public.mcp_oauth_clients (
  client_id     text primary key,
  client_name   text not null check (length(client_name) between 1 and 80),
  redirect_uris text[] not null check (cardinality(redirect_uris) between 1 and 5),
  ip_hash       text,
  created_at    timestamptz not null default now()
);
create table if not exists public.mcp_oauth_requests (
  id             uuid primary key default gen_random_uuid(),
  client_id      text not null references public.mcp_oauth_clients(client_id) on delete cascade,
  redirect_uri   text not null,
  state          text,
  code_challenge text not null,
  scope          text not null default 'planyr.read',
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '10 minutes',
  decided_at     timestamptz
);
create table if not exists public.mcp_oauth_grants (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  client_id      text not null references public.mcp_oauth_clients(client_id) on delete cascade,
  redirect_host  text not null,   -- the host THIS grant's code was sent to (its own fact); the name is read from the client
  scope          text not null,
  created_at     timestamptz not null default now(),
  last_used_at   timestamptz,
  revoked_at     timestamptz,
  revoked_reason text
);
create index if not exists mcp_oauth_grants_user on public.mcp_oauth_grants(user_id);
create table if not exists public.mcp_oauth_codes (
  code_hash      text primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  client_id      text not null references public.mcp_oauth_clients(client_id) on delete cascade,
  redirect_uri   text not null,
  code_challenge text not null,
  scope          text not null,
  expires_at     timestamptz not null default now() + interval '10 minutes',
  used_at        timestamptz,
  grant_id       uuid references public.mcp_oauth_grants(id) on delete cascade
);
create index if not exists mcp_oauth_codes_expires on public.mcp_oauth_codes(expires_at);
create table if not exists public.mcp_oauth_tokens (
  token_hash text primary key,
  grant_id   uuid not null references public.mcp_oauth_grants(id) on delete cascade,
  kind       text not null check (kind in ('access', 'refresh')),
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mcp_oauth_tokens_grant on public.mcp_oauth_tokens(grant_id);
create index if not exists mcp_oauth_tokens_expires on public.mcp_oauth_tokens(expires_at);

alter table public.mcp_oauth_clients  enable row level security;
alter table public.mcp_oauth_requests enable row level security;
alter table public.mcp_oauth_grants   enable row level security;
alter table public.mcp_oauth_codes    enable row level security;
alter table public.mcp_oauth_tokens   enable row level security;
revoke all on public.mcp_oauth_clients, public.mcp_oauth_requests, public.mcp_oauth_grants, public.mcp_oauth_codes, public.mcp_oauth_tokens from public, anon, authenticated;

-- ── helpers (private) ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.mcp_oauth_hash(p text) returns text language sql immutable
as $$ select encode(sha256(convert_to(coalesce(p, ''), 'UTF8')), 'hex') $$;
-- 244 random bits (two v4 UUIDs) as hex, behind a readable prefix. No pgcrypto needed.
create or replace function public.mcp_oauth_secret(p_prefix text) returns text language sql volatile
as $$ select p_prefix || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') $$;
create or replace function public.mcp_oauth_host(p_uri text) returns text language sql immutable
as $$ select lower(substring(p_uri from '^[A-Za-z][A-Za-z0-9+.-]*://([^/:?#]+)')) $$;

-- Two fresh tokens for a grant; the plaintext is returned ONCE and only the hashes are stored.
create or replace function public.mcp_oauth_issue(p_grant uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_at text := public.mcp_oauth_secret('pmcp_at_'); v_rt text := public.mcp_oauth_secret('pmcp_rt_'); v_scope text;
begin
  select scope into v_scope from public.mcp_oauth_grants where id = p_grant;
  insert into public.mcp_oauth_tokens (token_hash, grant_id, kind, expires_at) values
    (public.mcp_oauth_hash(v_at), p_grant, 'access',  now() + interval '1 hour'),
    (public.mcp_oauth_hash(v_rt), p_grant, 'refresh', now() + interval '30 days');
  return jsonb_build_object('ok', true, 'access_token', v_at, 'refresh_token', v_rt, 'token_type', 'Bearer', 'expires_in', 3600, 'scope', v_scope);
end $$;

create or replace function public.mcp_oauth_revoke_grant(p_grant uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.mcp_oauth_grants set revoked_at = coalesce(revoked_at, now()), revoked_reason = coalesce(revoked_reason, p_reason) where id = p_grant;
  delete from public.mcp_oauth_tokens where grant_id = p_grant;
end $$;

-- ── server-only (Cloudflare Functions, service role) ─────────────────────────────────────────────────────────
-- Dynamic client registration. The redirect allow-list is enforced by the Function (functions/api/oauth/_lib.js,
-- unit-tested) AND here: https claude.ai / claude.com callbacks, or loopback http for desktop and command-line clients.
create or replace function public.mcp_oauth_register(p_name text, p_redirect_uris text[], p_ip_hash text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id text; u text;
begin
  if p_redirect_uris is null or cardinality(p_redirect_uris) not between 1 and 5 then return jsonb_build_object('ok', false, 'reason', 'redirect'); end if;
  foreach u in array p_redirect_uris loop
    if not (u in ('https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback')
            or u ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?$') then
      return jsonb_build_object('ok', false, 'reason', 'redirect');
    end if;
  end loop;
  perform pg_advisory_xact_lock(hashtext('mcp_oauth_register'));
  if (select count(*) from public.mcp_oauth_clients where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 20
     or (select count(*) from public.mcp_oauth_clients where created_at > now() - interval '1 day') >= 2000 then
    return jsonb_build_object('ok', false, 'reason', 'throttled');
  end if;
  -- housekeeping: clients nobody ever connected, older than a day
  delete from public.mcp_oauth_clients c where c.created_at < now() - interval '1 day'
    and not exists (select 1 from public.mcp_oauth_grants g where g.client_id = c.client_id)
    and not exists (select 1 from public.mcp_oauth_requests r where r.client_id = c.client_id and r.expires_at > now());
  v_id := 'pmcp_client_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.mcp_oauth_clients (client_id, client_name, redirect_uris, ip_hash)
    values (v_id, left(coalesce(nullif(btrim(p_name), ''), 'Unnamed assistant'), 80), p_redirect_uris, p_ip_hash);
  return jsonb_build_object('ok', true, 'client_id', v_id);
end $$;

-- /oauth/authorize: an unknown client or a redirect_uri that is not an EXACT registered match is refused here, and the
-- Function then shows an error page and never redirects anywhere.
create or replace function public.mcp_oauth_begin(p_client_id text, p_redirect_uri text, p_state text, p_code_challenge text, p_scope text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.mcp_oauth_clients; v_id uuid;
begin
  select * into c from public.mcp_oauth_clients where client_id = p_client_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'client'); end if;
  if p_redirect_uri is null or not (p_redirect_uri = any (c.redirect_uris)) then return jsonb_build_object('ok', false, 'reason', 'redirect'); end if;
  if p_code_challenge is null or p_code_challenge !~ '^[A-Za-z0-9_-]{43}$' then return jsonb_build_object('ok', false, 'reason', 'pkce'); end if;
  delete from public.mcp_oauth_requests where expires_at < now() - interval '1 day';
  insert into public.mcp_oauth_requests (client_id, redirect_uri, state, code_challenge, scope)
    values (p_client_id, p_redirect_uri, left(p_state, 500), p_code_challenge, coalesce(nullif(p_scope, ''), 'planyr.read'))
    returning id into v_id;
  return jsonb_build_object('ok', true, 'request_id', v_id);
end $$;

-- /api/oauth/token, grant_type=authorization_code. p_verifier_challenge = BASE64URL(SHA256(code_verifier)), computed by
-- the Function. A second redemption of the same code revokes the grant the first one created (RFC 6749 4.1.2).
create or replace function public.mcp_oauth_exchange(p_code text, p_client_id text, p_redirect_uri text, p_verifier_challenge text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare k public.mcp_oauth_codes; v_grant uuid;
begin
  select * into k from public.mcp_oauth_codes where code_hash = public.mcp_oauth_hash(p_code) for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid_grant'); end if;
  if k.used_at is not null then
    if k.grant_id is not null then perform public.mcp_oauth_revoke_grant(k.grant_id, 'code_reused'); end if;
    return jsonb_build_object('ok', false, 'error', 'invalid_grant');
  end if;
  update public.mcp_oauth_codes set used_at = now() where code_hash = k.code_hash;   -- spent on ANY attempt, right or wrong
  -- housekeeping (review round 2, LOW 6): a code is worth keeping a day past its 10 minutes (so a late replay still
  -- finds it and revokes), never longer
  delete from public.mcp_oauth_codes where expires_at < now() - interval '1 day';
  if k.expires_at < now() or k.client_id is distinct from p_client_id or k.redirect_uri is distinct from p_redirect_uri
     or k.code_challenge is distinct from p_verifier_challenge then
    return jsonb_build_object('ok', false, 'error', 'invalid_grant');
  end if;
  insert into public.mcp_oauth_grants (user_id, client_id, redirect_host, scope)
    values (k.user_id, k.client_id, coalesce(public.mcp_oauth_host(k.redirect_uri), '?'), k.scope)
    returning id into v_grant;
  update public.mcp_oauth_codes set grant_id = v_grant where code_hash = k.code_hash;
  return public.mcp_oauth_issue(v_grant);
end $$;

-- /api/oauth/token, grant_type=refresh_token. Rotates every time; a refresh token presented twice means it was copied,
-- so the whole grant is revoked (theft detection) -- EXCEPT within 30 seconds of its first use (review round 2, MED 3):
-- a client that retries a refresh whose answer it never received (a dropped connection, two requests racing) would
-- otherwise disconnect a real person. Inside that window the retry gets a fresh pair and nothing is revoked; the
-- price is that a thief holding a copy must race the real client inside the same 30 seconds, which the 1-hour access
-- token and the grant's own revocation paths bound. After it, reuse revokes as before.
create or replace function public.mcp_oauth_refresh(p_refresh text, p_client_id text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.mcp_oauth_tokens; g public.mcp_oauth_grants;
begin
  select * into t from public.mcp_oauth_tokens where token_hash = public.mcp_oauth_hash(p_refresh) and kind = 'refresh' for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid_grant'); end if;
  select * into g from public.mcp_oauth_grants where id = t.grant_id for update;
  if g.revoked_at is not null or g.client_id is distinct from p_client_id then return jsonb_build_object('ok', false, 'error', 'invalid_grant'); end if;
  if t.used_at is not null then
    if t.used_at > now() - interval '30 seconds' then return public.mcp_oauth_issue(g.id); end if;   -- retry grace
    perform public.mcp_oauth_revoke_grant(g.id, 'refresh_reused');
    return jsonb_build_object('ok', false, 'error', 'invalid_grant');
  end if;
  if t.expires_at < now() then return jsonb_build_object('ok', false, 'error', 'invalid_grant'); end if;
  update public.mcp_oauth_tokens set used_at = now() where token_hash = t.token_hash;
  delete from public.mcp_oauth_tokens where grant_id = g.id and kind = 'access';         -- the old access token ends with its refresh
  -- housekeeping (LOW 6): a spent refresh token is kept until it would have expired anyway (so a late replay is still
  -- caught), then goes; expired tokens of every grant go too (indexed on expires_at)
  delete from public.mcp_oauth_tokens where expires_at < now() - interval '1 day';
  return public.mcp_oauth_issue(g.id);
end $$;

-- Every /api/mcp call: is this access token live, and whose is it? Reads the grant row each time, so a Disconnect
-- takes effect on the very next call.
create or replace function public.mcp_oauth_check(p_access text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v record;
begin
  select g.id, g.user_id, g.scope, g.last_used_at into v
    from public.mcp_oauth_tokens t join public.mcp_oauth_grants g on g.id = t.grant_id
   where t.token_hash = public.mcp_oauth_hash(p_access) and t.kind = 'access' and t.expires_at > now() and g.revoked_at is null;
  if not found then return jsonb_build_object('ok', false); end if;
  if v.last_used_at is null or v.last_used_at < now() - interval '1 minute' then
    update public.mcp_oauth_grants set last_used_at = now() where id = v.id;
  end if;
  return jsonb_build_object('ok', true, 'user_id', v.user_id, 'grant_id', v.id, 'scope', v.scope);
end $$;

-- ── for the signed-in person (the app's own Supabase client, role authenticated) ─────────────────────────────
-- What the Allow page shows. The client's name is SELF-REPORTED, which is why the page also names the host it sends you to.
create or replace function public.mcp_oauth_request_info(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r public.mcp_oauth_requests; c public.mcp_oauth_clients;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  select * into r from public.mcp_oauth_requests where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'missing'); end if;
  if r.decided_at is not null then return jsonb_build_object('ok', false, 'reason', 'used'); end if;
  if r.expires_at < now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  select * into c from public.mcp_oauth_clients where client_id = r.client_id;
  return jsonb_build_object('ok', true, 'client_name', c.client_name, 'redirect_host', public.mcp_oauth_host(r.redirect_uri), 'scope', r.scope);
end $$;

-- Allow or Cancel. Single use: a decided or expired request answers nothing new. Allow mints a 10-minute, single-use
-- code bound to this person, the client, the redirect and the PKCE challenge; the app then sends the browser back.
create or replace function public.mcp_oauth_decide(p_id uuid, p_allow boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.mcp_oauth_requests; v_code text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  select * into r from public.mcp_oauth_requests where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'missing'); end if;
  if r.decided_at is not null then return jsonb_build_object('ok', false, 'reason', 'used'); end if;
  if r.expires_at < now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  update public.mcp_oauth_requests set decided_at = now() where id = p_id;
  if not coalesce(p_allow, false) then
    return jsonb_build_object('ok', true, 'redirect_uri', r.redirect_uri, 'state', r.state, 'error', 'access_denied');
  end if;
  v_code := public.mcp_oauth_secret('pmcp_code_');
  insert into public.mcp_oauth_codes (code_hash, user_id, client_id, redirect_uri, code_challenge, scope)
    values (public.mcp_oauth_hash(v_code), auth.uid(), r.client_id, r.redirect_uri, r.code_challenge, r.scope);
  return jsonb_build_object('ok', true, 'redirect_uri', r.redirect_uri, 'state', r.state, 'code', v_code);
end $$;

-- Settings → AI assistants. Never returns a token or a hash.
create or replace function public.mcp_oauth_my_grants() returns table (id uuid, client_name text, redirect_host text, scope text, created_at timestamptz, last_used_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select g.id, c.client_name, g.redirect_host, g.scope, g.created_at, g.last_used_at
    from public.mcp_oauth_grants g join public.mcp_oauth_clients c on c.client_id = g.client_id
   where g.user_id = auth.uid() and g.revoked_at is null order by g.created_at desc
$$;

create or replace function public.mcp_oauth_revoke_my_grant(p_id uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not exists (select 1 from public.mcp_oauth_grants where id = p_id and user_id = auth.uid()) then return false; end if;
  perform public.mcp_oauth_revoke_grant(p_id, 'disconnected');
  return true;
end $$;

-- "Sign out on all devices" (Settings → Account & security) disconnects every assistant too (review A3).
create or replace function public.mcp_oauth_revoke_all_my_grants() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare g uuid; n integer := 0;
begin
  if auth.uid() is null then return 0; end if;
  for g in select id from public.mcp_oauth_grants where user_id = auth.uid() and revoked_at is null loop
    perform public.mcp_oauth_revoke_grant(g, 'signed_out_everywhere');
    n := n + 1;
  end loop;
  return n;
end $$;

-- A password change ends every assistant connection (account deletion already cascades through the foreign keys).
create or replace function public.mcp_oauth_password_changed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare g uuid;
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    for g in select id from public.mcp_oauth_grants where user_id = new.id and revoked_at is null loop
      perform public.mcp_oauth_revoke_grant(g, 'password_changed');
    end loop;
  end if;
  return new;
exception when others then
  -- never block a password change on this, but never be silent either (review round 2, MED 4): the warning lands in
  -- the Postgres log, and Settings -> AI assistants still lists the connection so the person can Disconnect it
  raise warning 'mcp_oauth_password_changed: could not revoke assistant grants for user %: % (%)', new.id, sqlerrm, sqlstate;
  return new;
end $$;
drop trigger if exists mcp_oauth_password_changed on auth.users;
create trigger mcp_oauth_password_changed after update of encrypted_password on auth.users
  for each row execute function public.mcp_oauth_password_changed();

-- ── THE connector read (rule 1) ────────────────────────────────────────────────────────────────────────────────
-- Fixed named SELECTs only. Owned by mcp_reader (below), so RLS applies as the person. Columns mirror what the tools
-- in functions/api/mcp/_tools.js always read; a new tool adds a named query here, never a free-form one.
create or replace function public.mcp_read(p_user uuid, p_query text, p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb; q text := coalesce(p_args->>'q', ''); lim int := least(greatest(coalesce((p_args->>'limit')::int, 40), 1), 200);
begin
  if p_user is null then raise exception 'mcp_read: no user'; end if;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
  q := replace(replace(replace(q, '\', ''), '%', ''), '_', '\_');
  case p_query
  when 'schedule_index' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]') into v from (select rows_authoritative from public.schedule_account_index) t;
  when 'schedules_live' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]') into v from (select id, data from public.schedules where deleted_at is null) t;
  when 'planar_hs' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]') into v from (select value from public.planar_data where key = 'hs-v1') t;
  when 'sites_light' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]') into v from (
      select id, group_id, site, name, county, updated_at, data->>'status' as status, data->'origin'->>'lat' as lat, data->'origin'->>'lon' as lon,
             data->>'scheduleProjectId' as sched_id, data->>'scheduleProjectName' as sched_name from public.sites) t;
  when 'sites_by_group' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]') into v from (select id, site, name, county, updated_at, data from public.sites where group_id::text = p_args->>'id') t;
  when 'site_by_id' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]') into v from (select id, site, name, county, updated_at, data from public.sites where id::text = p_args->>'id') t;
  when 'reviews_truth' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]') into v from (select id, project_id, deleted_at, discipline, item, revision, doc_date from public.doc_reviews) t;
  when 'reviews_for_project' then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.updated_at desc), '[]') into v from (
      select id, title, kind, discipline, item, revision, doc_date, updated_at from public.doc_reviews where project_id::text = p_args->>'id' and deleted_at is null) t;
  when 'reviews_search' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]') into v from (
      select id, title, kind, project_id, discipline, item, revision, doc_date, updated_at from public.doc_reviews
       where title ilike '%' || q || '%' and deleted_at is null limit lim) t;
  when 'facts_light' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]') into v from (select id, review_id, project_id, needs_filing, state from public.file_facts) t;
  when 'facts_full' then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.doc_date desc nulls last), '[]') into v from (
      select id, review_id, category, discipline, item, sheet_number, sheet_title, revision, doc_date, source_file, match_confidence, needs_filing, state, updated_at, project_id
        from public.file_facts) t;
  when 'facts_search' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]') into v from (
      select id, review_id, category, discipline, item, sheet_number, sheet_title, revision, doc_date, source_file, match_confidence, needs_filing, state, updated_at, project_id
        from public.file_facts
       where sheet_title ilike '%' || q || '%' or source_file ilike '%' || q || '%' or item ilike '%' || q || '%' or sheet_number ilike '%' || q || '%'
       limit lim) t;
  when 'drive_search' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]') into v from (select planyr_key, name, updated_at from public.drive_files where name ilike '%' || q || '%' limit lim) t;
  else
    raise exception 'mcp_read: unknown query %', p_query;
  end case;
  return v;
end $$;
-- A new owner needs CREATE on the schema at the moment ownership moves; it is taken back straight after.
grant create on schema public to mcp_reader;
alter function public.mcp_read(uuid, text, jsonb) owner to mcp_reader;
revoke create on schema public from mcp_reader;

-- ── who may execute ──────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.mcp_oauth_hash(text), public.mcp_oauth_secret(text), public.mcp_oauth_host(text),
  public.mcp_oauth_issue(uuid), public.mcp_oauth_revoke_grant(uuid, text),
  public.mcp_oauth_register(text, text[], text), public.mcp_oauth_begin(text, text, text, text, text),
  public.mcp_oauth_exchange(text, text, text, text), public.mcp_oauth_refresh(text, text), public.mcp_oauth_check(text),
  public.mcp_oauth_request_info(uuid), public.mcp_oauth_decide(uuid, boolean), public.mcp_oauth_my_grants(),
  public.mcp_oauth_revoke_my_grant(uuid), public.mcp_oauth_revoke_all_my_grants(), public.mcp_oauth_password_changed(),
  public.mcp_read(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.mcp_oauth_register(text, text[], text), public.mcp_oauth_begin(text, text, text, text, text),
  public.mcp_oauth_exchange(text, text, text, text), public.mcp_oauth_refresh(text, text), public.mcp_oauth_check(text),
  public.mcp_read(uuid, text, jsonb) to service_role;
grant execute on function public.mcp_oauth_request_info(uuid), public.mcp_oauth_decide(uuid, boolean),
  public.mcp_oauth_my_grants(), public.mcp_oauth_revoke_my_grant(uuid), public.mcp_oauth_revoke_all_my_grants() to authenticated;
