-- Pen-test 2026-11-24 (B-security): a signed-in user could write ANY text into their own profiles.email
-- (the "Users update own profile" policy allows every column), and that address is what the team roster
-- (list_team_members) and invite fallbacks display. Pin it: whatever a client sends, the stored copy is
-- always the auth account's own address. The client never sends email (profile.js / profileRowCache.js),
-- so nothing legitimate changes. Idempotent. Apply through the normal migration path.
create or replace function public.profiles_pin_email()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  new.email := (select lower(u.email) from auth.users u where u.id = new.id);
  return new;
end;
$$;

revoke all on function public.profiles_pin_email() from public, anon, authenticated;

drop trigger if exists trg_profiles_pin_email on public.profiles;
create trigger trg_profiles_pin_email
  before insert or update on public.profiles
  for each row execute function public.profiles_pin_email();
