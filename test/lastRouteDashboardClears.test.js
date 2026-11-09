/* NEW-1 (AUTH-SWEEP 3) — V864433's live re-run on build caf2020 found the NEW-2(b) fix covered `leaveProject`/`goMap`
 * only: the header wordmark / Dashboard crumb sets the bare "#/" (Shell.goDashboard) and Shell's one pointer writer
 * SKIPPED the Dashboard, so `planyr:lastRoute:v1` kept naming the project just left and a brand-new tab on the bare
 * domain deep-linked straight back into it. `pointerForRoute` is the pure rule Shell's writer now goes through. */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pointerForRoute, writeLastRoute, readLastRoute, pickBootRoute } from "../src/app/lastRoute.js";

function mockLocalStorage() {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }, clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };
}
const IN_PROJECT = { module: "site-planner", projectId: "e2e-fixture", cross: false, org: false };

describe("pointerForRoute — the pointer a route change leaves behind", () => {
  beforeEach(mockLocalStorage);

  it("an ordinary routed project is persisted as itself", () => {
    expect(pointerForRoute(IN_PROJECT)).toEqual(IN_PROJECT);
  });

  it("the Dashboard writes the NEUTRAL pointer, so a new bare-domain tab resumes nothing", () => {
    writeLastRoute(pointerForRoute(IN_PROJECT));               // working in the project
    expect(readLastRoute().projectId).toBe("e2e-fixture");
    const p = pointerForRoute(IN_PROJECT, { dashboard: true }); // wordmark → "#/"
    expect(p).toEqual({ module: "site-planner", projectId: null, cross: false, org: false });
    writeLastRoute(p);
    expect(readLastRoute().projectId).toBe(null);
    expect(pickBootRoute({ initialHashEmpty: true, stored: readLastRoute() })).toBe(null);
  });

  it("RED-PROOF — the old rule (skip the write on the Dashboard) leaves the stale project resuming", () => {
    writeLastRoute(IN_PROJECT);
    const oldRule = (route, { dashboard }) => (dashboard ? null : route);   // what Shell did before
    const p = oldRule(IN_PROJECT, { dashboard: true });
    if (p) writeLastRoute(p);
    const boot = pickBootRoute({ initialHashEmpty: true, stored: readLastRoute() });
    expect(boot && boot.projectId).toBe("e2e-fixture");
  });

  it("admin and design overlays still never touch the pointer (B711904)", () => {
    expect(pointerForRoute(IN_PROJECT, { admin: true })).toBe(null);
    expect(pointerForRoute(IN_PROJECT, { design: true })).toBe(null);
  });

  it("SOURCE GUARD — Shell's writer goes through pointerForRoute with the dashboard flag", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/app/Shell.jsx", import.meta.url)), "utf8");
    expect(src).toMatch(/pointerForRoute\(route, \{ admin: isAdminHash, design: isDesignHash, dashboard: isDashboardHash \}\)/);
  });
});
