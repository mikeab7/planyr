-- Sign-in health — the schedule that makes the fast check run every 15 minutes (NEW-1, 2026-11-04, B2650848).
-- Idempotent. Apply AFTER signin_health_edge.sql and AFTER /api/ops/signin-heartbeat is deployed.
--
-- WHY THIS EXISTS: GitHub's scheduler delivers the hourly workflow only every 5–8 hours in this repo (measured: five scheduled
-- runs in 33 hours; the build sweep scheduled every 10 minutes ran 50 times in 10 days, median gap 5.1 h). The cheap checks therefore run from
-- a scheduler we control: Supabase's own pg_cron calls a Planyr route through pg_net (Postgres's built-in async HTTP client).
--
-- NO SECRET anywhere in this file, on purpose: the route runs the checks ITSELF and takes nothing from the caller, so a caller
-- can only make it look at the live site; it refuses a second run inside a few minutes (THRESHOLDS.edgeMinGapMin), so hammering
-- it is harmless. Nothing here is a credential and there is nothing for a person to paste.
--
-- Uses only pg_cron + pg_net, both already part of the Supabase project (no new account, no paid service).

create extension if not exists pg_net;

-- Re-running replaces the job (pg_cron upserts by name). Every 15 minutes; the :07 offset keeps it off the top of the hour.
select cron.schedule(
  'planyr-signin-heartbeat',
  '7,22,37,52 * * * *',
  $job$
    select net.http_post(
      url                  := 'https://planyr.io/api/ops/signin-heartbeat',
      headers              := '{"content-type": "application/json"}'::jsonb,
      body                 := '{}'::jsonb,
      timeout_milliseconds := 60000      -- the route may wait ~20 s between a failed check and its re-check
    );
  $job$
);

-- To turn it off:  select cron.unschedule('planyr-signin-heartbeat');
-- To see what it did:
--   select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'planyr-signin-heartbeat') order by start_time desc limit 10;
--   select id, status_code, left(content, 160) as answer, created from net._http_response order by created desc limit 10;
