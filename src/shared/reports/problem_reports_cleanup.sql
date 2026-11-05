-- Automated checks clean up the problem reports / slow taps they file (B2159505).
-- problem_reports has no client DELETE policy (by design — see problem_reports.sql), so a sweep or
-- ui-audit harness that files a report had NO way to remove it and the rows padded the admin Support
-- queue. This is the one narrow door: a caller may delete reports that carry ITS OWN browser session id
-- (the random per-browser id reportsStore.reportSessionId() stamps on every row — a capability only that
-- browser holds), that are RECENT (a run's own reports, never history), and that are anonymous or the
-- caller's own. It cannot touch another browser's rows, an older row, or someone else's signed-in row.
-- Returns { deleted, remaining } so the caller can PROVE the rows are gone (delete-must-verify).

create or replace function public.delete_my_session_reports(p_session_id text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  d int;
  r int;
begin
  if p_session_id is null or length(p_session_id) < 16 then
    raise exception 'session id required' using errcode = '22023';
  end if;
  delete from public.problem_reports pr
  where pr.session_id = p_session_id
    and pr.at > now() - interval '6 hours'
    and (pr.user_id is null or pr.user_id = auth.uid());
  get diagnostics d = row_count;
  select count(*) into r from public.problem_reports pr
  where pr.session_id = p_session_id and pr.at > now() - interval '6 hours'
    and (pr.user_id is null or pr.user_id = auth.uid());
  return jsonb_build_object('deleted', d, 'remaining', r);
end;
$$;
revoke all on function public.delete_my_session_reports(text) from public;
grant execute on function public.delete_my_session_reports(text) to anon, authenticated;
