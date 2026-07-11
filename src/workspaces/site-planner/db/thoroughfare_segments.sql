-- Thoroughfare-Plan data spine (B720). The empty "filing cabinet" for normalized thoroughfare
-- centerlines across ALL jurisdictions, plus the two lookups that make it jurisdiction-agnostic.
-- Idempotent + safe to re-run — run once in the Supabase SQL editor (same pattern as
-- project_folders.sql). Segment geometry + verified ROW-standard widths are populated by the
-- ingestion adapters (B721 Houston, B722 the rest), NOT by this migration.
--
-- PUBLIC REFERENCE DATA — unlike the private-by-default user tables (sites, doc_reviews,
-- project_folders), a jurisdiction's thoroughfare plan is the SAME for every user, so these
-- tables are READABLE BY EVERYONE and WRITABLE ONLY by the ingestion process (service_role,
-- which bypasses RLS). No user data lives here — same class as the public GIS layers the app
-- already shows logged-out. There are deliberately NO insert/update/delete policies, so the
-- anon / authenticated roles can read but never write.
--
-- DESIGN CRUX: ROW WIDTH IS NOT IN THE SOURCE GIS ATTRIBUTES (Houston encodes it via Chapter 42
-- ordinance, not the feature), so ultimate_row_ft / building_line_ft are resolved from
-- jurisdiction_row_standards keyed on (jurisdiction, classification) at ingest — never trusted
-- off the segment feature.

-- PostGIS supplies the geometry type + spatial (GiST) index. It is available on the project;
-- this enables it into the Supabase-conventional `extensions` schema.
create extension if not exists postgis with schema extensions;

-- ── jurisdictions registry: a new city/county is added as CONFIG, not code (feeds B721/B722) ──
create table if not exists public.jurisdictions (
  id            text primary key,                        -- stable slug: 'coh', 'harris', 'fortbend', …
  name          text not null,                           -- 'City of Houston'
  type          text not null check (type in ('city','county','mpo')),
  source_type   text not null default 'featureserver'    -- how its plan is ingested
                  check (source_type in ('featureserver','pdf','manual')),
  source_url    text,                                    -- the ArcGIS REST layer / Open-Data hub / plan URL
  refresh_days  integer,                                 -- expected refresh window in days (B726 staleness)
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── jurisdiction_row_standards: (jurisdiction, classification) -> ROW & building-line widths ──
-- The lookup that supplies the widths source features omit. Seeded from each jurisdiction's
-- ordinance (Houston Chapter 42 first) during ingestion (B721) — intentionally EMPTY here.
create table if not exists public.jurisdiction_row_standards (
  jurisdiction     text not null references public.jurisdictions(id) on delete cascade,
  classification   text not null check (classification in
                     ('freeway','major_thoroughfare','transit_corridor','collector_major','collector_minor','other')),
  ultimate_row_ft  numeric,                              -- ultimate right-of-way width (ft)
  building_line_ft numeric,                              -- building-line setback beyond the ROW (ft)
  source           text,                                 -- provenance, e.g. 'Houston Chapter 42, Table …'
  updated_at       timestamptz not null default now(),
  primary key (jurisdiction, classification)
);

-- ── thoroughfare_segments: normalized centerlines across all jurisdictions ────────────────────
create table if not exists public.thoroughfare_segments (
  id                 uuid primary key default gen_random_uuid(),
  jurisdiction       text not null references public.jurisdictions(id) on delete cascade,
  source_feature_id  text not null,                      -- the source's stable feature id (idempotency key)
  street_name        text,
  classification     text not null default 'other' check (classification in
                      ('freeway','major_thoroughfare','transit_corridor','collector_major','collector_minor','other')),
  raw_classification text,                               -- verbatim source value (audit trail)
  status             text not null default 'existing' check (status in ('existing','proposed')),
  ultimate_row_ft    numeric,                            -- resolved from standards at ingest (may be null)
  existing_row_ft    numeric,
  building_line_ft   numeric,
  plan_name          text,
  plan_adopted_date  date,
  source_url         text,
  geom               extensions.geometry(LineString, 4326) not null,  -- WGS84 centerline (as published)
  geom_2278          extensions.geometry(LineString, 2278),           -- projected copy for measurement (ftUS); filled at ingest (B724)
  ingested_at        timestamptz not null default now(),
  -- Idempotent refresh: re-running an adapter updates the SAME row in place, never duplicates.
  unique (jurisdiction, source_feature_id)
);

-- Spatial indexes: frontage / coverage queries hit geom (4326); B724 measures on geom_2278 (ft).
create index if not exists thoroughfare_segments_geom_idx     on public.thoroughfare_segments using gist (geom);
create index if not exists thoroughfare_segments_geom2278_idx on public.thoroughfare_segments using gist (geom_2278);
-- Overlay filter + standards join (jurisdiction + classification + status).
create index if not exists thoroughfare_segments_juris_idx    on public.thoroughfare_segments (jurisdiction, classification, status);

-- ── RLS: PUBLIC READ-ONLY reference data ──────────────────────────────────────────────────────
alter table public.jurisdictions              enable row level security;
alter table public.jurisdiction_row_standards enable row level security;
alter table public.thoroughfare_segments      enable row level security;

-- Everyone (signed in or not, like the public GIS layers) may READ. No write policies exist, so
-- only service_role (ingestion; bypasses RLS) can insert / update / delete.
do $$ begin
  create policy "Public read jurisdictions" on public.jurisdictions
    for select to anon, authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Public read row_standards" on public.jurisdiction_row_standards
    for select to anon, authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Public read thoroughfare_segments" on public.thoroughfare_segments
    for select to anon, authenticated using (true);
exception when duplicate_object then null; end $$;

-- Explicit table grants so the public-read intent holds regardless of Supabase's ambient default
-- privileges. SELECT only — no insert/update/delete grant, so writes stay service-role-only.
grant select on public.jurisdictions              to anon, authenticated;
grant select on public.jurisdiction_row_standards to anon, authenticated;
grant select on public.thoroughfare_segments      to anon, authenticated;

-- ── Seed the jurisdictions registry (CONFIG only — factual; asserts no ROW widths) ────────────
-- Phase-1 targets: B721 ingests Houston first; B722 generalizes to the rest. Only the Houston
-- COHGIS MTFP endpoint is known-good today; the others carry null source_url until B722 wires
-- them. ROW-standard widths + segment geometry are populated by ingestion, not seeded here.
insert into public.jurisdictions (id, name, type, source_type, source_url, refresh_days) values
  ('coh',        'City of Houston',    'city',   'featureserver',
     'https://mycity2.houstontx.gov/pubgis02/rest/services/HoustonMap/Transportation/MapServer/1', 365),
  ('harris',     'Harris County',      'county', 'featureserver', null, 365),
  ('fortbend',   'Fort Bend County',   'county', 'featureserver', null, 365),
  ('pearland',   'City of Pearland',   'city',   'featureserver', null, 365),
  ('montgomery', 'Montgomery County',  'county', 'featureserver', null, 365),
  ('sugarland',  'City of Sugar Land', 'city',   'pdf',           null, null),
  ('hgac',       'H-GAC (regional)',   'mpo',    'featureserver', null, 365)
on conflict (id) do update set
  name         = excluded.name,
  type         = excluded.type,
  source_type  = excluded.source_type,
  source_url   = coalesce(excluded.source_url, public.jurisdictions.source_url),
  refresh_days = excluded.refresh_days,
  updated_at   = now();
