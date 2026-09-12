#!/usr/bin/env node
/* NEW-3 (2026-09-12 owner review, "too many sources of truth") — account-wide check for the two
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
 *
 * Plus one INFORMATIONAL count (never blocking, see nameGroupIntegrity.scheduleNameDrift's own
 * header for why): a linked-Schedule name hint (`data.scheduleProjectName`) that has gone stale
 * against its project's current name.
 *
 * MEASURED 2026-09-12 (not re-derived by this script — this is what it exists to keep true): 125
 * rows, 0 name-column disagreements, 1 group-key disagreement (the seeded e2e fixture row
 * `e2e-fixture-testfit` — a typo in e2e/seed/seed-fixtures.sql, fixed alongside this script — every
 * one of the owner's own 34 real project groups already agrees, per B366386's own sweep), 7
 * non-empty scheduleProjectName hints, all in agreement with their project's name that day.
 *
 * USAGE:
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/audit-name-group-integrity.mjs [--fix]
 * Exits 1 if any row has a name-column disagreement or a group-key disagreement; exits 0 otherwise
 * (the schedule-name-drift count never affects the exit code). `--fix` corrects ONLY group-key
 * disagreements, via `backfill_group_id_column()` (db/backfill_group_id_column.sql) — never a bare
 * hand-rolled UPDATE. It deliberately does NOT auto-fix a name-column disagreement: unlike the
 * group-id mirror, `sites_rename_stamp_guard.sql`'s own header records one historical case
 * (`smrkumgymt65`) where the COLUMN, not the jsonb, was the better value — so a blanket "jsonb
 * wins" rule would sometimes push the worse name onto a row a human should look at instead. Read-
 * only without `--fix`.
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

async function main() {
  const rows = await fetchAllSites();
  const { nameMismatches, groupKeyMismatches, scheduleNameDrifts } = auditRows(rows);
  console.log(`Scanned ${rows.length} site row(s) (live + deleted).`);

  const dirty = nameMismatches.length || groupKeyMismatches.length;
  if (!dirty) {
    console.log("No row disagrees with itself on its name, and no row's two group keys disagree.");
  } else {
    if (nameMismatches.length) {
      console.log(`\n${nameMismatches.length} row(s) disagree with THEMSELVES on their project name (site column vs data.site):`);
      for (const m of nameMismatches) console.log(`  - ${m.id}: column="${m.siteColumn}" jsonb="${m.siteJsonb}"`);
    }
    if (groupKeyMismatches.length) {
      console.log(`\n${groupKeyMismatches.length} row(s) have disagreeing group keys (jsonb vs group_id column):`);
      for (const m of groupKeyMismatches) console.log(`  - ${m.id}: jsonb="${m.jsonbKey}" column="${m.columnKey}"`);
    }
  }
  if (scheduleNameDrifts.length) {
    console.log(`\n(informational, never blocking) ${scheduleNameDrifts.length} row(s) carry a stale scheduleProjectName hint:`);
    for (const d of scheduleNameDrifts) console.log(`  - ${d.id}: hint="${d.scheduleProjectName}" project is now "${d.authoritativeName}"`);
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
