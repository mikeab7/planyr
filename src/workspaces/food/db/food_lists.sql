-- ── food_lists + food_list_items: NAMED RESTAURANT LISTS (NEW-1 / B2088288, owner chat block
-- 2026-10-05: "create multiple lists for restaurants i eat at depending on the need, like for lunch
-- while im at work ... whereas for dinner after work"). A user-named GROUPING of places, orthogonal
-- to status: "been" stays derived from food_visits, "want to try" stays a food_wishlist flag, and
-- NOTHING here adds a status column. A place may sit on several lists.
--
-- food_list_items mirrors food_wishlist's identity exactly: a snapshot place_id, OR a manual pin
-- (custom_name + rounded custom_lat/custom_lon). One row per (user, list, place-or-manual-pin),
-- enforced by unique indexes. A restaurant is NEVER minted from a typed name (food_places is
-- service-role-write-only; a manual pin needs coordinates).
--
-- Ownership of an item's LIST is enforced by a COMPOSITE foreign key (list_id, user_id) ->
-- food_lists (id, user_id): an FK check bypasses RLS, so user B cannot attach an item to user A's
-- list even while naming themself as user_id (RLS alone only checks user_id = auth.uid()).
-- Deleting a list cascades to its item rows ONLY -- never a visit, dish, rating or wishlist row.
-- Owner-only RLS, `to authenticated`, no anon policy: identical shape to food_visits/food_wishlist.
create table if not exists public.food_lists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  color       text not null,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint food_lists_name_nonblank check (length(btrim(name)) > 0),
  constraint food_lists_color_hex check (color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint food_lists_id_user_key unique (id, user_id)
);

-- Names are unique per user, case-insensitively -- a second "lunch" is refused at the database.
create unique index if not exists food_lists_user_name_uidx
  on public.food_lists (user_id, lower(btrim(name)));
create index if not exists food_lists_user_idx on public.food_lists (user_id, position);

alter table public.food_lists enable row level security;

drop policy if exists "Users select own food_lists" on public.food_lists;
drop policy if exists "Users insert own food_lists" on public.food_lists;
drop policy if exists "Users update own food_lists" on public.food_lists;
drop policy if exists "Users delete own food_lists" on public.food_lists;

create policy "Users select own food_lists" on public.food_lists
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own food_lists" on public.food_lists
  for insert to authenticated with check ((select auth.uid()) = user_id);
-- Update: rename / recolour in place.
create policy "Users update own food_lists" on public.food_lists
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own food_lists" on public.food_lists
  for delete to authenticated using ((select auth.uid()) = user_id);

drop trigger if exists food_lists_touch on public.food_lists;
create trigger food_lists_touch before update on public.food_lists
  for each row execute function public.food_visits_touch_updated_at(); -- the existing generic updated_at trigger

create table if not exists public.food_list_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  list_id      uuid not null,
  place_id     text references public.food_places(id) on delete cascade,
  custom_name  text,
  custom_lat   double precision,
  custom_lon   double precision,
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  constraint food_list_items_list_fk foreign key (list_id, user_id)
    references public.food_lists (id, user_id) on delete cascade,
  constraint food_list_items_user_fk foreign key (user_id) references auth.users(id) on delete cascade,
  constraint food_list_items_place_or_manual check (
    (place_id is not null and custom_name is null)
    or (place_id is null and custom_name is not null and custom_lat is not null and custom_lon is not null)
  )
);

-- One row per (user, list, place) / (user, list, manual pin) -- the manual key is rounded to 4dp
-- (~11m), the same rounding food_wishlist and manualGroupKey use.
create unique index if not exists food_list_items_list_place_uidx
  on public.food_list_items (user_id, list_id, place_id) where place_id is not null;
create unique index if not exists food_list_items_list_manual_uidx
  on public.food_list_items (user_id, list_id, custom_name, round(custom_lat::numeric, 4), round(custom_lon::numeric, 4))
  where place_id is null;
create index if not exists food_list_items_list_idx on public.food_list_items (list_id);
create index if not exists food_list_items_user_idx on public.food_list_items (user_id);

alter table public.food_list_items enable row level security;

drop policy if exists "Users select own food_list_items" on public.food_list_items;
drop policy if exists "Users insert own food_list_items" on public.food_list_items;
drop policy if exists "Users update own food_list_items" on public.food_list_items;
drop policy if exists "Users delete own food_list_items" on public.food_list_items;

create policy "Users select own food_list_items" on public.food_list_items
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own food_list_items" on public.food_list_items
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own food_list_items" on public.food_list_items
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own food_list_items" on public.food_list_items
  for delete to authenticated using ((select auth.uid()) = user_id);
-- No anon policy at all -> a signed-out request sees zero rows, exactly like food_visits/food_wishlist.

-- Verify (read-only; safe to run any time) -----------------------------------
--   select relname, relrowsecurity from pg_class where oid in ('public.food_lists'::regclass, 'public.food_list_items'::regclass); -- both true
--   select polrelid::regclass, polname from pg_policy where polrelid in ('public.food_lists'::regclass, 'public.food_list_items'::regclass); -- 4 + 4 owner-only, no anon
