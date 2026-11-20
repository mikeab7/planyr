/* Team-join RLS guard — a signed-in user must NOT be able to add themselves to a team by ADDRESS MATCH.
 * History: first the bare "self add via claim" (user_id = auth.uid() only — join ANY team), then "self join via
 * invite" (an unclaimed invite for the caller's address). NEW-1 (2026-11-02) removes the second too: with email
 * confirmation OFF the address is not proof of the mailbox, so a stranger could sign up with an invited address
 * and insert themselves. The only joins now are the SECURITY DEFINER functions redeem_invite_link /
 * respond_to_invite (db/team_invite_proof.sql), which need the emailed link or a proven mailbox. No DB needed:
 * this parses the real SQL files so a future edit that re-introduces an address-match door fails here (the
 * behavioural proof is test/teamInviteProof.test.js, against a real Postgres). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DBDIR = "../src/workspaces/site-planner/db/";
const read = (f) => readFileSync(fileURLToPath(new URL(DBDIR + f, import.meta.url)), "utf8");
const stripComments = (t) => t.replace(/--.*$/gm, "");
const FILES = ["teams.sql", "team_invite_guard.sql", "team_invite_inbox.sql", "team_invite_proof.sql"];

describe("no address-match door into team_members / team_invites", () => {
  it("the over-broad 'self add via claim' policy is not created anywhere", () => {
    for (const f of FILES) expect(stripComments(read(f)), f).not.toMatch(/create policy "self add via claim"/i);
  });

  it("no file CREATES a 'self join via invite' or 'invitee reads own' policy (they are only ever dropped)", () => {
    for (const f of FILES) {
      const sql = stripComments(read(f));
      expect(sql, f).not.toMatch(/create policy "self join via invite"/i);
      expect(sql, f).not.toMatch(/create policy "invitee reads own"/i);
    }
  });

  it("the proof migration drops both, and no team_members INSERT policy passes on user_id alone", () => {
    const proof = stripComments(read("team_invite_proof.sql"));
    expect(proof).toMatch(/drop policy if exists "self join via invite"\s+on public\.team_members/i);
    expect(proof).toMatch(/drop policy if exists "invitee reads own"\s+on public\.team_invites/i);
    for (const f of FILES) expect(stripComments(read(f)), f).not.toMatch(/for insert[\s\S]{0,80}with check \(\s*user_id\s*=\s*\(select auth\.uid\(\)\)\s*\)/i);
  });

  it("handle_new_user and claim_team_invites insert into team_members NOWHERE in the shipped chain", () => {
    for (const f of ["teams.sql", "team_invite_inbox.sql", "team_invite_proof.sql"]) {
      const sql = stripComments(read(f));
      for (const fn of ["handle_new_user", "claim_team_invites"]) {
        const m = sql.match(new RegExp("create or replace function public\\." + fn + "\\(\\)[\\s\\S]*?\\n\\$\\$;", "i"));
        if (m) expect(m[0], `${f}: ${fn}`).not.toMatch(/insert into public\.team_members/i);
      }
    }
  });
});
