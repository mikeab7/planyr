#!/usr/bin/env node
/* drift-report — READ-ONLY report of every stored COPY that disagrees with its source (B2064896).
 *
 *   npm run drift-report                 # prints the SQL + how to run it
 *   DATABASE_URL=postgres://… npm run drift-report -- --run     # runs it through psql (read-only)
 *   npm run drift-report -- --check      # offline: the SQL and scripts/denormalisedCopies.json agree
 *
 * The SQL (scripts/drift-report.sql) is ONE select; it can equally be pasted into the Supabase SQL
 * editor or sent through the Supabase MCP `execute_sql`. It never writes. Exit code with --run: 1 when
 * any verdict-A copy has drifted rows (so it can gate a release), else 0.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const SQL_PATH = join(here, "drift-report.sql");
export const MANIFEST_PATH = join(here, "denormalisedCopies.json");

export function checkIdsInSql(sql) {
  return [...sql.matchAll(/select\s+'(D\d{2})'/gi)].map((m) => m[1]);
}
export function loadManifest() { return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")); }

/** Offline consistency: every D## in the SQL is claimed by a manifest copy and vice versa. Returns problems[]. */
export function consistencyProblems(sql = readFileSync(SQL_PATH, "utf8"), manifest = loadManifest()) {
  const inSql = new Set(checkIdsInSql(sql));
  const claimed = new Set(manifest.copies.map((c) => c.driftCheck).filter(Boolean));
  const out = [];
  for (const id of inSql) if (!claimed.has(id)) out.push(`${id} is in drift-report.sql but no manifest copy declares it`);
  for (const id of claimed) if (!inSql.has(id)) out.push(`${id} is declared in the manifest but drift-report.sql has no such check`);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const sql = readFileSync(SQL_PATH, "utf8");
  if (args.includes("--check")) {
    const p = consistencyProblems(sql);
    if (p.length) { console.error(p.join("\n")); process.exit(1); }
    console.log(`drift-report: ${checkIdsInSql(sql).length} checks, manifest agrees.`);
  } else if (args.includes("--run")) {
    if (!process.env.DATABASE_URL) { console.error("--run needs DATABASE_URL (a read-only role is ideal). Or paste scripts/drift-report.sql into the Supabase SQL editor."); process.exit(2); }
    const r = spawnSync("psql", [process.env.DATABASE_URL, "-X", "-A", "-F", "\t", "-t", "-v", "ON_ERROR_STOP=1", "-c", "set default_transaction_read_only = on", "-f", SQL_PATH], { encoding: "utf8" });
    if (r.status !== 0) { console.error(r.stderr || "psql failed"); process.exit(2); }
    const rows = r.stdout.trim().split("\n").filter(Boolean).map((l) => l.split("\t"));
    console.log("id\tverdict\tdrifted/total\tcopy");
    let aDrift = 0;
    for (const [id, copy, , verdict, drifted, total] of rows) {
      console.log(`${id}\t${verdict}\t${drifted}/${total}\t${copy}`);
      if (verdict === "A" && Number(drifted) > 0) aDrift += Number(drifted);
    }
    process.exit(aDrift > 0 ? 1 : 0);
  } else {
    console.log("-- READ-ONLY. Paste into the Supabase SQL editor / MCP execute_sql, or run with DATABASE_URL + --run.\n");
    console.log(sql);
  }
}
