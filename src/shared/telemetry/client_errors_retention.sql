-- Retention for public.client_errors (B270913) — 90 days ordinary, ONE YEAR for manual captures.
-- Run ONCE in the Supabase SQL editor. Idempotent (safe to re-run). Sits beside client_errors.sql,
-- which must have been applied first.
--
-- ── THE POLICY, and why these two numbers ────────────────────────────────────────────────────
-- • 90 DAYS for an ordinary row. Measured 2026-08-08 and again 2026-08-09: 0 of 5,279 rows are
--   older than 90 days (the whole table is 50 days old). So switching this on deletes NOTHING
--   today. It cannot lose anything now, and it only begins trimming as the table naturally ages.
-- • 365 DAYS for a perf capture whose `kind` is "manual". A manual capture is the owner pressing
--   "that felt slow just now" — the rarest and highest-value row in the table, of which there will
--   only ever be a handful. Keeping those four times longer costs nothing measurable, and the
--   value of such a row is comparing a symptom to the same symptom a season ago, which a 90-day
--   window destroys.
--
-- ⛔ NOTHING OUTSIDE THAT POLICY IS TOUCHED. There is no read-side filter, no truncation and no
-- "while we're here" cleanup. In particular the two rows from the owner's own session at
-- 2026-08-07 19:07:38 (`event:stale-cache-overruled` and `event:element-rows-canonical` on his
-- real Sylvestri plan) are ordinary rows well inside 90 days and are not eligible; they are a
-- genuine record of the app self-healing his data.
--
-- ── ⛔ THE GUARD MATTERS MORE THAN THE POLICY ────────────────────────────────────────────────
-- A retention job that silently never runs is INDISTINGUISHABLE from one that correctly had
-- nothing to delete — and because this policy is a no-op against today's data, that is not a
-- hypothetical, it is the expected state for months. This repo has been bitten by that exact
-- shape six times (the swallowing sink, the frame-count sustain window, the packed track that
-- emptied on real stalls, the drift gate's invented fixture, the perf metrics that stayed muted
-- after their cause was gone). So the job PROVES it ran and REPORTS what it deleted:
--
--   • every run writes a row to `public.client_errors_retention_runs`, INCLUDING a run that
--     deleted nothing. That is what makes an EMPTY report (a row saying 0/0) distinguishable
--     from an ABSENT one (no row at all).
--   • `public.client_errors_retention_status` answers in one word which of those you are looking
--     at: `never-run` (the job has never proven itself — treat as broken, not as clean) ·
--     `stale` (it ran once and has since stopped) · `ok`.
--
-- Both directions are asserted in CI by `test/clientErrorsRetention.test.js`, which runs THIS
-- FILE, verbatim, against a real Postgres (PGlite) — it seeds a row past the cutoff and asserts
-- it is removed WHILE a manual capture of the same age survives, and it mutation-checks both by
-- proving the opposite outcome when the carve-out or the interval is altered.

-- ── The classifier ───────────────────────────────────────────────────────────────────────────
-- Which rows are the long-lived ones. A capture rides `client_errors` as `source='event:perfcap'`
-- with the encoded capture in `message` (see perfCapture.js / perfRecorder.js); `buildCapture`
-- always emits the `kind` enum, and `encodeCapture` is a bare `JSON.stringify`, so the literal
-- substring `"kind":"manual"` is present. Matched by regex rather than by parsing the JSON out of
-- the message: the message is prefixed (`[tab abcd1234] {…}`) and a cast of a malformed payload
-- would RAISE, which would take the whole nightly run down over one bad row. A regex cannot throw.
create or replace function public.is_manual_perf_capture(p_source text, p_message text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_source, '') = 'event:perfcap'
     and coalesce(p_message, '') ~ '"kind"\s*:\s*"manual"';
$$;

comment on function public.is_manual_perf_capture(text, text) is
  'B270913 — is this row an owner-pressed ("manual") performance capture? Those are kept for a year; everything else for 90 days.';

-- ── The run log: the proof that the job ran, and the report of what it did ────────────────────
create table if not exists public.client_errors_retention_runs (
  id               bigint      generated always as identity primary key,
  ran_at           timestamptz not null default now(),
  ordinary_cutoff  timestamptz not null,   -- rows older than this, if not a manual capture, went
  manual_cutoff    timestamptz not null,   -- manual captures older than this went
  ordinary_deleted integer     not null,
  manual_deleted   integer     not null,
  rows_before      bigint      not null,
  rows_after       bigint      not null,
  duration_ms      integer     not null
);

comment on table public.client_errors_retention_runs is
  'B270913 — one row per retention run, INCLUDING runs that deleted nothing. A 0/0 row is an empty report; no row at all is an absent one, and those mean opposite things.';

create index if not exists client_errors_retention_runs_ran_at_idx
  on public.client_errors_retention_runs (ran_at desc);

-- Service-role only. RLS on with no policies means anon/authenticated see and write nothing;
-- the run log is operator data, and clients have no business reading how much was deleted.
alter table public.client_errors_retention_runs enable row level security;

