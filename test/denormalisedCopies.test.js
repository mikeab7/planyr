/* ALL SHARED DATA, IN ANY TABLE, HAS ONE SOURCE — a stored COPY must be declared with how it stays right
 * (B2064896, 2026-10-04). Generalises test/nameCopiesGuard.test.js (project/plan NAME columns only) to
 * every denormalised column and blob field, after the 2026-09-29 live check found copies in OTHER tables
 * (schedules.linked_site_name, doc_reviews.project) that the component-state guard (entityStateCopy) cannot see.
 *
 * What is decidable, and so enforced here:
 *   1. every vocabulary-matching SQL column (name/title/county/status/date/team_id/…) in the repo's migrations is
 *      declared in scripts/denormalisedCopies.json — as a COPY (verdict + how it resolves/stays fresh + a cited
 *      code line that really exists) or as OWNED (the source of truth). A new one fails until classified;
 *   2. a column whose own DDL comment says denormalised / mirror / copy of / kept in sync must be a declared COPY;
 *   3. no dead entries (a declared column that no migration defines, an evidence line that is gone);
 *   4. scripts/drift-report.sql and the manifest agree (every check is claimed, every claimed check exists).
 * What is NOT decidable from source: a new jsonb FIELD that duplicates another table's value. Those are declared
 * by hand in the manifest's `blob` entries and found by the adversarial pass in docs/audit-single-source-of-truth.md.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { walkSql, scanColumns } from "../scripts/lib/sqlColumns.mjs";
import { consistencyProblems, checkIdsInSql } from "../scripts/drift-report.mjs";

const manifest = JSON.parse(readFileSync("scripts/denormalisedCopies.json", "utf8"));
const files = [...walkSql("src"), ...walkSql("server")];
const scanned = new Map(scanColumns(files).map((c) => [`${c.table}.${c.column}`, c]));

export const VOCAB = /(name|title|label|project|site|county|jurisdiction|status|stage|acre|acres|_sf|sf$|count|total|date|_on$|owner|company|contact|team_id|email|role|summary|thumb|folder|parent|path|kind|category|discipline|item|revision|place_id)/i;
const NOT_A_FACT = /\.(created_at|updated_at|deleted_at)$/;
const declaredCopyCols = new Set(manifest.copies.flatMap((c) => c.columns || []));
const owned = new Set(Object.entries(manifest.ownedColumns).flatMap(([t, cs]) => cs.map((c) => `${t}.${c}`)));

describe("denormalised-copy manifest (every table, every blob)", () => {
  it("the DDL scanner sees the repo's schema (not vacuous)", () => {
    expect(scanned.size).toBeGreaterThan(300);
    for (const k of ["schedules.linked_site_name", "doc_reviews.project", "file_facts.item", "profiles.email"]) expect(scanned.has(k), k).toBe(true);
  });

  it("every vocabulary-matching column is declared as a COPY or as OWNED", () => {
    const undeclared = [...scanned.keys()].filter((k) => VOCAB.test(k.split(".")[1]) && !NOT_A_FACT.test(k) && !declaredCopyCols.has(k) && !owned.has(k));
    expect(undeclared, "classify each in scripts/denormalisedCopies.json: a COPY of another value (verdict + how it resolves/stays fresh + evidence) or OWNED (it is the source of truth)").toEqual([]);
  });

  it("a column whose DDL comment says it is a copy is declared as one", () => {
    const MARK = /--.*(denormali[sz]|mirror|copy of|snapshot of|kept.in.sync|derived from|cache of)/i;
    const COL = /^\s*"?([a-z_]+)"?\s+[a-z]+/i;
    const bad = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8").split("\n");
      let table = null;
      text.forEach((line) => {
        const ct = /create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)/i.exec(line);
        if (ct) table = ct[1].replace(/"/g, "").replace(/^public\./, "");
        if (!table || /^\s*--/.test(line) || !MARK.test(line)) return;
        const m = COL.exec(line);
        if (m && !/^(create|alter|constraint|primary|foreign|unique|check|comment|select|from)$/i.test(m[1]) && scanned.has(`${table}.${m[1]}`) && !declaredCopyCols.has(`${table}.${m[1]}`)) bad.push(`${f}: ${table}.${m[1]}`);
      });
    }
    expect(bad, "declare it as a COPY in scripts/denormalisedCopies.json").toEqual([]);
  });

  it("no dead entries: every declared column still exists in a migration (or says noDdl), owned list too", () => {
    const deadCopies = manifest.copies.flatMap((c) => (c.noDdl ? [] : (c.columns || []).filter((k) => !scanned.has(k))));
    const deadOwned = [...owned].filter((k) => !scanned.has(k));
    expect(deadCopies, "delete the entry or mark noDdl:true with a reason").toEqual([]);
    expect(deadOwned, "column no longer defined — delete it from ownedColumns").toEqual([]);
  });

  it("every copy carries a verdict, a resolution and (for A/C) cited evidence that exists in the repo", () => {
    const problems = [];
    for (const c of manifest.copies) {
      if (!["A", "B", "C"].includes(c.verdict)) problems.push(`${c.id}: verdict`);
      if (!c.resolve || c.resolve.length < 30) problems.push(`${c.id}: resolve must say how it stays right`);
      if (!c.source) problems.push(`${c.id}: source`);
      if (!c.columns && !c.blob) problems.push(`${c.id}: names no column or blob field`);
      if (c.evidence) {
        const ok = existsSync(c.evidence.file) && readFileSync(c.evidence.file, "utf8").includes(c.evidence.contains);
        if (!ok && !c.pendingOn) problems.push(`${c.id}: evidence "${c.evidence.contains}" not found in ${c.evidence.file}`);
        if (ok && c.pendingOn) problems.push(`${c.id}: evidence now exists — delete pendingOn`);
      } else if (c.verdict !== "B") problems.push(`${c.id}: A/C entries must cite evidence`);
    }
    expect(problems).toEqual([]);
  });

  it("the drift report and the manifest agree (every check claimed, every claim exists)", () => {
    expect(consistencyProblems()).toEqual([]);
    expect(checkIdsInSql(readFileSync("scripts/drift-report.sql", "utf8")).length).toBeGreaterThanOrEqual(25);
  });

  it("the drift report is read-only SQL", () => {
    const sql = readFileSync("scripts/drift-report.sql", "utf8").replace(/--[^\n]*/g, "");
    expect(sql).not.toMatch(/\b(insert\s+into|update\s+\w+\s+set|delete\s+from|drop\s|alter\s+table|create\s+(table|function|trigger)|truncate\s)/i);
  });

  it("teeth: the guard really goes red on an undeclared column (mutation check)", () => {
    const fake = "newtable.display_name";
    const wouldFlag = VOCAB.test(fake.split(".")[1]) && !declaredCopyCols.has(fake) && !owned.has(fake);
    expect(wouldFlag).toBe(true);
  });
});
