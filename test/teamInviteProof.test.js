/* NEW-1 (2026-11-02) — TEAM INVITE MUST PROVE THE MAILBOX, run against a REAL Postgres (PGlite) with the shipped
 * `.sql` files verbatim, in production order: profiles → teams → team_invite_guard → team_invite_inbox →
 * team_invite_email → team_invite_link → team_invite_proof.
 *
 * THE HOLE (read from the live definitions, project lyeqzkuiwngunutlkkmi, 2026-11-02): `mailer_autoconfirm` is
 * ON, so nobody proves they own the address they sign up with — yet FIVE doors treated "the account's address
 * matches an open team_invites row" as proof of the mailbox:
 *   1. handle_new_user()           — added a brand-new account to every team that had invited that address;
 *   2. claim_team_invites()        — the same, for an existing account, on demand;
 *   3. the "self join via invite" team_members INSERT policy — a raw client insert by address match;
 *   4. the "invitee reads own" team_invites SELECT policy — read the invite row (its id, team, role);
 *   5. list_my_invites() / respond_to_invite() — listed and answered by address match.
 * A stranger who knows or guesses an invited address could sign up with it and be on the team.
 *
 * THE RULE THESE TESTS PIN: the emailed LINK (the invite row's own random uuid) is the proof. Nobody joins by
 * address match alone; a mailbox is "proven" only through `mailbox_proofs`, which a client can neither read nor
 * write. Red test first: `a sign-up with an invited address joins nothing` fails on `main`.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB = join(ROOT, "src/workspaces/site-planner/db");
const read = (f) => readFileSync(join(DB, f), "utf8");

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
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$;
`;

const CHRIS = "00000000-0000-0000-0000-00000000c001"; // inviter, USEC admin
const PAUL = "00000000-0000-0000-0000-00000000a001";  // existing account, invited afterwards
const EVE = "00000000-0000-0000-0000-00000000e001";   // a stranger
const NEWBIE = "00000000-0000-0000-0000-00000000b001"; // signs up AFTER being invited
const USEC = "00000000-0000-0000-0000-0000000005ec";
const OTHER = "00000000-0000-0000-0000-0000000005ed";

let db;
const as = async (uid, role = "authenticated") => { await db.exec(`reset role; select set_config('test.uid', '${uid || ""}', false); set role ${role};`); };
const asOwner = () => db.exec("reset role; select set_config('test.uid', '', false);");
const rpc = async (uid, sql, params = []) => { await as(uid); try { return (await db.query(sql, params)).rows; } finally { await asOwner(); } };
const svc = async (sql, params = []) => { await as(null, "service_role"); try { return (await db.query(sql, params)).rows; } finally { await asOwner(); } };
const q = async (sql, params) => (await db.query(sql, params)).rows;
const myInvites = (uid) => rpc(uid, "select * from public.list_my_invites()");
const respond = async (uid, invite, accept) => (await rpc(uid, "select public.respond_to_invite($1, $2) as r", [invite, accept]))[0].r;
const redeem = async (uid, invite, accept = true) => (await rpc(uid, "select public.redeem_invite_link($1, $2) as r", [invite, accept]))[0].r;
const proven = async (uid) => (await q("select public.mailbox_is_proven($1) as p", [uid]))[0].p;
const members = (uid) => q("select team_id, role from public.team_members where user_id = $1 order by team_id", [uid]);
const invite = async (team, email, role = "member") =>
  (await q("insert into public.team_invites (team_id, email, role, invited_by) values ($1, $2, $3, $4) returning id", [team, email, role, CHRIS]))[0].id;
const signUp = (id, email) => db.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);

async function fresh() {
  const d = new PGlite();
  await d.exec(SHIM);
  for (const f of ["profiles.sql", "teams.sql", "team_invite_guard.sql", "team_invite_inbox.sql", "team_invite_email.sql", "team_invite_link.sql"]) await d.exec(read(f));
  // Supabase grants every NEW public table to anon/authenticated/service_role by default; the proof file must revoke
  // what it does not want. Reproduce that default BEFORE it runs, so a missing revoke shows up here.
  await d.exec("grant usage on schema public, auth to authenticated, anon, service_role; grant all on all tables in schema public to authenticated, service_role; grant select on auth.users to authenticated, service_role;");
  await d.exec("alter default privileges in schema public grant all on tables to anon, authenticated, service_role; alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;");
  await d.exec(read("team_invite_proof.sql"));
  await d.exec("grant all on public.mailbox_proofs, public.invite_signup_attempts to service_role;"); // the server role writes these through its functions; harmless to the client checks
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

describe("RED FIRST — the address alone never puts anyone on a team", () => {
  it("a sign-up with an invited address joins nothing (and the invite stays open)", async () => {
    const id = await invite(USEC, "newhire@hillwood.com", "admin");
    await signUp(NEWBIE, "NewHire@Hillwood.com");
    expect(await members(NEWBIE)).toEqual([]);
    const [row] = await q("select claimed_at, declined_at from public.team_invites where id = $1", [id]);
    expect(row).toEqual({ claimed_at: null, declined_at: null });
    // the profile is still made — only the team join went away
    expect(await q("select email from public.profiles where id = $1", [NEWBIE])).toEqual([{ email: "newhire@hillwood.com" }]);
  });

  it("claim_team_invites() adds no one (it is a no-op that keeps old clients working)", async () => {
    await invite(USEC, "paul.reinke@hillwood.com");
    expect((await rpc(PAUL, "select public.claim_team_invites() as n"))[0].n).toBe(0);
    expect(await members(PAUL)).toEqual([]);
  });

  it("a raw client INSERT into team_members by address match is refused by RLS", async () => {
    await invite(USEC, "paul.reinke@hillwood.com", "member");
    await as(PAUL);
    await expect(db.query("insert into public.team_members (team_id, user_id, role) values ($1, $2, 'member')", [USEC, PAUL])).rejects.toThrow(/row-level security/i);
    await asOwner();
    expect(await members(PAUL)).toEqual([]);
  });

  it("an address-only account cannot READ the invite row (its id is the bearer secret)", async () => {
    await invite(USEC, "paul.reinke@hillwood.com");
    expect(await rpc(PAUL, "select * from public.team_invites")).toEqual([]);
    expect(await rpc(PAUL, "select id from public.team_invites where lower(email) = lower(auth.email())")).toEqual([]);
  });

  it("the team's admin still sees the invite, and an admin may still add a member directly", async () => {
    await invite(USEC, "paul.reinke@hillwood.com");
    expect(await rpc(CHRIS, "select email from public.team_invites where team_id = $1", [USEC])).toHaveLength(1);
    await as(CHRIS);
    await db.query("insert into public.team_members (team_id, user_id, role) values ($1, $2, 'member')", [USEC, EVE]);
    await asOwner();
    expect(await members(EVE)).toEqual([{ team_id: USEC, role: "member" }]);
  });
});

describe("the migration is sufficient on its own (production still has the OLD definitions until it runs)", () => {
  it("applied over the pre-fix handle_new_user / claim_team_invites / policies, a sign-up still joins nothing", async () => {
    // Re-create the three LIVE (pre-fix) definitions exactly as read from production on 2026-11-02, then run the migration again.
    await db.exec(`
      create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
      begin
        insert into public.profiles (id, first_name, last_name, org, email) values (new.id, null, null, null, lower(new.email)) on conflict (id) do update set email = excluded.email;
        insert into public.team_members (team_id, user_id, role, added_by)
          select i.team_id, new.id, i.role, i.invited_by from public.team_invites i
          where lower(i.email) = lower(new.email) and i.claimed_at is null on conflict (team_id, user_id) do nothing;
        update public.team_invites set claimed_at = now() where lower(email) = lower(new.email) and claimed_at is null;
        return new;
      end; $$;
      create policy "self join via invite" on public.team_members for insert to authenticated with check (
        user_id = (select auth.uid()) and exists (select 1 from public.team_invites i where i.team_id = team_members.team_id and lower(i.email) = lower((select auth.email())) and i.claimed_at is null and i.role = team_members.role));
      create policy "invitee reads own" on public.team_invites for select to authenticated using (lower(email) = lower(auth.email()));
    `);
    await invite(USEC, "newhire@hillwood.com");
    await signUp(NEWBIE, "newhire@hillwood.com");
    expect(await members(NEWBIE)).toHaveLength(1); // proves the fixture really is the vulnerable definition…
    await db.query("delete from public.team_members where user_id = $1", [NEWBIE]);
    await db.query("update public.team_invites set claimed_at = null");
    await db.query("delete from auth.users where id = $1", [NEWBIE]);
    await db.exec(read("team_invite_proof.sql")); // …and that the migration alone closes it
    await signUp(NEWBIE, "newhire@hillwood.com");
    expect(await members(NEWBIE)).toEqual([]);
    const pol = await q("select policyname from pg_policies where schemaname='public' and tablename in ('team_members','team_invites') and policyname in ('self join via invite','invitee reads own')");
    expect(pol).toEqual([]);
  });
});

describe("an unproven account — what it can and cannot see or do", () => {
  it("is told an invitation is waiting, and NOTHING that identifies it (no id, no team, no inviter, no role)", async () => {
    await invite(USEC, "paul.reinke@hillwood.com", "admin");
    const rows = await myInvites(PAUL);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ proven: false, invite_id: null, team_id: null, team_name: null, role: null, invited_by_name: null });
    expect(JSON.stringify(rows)).not.toMatch(/USEC|Chris|Seward/);
  });

  it("cannot accept or decline — by id, since the id is unobtainable, and the call answers 'unproven'", async () => {
    const id = await invite(USEC, "paul.reinke@hillwood.com");
    expect(await respond(PAUL, id, true)).toEqual({ ok: false, reason: "unproven" });
    expect(await respond(PAUL, id, false)).toEqual({ ok: false, reason: "unproven" });
    expect(await members(PAUL)).toEqual([]);
    const [row] = await q("select claimed_at, declined_at from public.team_invites where id = $1", [id]);
    expect(row).toEqual({ claimed_at: null, declined_at: null }); // a squatter cannot even kill the real invitee's invite
  });

  it("a stranger and a signed-out caller get nothing", async () => {
    const id = await invite(USEC, "paul.reinke@hillwood.com");
    expect(await myInvites(EVE)).toEqual([]);
    expect(await myInvites(null)).toEqual([]);
    expect(await respond(EVE, id, true)).toEqual({ ok: false, reason: "not_found" });
    expect(await redeem(EVE, id)).toMatchObject({ ok: false, reason: "wrong_account" });
    expect(await members(EVE)).toEqual([]);
    expect(await proven(EVE)).toBe(false);
  });
});

describe("redeem_invite_link — the emailed link IS the proof", () => {
  it("signed in as the invited address: proves the mailbox, joins at the invited role, stamps THAT invite", async () => {
    const usec = await invite(USEC, "paul.reinke@hillwood.com", "admin");
    const other = await invite(OTHER, "paul.reinke@hillwood.com", "member");
    expect(await redeem(PAUL, usec)).toMatchObject({ ok: true, status: "accepted", team_id: USEC, team_name: "USEC", role: "admin" });
    expect(await members(PAUL)).toEqual([{ team_id: USEC, role: "admin" }]);
    expect(await proven(PAUL)).toBe(true);
    const inv = await q("select id, claimed_at from public.team_invites where id in ($1,$2)", [usec, other]);
    expect(inv.find((r) => r.id === usec).claimed_at).not.toBeNull();
    expect(inv.find((r) => r.id === other).claimed_at).toBeNull(); // per-invite, never claim-all
  });

  it("after the link, the SAME account sees its other invitations in full and Accept works from the menu", async () => {
    const usec = await invite(USEC, "paul.reinke@hillwood.com");
    const other = await invite(OTHER, "paul.reinke@hillwood.com");
    await redeem(PAUL, usec);
    const rows = await myInvites(PAUL);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ proven: true, invite_id: other, team_name: "Other Co", invited_by_name: "Chris Seward" });
    expect(await respond(PAUL, other, true)).toMatchObject({ ok: true, status: "accepted", team_id: OTHER });
  });

  it("signed in as a DIFFERENT address: refuses with wrong_account, joins nobody, proves nothing", async () => {
    const id = await invite(USEC, "paul.reinke@hillwood.com");
    expect(await redeem(EVE, id)).toMatchObject({ ok: false, reason: "wrong_account" });
    expect(await members(EVE)).toEqual([]);
    expect(await proven(EVE)).toBe(false);
    const [row] = await q("select claimed_at from public.team_invites where id = $1", [id]);
    expect(row.claimed_at).toBeNull();
  });

  it("a double tap is a success, not a second row; a member removed later reads 'claimed', not a silent join", async () => {
    const id = await invite(USEC, "paul.reinke@hillwood.com");
    await redeem(PAUL, id);
    expect(await redeem(PAUL, id)).toMatchObject({ ok: true, status: "accepted", already_member: true });
    expect(await q("select 1 from public.team_members where user_id = $1", [PAUL])).toHaveLength(1);
    await db.query("delete from public.team_members where user_id = $1", [PAUL]);
    expect(await redeem(PAUL, id)).toMatchObject({ ok: false, reason: "claimed" });
    expect(await members(PAUL)).toEqual([]);
  });

  it("declined, unknown and signed-out all get a named reason", async () => {
    const id = await invite(USEC, "paul.reinke@hillwood.com");
    expect(await redeem(PAUL, id, false)).toMatchObject({ ok: true, status: "declined" });
    expect(await proven(PAUL)).toBe(true); // holding the link proved the mailbox even though the answer was No
    expect(await redeem(PAUL, id, true)).toMatchObject({ ok: false, reason: "declined" });
    expect(await redeem(PAUL, "00000000-0000-0000-0000-00000000dead")).toMatchObject({ ok: false, reason: "not_found" });
    expect(await redeem(null, id)).toMatchObject({ ok: false, reason: "not_signed_in" });
  });

  it("anon cannot call it; the invite id is a random uuid", async () => {
    const [{ ok }] = await q("select has_function_privilege('anon', 'public.redeem_invite_link(uuid, boolean)', 'execute') as ok");
    expect(ok).toBe(false);
    const id = await invite(USEC, "x@y.com");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); // v4 = 122 random bits
    const [{ def }] = await q("select column_default as def from information_schema.columns where table_name='team_invites' and column_name='id'");
    expect(def).toMatch(/gen_random_uuid/);
  });
});

describe("the proof marker — only the server writes it, it belongs to ONE address", () => {
  it("a client can neither read nor write mailbox_proofs, nor call prove_mailbox / mailbox_is_proven", async () => {
    await as(PAUL);
    await expect(db.query("select * from public.mailbox_proofs")).rejects.toThrow();
    await expect(db.query("insert into public.mailbox_proofs (user_id, email, via) values ($1, 'paul.reinke@hillwood.com', 'x')", [PAUL])).rejects.toThrow();
    await expect(db.query("select public.prove_mailbox($1, 'paul.reinke@hillwood.com', 'x')", [PAUL])).rejects.toThrow();
    await expect(db.query("select public.mailbox_is_proven($1)", [PAUL])).rejects.toThrow();
    await asOwner();
    expect(await proven(PAUL)).toBe(false);
  });

  it("the server-side hook (prove_mailbox, service role) is what a Planyr emailed link calls — and it checks the address", async () => {
    expect((await svc("select public.prove_mailbox($1, 'someone.else@x.com', 'emailed_link') as r", [PAUL]))[0].r).toMatchObject({ ok: false });
    expect(await proven(PAUL)).toBe(false);
    expect((await svc("select public.prove_mailbox($1, ' Paul.Reinke@hillwood.com ', 'emailed_link') as r", [PAUL]))[0].r).toMatchObject({ ok: true });
    expect(await proven(PAUL)).toBe(true);
    // the menu now speaks in full: a proven account just Accepts
    const id = await invite(USEC, "paul.reinke@hillwood.com");
    expect((await myInvites(PAUL))[0]).toMatchObject({ proven: true, team_name: "USEC", invite_id: id });
    expect(await respond(PAUL, id, true)).toMatchObject({ ok: true, status: "accepted" });
  });

  it("a proof belongs to the address it was given for: change the address and it no longer counts", async () => {
    await svc("select public.prove_mailbox($1, 'paul.reinke@hillwood.com', 'emailed_link')", [PAUL]);
    expect(await proven(PAUL)).toBe(true);
    await db.query("update auth.users set email = 'paul@newjob.com' where id = $1", [PAUL]);
    expect(await proven(PAUL)).toBe(false);
  });
});

describe("resend — an unproven account can have the invite emailed again, server-throttled, ids never reach the browser", () => {
  it("claim_invite_resend_for is service-role only (an authenticated browser call would leak the invite id)", async () => {
    for (const fn of ["public.claim_invite_resend_for(uuid)", "public.release_invite_resend(uuid, timestamptz)", "public.invite_signup_begin(uuid)", "public.invite_signup_finish(uuid, uuid)"]) {
      const [{ a, b, c }] = await q(`select has_function_privilege('authenticated', '${fn}', 'execute') as a, has_function_privilege('anon', '${fn}', 'execute') as b, has_function_privilege('service_role', '${fn}', 'execute') as c`);
      expect({ fn, a, b, c }).toEqual({ fn, a: false, b: false, c: true });
    }
  });

  it("first call returns what the email needs and stamps last_sent_at; a second inside the window is throttled", async () => {
    const id = await invite(USEC, "paul.reinke@hillwood.com", "admin");
    const first = (await svc("select public.claim_invite_resend_for($1) as r", [PAUL]))[0].r;
    expect(first).toMatchObject({ ok: true, email: "paul.reinke@hillwood.com" });
    expect(first.items).toEqual([expect.objectContaining({ invite_id: id, team_name: "USEC", inviter_name: "Chris Seward", role: "admin", has_account: true })]);
    const again = (await svc("select public.claim_invite_resend_for($1) as r", [PAUL]))[0].r;
    expect(again).toMatchObject({ ok: false, reason: "throttled" });
    expect(again.retry_after_seconds).toBeGreaterThan(0);
    // provider failed → the slot is handed back
    await svc("select public.release_invite_resend($1, null)", [id]);
    expect((await svc("select public.claim_invite_resend_for($1) as r", [PAUL]))[0].r).toMatchObject({ ok: true });
  });

  it("only OPEN invites for THIS account's own address; none → no_invites", async () => {
    const id = await invite(USEC, "paul.reinke@hillwood.com");
    await invite(OTHER, "eve@example.com");
    await redeem(PAUL, id, false); // declined
    expect((await svc("select public.claim_invite_resend_for($1) as r", [PAUL]))[0].r).toMatchObject({ ok: false, reason: "no_invites" });
    expect((await svc("select public.claim_invite_resend_for($1) as r", [EVE]))[0].r.items).toHaveLength(1);
  });
});

describe("link sign-up (server route, no Turnstile) — begin / finish", () => {
  it("begin: an open invite with no account yet answers the address; the account is then created and finish proves + joins", async () => {
    const id = await invite(USEC, "newhire@hillwood.com", "member");
    const b = (await svc("select public.invite_signup_begin($1) as r", [id]))[0].r;
    expect(b).toMatchObject({ ok: true, email: "newhire@hillwood.com" });
    await signUp(NEWBIE, "newhire@hillwood.com"); // what the admin-API createUser does
    expect(await members(NEWBIE)).toEqual([]);     // the trigger joined nothing
    const f = (await svc("select public.invite_signup_finish($1, $2) as r", [id, NEWBIE]))[0].r;
    expect(f).toMatchObject({ ok: true, status: "accepted", team_id: USEC });
    expect(await members(NEWBIE)).toEqual([{ team_id: USEC, role: "member" }]);
    expect(await proven(NEWBIE)).toBe(true);
  });

  it("begin refuses when the address already has an account (sign in instead), a used / declined / unknown invite, and past the cap", async () => {
    const a = await invite(USEC, "paul.reinke@hillwood.com");
    expect((await svc("select public.invite_signup_begin($1) as r", [a]))[0].r).toMatchObject({ ok: false, reason: "has_account" });
    const used = await invite(OTHER, "newhire@hillwood.com");
    await db.query("update public.team_invites set claimed_at = now() where id = $1", [used]);
    expect((await svc("select public.invite_signup_begin($1) as r", [used]))[0].r).toMatchObject({ ok: false, reason: "not_open" });
    expect((await svc("select public.invite_signup_begin($1) as r", ["00000000-0000-0000-0000-00000000dead"]))[0].r).toMatchObject({ ok: false, reason: "not_found" });
    const capped = await invite(USEC, "capped@hillwood.com");
    let last;
    for (let i = 0; i < 12; i++) last = (await svc("select public.invite_signup_begin($1) as r", [capped]))[0].r;
    expect(last).toMatchObject({ ok: false, reason: "too_many" });
  });

  it("finish refuses a user whose address is not the invite's (no joining the wrong account)", async () => {
    const id = await invite(USEC, "newhire@hillwood.com");
    expect((await svc("select public.invite_signup_finish($1, $2) as r", [id, EVE]))[0].r).toMatchObject({ ok: false, reason: "wrong_account" });
    expect(await members(EVE)).toEqual([]);
    expect(await proven(EVE)).toBe(false);
  });
});

describe("the audit query is read-only and counts address-match joins", () => {
  it("counts members whose claimed invite was never emailed (last_sent_at null) — counts only, no addresses", async () => {
    const sent = await invite(USEC, "paul.reinke@hillwood.com");
    await db.query("update public.team_invites set last_sent_at = now() where id = $1", [sent]);
    await redeem(PAUL, sent);
    const silent = await invite(OTHER, "eve@example.com");
    await db.query("insert into public.team_members (team_id, user_id, role) values ($1, $2, 'member')", [OTHER, EVE]);
    await db.query("update public.team_invites set claimed_at = now() where id = $1", [silent]);
    const sql = read("team_invite_proof_audit.sql");
    expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter|create)\b/i);
    const rows = (await db.query(sql)).rows;
    const out = rows.find((r) => r.metric === "claimed_never_emailed");
    expect(Number(out.n)).toBe(1);
    expect(JSON.stringify(rows)).not.toMatch(/@/);
  });
});
