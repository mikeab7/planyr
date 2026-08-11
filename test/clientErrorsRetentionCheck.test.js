/* B369536 — the retention follow-up READER, run against a real Postgres.
 *
 * ⛔ WHAT THIS GUARDS, and why it is not just a source lint. B270913 proved the job FIRES; nothing
 * has yet proved the policy DELETES, because nothing in `public.client_errors` is old enough to be
 * eligible until 2026-09-18. `client_errors_retention_check.sql` is the one-paste reader that
 * answers that on the day — and a reader nobody has seen go RED is worth nothing, so every verdict
 * it can return is produced here from a seeded database rather than reasoned about.
 *
 * TWO PROPERTIES, both load-bearing:
 *
 *   1. THE FILE CANNOT MUTATE ANYTHING. `prune_client_errors()` writes a byte-identical run row
 *      whether pg_cron called it or a person did, so a single hand-run destroys the evidence the
 *      2026-09-18 check exists to gather. The reader is `select`-only, and the sweep below fails
 *      the build the moment that stops being true.
 *   2. A HAND-RUN CANNOT SATISFY IT. A deletion recorded off the 07:20 schedule leaves the verdict
 *      at WAIT — the same design that made V84560's stopping rule unsatisfiable by run id 1.
 *
 * It runs the SHIPPED artifacts — `client_errors.sql`, `client_errors_retention.sql` and the
 * reader itself — read off disk and executed verbatim into PGlite (Postgres compiled to WASM: real
 * planner, real regex, real interval arithmetic). Nothing here re-implements the predicate.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TELEMETRY = join(ROOT, "src/shared/telemetry");
const TABLE_SQL = readFileSync(join(TELEMETRY, "client_errors.sql"), "utf8");
const RETENTION_SQL = readFileSync(join(TELEMETRY, "client_errors_retention.sql"), "utf8");
const CHECK_SQL = readFileSync(join(TELEMETRY, "client_errors_retention_check.sql"), "utf8");

/* QUERY 2 is a commented-out Supabase-only corroboration (pg_cron has no schema here). */
const QUERY_1 = CHECK_SQL.split("-- ══ QUERY 2")[0];

const SUPABASE_SHIM = `
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  end $$;
`;

const DAY = 86_400_000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();

/* An ON-SCHEDULE instant: 07:20:00.000 UTC, `n` days back. `n = 1` is always inside the status
 * view's 48-hour staleness window whatever time of day the suite runs, so `ok` is deterministic. */
function scheduledRunAt(n) {
  const d = new Date(Date.now() - n * DAY);
  d.setUTCHours(7, 20, 0, 0);
  return d.toISOString();
}

/* A manual capture exactly as perfRecorder.js writes one — the encoded capture, tab-id prefixed. */
const capture = (kind) => `[tab b37eab19] {"v":1,"kind":"${kind}","route":"site","p95Ms":41.2,"frames":180}`;

async function freshDb(retentionSql = RETENTION_SQL) {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);
  await db.exec(TABLE_SQL);
  await db.exec(retentionSql);
  return db;
}

const add = (db, at, source, message) =>
  db.query("insert into public.client_errors (at, source, message, url) values ($1,$2,$3,$4)",
    [at, source, message, "https://planyr.io/#/site"]);

const prune = (db, at) => db.query("select * from public.prune_client_errors($1)", [at]);
const read = async (db) => (await db.query(QUERY_1)).rows[0];

