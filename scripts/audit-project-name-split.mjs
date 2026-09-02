#!/usr/bin/env node
/* NEW-3 (B1037954, owner verification 2026-09-01/09-02) — account-wide project-name split check +
 * write-back reconciliation, run directly against production.
 *
 * ⛔ WHY "LIVE ROWS ONLY" IS THE WHOLE POINT OF THE BLOCKING SPLIT GATE, NOT A DETAIL — read
 * before loosening the filter on `changes`/`ambiguous` below.
 * A first pass at this check queried `public.sites` with no `deleted_at` filter and reported
 * group `smsrpaiqu5sv` ("Woods Road") as split: 9 rows named "Woods Road" (stamped
 * 1786656132673) against the group's own anchor row still reading "FM 359 RD, Fulshear, TX 77441"
 * (stamped 1786655992552, 114s EARLIER). Re-run with `deleted_at IS NULL` applied, the anchor row
 * turned out to be soft-deleted 5s after its own last update and 114s BEFORE the rename — i.e. the
 * owner created that plan, deleted it, then renamed the surviving group, and the rename correctly
 * never touched a tombstoned row. There was no LIVE split: 61 live rows / 37 live groups, zero
 * disagreements. A query that counts soft-deleted rows WILL fire on every group that has ever had
 * a plan deleted before a rename — which is common and harmless as far as the LIVE product is
 * concerned — and a blocking check that cries wolf on ordinary history gets ignored exactly when it
 * matters. So the blocking `changes`/`ambiguous` pair below stays `deleted_at IS NULL`, full stop.
 * See `test/projectNameLiveSplit.test.js` for the two proof cases.
 *
 * ⛔ BUT A TOMBSTONED ROW'S STALE NAME IS NOT NOTHING (owner correction, 2026-09-02) — that same
 * `smsrpaiqu5sv` anchor row sat un-healed for weeks BECAUSE it is exactly what `rename_site_group()`
 * deliberately skips (`deleted_at is null` in its own WHERE clause — confirmed live: only 6 of the
 * group's 10 rows matched that predicate), and a plain `group by data->>'site'` count with NO
 * deleted_at filter kept reading it as a live split forever after. So this script now runs a SECOND,
 * separate pass — `deletedDrift` — over EVERY row (deleted included) in any group whose LIVE rows
 * already resolve to an unambiguous, STAMPED authority: a tombstoned row disagreeing with that
 * authority is reported (never silently), and `--fix` heals it through the SAME real write path,
 * `reconcile_site_group_name()` (db/reconcile_site_group_name.sql) — the reconciliation twin of
 * `rename_site_group()` that does NOT exclude soft-deleted rows, because reconciliation's whole job
 * is to converge a group onto one name EVERYWHERE it is stored, trash included. This is deliberately
 * a SEPARATE, lower-urgency class from the live split gate: it is expected to recur any time a plan
 * is deleted moments before its group is renamed, and `--fix` is cheap and idempotent, never guessed.
 *
 * ⛔ THE STAMP IS AUTHORITY; MAJORITY IS NEVER THE HEALING RULE (owner correction, 2026-09-02,
 * verbatim: "do NOT encode majority wins as the healing rule... Nine-vs-one agreeing with the
 * timestamp here is a coincidence of this particular split, not evidence that row count is a good
 * authority. The stamp is the documented authority... heal to the newest stamp, and where rows
 * disagree in a way the stamp cannot settle, fail loudly rather than guessing.") `nameAuthority`
 * (projectName.js) already reads this way for DISPLAY (majority is a LEGACY-ONLY fallback for a
 * group with no stamp on any row) — but `--fix` here goes further and refuses to WRITE BACK a
 * `"majority"`-basis resolution at all, live or deleted: only a `"stamp"`-basis authority is ever
 * auto-healed. A majority-only group is reported and left for a human, exactly like `ambiguous`.
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
 * with no honest winner) OR any tombstoned row drifted from its group's stamped live authority;
 * exits 0 otherwise. `--fix` writes every STAMP-basis resolution back to the WHOLE group (every
 * row, live or deleted) via `reconcile_site_group_name()` — never a `"majority"`-basis one, which
 * has no honest answer to write, and never a bare hand-rolled UPDATE. Read-only without `--fix`.
 */
import { createClient } from "@supabase/supabase-js";
import { reconcileGroupNames, nameAuthority, byGroup } from "../src/workspaces/site-planner/lib/projectName.js";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role — this reads/writes across every account).");
  process.exit(2);
}
const FIX = process.argv.includes("--fix");
const sb = createClient(URL, KEY);

