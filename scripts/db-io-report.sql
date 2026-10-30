-- db-io-report.sql — READ-ONLY. Where is planyr_production's DISK I/O actually coming from?
-- Run in the Supabase SQL editor (or through the SQL API). Written for B2559168 (2026-10-30), after the
-- "running out of daily disk I/O burst budget" email turned out NOT to be WAL- or read-driven.
--
-- THE LESSON IT ENCODES: check TEMP FILES first. Postgres spills a sort/hash that does not fit in
-- work_mem (~2 MB on the smallest compute) to a temp file on the data disk, writes it, reads it back and
-- deletes it. On 2026-10-30 that was 61 GB (66,015,700,766 bytes, 26,488 files) — ~70x the WAL — and 38.8 GB
-- of it was ONE function (food_places_in_bounds_sampled). WAL was ~35 MB/day and disk reads 96 MB total.
-- All counters are cumulative since the stats were last reset: take two readings a known interval apart
-- and subtract; never compare a fresh delta with a lifetime total.

-- 1. The three things that can generate disk I/O, side by side (take this twice; subtract).
select now() as taken_at,
  (select temp_files from pg_stat_database where datname = current_database())                  as temp_files,
  (select temp_bytes from pg_stat_database where datname = current_database())                  as temp_bytes,
  pg_size_pretty((select temp_bytes from pg_stat_database where datname = current_database()))  as temp_pretty,
  (select wal_bytes from pg_stat_wal)                                                           as wal_bytes,
  (select stats_reset from pg_stat_wal)                                                         as wal_since,
  (select blks_read * 8192 from pg_stat_database where datname = current_database())            as heap_read_bytes_from_disk_or_os_cache;

-- 2. Which statements spill to temp files (the top rows are the fix list; 0 rows is the goal).
select left(regexp_replace(query, '\s+', ' ', 'g'), 120) as q, calls,
  round(mean_exec_time) as mean_ms,
  pg_size_pretty(temp_blks_written * 8192) as temp_written,
  pg_size_pretty(temp_blks_read * 8192)    as temp_read
from pg_stat_statements
where temp_blks_written > 0
order by temp_blks_written desc
limit 10;

-- 3. Which statements generate the most WAL (writes). Compare with section 1's wal_bytes.
select left(regexp_replace(query, '\s+', ' ', 'g'), 120) as q, calls,
  pg_size_pretty(wal_bytes) as wal, wal_fpi as full_page_images
from pg_stat_statements
order by wal_bytes desc
limit 8;

-- 4. Reads that really missed memory, by table (tiny is normal: the whole DB is ~300 MB).
select relname,
  pg_size_pretty((coalesce(heap_blks_read,0) + coalesce(idx_blks_read,0) + coalesce(toast_blks_read,0) + coalesce(tidx_blks_read,0)) * 8192) as read_from_disk
from pg_statio_user_tables
order by coalesce(heap_blks_read,0) + coalesce(idx_blks_read,0) + coalesce(toast_blks_read,0) + coalesce(tidx_blks_read,0) desc
limit 8;

-- 5. The knobs that decide whether a sort spills (smallest compute: work_mem ~2 MB, shared_buffers ~224 MB).
select name, setting, unit from pg_settings
where name in ('work_mem', 'shared_buffers', 'max_wal_size', 'checkpoint_timeout', 'track_io_timing');
-- Per-function overrides (browse sets work_mem = 12MB for itself only):
select proname, proconfig from pg_proc
where pronamespace = 'public'::regnamespace and proconfig::text ilike '%work_mem%';