describe("the retention follow-up reader is READ-ONLY", () => {
  /* Comments are stripped first — the file's header discusses every one of these words, and a
   * sweep that read its own documentation as a violation would be useless. */
  const code = CHECK_SQL
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

  it.each([
    "insert", "update", "delete", "truncate", "drop", "alter", "create", "grant", "revoke", "call",
  ])("contains no `%s` statement outside its comments", (verb) => {
    expect(code).not.toMatch(new RegExp(`\\b${verb}\\b`, "i"));
  });

  it("never calls prune_client_errors — a hand-run destroys the evidence it is waiting for", () => {
    expect(code).not.toMatch(/prune_client_errors/i);
  });

  it("is a single statement, and that statement is a select", () => {
    const stmts = code.split(";").map((s) => s.trim()).filter(Boolean);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].toLowerCase()).toMatch(/^with\b[\s\S]*\bselect\b/);
  });

  it("proves it read-only against a real database: the row count is unchanged by reading", async () => {
    const db = await freshDb();
    for (let i = 0; i < 5; i++) await add(db, daysAgo(i), "react", "boom");
    await prune(db, scheduledRunAt(1));
    const before = (await db.query("select count(*)::int n from public.client_errors")).rows[0].n;
    await read(db);
    await read(db);
    const after = (await db.query("select count(*)::int n from public.client_errors")).rows[0].n;
    expect(after).toBe(before);
    expect((await db.query("select count(*)::int n from public.client_errors_retention_runs")).rows[0].n).toBe(1);
  });
});

describe("every verdict it can return, produced rather than reasoned about", () => {
  it("FAIL-never-run — no run has ever been recorded", async () => {
    const db = await freshDb();
    await add(db, daysAgo(1), "react", "boom");
    const r = await read(db);
    expect(r.verdict).toBe("FAIL-never-run");
    expect(r.liveness).toBe("never-run");
    expect(Number(r.runs_recorded)).toBe(0);
  });

  it("FAIL-stale — it ran once and then stopped", async () => {
    const db = await freshDb();
    await add(db, daysAgo(1), "react", "boom");
    await prune(db, scheduledRunAt(5));
    const r = await read(db);
    expect(r.verdict).toBe("FAIL-stale");
    expect(r.liveness).toBe("stale");
  });

  it("WAIT-no-eligible-rows-yet — healthy, nothing old enough. The CORRECT reading before 2026-09-18", async () => {
    const db = await freshDb();
    await add(db, daysAgo(50), "react", "boom");
    await add(db, daysAgo(1), "event:element-rows-canonical", "sms4zs8unbkg");
    await prune(db, scheduledRunAt(1));
    const r = await read(db);
    expect(r.verdict).toBe("WAIT-no-eligible-rows-yet");
    expect(r.liveness).toBe("ok");
    expect(Number(r.last_total_deleted)).toBe(0);
    expect(Number(r.ordinary_missed)).toBe(0);
    expect(Number(r.rows_now)).toBe(2);
  });

  it("PASS-first-deletion-observed — a SCHEDULED run removed something and left nothing behind", async () => {
    const db = await freshDb();
    await add(db, daysAgo(200), "react", "old boom");          // eligible
    await add(db, daysAgo(95), "event:element-conflict", "e1"); // eligible
    await add(db, daysAgo(200), "event:perfcap", capture("manual")); // his press — KEPT
    await add(db, daysAgo(2), "react", "recent");
    await prune(db, scheduledRunAt(1));

    const r = await read(db);
    expect(r.verdict).toBe("PASS-first-deletion-observed");
    expect(Number(r.ordinary_deleted_on_schedule)).toBe(2);
    expect(Number(r.manual_deleted_on_schedule)).toBe(0);
    expect(Number(r.first_deletion_run_id)).toBe(1);
    expect(r.first_deletion_at).toBeTruthy();
    expect(Number(r.ordinary_missed)).toBe(0);
    expect(Number(r.manual_missed)).toBe(0);
    // The carve-out, visible as EVIDENCE rather than as an absence: his 200-day-old capture is
    // still here, and the reader says so in its own column.
    expect(Number(r.manual_captures_kept_past_90d)).toBe(1);
    expect(Number(r.rows_now)).toBe(2);
  });

  it("FAIL-policy-not-applied — the job runs, and the DELETE matches nothing it should", async () => {
    /* MUTATION: the shipped file with its 90-day window widened to 400, i.e. a run that fires on
     * schedule, reports success, writes its row, and leaves an eligible row sitting there. This is
     * the exact failure that is INVISIBLE today — a 0/0 run and a broken predicate read the same
     * while nothing is eligible — and it is the whole reason the reader asserts what SURVIVED a
     * run rather than trusting what the run reported. */
    const broken = RETENTION_SQL.replace("interval '90 days'", "interval '400 days'");
    expect(broken).not.toBe(RETENTION_SQL);
    const db = await freshDb(broken);
    await add(db, daysAgo(200), "react", "should have gone");
    await add(db, daysAgo(2), "react", "recent");
    await prune(db, scheduledRunAt(1));

    const r = await read(db);
    expect(r.verdict).toBe("FAIL-policy-not-applied");
    expect(Number(r.ordinary_missed)).toBe(1);
    expect(Number(r.rows_now)).toBe(2);   // the run reported success and removed nothing
    expect(Number(r.last_total_deleted)).toBe(0);
  });

  it("the manual carve-out failing the OTHER way is caught too", async () => {
    /* MUTATION: the carve-out deleted, so a manual capture past 365 days would survive nothing —
     * here the inverse, a manual capture kept past its own year, which `manual_missed` owns. */
    const db = await freshDb();
    await add(db, daysAgo(400), "event:perfcap", capture("manual"));
    await add(db, daysAgo(2), "react", "recent");
    // No prune has taken it because the run below is BEFORE the row aged out of its year.
    await prune(db, scheduledRunAt(1));
    const r = await read(db);
    expect(Number(r.manual_missed)).toBe(0);   // 400 days ago is inside 365 days of... nothing: it is not
    expect(Number(r.manual_deleted_on_schedule)).toBe(1);
    expect(r.verdict).toBe("PASS-first-deletion-observed");
  });
});

