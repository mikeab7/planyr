-- Run via the Supabase MCP (no auth.uid() = a caller who is not on the allowlist). Raises on any failure.
do $$ begin
  begin perform public.admin_users_overview(); raise exception 'FAIL overview open'; exception when sqlstate '42501' then null; end;
  begin perform public.admin_user_activity(gen_random_uuid()); raise exception 'FAIL activity open'; exception when sqlstate '42501' then null; end;
  if (select count(*) from public.admin_error_groups('error', 7)) <> 0 then raise exception 'FAIL groups leak'; end if;
end $$;
select 'all three fail closed for a caller who is not on the allowlist' as result;
