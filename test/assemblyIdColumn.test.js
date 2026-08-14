import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* NEW-5 / B1341 stage 1 — the `assembly_id` column, guarded the only way CI here can guard it.
 *
 * There is no Postgres in this repo's test run, so what is asserted is the MIGRATION TEXT and the
 * one property that makes it worth shipping: the column's expression must name the SAME grouping
 * the client means by "assembly", or stage 2 would CAS on a group nobody else believes in.
 *
 * The client's definition is `rootIdOf` in `lib/elementSync.js`: an element's host when it is
 * bonded (`attachedTo`), itself otherwise. Both sides are read here, so a change to either that
 * does not change the other fails.
 */
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const SQL = read("../src/workspaces/site-planner/db/site_elements_assembly_id.sql");
const SYNC = read("../src/workspaces/site-planner/lib/elementSync.js");

describe("NEW-5 — site_elements.assembly_id", () => {
  it("is GENERATED, so it can never drift from the bond it names", () => {
    expect(SQL).toMatch(/add column if not exists assembly_id text/);
    expect(SQL).toMatch(/generated always as \(coalesce\(data->>'attachedTo', id\)\) stored/);
  });

  it("means exactly what the client means by an assembly root", () => {
    // `const rootIdOf = (el, fallbackId) => (el && el.attachedTo != null ? el.attachedTo : …)`
    expect(SYNC).toMatch(/rootIdOf\s*=\s*\(el, fallbackId\) =>\s*\(el && el\.attachedTo != null \? el\.attachedTo :/);
    const expr = SQL.match(/assembly_id text\s*\n\s*generated always as \((.+?)\) stored/)[1];
    expect(expr).toContain("data->>'attachedTo'");   // the bond…
    expect(expr).toContain("id");                    // …falling back to the element itself
    expect(expr.startsWith("coalesce(")).toBe(true); // …in that order
  });

  it("is ADDITIVE and reversible: the client never reads or writes the COLUMN, and the rollback is in the file", () => {
    expect(SQL).toMatch(/drop column if exists assembly_id/);            // the rollback, commented out
    /* ⛔ THE INVARIANT SURVIVED STAGE 2 AND ITS WORDING DID NOT. It used to read "no client code may
     * read or write it WHILE IT IS STAGE 1"; stage 2 is now on by default, and the property that
     * actually matters is unchanged and permanent: `assembly_id` is a GENERATED server column, and
     * the client must keep deriving its own grouping from `attachedTo` (`rootIdOf`). If the client
     * ever started reading the column, the two definitions could drift — which is the entire bug
     * family B447472 and B484336 come from.
     *
     * Asserted against CODE, not prose: comments are stripped first, because this went red on a
     * COMMENT explaining that very rule. A guard that forbids naming the thing it protects makes
     * the protection undocumentable. (`elementRows.js` is the whole rows↔model seam; the RPC ops
     * are built there.) */
    const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const rows = read("../src/workspaces/site-planner/lib/elementRows.js");
    for (const src of [SYNC, rows]) expect(codeOnly(src)).not.toMatch(/assembly_id/);
    // …and the stripper is not vacuous: the prose it removes really does name the column.
    expect(SYNC).toMatch(/assembly_id/);
  });

  it("indexes the group on LIVE rows only — a tombstone is not a member of an assembly", () => {
    expect(SQL).toMatch(/create index if not exists site_elements_assembly_idx/);
    expect(SQL).toMatch(/on public\.site_elements \(site_id, assembly_id\)\s*\n\s*where deleted_at is null/);
  });

  it("records the ONE deviation from B1341's written plan rather than leaving it implicit", () => {
    // The item says "written by the client"; this ships it generated. A deviation nobody wrote
    // down is how a staged plan quietly stops being the plan.
    expect(SQL).toMatch(/DELIBERATE DEVIATION FROM WHAT B1341 WROTE DOWN/);
  });
});
