-- cad_taxunit_index.sql (B2158065) — a precomputed index of each CAD's account → taxing-unit codes, so the
-- parcel page's tax table never scans a 570 MB roll per request (measured: 43 s cold, and Cloudflare 1102 on deep
-- accounts). PUBLIC data (HCAD's published appraisal roll), so anon/authenticated may SELECT; only the service role
-- (the /api/taxunits-index builder) writes.
--   shard row  : prefix = first 8 digits of the 13-digit account; data = "<last 5 digits>=<spec>" lines, spec like
--                "016I,040T,046J,640B" (code + CAD type letter; "@0.5" when only part of the lot is in the unit)
--   '_rates'   : JSON { "<code>": [name, priorRate, currentRate] } for the roll year (from the CAD's rate file)
--   '_meta'    : JSON { year, accounts, built_at } — written LAST; its presence means the year's index is complete
create table if not exists public.cad_taxunit_shards (
  county text not null,
  roll_year int not null,
  prefix text not null,
  data text not null,
  built_at timestamptz not null default now(),
  primary key (county, roll_year, prefix)
);
alter table public.cad_taxunit_shards enable row level security;
drop policy if exists "cad taxunit shards are public" on public.cad_taxunit_shards;
create policy "cad taxunit shards are public" on public.cad_taxunit_shards for select to anon, authenticated using (true);
