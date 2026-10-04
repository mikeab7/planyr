-- B2064900 (single-source-of-truth audit, 2026-10-04): profiles.email is a COPY of auth.users.email,
-- written by the insert trigger only. A later email change (Supabase dashboard / admin API / a future
-- in-app change) left the team roster (list_team_members), invite fallbacks and the admin reset flow
-- showing the OLD address. Production drift today: 0 of 9 rows — this closes the LATENT path.
-- Idempotent; touches only profiles.email; never touches names/org. Apply through the normal
-- migration path (NOT run by hand).
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = lower(new.email) where id = new.id and email is distinct from lower(new.email);
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.sync_profile_email();

-- Non-destructive backfill: only rows whose copy disagrees with the source.
update public.profiles p set email = lower(u.email)
from auth.users u
where u.id = p.id and p.email is distinct from lower(u.email);
