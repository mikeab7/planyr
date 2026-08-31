#!/usr/bin/env node
/* B966624 (NEW-1, owner report 2026-08-31) — the account-wide lineage health check that did not
 * exist before this item. `splitIntegrity.lineageAudit`/`deletedInactiveViolations` (both pure,
 * unit-tested) already know how to answer "is any split lineage actually broken" — they were just
 * never run against real data outside a test fixture. This script is that run.
 *
 * ⛔ READ BEFORE TREATING "ORPHANED parentId" AS A DEFECT. `performSplit` (SitePlanner.jsx,
 * B472048/B472049) DELETES a split's parent on purpose and keeps `parentId` on each child as a
 * historical STAMP, never a live reference — the owner's own decision, on the record: "no
 * because the two new parcels would have the same exterior outline." `siteModel.childrenByParent`
 * / `parcelOutline` already treat an absent parent as "nesting stops," and B966625 fixed the one
 * place that didn't (the panel's indentation, which was reading the STAMPED lineage depth instead
 * of a walked one). So an orphaned `parentId` is BY DESIGN under every split done since B472049,
 * and this script does NOT flag it. What it flags is the two things that actually cost a number:
 *   - DOUBLE-COUNTED land: a live ancestor AND a live descendant in one lineage (`lineageAudit`).
 *   - VANISHED land: an entire split lineage with no live member at all (`lineageAudit`).
 *   - a soft-deleted parcel that still reads active:true (`deletedInactiveViolations`) — mostly
 *     superseded now that `enforce_parcel_deleted_inactive` (db/parcel_active_deleted_invariant.sql)
 *     forces this at the write path, but this stays as the read-side cross-check.
 *
 * ⛔ THE "11 vs 14" SPLIT THE OWNER'S DISPATCH MEASURED (11 children reference an id with NO ROW
 * AT ALL; 14 reference a soft-deleted row) IS A RED HERRING AT THE APP LEVEL, TRACED TO ONE
 * MECHANISM — worth recording here so it is not re-investigated. The client only ever loads LIVE
 * (`deleted_at is null`) rows, so "parent tombstoned" and "parent absent" are ALREADY the same
 * state in the running app: `byId.has(p.parentId)` is false either way. The DB-level difference
 * traces to SITE DUPLICATION: confirmed directly against production that Bain's two duplicate
 * sites (`smthnivfhuyy`, `smthnjl2cxyg`) carry split children whose `parentId` points at
 * `e1455075mkspvo`/`e1455079kvgdip` — rows that exist, correctly tombstoned (`deleted_at` set,
 * `active:false`), ONLY in the ORIGINAL site `smsqi16s9ej4`. Duplicating a site copies its live
 * rows only, never its tombstones, which is reasonable (a duplicate's own delete history starting
 * clean is not itself wrong) but means a duplicate can hold a split child with literally no trace
 * of its parent anywhere in ITS OWN site_elements. Harmless today (parentId is inert once the
 * parent is gone, by the design above) — flagged here as a known, understood shape so a future
 * session recognizes it instead of re-deriving it.
 *
 * USAGE:
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/audit-parcel-lineage.mjs [--site=<id>]
 * Exits 1 if any DOUBLE-COUNTED or VANISHED lineage is found (the two states that cost a real
 * number); exits 0 (with a report) otherwise. Read-only — never writes.
 */
import { createClient } from "@supabase/supabase-js";
import { lineageAudit, deletedInactiveViolations } from "../src/workspaces/site-planner/lib/splitIntegrity.js";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role — this reads across every account).");
  process.exit(2);
}
const onlySite = (process.argv.find((a) => a.startsWith("--site=")) || "").split("=")[1] || null;

const sb = createClient(URL, KEY);

async function fetchAllParcels() {
  const pageSize = 1000; // PostgREST default row cap (B723/B724) — page explicitly
  let from = 0, rows = [];
  for (;;) {
    let q = sb.from("site_elements").select("site_id,id,data,deleted_at").eq("kind", "parcel").range(from, from + pageSize - 1);
    if (onlySite) q = q.eq("site_id", onlySite);
    const { data, error } = await q;
    if (error) throw error;
    rows = rows.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function toParcel(row) {
  return { id: row.id, ...(row.data || {}), deletedAt: row.deleted_at };
}

async function main() {
  const rows = await fetchAllParcels();
  const bySite = new Map();
  for (const r of rows) {
    if (!bySite.has(r.site_id)) bySite.set(r.site_id, []);
    bySite.get(r.site_id).push(toParcel(r));
  }

  let doubleCounted = 0, vanished = 0, cycles = 0, deletedActive = 0;
  const findings = [];
  for (const [siteId, parcels] of bySite) {
    const audit = lineageAudit(parcels);
    for (const m of audit.messages) findings.push(`[${siteId}] ${m}`);
    doubleCounted += audit.doubleCounted.length;
    vanished += audit.vanished.length;
    cycles += audit.cycles.length;
    const dv = deletedInactiveViolations(parcels);
    if (dv.length) { deletedActive += dv.length; findings.push(`[${siteId}] ${dv.length} soft-deleted parcel(s) still read active:true (should be caught by the DB trigger): ${dv.join(", ")}`); }
  }

  console.log(`Scanned ${rows.length} parcel rows across ${bySite.size} site(s)${onlySite ? ` (filtered to ${onlySite})` : ""}.`);
  console.log(`Double-counted lineages: ${doubleCounted} · Vanished lineages: ${vanished} · Parent-id cycles: ${cycles} · deleted+active violations: ${deletedActive}`);
  if (findings.length) { console.log("\nFindings:"); for (const f of findings) console.log(`  - ${f}`); }
  else console.log("No double-counted or vanished lineages, no cycles, no deleted+active violations.");

  process.exit(doubleCounted > 0 || vanished > 0 || cycles > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
