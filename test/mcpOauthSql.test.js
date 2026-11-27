/* AI agent access, part 2 ("Connect to Claude", 2026-11-27) — server/mcp/db/mcp_oauth.sql run VERBATIM against a real
 * Postgres (PGlite), the same way signinHealthSql.test.js runs its file. It proves the three review blockers on the real
 * SQL, not on a JS copy of it:
 *   A1  what Claude reads is decided by row-level security AS THE PERSON (own rows + team-shared rows, never a stranger's),
 *   A2  nothing reachable with a connector token can write, and the token tables are unreadable to the app's roles,
 *   A3  Disconnect, a password change, account deletion, a reused code and a reused refresh token each end access.
 * The app tables below are stubs with the SAME policy shape as production (`to authenticated`, own OR team member). */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL = readFileSync(join(ROOT, "server/mcp/db/mcp_oauth.sql"), "utf8");

const A = "00000000-0000-4000-8000-00000000000a";   // owner of the team
const B = "00000000-0000-4000-8000-00000000000b";   // A's teammate
const C = "00000000-0000-4000-8000-00000000000c";   // a stranger
const TEAM = "00000000-0000-4000-8000-0000000000f1";
const SITE_A = "10000000-0000-4000-8000-00000000000a";
const SITE_TEAM = "10000000-0000-4000-8000-0000000000f1";
const SITE_C = "10000000-0000-4000-8000-00000000000c";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

// Supabase's own auth.uid(): the `sub` of the request's JWT claims.
const SHIM = `
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text, encrypted_password text);
  create or replace function auth.uid() returns uuid language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  create table public.team_members (team_id uuid, user_id uuid);
  create or replace function public.is_team_member(p_team uuid) returns boolean language sql stable security definer
    set search_path = public as $$ select exists (select 1 from public.team_members where team_id = p_team and user_id = auth.uid()) $$;
  grant execute on function public.is_team_member(uuid) to authenticated;

  create table public.sites (id uuid primary key, group_id uuid, site text, name text, county text, updated_at timestamptz default now(),
    data jsonb default '{}', user_id uuid, team_id uuid);
  create table public.file_facts (id uuid primary key default gen_random_uuid(), review_id uuid, project_id uuid, needs_filing boolean,
    state text, category text, discipline text, item text, sheet_number text, sheet_title text, revision text, doc_date date,
    source_file text, match_confidence numeric, updated_at timestamptz default now(), user_id uuid, team_id uuid);
  create table public.schedules (id uuid primary key default gen_random_uuid(), data jsonb, deleted_at timestamptz, user_id uuid);
  alter table public.sites enable row level security;
  alter table public.file_facts enable row level security;
  alter table public.schedules enable row level security;
  create policy "select own or team sites" on public.sites for select to authenticated
    using (user_id = (select auth.uid()) or (team_id is not null and is_team_member(team_id)));
  create policy "write own sites" on public.sites for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  create policy "select own or team file_facts" on public.file_facts for select to authenticated
    using (user_id = (select auth.uid()) or (team_id is not null and is_team_member(team_id)));
  create policy "select own schedule" on public.schedules for select to authenticated using (user_id = (select auth.uid()));
  grant select, insert, update, delete on public.sites, public.file_facts, public.schedules to authenticated;
  grant all on public.sites, public.file_facts, public.schedules to service_role;
`;
const SEED = `
  insert into auth.users (id, email, encrypted_password) values ('${A}', 'a@x.test', 'h1'), ('${B}', 'b@x.test', 'h2'), ('${C}', 'c@x.test', 'h3');
  insert into public.team_members values ('${TEAM}', '${A}'), ('${TEAM}', '${B}');
  insert into public.sites (id, group_id, site, user_id, team_id) values
    ('${SITE_A}', '${SITE_A}', 'A private', '${A}', null),
    ('${SITE_TEAM}', '${SITE_TEAM}', 'Team shared', '${A}', '${TEAM}'),
    ('${SITE_C}', '${SITE_C}', 'Stranger', '${C}', null);
  insert into public.file_facts (sheet_title, source_file, user_id, team_id) values
    ('A sheet', 'a.pdf', '${A}', null), ('Team sheet', 't.pdf', '${A}', '${TEAM}'), ('C sheet', 'c.pdf', '${C}', null);
  insert into public.schedules (data, user_id) values ('{"n":"A"}', '${A}'), ('{"n":"C"}', '${C}');
`;

