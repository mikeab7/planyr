import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setNOW, computeDisplayHealth, rolledStatusLeaf, leafFocusStatus, hideStatusOf } from "../ui-audit/stress/scheduler-engine.mjs";

/* B717 — Focus must not hide overdue tasks that display red "Needs Attn.".
 *
 * The scheduler grid colours a task via computeDisplayHealth (which applies the
 * conditional-format rules, e.g. overdueRed). The Focus/filter funnel decides visibility
 * from the flatTasks `rolledStatus` classification. The bug: rolledStatus's leaf branch
 * read the RAW stored health, so an overdue Not-Started (gray) task rendered red on the
 * grid yet was classed "upcoming" and HIDDEN by Focus — two sources of truth diverging.
 *
 * Fix: the leaf branch now classifies via computeDisplayHealth (rolledStatusLeaf here), so
 * grid status and Focus visibility never disagree. These tests pin a deterministic "today"
 * and lock the leaf → focus-status → hideable mapping across the cfRules matrix. */

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

const TODAY = "2026-07-08";
beforeAll(() => setNOW(TODAY));

// leaf fixtures (all leaves — no children)
const overdueGray  = { id: 1, health: "gray",   end: "2026-06-17", percentComplete: 0 };   // past due, Not Started
const futureGray   = { id: 2, health: "gray",   end: "2026-12-01", percentComplete: 0 };   // not started, far off
const dueSoonGray  = { id: 3, health: "gray",   end: "2026-07-10", percentComplete: 0 };   // Not Started, within 7d
const greenDone    = { id: 4, health: "green",  end: "2026-06-01", percentComplete: 100 }; // complete
const paused       = { id: 5, health: "paused", end: "2026-06-17", percentComplete: 0 };   // on hold
const overdueYellow= { id: 6, health: "yellow", end: "2026-06-17", percentComplete: 20 };  // In Progress, past due

const RED_ON   = { cfRules: { overdueRed: true } };
const RED_OFF  = { cfRules: { overdueRed: false } };
const YELLOW_ON= { cfRules: { dueSoonYellow: true } };
const GREEN_ON = { cfRules: { completeGreen: true } };

// Convenience: is this leaf HIDDEN by Focus given these settings?
const hidden = (task, settings) => hideStatusOf(rolledStatusLeaf(task, settings)) !== null;

describe("B717: an overdue Not-Started task that displays red is NEVER hidden by Focus", () => {
  it("the exact repro: overdue gray leaf + overdueRed ON → red on the grid AND kept by Focus", () => {
    expect(computeDisplayHealth(overdueGray, RED_ON)).toBe("red");   // grid shows red "Needs Attn."
    expect(rolledStatusLeaf(overdueGray, RED_ON)).toBe("active");    // Focus classifies it active
    expect(hideStatusOf("active")).toBe(null);                       // active === keep
    expect(hidden(overdueGray, RED_ON)).toBe(false);                 // → NOT hidden
  });

  it("regression witness: the OLD raw-health path would have hidden it", () => {
    // Pre-fix, the leaf branch read raw health ("gray") → "upcoming" → hidden. This asserts the
    // divergence the fix closes (grid red vs. Focus "upcoming").
    expect(leafFocusStatus(overdueGray.health)).toBe("upcoming");
    expect(hideStatusOf(leafFocusStatus(overdueGray.health))).toBe("upcoming"); // would hide
    // ...whereas the display-health path keeps it:
    expect(rolledStatusLeaf(overdueGray, RED_ON)).not.toBe("upcoming");
  });

  it("rule-gated: with overdueRed OFF the same leaf is plain Not-Started → still hidden", () => {
    expect(computeDisplayHealth(overdueGray, RED_OFF)).toBe("gray");
    expect(rolledStatusLeaf(overdueGray, RED_OFF)).toBe("upcoming");
    expect(hidden(overdueGray, RED_OFF)).toBe(true);
  });
});

describe("B717: normal Focus hiding is preserved (no over-keeping)", () => {
  it("a not-started future task (overdueRed ON, not overdue) is still hidden", () => {
    expect(computeDisplayHealth(futureGray, RED_ON)).toBe("gray");
    expect(hidden(futureGray, RED_ON)).toBe(true);
  });

  it("a completed (green) leaf is still hidden as done", () => {
    expect(rolledStatusLeaf(greenDone, GREEN_ON)).toBe("done");
    expect(hidden(greenDone, GREEN_ON)).toBe(true);
  });

  it("a paused (on-hold) leaf is still hidden as paused", () => {
    expect(rolledStatusLeaf(paused, RED_OFF)).toBe("paused");
    expect(hidden(paused, RED_OFF)).toBe(true);
  });

  it("an overdue In-Progress (yellow) leaf was already kept and stays kept", () => {
    // overdueRed turns it red, but red and yellow both map to active → kept either way.
    expect(hidden(overdueYellow, RED_ON)).toBe(false);
    expect(hidden(overdueYellow, RED_OFF)).toBe(false);
  });
});

describe("B717 design choice: dueSoonYellow promotion also survives Focus (matches the grid)", () => {
  it("a Not-Started task due within 7 days shows yellow AND is kept when dueSoonYellow is ON", () => {
    expect(computeDisplayHealth(dueSoonGray, YELLOW_ON)).toBe("yellow");
    expect(rolledStatusLeaf(dueSoonGray, YELLOW_ON)).toBe("active");
    expect(hidden(dueSoonGray, YELLOW_ON)).toBe(false);
  });

  it("with dueSoonYellow OFF the same task is plain Not-Started → hidden", () => {
    expect(computeDisplayHealth(dueSoonGray, RED_OFF)).toBe("gray");
    expect(hidden(dueSoonGray, RED_OFF)).toBe(true);
  });
});

describe("B717 anti-drift: the single-source-of-truth fix is present in the real source", () => {
  const src = read("../public/sequence/index.html");
  const mjs = read("../ui-audit/stress/scheduler-engine.mjs");

  it("flatTasks captures settings and the leaf branch classifies via computeDisplayHealth", () => {
    expect(src).toMatch(/const settings = data\?\.settings;/);
    expect(src).toMatch(/const h = computeDisplayHealth\(byId\[id\], settings\);/);
  });

  it("the flatTasks memo depends on settings and NOW so Focus tracks the grid's overdue rollover", () => {
    expect(src).toMatch(/\}, \[proj, data\?\.settings, NOW\]\);/);
  });

  it("the engine mirror's computeDisplayHealth matches the source overdueRed rule", () => {
    const rule = /cf\.overdueRed && task\.end && task\.end < NOW && \(task\.percentComplete\|\|0\) < 100/;
    expect(src).toMatch(rule);
    expect(mjs).toMatch(rule);
  });
});