-- ── The job ──────────────────────────────────────────────────────────────────────────────────
-- `p_now` is injectable ONLY so the test can seed relative to a fixed instant; production always
-- calls it with the default. Deliberately SECURITY INVOKER: the caller is the `postgres` role
-- (pg_cron runs jobs as their owner), which owns `client_errors` and so is not subject to its
-- RLS. A SECURITY DEFINER function here would be a delete hole reachable by anyone who could
-- call it, which is a much worse trade than the convenience it buys — and EXECUTE is revoked
-- below regardless, because a function's default grant is to PUBLIC.
create or replace function public.prune_client_errors(p_now timestamptz default now())
returns public.client_errors_retention_runs
language plpgsql
as $$
declare
  v_ordinary_cutoff timestamptz := p_now - interval '90 days';
  v_manual_cutoff   timestamptz := p_now - interval '365 days';
  v_started         timestamptz := clock_timestamp();
  v_before          bigint;
  v_after           bigint;
  v_ordinary        integer;
  v_manual          integer;
  v_run             public.client_errors_retention_runs;
begin
  select count(*) into v_before from public.client_errors;

  -- Ordinary rows past 90 days. The `not is_manual_perf_capture(...)` term is the whole carve-out:
  -- without it a manual capture would be swept by the 90-day rule long before its own year.
  with gone as (
    delete from public.client_errors
     where at < v_ordinary_cutoff
       and not public.is_manual_perf_capture(source, message)
    returning 1
  )
  select count(*) into v_ordinary from gone;

  -- Manual captures past a year.
  with gone as (
    delete from public.client_errors
     where at < v_manual_cutoff
       and public.is_manual_perf_capture(source, message)
    returning 1
  )
  select count(*) into v_manual from gone;

  select count(*) into v_after from public.client_errors;

  -- ⛔ UNCONDITIONAL. This insert is not inside an `if deleted > 0` — a run that deleted nothing
  -- is exactly the run this log exists to record.
  insert into public.client_errors_retention_runs
    (ran_at, ordinary_cutoff, manual_cutoff, ordinary_deleted, manual_deleted, rows_before, rows_after, duration_ms)
  values
    (p_now, v_ordinary_cutoff, v_manual_cutoff, v_ordinary, v_manual, v_before, v_after,
     (extract(epoch from clock_timestamp() - v_started) * 1000)::integer)
  returning * into v_run;

  return v_run;
end;
$$;

comment on function public.prune_client_errors(timestamptz) is
  'B270913 — apply the client_errors retention policy (90 days ordinary, 365 days for manual perf captures) and record the run. Always writes a run row, even when it deletes nothing.';

revoke all on function public.prune_client_errors(timestamptz) from public;
revoke all on function public.prune_client_errors(timestamptz) from anon, authenticated;

-- ── The status answer: ran-and-found-nothing vs never-ran ────────────────────────────────────
create or replace view public.client_errors_retention_status as
with last as (
  select * from public.client_errors_retention_runs order by ran_at desc limit 1
)
select
  (select count(*) from public.client_errors_retention_runs)                       as runs_recorded,
  (select ran_at from last)                                                        as last_run_at,
  (select ordinary_deleted from last)                                              as last_ordinary_deleted,
  (select manual_deleted from last)                                                as last_manual_deleted,
  (select ordinary_deleted + manual_deleted from last)                             as last_total_deleted,
  (select rows_after from last)                                                    as last_rows_after,
  (select sum(ordinary_deleted + manual_deleted) from public.client_errors_retention_runs) as deleted_all_time,
  case
    -- Never proven itself. This is the state to ALERT on: it is what a job that was never
    -- scheduled, or whose schedule was dropped, looks like — and it is not the same thing as a
    -- job that ran and correctly found nothing.
    when (select count(*) from public.client_errors_retention_runs) = 0 then 'never-run'
    -- Scheduled daily, so two missed days is a stopped job, not a slow one.
    when now() - (select ran_at from last) > interval '48 hours'        then 'stale'
    else 'ok'
  end                                                                              as status;

comment on view public.client_errors_retention_status is
  'B270913 — is the retention job alive? `never-run` and `stale` are failures; `ok` with last_total_deleted = 0 is a healthy no-op, which is the expected state for months.';

revoke all on public.client_errors_retention_status from anon, authenticated;

-- ── The schedule ─────────────────────────────────────────────────────────────────────────────
-- Guarded, and the guard is load-bearing rather than defensive: this same file is executed
-- verbatim by `test/clientErrorsRetention.test.js` against a PGlite Postgres, which has no
-- pg_cron. Skipping the schedule there is what lets the test run the SHIPPED artifact instead of
-- a hand-copied approximation of it. The statement is `execute`d from a string so that a Postgres
-- without the extension never even parses a `cron.` reference.
--
-- 07:20 UTC daily — inside the owner's overnight (Central), and off the hour so it does not
-- contend with everything else that runs at :00.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    -- Idempotent: drop any earlier copy of this job before re-scheduling it.
    begin
      execute $c$ select cron.unschedule('planyr-client-errors-retention') $c$;
    exception when others then null;  -- no such job yet
    end;
    execute $c$ select cron.schedule('planyr-client-errors-retention', '20 7 * * *',
                                     $j$ select public.prune_client_errors() $j$) $c$;
  else
    raise notice 'pg_cron unavailable — prune_client_errors() installed but NOT scheduled. Anything relying on this must read public.client_errors_retention_status, which will say never-run.';
  end if;
end;
$$;
