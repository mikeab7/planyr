/* Performance-budget guards (NEW-8 / NEW-9).
 *
 * Two jobs, both cheap enough to sit in the pure-logic vitest tier:
 *
 *  1. The committed budgets file stays well-formed. A typo'd key or a target above its own
 *     ceiling would make a budget silently unenforceable, which is the one failure mode a
 *     budget system must not have.
 *
 *  2. No module warms a workspace at boot again (the NEW-9 regression). The bundle audit walks
 *     STATIC import edges and the runtime harness needs a browser, so neither is positioned to
 *     catch a boot-time `import()` in the required CI check — this is. It is a source-level
 *     guard, which is the honest trade for catching the class in `npm test`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { frameSamplingFault, observedFps, MIN_PLAUSIBLE_FPS } from "../ui-audit/lib/frameSampling.mjs";
import { ceilingFor } from "../ui-audit/lib/perfBudgetPolicy.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const budgets = JSON.parse(read("ui-audit/perf-budgets.json"));

describe("perf budgets file is well-formed", () => {
  const groups = ["bundle", "runtime"];

  it("has both budget groups", () => {
    for (const g of groups) expect(budgets[g], `missing group: ${g}`).toBeTruthy();
  });

  /* NEW-1: a bundle byte metric no longer STORES a ceiling — it stores a `baseline` and the
   * ceiling is derived from the one committed headroom band. So the well-formedness check asks
   * for "a resolvable ceiling", via the same function the audit uses, rather than for a literal
   * number that would forbid the derived shape. `ceilingFor` returns the literal where there is
   * one (the runtime metrics, and the siteRouteChunks count) — so this still catches a typo'd
   * or missing ceiling everywhere it was catching one before. */
  const metricsOf = (g) => Object.entries(budgets[g])
    .filter(([key]) => !key.startsWith("$") && key !== "siteRouteAllowlist" && key !== "headroom" && key !== "ratchetLog");

  it("every metric has a resolvable ceiling, and a target that is not above it", () => {
    for (const g of groups) {
      for (const [key, spec] of metricsOf(g)) {
        const ceiling = ceilingFor(spec, budgets.bundle.headroom);
        expect(typeof ceiling, `${g}.${key} must resolve to a numeric ceiling (a literal, or baseline + the headroom band)`).toBe("number");
        expect(Number.isFinite(ceiling), `${g}.${key}.ceiling must be finite`).toBe(true);
        if (spec.target != null) {
          // A target ABOVE its ceiling is nonsense — it would mean the aspiration is slower than
          // the maximum, and the "above target" report could never fire.
          expect(spec.target, `${g}.${key}.target must not exceed its ceiling`).toBeLessThanOrEqual(ceiling);
        }
        expect(typeof spec.what, `${g}.${key} needs a "what" describing the metric`).toBe("string");
      }
    }
  });

  it("every ABOVE-TARGET metric names the backlog item that owns closing the gap", () => {
    const owners = budgets.targetOwner || {};
    for (const g of groups) {
      for (const [key, spec] of metricsOf(g)) {
        // For a banded metric the honest comparison is against its BASELINE: a target below the
        // derived ceiling but equal to the baseline asserts no known gap, and inventing an owner
        // for the headroom band would be noise.
        const floor = typeof spec.baseline === "number" ? spec.baseline : ceilingFor(spec, budgets.bundle.headroom);
        if (spec.target != null && spec.target < floor) {
          expect(owners[`${g}.${key}`], `${g}.${key} is above target but has no targetOwner entry`).toBeTruthy();
        }
      }
    }
  });

  it("the Site-route allowlist is a non-empty list of chunk stems", () => {
    const allow = budgets.bundle.siteRouteAllowlist?.allow;
    expect(Array.isArray(allow)).toBe(true);
    expect(allow.length).toBeGreaterThan(0);
    // Stems only — a content hash here would break on the next build.
    for (const s of allow) expect(s, `allowlist entry "${s}" looks hashed`).not.toMatch(/-[A-Za-z0-9_-]{8,}$/);
  });

  it("siteRouteChunks ceiling matches the allowlist length", () => {
    // If these drift apart, one of the two guards stops meaning what it says.
    expect(budgets.bundle.siteRouteChunks.ceiling).toBe(budgets.bundle.siteRouteAllowlist.allow.length);
  });
});

