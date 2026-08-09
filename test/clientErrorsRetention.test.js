/* B270913 — the client_errors retention policy, run against a REAL Postgres.
 *
 * ⛔ WHY THIS TEST EXISTS AT ALL, and why it is not a source guard. The policy is a NO-OP against
 * today's data — 0 of 5,279 rows are older than 90 days — so for months the correct behaviour and
 * total failure produce the identical observation: nothing gets deleted. A retention job that
 * silently never runs is indistinguishable from one that correctly had nothing to delete. That is
 * the sixth appearance of this class in this repo, so the guard has to seed the situation the
 * production table will not reach for a year and assert BOTH directions:
 *
 *     an ordinary row past the 90-day cutoff is REMOVED
 *     a MANUAL perf capture of the same age SURVIVES
 *
 * ⛔ AND IT RUNS THE SHIPPED ARTIFACT, NOT A COPY. `client_errors.sql` and
 * `client_errors_retention.sql` are read off disk and executed verbatim into PGlite (Postgres
 * compiled to WASM — a real planner, real regex, real interval arithmetic). A test that
 * re-implemented the predicate in JS would be testing its own copy of the rule, which this repo
 * has been caught doing before. The only thing stubbed is what a Supabase database provides and a
 * bare Postgres does not: the `auth` schema's `uid()` and the `anon` / `authenticated` roles.
 *
 * MUTATION-CHECKED IN BOTH DIRECTIONS. Two deliberately broken variants of the same file are
 * loaded into their own databases and asserted to produce the OPPOSITE outcome — one with the
 * manual carve-out removed (the manual capture then dies), one with the 90-day interval widened
 * (the old ordinary row then survives). Without those, a predicate that matched nothing at all
 * would pass the happy path by accident.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TELEMETRY = join(ROOT, "src/shared/telemetry");
const TABLE_SQL = readFileSync(join(TELEMETRY, "client_errors.sql"), "utf8");
const RETENTION_SQL = readFileSync(join(TELEMETRY, "client_errors_retention.sql"), "utf8");

/* What Supabase supplies and a bare Postgres does not. Nothing here is part of the artifact under
 * test — it exists so `client_errors.sql` can be run UNMODIFIED. */
const SUPABASE_SHIM = `
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  end $$;
`;

/* A fixed "now" so every age below is exact rather than clock-dependent. */
const NOW = "2027-01-15T12:00:00Z";
const daysBefore = (n) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString();

/* A manual capture as `perfRecorder.js` actually writes one: source `event:perfcap`, the encoded
 * capture prefixed with the tab id. `encodeCapture` is a bare JSON.stringify, so `"kind":"manual"`
 * is present literally. The `auto` twin is the control — same source, same shape, ordinary policy. */
const capture = (kind) => `[tab b37eab19] {"v":1,"kind":"${kind}","route":"site","p95Ms":41.2,"frames":180}`;

async function freshDb(retentionSql = RETENTION_SQL) {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);
  await db.exec(TABLE_SQL);
  await db.exec(retentionSql);
  return db;
}

/* One row per case, so a failure names the row it lost or kept. `id` doubles as the label. */
const SEED = [
  { id: "ordinary-100d", at: daysBefore(100), source: "event:element-conflict", message: "conflict on e123", survives: false },
  { id: "ordinary-91d",  at: daysBefore(91),  source: "react",                  message: "boom",             survives: false },
  { id: "ordinary-89d",  at: daysBefore(89),  source: "react",                  message: "boom",             survives: true },
  { id: "ordinary-1d",   at: daysBefore(1),   source: "unhandledrejection",     message: "later",            survives: true },
  // The whole point of the carve-out: same age as the first row above, kept because it is his.
  { id: "manual-100d",   at: daysBefore(100), source: "event:perfcap", message: capture("manual"), survives: true },
  { id: "manual-364d",   at: daysBefore(364), source: "event:perfcap", message: capture("manual"), survives: true },
  { id: "manual-366d",   at: daysBefore(366), source: "event:perfcap", message: capture("manual"), survives: false },
  // An AUTOMATIC capture is an ordinary row and gets the ordinary window — it is not his press.
  { id: "auto-100d",     at: daysBefore(100), source: "event:perfcap", message: capture("auto"),   survives: false },
  { id: "auto-1d",       at: daysBefore(1),   source: "event:perfcap", message: capture("auto"),   survives: true },
  // The two rows from his own 2026-08-07 session, by shape: ordinary, recent, must never be touched.
  { id: "owner-heal-1",  at: daysBefore(3),   source: "event:stale-cache-overruled",   message: "sms4zs8unbkg", survives: true },
  { id: "owner-heal-2",  at: daysBefore(3),   source: "event:element-rows-canonical",  message: "sms4zs8unbkg", survives: true },
];

async function seed(db) {
  for (const r of SEED) {
    await db.query(
      "insert into public.client_errors (at, source, message, url) values ($1, $2, $3, $4)",
      [r.at, r.source, r.message, `https://planyr.io/#/site?case=${r.id}`],
    );
  }
}

const surviving = async (db) => {
  const r = await db.query("select url from public.client_errors order by at");
  return r.rows.map((x) => x.url.split("case=")[1]);
};

const prune = (db) => db.query("select * from public.prune_client_errors($1)", [NOW]);

describe("the policy deletes exactly what it says and nothing else", () => {
  let db, after;
  beforeAll(async () => {
    db = await freshDb();
    await seed(db);
    await prune(db);
    after = new Set(await surviving(db));
  });

  for (const r of SEED) {
    it(`${r.id} is ${r.survives ? "KEPT" : "deleted"}`, () => {
      expect(after.has(r.id)).toBe(r.survives);
    });
  }

  it("nothing outside the policy moved — the survivor set is exactly the declared one", () => {
    expect([...after].sort()).toEqual(SEED.filter((r) => r.survives).map((r) => r.id).sort());
  });
});

