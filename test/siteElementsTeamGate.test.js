/* Site-sharing RLS gate — the reported failure mode: a site's team_id never (or no longer) grants
 * a shared teammate any real access. B714 (2026-07-08) fixed the write path (team_id is
 * write-isolated to the explicit set_project_team() RPC — see teamShareGuard.test.js) and proved the
 * READ side live against production (a duplicate report investigated 2026-08-23: current prod data
 * for the cited site was clean, and a self-rolling-back RLS impersonation of the real collaborator
 * account passed select/insert/update on both `sites` and `site_elements`).
 *
 * That live proof cannot run in CI (no DB here). This is the CI-runnable backstop: it parses the
 * real db/team_share_default.sql and asserts every site_elements policy — and the sites policies
 * that gate write access — actually branch on `team_id is not null` + `is_team_member`/
 * `is_team_admin`. If a future edit ever drops that branch (the exact shape of this report), this
 * test fails on the PR instead of shipping a silent lockout. No DB needed: source guard only. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(new URL("../src/workspaces/site-planner/db/team_share_default.sql", import.meta.url)),
  "utf8",
);

function policyBody(name) {
  const m = sql.match(new RegExp(`create policy "${name}" on public\\.\\w+[\\s\\S]*?;`, "i"));
  return m ? m[0] : null;
}

const TEAM_GATE = /team_id\s+is\s+not\s+null/i;
const MEMBER = /is_team_member\(\s*(?:s\.)?team_id\s*\)/i;
const ADMIN = /is_team_admin\(\s*(?:s\.)?team_id\s*\)/i;

describe("site_elements RLS is gated on the parent site's team_id", () => {
  it.each([
    ["select elements via parent site", MEMBER],
    ["insert elements via parent site", MEMBER],
    ["update elements via parent site", MEMBER],
    ["purge elements owner or team-admin", ADMIN],
  ])("%s references team_id + the membership check", (name, membershipRe) => {
    const body = policyBody(name);
    expect(body, `missing policy "${name}" on site_elements`).toBeTruthy();
    expect(body).toMatch(TEAM_GATE);
    expect(body).toMatch(membershipRe);
  });

  it("insert/update also require the site not be share_locked", () => {
    for (const name of ["insert elements via parent site", "update elements via parent site"]) {
      const body = policyBody(name);
      expect(body).toMatch(/not\s+s\.share_locked/i);
    }
  });
});

describe("sites RLS: the same team_id + membership gate on write access", () => {
  it("update own or team sites", () => {
    const body = policyBody("update own or team sites");
    expect(body, "missing 'update own or team sites' policy").toBeTruthy();
    expect(body).toMatch(TEAM_GATE);
    expect(body).toMatch(/is_team_member\(\s*team_id\s*\)/i);
  });

  it("delete own or team-admin sites", () => {
    const body = policyBody("delete own or team-admin sites");
    expect(body, "missing 'delete own or team-admin sites' policy").toBeTruthy();
    expect(body).toMatch(TEAM_GATE);
    expect(body).toMatch(/is_team_admin\(\s*team_id\s*\)/i);
  });
});

describe("team_id may only change through the explicit share RPC", () => {
  it("guard_team_share refuses an ordinary team_id change (deny-by-default)", () => {
    expect(sql).toMatch(/if\s+new\.team_id\s+is\s+distinct\s+from\s+old\.team_id\s+then/i);
    expect(sql).toMatch(/current_setting\('planyr\.share_intent',\s*true\)/i);
  });

  it("set_project_team is the only function that sets the share_intent flag", () => {
    const setters = sql.match(/set_config\('planyr\.share_intent'/gi) || [];
    // Exactly two calls: arm it ('1') then disarm it ('0'), both inside set_project_team.
    expect(setters.length).toBe(2);
    const fnBody = sql.match(/create or replace function public\.set_project_team[\s\S]*?\$\$;/i);
    expect(fnBody, "missing set_project_team function").toBeTruthy();
    expect(fnBody[0]).toMatch(/set_config\('planyr\.share_intent',\s*'1'/i);
  });
});
