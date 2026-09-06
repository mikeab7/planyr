/* NEW-1 — remove the project-privacy padlock from the breadcrumb (owner rule, his words: "Let's
 * get rid of the lock button next to project names, it's not relevant enough and it doesn't
 * work"). He sent an iPhone screenshot of the header: the padlock sat immediately left of the
 * project name in the breadcrumb ("[lock] Goose Creek"), on every module.
 *
 * WHAT IT WAS: `LockIcon`, rendered inside `ProjectBreadcrumb.jsx`'s project crumb whenever a
 * single project was current — a bare `<span title="Private: only you can see this
 * project...">`, never a `<button>` and never wired to an `onClick`. "Doesn't work" therefore
 * meant exactly that: it read as a tappable control (it sat beside two other tappable icons in
 * the same crumb) and was purely decorative, which on a touch device (no hover to reveal the
 * tooltip) meant tapping it did nothing at all.
 *
 * NOT TOUCHED, and enumerated here so a future sweep doesn't re-litigate this:
 *   - the Schedule grid's constrained-date padlock (`public/sequence/index.html`, pinned start /
 *     locked finish) — real, clickable (`onClick={unpin}`), load-bearing, a completely different file;
 *   - the Site Planner canvas's own per-object Lock/Unlock toggles for a parcel boundary, a
 *     markup, a measurement, a callout, and the element "Pin" (`SitePlanner.jsx`'s
 *     `toggleParcelLock`/`toggleMarkupLock`/`toggleMeasureLock`/`toggleCalloutLock`/`toggleLock`),
 *     each real and each per-object;
 *   - the plan-level "Lock to view-only for teammates" share-lock (`SitePlanner.jsx`'s
 *     `setPlanLock`/`planShareState`, `PadlockIcon` from `components/icons.jsx`) and the element
 *     type-menu's own Lock/Unlock row (`components/elementMenuIcons.jsx`'s `LockIcon`, imported as
 *     `MenuLockIcon`) — both real, both on a plan/element row, never the top breadcrumb;
 *   - a placed overlay's own Lock/Unlock ("prevent moving/resizing", owner-only) — `SitePlansSection.jsx`'s
 *     own `LockIcon`/`isOwner`/`onToggleLocked`.
 * None of those are this glyph, and none are touched by this fix.
 *
 * WHAT REMOVAL COSTS: this WAS the only surface in the top breadcrumb showing private-vs-shared
 * state for a PROJECT. It is not the only surface in the app — `MapFinder.jsx`'s site list
 * already renders a "shared with <team>" chip per project (`sharedWithTeam.sharedWithDisplay`,
 * fed by the real `sites.team_id` column `lib/sharing.js`'s `shareProject`/`makeProjectPrivate`
 * write) — so a project's sharing state is still visible elsewhere, just not in this crumb.
 *
 * Source-based (this component is deep in a shared shell file with no lightweight mount path in
 * this repo's test setup — see planMenuChrome.test.js / projectSwitcherChrome.test.js for the
 * same pattern on this exact file). Comments are stripped so a comment that MENTIONS the removed
 * markup (to warn the next reader off re-adding it) can't itself satisfy or trip a guard.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const code = (p) => readFileSync(resolve(here, p), "utf8")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const crumbPath = "../src/shared/ui/ProjectBreadcrumb.jsx";
const crumb = code(crumbPath);
const crumbRaw = readFileSync(resolve(here, crumbPath), "utf8");

describe("NEW-1 — the breadcrumb's project-privacy padlock is gone", () => {
  it("the LockIcon component no longer exists in this file", () => {
    // ⛔ MUTATION CHECK — this is the exact pre-fix shape (component + render site). If this ever
    // reads true again, the glyph is back.
    expect(crumb).not.toMatch(/const LockIcon = /);
  });

  it("the tooltip copy for the removed glyph is gone", () => {
    expect(crumb).not.toContain("Private: only you can see this project");
  });

  it("the project crumb renders no lock/padlock icon for a single current project", () => {
    // The button body between its opening tag and the name span — where the glyph used to sit.
    const btnOpen = crumbRaw.indexOf('data-testid="project-crumb"');
    const nameSpan = crumbRaw.indexOf('{cross ? "All projects"', btnOpen);
    const preName = crumbRaw.slice(btnOpen, nameSpan);
    expect(preName).not.toMatch(/currentProject && !cross && !org/);
    expect(preName).not.toContain("<LockIcon");
  });

  it("every OTHER lock/padlock icon in the app is untouched (enumerated, not guessed)", () => {
    // Schedule grid's constrained-date padlock (pinned start / locked finish) — real + clickable.
    const gantt = readFileSync(resolve(here, "../public/sequence/index.html"), "utf8");
    expect(gantt).toContain('onClick={unpin}');
    expect(gantt).toMatch(/rect x="3" y="11" width="18" height="11"/);

    // Site Planner canvas: parcel/markup/measurement/callout/element Lock-Unlock — real per-object locks.
    const planner = readFileSync(resolve(here, "../src/workspaces/site-planner/SitePlanner.jsx"), "utf8");
    expect(planner).toMatch(/const toggleParcelLock = /);
    expect(planner).toMatch(/const toggleMarkupLock = /);
    expect(planner).toMatch(/const toggleMeasureLock = /);
    expect(planner).toMatch(/const toggleCalloutLock = /);
    expect(planner).toMatch(/const toggleLock = /);
    // The plan-level "shared with teammates, view-only" share-lock — a different feature on a
    // different row (a plan row in the plan switcher, not the top breadcrumb).
    expect(planner).toContain("View-only for teammates");
    expect(planner).toMatch(/const togglePlanLock = /);

    // A placed overlay's own Lock/Unlock ("prevent moving/resizing", owner-only) — also a
    // different feature on a different row.
    const plans = readFileSync(resolve(here, "../src/shared/sitePlans/components/SitePlansSection.jsx"), "utf8");
    expect(plans).toMatch(/function LockIcon\(\{ locked \}\)/);
    expect(plans).toMatch(/onClick=\{isOwner \? \(\) => onToggleLocked\(\) : undefined\}/);
  });

  it("crumb spacing has no leftover gap where the icon sat — no dangling flex/gap wrapper before the name", () => {
    const btnOpen = crumbRaw.indexOf('data-testid="project-crumb"');
    const closeAngle = crumbRaw.indexOf(">", crumbRaw.indexOf("style={crumbBtn(", btnOpen)) ;
    const nameSpan = crumbRaw.indexOf('{cross ? "All projects"', btnOpen);
    const between = crumbRaw.slice(closeAngle + 1, nameSpan);
    // Nothing but the opening of the name's own <span> and (stripped) comments should remain here.
    expect(between.replace(/\s+/g, " ").trim()).toMatch(/^(\{\/\*[\s\S]*?\*\/\}\s*)*<span style=\{\{ overflow:/);
  });
});
