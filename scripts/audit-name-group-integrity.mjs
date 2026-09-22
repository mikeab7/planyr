#!/usr/bin/env node
/* NEW-3 (2026-09-12 owner review, "too many sources of truth") — account-wide check for the
 * data-integrity holes nameGroupIntegrity.js exists to catch, run directly against production:
 *
 *   1. A row whose own `site` column disagrees with its own `data.site` jsonb field — never
 *      legitimate, live or deleted (rename_site_group()/reconcile_site_group_name() always write
 *      both together in one statement).
 *   2. A row where the group key the RPCs use (`coalesce(data->>'groupId', id)`) disagrees with
 *      the group key several client resolvers in storage.js/cloudSync.js still read
 *      (`row.group_id || row.id`, the denormalized COLUMN mirror three SQL files in this repo
 *      already document as "known to drift" — rename_site_group.sql, set_site_group_role.sql,
 *      team_share_state.sql).
 *   3. NEW-1 (2026-09-15) — a row with no valid rename stamp at all: `sites_preserve_rename_stamp`
 *      (db/sites_rename_stamp_guard.sql) can only ever protect a stamp that is already there, so
 *      such a row has NO defense against a stale write overwriting its name. `sites_rename_stamp_
 *      guard.sql`'s BEFORE INSERT trigger now seeds one on every row the moment it is created, so
 *      this should never fire again — it exists to prove that, not to find the next one to fix by
 *      hand.
 *   4. NEW-1 (B1793504, 2026-09-20) — a linked-Schedule name hint (`data.scheduleProjectName`)
 *      that has gone stale against its OWN project's current name. Promoted from informational —
 *      see nameGroupIntegrity.scheduleNameDrift's own header for the full reasoning: the one
 *      accessor that ever handed this stored snapshot to a caller (`storage.scheduleLinkOf()`) now
 *      derives its display name from the group's own current name instead, so a real divergence
 *      here means only the MCP connector's own offline/backend-unreachable fallback value has gone
 *      stale — worth the same "found → someone corrects it" treatment as the three checks above,
 *      never auto-fixed here.
 *
 * Plus one INFORMATIONAL count (never blocking, see nameGroupIntegrity.scheduleNameStaleAgainstLive's
 * own header for why): (B1768080, 2026-09-18) a hint that has gone stale against the linked
 * SCHEDULE's own current live name (from `planar_data`) — a different question from #4 above, and
 * the one that actually caught something: schedule id 30 was renamed to "MUD v PID" while four
 * `sites` rows still carried the stale hint "Goose Creek", a divergence the site-name comparison
 * alone could never see (the site's own name never changed). `functions/api/mcp/_tools.js`/
 * `_metrics.js` no longer trust this stored hint over the live backend, and this comparison depends
 * on the scheduler backend being reachable at audit time, so it stays a hygiene signal rather than
 * a blocking one.
 *
 * MEASURED 2026-09-12 (not re-derived by this script — this is what it exists to keep true): 125
 * rows, 0 name-column disagreements, 1 group-key disagreement (the seeded e2e fixture row
 * `e2e-fixture-testfit` — a typo in e2e/seed/seed-fixtures.sql, fixed alongside this script — every
 * one of the owner's own 34 real project groups already agrees, per B366386's own sweep), 7
 * non-empty scheduleProjectName hints, all in agreement with their project's name that day.
 * MEASURED 2026-09-15: 127 rows, 1 unstamped (`smu1z3h60nbu`, created three days after the
 * 2026-09-12 rename-stamp backfill) — repaired the same session, and the INSERT trigger that stops
 * a recurrence is applied.
 *
 * USAGE:
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/audit-name-group-integrity.mjs [--fix]
 * Exits 1 if any row has a name-column disagreement, a group-key disagreement, no valid rename
 * stamp, or a scheduleProjectName hint stale against its own project's current name; exits 0
 * otherwise (the schedule-vs-live-backend count never affects the exit code). `--fix`
 * corrects ONLY group-key disagreements, via `backfill_group_id_column()`
 * (db/backfill_group_id_column.sql) — never a bare hand-rolled UPDATE. It deliberately does NOT
 * auto-fix a name-column disagreement: unlike the group-id mirror, `sites_rename_stamp_guard.sql`'s
 * own header records one historical case (`smrkumgymt65`) where the COLUMN, not the jsonb, was the
 * better value — so a blanket "jsonb wins" rule would sometimes push the worse name onto a row a
 * human should look at instead. It also does NOT auto-fix an unstamped row — that repair (seed from
 * the row's own `updated_at`, the same Tier-2 convention rename_stamp_backfill_20260912.sql used)
 * is a one-line, self-scoping SQL statement, already applied; a NEW unstamped row appearing here
 * would mean the INSERT trigger itself stopped firing, which needs investigation, not a re-run of
 * this flag. Read-only without `--fix`.
 */
import { createClient } from "@supabase/supabase-js";
import { auditRows } from "../src/workspaces/site-planner/lib/nameGroupIntegrity.js";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role — this reads/writes across every account).");
  process.exit(2);
}
const FIX = process.argv.includes("--fix");
const sb = createClient(URL, KEY);

