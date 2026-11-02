/* NEW-1 (2026-11-02) — src/shared/auth/db/signin_health.sql run VERBATIM against a real Postgres (PGlite), the same way
 * clientErrorsRetention.test.js runs its policy: the abuse cap on auth events, "at most one open incident", and who may
 * call the counts function. A test that re-implemented the rule in JS would be testing its own copy. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_ERRORS = readFileSync(join(ROOT, "src/shared/telemetry/client_errors.sql"), "utf8");
const SQL = readFileSync(join(ROOT, "src/shared/auth/db/signin_health.sql"), "utf8");

const SHIM = `
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$;
`;

async function freshDb(sql = SQL) {
  const db = new PGlite();
  await db.exec(SHIM);
  await db.exec(CLIENT_ERRORS);
  // Supabase grants these to anon/authenticated by default privileges; a bare Postgres does not (not part of the artifact).
  await db.exec("grant usage on schema public to anon, authenticated, service_role; grant insert on public.client_errors to anon, authenticated;");
  await db.exec(sql);
  return db;
}
const insert = (db, source, n = 1) => db.exec(Array.from({ length: n }, (_, i) => `insert into public.client_errors(source, message) values ('${source}', 'm${i}');`).join("\n"));
const count = async (db, where = "true") => (await db.query(`select count(*)::int as n from public.client_errors where ${where}`)).rows[0].n;

describe("signin_health.sql", () => {
  let db;
  beforeAll(async () => { db = await freshDb(); });

  it("is idempotent — running it twice is harmless", async () => {
    await db.exec(SQL);
    expect((await db.query("select count(*)::int as n from pg_trigger where tgname = 'client_errors_cap_auth_events'")).rows[0].n).toBe(1);
  });

  it("caps ONE auth event source at 60 rows a minute — the 61st and later are dropped, silently, without erroring", async () => {
    await insert(db, "event:auth-captcha-refused", 75);
    expect(await count(db, "source = 'event:auth-captcha-refused'")).toBe(60);
  });

  it("the cap is per source: another auth event kind still gets through during a flood of the first", async () => {
    await insert(db, "event:auth-ok", 5);
    expect(await count(db, "source = 'event:auth-ok'")).toBe(5);
  });

  it("never touches any other telemetry (errors, perf captures, other events)", async () => {
    await insert(db, "window.onerror", 80);
    await insert(db, "event:perfcap", 80);
    expect(await count(db, "source = 'window.onerror'")).toBe(80);
    expect(await count(db, "source = 'event:perfcap'")).toBe(80);
  });

  it("FAILS OPEN: if the cap's own count errors, the row is still stored", async () => {
    const broken = await freshDb(SQL.replace("from public.client_errors where source = new.source", "from public.does_not_exist where source = new.source"));
    await insert(broken, "event:auth-ok", 70);
    expect(await count(broken, "source = 'event:auth-ok'")).toBe(70);
  });

  it("mutation check: without the trigger the flood is NOT capped", async () => {
    const noCap = await freshDb(SQL.replace(/drop trigger if exists client_errors_cap_auth_events[\s\S]*$/, ""));
    await insert(noCap, "event:auth-captcha-refused", 75);
    expect(await count(noCap, "source = 'event:auth-captcha-refused'")).toBe(75);
  });

  it("the counts function groups the last hour's auth events and ignores everything else", async () => {
    const d = await freshDb();
    await insert(d, "event:auth-ok", 3);
    await insert(d, "event:auth-captcha-refused", 2);
    await insert(d, "window.onerror", 4);
    await d.exec("insert into public.client_errors(source, message, at) values ('event:auth-ok', 'old', now() - interval '3 hours');");
    const rows = (await d.query("select source, n::int as n from public.signin_event_counts(60) order by source")).rows;
    expect(rows).toEqual([{ source: "event:auth-captcha-refused", n: 2 }, { source: "event:auth-ok", n: 3 }]);
  });

  it("at most ONE open incident per lane — the database refuses a second, and a closed one does not block a new one", async () => {
    const d = await freshDb();
    await d.exec("insert into public.signin_incidents(kind) values ('outside-in');");
    await expect(d.exec("insert into public.signin_incidents(kind) values ('client-rate');")).rejects.toThrow();
    await d.exec("insert into public.signin_incidents(kind, synthetic) values ('outside-in', true);"); // the drill lane is separate
    await d.exec("update public.signin_incidents set closed_at = now() where synthetic = false;");
    await d.exec("insert into public.signin_incidents(kind) values ('outside-in');");
    expect((await d.query("select count(*)::int as n from public.signin_incidents")).rows[0].n).toBe(3);
  });

  it("only known incident kinds and overall verdicts are accepted", async () => {
    const d = await freshDb();
    await expect(d.exec("insert into public.signin_incidents(kind) values ('weird');")).rejects.toThrow();
    await expect(d.exec("insert into public.signin_health_checks(overall) values ('green');")).rejects.toThrow();
    await d.exec("insert into public.signin_health_checks(overall) values ('unknown');");
  });

  it("anon / authenticated can read or write NEITHER table, and cannot call the counts function", async () => {
    const d = await freshDb();
    for (const role of ["anon", "authenticated"]) {
      await d.exec(`set role ${role};`);
      await expect(d.query("select * from public.signin_health_checks")).rejects.toThrow(/permission denied/);
      await expect(d.query("select * from public.signin_incidents")).rejects.toThrow(/permission denied/);
      await expect(d.query("select * from public.signin_event_counts(60)")).rejects.toThrow(/permission denied/);
      await d.exec("reset role;");
    }
  });

  it("an anonymous visitor can still INSERT an auth event (that is the point — it happens before sign-in)", async () => {
    const d = await freshDb();
    await d.exec("set role anon;");
    await d.exec("insert into public.client_errors(source, message) values ('event:auth-network', 'x');");
    await d.exec("reset role;");
    expect(await count(d, "source = 'event:auth-network'")).toBe(1);
  });
});
