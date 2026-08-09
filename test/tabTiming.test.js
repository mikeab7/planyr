/* ⛔ NEW-4 — A TIMING FROM A BACKGROUND TAB IS VOID IF THE HARNESS PACES WITH setTimeout.
 *
 * The measurement that produced this rule: one double-click gesture on the owner's real plan read
 * **3,156 ms and 2,992 ms** from a probe whose tab was `visibilityState === "hidden"` and which
 * paced itself with `setTimeout`. Same gesture, same build, same tab, same hidden state, ONLY the
 * pacing primitive changed — a MessageChannel yield — and it read **138–182 ms** end to end.
 * Chrome clamps `setTimeout` in a hidden tab, so the harness was timing the clamp.
 *
 * ⛔ THE REASON THIS IS A GUARD AND NOT A NOTE: the first appearance of this trap in the program
 * produced an obvious failure and cost one round of probing. The second produced a PLAUSIBLE number
 * that reached the owner and was on its way onto two perf backlog items before being caught. A
 * self-consistent wrong number is strictly more dangerous than a crash, and nothing downstream can
 * tell it from a right one — so the check belongs at the source, in code the harnesses run.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { visibilityVerdict, rafVerdict, timingProvenance } from "../ui-audit/lib/tabTiming.mjs";

describe("the visibility verdict", () => {
  it('passes ONLY on a literally visible tab', () => {
    expect(visibilityVerdict("visible").ok).toBe(true);
  });

  it("refuses a hidden tab and says why, in the message a harness will print", () => {
    const v = visibilityVerdict("hidden", { harness: "perf-harness" });
    expect(v.ok).toBe(false);
    expect(v.state).toBe("hidden");
    expect(v.message).toMatch(/perf-harness/);
    expect(v.message).toMatch(/VOID/);
    expect(v.message).toMatch(/setTimeout/);
  });

  it("refuses an UNREADABLE state too — a harness that cannot check cannot vouch", () => {
    const v = visibilityVerdict(undefined);
    expect(v.ok).toBe(false);
    expect(v.state).toBe("unreadable");
  });

  it("refuses every other state rather than allow-listing what it has seen", () => {
    for (const s of ["prerender", "unloaded", "", null, 0]) expect(visibilityVerdict(s).ok).toBe(false);
  });

  it("the provenance line names the state, so a number carries its own worth", () => {
    expect(timingProvenance("visible", { paced: true })).toMatch(/visibilityState="visible"/);
    expect(timingProvenance("visible", { paced: true })).toMatch(/MessageChannel/);
    expect(timingProvenance("hidden")).not.toMatch(/MessageChannel/);
  });
});

/* ⛔ CLAUSE 2 — GEOMETRY, and it is the more dangerous half. On the owner's hidden tab
 * `requestAnimationFrame` did not fire ONCE in two seconds, so a CDP wheel updated the app's STATE
 * correctly (`data-view-ppf` / `data-render-ppf` 0.0501 → 0.1062, a clean 2× zoom) while the pond's
 * DOM geometry did not move at all — centre (892.9, 248), width 143.4 px, identical to three wheel
 * gestures earlier, to one decimal place.
 *
 * A throttled timer gives a wrong NUMBER. A suspended rAF gives a wrong PICTURE THAT IS INTERNALLY
 * CONSISTENT: boxes, positions, hit tests and screenshots all agree with each other and all describe
 * a view the app already left. It cost one false lead before it was caught — an apparent
 * anchored-zoom defect against B1449 / B258992 / V56000, REFUTED as a stale frame. */
describe("the rAF-liveness verdict — the positive control visibilityState cannot give", () => {
  it("passes when a frame callback ran", () => {
    expect(rafVerdict(true).ok).toBe(true);
  });

  it("refuses a wedged frame loop and says the DOM is what is void, not the clock", () => {
    const v = rafVerdict(false, { harness: "detect-view-recompute", windowMs: 1200 });
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/detect-view-recompute/);
    expect(v.message).toMatch(/1200 ms/);
    expect(v.message).toMatch(/VOID/);
    expect(v.message, "the message must name the trap: state updates, the drawing does not")
      .toMatch(/state attributes/);
  });

  it("is asked SEPARATELY from visibility — a tab can claim visible with its frame loop wedged", () => {
    // Both verdicts pass on their own inputs; the precondition requires BOTH, which is the point.
    expect(visibilityVerdict("visible").ok).toBe(true);
    expect(rafVerdict(false).ok).toBe(false);
  });
});

/* ⛔ A RULE NOBODY'S CODE CONSULTS IS NOT A GUARD (the owner's words, filing this item). The rule
 * lives in /CLAUDE.md and in ui-audit/lib/tabTiming.mjs — this is what makes the harnesses RUN it.
 *
 * ⛔ AND IT IS UNIVERSAL, NOT A LIST, BECAUSE CLAUSE 2 MADE A LIST INDEFENSIBLE. The first version
 * of this guard named the harnesses that take wall-clock readings — 28 of them. Clause 2 (geometry)
 * then swept in nearly every other one, and for a real reason rather than a loose heuristic: almost
 * every harness here clicks "Zoom to fit" and then measures a bounding box, which is exactly the
 * pattern that returns a stale frame on a hidden tab. So the precondition is required of EVERY
 * harness that drives a browser. There is no list left to rot, and a new harness cannot be written
 * without it. */
describe("every browser-driving harness proves its tab is measurable before it measures", () => {
  const dir = fileURLToPath(new URL("../ui-audit/", import.meta.url));
  const driving = readdirSync(dir)
    .filter((f) => f.endsWith(".mjs"))
    .filter((f) => /chromium\.launch\(/.test(readFileSync(dir + f, "utf8")));

  /* No exemptions today, and the set is deliberately empty rather than absent: an exemption has to
   * be written down WITH ITS REASON, so the next reader can judge it. */
  const EXEMPT = new Set([]);

  it("the sweep actually found harnesses (an empty set would pass this file trivially)", () => {
    expect(driving.length).toBeGreaterThan(300);
  });

  it.each(driving.filter((f) => !EXEMPT.has(f)))("%s asserts its tab is measurable", (f) => {
    const s = readFileSync(dir + f, "utf8");
    expect(s, "missing the import from ui-audit/lib/tabTiming.mjs").toMatch(/import \{ assertMeasurable \} from "\.\/lib\/tabTiming\.mjs";/);
    expect(s, "imports the precondition but never calls it").toMatch(/await assertMeasurable\(/);
  });

  /* The call must name the harness, so a failure says WHICH run is void rather than "a page". */
  it("each call names its own harness", () => {
    const unnamed = driving.filter((f) => {
      const s = readFileSync(dir + f, "utf8");
      return !new RegExp(`assertMeasurable\\([^,]+, "${f.slice(0, -4).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\)`).test(s);
    });
    expect(unnamed, "these harnesses call the precondition without naming themselves").toEqual([]);
  });
});
