-- ⛔ READ-ONLY. The retention follow-up reader (B369536) — "has the policy ever actually DELETED,
-- and did the last run leave anything behind that it should have taken?"
--
-- ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────────────────
-- B270913 applied the policy and V84560 proved the job FIRES on its own (three unattended runs,
-- 2026-08-09/10/11, all `ordinary_deleted 0 · manual_deleted 0`). What no observation to date has
-- shown is the policy DOING anything: 0 of 5,706 rows are eligible, and none will be until
-- **2026-09-18** — 90 days after the table's oldest row (2026-06-20 22:16:28). So the two states
-- "the DELETE works" and "the DELETE matches nothing it should be matching" are still producing
-- the identical observation, which is the exact indistinguishability B270913's whole guard half
-- was built for, one layer further in.
--
-- ⛔ AND THE ONE WAY TO DESTROY THE EVIDENCE IS TO CALL THE JOB BY HAND. `prune_client_errors()`
-- writes a byte-identical run row whether pg_cron called it or a person did, so a hand-run
-- manufactures the very row this check is waiting to see and there is no way to tell afterwards.
-- That is why this file contains **no `insert`, `update`, `delete`, `truncate`, DDL, or call to
-- `prune_client_errors()` of any kind** — it is `select` and nothing else, and
-- `test/clientErrorsRetentionCheck.test.js` fails the build if that ever stops being true.
-- Run it. Do not "help" it along.
--
-- ── HOW TO USE IT ────────────────────────────────────────────────────────────────────────────
-- Paste QUERY 1 into the Supabase SQL editor on `lyeqzkuiwngunutlkkmi`. It returns ONE row whose
-- `verdict` column is the whole answer:
--
--   PASS-first-deletion-observed   a scheduled run deleted something, and the last run left
--                                  nothing behind. The policy is proven end to end on real data.
--   WAIT-no-eligible-rows-yet      healthy. The job is running; nothing is old enough yet. This
--                                  is the CORRECT reading before 2026-09-18.
--   FAIL-policy-not-applied        rows the last run should have deleted are still sitting there.
--                                  The job runs and the DELETE matches nothing — the failure this
--                                  file exists to catch.
--   FAIL-stale                     it ran and then stopped (nothing in over 48 hours).
--   FAIL-never-run                 no run has ever been recorded. Treat as broken, not as clean.
--
-- QUERY 2 at the bottom corroborates from pg_cron's own independent ledger and is Supabase-only.

-- ══ QUERY 1 — the verdict ═══════════════════════════════════════════════════════════════════
with last_run as (
  select * from public.client_errors_retention_runs order by ran_at desc limit 1
),
-- A run row carries no field saying who called it, so attribution is by SCHEDULE SHAPE: the job is
-- `20 7 * * *`, and the three observed unattended runs landed within 220 ms of 07:20:00 UTC. A
-- two-minute window is generous against that and still excludes run id 1 (2026-08-09 02:52:36),
-- which was the hand-run live proof. STATED HONESTLY: a person who ran it by hand at 07:20 would
-- be indistinguishable here — QUERY 2 is the independent check, and not calling it by hand is the
-- discipline this cannot enforce.
attributed as (
  select *,
         (abs(extract(epoch from (ran_at - date_trunc('day', ran_at) - interval '7 hours 20 minutes'))) <= 120)
           as on_schedule
    from public.client_errors_retention_runs
),
-- ⛔ THE SHARPEST ASSERTION IN THE FILE, and the one that does not need a calendar. Whatever the
-- date, any ordinary row older than 90 days AT THE MOMENT THE LAST RUN RAN should not have
-- survived that run. If one did, the job is running and the DELETE is matching nothing.
missed as (
  select
    count(*) filter (
      where ce.at < (select ran_at from last_run) - interval '90 days'
        and not public.is_manual_perf_capture(ce.source, ce.message)
    ) as ordinary_missed,
    count(*) filter (
      where ce.at < (select ran_at from last_run) - interval '365 days'
        and public.is_manual_perf_capture(ce.source, ce.message)
    ) as manual_missed
  from public.client_errors ce
)
select
  now()                                                                    as read_at,
  s.status                                                                 as liveness,
  s.runs_recorded,
  s.last_run_at,
  s.last_total_deleted,
  (select count(*) from attributed where on_schedule)                      as scheduled_runs,
  (select count(*) from attributed where not on_schedule)                  as off_schedule_runs,
  -- The row V165104 is waiting for: the first UNATTENDED run that removed something.
  (select min(id)     from attributed where on_schedule and ordinary_deleted + manual_deleted > 0) as first_deletion_run_id,
  (select min(ran_at) from attributed where on_schedule and ordinary_deleted + manual_deleted > 0) as first_deletion_at,
  (select sum(ordinary_deleted) from attributed where on_schedule)         as ordinary_deleted_on_schedule,
  (select sum(manual_deleted)   from attributed where on_schedule)         as manual_deleted_on_schedule,
  (select count(*) from public.client_errors)                              as rows_now,
  (select min(at)   from public.client_errors)                             as oldest_row_at,
  -- After the first deletion this becomes the NEXT date something ages out, which is equally useful.
  (select min(at)::date + 90 from public.client_errors)                    as next_eligible_date,
  m.ordinary_missed,
  m.manual_missed,
  -- The carve-out, proven on real rows rather than in a fixture: his own presses, over 90 days old,
  -- still here. Zero of these today (the table holds no manual capture yet), which is why this
  -- column reads as evidence only once it is non-zero.
  (select count(*) from public.client_errors ce
    where public.is_manual_perf_capture(ce.source, ce.message)
      and ce.at < now() - interval '90 days')                              as manual_captures_kept_past_90d,
  case
    when s.runs_recorded = 0                        then 'FAIL-never-run'
    when s.status = 'stale'                         then 'FAIL-stale'
    when m.ordinary_missed > 0 or m.manual_missed > 0 then 'FAIL-policy-not-applied'
    when (select count(*) from attributed
           where on_schedule and ordinary_deleted + manual_deleted > 0) > 0
                                                    then 'PASS-first-deletion-observed'
    else                                                 'WAIT-no-eligible-rows-yet'
  end                                                                      as verdict
from public.client_errors_retention_status s, missed m;

-- ══ QUERY 2 — corroboration from pg_cron's own ledger (Supabase only) ════════════════════════
-- Independent of everything above: pg_cron records its own runs in a table our code cannot write.
-- A scheduled run appears on BOTH sides with matching start times (measured to 169 µs and 31 µs on
-- 2026-08-09/10); a hand-run appears only in `client_errors_retention_runs`.
--
--   select d.runid, d.status, d.start_time, d.return_message,
--          r.id as run_row_id, r.ordinary_deleted, r.manual_deleted,
--          r.ran_at - d.start_time as clock_skew
--     from cron.job_run_details d
--     join cron.job j on j.jobid = d.jobid
--     left join public.client_errors_retention_runs r
--            on r.ran_at between d.start_time - interval '5 seconds'
--                            and d.start_time + interval '5 seconds'
--    where j.jobname = 'planyr-client-errors-retention'
--    order by d.runid;
--
-- Expect: one `succeeded` row per calendar day since 2026-08-09, each paired with exactly one run
-- row. A `succeeded` cron row with NO run row beside it means the function ran and its unconditional
-- insert did not land, which would be a different and worse defect than anything above.
