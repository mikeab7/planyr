-- Self-rolling-back proof for profiles_email_sync.sql (B2064900).
-- Red on the pre-fix schema (no update trigger -> check 2 fails); green with it. Always ends by raising,
-- so nothing it inserts survives (scripts/db-test-verdict.mjs reads the message text).
do $$
declare uid uuid := gen_random_uuid(); got text; failed int := 0; rep text := '';
begin
  insert into auth.users (id, email, instance_id, aud, role)
  values (uid, 'Old.Addr@Example.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
  select email into got from public.profiles where id = uid;
  if got is distinct from 'old.addr@example.com' then failed := failed + 1; rep := rep || E'\n  FAIL insert trigger: profile email is ' || coalesce(got, 'null'); end if;
  update auth.users set email = 'New.Addr@Example.com' where id = uid;
  select email into got from public.profiles where id = uid;
  if got is distinct from 'new.addr@example.com' then failed := failed + 1; rep := rep || E'\n  FAIL email change did not reach profiles.email (got ' || coalesce(got, 'null') || ')'; end if;
  if failed > 0 then
    raise exception E'profiles_email_sync: % of 2 checks FAILED%\n(fixtures rolled back)', failed, rep;
  end if;
  raise exception E'profiles_email_sync: ALL 2 CHECKS PASSED\n(fixtures rolled back)';
end $$;
