/* NEW-1 — the send caps + existing-account lookup behind POST /api/auth/email-link, run against a REAL Postgres.
 *
 * The shipped artifact (src/shared/auth/db/auth_email_link_caps.sql) is read off disk and executed VERBATIM into
 * PGlite (Postgres compiled to WASM). Only what Supabase provides and a bare Postgres does not is stubbed: the `auth`
 * schema's `users` table and the `anon` / `authenticated` / `service_role` roles. A test that re-implemented the cap
 * arithmetic in JS would be testing its own copy of the rule.
 *
 * MUTATION-CHECKED: a variant with the per-address cooldown deleted is loaded into its own database and must FAIL
 * the cooldown assertion — otherwise a cap that never fires would pass by accident. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL = readFileSync(join(ROOT, "src/shared/auth/db/auth_email_link_caps.sql"), "utf8");

const SHIM = `
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, deleted_at timestamptz);
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to service_role;
  insert into auth.users (id, email) values ('11111111-1111-4111-8111-111111111111', 'Me@X.Example');
  insert into auth.users (id, email, deleted_at) values ('22222222-2222-4222-8222-222222222222', 'gone@x.example', now());
`;

async function fresh(sql = SQL) { const db = new PGlite(); await db.exec(SHIM); await db.exec(sql); return db; }
const claim = async (db, { email = "me@x.example", ek = "e1", ik = "i1", purpose = "signin" } = {}) =>
  (await db.query("select public.claim_auth_email_link($1,$2,$3,$4) as r", [email, ek, ik, purpose])).rows[0].r;
const age = (db, seconds) => db.exec(`update public.auth_email_link_log set created_at = created_at - interval '${seconds} seconds'`);
const rows = async (db) => Number((await db.query("select count(*)::int as n from public.auth_email_link_log")).rows[0].n);

describe("claim_auth_email_link — the lookup", () => {
  it("finds an existing account (case-insensitively) and returns its id; unknown and deleted addresses return null", async () => {
    const db = await fresh();
    const a = await claim(db, { email: "me@x.example", ek: "a" }); expect(a.ok).toBe(true); expect(a.user_id).toBe("11111111-1111-4111-8111-111111111111");
    const b = await claim(db, { email: "  ME@x.EXAMPLE ", ek: "b" }); expect(b.user_id).toBe("11111111-1111-4111-8111-111111111111");
    const c = await claim(db, { email: "nobody@x.example", ek: "c" }); expect(c.ok).toBe(true); expect(c.user_id).toBeNull();
    const d = await claim(db, { email: "gone@x.example", ek: "d" }); expect(d.user_id).toBeNull();
  });
  it("never creates a user", async () => {
    const db = await fresh(); const before = Number((await db.query("select count(*)::int n from auth.users")).rows[0].n);
    await claim(db, { email: "stranger@x.example" });
    expect(Number((await db.query("select count(*)::int n from auth.users")).rows[0].n)).toBe(before);
  });
  it("rejects a bad purpose or empty keys outright", async () => {
    const db = await fresh();
    await expect(claim(db, { purpose: "admin" })).rejects.toThrow(/bad purpose/);
    await expect(claim(db, { ek: "" })).rejects.toThrow(/bad key/);
  });
});

describe("claim_auth_email_link — the caps", () => {
  it("one send per address per cooldown; the refusal says how long, and records nothing", async () => {
    const db = await fresh();
    expect((await claim(db)).ok).toBe(true);
    const r = await claim(db);
    expect(r).toMatchObject({ ok: false, reason: "address_cooldown" }); expect(r.retry_after_seconds).toBeGreaterThan(0); expect(r.retry_after_seconds).toBeLessThanOrEqual(60);
    expect(await rows(db)).toBe(1);
    await age(db, 61); expect((await claim(db)).ok).toBe(true);
  });
  it("an UNKNOWN address spends the same allowance as a real one (a refusal reveals nothing)", async () => {
    const db = await fresh();
    await claim(db, { email: "ghost@x.example", ek: "g" });
    expect(await claim(db, { email: "ghost@x.example", ek: "g" })).toMatchObject({ ok: false, reason: "address_cooldown" });
    const known = fresh(); const k = await known; await claim(k, { email: "me@x.example", ek: "g" });
    expect(await claim(k, { email: "me@x.example", ek: "g" })).toMatchObject({ ok: false, reason: "address_cooldown" });
  });
  it("3 per address per hour, then address_hour with a wait that shrinks as the oldest ages out", async () => {
    const db = await fresh();
    for (let i = 0; i < 3; i++) { expect((await claim(db)).ok).toBe(true); await age(db, 120); }
    const r = await claim(db);
    expect(r).toMatchObject({ ok: false, reason: "address_hour" }); expect(r.retry_after_seconds).toBeGreaterThan(3000); expect(r.retry_after_seconds).toBeLessThanOrEqual(3600 - 240);
    await age(db, 3600); expect((await claim(db)).ok).toBe(true);
  });
  it("10 per IP per hour across different addresses, then ip_hour", async () => {
    const db = await fresh();
    for (let i = 0; i < 10; i++) expect((await claim(db, { ek: "e" + i, ik: "ipA" })).ok).toBe(true);
    expect(await claim(db, { ek: "e99", ik: "ipA" })).toMatchObject({ ok: false, reason: "ip_hour" });
    expect((await claim(db, { ek: "e99", ik: "ipB" })).ok).toBe(true);   // another IP is unaffected
  });
  it("a project-wide ceiling, set from the config table (one UPDATE, no deploy)", async () => {
    const db = await fresh();
    await db.exec("update public.auth_email_link_config set global_hour = 3");
    for (let i = 0; i < 3; i++) expect((await claim(db, { ek: "e" + i, ik: "i" + i })).ok).toBe(true);
    expect(await claim(db, { ek: "e9", ik: "i9" })).toMatchObject({ ok: false, reason: "global_hour" });
  });
  it("release gives the allowance back (a failed send must not spend it); an unknown id is a no-op", async () => {
    const db = await fresh();
    const c = await claim(db);
    expect(await claim(db)).toMatchObject({ ok: false });
    await db.query("select public.release_auth_email_link($1)", [c.claim_id]);
    expect(await rows(db)).toBe(0);
    expect((await claim(db)).ok).toBe(true);
    await db.query("select public.release_auth_email_link(999999)");
  });
  it("rows older than a day are deleted by the next claim", async () => {
    const db = await fresh(); await claim(db); await age(db, 86400 + 10);
    await claim(db, { ek: "other", ik: "other" });
    expect(await rows(db)).toBe(1);
  });
  it("FAILS CLOSED: with the config row missing it raises (the route then refuses and logs), it never lets a send through", async () => {
    const db = await fresh(); await db.exec("delete from public.auth_email_link_config");
    await expect(claim(db)).rejects.toThrow(/config missing/);
    expect(await rows(db)).toBe(0);
  });
  it("stores keyed hashes only: the log table has no address or ip column", async () => {
    const db = await fresh();
    const cols = (await db.query("select column_name from information_schema.columns where table_name='auth_email_link_log' order by 1")).rows.map((r) => r.column_name);
    expect(cols).toEqual(["created_at", "email_key", "id", "ip_key", "purpose"]);
  });
});

describe("the lockdown — no client role can read, write or call anything", () => {
  it("anon and authenticated are refused on both tables and both functions; service_role may call the functions", async () => {
    const db = await fresh();
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(db.query("select * from public.auth_email_link_log")).rejects.toThrow(/permission denied/i);
      await expect(db.query("select * from public.auth_email_link_config")).rejects.toThrow(/permission denied/i);
      await expect(db.query("insert into public.auth_email_link_log (purpose,email_key,ip_key) values ('signin','a','b')")).rejects.toThrow(/permission denied/i);
      await expect(db.query("select public.claim_auth_email_link('me@x.example','k','i','signin')")).rejects.toThrow(/permission denied/i);
      await expect(db.query("select public.release_auth_email_link(1)")).rejects.toThrow(/permission denied/i);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    const r = (await db.query("select public.claim_auth_email_link('me@x.example','k','i','signin') as r")).rows[0].r;
    expect(r.ok).toBe(true);
    await db.exec("reset role");
  });
  it("RLS is on with zero policies on both tables", async () => {
    const db = await fresh();
    const t = (await db.query("select relname, relrowsecurity from pg_class where relname in ('auth_email_link_log','auth_email_link_config') order by 1")).rows;
    expect(t.map((x) => x.relrowsecurity)).toEqual([true, true]);
    expect(Number((await db.query("select count(*)::int n from pg_policies where tablename like 'auth_email_link_%'")).rows[0].n)).toBe(0);
  });
  it("is idempotent: running the migration twice changes nothing", async () => {
    const db = await fresh(); await claim(db); await db.exec(SQL);
    expect(await rows(db)).toBe(1);
    expect(Number((await db.query("select count(*)::int n from public.auth_email_link_config")).rows[0].n)).toBe(1);
  });
});

describe("mutation check — the assertions can fail", () => {
  it("with the per-address cooldown deleted, the cooldown assertion goes RED", async () => {
    const mutant = SQL.replace(/if v_last is not null and v_last > v_now - make_interval\(secs => cfg\.address_cooldown_s\) then/, "if false then");
    expect(mutant).not.toBe(SQL);
    const db = await fresh(mutant);
    expect((await claim(db)).ok).toBe(true);
    expect((await claim(db)).ok).toBe(true);   // a second immediate send gets through: the guard above would have caught this
  });
  it("with the lockdown revoke removed, a client role can read the log (so the lockdown test is not vacuous)", async () => {
    const mutant = SQL.replace(/revoke all on public\.auth_email_link_log\s+from public, anon, authenticated;/, "grant select on public.auth_email_link_log to anon;");
    expect(mutant).not.toBe(SQL);
    const db = await fresh(mutant); await db.exec("set role anon");
    await expect(db.query("select * from public.auth_email_link_log")).resolves.toBeTruthy();
  });
});
