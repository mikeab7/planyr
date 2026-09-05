/* NEW-2(b) — amendment to B1191457 (the currentSite fix). A live-verify pass found the FIRST fix
 * incomplete: after clicking the wordmark from inside a routed project, `planarfit:currentSite:v1`
 * was correctly untouched (it was already pointing somewhere unrelated) and the URL correctly went
 * to "#/" — but a brand-new tab opened on the bare `planyr.io` domain still deep-linked straight
 * back into the project just left. The dump of every storage key named the real culprit: a SECOND,
 * entirely separate "open where I left off" pointer, `planyr:lastRoute:v1` (src/app/lastRoute.js),
 * read by `seedBootRoute`/`pickBootRoute` on every empty-hash boot — a mechanism `leaveProject`/
 * `goMap` never touched at all.
 *
 * In principle this pointer is kept in sync INDIRECTLY: `leaveProject`/`goMap` change `mode`,
 * which changes `effGroup` to null, which (via SitePlannerApp's own URL-sync effect) calls
 * `onProjectChange(null)`, which Shell turns into a `navigate()` call that changes the hash, which
 * fires Shell's own `writeLastRoute(route)` effect. That chain was measured live to NOT reliably
 * clear the pointer. Rather than chase the exact race in that multi-hop chain, the fix applies the
 * same principle NEW-2(a) already used for `currentSite`: the ONE place that KNOWS the user
 * deliberately left (`leaveProject`/`goMap`) writes the neutral, no-project route DIRECTLY, so
 * clearing this pointer no longer depends on that downstream propagation succeeding at all.
 *
 * Proven against the REAL `writeLastRoute`/`readLastRoute` (src/app/lastRoute.js) and the REAL
 * `pickBootRoute` boot decision — never a re-derived mock of either.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { writeLastRoute, readLastRoute } from "../src/app/lastRoute.js";
import { pickBootRoute } from "../src/app/lastRoute.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function mockLocalStorage() {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
}

const LEFT_PROJECT = "left-project-group";

describe("NEW-2(b) — leaving a project must clear the persisted lastRoute pointer too", () => {
  beforeEach(() => { mockLocalStorage(); });

  it("BEFORE the fix (lastRoute left standing after a deliberate exit) — a bare-domain cold boot redirects straight back into the just-left project", () => {
    // Simulate the project having been open (a real navigation would have written this).
    writeLastRoute({ module: "site-planner", projectId: LEFT_PROJECT, cross: false, org: false });
    // ...then a wordmark/Dashboard press that does NOT clear the pointer (the pre-fix behaviour:
    // only the URL/local state change, lastRoute is left exactly as it was).
    const stillStale = readLastRoute();
    expect(stillStale.projectId).toBe(LEFT_PROJECT);
    // A brand-new tab opened on the bare domain seeds its boot route from that stale pointer.
    const boot = pickBootRoute({ initialHashEmpty: true, stored: stillStale });
    expect(boot).not.toBe(null);
    expect(boot.projectId).toBe(LEFT_PROJECT);
  });

  it("AFTER the fix (leaveProject/goMap write the neutral route directly) — a bare-domain cold boot resumes nothing", () => {
    writeLastRoute({ module: "site-planner", projectId: LEFT_PROJECT, cross: false, org: false });
    // What the fixed leaveProject/goMap now do:
    writeLastRoute({ module: "site-planner", projectId: null, cross: false, org: false });
    const cleared = readLastRoute();
    expect(cleared.projectId).toBe(null);
    const boot = pickBootRoute({ initialHashEmpty: true, stored: cleared });
    // The default module with no project builds to the bare "#/" itself — pickBootRoute treats
    // that as nothing worth seeding (a no-op redirect), so it returns null: no resume.
    expect(boot).toBe(null);
  });

  it("a real routed deep-link boot is completely unaffected by the pointer being cleared", () => {
    // #/project/<id>/site — the URL itself names a project outright; a stale/cleared lastRoute
    // pointer plays no part in resolving THAT boot at all (seedBootRoute only ever fires when the
    // hash is EMPTY — initialHashEmpty is false for any real deep link).
    writeLastRoute({ module: "site-planner", projectId: LEFT_PROJECT, cross: false, org: false });
    writeLastRoute({ module: "site-planner", projectId: null, cross: false, org: false });
    const boot = pickBootRoute({ initialHashEmpty: false, stored: readLastRoute() });
    expect(boot).toBe(null); // seedBootRoute never runs against a non-empty hash in the first place
  });

  it("SOURCE GUARD — leaveProject and goMap in SitePlannerApp.jsx actually call writeLastRoute with projectId: null", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../src/workspaces/site-planner/SitePlannerApp.jsx", import.meta.url)),
      "utf8",
    );
    expect(src).toMatch(/import \{ writeLastRoute \} from "\.\.\/\.\.\/app\/lastRoute\.js";/);
    const clearFnAt = src.indexOf("const clearLastRouteProject = () =>");
    expect(clearFnAt, "clearLastRouteProject helper not found").toBeGreaterThan(-1);
    const clearFnLine = src.slice(clearFnAt, src.indexOf("\n", clearFnAt));
    expect(clearFnLine).toMatch(/writeLastRoute\(\{[^}]*projectId:\s*null[^}]*\}\)/);

    const leaveAt = src.indexOf("const leaveProject = () => {");
    const goMapAt = src.indexOf("const goMap = () => {");
    expect(leaveAt, "leaveProject not found").toBeGreaterThan(-1);
    expect(goMapAt, "goMap not found").toBeGreaterThan(-1);
    const leaveLine = src.slice(leaveAt, src.indexOf("\n", leaveAt));
    const goMapLine = src.slice(goMapAt, src.indexOf("\n", goMapAt));
    expect(leaveLine).toMatch(/clearLastRouteProject\(\)/);
    expect(goMapLine).toMatch(/clearLastRouteProject\(\)/);
    // Both still clear currentSite and set userLeftProjectRef — the earlier fix and the
    // load-bearing URL-writer flag must not have been disturbed by this amendment.
    expect(leaveLine).toMatch(/setCurrentSiteId\(null\)/);
    expect(goMapLine).toMatch(/setCurrentSiteId\(null\)/);
    expect(leaveLine).toMatch(/userLeftProjectRef\.current = true/);
    expect(goMapLine).toMatch(/userLeftProjectRef\.current = true/);
  });

  it("MUTATION CHECK — a version of the two functions with clearLastRouteProject() stripped out fails the source guard", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../src/workspaces/site-planner/SitePlannerApp.jsx", import.meta.url)),
      "utf8",
    );
    // Strip just the `clearLastRouteProject();` calls (regex, not an exact-line match) so this
    // check stays valid as later amendments add more calls to the same lines.
    const preFix = src.replace(/clearLastRouteProject\(\);\s*/g, "");
    expect(preFix).not.toBe(src);
    const leaveLine = preFix.slice(preFix.indexOf("const leaveProject = () => {"), preFix.indexOf("\n", preFix.indexOf("const leaveProject = () => {")));
    const goMapLine = preFix.slice(preFix.indexOf("const goMap = () => {"), preFix.indexOf("\n", preFix.indexOf("const goMap = () => {")));
    expect(leaveLine).not.toMatch(/clearLastRouteProject\(\)/);
    expect(goMapLine).not.toMatch(/clearLastRouteProject\(\)/);
  });
});
