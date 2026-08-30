import { describe, it, expect } from "vitest";
import { initialBootResolved, mayReconcileUrl, pickResumeTarget, mayWriteRouteProject, routeProjectAvailability, mayResumeLastSite } from "../src/workspaces/site-planner/lib/bootResume.js";

describe("initialBootResolved — the boot gate's starting value (V13)", () => {
  it("is FALSE when Supabase is configured (wait for the first auth + pull before reconciling the URL)", () => {
    expect(initialBootResolved(true)).toBe(false);
  });
  it("is TRUE when Supabase is NOT configured (no async gap — logged-out/unconfigured boots resolve synchronously)", () => {
    expect(initialBootResolved(false)).toBe(true);
  });
});

describe("mayReconcileUrl — whether the URL sync + dangling-pointer cleanup may run", () => {
  it("blocks while boot is unresolved, allows once resolved", () => {
    expect(mayReconcileUrl(false)).toBe(false);
    expect(mayReconcileUrl(true)).toBe(true);
  });
});

describe("pickResumeTarget — which plan to resume (shared by boot + post-pull)", () => {
  const plansOfGroup = (gid) => ({
    g1: [{ id: "g1-newest" }, { id: "g1-older" }],   // newest first
    g2: [{ id: "g2-only" }],
    empty: [],
  })[gid] || [];
  const has = (set) => (id) => set.has(id);

  it("route project + currentSite IS one of its plans → resumes that exact plan", () => {
    expect(pickResumeTarget({ routeProjectId: "g1", currentId: "g1-older", plansOfGroup, hasSite: has(new Set(["g1-older"])) }))
      .toBe("g1-older");
  });

  it("route project + currentSite NOT in that group → resumes the group's newest plan", () => {
    expect(pickResumeTarget({ routeProjectId: "g1", currentId: "someone-else", plansOfGroup, hasSite: has(new Set()) }))
      .toBe("g1-newest");
  });

  it("route project + no currentSite → resumes the group's newest plan", () => {
    expect(pickResumeTarget({ routeProjectId: "g2", currentId: null, plansOfGroup, hasSite: has(new Set()) }))
      .toBe("g2-only");
  });

  it("route project whose plans aren't loaded yet (empty) → null (nothing to resume *yet*; the post-pull call resolves it)", () => {
    expect(pickResumeTarget({ routeProjectId: "empty", currentId: "g1-older", plansOfGroup, hasSite: has(new Set(["g1-older"])) }))
      .toBe(null);
  });

  it("NO route project + currentSite still exists → resumes the last-open plan", () => {
    expect(pickResumeTarget({ routeProjectId: null, currentId: "last-open", plansOfGroup, hasSite: has(new Set(["last-open"])) }))
      .toBe("last-open");
  });

  it("NO route project + currentSite no longer exists → null (don't resume a deleted/absent plan)", () => {
    expect(pickResumeTarget({ routeProjectId: null, currentId: "ghost", plansOfGroup, hasSite: has(new Set()) }))
      .toBe(null);
  });

  it("NO route project + no currentSite → null", () => {
    expect(pickResumeTarget({ routeProjectId: null, currentId: null, plansOfGroup, hasSite: has(new Set()) }))
      .toBe(null);
  });

  it("THE V13 SCENARIO: the route names a project; at first render its plans are empty (cloud unpulled) so it returns null, but the SAME call after the pull (plans present) resumes the open plan — the URL was held intact in between", () => {
    // First render: signed-in deep link, cloud not pulled yet → plans empty → null (stay put, URL held by the gate).
    const preFetch = pickResumeTarget({ routeProjectId: "g1", currentId: "g1-older", plansOfGroup: () => [], hasSite: () => false });
    expect(preFetch).toBe(null);
    // After pullCloud: same route project, plans now present → resumes the exact open plan.
    const postFetch = pickResumeTarget({ routeProjectId: "g1", currentId: "g1-older", plansOfGroup, hasSite: has(new Set(["g1-older"])) });
    expect(postFetch).toBe("g1-older");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * NEW-5 — THE URL IS AUTHORITATIVE.
 *
 * `mayReconcileUrl` above was the V13 fix, and it gates on an EVENT having fired rather than on
 * the DATA being known — which is why the owner could still lose a project by refreshing. Two
 * live boot sequences defeat it:
 *   • supabase-js emits INITIAL_SESSION with a NULL user while it is still restoring a stored
 *     session. That call runs to completion and releases the gate, so the URL sync fires with
 *     the cloud sites still absent and writes null straight over #/project/<id>/site.
 *   • if the sequence is INITIAL_SESSION(null) → TOKEN_REFRESHED(user), the handler ignores
 *     TOKEN_REFRESHED entirely, so the resume never runs at all — and the route is already gone.
 * These lock the fix that closes the CLASS rather than either sequence.
 * ──────────────────────────────────────────────────────────────────────────── */
describe("mayWriteRouteProject (NEW-5)", () => {
  it("REFUSES to clear a route-named project just because nothing is loaded", () => {
    // The exact frame that broke it: the route names a project, the app has none open yet.
    expect(mayWriteRouteProject({ routeProjectId: "smsdsqdkl9i0", nextGroup: null })).toBe(false);
  });

  it("allows the clear when the user deliberately left", () => {
    expect(mayWriteRouteProject({ routeProjectId: "smsdsqdkl9i0", nextGroup: null, userLeft: true })).toBe(true);
  });

  it("always allows writing a REAL project (the URL stays shareable)", () => {
    expect(mayWriteRouteProject({ routeProjectId: null, nextGroup: "g1" })).toBe(true);
    expect(mayWriteRouteProject({ routeProjectId: "g0", nextGroup: "g1" })).toBe(true);
  });

  it("a route with no project can always be written (nothing to lose)", () => {
    expect(mayWriteRouteProject({ routeProjectId: null, nextGroup: null })).toBe(true);
  });

  it("REGRESSION — the null-user INITIAL_SESSION frame no longer strips the deep link", () => {
    // Boot order on production: INITIAL_SESSION(null) releases the gate → effGroup is null →
    // the old writer put "#/" in the URL, and the SIGNED_IN that followed then resumed against
    // a route with no project in it. Under the new rule that write never happens…
    const route = "smsdsqdkl9i0";
    expect(mayWriteRouteProject({ routeProjectId: route, nextGroup: null, userLeft: false })).toBe(false);
    // …so the later resume still sees the route, and writing the resolved group is allowed.
    expect(mayWriteRouteProject({ routeProjectId: route, nextGroup: route, userLeft: false })).toBe(true);
  });
});

describe("routeProjectAvailability (NEW-5)", () => {
  const withPlans = (ids) => (g) => (g === "has" ? ids.map((id) => ({ id })) : []);

  it("opens a project whose plans are on this device", () => {
    expect(routeProjectAvailability({ plansOfGroup: withPlans(["p1"]), groupId: "has", bootResolved: true })).toBe("open");
  });

  it("WAITS while the boot is unresolved — the pull may still land it", () => {
    // This is the state the old code answered with a silent `return`, leaving the PREVIOUS
    // project rendered under a URL naming a different one (the owner's repro B).
    expect(routeProjectAvailability({ plansOfGroup: withPlans([]), groupId: "nope", bootResolved: false })).toBe("waiting");
  });

  it("reports MISSING once the boot has settled — never silence", () => {
    expect(routeProjectAvailability({ plansOfGroup: withPlans([]), groupId: "nope", bootResolved: true })).toBe("missing");
  });

  it("no routed project is trivially open", () => {
    expect(routeProjectAvailability({ plansOfGroup: withPlans([]), groupId: null, bootResolved: true })).toBe("open");
  });
});

describe("mayResumeLastSite (B881664) — the Site Planner's boot-resume fallback is a ONE-SHOT boot privilege", () => {
  it("REFUSES when the tab did not boot on an empty hash at all", () => {
    expect(mayResumeLastSite({ initialHashEmpty: false, projectId: null, initialProjectId: null })).toBe(false);
  });

  it("ALLOWS the legitimate case: the app's very first mount, boot resolved to no project, this mount's projectId still matches", () => {
    expect(mayResumeLastSite({ initialHashEmpty: true, projectId: null, initialProjectId: null })).toBe(true);
  });

  it("ALLOWS a boot that resolved directly into a project (the routeProjectId branch in pickResumeTarget still applies)", () => {
    expect(mayResumeLastSite({ initialHashEmpty: true, projectId: "g1", initialProjectId: "g1" })).toBe(true);
  });

  it("⛔ THE B881664 REPRO — REFUSES once a later mount's projectId no longer matches the boot route", () => {
    // The tab booted empty-hash and "open where I left off" resumed it onto a project's
    // Schedule tab (initialProjectId = "g1"). The Site Planner had never mounted at that
    // point; it mounts LATER, the first time the user clicks Dashboard, with projectId
    // already cleared to null by that navigation. The mismatch alone must refuse the resume
    // — reviving g1's currentSite pointer here is exactly the bounce the owner reported.
    expect(mayResumeLastSite({ initialHashEmpty: true, projectId: null, initialProjectId: "g1" })).toBe(false);
  });

  it("REFUSES an explicit '#/' dashboard link even though its parsed projectId is also null", () => {
    // initialHashEmpty is FALSE for a literal "#/" (route.js only treats a truly blank hash
    // as empty), so this never reaches the equality check — the explicit link always wins.
    expect(mayResumeLastSite({ initialHashEmpty: false, projectId: null, initialProjectId: null })).toBe(false);
  });

  it("treats undefined/null projectId the same as each other on both sides", () => {
    expect(mayResumeLastSite({ initialHashEmpty: true, projectId: undefined, initialProjectId: null })).toBe(true);
    expect(mayResumeLastSite({ initialHashEmpty: true, projectId: null, initialProjectId: undefined })).toBe(true);
  });
});
