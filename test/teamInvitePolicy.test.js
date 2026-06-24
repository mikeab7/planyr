/* Team-join RLS guard — a signed-in user must NOT be able to add themselves to an arbitrary
 * team. The team_members INSERT policy must require a matching unclaimed invite (verified email +
 * same role), never the bare "are you adding yourself?" check that allowed self-join to any team
 * at any role. No DB needed: this parses the real db/teams.sql so a future edit that re-introduces
 * the over-broad policy fails here instead of shipping. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(new URL("../src/workspaces/site-planner/db/teams.sql", import.meta.url)),
  "utf8",
);

// The body of the WITH CHECK for the team_members self-insert policy.
const selfInsert = sql.match(/create policy "self join via invite" on public\.team_members[\s\S]*?\);/i);

describe("team_members self-insert RLS is invite-gated", () => {
  it("the over-broad 'self add via claim' policy is gone", () => {
    expect(sql).not.toMatch(/create policy "self add via claim"/i);
  });

  it("a 'self join via invite' policy exists", () => {
    expect(selfInsert, "missing 'self join via invite' policy on team_members").toBeTruthy();
  });

  it("the self-insert check requires a matching unclaimed invite at the same role", () => {
    const body = selfInsert[0];
    expect(body).toMatch(/user_id\s*=\s*\(select auth\.uid\(\)\)/i); // it IS you
    expect(body).toMatch(/from public\.team_invites/i);             // gated on an invite
    expect(body).toMatch(/claimed_at is null/i);                    // an OPEN invite
    expect(body).toMatch(/lower\(\s*i\.email\s*\)\s*=\s*lower\(\s*\(select auth\.email\(\)\)/i); // your verified email
    expect(body).toMatch(/i\.role\s*=\s*team_members\.role/i);      // no role escalation
  });

  it("no team_members INSERT policy passes on user_id alone (no invite check)", () => {
    // Any insert policy whose WITH CHECK is only the self-identity test is the vulnerability.
    const bareSelf = /for insert[\s\S]{0,80}with check \(\s*user_id\s*=\s*\(select auth\.uid\(\)\)\s*\)/i;
    expect(sql).not.toMatch(bareSelf);
  });
});
