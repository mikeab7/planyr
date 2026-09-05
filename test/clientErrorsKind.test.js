/* NEW-3 — public.client_errors.kind classifies every row (error | event | timing) and the
 * retention sweep now ages timing/event rows out at 45 days instead of an error's 90, run
 * against a REAL Postgres (PGlite — same harness shape as clientErrorsRetention.test.js).
 *
 * Measured on production 2026-09-05: 11,284 rows, of which the genuine crash classes totalled
 * ~400 (3.5%) and the rest was performance timing (event:perf, event:terrain-tile-timing) and
 * diagnostic state-transition events — none of which are errors, and all of which drowned out
 * "show me the errors" as a query. `kind` is a GENERATED column (client_errors_kind.sql) so the
 * classification can never drift from the row it describes; the retention fast tier
 * (client_errors_retention.sql) is what actually makes timing/event rows age out faster.
 *
 * Runs the shipped `.sql` files verbatim.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TELEMETRY = join(ROOT, "src/shared/telemetry");
const TABLE_SQL = readFileSync(join(TELEMETRY, "client_errors.sql"), "utf8");
const KIND_SQL = readFileSync(join(TELEMETRY, "client_errors_kind.sql"), "utf8");
const RETENTION_SQL = readFileSync(join(TELEMETRY, "client_errors_retention.sql"), "utf8");

const SUPABASE_SHIM = `
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  end $$;
`;

const NOW = "2027-01-15T12:00:00Z";
const daysBefore = (n) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString();
const capture = (kind) => `[tab b37eab19] {"v":1,"kind":"${kind}","route":"site","p95Ms":41.2,"frames":180}`;

async function freshDb({ retention = true } = {}) {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);
  await db.exec(TABLE_SQL);
  await db.exec(KIND_SQL);
  if (retention) await db.exec(RETENTION_SQL);
  return db;
}

const insert = (db, source, message = "x") =>
  db.query("insert into public.client_errors (source, message) values ($1, $2) returning kind", [source, message]);

describe("kind classifies every row from its source, at write time", () => {
  it("the genuine crash sources are 'error'", async () => {
    const db = await freshDb({ retention: false });
    for (const source of ["react", "window.onerror", "unhandledrejection", "vite:preloadError", "error"]) {
      const { rows } = await insert(db, source);
      expect(rows[0].kind).toBe("error");
    }
  });

  it("the two timing measurements and the perf-capture channel are 'timing'", async () => {
    const db = await freshDb({ retention: false });
    for (const source of ["event:perf", "event:terrain-tile-timing", "event:perfcap"]) {
      const { rows } = await insert(db, source);
      expect(rows[0].kind).toBe("timing");
    }
  });

  it("every other event: source is 'event' — a diagnostic, not a timing measurement or an error", async () => {
    const db = await freshDb({ retention: false });
    for (const source of [
      "event:auth-signed-in", "event:cloud-write-failed", "event:delete-attempt",
      "event:assembly-tear-detected", "event:map-registration-out-of-range",
    ]) {
      const { rows } = await insert(db, source);
      expect(rows[0].kind).toBe("event");
    }
  });

  it("rejects a value the generated column could never produce, if written directly", async () => {
    const db = await freshDb({ retention: false });
    await expect(
      db.query("insert into public.client_errors (source, message, kind) values ('react', 'x', 'bogus')"),
    ).rejects.toThrow();
  });

  it("'show me the errors' is one predicate", async () => {
    const db = await freshDb({ retention: false });
    await insert(db, "react");
    await insert(db, "event:perf");
    await insert(db, "event:cloud-write-failed");
    const { rows } = await db.query("select count(*)::int as n from public.client_errors where kind = 'error'");
    expect(rows[0].n).toBe(1);
  });
});

describe("NEW-3 — the fast tier ages timing/event rows out well short of an error's 90 days", () => {
  it("a 60-day-old 'event' row is gone, while a 60-day-old 'error' row survives", async () => {
    // The gap this tier exists to create: under the OLD single 90-day rule both would survive here.
    const db = await freshDb();
    await db.query("insert into public.client_errors (at, source, message) values ($1, 'react', 'boom')", [daysBefore(60)]);
    await db.query("insert into public.client_errors (at, source, message) values ($1, 'event:cloud-write-failed', 'x')", [daysBefore(60)]);
    await db.query("select public.prune_client_errors($1)", [NOW]);
    const { rows } = await db.query("select source from public.client_errors");
    expect(rows.map((r) => r.source)).toEqual(["react"]);
  });

  it("a 60-day-old 'timing' row is gone the same way", async () => {
    const db = await freshDb();
    await db.query("insert into public.client_errors (at, source, message) values ($1, 'event:terrain-tile-timing', 'x')", [daysBefore(60)]);
    await db.query("select public.prune_client_errors($1)", [NOW]);
    const { rows } = await db.query("select count(*)::int as n from public.client_errors");
    expect(rows[0].n).toBe(0);
  });

  it("a MANUAL perf capture keeps its 365-day life even inside the fast tier's window", async () => {
    const db = await freshDb();
    await db.query(
      "insert into public.client_errors (at, source, message) values ($1, 'event:perfcap', $2)",
      [daysBefore(60), capture("manual")],
    );
    await db.query("select public.prune_client_errors($1)", [NOW]);
    const { rows } = await db.query("select count(*)::int as n from public.client_errors");
    expect(rows[0].n).toBe(1); // 60 days is inside both 45 (fast) and 365 (manual) — kept by the carve-out
  });

  it("an AUTOMATIC perf capture (not manual) is fast-tier eligible like any other timing row", async () => {
    const db = await freshDb();
    await db.query(
      "insert into public.client_errors (at, source, message) values ($1, 'event:perfcap', $2)",
      [daysBefore(60), capture("auto")],
    );
    await db.query("select public.prune_client_errors($1)", [NOW]);
    const { rows } = await db.query("select count(*)::int as n from public.client_errors");
    expect(rows[0].n).toBe(0);
  });

  it("a row inside the fast window (30 days) survives, of any non-error kind", async () => {
    const db = await freshDb();
    await db.query("insert into public.client_errors (at, source, message) values ($1, 'event:perf', 'x')", [daysBefore(30)]);
    await db.query("insert into public.client_errors (at, source, message) values ($1, 'event:cloud-write-failed', 'x')", [daysBefore(30)]);
    await db.query("select public.prune_client_errors($1)", [NOW]);
    const { rows } = await db.query("select count(*)::int as n from public.client_errors");
    expect(rows[0].n).toBe(2);
  });

  it("the fast tier's count folds into ordinary_deleted — the run log gains no new ambiguity", async () => {
    const db = await freshDb();
    await db.query("insert into public.client_errors (at, source, message) values ($1, 'react', 'boom')", [daysBefore(200)]);   // error, 90d rule
    await db.query("insert into public.client_errors (at, source, message) values ($1, 'event:cloud-write-failed', 'x')", [daysBefore(60)]); // event, 45d rule
    const { rows: [result] } = await db.query("select * from public.prune_client_errors($1)", [NOW]);
    expect(result.ordinary_deleted).toBe(2);
    expect(result.manual_deleted).toBe(0);
    expect(Number(result.rows_after)).toBe(0);
  });

  it("MUTATION CHECK — without the fast tier, a stale event row now survives past 45 days", async () => {
    const broken = RETENTION_SQL.replace(
      /-- NEW-3 — the fast tier[\s\S]*?select count\(\*\) into v_fast from gone;\n/,
      "",
    ).replace("v_ordinary := v_ordinary + v_fast;\n", "");
    expect(broken).not.toBe(RETENTION_SQL);
    const db = await freshDb({ retention: false });
    await db.exec(broken);
    await db.query("insert into public.client_errors (at, source, message) values ($1, 'event:cloud-write-failed', 'x')", [daysBefore(60)]);
    await db.query("select public.prune_client_errors($1)", [NOW]);
    const { rows } = await db.query("select count(*)::int as n from public.client_errors");
    expect(rows[0].n).toBe(1); // the opposite of the real behaviour — proves the tier is load-bearing
  });
});
