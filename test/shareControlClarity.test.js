/* NEW-2 — the right-click "Share with team" control didn't say what it shares.
 *
 * Owner's words: it is "not really clear that it's sharing anything." Before this, the menu named
 * WHO a project would be shared with (the team) but never WHAT (site plans only — Notes, Library,
 * Review and Schedule have no team column and are never touched, per B326416), and a clean
 * share/unshare closed the menu and said nothing else — the only evidence was the project row
 * eventually relabelling itself on the next render, with no visible link back to the click.
 *
 * The "shared state at a glance in the project list" half already existed (`siteRow`'s
 * `ShareGlyph` + "Shared with {team}" line, always rendered, never gated on hover/selection) —
 * this guards the two genuinely new halves: the scope statement shown before the click, and the
 * confirmation shown after a clean success.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const finder = readFileSync(resolve(here, "../src/workspaces/site-planner/MapFinder.jsx"), "utf8");

describe("NEW-2 · the share menu states scope, confirms outcome, and stays honest", () => {
  it("names WHAT is shared, before the team buttons, inside the share section", () => {
    const shareSection = finder.slice(finder.indexOf('{s.teamId ? "Sharing" : "Share with team"}'), finder.indexOf("myTeams.map((tm)"));
    expect(shareSection).toMatch(/site plans/i);
    // Truthful about scope (B326416): never claims the whole project, notes, library, review or
    // schedule move — those have no team column and are never touched.
    expect(shareSection).toMatch(/Notes, Library, Review and Schedule stay private/);
  });

  it("confirms a clean share with a visible after-state naming the team", () => {
    expect(finder).toMatch(/flashShareNotice\(teamId/);
    expect(finder).toMatch(/Shared .*site plans with \$\{teamName\(teamId\)\}/);
  });

  it("confirms a clean unshare too, not just a share", () => {
    expect(finder).toMatch(/is private again/);
  });

  it("never shows a stale error alongside a fresh confirmation, or vice versa", () => {
    // Both toasts share one bottom-left slot; doShare must clear the other before setting either.
    expect(finder).toMatch(/setShareNotice\(null\);.*never both stand/s);
    expect(finder).toMatch(/\{!err && shareNotice &&/);
  });

  it("the confirmation toast auto-dismisses (never sticks around forever)", () => {
    expect(finder).toMatch(/shareNoticeTimer\.current = setTimeout\(\(\) => setShareNotice\(null\), \d+\)/);
  });
});
