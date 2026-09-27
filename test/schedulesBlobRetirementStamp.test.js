/* B1927952 (NEW-2) — schedules_blob_retirement_stamp.sql, run against a REAL Postgres (PGlite —
 * Postgres compiled to WASM, a devDependency already used by test/clientErrorsRetention.test.js).
 *
 * ⛔ WHY THIS EXISTS RATHER THAN JUST THE HAND-WRITTEN self-rolling-back .sql PROOF (db/test/
 * schedules_blob_retirement_stamp.test.sql). This session's dispatch was explicit — "READ-ONLY on
 * production; no writes ... to his data" — so the .sql proof, following this repo's normal
 * convention for src/workspaces/scheduler/db/test/*.sql, could be WRITTEN but not RUN this
 * session. Shipping SQL that has never actually executed is a real risk, not a formality: writing
 * this PGlite version caught a genuine bug before it shipped — the first draft of
 * schedules_stamp_retired_blob() didn't advance `__rev`, so the PRE-EXISTING
 * planar_data_enforce_version_monotonic trigger (a second, independent guard on the same table,
 * from an earlier item) would have silently refused the stamp write in production regardless of
 * this file's own new bypass. That is exactly the kind of defect a read-only review of the SQL
 * would not have caught.
 *
 * ⛔ RUNS THE SHIPPED ARTIFACTS, NOT COPIES. Every .sql file this loads is read off disk and
 * executed verbatim into PGlite — same discipline as clientErrorsRetention.test.js's own header.
 * The only things NOT read from a shipped file are, in `freshDb()` below: (a) what Supabase
 * provides that a bare Postgres does not (`auth.users`/`auth.uid()`/`auth.email()`, the anon/
 * authenticated roles); (b) a minimal `public.teams` stub (an FK target only — `team_id` stays
 * null throughout every test here, so loading the real teams.sql, with its own profiles/invites/
 * RLS dependency chain, would buy nothing); and (c) a minimal `public.planar_data` table
 * definition — that table's own CREATE TABLE has never been tracked in this repo (it predates
 * this repo's migration-file convention; confirmed by grep, same situation B1805153 already
 * documented for `public.sites`), so this defines the columns every migration file here already
 * assumes exist (`key`, `value`, `user_id`, `team_id`).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCHED_DB = join(ROOT, "src/workspaces/scheduler/db");
const read = (p) => readFileSync(p, "utf8");

const CLIENT_ERRORS_SQL = read(join(ROOT, "src/shared/telemetry/client_errors.sql"));
const NORMALIZATION_SQL = read(join(SCHED_DB, "schedules_normalization.sql"));
const PLANAR_REV_GUARD_SQL = read(join(SCHED_DB, "planar_data_version_monotonic_guard.sql"));
const AUTHORITY_FLIP_SQL = read(join(SCHED_DB, "schedules_authority_flip.sql"));
const RETIREMENT_STAMP_SQL = read(join(SCHED_DB, "schedules_blob_retirement_stamp.sql"));

const OWNER = "11111111-1111-1111-1111-111111111111";

async function freshDb() {
  const db = new PGlite();
  await db.exec("create schema if not exists auth;");
  await db.exec("create table if not exists auth.users (id uuid primary key default gen_random_uuid());");
  await db.exec("create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;");
  await db.exec("create or replace function auth.email() returns text language sql stable as $$ select null::text $$;");
  await db.exec(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  end $$;`);
  await db.query("insert into auth.users (id) values ($1)", [OWNER]);
  // A minimal stub, not teams.sql's own artifact — every migration this test loads only needs
  // public.teams to EXIST as an FK target (team_id stays null throughout); loading the real
  // teams.sql would pull in an unrelated dependency chain (public.profiles, invites, RLS) that
  // has nothing to do with the retirement-stamp function under test.
  await db.exec("create table if not exists public.teams (id uuid primary key default gen_random_uuid());");
  await db.exec(CLIENT_ERRORS_SQL);
  await db.exec(`create table if not exists public.planar_data (
    key      text primary key,
    value    jsonb not null,
    user_id  uuid references auth.users(id),
    team_id  uuid references public.teams(id)
  );`);
  await db.exec(NORMALIZATION_SQL);
  await db.exec(PLANAR_REV_GUARD_SQL);
  await db.exec(AUTHORITY_FLIP_SQL);
  await db.exec(RETIREMENT_STAMP_SQL);
  return db;
}

/* Mirrors the REAL sequence of events: the hs-v1 row is created while the owner is still
 * unflipped (planar_data_refuse_post_flip_write refuses an INSERT for an already-flipped owner —
 * this is case 7 of the sibling schedules_authority_flip.test.sql, and hit here for real on the
 * first draft of this fixture, which inserted the account-index row first). Only once the blob
 * exists does the owner optionally get flipped, via an UPDATE (also refusal-trigger-exempt on its
 * own — flipping the flag itself is a schedule_account_index write, not a planar_data one). */
