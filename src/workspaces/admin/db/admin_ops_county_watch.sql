-- Unresolved-county watch (NEW-1, 2026-11-12) — the weekly "where people are working" sweep groups the product's use by
-- `sites.county`. A plan with drawn parcels and NO county never joins any area, so the sweep (and every county-keyed
-- feature: parcel source, tax, jurisdiction, zoning) silently ignores it. On 2026-11-01 there was exactly one (a Harris
-- plan created 10-21 with one drawn lot that never resolved its county). This watches the count nightly.
--
-- SAME DOOR AS THE OPS DIGEST (admin_ops_ingest.sql): CI has no admin session, so this is a SECURITY DEFINER function gated by
-- the same ingest token (only its SHA-256 lives in public.ops_ingest_tokens). It is AGGREGATE-ONLY: it returns a number and
-- two dates, never a site id, a name or a user — and it READS `sites` only; it never writes one. The single write is its own
-- `unresolved_county` row in public.ops_snapshots, which carries `since` (when the count last went from 0 to above 0) so
-- "above zero for more than a week" is decidable by a stateless nightly runner.
--
-- Run once in the Supabase SQL editor (after admin_ops_ingest.sql). Until it exists the nightly step says so and stays green.

create or replace function public.ops_unresolved_county_watch(p_token text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  n int;
  prev jsonb;
  since_at timestamptz;
  age_days numeric;
begin
  if p_token is null or length(p_token) < 32
     or not exists (select 1 from public.ops_ingest_tokens t
                    where t.token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- jsonb_typeof guard: jsonb_array_length raises on a non-array, and one odd row must not blind the whole watch.
  select count(*) into n
    from public.sites s
   where s.deleted_at is null
     and s.county is null
     and case when jsonb_typeof(s.data -> 'parcels') = 'array' then jsonb_array_length(s.data -> 'parcels') > 0 else false end;

  select payload into prev from public.ops_snapshots where key = 'unresolved_county';
  since_at := nullif(prev ->> 'since', '')::timestamptz;
  if n = 0 then
    since_at := null;                                   -- back to clean: the clock resets
  elsif since_at is null then
    since_at := now();                                  -- first night above zero
  end if;
  age_days := case when since_at is null then 0 else round(extract(epoch from (now() - since_at)) / 86400.0, 2) end;

  insert into public.ops_snapshots(key, payload, updated_at)
  values ('unresolved_county', jsonb_build_object('count', n, 'since', since_at, 'days', age_days, 'checkedAt', now()), now())
  on conflict (key) do update set payload = excluded.payload, updated_at = now();

  return jsonb_build_object('count', n, 'since', since_at, 'days', age_days, 'alert', n > 0 and age_days > 7);
end;
$$;
revoke all on function public.ops_unresolved_county_watch(text) from public;
grant execute on function public.ops_unresolved_county_watch(text) to anon, authenticated;
