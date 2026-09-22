/* NEW-2 / NEW-3 — the error boundary names the subtree that threw, and records what it decided.
 *
 * Two defects, one surface:
 *
 *  • NEW-2 — the boundary reported `module` from its own props, i.e. the ACTIVE ROUTE. The owner's
 *    2026-09-19 13:31:08 crash threw inside `AppHeader` and was filed as `site-planner`, and the
 *    card told him "Site Planyr hit an error and couldn't load". Nothing about the planner had
 *    failed, and nothing had failed to LOAD.
 *
 *  • NEW-3 — the boundary has chosen between "remount quietly" and "show the dead end" since
 *    B1189 and wrote down neither. Three days of `client_errors` held no row for a recovery
 *    attempt, a recovery success, or budget exhaustion, so the app's most visible behaviour — the
 *    whole workspace blinking and coming back — was invisible after the fact.
 *
 * The stacks below are the owner's REAL ones, from `public.client_errors` on build 27671fa, in the
 * shape the browser actually produced (minified names, full asset URLs). A hand-written stack would
 * test the regex against itself; these test it against the case it exists for.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { crashSubtree } from "../src/app/recoverableError.js";
import { crashModuleSlug } from "../src/app/ErrorBoundary.jsx";

/* CRASH 1 — 2026-09-19 13:30:10.670. Threw inside the Site Planner chunk. */
const CRASH1 = [
  "pSe@https://planyr.io/assets/SitePlannerApp-B3QWqHJY.js:10:272936",
  "div",
  "HSe@https://planyr.io/assets/SitePlannerApp-B3QWqHJY.js:41:16853",
  "Suspense",
  "Gh@https://planyr.io/assets/index-ur2qYFgO.js:86:34734",
  "div",
  "main",
  "div",
  "W1@https://planyr.io/assets/index-ur2qYFgO.js:133:66611",
  "Wk@https://planyr.io/assets/index-ur2qYFgO.js:86:16846",
].join("\n");

/* CRASH 2 — 2026-09-19 13:31:08.262, 58 seconds later, same page session, same loaded build. Threw
 * inside AppHeader, which is mounted INSIDE the planner's subtree — which is precisely why the
 * active route was a misleading answer. */
const CRASH2 = [
  "$n@https://planyr.io/assets/AppHeader-BYdR8Qaf.js:2:9008",
  "div",
  "div",
  "div",
  "header",
  "Rr@https://planyr.io/assets/AppHeader-BYdR8Qaf.js:2:47744",
  "div",
  "pSe@https://planyr.io/assets/SitePlannerApp-B3QWqHJY.js:10:272936",
  "div",
  "HSe@https://planyr.io/assets/SitePlannerApp-B3QWqHJY.js:41:16853",
].join("\n");

const DEV_STACK = [
  "    in ProjectBreadcrumb (at AppHeader.jsx:1143)",
  "    in div (at AppHeader.jsx:1082)",
  "    in AppHeader (at SitePlanner.jsx:23279)",
].join("\n");

describe("crashSubtree — which subtree actually threw", () => {
  it("names the Site Planner chunk for the crash that threw there", () => {
    const w = crashSubtree(CRASH1);
    expect(w.crashedIn).toBe("SitePlannerApp");
    expect(w.component).toBe("pSe");
  });

  it("⛔ names AppHeader for the crash that threw in the header — the whole point of NEW-2", () => {
    const w = crashSubtree(CRASH2);
    expect(w.crashedIn).toBe("AppHeader");
    expect(w.component).toBe("$n");
    // And it must NOT be confused by the planner frames further down the same stack.
    expect(w.crashedIn).not.toBe("SitePlannerApp");
  });

  it("carries a short, placeable head of the stack rather than the whole thing", () => {
    const w = crashSubtree(CRASH2);
    expect(w.head).toContain("AppHeader-BYdR8Qaf.js");
    expect(w.head.length).toBeLessThanOrEqual(220);
  });

  it("answers from a dev-build stack too, where there is no chunk to read", () => {
    const w = crashSubtree(DEV_STACK);
    expect(w.crashedIn).toBeNull();
    expect(w.component).toBe("ProjectBreadcrumb");
  });

  it("skips the plain host tags React interleaves — a `div` places nothing", () => {
    expect(crashSubtree("div\nspan\nmain").component).toBeNull();
  });

  it("is total: no stack, an empty stack and a non-string all answer the same shape", () => {
    for (const bad of [undefined, null, "", "   ", 42, {}]) {
      expect(crashSubtree(bad)).toEqual({ crashedIn: null, component: null, head: null });
    }
  });

  it("the ROUTE is still recorded — the subtree is an addition, never a replacement", () => {
    // Both questions have answers and they are different ones; NEW-2 asks for both on the record.
    expect(crashModuleSlug({ moduleId: "site-planner", label: "Site Planyr" })).toBe("site-planner");
    expect(crashSubtree(CRASH2).crashedIn).toBe("AppHeader");
  });
});

/* ── The boundary's decisions reach telemetry ─────────────────────────────────────────────────
 *
 * Source guards. The boundary is a class component whose behaviour here is all timers and side
 * effects; a full mount test would need jsdom, which this suite deliberately does not carry (see
 * vitest.config.js). What must not silently disappear is the wiring itself — that is what was
 * missing, and its absence is invisible in every other way. */
const boundary = readFileSync(new URL("../src/app/ErrorBoundary.jsx", import.meta.url), "utf8");

describe("every boundary decision is on the record (LOUD-FAILURE)", () => {
  it("emits the three named events NEW-3 asks for", () => {
    expect(boundary).toContain('reportClientEvent("boundary-recovery-attempted"');
    expect(boundary).toContain('reportClientEvent("boundary-recovery-succeeded"');
    expect(boundary).toContain('reportClientEvent("boundary-budget-exhausted"');
  });

  it("each row carries the reason, the retry index, the remaining budget, the route and the subtree", () => {
    for (const field of ["reason:", "attempt:", "budgetLeft:", "module:", "crashedIn:", "stackHead:"]) {
      expect(boundary).toContain(field);
    }
  });

  it("carries the render-loop probe's verdict, so the next occurrence names its own pump", () => {
    expect(boundary).toContain("loopSummary(");
  });

  it("⛔ a success is only claimed once the remount HELD", () => {
    // A success declared in the same tick as the remount would be a lie on the one case that
    // matters — a remount that re-enters the same loop throws again within a frame or two.
    expect(boundary).toContain("RECOVERY_SETTLED_MS");
    expect(boundary).toMatch(/componentDidCatch[\s\S]{0,400}clearTimeout\(this\.settleTimer\)/);
  });

  it("⛔ the recovery notice is NON-BLOCKING and renders beside the children, never instead of them", () => {
    expect(boundary).toContain('data-testid="boundary-recovered-notice"');
    expect(boundary).toContain("pointerEvents: \"none\"");
    // The children must still be rendered on the recovered path.
    expect(boundary).toMatch(/recovered[\s\S]{0,300}\{this\.props\.children\}/);
  });

  it("⛔ the dead-end card does not claim a display loop failed to LOAD", () => {
    expect(boundary).toContain('savedWork ? "Planyr hit a display problem"');
  });
});