describe("no workspace is warmed at boot (NEW-9)", () => {
  it("modulePrefetch exposes no idle/boot warm entry point", () => {
    const src = read("src/app/modulePrefetch.js");
    // prefetchOnIdle was the boot-time warm that fetched ~805 KB of route-irrelevant chunks
    // ahead of first paint. Its absence is the invariant; prefetchModule (intent-driven) stays.
    expect(src).not.toMatch(/export\s+function\s+prefetchOnIdle/);
    expect(src).toMatch(/export\s+function\s+prefetchModule/);
  });

  it("the Shell does not schedule a prefetch from a timer or idle callback", () => {
    const src = read("src/app/Shell.jsx");
    const offenders = [];
    // Strip comments first: the file explains the removed behaviour in prose, and prose must
    // not trip the guard.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    if (/requestIdleCallback/.test(code)) offenders.push("requestIdleCallback");
    if (/prefetchOnIdle/.test(code)) offenders.push("prefetchOnIdle");
    if (/setTimeout\s*\([^)]*prefetch/i.test(code)) offenders.push("setTimeout(...prefetch)");
    expect(offenders, `Shell.jsx schedules a boot-time prefetch via: ${offenders.join(", ")}`).toEqual([]);
  });

  it("workspace warming is still wired to navigation intent, so switching stays fast", () => {
    // The counterpart assertion: having removed the boot warm, the intent-driven warm must
    // survive, or module switching silently regresses instead.
    const header = read("src/shared/ui/AppHeader.jsx");
    expect(header).toMatch(/onMouseEnter[^\n]*prefetchModule/);
    expect(header).toMatch(/onPointerDown[^\n]*prefetchModule/);
  });
});

/* ── the frame-sampling guard (2026-07-29) ─────────────────────────────────────────────────
 * rAF is SUSPENDED in a backgrounded tab and reports nothing about it, so a frame median can
 * be computed from a starved sample and look entirely plausible — which is how the previous
 * frame ceilings were seeded. These pin the rule that now refuses to report such a sample.
 */
describe("a frame-time sample is only reported when it can be stood behind", () => {
  const good = { visibility: "visible", samples: 160, gestureMs: 2700 };

  it("passes a genuine ~60fps sample from a visible tab", () => {
    expect(frameSamplingFault(good)).toBeNull();
    expect(observedFps(160, 2700)).toBeCloseTo(59.3, 1);
  });

  it("REFUSES a hidden tab, whatever the sample looks like", () => {
    // The exact live reading: the tab reported "hidden" and six real drags produced 0 frames.
    expect(frameSamplingFault({ ...good, visibility: "hidden", samples: 0 })).toMatch(/suspends requestAnimationFrame/);
    // …and it refuses even when the starved sample would have produced a plausible median,
    // which is the case that actually committed a bad ceiling.
    expect(frameSamplingFault({ ...good, visibility: "hidden" })).toMatch(/"hidden", not "visible"/);
  });

  it("REFUSES a visible tab whose frame rate is implausible for the gesture", () => {
    // 316 frames where ~1500 were due — the middle of the throttling range, the dangerous one.
    expect(frameSamplingFault({ visibility: "visible", samples: 316, gestureMs: 25000 })).toMatch(/plausibility floor/);
    expect(frameSamplingFault({ visibility: "visible", samples: 0, gestureMs: 1500 })).toMatch(/0 frames/);
  });

  it("a zero-length gesture reads as starved, never as a silent pass", () => {
    expect(observedFps(10, 0)).toBe(0);
    expect(frameSamplingFault({ visibility: "visible", samples: 10, gestureMs: 0 })).toMatch(/plausibility floor/);
  });

  it("the floor sits below any plausible REAL frame cost, so it catches suspension only", () => {
    // A genuinely bad 20ms median (50fps) must still be measurable — that is the thing the
    // budget exists to see. Only suspension-grade starvation is rejected.
    expect(MIN_PLAUSIBLE_FPS).toBeLessThan(50);
    expect(frameSamplingFault({ visibility: "visible", samples: 135, gestureMs: 2700 })).toBeNull();
  });

  it("the committed frame budgets record the withdrawn seed and the instrument that replaced it", () => {
    for (const k of ["frameMedianMs", "frameP90Ms"]) {
      const spec = budgets.runtime[k];
      expect(spec.seededFrom, `${k} must name the instrument it was seeded from`).toMatch(/perf-harness\.mjs/);
      expect(spec.note, `${k} must say the old seed is withdrawn`).toMatch(/WITHDRAWN|withdrawal/);
    }
  });
});