async function fetchAllSites() {
  const pageSize = 1000; // PostgREST default row cap — page explicitly, same shape as audit-parcel-lineage.mjs
  let from = 0, rows = [];
  for (;;) {
    // No deleted_at filter here — this pass needs the WHOLE group, live and tombstoned, to find drift.
    const { data, error } = await sb.from("sites").select("id,site,data,updated_at,deleted_at").range(from, from + pageSize - 1);
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
    deletedAt: row.deleted_at || null,
  };
}

async function main() {
  const rows = await fetchAllSites();
  const plans = rows.map(toPlan);
  const live = plans.filter((p) => !p.deletedAt);
  const allByGroup = byGroup(plans);

  const groupCount = new Set(plans.map((p) => p.groupId)).size;
  console.log(`Scanned ${rows.length} site row(s) (live + deleted) across ${groupCount} project group(s).`);

  // Pass 1 — the blocking LIVE split gate. Unchanged semantics: live rows only.
  const { changes, ambiguous } = reconcileGroupNames(live);

  // Pass 2 — tombstoned-row drift against each group's own STAMPED live authority. A group with no
  // live rows at all, or whose live authority is "majority"/ambiguous, is never touched here — no
  // honest answer to hold a tombstone to.
  const deletedDrift = []; // [{ groupId, id, from, to, at }]
  const majorityOnlyGroups = []; // reported, never auto-fixed
  const stampedGroupAuthority = new Map(); // groupId -> { name, at }
  for (const [g, liveMembers] of byGroup(live)) {
    if (!liveMembers.length) continue;
    const a = nameAuthority(liveMembers);
    if (a.ambiguous || a.name == null) continue; // already reported via `ambiguous` above
    if (a.basis !== "stamp") { majorityOnlyGroups.push({ groupId: g, name: a.name }); continue; }
    stampedGroupAuthority.set(g, { name: a.name, at: a.at });
    for (const p of allByGroup.get(g) || []) {
      if (!p.deletedAt) continue; // live disagreement is already `changes`, above
      if (p.site !== a.name || p.siteRenamedAt !== a.at) {
        deletedDrift.push({ groupId: g, id: p.id, from: p.site, to: a.name, at: a.at });
      }
    }
  }

  const dirty = changes.length || ambiguous.length || deletedDrift.length;
  if (!dirty) {
    console.log("No group disagrees with its own project name, live or in the trash. Nothing to report.");
    if (majorityOnlyGroups.length) {
      console.log(`(${majorityOnlyGroups.length} legacy group(s) resolve by majority, not a stamp — informational only, never auto-fixed.)`);
    }
    process.exit(0);
  }

  if (changes.length) {
    console.log(`\n${changes.length} LIVE row(s) disagree with their group's authoritative name (resolvable):`);
    for (const c of changes) console.log(`  - [${c.groupId}] plan ${c.id}: "${c.from}" → "${c.to}" (basis: ${c.basis})`);
  }
  if (deletedDrift.length) {
    console.log(`\n${deletedDrift.length} TOMBSTONED row(s) still carry a name their group's live rows no longer agree with:`);
    for (const d of deletedDrift) console.log(`  - [${d.groupId}] plan ${d.id} (deleted): "${d.from}" → "${d.to}"`);
  }
  if (ambiguous.length) {
    console.log(`\n${ambiguous.length} LIVE group(s) have NO honest winner (no stamp, no majority) — reported, never guessed at:`);
    for (const a of ambiguous) console.log(`  - [${a.groupId}] candidate names: ${a.names.join(" / ")} (${a.plans} plans)`);
  }
  if (majorityOnlyGroups.length) {
    console.log(`\n${majorityOnlyGroups.length} LIVE group(s) resolve by legacy MAJORITY only (no stamp anywhere in the group) — never auto-fixed:`);
    for (const m of majorityOnlyGroups) console.log(`  - [${m.groupId}] would resolve to "${m.name}" by count alone — needs a human decision, not --fix.`);
  }

  if (FIX) {
    // Every group that needs a write is STAMP-basis by construction (majority-basis and ambiguous
    // groups were excluded above) — one real RPC call per group, atomic, never a bare UPDATE.
    const needsWrite = new Set([...changes.map((c) => c.groupId), ...deletedDrift.map((d) => d.groupId)]);
    console.log(`\n--fix: reconciling ${needsWrite.size} group(s) via reconcile_site_group_name()…`);
    let ok = 0, failed = 0;
    for (const g of needsWrite) {
      const a = stampedGroupAuthority.get(g);
      if (!a) { failed++; console.error(`  ✗ ${g}: no stamped authority resolved — refusing to guess.`); continue; }
      const { error } = await sb.rpc("reconcile_site_group_name", { p_group_id: g, p_site: a.name, p_renamed_at: a.at });
      if (error) { failed++; console.error(`  ✗ ${g}: ${error.message}`); } else ok++;
    }
    console.log(`--fix done: ${ok} group(s) reconciled, ${failed} failed.`);
    process.exit(failed > 0 ? 1 : 0);
  }

  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(2); });
