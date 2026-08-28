-- Adds `comp_party_provider` and `comp_party_acquirer` (free-text deal-party fields) to
-- public.comps — one shared axis, labeled per comp type in the UI (NEW-7 amended; provisional
-- label until the real B# is minted at push time, per /CLAUDE.md's LATE-BIND rule). Nullable
-- text, optional — same treatment as `lease_term` (an existing free-form text column). Run once
-- in the Supabase SQL editor (project lyeqzkuiwngunutlkkmi), AFTER db/comps.sql. Idempotent:
-- safe to re-run.
--
-- WHY TWO COLUMNS, NOT SIX: the owner's own framing — "the party disposing or providing space,
-- and the party acquiring or occupying it" — is one axis wearing three sets of clothes, not
-- three unrelated field pairs:
--   comp_type       | comp_party_provider (UI label) | comp_party_acquirer (UI label)
--   lease           | Owner/Developer                | Tenant
--   land            | Seller                         | Buyer
--   building_sale   | Seller                          | Buyer/User
-- `lib/comps.js` `partyLabels(compType)` is the one place that label mapping lives. Two reasons
-- this shape matters beyond tidiness (the owner's own reasoning, kept verbatim because it drove
-- the schema call): (1) NEW-8's autocomplete needs ONE pool of names — "Core5" typed as a
-- developer on a lease and as a seller on a building sale must be the SAME suggestion, which six
-- columns would turn into a six-way union that invites drift; (2) a fourth comp type later costs
-- nothing against two columns.
--
-- ORIGIN: with no party field, the owner was packing the developer/tenant name into the
-- free-text `title` column (e.g. "Core 5 - West Hardy Road" — a developer name and a location,
-- joined with a dash). Audited live against production (project lyeqzkuiwngunutlkkmi,
-- read-only): of the 1 lease comp on record, its title follows exactly that
-- "<party> - <location>" shape. These two columns give that data a real home for new entries;
-- existing `title` values are left untouched — no backfill, no reformat. A backfill would have
-- to guess which side of the dash is which, which is a judgment call for the owner to make later
-- if he wants it, not something this migration does on his behalf.

alter table public.comps add column if not exists comp_party_provider text;
alter table public.comps add column if not exists comp_party_acquirer text;

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select column_name, data_type, is_nullable from information_schema.columns
--   where table_schema = 'public' and table_name = 'comps'
--   and column_name in ('comp_party_provider', 'comp_party_acquirer');
