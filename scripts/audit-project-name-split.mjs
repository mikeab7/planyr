#!/usr/bin/env node
/* NEW-3 (B######, owner verification 2026-09-01/09-02) — account-wide, LIVE-ROWS-ONLY project-name
 * split check + write-back reconciliation, run directly against production.
 *
 * ⛔ WHY "LIVE ROWS ONLY" IS THE WHOLE POINT, NOT A DETAIL — read before loosening the filter.
 * A first pass at this same check queried `public.sites` with no `deleted_at` filter and reported
 * group `smsrpaiqu5sv` ("Woods Road") as split: 9 rows named "Woods Road" (stamped
 * 1786656132673) against the group's own anchor row still reading "FM 359 RD, Fulshear, TX 77441"
 * (stamped 1786655992552, 114s EARLIER). Re-run with `deleted_at IS NULL` applied, the anchor row
 * turned out to be soft-deleted 5s after its own last update and 114s BEFORE the rename — i.e. the
 * owner created that plan, deleted it, then renamed the surviving group, and the rename correctly
 * never touched a tombstoned row. There was no split: 61 live rows / 37 live groups, zero
 * disagreements. A query that counts soft-deleted rows WILL fire on every group that has ever had
 * a plan deleted before a rename — which is common and harmless — and a check that cries wolf on
 * ordinary history gets ignored exactly when it matters. So: fetch only `deleted_at IS NULL` rows,
 * full stop, and see `test/projectNameLiveSplit.test.js` for the two proof cases (a real live
 * split goes red; a soft-deleted stale-name row beside agreeing live rows stays green).
 *
 * What this catches that the CLIENT-SIDE `repairSplitProjectNames()` (storage.js) might not: that
 * repair reasons over whatever this ONE BROWSER'S local store happens to hold, so a plan this
 * device has never opened is invisible to it. This script reads the whole account server-side —
 * the same "never enumerate what's locally cached" move `rename_site_group()` made for the write
 * path (see lib/cloudRename.js's header) — so it is complete regardless of what any one client has
 * hydrated.
 *
 * USAGE:
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/audit-project-name-split.mjs [--fix]
 * Exits 1 if any LIVE group disagrees (a resolvable `changes` disagreement OR an `ambiguous` one
 * with no honest winner); exits 0 otherwise. `--fix` writes the resolvable disagreements back to
 * every live row that doesn't already match its group's authority — never an ambiguous one, which
 * has no honest answer to write. Read-only without `--fix`.
 */
import { createClient } from "@supabase/supabase-js";
import { reconcileGroupNames } from "../src/workspaces/site-planner/lib/projectName.js";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role — this reads/writes across every account).");
  process.exit(2);
}
const FIX = process.argv.includes("--fix");
const sb = createClient(URL, KEY);

async function fetchLiveSites() {
  const pageSize = 1000; // PostgREST default row cap — page explicitly, same shape as audit-parcel-lineage.mjs
  let from = 0, rows = [];
  for (;;) {
    const { data, error } = await sb.from("sites").select("id,site,data,updated_at").is("deleted_at", null).range(from, from + pageSize - 1);
    if (error) throw error;
    rows = rows.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

// Shape one DB row into what projectName.js's pure functions read: `site`/`siteRenamedAt`/
// `updatedAt`/`groupId`/`id` — all sourced from `data`, mirroring storage.js's own migrate().
function toPlan(row) {
  const d = row.data || {};
  return {
    id: row.id,
    groupId: d.groupId || row.id,
    site: row.site || d.site || null,
    siteRenamedAt: typeof d.siteRenamedAt === "number" ? d.siteRenamedAt : null,
    updatedAt: row.updated_at || d.updatedAt || null,
  };
}

async function main() {
  const rows = await fetchLiveSites();
  const plans = rows.map(toPlan);
  const { changes, ambiguous } = reconcileGroupNames(plans);

  const groupCount = new Set(plans.map((p) => p.groupId)).size;
  console.log(`Scanned ${rows.length} LIVE site rows across ${groupCount} project group(s).`);

  if (!changes.length && !ambiguous.length) {
    console.log("No live group disagrees with its own project name. Nothing to report.");
    process.exit(0);
  }

  if (changes.length) {
    console.log(`\n${changes.length} row(s) disagree with their group's authoritative name (resolvable):`);
    for (const c of changes) console.log(`  - [${c.groupId}] plan ${c.id}: "${c.from}" → "${c.to}" (basis: ${c.basis})`);
  }
  if (ambiguous.length) {
    console.log(`\n${ambiguous.length} group(s) have NO honest winner (no stamp, no majority) — reported, never guessed at:`);
    for (const a of ambiguous) console.log(`  - [${a.groupId}] candidate names: ${a.names.join(" / ")} (${a.plans} plans)`);
  }

  if (FIX && changes.length) {
    console.log(`\n--fix: writing back ${changes.length} row(s)…`);
    let ok = 0, failed = 0;
    for (const c of changes) {
      // `data.site`/`data.siteRenamedAt` must move WITH the `site` column, never just one — read
      // the row's current `data` first so the patch doesn't clobber every other field in it.
      const sel = await sb.from("sites").select("data").eq("id", c.id).single();
      if (sel.error) { failed++; console.error(`  ✗ ${c.id}: ${sel.error.message}`); continue; }
      const patched = { ...(sel.data.data || {}), site: c.to, siteRenamedAt: c.at ?? (sel.data.data || {}).siteRenamedAt };
      const upd = await sb.from("sites").update({ site: c.to, data: patched }).eq("id", c.id);
      if (upd.error) { failed++; console.error(`  ✗ ${c.id}: ${upd.error.message}`); } else ok++;
    }
    console.log(`--fix done: ${ok} written, ${failed} failed.`);
    process.exit(failed > 0 ? 1 : 0);
  }

  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(2); });
