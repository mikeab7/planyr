/* B1213312 — `isAdminHash`/`isDesignHash`/`isDashboardHash` in Shell.jsx must be plain,
 * synchronous computations off `window.location.hash`, NEVER `useState` seeded once and
 * updated by a `useEffect` keyed on `[route]`.
 *
 * THE BUG THIS GUARDS: `route` (from useHashRoute) updates from the hashchange LISTENER in one
 * render pass; a `useEffect` recomputing isDashboardHash from the (by-then-current) hash only
 * runs AFTER that render commits — one pass later. For that one render, `route.module` already
 * reflects the NEW hash while `isDashboardHash` still reflects the OLD one. `active` (which
 * gates every workspace's `isActive` prop) is derived from `isDashboardHash`, so on a hashchange
 * landing on the Dashboard's bare "#/", `active` briefly resolved back to "site-planner" for one
 * render — long enough for the kept-alive Site Planner's isActive-gated URL-sync effect to fire
 * once and overwrite the just-written Dashboard hash with "#/site". Measured live: clicking the
 * wordmark from Schedule produced `#/schedule -> #/ -> #/site`, 55ms apart — the exact
 * B881664-class bounce this session's Dashboard fix was supposed to close, reopened by its own
 * new state.
 *
 * The fix: compute all three as plain `const`s, straight off `window.location.hash`, every
 * render — no state, no effect, no lag. This test is a source guard (the failure mode is a
 * TIMING gap invisible to a rendered-output assertion) with an explicit mutation check proving
 * it would have caught the pre-fix shape.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const shellSrc = readFileSync(fileURLToPath(new URL("../src/app/Shell.jsx", import.meta.url)), "utf8");

describe("Shell.jsx — isAdminHash/isDesignHash/isDashboardHash are synchronous, not state+effect", () => {
  it("all three are plain consts computed directly from window.location.hash", () => {
    expect(shellSrc).toMatch(/const isAdminHash\s*=\s*typeof window !== "undefined" && isAdminRoute\(window\.location\.hash\);/);
    expect(shellSrc).toMatch(/const isDesignHash\s*=\s*typeof window !== "undefined" && isDesignRoute\(window\.location\.hash\);/);
    expect(shellSrc).toMatch(/const isDashboardHash\s*=\s*typeof window !== "undefined" && isDashboardRoute\(window\.location\.hash\);/);
  });

  it("none of the three is ever declared as useState (the lagging shape this bug came from)", () => {
    expect(shellSrc).not.toMatch(/const \[isAdminHash, setIsAdminHash\]/);
    expect(shellSrc).not.toMatch(/const \[isDesignHash, setIsDesignHash\]/);
    expect(shellSrc).not.toMatch(/const \[isDashboardHash, setIsDashboardHash\]/);
  });

  // MUTATION CHECK — reproduces the exact pre-fix declaration shape as a string and confirms
  // the FIRST assertion above would have failed against it, so this guard has real teeth rather
  // than merely restating the current source.
  it("MUTATION PROOF — the pre-fix useState+useEffect shape fails the synchronous-const assertion", () => {
    const preFixShape = `
  const [isDashboardHash, setIsDashboardHash] = useState(() => (typeof window !== "undefined" ? isDashboardRoute(window.location.hash) : false));
  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsDashboardHash(isDashboardRoute(window.location.hash));
  }, [route]);`;
    expect(preFixShape).not.toMatch(/const isDashboardHash\s*=\s*typeof window !== "undefined" && isDashboardRoute\(window\.location\.hash\);/);
  });

  it("active is derived from isDashboardHash, so the two can never be one render apart", () => {
    expect(shellSrc).toMatch(/const active = isDashboardHash \? null : routedModule;/);
  });
});
