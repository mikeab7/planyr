import { describe, it, expect } from "vitest";
import { parseRoute, buildHash, isAdminRoute, unknownModuleSlug } from "../src/app/route.js";
import { pickBootRoute } from "../src/app/lastRoute.js";
import { mayResumeLastSite, resumeTargetAfterSignIn, pickResumeTarget } from "../src/workspaces/site-planner/lib/bootResume.js";

/* B904304 — "a cold load at #/admin is silently rewritten to the last project."
 *
 * The owner's repro was a raw hash string going into a browser tab that has never rendered
 * before, with a stored "open where I left off" pointer sitting in localStorage from an
 * earlier session. This is the ONE thing this repo did not have a direct test for: every
 * existing boot-resume test (bootResume.test.js) exercises the individual pure decisions in
 * isolation, keyed on an already-parsed { module, projectId } route — none of them start from
 * the raw hash and walk it through the actual boot chain Shell.jsx + SitePlannerApp.jsx wire
 * together. `resolveBoot` below does exactly that, calling the SAME exported functions
 * production uses, in the SAME order, so this table is a genuine end-to-end proof rather than
 * a reimplementation of the logic under test.
 *
 * AUDIT-FIRST finding, recorded rather than assumed: by the time this item was picked up, the
 * mechanism the owner's repro actually hits — SitePlannerApp's post-sign-in async resume
 * falling back to the stored pointer with no privilege check — had ALREADY been closed one day
 * earlier by B881664 (×2) (PR #1249, commit 317b746), for the unrelated Dashboard-breadcrumb-
 * bounce symptom. That fix's gate (`resumeAllowed`, `mayResumeLastSite`) cares only about
 * whether the tab's raw boot hash was empty — never about which module an unknown/admin slug
 * happens to fall back to — so it already refuses to resume on ANY explicit hash, "#/admin"
 * included. The MUTATION PROOF test below demonstrates the defect class directly: replaying the
 * pre-B881664(×2) shape (a bare `pickResumeTarget` call with no privilege gate) against #/admin's
 * own resolved route reproduces exactly the reported rewrite. This file exists so that guarantee
 * is pinned explicitly for #/admin (and every other boot-time route) rather than left to be true
 * only as a side effect of a differently-reported bug. */

const STORED_PROJECT_ID = "smqfy48tlk9j"; // a real project id shape, matching the owner's own repros
const storedLastRoute = { module: "site-planner", projectId: STORED_PROJECT_ID, cross: false };
const plansOfGroup = (gid) => {
  if (gid === STORED_PROJECT_ID) return [{ id: STORED_PROJECT_ID }];
  if (gid === "other-project") return [{ id: "other-project-plan" }];
  return [];
};
const hasSite = (id) => id === STORED_PROJECT_ID;

/* Faithfully replays Shell.jsx's boot sequence end to end:
 *   1. seedBootRoute (lastRoute.pickBootRoute) — only ever rewrites a truly EMPTY raw hash.
 *   2. parseRoute — what module/project the (possibly seeded) hash resolves to.
 *   3. mayResumeLastSite — the one-shot boot privilege (B881664): true only when the raw hash
 *      was empty (an explicit hash, "#/admin" included, always refuses it).
 *   4. resumeTargetAfterSignIn — the Site Planner's own resume decision. Same gate shape as
 *      both bootActiveId's synchronous path and the async post-sign-in path (B881664 ×2), so
 *      using it here stands in for either — they can never disagree by construction. */
function resolveBoot(rawHash) {
  const initialHashEmpty = rawHash === "" || rawHash === "#";
  const boot = pickBootRoute({ initialHashEmpty, stored: storedLastRoute });
  const effectiveHash = boot ? buildHash(boot) : rawHash;
  const route = parseRoute(effectiveHash);
  const resumeAllowed = mayResumeLastSite({ initialHashEmpty, projectId: route.projectId, initialProjectId: route.projectId });
  const resumedSiteId = resumeTargetAfterSignIn({
    routeProjectId: route.projectId, currentId: STORED_PROJECT_ID, plansOfGroup, hasSite, resumeAllowed,
  });
  return { route, isAdminHash: isAdminRoute(rawHash), routeMiss: !!unknownModuleSlug(rawHash), resumedSiteId };
}

describe("Boot-time route resolution (B904304) — with a stored last-open project present", () => {
  const ROWS = [
    { hash: "#/library", module: "library", projectId: null, isAdmin: false, routeMiss: false },
    { hash: "#/markup", module: "doc-review", projectId: null, isAdmin: false, routeMiss: false },
    { hash: "#/project/other-project/site", module: "site-planner", projectId: "other-project", isAdmin: false, routeMiss: false },
    { hash: "#/admin", module: "site-planner", projectId: null, isAdmin: true, routeMiss: false },
    { hash: "#/notarealslug", module: "site-planner", projectId: null, isAdmin: false, routeMiss: true },
    { hash: "", module: "site-planner", projectId: STORED_PROJECT_ID, isAdmin: false, routeMiss: false },
    { hash: "#", module: "site-planner", projectId: STORED_PROJECT_ID, isAdmin: false, routeMiss: false },
  ];

  for (const row of ROWS) {
    it(`"${row.hash || "(empty)"}" resolves to module ${row.module}, project ${row.projectId ?? "null"}`, () => {
      const boot = resolveBoot(row.hash);
      expect(boot.route.module).toBe(row.module);
      expect(boot.route.projectId).toBe(row.projectId);
      expect(boot.isAdminHash).toBe(row.isAdmin);
      expect(boot.routeMiss).toBe(row.routeMiss);
    });
  }

  it("⛔ THE ROW THAT MATTERS — #/admin never resumes the stored last-open project, same as #/library, #/markup and an unrecognized slug", () => {
    for (const hash of ["#/admin", "#/library", "#/markup", "#/notarealslug"]) {
      expect(resolveBoot(hash).resumedSiteId).toBe(null);
    }
  });

  it("the ONE legitimate case — a truly empty hash ('open where I left off') resumes the stored project", () => {
    expect(resolveBoot("").resumedSiteId).toBe(STORED_PROJECT_ID);
    expect(resolveBoot("#").resumedSiteId).toBe(STORED_PROJECT_ID);
  });

  it("an explicit deep link to a DIFFERENT project always wins over the stored pointer — never the stored one, never silently null", () => {
    expect(resolveBoot("#/project/other-project/site").resumedSiteId).toBe("other-project-plan");
  });

  it("MUTATION PROOF — replays the pre-B881664(×2) shape (bare pickResumeTarget, no privilege gate) and shows #/admin's own resolved route WOULD have been rewritten", () => {
    // This is literally what SitePlannerApp's applyUser called before PR #1249: no resumeAllowed
    // gate at all. Replaying it against #/admin's resolved route reproduces the exact reported
    // defect — the resolver falls back to the stored pointer the instant the privilege check
    // is missing, which is the class of bug this table exists to catch.
    const route = parseRoute("#/admin");
    const preFixEquivalent = pickResumeTarget({
      routeProjectId: route.projectId, currentId: STORED_PROJECT_ID, plansOfGroup, hasSite,
    });
    expect(preFixEquivalent).toBe(STORED_PROJECT_ID); // the reported bug, proven present in the un-gated function
    // The current, gated call on the identical inputs correctly refuses it:
    expect(resolveBoot("#/admin").resumedSiteId).toBe(null);
  });
});