async function seedAccount(db, { authoritative = false } = {}) {
  await db.query("insert into public.schedule_account_index (user_id, rows_authoritative) values ($1, false)", [OWNER]);
  await db.query(
    "insert into public.planar_data (key, value, user_id) values ($1, $2, $3)",
    ["hs-v1", JSON.stringify({ __rev: 5026, projects: { 3: { id: 3, name: "8 South" } } }), OWNER]
  );
  if (authoritative) {
    await db.query("update public.schedule_account_index set rows_authoritative = true, rev = rev + 1 where user_id = $1", [OWNER]);
  }
}

const blobFor = async (db) => {
  const { rows } = await db.query("select value from public.planar_data where key = 'hs-v1' and user_id = $1", [OWNER]);
  return rows[0]?.value ?? null;
};

describe("schedules_stamp_retired_blob — against a real Postgres (PGlite)", () => {
  it("refuses to stamp an unflipped (still-active) owner's blob", async () => {
    const db = await freshDb();
    await seedAccount(db, { authoritative: false });
    await expect(db.query("select public.schedules_stamp_retired_blob($1)", [OWNER])).rejects.toThrow(/not rows_authoritative/);
    const blob = await blobFor(db);
    expect(blob._retiredAt).toBeUndefined();
  });

  it("returns null when the owner has no hs-v1 blob at all", async () => {
    const db = await freshDb();
    await db.query("insert into public.schedule_account_index (user_id, rows_authoritative) values ($1, true)", [OWNER]);
    const { rows } = await db.query("select public.schedules_stamp_retired_blob($1) as result", [OWNER]);
    expect(rows[0].result).toBeNull();
  });

  it("stamps a flipped owner's blob: _retiredAt/_supersededBy added, __rev advances by 1, every other key untouched", async () => {
    const db = await freshDb();
    await seedAccount(db, { authoritative: true });
    const before = await blobFor(db);

    const { rows } = await db.query("select public.schedules_stamp_retired_blob($1) as result", [OWNER]);
    const result = rows[0].result;

    expect(result._supersededBy).toBe("schedules");
    expect(typeof result._retiredAt).toBe("string");
    expect(Number.isFinite(Date.parse(result._retiredAt))).toBe(true);
    expect(result.__rev).toBe(before.__rev + 1);
    expect(result.projects).toEqual(before.projects);

    const after = await blobFor(db);
    expect(after).toEqual(result);
  });

  it("is idempotent — a second call returns the SAME _retiredAt, not a fresh one", async () => {
    const db = await freshDb();
    await seedAccount(db, { authoritative: true });
    const { rows: r1 } = await db.query("select public.schedules_stamp_retired_blob($1) as result", [OWNER]);
    const { rows: r2 } = await db.query("select public.schedules_stamp_retired_blob($1) as result", [OWNER]);
    expect(r2[0].result._retiredAt).toBe(r1[0].result._retiredAt);
    expect(r2[0].result.__rev).toBe(r1[0].result.__rev); // no second rev bump either
  });

  it("does NOT delete or rename the row — it is still readable by the same key afterward", async () => {
    const db = await freshDb();
    await seedAccount(db, { authoritative: true });
    await db.query("select public.schedules_stamp_retired_blob($1)", [OWNER]);
    const { rows } = await db.query("select count(*)::int as n from public.planar_data where key = 'hs-v1' and user_id = $1", [OWNER]);
    expect(rows[0].n).toBe(1);
  });

  it("THE BYPASS IS SCOPED: an ordinary, rev-advancing write to a flipped owner's blob is still refused without the admin-stamp GUC", async () => {
    const db = await freshDb();
    await seedAccount(db, { authoritative: true });
    await expect(
      db.query(
        "update public.planar_data set value = value || jsonb_build_object('probe', true, '__rev', (value->>'__rev')::numeric + 1) where key = 'hs-v1' and user_id = $1",
        [OWNER]
      )
    ).resolves.toBeTruthy(); // PostgREST-style refusal: the UPDATE itself doesn't throw...
    const blob = await blobFor(db);
    expect(blob.probe).toBeUndefined(); // ...but zero rows were actually changed
  });

  it("THE ORIGINAL ROLLBACK BYPASS IS UNCHANGED: planyr.schedule_blob_rollback still lets a rev-advancing write through", async () => {
    const db = await freshDb();
    await seedAccount(db, { authoritative: true });
    // Session-level (not transaction-local) here, deliberately: this test issues the SET and the
    // UPDATE as two separate top-level statements, each PGlite auto-commits as its own implicit
    // transaction, so a `true` (local) flag set in the first would not survive into the second —
    // discovered by running this, not assumed. The real production call sites (schedules_rollback_to_blob,
    // schedules_stamp_retired_blob) both set/clear the flag INSIDE one PL/pgSQL function body, i.e.
    // within a single statement/transaction, where `true` behaves as documented.
    await db.query("select set_config('planyr.schedule_blob_rollback', '1', false)");
    await db.query(
      "update public.planar_data set value = value || jsonb_build_object('rollbackProbe', true, '__rev', (value->>'__rev')::numeric + 1) where key = 'hs-v1' and user_id = $1",
      [OWNER]
    );
    await db.query("select set_config('planyr.schedule_blob_rollback', '0', false)");
    const blob = await blobFor(db);
    expect(blob.rollbackProbe).toBe(true);
  });

  it("RED-PROOF (mutation): without the __rev bump, the pre-existing rev-CAS guard silently refuses the stamp", async () => {
    const db = await freshDb();
    // Reproduce the ORIGINAL (buggy) function body — the exact defect this file's own header
    // describes — to prove the guard this session added (advancing __rev) is load-bearing, not
    // cosmetic: without it, the function's own bypass GUC is not enough.
    await db.exec(`
      create or replace function public.schedules_stamp_retired_blob(p_user_id uuid)
      returns jsonb language plpgsql set search_path = public, pg_temp as $$
      declare cur_value jsonb; stamped jsonb;
      begin
        if not public.schedule_rows_authoritative(p_user_id) then
          raise exception 'schedules_stamp_retired_blob: owner % is not rows_authoritative', p_user_id;
        end if;
        select value into cur_value from public.planar_data where key = 'hs-v1' and user_id = p_user_id;
        if cur_value is null then return null; end if;
        if cur_value ? '_retiredAt' then return cur_value; end if;
        stamped := cur_value || jsonb_build_object('_retiredAt', now()::text, '_supersededBy', 'schedules');
        perform set_config('planyr.schedule_blob_admin_stamp', '1', true);
        update public.planar_data set value = stamped where key = 'hs-v1' and user_id = p_user_id;
        perform set_config('planyr.schedule_blob_admin_stamp', '0', true);
        return stamped;
      end; $$;
    `);
    await seedAccount(db, { authoritative: true });
    await db.query("select public.schedules_stamp_retired_blob($1)", [OWNER]);
    const blob = await blobFor(db);
    // The mutant's function believes it wrote _retiredAt (it returned `stamped`), but the real
    // row was silently refused by planar_data_enforce_version_monotonic because __rev never moved.
    expect(blob._retiredAt).toBeUndefined();
  });
});
