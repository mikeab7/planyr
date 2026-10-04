-- drift-report.sql — READ-ONLY. One row per stored COPY: how many rows disagree with the source.
--
-- Run it any time, from any session, against production:
--   · Supabase SQL editor / MCP `execute_sql` — paste the whole file (it is ONE select).
--   · `npm run drift-report` prints it with the run instructions; with `DATABASE_URL` + psql it runs it.
-- It only SELECTs. It changes nothing and is safe on production (B2064896).
--
-- Columns: id (matches scripts/denormalisedCopies.json), copy, source, verdict (A/B/C — see
-- docs/audit-single-source-of-truth.md), drifted (rows that disagree), total (rows compared).
-- A verdict-A copy MUST read drifted = 0 after its backfill; a B/C row may legitimately differ
-- (snapshot / cache) and is listed so the difference is visible, never so it can be silently ignored.
-- test/denormalisedCopies.test.js fails the build if an id here is missing from the manifest or vice versa.
--
-- Project keys: `linked_site_id` / `project_id` hold either a plan id or a group id, so every project
-- lookup goes through `pk` (key → group) and `gp` (group → current name/team).
with
pk as (
  select group_id k, group_id gid from sites where deleted_at is null and group_id is not null
  union select id, group_id from sites where deleted_at is null and group_id is not null
),
gp as (
  select group_id gid,
         (array_agg(site    order by updated_at desc))[1] site,
         (array_agg(team_id order by updated_at desc))[1] team_id,
         (array_agg(county  order by updated_at desc))[1] county
  from sites where deleted_at is null and group_id is not null group by 1
),
checks as (
  -- ── schedules ─────────────────────────────────────────────────────────────────────────────
  select 'D01' id, 'schedules.linked_site_name' copy, 'sites.site (live project name)' source, 'A' verdict,
         count(*) filter (where g.site is not null and s.linked_site_name is distinct from g.site) drifted,
         count(*) filter (where g.site is not null) total
  from schedules s join pk on pk.k = s.linked_site_id join gp g on g.gid = pk.gid where s.deleted_at is null
  union all
  select 'D02', 'schedules.name / linked_site_id / linked_site_name', 'schedules.data (source of truth for content)', 'C',
         count(*) filter (where s.name is distinct from s.data->>'name'
                             or coalesce(s.linked_site_id,'') is distinct from coalesce(s.data->>'linkedSiteId','')
                             or coalesce(s.linked_site_name,'') is distinct from coalesce(s.data->>'linkedSiteName','')), count(*)
  from schedules s where s.deleted_at is null
  union all
  select 'D03', 'schedules.linked_site_id points at a live project', 'sites (group/plan id)', 'A',
         count(*) filter (where pk.k is null), count(*)
  from schedules s left join pk on pk.k = s.linked_site_id where s.deleted_at is null and s.linked_site_id is not null
  union all
  select 'D04', 'sites.data.scheduleProjectId (plan says which schedule)', 'schedules.linked_site_id (schedule says which project)', 'A',
         -- a plan whose hint names no live schedule linked to its project …
         (select count(*) from sites p where p.deleted_at is null and p.data->>'scheduleProjectId' is not null
            and not exists (select 1 from schedules s where s.deleted_at is null and s.id::text = p.data->>'scheduleProjectId'
                              and s.linked_site_id in (p.id, p.group_id)))
         -- … plus a project that HAS a linked schedule but no plan carries ANY hint (one hint per project is by design,
         -- so a second schedule without a carrier is not drift)
         + (select count(*) from (select distinct pk2.gid from schedules s join pk pk2 on pk2.k = s.linked_site_id where s.deleted_at is null) g
              where not exists (select 1 from sites p where p.deleted_at is null and p.group_id = g.gid and p.data->>'scheduleProjectId' is not null)),
         (select count(*) from sites p where p.deleted_at is null and p.data->>'scheduleProjectId' is not null)
         + (select count(distinct pk2.gid) from schedules s join pk pk2 on pk2.k = s.linked_site_id where s.deleted_at is null)
  union all
  select 'D05', 'sites.data.scheduleProjectName (write-once hint)', 'sites.site (live project name)', 'B',
         count(*) filter (where p.data->>'scheduleProjectName' is distinct from p.site), count(*)
  from sites p where p.deleted_at is null and p.data->>'scheduleProjectName' is not null
  -- ── doc_reviews ───────────────────────────────────────────────────────────────────────────
  union all
  select 'D06', 'doc_reviews.project', 'sites.site (live project name)', 'A',
         count(*) filter (where g.site is not null and d.project is distinct from g.site), count(*) filter (where g.site is not null)
  from doc_reviews d join pk on pk.k = d.project_id join gp g on g.gid = pk.gid where d.deleted_at is null
  union all
  select 'D07', 'doc_reviews.title/kind/project/project_id/discipline/item/revision/doc_date', 'doc_reviews.data (source of truth for content)', 'C',
         count(*) filter (where coalesce(d.title,'') is distinct from coalesce(d.data->>'title','')
                             or coalesce(d.kind,'') is distinct from coalesce(d.data->>'kind','')
                             or coalesce(d.project,'') is distinct from coalesce(d.data->>'project','')
                             or coalesce(d.project_id,'') is distinct from coalesce(d.data->>'projectId','')
                             or coalesce(d.discipline,'') is distinct from coalesce(d.data->>'discipline','')
                             or coalesce(d.item,'') is distinct from coalesce(d.data->>'item','')
                             or coalesce(d.revision,'') is distinct from coalesce(d.data->>'revision','')
                             or d.doc_date::text is distinct from nullif(d.data->>'docDate','')), count(*)
  from doc_reviews d where d.deleted_at is null
  -- ── file_facts (filing index) ─────────────────────────────────────────────────────────────
  union all
  select 'D08', 'file_facts.project_id/discipline/item/revision/doc_date (review owns them)', 'doc_reviews columns (by review_id)', 'A',
         -- the review is the owner: drift = the review states a value the index copy lacks or contradicts.
         -- (A value only the index holds is a GAP in the review — loadReview fills it — not a stale copy.)
         count(*) filter (where f.project_id is distinct from d.project_id
                             or (coalesce(d.discipline,'') not in ('','Other') and coalesce(f.discipline,'') is distinct from d.discipline)
                             or (coalesce(d.item,'') <> '' and coalesce(f.item,'') is distinct from d.item)
                             or (coalesce(d.revision,'') <> '' and coalesce(f.revision,'') is distinct from d.revision)
                             or (d.doc_date is not null and f.doc_date is distinct from d.doc_date)), count(*)
  from file_facts f join doc_reviews d on d.id = f.review_id and d.deleted_at is null
  union all
  select 'D09', 'file_facts.source_file', 'doc_reviews.data.sourceFile (both present and different)', 'C',
         count(*) filter (where coalesce(f.source_file,'') <> '' and coalesce(d.data->>'sourceFile','') <> '' and f.source_file is distinct from d.data->>'sourceFile'), count(*)
  from file_facts f join doc_reviews d on d.id = f.review_id and d.deleted_at is null
  -- ── site-plan overlays ────────────────────────────────────────────────────────────────────
  union all
  select 'D10', 'site_plan_overlays.doc_title / doc_date', 'doc_reviews.title / doc_date (by review_id)', 'B',
         count(*) filter (where coalesce(o.doc_title,'') is distinct from coalesce(d.title,'') or o.doc_date is distinct from d.doc_date), count(*)
  from site_plan_overlays o join doc_reviews d on d.id = o.review_id and d.deleted_at is null where o.deleted_at is null
  union all
  select 'D11', 'site_plan_overlays.project_id', 'doc_reviews.project_id (by review_id)', 'B',
         count(*) filter (where o.project_id is distinct from d.project_id), count(*)
  from site_plan_overlays o join doc_reviews d on d.id = o.review_id and d.deleted_at is null where o.deleted_at is null
  -- ── team stamp on child rows vs the project's team (sharing facts; reported, never auto-changed) ──
  union all
  select 'D12', 'doc_reviews/overlays/comps/map_notes .team_id', 'sites.team_id of the project', 'B',
         (select count(*) from doc_reviews d join pk on pk.k = d.project_id join gp g on g.gid = pk.gid where d.deleted_at is null and d.team_id is distinct from g.team_id)
         + (select count(*) from site_plan_overlays o join pk on pk.k = o.project_id join gp g on g.gid = pk.gid where o.deleted_at is null and o.team_id is distinct from g.team_id)
         + (select count(*) from comps c join pk on pk.k = c.project_id join gp g on g.gid = pk.gid where c.deleted_at is null and c.team_id is distinct from g.team_id)
         + (select count(*) from map_notes m join pk on pk.k = m.project_id join gp g on g.gid = pk.gid where m.deleted_at is null and m.team_id is distinct from g.team_id),
         (select count(*) from doc_reviews d join pk on pk.k = d.project_id where d.deleted_at is null)
         + (select count(*) from site_plan_overlays o join pk on pk.k = o.project_id where o.deleted_at is null)
         + (select count(*) from comps c join pk on pk.k = c.project_id where c.deleted_at is null)
         + (select count(*) from map_notes m join pk on pk.k = m.project_id where m.deleted_at is null)
  -- ── sites (plan rows) ─────────────────────────────────────────────────────────────────────
  union all
  select 'D13', 'sites.site/name/county/group_id/team_id columns', 'sites.data blob', 'C',
         count(*) filter (where s.site is distinct from s.data->>'site' or s.name is distinct from s.data->>'name'
                             or coalesce(s.county,'') is distinct from coalesce(s.data->>'county','')
                             or coalesce(s.group_id,'') is distinct from coalesce(s.data->>'groupId','')
                             or (s.data->>'teamId' is not null and s.team_id::text is distinct from s.data->>'teamId')), count(*)
  from sites s where s.deleted_at is null
  union all
  select 'D14', 'sites.site (project name, one copy per plan)', 'the other plans of the same project', 'A',
         count(*), (select count(distinct group_id) from sites where deleted_at is null)
  from (select group_id from sites where deleted_at is null group by 1 having count(distinct site) > 1) x
  union all
  select 'D15', 'sites.data.status (one copy per plan)', 'the other plans of the same project', 'A',
         count(*), (select count(distinct group_id) from sites where deleted_at is null)
  from (select group_id from sites where deleted_at is null group by 1 having count(distinct data->>'status') > 1) x
  union all
  select 'D16', 'sites.data role/closingDate/loiDate/feasibilityExpiry (per plan)', 'the other plans of the same project', 'A',
         count(*), (select count(distinct group_id) from sites where deleted_at is null)
  from (select group_id from sites where deleted_at is null group by 1
        having count(distinct data->>'role') > 1 or count(distinct data->>'closingDate') > 1
            or count(distinct data->>'loiDate') > 1 or count(distinct data->>'feasibilityExpiry') > 1) x
  union all
  select 'D17', 'sites.thumbnail_svg', 'the plan it pictures (sites.updated_at)', 'C',
         count(*) filter (where thumbnail_svg is not null and thumbnail_updated_at < updated_at - interval '1 minute'), count(*) filter (where thumbnail_svg is not null)
  from sites where deleted_at is null
  union all
  select 'D18', 'sites.updated_at', 'sites.data.updatedAt', 'C',
         count(*) filter (where data->>'updatedAt' is not null and abs(extract(epoch from updated_at)*1000 - (data->>'updatedAt')::numeric) > 5000), count(*)
  from sites where deleted_at is null
  union all
  select 'D19', 'sites.data.els (blob copy of elements)', 'site_elements rows (rows canonical once elementsInRows)', 'C',
         count(*) filter (where coalesce(s.data->>'elementsInRows','false') <> 'true'
                             and jsonb_array_length(coalesce(s.data->'els','[]')) is distinct from
                                 (select count(*) from site_elements e where e.site_id = s.id and e.kind = 'el' and e.deleted_at is null)), count(*)
  from sites s where s.deleted_at is null
  -- ── Library folders ───────────────────────────────────────────────────────────────────────
  union all
  select 'D20', 'project_folders.name / trashed', 'project_folders.drive_name / drive_trashed (Drive mirror)', 'C',
         count(*) filter (where drive_name is not null and name is distinct from drive_name)
         + count(*) filter (where drive_trashed is not null and trashed is distinct from drive_trashed), count(*) filter (where drive_folder_id is not null)
  from project_folders
  union all
  select 'D21', 'project_folders rows of a deleted project', 'sites (project still exists)', 'B',
         count(*) filter (where pk.k is null), count(*)
  from project_folders f left join pk on pk.k = f.project_id
  -- ── Food / profiles ───────────────────────────────────────────────────────────────────────
  union all
  select 'D22', 'food_dishes.place_id', 'food_visits.place_id (DB trigger keeps it)', 'C',
         count(*) filter (where dd.place_id is distinct from v.place_id), count(*)
  from food_dishes dd join food_visits v on v.id = dd.visit_id
  union all
  select 'D23', 'profiles.email', 'auth.users.email', 'C',
         count(*) filter (where p.email is distinct from lower(u.email)), count(*)
  from profiles p join auth.users u on u.id = p.id
  -- ── frozen legacy / backups ───────────────────────────────────────────────────────────────
  union all
  select 'D24', 'planar_data hs-v1 blob projects', 'schedules.data (rows_authoritative = true)', 'B',
         count(*) filter (where s.data is distinct from e.value), count(*)
  from planar_data p cross join lateral jsonb_each(p.value->'projects') e
       left join schedules s on s.id::text = e.key where p.key = 'hs-v1'
  union all
  select 'D25', 'recovery_* snapshot tables (intentional backups)', 'n/a', 'B',
         0, count(*) from pg_tables where schemaname = 'public' and tablename like 'recovery\_%'
)
select id, copy, source, verdict, drifted, total from checks order by id;