async function freshDb() {
  const db = new PGlite();
  await db.exec(SHIM);
  await db.exec(SQL);
  await db.exec(SEED);
  return db;
}
// One statement as a role (and, for `authenticated`, as a person), always back to the superuser afterwards.
async function as(db, role, sql, params = [], uid = null) {
  await db.exec(`reset role; select set_config('request.jwt.claims', '${uid ? JSON.stringify({ sub: uid, role }) : ""}', false);
                 select set_config('request.jwt.claim.sub', '', false); set role ${role};`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec("reset role;"); }
}
const one = async (...a) => Object.values((await as(...a))[0])[0];
const read = (db, uid, query, args = {}) => one(db, "service_role", "select public.mcp_read($1, $2, $3::jsonb)", [uid, query, JSON.stringify(args)]);
const names = (rows) => rows.map((r) => r.site || r.sheet_title).sort();
const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const VERIFIER = "v".repeat(50);
const CHALLENGE = b64url(createHash("sha256").update(VERIFIER).digest());

// Register → begin → the person allows → a code. Returns everything a test needs to continue the flow.
async function consent(db, uid, { ip = "ip1", redirect = CALLBACK } = {}) {
  const reg = await one(db, "service_role", "select public.mcp_oauth_register($1, $2, $3)", ["Claude", [redirect], ip]);
  expect(reg.ok).toBe(true);
  const begin = await one(db, "service_role", "select public.mcp_oauth_begin($1, $2, $3, $4, $5)", [reg.client_id, redirect, "st8", CHALLENGE, ""]);
  expect(begin.ok).toBe(true);
  const decided = await one(db, "authenticated", "select public.mcp_oauth_decide($1, true)", [begin.request_id], uid);
  expect(decided.ok).toBe(true);
  return { client: reg.client_id, request: begin.request_id, code: decided.code, decided };
}
const exchange = (db, f, { verifierChallenge = CHALLENGE, redirect = CALLBACK, code = f.code, client = f.client } = {}) =>
  one(db, "service_role", "select public.mcp_oauth_exchange($1, $2, $3, $4)", [code, client, redirect, verifierChallenge]);
const check = (db, token) => one(db, "service_role", "select public.mcp_oauth_check($1)", [token]);
const refresh = (db, token, client) => one(db, "service_role", "select public.mcp_oauth_refresh($1, $2)", [token, client]);

