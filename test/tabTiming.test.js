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
import { visibilityVerdict, timingProvenance } from "../ui-audit/lib/tabTiming.mjs";

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

/* ⛔ A RULE NOBODY'S CODE CONSULTS IS NOT A GUARD (the owner's words, filing this item). The rule
 * exists in /CLAUDE.md and in ui-audit/lib/tabTiming.mjs — this is what makes the harnesses that
 * actually take wall-clock readings from a driven browser consult it, and what makes a new one
 * fail here rather than silently report a throttled number. */
describe("every browser-driving timing harness proves its tab is in the foreground", () => {
  const TIMING_HARNESSES = [
    "perf-harness", "interaction-degradation", "session-axes", "session-growth", "zoom-smoothness-ab",
    "verify-midgesture-zoom", "verify-font-blocking", "initial-load", "detect-view-recompute",
    "verify-view-independent", "zoom-reraster-arms", "verify-capture-pipe", "verify-perf-recorder",
    "count-pond-invocations", "verify-plan-switch-release",
    // …and the ones the folder sweep below found rather than memory: every harness that both drives
    // a browser and subtracts a clock from a mark, whether or not "perf" is in its name.
    "boot-tail", "diagnose-pan-commits", "diagnose-pond-pan", "diagnose-schedule-strand",
    "diagnose-zoom-cost", "stress-markup", "verify-b441-optimistic-parcel", "verify-b828-undo",
    "verify-b915-context-menu-viewport", "verify-new2-vertex-drag", "verify-parcel-resilience",
    "verify-scheduler-loader", "verify-v211-schedule-coldboot",
  ];
  const src = (n) => readFileSync(fileURLToPath(new URL(`../ui-audit/${n}.mjs`, import.meta.url)), "utf8");

  it.each(TIMING_HARNESSES)("%s calls assertForeground on its page", (name) => {
    const s = src(name);
    expect(s).toMatch(/import \{ assertForeground \} from "\.\/lib\/tabTiming\.mjs";/);
    expect(s).toMatch(new RegExp(`await assertForeground\\(page, "${name}"\\)`));
  });

  /* The list above is the thing that rots: a new timing harness lands, nobody adds it, and the
   * suite stays green while measuring less than it did. So the list is checked against the FOLDER —
   * anything that both drives a browser and reads a clock has to be either listed here or listed as
   * a deliberate exemption, with a reason. */
  const EXEMPT = new Set([
    // Reads a clock only to stamp a FIXTURE (`updatedAt: Date.now()`), never to measure elapsed time.
    // These are behavioural harnesses; a throttled tab changes nothing about what they assert.
  ]);

  it("no browser-driving harness MEASURES elapsed time without being listed or exempted", () => {
    const dir = fileURLToPath(new URL("../ui-audit/", import.meta.url));
    const unlisted = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".mjs")) continue;
      const name = f.slice(0, -4);
      if (TIMING_HARNESSES.includes(name) || EXEMPT.has(name)) continue;
      const s = readFileSync(dir + f, "utf8");
      if (!/chromium\.launch\(/.test(s)) continue;
      /* "MEASURES elapsed time" = subtracts two clock reads, or reports a duration it computed.
       * A bare `Date.now()` used as a fixture timestamp is not a measurement and does not count —
       * that distinction is why this check can be strict without drowning in false positives. */
      const measures = /(?:performance|Date)\.now\(\)\s*-\s*[A-Za-z_$]/.test(s)   // clock minus a MARK
        || /[A-Za-z_$][\w$]*\s*=\s*(?:performance|Date)\.now\(\)\s*-\s*/.test(s)
        || /\b(?:elapsed|durationMs|msElapsed)\b/.test(s);
      /* ⛔ `Date.now() - 3 * 86400000` is a FIXTURE timestamp ("three days ago"), not a measurement,
       * and matching it swept in 30 behavioural harnesses that time nothing. The distinction is
       * whether the clock is subtracted from a MARK (an identifier) or from a constant offset. */
      if (measures) unlisted.push(name);
    }
    expect(unlisted, "these harnesses time a driven browser but never prove the tab is foreground — "
      + "add them to TIMING_HARNESSES and wire assertForeground, or exempt them with a reason").toEqual([]);
  });
});