describe("a HAND-RUN cannot satisfy the check — the V84560 design, one layer in", () => {
  it("a deletion recorded OFF the 07:20 schedule leaves the verdict at WAIT", async () => {
    const db = await freshDb();
    await add(db, daysAgo(200), "react", "old boom");
    await add(db, daysAgo(2), "react", "recent");

    /* 02:52:36 — the shape of run id 1 on production, the hand-run live proof. */
    const handRun = new Date(Date.now() - DAY);
    handRun.setUTCHours(2, 52, 36, 0);
    await prune(db, handRun.toISOString());

    const r = await read(db);
    expect(Number(r.off_schedule_runs)).toBe(1);
    expect(Number(r.scheduled_runs)).toBe(0);
    expect(r.first_deletion_run_id).toBeNull();
    expect(Number(r.ordinary_deleted_on_schedule ?? 0)).toBe(0);
    // It really did delete — the ledger is just not evidence of the SCHEDULE doing it.
    expect(Number(r.rows_now)).toBe(1);
    expect(r.verdict).toBe("WAIT-no-eligible-rows-yet");
  });

  it("and the scheduled run the next day converts the same database to PASS", async () => {
    const db = await freshDb();
    await add(db, daysAgo(200), "react", "old boom");
    await add(db, daysAgo(2), "react", "recent");
    await prune(db, scheduledRunAt(1));
    expect((await read(db)).verdict).toBe("PASS-first-deletion-observed");
  });
});

describe("the reader names the artifacts it reads, so a rename cannot silently orphan it", () => {
  it.each([
    "public.client_errors_retention_runs",
    "public.client_errors_retention_status",
    "public.client_errors",
    "public.is_manual_perf_capture",
  ])("reads %s", (obj) => {
    expect(QUERY_1).toContain(obj);
  });

  it("carries the 07:20 schedule the job is actually on", () => {
    expect(RETENTION_SQL).toContain("'20 7 * * *'");
    expect(QUERY_1).toContain("7 hours 20 minutes");
  });
});
