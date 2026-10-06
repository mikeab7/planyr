import { describe, it, expect } from "vitest";
import { groupSupport, isBareSlowTap, contextSummary } from "../src/workspaces/admin/lib/adminSupport.js";

const NOW = new Date("2026-10-05T12:00:00Z").getTime();
const day = (d) => new Date(NOW - d * 86_400_000).toISOString();
const t = (o) => ({ id: Math.random().toString(36), at: day(1), userId: "u1", email: "me@x.com", category: "slow", description: "", status: "open", ...o });

describe("support grouping (NEW-4)", () => {
  it("bare slow taps = slow with no description", () => {
    expect(isBareSlowTap(t())).toBe(true);
    expect(isBareSlowTap(t({ description: "  " }))).toBe(true);
    expect(isBareSlowTap(t({ description: "grid froze" }))).toBe(false);
    expect(isBareSlowTap(t({ category: "problem" }))).toBe(false);
  });
  it("collapses 11 bare taps from one account into one line: '11 slow taps, latest 12 days ago'", () => {
    const taps = Array.from({ length: 11 }, (_, i) => t({ at: day(12 + i) }));
    const { items, groups } = groupSupport(taps, { now: NOW });
    expect(items).toEqual([]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("11 slow taps, latest 12 days ago");
    expect(groups[0].tickets).toHaveLength(11);
  });
  it("written reports stay individual, one group per account", () => {
    const { items, groups } = groupSupport([t({ description: "froze", at: day(3) }), t({ category: "problem", description: "bug", at: day(2) }), t({ userId: "u2", email: "o@x.com" }), t()], { now: NOW });
    expect(items.map((x) => x.description)).toEqual(["bug", "froze"]); // newest first by default
    expect(groups.map((g) => g.who).sort()).toEqual(["me@x.com", "o@x.com"]);
    expect(groupSupport([t({ description: "a", at: day(5) }), t({ description: "b", at: day(1) })], { oldestFirst: true }).items.map((x) => x.description)).toEqual(["a", "b"]);
  });
  it("a single tap reads singular", () => { expect(groupSupport([t({ at: day(0.5) })], { now: NOW }).groups[0].label).toMatch(/^1 slow tap, latest/); });
  it("summarises context", () => { expect(contextSummary({ route: "site", build: "abc", viewportW: 100, viewportH: 50 })).toBe("site · build abc · 100×50"); expect(contextSummary(null)).toBe("—"); });
});