async function fetchAllSites() {
  const pageSize = 1000; // PostgREST default row cap — page explicitly, same shape as audit-project-name-split.mjs
  let from = 0, rows = [];
  for (;;) {
    const { data, error } = await sb.from("sites").select("id,site,data,group_id,updated_at,deleted_at").range(from, from + pageSize - 1);
    if (error) throw error;
    rows = rows.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

// B1768080 — the scheduler's own record of every schedule project's CURRENT name, keyed the same
// way `functions/api/mcp/_tools.js`'s `liveScheduleNameMap` builds it (string schedule id → name).
// Best-effort: an unreachable/empty scheduler backend just means `scheduleNameStaleAgainstLive`
// has nothing to compare against (silent per-row, per its own header), never a hard failure — this
// script's exit code is about the four BLOCKING checks, not about the scheduler being reachable.
async function fetchLiveScheduleNameById() {
  const { data, error } = await sb.from("planar_data").select("value").eq("key", "hs-v1");
  if (error) { console.warn(`(schedule-name-vs-live comparison skipped: ${error.message})`); return null; }
  const projects = (data && data[0] && data[0].value && data[0].value.projects) || {};
  const map = new Map();
  for (const sp of Object.values(projects)) {
    if (sp && sp.id != null) map.set(String(sp.id), sp.name ?? null);
  }
  return map;
}

async function main() {
  const [rows, liveScheduleNameById] = await Promise.all([fetchAllSites(), fetchLiveScheduleNameById()]);
  const { nameMismatches, groupKeyMismatches, unstampedRows, scheduleNameDrifts, scheduleNameStaleVsLive } =
    auditRows(rows, { liveScheduleNameById });
  console.log(`Scanned ${rows.length} site row(s) (live + deleted).`);

  const dirty = nameMismatches.length || groupKeyMismatches.length || unstampedRows.length || scheduleNameDrifts.length;
  if (!dirty) {
    console.log("No row disagrees with itself on its name, no row's two group keys disagree, every row carries a valid rename stamp, and no scheduleProjectName hint disagrees with its own project's current name.");
  } else {
    if (nameMismatches.length) {
      console.log(`\n${nameMismatches.length} row(s) disagree with THEMSELVES on their project name (site column vs data.site):`);
      for (const m of nameMismatches) console.log(`  - ${m.id}: column="${m.siteColumn}" jsonb="${m.siteJsonb}"`);
    }
    if (groupKeyMismatches.length) {
      console.log(`\n${groupKeyMismatches.length} row(s) have disagreeing group keys (jsonb vs group_id column):`);
      for (const m of groupKeyMismatches) console.log(`  - ${m.id}: jsonb="${m.jsonbKey}" column="${m.columnKey}"`);
    }
    if (unstampedRows.length) {
      console.log(`\n${unstampedRows.length} row(s) carry NO valid rename stamp (sites_preserve_rename_stamp has nothing to protect them with):`);
      for (const u of unstampedRows) console.log(`  - ${u.id}`);
    }
    if (scheduleNameDrifts.length) {
      // NEW-1 (B1793504, 2026-09-20) — promoted from informational; see scheduleNameDrift's own
      // header. Never auto-fixed here, same as nameMismatches above: re-link via setScheduleLink
      // (or wait for the next genuine link-change event) to correct it.
      console.log(`\n${scheduleNameDrifts.length} row(s) carry a scheduleProjectName hint that disagrees with their PROJECT's own current name:`);
      for (const d of scheduleNameDrifts) console.log(`  - ${d.id}: hint="${d.scheduleProjectName}" project is now "${d.authoritativeName}"`);
    }
  }
  if (scheduleNameStaleVsLive.length) {
    console.log(`\n(informational, never blocking) ${scheduleNameStaleVsLive.length} row(s) carry a scheduleProjectName hint that disagrees with the linked SCHEDULE's own current live name:`);
    for (const d of scheduleNameStaleVsLive) console.log(`  - ${d.id}: hint="${d.storedName}" schedule ${d.scheduleProjectId} is now named "${d.liveName}"`);
  } else if (liveScheduleNameById) {
    console.log("\nNo row's scheduleProjectName hint disagrees with its linked schedule's own current live name.");
  }

  if (FIX) {
    if (!groupKeyMismatches.length) {
      console.log("\n--fix: nothing to do (no group-key disagreements).");
    } else {
      console.log(`\n--fix: backfilling ${groupKeyMismatches.length} row(s)' group_id column via backfill_group_id_column()…`);
      let ok = 0, failed = 0;
      for (const m of groupKeyMismatches) {
        const { error } = await sb.rpc("backfill_group_id_column", { p_id: m.id });
        if (error) { failed++; console.error(`  ✗ ${m.id}: ${error.message}`); } else ok++;
      }
      console.log(`--fix done: ${ok} row(s) backfilled, ${failed} failed.`);
      if (failed > 0) process.exit(1);
    }
  }

  process.exit(dirty ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
