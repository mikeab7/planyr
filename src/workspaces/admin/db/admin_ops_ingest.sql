-- Ops digest auto-refresh (B2159504, follow-up to B711908).
-- The Ops page's "Outstanding work" digest used to move only when someone ran
-- `node scripts/ops-snapshot.mjs --sql` by hand. The Build workflow now pushes it after every merge to
-- main (job `ops-digest`), and CI has no admin session, so the door is a SECURITY DEFINER function that
-- takes a long random INGEST TOKEN instead. Only the token's SHA-256 is stored; the token itself lives in
-- the repo's GitHub Actions secret OPS_INGEST_TOKEN and nowhere in this file or the database.
--
-- ONE-TIME SETUP (the owner): pick a random string of 32+ characters, save it as the GitHub Actions
-- secret OPS_INGEST_TOKEN (Settings → Secrets and variables → Actions), then run this once in the
-- Supabase SQL editor, pasting the SAME string where it says PASTE-THE-SAME-VALUE:
--   insert into public.ops_ingest_tokens(token_hash, label)
--   values (encode(sha256(convert_to('PASTE-THE-SAME-VALUE', 'utf8')), 'hex'), 'github-main');
-- Rotating = insert the new hash, update the secret, delete the old row.

create table if not exists public.ops_ingest_tokens (
  token_hash text        primary key,
  label      text,
  created_at timestamptz not null default now()
);
alter table public.ops_ingest_tokens enable row level security;   -- zero policies, like admin_users

-- p_snapshots: { "backlog": {...payload}, "verification": {...payload} }. Each payload carries
-- `commit` (full sha) and `committedAt` (ISO) so (a) the page can say "after <short commit>" and
-- (b) an older merge's run that finishes LATE can never overwrite a newer digest.
create or replace function public.ops_ingest_snapshots(p_token text, p_snapshots jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  k text;
  applied text[] := '{}';
  skipped text[] := '{}';
  have timestamptz;
  incoming timestamptz;
begin
  if p_token is null or length(p_token) < 32
     or not exists (select 1 from public.ops_ingest_tokens t
                    where t.token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_snapshots is null or jsonb_typeof(p_snapshots) <> 'object' then raise exception 'bad payload'; end if;
  for k in select jsonb_object_keys(p_snapshots) loop
    if k not in ('backlog', 'verification') then raise exception 'bad key %', k; end if;
    incoming := nullif(p_snapshots -> k ->> 'committedAt', '')::timestamptz;
    select nullif(payload ->> 'committedAt', '')::timestamptz into have from public.ops_snapshots where key = k;
    if have is not null and incoming is not null and incoming < have then
      skipped := skipped || k;   -- an older merge finishing late
    else
      insert into public.ops_snapshots(key, payload, updated_at) values (k, p_snapshots -> k, now())
      on conflict (key) do update set payload = excluded.payload, updated_at = now();
      applied := applied || k;
    end if;
  end loop;
  return jsonb_build_object('applied', to_jsonb(applied), 'skipped', to_jsonb(skipped));
end;
$$;
revoke all on function public.ops_ingest_snapshots(text, jsonb) from public;
grant execute on function public.ops_ingest_snapshots(text, jsonb) to anon, authenticated;