describe("mcp_oauth.sql", () => {
  let db;
  beforeAll(async () => { db = await freshDb(); });

  it("is idempotent — running it twice is harmless", async () => {
    await db.exec(SQL);
    const r = (await db.query("select rolcanlogin, rolbypassrls, rolinherit from pg_roles where rolname = 'mcp_reader'")).rows[0];
    expect(r).toEqual({ rolcanlogin: false, rolbypassrls: false, rolinherit: true });
  });

  describe("A1 — row-level security decides what Claude reads, as the person", () => {
    it("the read function is owned by the no-login, no-bypass role and is read-only (STABLE)", async () => {
      const f = (await db.query("select pg_get_userbyid(proowner) as owner, provolatile, prosecdef from pg_proc where proname = 'mcp_read'")).rows[0];
      expect(f).toEqual({ owner: "mcp_reader", provolatile: "s", prosecdef: true });
      expect((await db.query("select has_schema_privilege('mcp_reader', 'public', 'CREATE') as c")).rows[0].c).toBe(false);
    });
    it("A sees their own project and the team-shared one, never the stranger's", async () => {
      expect(names(await read(db, A, "sites_light"))).toEqual(["A private", "Team shared"]);
      expect(names(await read(db, A, "facts_full"))).toEqual(["A sheet", "Team sheet"]);
    });
    it("a teammate sees the team-shared project but not A's private one", async () => {
      expect(names(await read(db, B, "sites_light"))).toEqual(["Team shared"]);
      expect(names(await read(db, B, "facts_full"))).toEqual(["Team sheet"]);
    });
    it("asking for another person's project by its id returns nothing (IDOR)", async () => {
      expect(await read(db, B, "site_by_id", { id: SITE_A })).toEqual([]);
      expect(await read(db, C, "sites_by_group", { id: SITE_TEAM })).toEqual([]);
      expect(names(await read(db, B, "site_by_id", { id: SITE_TEAM }))).toEqual(["Team shared"]);
    });
    it("own-only tables stay own-only", async () => {
      expect((await read(db, A, "schedules_live")).map((r) => r.data.n)).toEqual(["A"]);
      expect(await read(db, B, "schedules_live")).toEqual([]);
    });
    it("search text cannot widen the query (wildcards and quote tricks)", async () => {
      expect(names(await read(db, C, "facts_search", { q: "%" }))).toEqual(["C sheet"]);   // % is stripped: a search for "" still sees only C's own
      expect(names(await read(db, C, "facts_search", { q: "' or 1=1 --" }))).toEqual([]);
      expect(names(await read(db, C, "facts_search", { q: "" }))).toEqual(["C sheet"]);
      expect(names(await read(db, B, "facts_search", { q: "_" }))).toEqual([]);
    });
    it("an unknown query name and a missing user are refused, loudly", async () => {
      await expect(read(db, A, "drop_everything")).rejects.toThrow(/unknown query/);
      await expect(read(db, null, "sites_light")).rejects.toThrow(/no user/);
    });
  });

  describe("A2 — nothing a connector token reaches can write; the app's roles cannot reach the machinery", () => {
    it("only the server role may run the read and the token functions", async () => {
      for (const role of ["anon", "authenticated"]) {
        await expect(as(db, role, "select public.mcp_read($1, 'sites_light')", [A], A)).rejects.toThrow(/permission denied/);
        await expect(as(db, role, "select public.mcp_oauth_check('x')", [], A)).rejects.toThrow(/permission denied/);
        await expect(as(db, role, "select public.mcp_oauth_exchange('a','b','c','d')", [], A)).rejects.toThrow(/permission denied/);
        await expect(as(db, role, "select public.mcp_oauth_register('n', array['${CALLBACK}'], 'i')", [], A)).rejects.toThrow(/permission denied/);
      }
    });
    it("the token, code, grant, client and request tables are unreadable and unwritable to the app's roles", async () => {
      for (const t of ["mcp_oauth_tokens", "mcp_oauth_codes", "mcp_oauth_grants", "mcp_oauth_clients", "mcp_oauth_requests"]) {
        await expect(as(db, "authenticated", `select * from public.${t}`, [], A)).rejects.toThrow(/permission denied/);
        await expect(as(db, "anon", `delete from public.${t}`)).rejects.toThrow(/permission denied/);
      }
    });
    it("the read role, even with the person's claims, cannot write when used in a read-only function", async () => {
      // STABLE functions refuse data-changing statements; prove Postgres enforces it for this owner.
      await db.exec(`create or replace function public.__probe_write() returns void language plpgsql stable security definer as $$
                     begin update public.sites set site = 'pwned'; end $$;`);
      await db.exec("grant create on schema public to mcp_reader; alter function public.__probe_write() owner to mcp_reader; revoke create on schema public from mcp_reader;");
      await expect(db.query("select public.__probe_write()")).rejects.toThrow(/not allowed in a non-volatile function/);
      await db.exec("drop function public.__probe_write()");
      expect((await db.query("select count(*)::int as n from public.sites where site = 'pwned'")).rows[0].n).toBe(0);
    });
    it("tokens are stored only as hashes", async () => {
      const f = await consent(db, A);
      const t = await exchange(db, f);
      const hashes = (await db.query("select token_hash from public.mcp_oauth_tokens")).rows.map((r) => r.token_hash);
      expect(hashes).not.toContain(t.access_token);
      expect(hashes).not.toContain(t.refresh_token);
      expect(hashes).toContain(createHash("sha256").update(t.access_token).digest("hex"));
      expect((await db.query("select count(*)::int as n from public.mcp_oauth_codes where code_hash = $1", [f.code])).rows[0].n).toBe(0);
    });
  });

  describe("registration and the redirect allow-list", () => {
    it("only Claude's callbacks and loopback addresses can register", async () => {
      const reg = (uris) => one(db, "service_role", "select public.mcp_oauth_register('Claude', $1, 'ipR')", [uris]);
      for (const ok of [[CALLBACK], ["https://claude.com/api/mcp/auth_callback"], ["http://localhost:33418/callback"], ["http://127.0.0.1/cb"]]) {
        expect((await reg(ok)).ok).toBe(true);
      }
      for (const bad of [["https://evil.test/api/mcp/auth_callback"], ["https://claude.ai.evil.test/api/mcp/auth_callback"],
        ["https://claude.ai/api/mcp/auth_callback?x=1"], ["http://claude.ai/api/mcp/auth_callback"], ["http://localhost.evil.test/cb"],
        ["http://127.0.0.1@evil.test/cb"], [CALLBACK, "https://evil.test/cb"], []]) {
        expect((await reg(bad)).reason).toBe("redirect");
      }
    });
    it("caps registrations per address per hour", async () => {
      const reg = () => one(db, "service_role", "select public.mcp_oauth_register('Spam', $1, 'ipSpam')", [[CALLBACK]]);
      for (let i = 0; i < 20; i++) expect((await reg()).ok).toBe(true);
      expect((await reg()).reason).toBe("throttled");
    });
    it("begin refuses an unknown client, a redirect that is not an exact match, and a non-S256 challenge", async () => {
      const reg = await one(db, "service_role", "select public.mcp_oauth_register('Claude', $1, 'ipB')", [[CALLBACK]]);
      const begin = (client, redirect, ch) => one(db, "service_role", "select public.mcp_oauth_begin($1, $2, 's', $3, '')", [client, redirect, ch]);
      expect((await begin("nope", CALLBACK, CHALLENGE)).reason).toBe("client");
      expect((await begin(reg.client_id, CALLBACK + "/", CHALLENGE)).reason).toBe("redirect");
      expect((await begin(reg.client_id, "https://claude.com/api/mcp/auth_callback", CHALLENGE)).reason).toBe("redirect");
      expect((await begin(reg.client_id, CALLBACK, VERIFIER)).reason).toBe("pkce");      // a plain verifier is not a S256 challenge
      expect((await begin(reg.client_id, CALLBACK, CHALLENGE)).ok).toBe(true);
    });
  });

  describe("the Allow page", () => {
    it("needs a signed-in person, shows the self-reported name and the real host, and is single use", async () => {
      const reg = await one(db, "service_role", "select public.mcp_oauth_register('Totally Claude', $1, 'ipP')", [["http://localhost:9/cb"]]);
      const { request_id } = await one(db, "service_role", "select public.mcp_oauth_begin($1, $2, 'st', $3, '')", [reg.client_id, "http://localhost:9/cb", CHALLENGE]);
      expect((await one(db, "authenticated", "select public.mcp_oauth_request_info($1)", [request_id])).reason).toBe("signed_out");
      expect(await one(db, "authenticated", "select public.mcp_oauth_request_info($1)", [request_id], A))
        .toEqual({ ok: true, client_name: "Totally Claude", redirect_host: "localhost", scope: "planyr.read" });
      const no = await one(db, "authenticated", "select public.mcp_oauth_decide($1, false)", [request_id], A);
      expect(no).toEqual({ ok: true, redirect_uri: "http://localhost:9/cb", state: "st", error: "access_denied" });
      expect((await one(db, "authenticated", "select public.mcp_oauth_decide($1, true)", [request_id], A)).reason).toBe("used");
      expect((await one(db, "authenticated", "select public.mcp_oauth_request_info($1)", [request_id], A)).reason).toBe("used");
    });
    it("an expired request cannot be allowed", async () => {
      const reg = await one(db, "service_role", "select public.mcp_oauth_register('Claude', $1, 'ipE')", [[CALLBACK]]);
      const { request_id } = await one(db, "service_role", "select public.mcp_oauth_begin($1, $2, 'st', $3, '')", [reg.client_id, CALLBACK, CHALLENGE]);
      await db.query("update public.mcp_oauth_requests set expires_at = now() - interval '1 second' where id = $1", [request_id]);
      expect((await one(db, "authenticated", "select public.mcp_oauth_decide($1, true)", [request_id], A)).reason).toBe("expired");
    });
  });

  describe("A3 — codes, tokens and every way access ends", () => {
    it("a good exchange gives a 1-hour access token that reads as the person who allowed it", async () => {
      const f = await consent(db, B);
      const t = await exchange(db, f);
      expect(t).toMatchObject({ ok: true, token_type: "Bearer", expires_in: 3600, scope: "planyr.read" });
      expect(t.access_token).toMatch(/^pmcp_at_[0-9a-f]{64}$/);
      const c = await check(db, t.access_token);
      expect(c).toMatchObject({ ok: true, user_id: B });
      expect(await check(db, t.refresh_token)).toEqual({ ok: false });               // a refresh token is not an access token
    });
    it("a wrong PKCE verifier, redirect or client fails AND spends the code", async () => {
      for (const wrong of [{ verifierChallenge: b64url(createHash("sha256").update("nope").digest()) }, { redirect: "http://localhost/cb" }, { client: "pmcp_client_other" }]) {
        const f = await consent(db, A);
        expect((await exchange(db, f, wrong)).error).toBe("invalid_grant");
        expect((await exchange(db, f)).error).toBe("invalid_grant");
      }
    });
    it("an expired code is refused", async () => {
      const f = await consent(db, A);
      await db.query("update public.mcp_oauth_codes set expires_at = now() - interval '1 second' where code_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')", [f.code]);
      expect((await exchange(db, f)).error).toBe("invalid_grant");
    });
    it("redeeming a code twice revokes everything the first redemption issued", async () => {
      const f = await consent(db, A);
      const t = await exchange(db, f);
      expect((await check(db, t.access_token)).ok).toBe(true);
      expect((await exchange(db, f)).error).toBe("invalid_grant");
      expect(await check(db, t.access_token)).toEqual({ ok: false });
      expect((await refresh(db, t.refresh_token, f.client)).error).toBe("invalid_grant");
    });
    it("refresh rotates both tokens; the old access token stops working", async () => {
      const f = await consent(db, A);
      const t1 = await exchange(db, f);
      const t2 = await refresh(db, t1.refresh_token, f.client);
      expect(t2.ok).toBe(true);
      expect(t2.refresh_token).not.toBe(t1.refresh_token);
      expect(await check(db, t1.access_token)).toEqual({ ok: false });
      expect((await check(db, t2.access_token)).ok).toBe(true);
      expect((await refresh(db, t2.refresh_token, "pmcp_client_other")).error).toBe("invalid_grant");   // another client's refresh is refused
    });
    it("a reused refresh token revokes the whole grant (theft detection) once its 30-second retry grace has passed", async () => {
      const f = await consent(db, A);
      const t1 = await exchange(db, f);
      const t2 = await refresh(db, t1.refresh_token, f.client);
      await db.query("update public.mcp_oauth_tokens set used_at = now() - interval '31 seconds' where token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')", [t1.refresh_token]);
      expect((await refresh(db, t1.refresh_token, f.client)).error).toBe("invalid_grant");
      expect(await check(db, t2.access_token)).toEqual({ ok: false });
      expect((await refresh(db, t2.refresh_token, f.client)).error).toBe("invalid_grant");
    });
    it("a retried refresh inside 30 seconds (lost answer, racing requests) gets a fresh pair and disconnects nobody", async () => {
      const f = await consent(db, A);
      const t1 = await exchange(db, f);
      const t2 = await refresh(db, t1.refresh_token, f.client);
      const t3 = await refresh(db, t1.refresh_token, f.client);                 // the client never saw t2 and retried
      expect(t3.ok).toBe(true);
      expect(t3.refresh_token).not.toBe(t2.refresh_token);
      expect(await check(db, t2.access_token)).toEqual({ ok: false });         // the first use's pair is retired: ONE chain
      const { grant_id } = await check(db, t3.access_token);
      expect(grant_id).toBeTruthy();
      expect((await refresh(db, t3.refresh_token, f.client)).ok).toBe(true);   // the retried chain carries on
      expect((await refresh(db, t1.refresh_token, "pmcp_client_other")).error).toBe("invalid_grant"); // grace never crosses clients
      const g = await db.query("select revoked_at from public.mcp_oauth_grants where id = $1", [grant_id]);
      expect(g.rows[0].revoked_at).toBeNull();
    });
    it("a replay inside the grace leaves ONE chain: the retired pair's refresh then trips reuse and revokes the grant", async () => {
      const f = await consent(db, A);
      const r1 = await exchange(db, f);
      const pairA = await refresh(db, r1.refresh_token, f.client);              // first use of R1 -> pair A
      const pairB = await refresh(db, r1.refresh_token, f.client);              // R1 again within 30 s -> pair B
      expect(pairB.ok).toBe(true);
      expect(await check(db, pairA.access_token)).toEqual({ ok: false });      // pair A's access token is dead
      const { grant_id } = await check(db, pairB.access_token);
      expect((await refresh(db, pairA.refresh_token, f.client)).error).toBe("invalid_grant");   // pair A's refresh fails…
      expect(await check(db, pairB.access_token)).toEqual({ ok: false });      // …and revokes the whole grant
      expect((await refresh(db, pairB.refresh_token, f.client)).error).toBe("invalid_grant");
      const g = await db.query("select revoked_reason from public.mcp_oauth_grants where id = $1", [grant_id]);
      expect(g.rows[0].revoked_reason).toBe("refresh_reused");
    });
    it("housekeeping: codes and tokens long past their expiry are purged; a fresh spent code is kept for replay detection", async () => {
      const f1 = await consent(db, A);
      const t = await exchange(db, f1);
      await db.query("update public.mcp_oauth_codes set expires_at = now() - interval '2 days' where code_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')", [f1.code]);
      await db.query("update public.mcp_oauth_tokens set expires_at = now() - interval '2 days' where token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')", [t.access_token]);
      const f2 = await consent(db, A);
      const t2 = await exchange(db, f2);                                          // any exchange sweeps old codes
      const codes = await db.query("select code_hash from public.mcp_oauth_codes where code_hash in (encode(sha256(convert_to($1, 'UTF8')), 'hex'), encode(sha256(convert_to($2, 'UTF8')), 'hex'))", [f1.code, f2.code]);
      expect(codes.rows).toHaveLength(1);                                          // f1 gone, f2 (spent minutes ago) kept
      await refresh(db, t2.refresh_token, f2.client);                              // any refresh sweeps old tokens
      const toks = await db.query("select 1 from public.mcp_oauth_tokens where token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')", [t.access_token]);
      expect(toks.rows).toHaveLength(0);
    });
    it("an expired access token is refused", async () => {
      const t = await exchange(db, await consent(db, A));
      await db.query("update public.mcp_oauth_tokens set expires_at = now() - interval '1 second' where token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')", [t.access_token]);
      expect(await check(db, t.access_token)).toEqual({ ok: false });
    });
    it("Disconnect ends access on the very next call, and only the owner can disconnect", async () => {
      const t = await exchange(db, await consent(db, A));
      const { grant_id } = await check(db, t.access_token);
      const mine = await as(db, "authenticated", "select * from public.mcp_oauth_my_grants()", [], A);
      expect(mine.map((g) => g.id)).toContain(grant_id);
      expect(Object.keys(mine[0]).sort()).toEqual(["client_name", "created_at", "id", "last_used_at", "redirect_host", "scope"]);
      expect((await as(db, "authenticated", "select * from public.mcp_oauth_my_grants()", [], C)).map((g) => g.id)).not.toContain(grant_id);
      expect(await one(db, "authenticated", "select public.mcp_oauth_revoke_my_grant($1)", [grant_id], C)).toBe(false);
      expect((await check(db, t.access_token)).ok).toBe(true);
      expect(await one(db, "authenticated", "select public.mcp_oauth_revoke_my_grant($1)", [grant_id], A)).toBe(true);
      expect(await check(db, t.access_token)).toEqual({ ok: false });
      expect((await refresh(db, t.refresh_token, "any")).error).toBe("invalid_grant");
      expect((await as(db, "authenticated", "select * from public.mcp_oauth_my_grants()", [], A)).map((g) => g.id)).not.toContain(grant_id);
    });
    it("sign out on all devices disconnects every assistant of that person only", async () => {
      const ta = await exchange(db, await consent(db, A));
      const tb = await exchange(db, await consent(db, B));
      expect(await one(db, "authenticated", "select public.mcp_oauth_revoke_all_my_grants()", [])).toBe(0);   // signed out: nothing
      expect(await one(db, "authenticated", "select public.mcp_oauth_revoke_all_my_grants()", [], A)).toBeGreaterThanOrEqual(1);
      expect(await check(db, ta.access_token)).toEqual({ ok: false });
      expect((await check(db, tb.access_token)).ok).toBe(true);
    });
    it("a password change ends every connection; an unrelated update does not", async () => {
      const t = await exchange(db, await consent(db, B));
      await db.query("update auth.users set email = 'b2@x.test' where id = $1", [B]);
      expect((await check(db, t.access_token)).ok).toBe(true);
      await db.query("update auth.users set encrypted_password = 'new' where id = $1", [B]);
      expect(await check(db, t.access_token)).toEqual({ ok: false });
    });
    it("a password change never fails because revoking assistants failed, and says so in the log (RAISE WARNING)", async () => {
      const t = await exchange(db, await consent(db, B));
      const orig = (await db.query("select pg_get_functiondef('public.mcp_oauth_revoke_grant(uuid, text)'::regprocedure) d")).rows[0].d;
      await db.exec("create or replace function public.mcp_oauth_revoke_grant(p_grant uuid, p_reason text) returns void language plpgsql as $$ begin raise exception 'boom'; end $$;");
      const notices = [];
      try {
        await db.query("update auth.users set encrypted_password = 'newer' where id = $1", [B], { onNotice: (n) => notices.push(n) });
        expect((await db.query("select encrypted_password from auth.users where id = $1", [B])).rows[0].encrypted_password).toBe("newer");
        expect(notices.some((n) => n.severity === "WARNING" && /could not revoke assistant grants/.test(n.message))).toBe(true);
      } finally {
        await db.exec(orig);
      }
      expect((await check(db, t.access_token)).ok).toBe(true);                    // still listed, so the person can Disconnect it
    });
    it("deleting the account removes its grants and tokens", async () => {
      const f = await consent(db, C);
      const t = await exchange(db, f);
      await db.query("delete from auth.users where id = $1", [C]);
      expect(await check(db, t.access_token)).toEqual({ ok: false });
      expect((await db.query("select count(*)::int as n from public.mcp_oauth_grants where user_id = $1", [C])).rows[0].n).toBe(0);
    });
  });
});
