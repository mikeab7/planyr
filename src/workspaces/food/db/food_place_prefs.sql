-- ── food_place_prefs: the owner's own facts about a RESTAURANT (not a visit) — today just its PRICE LEVEL
-- (NEW-1, owner-approved mockup 2026-10-20: "Price level replaces the COST tile: OpenTable-style $ to $$$$, one
-- value per restaurant").
--
-- WHY A TABLE AND NOT A COLUMN ON food_places: food_places is the public, service-role-write-only Overture
-- snapshot (a signed-in user cannot write a column on it), and a manual pin has no food_places row at all.
-- food_visits.cost is per VISIT (what one meal cost) — not compatible with one level per restaurant. So the
-- "restaurant record" from the owner's side is this table: one row per (user, place-or-manual-pin), the exact
-- identity shape food_wishlist / food_list_items already use, carrying the nullable small-integer price level.
-- Owner-only RLS, own-row, `to authenticated`, no anon policy — identical to every other personal food table.
create table if not exists public.food_place_prefs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  place_id     text references public.food_places(id) on delete cascade,
  custom_name  text,
  custom_lat   double precision,
  custom_lon   double precision,
  price_level  smallint,  -- 1 = $, 2 = $$, 3 = $$$, 4 = $$$$; null = not set
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint food_place_prefs_place_or_manual check (place_id is not null or custom_name is not null),
  constraint food_place_prefs_price_level_check check (price_level is null or price_level between 1 and 4)
);

-- One prefs row per restaurant — the same two partial unique indexes food_wishlist uses (place_id is nullable).
create unique index if not exists food_place_prefs_user_place_uidx
  on public.food_place_prefs (user_id, place_id) where place_id is not null;
create unique index if not exists food_place_prefs_user_manual_uidx
  on public.food_place_prefs (user_id, custom_name, round(custom_lat::numeric, 4), round(custom_lon::numeric, 4))
  where place_id is null;
create index if not exists food_place_prefs_user_idx on public.food_place_prefs (user_id);

alter table public.food_place_prefs enable row level security;

drop policy if exists "Users select own food_place_prefs" on public.food_place_prefs;
drop policy if exists "Users insert own food_place_prefs" on public.food_place_prefs;
drop policy if exists "Users update own food_place_prefs" on public.food_place_prefs;
drop policy if exists "Users delete own food_place_prefs" on public.food_place_prefs;

create policy "Users select own food_place_prefs" on public.food_place_prefs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own food_place_prefs" on public.food_place_prefs
  for insert to authenticated with check ((select auth.uid()) = user_id);
-- Update: the level is set / changed / cleared in place (clearing writes null, never deletes the row).
create policy "Users update own food_place_prefs" on public.food_place_prefs
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own food_place_prefs" on public.food_place_prefs
  for delete to authenticated using ((select auth.uid()) = user_id);

drop trigger if exists food_place_prefs_touch on public.food_place_prefs;
create trigger food_place_prefs_touch before update on public.food_place_prefs
  for each row execute function public.food_visits_touch_updated_at(); -- the existing generic updated_at trigger
