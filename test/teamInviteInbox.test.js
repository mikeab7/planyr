/* NEW-1 (2026-10-28) — the team-invite INBOX, run against a REAL Postgres (PGlite) with the shipped
 * `.sql` files verbatim (profiles → teams → team_invite_guard → team_invite_inbox).
 *
 * The case it comes from: paul.reinke@hillwood.com signed up 18:13:56 UTC and was invited to team USEC
 * 20 seconds later. The signup trigger had already run, so the invite sat unclaimed and nothing told him.
 * The fix is a menu inbox (list_my_invites / respond_to_invite); these tests are the contract for the
 * SQL half: the invitee sees ONLY their own address's open invites, Accept adds ONE membership at the
 * invited role and stamps THAT invite, Decline hides it for good, and nobody can read or answer someone
 * else's. Against `main` (no db/team_invite_inbox.sql) every one of these fails: the functions do not exist.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB = join(ROOT, "src/workspaces/site-planner/db");
const read = (f) => readFileSync(join(DB, f), "utf8");

// Supabase's auth schema, reduced to what these files touch. auth.uid() reads a session setting so a
// test can "be" a user; auth.email() is that user's address (the real one reads the JWT claim).
const SHIM = `
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid $$;
  create or replace function auth.email() returns text language sql stable as $$
    select u.email from auth.users u where u.id = auth.uid() $$;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  end $$;
`;

const CHRIS = "00000000-0000-0000-0000-00000000c001"; // inviter, USEC admin
const PAUL = "00000000-0000-0000-0000-00000000a001";  // existing account, invited afterwards
const EVE = "00000000-0000-0000-0000-00000000e001";   // someone else entirely
const USEC = "00000000-0000-0000-0000-0000000005ec";
const OTHER = "00000000-0000-0000-0000-0000000005ed";

let db;
const as = async (uid) => { await db.exec(`reset role; select set_config('test.uid', '${uid || ""}', false); ${uid ? "set role authenticated;" : ""}`); };
const asOwner = () => db.exec("reset role; select set_config('test.uid', '', false);");
const rpc = async (uid, sql, params = []) => { await as(uid); try { return (await db.query(sql, params)).rows; } finally { await asOwner(); } };
const myInvites = (uid) => rpc(uid, "select * from public.list_my_invites()");
const respond = async (uid, invite, accept) => (await rpc(uid, "select public.respond_to_invite($1, $2) as r", [invite, accept]))[0].r;
const q = async (sql, params) => (await db.query(sql, params)).rows;

async function fresh() {
  const d = new PGlite();
  await d.exec(SHIM);
  await d.exec(read("profiles.sql"));
  await d.exec(read("teams.sql"));
  await d.exec(read("team_invite_guard.sql"));
  await d.exec(read("team_invite_inbox.sql"));
  await d.exec("grant usage on schema public, auth to authenticated, anon; grant all on all tables in schema public to authenticated; grant select on auth.users to authenticated;");
  return d;
}

beforeEach(async () => {
  db = await fresh();
  await db.exec(`
    insert into auth.users (id, email) values
      ('${CHRIS}', 'chris.seward@hillwood.com'), ('${PAUL}', 'Paul.Reinke@Hillwood.com'), ('${EVE}', 'eve@example.com');
    update public.profiles set first_name = 'Chris', last_name = 'Seward' where id = '${CHRIS}';
    insert into public.teams (id, name, created_by) values ('${USEC}', 'USEC', '${CHRIS}'), ('${OTHER}', 'Other Co', '${CHRIS}');
    insert into public.team_members (team_id, user_id, role) values ('${USEC}', '${CHRIS}', 'admin'), ('${OTHER}', '${CHRIS}', 'admin');
  `);
});

const invite = async (team, email, role = "member") =>
  (await q("insert into public.team_invites (team_id, email, role, invited_by) values ($1, $2, $3, $4) returning id", [team, email, role, CHRIS]))[0].id;

describe("list_my_invites — the invitee sees only invitations addressed to their own email", () => {
  it("returns team name, who invited them and the role (Paul's real USEC case)", async () => {
    await invite(USEC, "paul.reinke@hillwood.com", "admin");
    const rows = await myInvites(PAUL);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ team_id: USEC, team_name: "USEC", role: "admin", invited_by_name: "Chris Seward" });
  });

  it("matches the address case-insensitively and trimmed", async () => {
    await invite(USEC, "  PAUL.REINKE@hillwood.com ");
    expect(await myInvites(PAUL)).toHaveLength(1); // account stored as 'Paul.Reinke@Hillwood.com'
  });

  it("never shows another person's invitation", async () => {
    await invite(USEC, "paul.reinke@hillwood.com");
    await invite(OTHER, "eve@example.com");
    expect((await myInvites(PAUL)).map((r) => r.team_name)).toEqual(["USEC"]);
    expect((await myInvites(EVE)).map((r) => r.team_name)).toEqual(["Other Co"]);
    expect(await myInvites(CHRIS)).toHaveLength(0);
  });

  it("hides invitations that are already accepted or declined", async () => {
    const a = await invite(USEC, "paul.reinke@hillwood.com");
    const b = await invite(OTHER, "paul.reinke@hillwood.com");
    await respond(PAUL, a, true);
    await respond(PAUL, b, false);
    expect(await myInvites(PAUL)).toHaveLength(0);
  });

  it("signed out (no uid) gets nothing, and the anon role cannot call it at all", async () => {
    await invite(USEC, "paul.reinke@hillwood.com");
    expect(await myInvites(null)).toHaveLength(0);
    const [{ ok }] = await q("select has_function_privilege('anon', 'public.list_my_invites()', 'execute') as ok");
    expect(ok).toBe(false);
    const [{ ok: ok2 }] = await q("select has_function_privilege('anon', 'public.respond_to_invite(uuid, boolean)', 'execute') as ok");
    expect(ok2).toBe(false);
  });

  it("does NOT widen team_invites RLS — the invitee's direct read policy is the one that already existed", async () => {
    const policies = await q("select policyname, cmd from pg_policies where schemaname='public' and tablename='team_invites' order by policyname");
    expect(policies.map((p) => p.policyname)).toEqual(["admins create invites", "admins delete invites", "admins read invites", "invitee reads own"]);
  });
});

describe("respond_to_invite — Accept", () => {
  it("adds the membership at the invited role and stamps THAT invite claimed (per-invite, not claim-all)", async () => {
    const usec = await invite(USEC, "paul.reinke@hillwood.com", "admin");
    const other = await invite(OTHER, "paul.reinke@hillwood.com", "member");
    const res = await respond(PAUL, usec, true);
    expect(res).toMatchObject({ ok: true, status: "accepted", team_id: USEC, team_name: "USEC" });
    const m = await q("select team_id, role, added_by from public.team_members where user_id = $1", [PAUL]);
    expect(m).toEqual([{ team_id: USEC, role: "admin", added_by: CHRIS }]);
    const inv = await q("select id, claimed_at, declined_at from public.team_invites where id in ($1, $2)", [usec, other]);
    expect(inv.find((r) => r.id === usec).claimed_at).not.toBeNull();
    expect(inv.find((r) => r.id === other).claimed_at).toBeNull(); // the other invitation is still waiting
    expect((await myInvites(PAUL)).map((r) => r.team_name)).toEqual(["Other Co"]);
  });

  it("is idempotent (a double click is a success, not a second membership)", async () => {
    const id = await invite(USEC, "paul.reinke@hillwood.com");
    await respond(PAUL, id, true);
    expect(await respond(PAUL, id, true)).toMatchObject({ ok: true, status: "accepted" });
    expect(await q("select 1 from public.team_members where user_id = $1", [PAUL])).toHaveLength(1);
  });

  it("the inviter's pending list reflects it: gone from the open invites, present in the roster", async () => {
    const id = await invite(USEC, "paul.reinke@hillwood.com");
    await respond(PAUL, id, true);
    const open = await rpc(CHRIS, "select email from public.team_invites where team_id = $1 and claimed_at is null", [USEC]);
    expect(open).toHaveLength(0);
    const roster = await rpc(CHRIS, "select user_id from public.list_team_members($1)", [USEC]);
    expect(roster.map((r) => r.user_id)).toContain(PAUL);
  });
});

describe("respond_to_invite — Decline", () => {
  it("hides the invitation, adds no membership, and the inviter can see it was declined", async () => {
    const id = await invite(USEC, "paul.reinke@hillwood.com");
    expect(await respond(PAUL, id, false)).toMatchObject({ ok: true, status: "declined" });
    expect(await myInvites(PAUL)).toHaveLength(0);
    expect(await q("select 1 from public.team_members where user_id = $1", [PAUL])).toHaveLength(0);
    const seen = await rpc(CHRIS, "select email, claimed_at, declined_at from public.team_invites where team_id = $1", [USEC]);
    expect(seen).toHaveLength(1);
    expect(seen[0].claimed_at).toBeNull();
    expect(seen[0].declined_at).not.toBeNull();
  });

  it("a declined invitation cannot be accepted afterwards, claimed in bulk, or self-inserted under RLS", async () => {
    const id = await invite(USEC, "paul.reinke@hillwood.com");
    await respond(PAUL, id, false);
    expect(await respond(PAUL, id, true)).toMatchObject({ ok: false, reason: "declined" });
    expect((await rpc(PAUL, "select public.claim_team_invites() as n"))[0].n).toBe(0);
    await as(PAUL);
    await expect(db.query("insert into public.team_members (team_id, user_id, role) values ($1, $2, 'member')", [USEC, PAUL])).rejects.toThrow(/row-level security/i);
    await asOwner();
    expect(await q("select 1 from public.team_members where user_id = $1", [PAUL])).toHaveLength(0);
  });

  it("declining twice is a no-op success", async () => {
    const id = await invite(USEC, "paul.reinke@hillwood.com");
    await respond(PAUL, id, false);
    expect(await respond(PAUL, id, false)).toMatchObject({ ok: true, status: "declined" });
  });
});

describe("another user cannot read or answer someone else's invitation", () => {
  it("answers not_found and changes nothing — accept or decline", async () => {
    const id = await invite(USEC, "paul.reinke@hillwood.com", "admin");
    expect(await respond(EVE, id, true)).toEqual({ ok: false, reason: "not_found" });
    expect(await respond(EVE, id, false)).toEqual({ ok: false, reason: "not_found" });
    expect(await respond(CHRIS, id, true)).toEqual({ ok: false, reason: "not_found" }); // not even the inviter
    expect(await q("select 1 from public.team_members where user_id = $1", [EVE])).toHaveLength(0);
    const [row] = await q("select claimed_at, declined_at from public.team_invites where id = $1", [id]);
    expect(row).toEqual({ claimed_at: null, declined_at: null });
    expect(await myInvites(EVE)).toHaveLength(0);
  });

  it("a random invite id and a signed-out caller are refused too", async () => {
    expect(await respond(PAUL, "00000000-0000-0000-0000-00000000dead", true)).toEqual({ ok: false, reason: "not_found" });
    expect(await respond(null, "00000000-0000-0000-0000-00000000dead", true)).toEqual({ ok: false, reason: "not_signed_in" });
  });
});

describe("a brand-new signup still lands on the team with no extra clicks", () => {
  it("the signup trigger auto-claims invites for the new address (decision: keep auto-claim AT SIGNUP)", async () => {
    await invite(USEC, "newhire@hillwood.com", "member");
    const NEW = "00000000-0000-0000-0000-00000000f001";
    await db.query("insert into auth.users (id, email) values ($1, 'NewHire@Hillwood.com')", [NEW]);
    expect(await q("select team_id, role from public.team_members where user_id = $1", [NEW])).toEqual([{ team_id: USEC, role: "member" }]);
    expect(await rpc(NEW, "select * from public.list_my_invites()")).toHaveLength(0);
  });
});

describe("the client no longer silently joins people on every load", () => {
  const app = readFileSync(join(ROOT, "src/workspaces/site-planner/SitePlannerApp.jsx"), "utf8");
  const teams = readFileSync(join(ROOT, "src/workspaces/site-planner/lib/teams.js"), "utf8");
  it("applyUser does not call claim-all, and lib/teams.js no longer exports it", () => {
    expect(app).not.toMatch(/claimInvites\s*\(/);
    expect(teams).not.toMatch(/export (async )?function claimInvites/);
    expect(teams).not.toMatch(/rpc\(\s*["']claim_team_invites["']/);
  });
  it("accepting fires the teams-changed signal and the planner listens for it", () => {
    const store = readFileSync(join(ROOT, "src/app/teamInvites.js"), "utf8");
    expect(store).toMatch(/TEAMS_CHANGED_EVENT/);
    expect(app).toMatch(/addEventListener\(TEAMS_CHANGED_EVENT/);
  });
});
