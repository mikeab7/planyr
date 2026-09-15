/* NEW-3 (owner report, 2026-09-15 — "sometimes when I'm clicking between modules... it takes me
 * to the wrong place"; the investigation's table: "The same crumb has two labels and three
 * destinations"). The app shell's leading breadcrumb crumb sits in the SAME position and reads
 * the SAME word, "Dashboard", on five of six module tabs — but on Schedule it led somewhere else
 * (its own in-module reports view, not the real app Dashboard at `#/`), which is exactly what
 * made a click land "in the wrong place" without warning.
 *
 * THE RULE THIS SETTLES (NEW-3's own ask — "decide what it means... one label and one
 * destination, or two clearly distinct controls"): a leading crumb's label must describe its OWN
 * real destination. The word "Dashboard" is reserved for a crumb that genuinely leads to the real
 * app Dashboard (`#/`, reached via the `onGoDashboard` prop the Shell hands every workspace) — a
 * module whose crumb leads somewhere else gets its own distinct label. Site already did this
 * correctly ("Map" → the Site Planner's own map, never the real Dashboard) before this item; NEW-2
 * in this same session brought Schedule's project-scope crumb into line ("Reports" → Schedule's
 * own cross-project reports view, `goDashboard`/`goDashboardWithinModule`, never `onGoDashboard`).
 *
 * This is a per-file source-guard audit (the same idiom as scheduleDashboardNav.test.js's own
 * wiring assertions) rather than a JSX parser, because every AppHeader call site here is a fixed,
 * known shape — a future new workspace, or a new AppHeader call site in an existing one, is
 * exactly the case this must fail loudly for until it's reviewed and added below.
 *
 * "Shell.jsx's 'the dashboard IS the site-planner map' definition" — named in the investigation as
 * possibly stale — was checked and confirmed gone: `git grep` for that phrasing (and
 * `isDashboardHash`) finds only Shell.jsx's OWN correct, current B1213312 definition, where the
 * Dashboard is a real destination distinct from every workspace (see dashboardHashSync.test.js).
 * No stale doc or comment states the old equivalence; nothing to fix there.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

describe("NEW-3 — every leading crumb's label matches its real destination", () => {
  it("Site Planner: homeLabel \"Map\" pairs with the in-module goMap/onBackToMap action, never onGoDashboard", () => {
    const app = read("src/workspaces/site-planner/SitePlannerApp.jsx");
    expect(app).toMatch(/homeLabel="Map"\s*\n\s*onDashboard=\{goMap\}/);
    const planner = read("src/workspaces/site-planner/SitePlanner.jsx");
    expect(planner).toMatch(/homeLabel="Map"/);
    expect(planner).toMatch(/onDashboard=\{onBackToMap\}/);
  });

  it("Scheduler ORG scope: homeLabel \"Dashboard\" pairs with onGoDashboard — the real Dashboard, matching Library/Notes", () => {
    const src = read("src/workspaces/scheduler/Scheduler.jsx");
    const orgAt = src.indexOf("if (org) {");
    const orgClose = src.indexOf("<AgendaView", orgAt);
    const orgBlock = src.slice(orgAt, orgClose);
    expect(orgBlock).toMatch(/homeLabel="Dashboard"/);
    expect(orgBlock).toMatch(/onDashboard=\{onGoDashboard\}/);
  });

  it("Scheduler PROJECT scope: homeLabel is NOT \"Dashboard\" — it leads to the in-module reports view, never onGoDashboard", () => {
    const src = read("src/workspaces/scheduler/Scheduler.jsx");
    const orgAt = src.indexOf("if (org) {");
    const orgClose = src.indexOf("<AgendaView", orgAt);
    const projectBlock = src.slice(orgClose); // everything after the org-scope early return
    expect(projectBlock).toMatch(/homeLabel="Reports"/);
    expect(projectBlock).not.toMatch(/homeLabel="Dashboard"/);
    // The crumb still fires the in-module action, never the real Dashboard leave-action:
    expect(projectBlock).toMatch(/onDashboard=\{goDashboard\}/);
  });

  it("Review / Library / Notes / Food / Spreadsheet: no homeLabel override — the shared default (\"Dashboard\") stands, and onDashboard is genuinely onGoDashboard", () => {
    const files = [
      "src/workspaces/doc-review/DocReview.jsx",
      "src/workspaces/library/Library.jsx",
      "src/workspaces/notes/Notes.jsx",
      "src/workspaces/food/FoodApp.jsx",
      "src/workspaces/model/ModelApp.jsx",
    ];
    for (const f of files) {
      const src = read(f);
      // None of these five modules has its own in-module dashboard, so the crumb legitimately
      // means the same thing everywhere: the word "Dashboard" is never overridden to something
      // else here, and every onDashboard site (DocReview has two, one per render branch) genuinely
      // leads to the real app Dashboard.
      expect(src, `${f}: must not override homeLabel away from the shared default`).not.toMatch(/homeLabel=/);
      const onDashboardSites = src.match(/onDashboard=\{[^}]+\}/g) || [];
      expect(onDashboardSites.length, `${f}: expected at least one onDashboard wiring`).toBeGreaterThan(0);
      for (const site of onDashboardSites) {
        expect(site, `${f}: ${site} must be wired to the real Dashboard action (onGoDashboard)`).toBe("onDashboard={onGoDashboard}");
      }
    }
  });

  it("ProjectBreadcrumb's own default homeLabel is still literally \"Dashboard\" — every unoverridden caller above depends on this", () => {
    // AppHeader.jsx takes no default of its own for `homeLabel` — it forwards the prop straight
    // to ProjectBreadcrumb.jsx, which is where the shared "Dashboard" default actually lives.
    const crumb = read("src/shared/ui/ProjectBreadcrumb.jsx");
    expect(crumb).toMatch(/homeLabel = "Dashboard"/);
  });

  // MUTATION PROOF — the rule has teeth: relabeling Schedule's project-scope crumb back to
  // "Dashboard" without changing its destination (exactly the pre-fix shape) fails the assertion
  // above, not merely a differently-worded one.
  it("MUTATION PROOF — reverting the Schedule project-scope label to \"Dashboard\" fails this suite's own check", () => {
    const src = read("src/workspaces/scheduler/Scheduler.jsx");
    const orgAt = src.indexOf("if (org) {");
    const orgClose = src.indexOf("<AgendaView", orgAt);
    const projectBlock = src.slice(orgClose);
    const reverted = projectBlock.replace('homeLabel="Reports"', 'homeLabel="Dashboard"');
    expect(reverted).not.toBe(projectBlock);
    expect(reverted).toMatch(/homeLabel="Dashboard"/); // would now wrongly pass a naive "label exists" check
    // ...while STILL firing the in-module action — the exact mismatch this whole item is about.
    expect(reverted).toMatch(/onDashboard=\{goDashboard\}/);
  });
});
