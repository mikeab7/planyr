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

  it("is ADDITIVE and reversible: nothing reads it, nothing writes it, and the rollback is in the file", () => {
    expect(SQL).toMatch(/drop column if exists assembly_id/);            // the rollback, commented out
    // No client code may read or write it while it is stage 1 — that is what makes this shippable
    // on its own. (`elementRows.js` is the whole rows↔model seam; the RPC ops are built there.)
    const rows = read("../src/workspaces/site-planner/lib/elementRows.js");
    for (const src of [SYNC, rows]) expect(src).not.toMatch(/assembly_id/);
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
