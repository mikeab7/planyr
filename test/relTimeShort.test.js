/* relTimeShort — NEW-1 / B2224000. `toLocaleDateString` builds a fresh Intl.DateTimeFormat per call (~1.5 ms); the switcher renders a row per project
 * on every header render, so an account of 143 plans spent ~213 ms of one plan open there. Same strings, one formatter. */
import { describe, it, expect } from "vitest";
import { relTimeShort } from "../src/shared/projects/projectSwitcherModel.js";

describe("relTimeShort", () => {
  const now = Date.UTC(2026, 9, 8, 18, 0, 0);
  it("keeps its short forms", () => {
    expect(relTimeShort(now - 20e3, now)).toBe("now");
    expect(relTimeShort(now - 5 * 60e3, now)).toBe("5m");
    expect(relTimeShort(now - 3 * 3600e3, now)).toBe("3h");
    expect(relTimeShort(now - 2 * 86400e3, now)).toBe("2d");
    expect(relTimeShort(now - 15 * 86400e3, now)).toBe("2w");
    expect(relTimeShort(null, now)).toBe("");
  });
  it("older than a month: the SAME string toLocaleDateString gave, for many dates", () => {
    for (let i = 0; i < 60; i++) {
      const t = now - (31 + i * 6) * 86400e3;
      expect(relTimeShort(t, now)).toBe(new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
    }
  });
  it("is far cheaper than a toLocaleDateString per row (a 143-plan list; ratio, not a wall-clock figure)", () => {
    const ts = Array.from({ length: 300 }, (_, i) => now - (40 + (i % 150)) * 86400e3);
    relTimeShort(ts[0], now);                                   // build the formatter outside the timed loop
    const t0 = performance.now(); ts.forEach((t) => relTimeShort(t, now)); const fast = performance.now() - t0;
    const t1 = performance.now(); ts.forEach((t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })); const slow = performance.now() - t1;
    expect(slow).toBeGreaterThan(fast * 4);
  });
});
