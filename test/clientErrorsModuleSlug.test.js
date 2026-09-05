/* NEW-2 — public.client_errors.module is a machine SLUG, never a display name, run against a
 * REAL Postgres (PGlite — same shape as clientErrorsRetention.test.js's own harness, reused
 * rather than reinvented).
 *
 * Measured on production 2026-09-05: every non-react telemetry source already wrote the slug
 * every other row uses (setTelemetryModule feeds `_module` from Shell.jsx's workspace-registry
 * `id`s), but the React error boundary reported its human-facing crash-card label instead —
 * "Site Planyr" (166 rows), "Sequence Planyr" (3), "Review"/"Document Review" (3), "Notes" (6),
 * "Food" (4). `client_errors_module_slug.sql` backfills those 182 rows to their real slug and
 * adds a CHECK constraint so a display name (always carrying a capital letter, a space, or
 * both) can never land in the column again.
 *
 * Runs the SHIPPED `.sql` files verbatim, not a re-implementation of the rule.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TELEMETRY = join(ROOT, "src/shared/telemetry");
const TABLE_SQL = readFileSync(join(TELEMETRY, "client_errors.sql"), "utf8");
const SLUG_SQL = readFileSync(join(TELEMETRY, "client_errors_module_slug.sql"), "utf8");

/* What Supabase supplies and a bare Postgres does not — nothing here is part of the artifact
 * under test, it exists so client_errors.sql can be run unmodified (same shim as
 * clientErrorsRetention.test.js). */
const SUPABASE_SHIM = `
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  end $$;
`;

// The exact six display names measured on production, one seeded row each — `url` doubles as
// the case label so a failure names the row that mismapped.
const BAD_SEED = [
  { id: "site-planyr",     module: "Site Planyr",     expect: "site-planner" },
  { id: "sequence-planyr", module: "Sequence Planyr", expect: "scheduler" },
  { id: "review",          module: "Review",          expect: "doc-review" },
  { id: "document-review", module: "Document Review", expect: "doc-review" },
  { id: "notes-disp",      module: "Notes",           expect: "notes" },
  { id: "food-disp",       module: "Food",            expect: "food" },
];

async function freshDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);
  await db.exec(TABLE_SQL);
  return db;
}

async function seedBad(db) {
  for (const r of BAD_SEED) {
    await db.query(
      "insert into public.client_errors (source, module, message, url) values ('react', $1, 'boom', $2)",
      [r.module, `https://planyr.io/#/site?case=${r.id}`],
    );
  }
}

describe("the migration backfills every measured display name to its real slug", () => {
  it("maps all six production display names correctly", async () => {
    const db = await freshDb();
    await seedBad(db);
    await db.exec(SLUG_SQL);
    const { rows } = await db.query("select url, module from public.client_errors");
    const byCase = Object.fromEntries(rows.map((r) => [r.url.split("case=")[1], r.module]));
    for (const r of BAD_SEED) expect(byCase[r.id]).toBe(r.expect);
  });

  it("a row already carrying its real slug is left untouched", async () => {
    const db = await freshDb();
    await db.query("insert into public.client_errors (source, module, message) values ('window.onerror', 'site-planner', 'boom')");
    await db.exec(SLUG_SQL);
    const { rows } = await db.query("select module from public.client_errors");
    expect(rows[0].module).toBe("site-planner");
  });

  it("is idempotent — re-running the migration changes nothing further", async () => {
    const db = await freshDb();
    await seedBad(db);
    await db.exec(SLUG_SQL);
    await db.exec(SLUG_SQL);
    const { rows } = await db.query("select url, module from public.client_errors");
    const byCase = Object.fromEntries(rows.map((r) => [r.url.split("case=")[1], r.module]));
    for (const r of BAD_SEED) expect(byCase[r.id]).toBe(r.expect);
  });
});

describe("the CHECK constraint locks the column to a slug shape going forward", () => {
  it("rejects a fresh display-name insert (uppercase, a space) after the migration lands", async () => {
    const db = await freshDb();
    await db.exec(SLUG_SQL);
    await expect(
      db.query("insert into public.client_errors (source, module, message) values ('react', 'Site Planyr', 'boom')"),
    ).rejects.toThrow();
    await expect(
      db.query("insert into public.client_errors (source, module, message) values ('react', 'Document Review', 'boom')"),
    ).rejects.toThrow();
  });

  it("accepts every real module slug in the app's workspace registry, including a future one", async () => {
    const db = await freshDb();
    await db.exec(SLUG_SQL);
    const slugs = ["site-planner", "doc-review", "library", "scheduler", "notes", "model", "food", "admin", "design-gallery"];
    for (const s of slugs) {
      await db.query("insert into public.client_errors (source, module, message) values ('react', $1, 'boom')", [s]);
    }
    const { rows } = await db.query("select count(*)::int as n from public.client_errors");
    expect(rows[0].n).toBe(slugs.length);
  });

  it("still accepts a NULL module (no active workspace resolved yet)", async () => {
    const db = await freshDb();
    await db.exec(SLUG_SQL);
    await expect(
      db.query("insert into public.client_errors (source, module, message) values ('react', null, 'boom')"),
    ).resolves.toBeTruthy();
  });

  it("MUTATION CHECK — without the constraint, a display name is silently accepted again", async () => {
    const broken = SLUG_SQL.replace(
      /alter table public\.client_errors add constraint client_errors_module_is_slug[\s\S]*?;\n/,
      "",
    );
    expect(broken).not.toBe(SLUG_SQL); // the mutation actually applied
    const db = await freshDb();
    await db.exec(broken);
    await expect(
      db.query("insert into public.client_errors (source, module, message) values ('react', 'Site Planyr', 'boom')"),
    ).resolves.toBeTruthy();
  });
});
