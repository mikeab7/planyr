import { describe, it, expect } from "vitest";
import { initialBootResolved, mayReconcileUrl, pickResumeTarget } from "../src/workspaces/site-planner/lib/bootResume.js";

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
