-- NEW-4 — public.sites.county is a ROUTING KEY, so it is normalised on the server too.
--
-- THE BUG. `county` is free text that the whole client uses as an OBJECT KEY
-- (`COUNTIES_MAP[county]`, `COUNTY_DISTRICT[county]`, `defaultJurForCounty(county)`, and now the
-- baked-flood-tile archive pick). Measured on production 2026-08-09:
--
--     county      | n
--     ------------+----
--     harris      | 38
--     Harris      |  2      <-- last written 2026-07-04
--
-- A raw `MAP[key]` lookup misses those two rows. Nothing throws — an absent key is `undefined`,
-- and every one of those lookups has a `|| fallback`, so the plan silently resolved the WRONG
-- jurisdiction (Harris → "generic" instead of "coh") with no error shown anywhere.
--
-- The client is fixed in two places (`createSiteModel` normalises the model, `siteRowFor`
-- normalises the column, and the county-keyed config maps normalise on read). THIS file is the
-- other two halves: the existing rows, and a server-side guard so no future writer — an import, a
-- hand-edited row, a client that predates the fix, a psql session — can create the problem again.
--
-- IDEMPOTENT. Safe to re-run; the UPDATE touches nothing once the rows are clean.

begin;

-- ---------------------------------------------------------------------------
-- 1) The normaliser. Deliberately a stable, immutable, tiny function rather than an inline
--    expression, so the trigger below and any future query provably agree on what a key IS.
--    Mirrors shared/gis/countyKeys.js `normCountyKey`: trim, lower-case, whitespace/hyphens to
--    single underscores, no leading/trailing underscore, empty string becomes NULL.
-- ---------------------------------------------------------------------------
create or replace function public.norm_county_key(v text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(
    btrim(regexp_replace(regexp_replace(lower(btrim(v)), '[\s-]+', '_', 'g'), '_+', '_', 'g'), '_'),
    ''
  );
$$;

comment on function public.norm_county_key(text) is
  'Normalise a county routing key (trim/lower/underscore). Mirrors shared/gis/countyKeys.js normCountyKey.';

-- ---------------------------------------------------------------------------
-- 2) The existing rows. Only rows that actually differ are written, so `updated_at` is untouched
--    for everything already clean and this cannot look like an edit to any open tab.
--
--    ⛔ `updated_at` is deliberately NOT bumped even on the rows this DOES change. It is the CAS
--    input the client's optimistic-concurrency layer compares against (optimisticUpsert.js), and
--    a housekeeping rewrite that moves it would hand every open tab a spurious
--    "changed in another session" conflict on a field the user never touched.
-- ---------------------------------------------------------------------------
update public.sites
   set county = public.norm_county_key(county)
 where county is distinct from public.norm_county_key(county);

-- The jsonb `data` blob carries its own copy of the key (the serialized Site Model), and the
-- client reads that copy on load. Normalising the column alone would leave the model still
-- holding "Harris" on the next open — which is the very lookup that was failing.
update public.sites
   set data = jsonb_set(data, '{county}', to_jsonb(public.norm_county_key(data->>'county')))
 where data ? 'county'
   and data->>'county' is not null
   and data->>'county' is distinct from public.norm_county_key(data->>'county');

-- ---------------------------------------------------------------------------
-- 3) The guard. A BEFORE trigger rather than a CHECK constraint on purpose: a CHECK would REJECT
--    a mixed-case write, which turns a silent wrong answer into a hard save failure for the user.
--    Normalising is the behaviour we actually want — the key means the same thing either way.
--    Both the column and the jsonb copy are normalised, so they can never disagree.
-- ---------------------------------------------------------------------------
create or replace function public.sites_normalize_county()
returns trigger
language plpgsql
as $$
begin
  new.county := public.norm_county_key(new.county);
  if new.data ? 'county' and new.data->>'county' is not null then
    new.data := jsonb_set(new.data, '{county}', to_jsonb(public.norm_county_key(new.data->>'county')));
  end if;
  return new;
end;
$$;

drop trigger if exists sites_normalize_county on public.sites;
create trigger sites_normalize_county
  before insert or update on public.sites
  for each row execute function public.sites_normalize_county();

commit;

-- Verification (run after):
--   select county, count(*) from public.sites group by county order by 2 desc;
--   -- expect no key that differs from public.norm_county_key(key)