describe("the job proves it ran, and reports what it did", () => {
  it("records a run with the counts, the cutoffs and the before/after size", async () => {
    const db = await freshDb();
    await seed(db);
    const { rows: [run] } = await prune(db);

    // ordinary-100d, ordinary-91d, auto-100d — an AUTO capture is an ordinary row.
    expect(run.ordinary_deleted).toBe(3);
    expect(run.manual_deleted).toBe(1);     // manual-366d only
    expect(Number(run.rows_before)).toBe(SEED.length);
    expect(Number(run.rows_after)).toBe(SEED.filter((r) => r.survives).length);
    expect(Number(run.rows_before) - Number(run.rows_after)).toBe(run.ordinary_deleted + run.manual_deleted);
    // The cutoffs are recorded, so a reader never has to guess which policy version ran.
    expect(new Date(run.ordinary_cutoff).toISOString()).toBe(daysBefore(90));
    expect(new Date(run.manual_cutoff).toISOString()).toBe(daysBefore(365));
  });

  it("⛔ a run that deleted NOTHING still writes a row — an empty report, not an absent one", async () => {
    // This is the case production will be in for months, and the one a silently-dead job imitates.
    const db = await freshDb();
    await db.query("insert into public.client_errors (at, source, message) values ($1, 'react', 'recent')", [daysBefore(2)]);
    const { rows: [run] } = await prune(db);

    expect(run.ordinary_deleted).toBe(0);
    expect(run.manual_deleted).toBe(0);
    const { rows } = await db.query("select count(*)::int as n from public.client_errors_retention_runs");
    expect(rows[0].n).toBe(1);
  });

  it("the status view separates never-run from ran-and-found-nothing", async () => {
    const db = await freshDb();

    let { rows: [s] } = await db.query("select * from public.client_errors_retention_status");
    expect(s.status).toBe("never-run");
    expect(Number(s.runs_recorded)).toBe(0);
    expect(s.last_run_at).toBeNull();

    // A run at the real clock, so the 48-hour staleness arm sees a fresh timestamp.
    await db.query("select public.prune_client_errors()");
    ({ rows: [s] } = await db.query("select * from public.client_errors_retention_status"));
    expect(s.status).toBe("ok");
    expect(Number(s.runs_recorded)).toBe(1);
    expect(s.last_total_deleted).toBe(0);   // ran, deleted nothing — and says so, in two fields
    expect(s.last_run_at).not.toBeNull();
  });

  it("a job that ran once and then stopped reads STALE, not ok", async () => {
    const db = await freshDb();
    await db.query("select public.prune_client_errors()");
    await db.query("update public.client_errors_retention_runs set ran_at = now() - interval '5 days'");
    const { rows: [s] } = await db.query("select * from public.client_errors_retention_status");
    expect(s.status).toBe("stale");
  });

  it("is idempotent — a second run on the same data deletes nothing more and still logs", async () => {
    const db = await freshDb();
    await seed(db);
    await prune(db);
    const { rows: [second] } = await prune(db);
    expect(second.ordinary_deleted).toBe(0);
    expect(second.manual_deleted).toBe(0);
    const { rows } = await db.query("select count(*)::int as n from public.client_errors_retention_runs");
    expect(rows[0].n).toBe(2);
  });
});

describe("MUTATION CHECK — the two clauses that carry the policy are each load-bearing", () => {
  it("without the manual carve-out, his manual capture dies at 90 days", async () => {
    const broken = RETENTION_SQL.replace("and not public.is_manual_perf_capture(source, message)", "");
    expect(broken).not.toBe(RETENTION_SQL);           // the mutation actually applied
    const db = await freshDb(broken);
    await seed(db);
    await prune(db);
    const after = new Set(await surviving(db));
    expect(after.has("manual-100d")).toBe(false);     // the opposite of the real behaviour
    expect(after.has("ordinary-100d")).toBe(false);   // …and the ordinary case is unchanged
  });

  it("without a real 90-day cutoff, the stale ordinary row survives", async () => {
    const broken = RETENTION_SQL.replace("p_now - interval '90 days'", "p_now - interval '400 days'");
    expect(broken).not.toBe(RETENTION_SQL);
    const db = await freshDb(broken);
    await seed(db);
    await prune(db);
    const after = new Set(await surviving(db));
    expect(after.has("ordinary-100d")).toBe(true);
  });

  it("the classifier reads the encoder's real output, not a hand-written string", async () => {
    // If `perfCapture.js` ever stops emitting `"kind":"manual"` verbatim, this is what notices.
    const db = await freshDb();
    const { rows } = await db.query(
      "select public.is_manual_perf_capture('event:perfcap', $1) as manual, public.is_manual_perf_capture('event:perfcap', $2) as auto, public.is_manual_perf_capture('react', $1) as wrong_source",
      [capture("manual"), capture("auto")],
    );
    expect(rows[0]).toEqual({ manual: true, auto: false, wrong_source: false });
  });

  it("a malformed capture payload cannot take the run down", async () => {
    // The reason the classifier is a regex and not a ::jsonb cast: a cast raises, and one bad row
    // would abort the whole nightly delete.
    const db = await freshDb();
    await db.query("insert into public.client_errors (at, source, message) values ($1, 'event:perfcap', $2)", [daysBefore(100), "[tab abcd] {not json at all"]);
    const { rows: [run] } = await prune(db);
    expect(run.ordinary_deleted).toBe(1);
  });
});
