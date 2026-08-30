import { describe, it, expect } from "vitest";
import { sharedWithDisplay } from "../src/workspaces/site-planner/lib/sharedWithTeam.js";

/* B845088 (NEW-1) — owner override (live review, 2026-08-30): show the TEAM a site is shared
 * with, never the people in it. This retires the roster-monogram (B859504 + its same-day
 * amendment, formerly lib/sharedWithMonogram.js) — see this module's own header for the full
 * reasoning and for why no per-person branch is built (no such sharing mechanism exists in this
 * schema: `public.sites` carries only `team_id` + `share_locked`).
 */
describe("sharedWithDisplay (pure)", () => {
  it("no team → { kind: 'none' } (unchanged: an unshared site shows no indicator)", () => {
    expect(sharedWithDisplay(null, [{ id: "t1", name: "HIP Houston" }])).toEqual({ kind: "none" });
    expect(sharedWithDisplay(undefined, [])).toEqual({ kind: "none" });
  });

  it("teamId resolves against the viewer's own team list → the team's NAME, never a roster", () => {
    const myTeams = [{ id: "t1", name: "HIP Houston" }, { id: "t2", name: "Acme Devco" }];
    expect(sharedWithDisplay("t1", myTeams)).toEqual({ kind: "team", name: "HIP Houston" });
    expect(sharedWithDisplay("t2", myTeams)).toEqual({ kind: "team", name: "Acme Devco" });
  });

  it("a team with a blank/missing name still returns a non-blank name (never an empty chip)", () => {
    expect(sharedWithDisplay("t1", [{ id: "t1", name: "" }])).toEqual({ kind: "team", name: "Shared team" });
    expect(sharedWithDisplay("t1", [{ id: "t1" }])).toEqual({ kind: "team", name: "Shared team" });
  });

  it("teamId set but not on the viewer's own team list → 'unknown' (the caller falls back to the plain glyph, never a blank or a guessed name)", () => {
    expect(sharedWithDisplay("gone-team", [{ id: "t1", name: "HIP Houston" }])).toEqual({ kind: "unknown" });
  });

  it("teamId set, no team list at all (signed out, or the fetch hasn't resolved) → 'unknown', same as a team the viewer left", () => {
    expect(sharedWithDisplay("t1", [])).toEqual({ kind: "unknown" });
    expect(sharedWithDisplay("t1", null)).toEqual({ kind: "unknown" });
    expect(sharedWithDisplay("t1", undefined)).toEqual({ kind: "unknown" });
  });

  it("ignores malformed entries in the team list instead of throwing", () => {
    expect(sharedWithDisplay("t1", [null, undefined, { id: "t1", name: "HIP Houston" }])).toEqual({ kind: "team", name: "HIP Houston" });
  });
});

// ⛔ B845088 REGRESSION GUARD — MapFinder.jsx must actually call sharedWithDisplay(s.teamId,
// myTeams) rather than re-deriving the roster/monogram logic inline (the class of drift this
// whole item exists to close: the fix living in a pure module the render site doesn't call).
describe("MapFinder.jsx wires the team-chip display through sharedWithDisplay, not a roster read", () => {
  it("imports sharedWithDisplay from lib/sharedWithTeam.js and no longer imports lib/sharedWithMonogram.js or teams.listMembers", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/workspaces/site-planner/MapFinder.jsx", import.meta.url), "utf8");
    expect(src).toMatch(/sharedWithDisplay\(s\.teamId,\s*myTeams\)/);
    expect(src).not.toMatch(/sharedWithMonogram\.js/);
    expect(src).not.toMatch(/\blistMembers\b/);
    expect(src).not.toMatch(/\binitialsOf\b/);
  });
});
