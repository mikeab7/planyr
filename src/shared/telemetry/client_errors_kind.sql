-- NEW-3 — public.client_errors is a TELEMETRY SINK, and errors are a small slice of it. Measured
-- on production 2026-09-05: 11,284 rows, of which the genuine crash classes (react /
-- unhandledrejection / window.onerror / a bare "error" source) totalled ~400 — about 3.5% — while
-- the rest was a mix of performance TIMING measurements (event:terrain-tile-timing, event:perf,
-- event:perfcap) and diagnostic state-transition EVENTS (element sync, cloud conflicts, delete
-- outcomes, assembly healing, …), none of which are errors and all of which anyone triaging a real
-- crash had to filter past by hand.
--
-- `kind` answers "is this an error, a one-off diagnostic event, or a timing measurement?" as ONE
-- predicate — `kind = 'error'` — so "show me the errors" no longer needs a source-prefix guess.
-- It's a GENERATED column rather than something the client sends, so the classification is derived
-- from `source` at write time and can never drift out of sync with the row it describes (there is
-- nowhere for a second, disagreeing copy of the rule to live). Run ONCE, after client_errors.sql —
-- `client_errors_retention.sql`'s fast-track sweep reads this column, so apply this file first.

alter table public.client_errors
  add column if not exists kind text generated always as (
    case
      when source like 'event:%' then
        case
          -- The three sources that are genuinely a TIMING measurement rather than a state-transition
          -- diagnostic. Everything else under "event:" — cloud conflicts, delete outcomes, assembly
          -- healing, and the like — is a real diagnostic event, not disposable noise; see this
          -- file's sibling (client_errors_retention.sql) for why that distinction is load-bearing
          -- for how long a row lives, not just how it's labelled.
          when source in ('event:perf', 'event:terrain-tile-timing', 'event:perfcap') then 'timing'
          else 'event'
        end
      else 'error'
    end
  ) stored;

alter table public.client_errors drop constraint if exists client_errors_kind_valid;
alter table public.client_errors add constraint client_errors_kind_valid
  check (kind in ('error', 'event', 'timing'));

-- Triage by kind, then recency inside it — the shape every "show me the errors from the last
-- day" query actually takes.
create index if not exists client_errors_kind_at_idx on public.client_errors (kind, at desc);

comment on column public.client_errors.kind is
  'NEW-3 — error | event | timing, derived from `source`. GENERATED so it can never disagree with the row it describes.';
