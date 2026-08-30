/* B859504 (amendment, NEW-1) — the Sites panel's shared-with monogram showed the
 * VIEWER's own initials, not a collaborator's. Owner, measured live on production (build
 * SitePlannerApp-Br0mBNgI.js, all 28 signed-in sites): exactly 7 monogram rows rendered, and every
 * single one read "MB" (Michael Butler — the signed-in viewer). `listMembers()` returns a team's
 * WHOLE roster, viewer included, and `siteRow` rendered `members[0]`'s initials unconditionally —
 * he is the creator/admin of every team he shares to, so the roster's first entry was almost always
 * him. `sharedWithDisplay` (lib/sharedWithMonogram.js) is the pure fix: exclude the viewer from the
 * candidate list before picking who to show initials for.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sharedWithDisplay } from "../src/workspaces/site-planner/lib/sharedWithMonogram.js";

const here = dirname(fileURLToPath(import.meta.url));
const finder = readFileSync(resolve(here, "../src/workspaces/site-planner/MapFinder.jsx"), "utf8");

const ME = "mb-uid";
const member = (userId, displayName) => ({ userId, firstName: null, lastName: null, displayName, email: null });

describe("B859504 (amendment) · sharedWithDisplay excludes the viewer from the shared-with monogram", () => {
  it("the reported production case: viewer + 2 others → the FIRST OTHER's initials, +1, never the viewer's", () => {
    const roster = [member(ME, "Michael Butler"), member("jb-uid", "Jordan Baker"), member("cc-uid", "Casey Chen")];
    const d = sharedWithDisplay(roster, ME);
    expect(d.kind).toBe("monogram");
    expect(d.first.userId).toBe("jb-uid");
    expect(d.extra).toBe(1); // Casey, beyond Jordan
    expect(d.others.map((m) => m.userId)).toEqual(["jb-uid", "cc-uid"]);
  });

  it("exactly one other person → that person's initials alone, no +N", () => {
    const roster = [member(ME, "Michael Butler"), member("jb-uid", "Jordan Baker")];
    const d = sharedWithDisplay(roster, ME);
    expect(d.kind).toBe("monogram");
    expect(d.first.userId).toBe("jb-uid");
    expect(d.extra).toBe(0);
  });

  it("nobody but the viewer on the roster → no indicator at all", () => {
    const roster = [member(ME, "Michael Butler")];
    expect(sharedWithDisplay(roster, ME)).toEqual({ kind: "none" });
  });

  it("roster not yet fetched (null) or fetch failed (empty array) → unknown, never misread as 'nobody'", () => {
    expect(sharedWithDisplay(null, ME)).toEqual({ kind: "unknown" });
    expect(sharedWithDisplay([], ME)).toEqual({ kind: "unknown" });
  });

  it("signed out (no viewer id) → the whole roster counts as 'others', nobody is excluded", () => {
    const roster = [member("jb-uid", "Jordan Baker"), member("cc-uid", "Casey Chen")];
    const d = sharedWithDisplay(roster, null);
    expect(d.kind).toBe("monogram");
    expect(d.others.length).toBe(2);
  });

  it("a site shared with a team the viewer isn't a member of: viewer id matches nobody, roster passes through", () => {
    const roster = [member("jb-uid", "Jordan Baker"), member("cc-uid", "Casey Chen")];
    const d = sharedWithDisplay(roster, "someone-else-entirely");
    expect(d.kind).toBe("monogram");
    expect(d.others.length).toBe(2);
  });

  it("a collaborator with no real name still gets a non-blank monogram (listMembers' own 'Teammate' fallback)", () => {
    const roster = [member(ME, "Michael Butler"), member("ghost-uid", "Teammate")];
    const d = sharedWithDisplay(roster, ME);
    expect(d.kind).toBe("monogram");
    expect(d.first.displayName).toBe("Teammate");
  });
});

describe("B859504 (amendment) · MapFinder wires the fix in, not the pre-fix `members[0]` shape", () => {
  it("imports sharedWithDisplay from the pure module", () => {
    expect(finder).toMatch(/import\s*\{\s*sharedWithDisplay\s*\}\s*from\s*"\.\/lib\/sharedWithMonogram\.js"/);
  });

  it("the monogram block calls sharedWithDisplay(members, myUid), not members[0] directly", () => {
    const block = finder.slice(finder.indexOf("s.teamId && (() => {", finder.indexOf("initials monogram(s)")), finder.indexOf("})()}", finder.indexOf("initials monogram(s)")));
    expect(block).toMatch(/sharedWithDisplay\(members,\s*myUid\)/);
    expect(block).not.toMatch(/members\[0\]/);
    expect(block).not.toMatch(/members\.length \? \(/); // the old unconditional-first-member shape
  });

  it("renders nothing (returns null) when nobody but the viewer shares the site", () => {
    const block = finder.slice(finder.indexOf("s.teamId && (() => {", finder.indexOf("initials monogram(s)")), finder.indexOf("})()}", finder.indexOf("initials monogram(s)")));
    expect(block).toMatch(/disp\.kind === "none"\) return null/);
  });
});
