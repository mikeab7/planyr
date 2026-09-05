import { describe, it, expect } from "vitest";
import { goingQuietPursuits, QUIET_DAYS } from "../src/workspaces/dashboard/lib/goingQuiet.js";

const NOW = Date.parse("2026-09-05T00:00:00Z");
const DAY = 86400000;

describe("goingQuietPursuits", () => {
  it("finds a live pursuit untouched for 30+ days", () => {
    const sites = [{ id: "a1", groupId: "g1", role: "pursuit", status: "active", updatedAt: NOW - 40 * DAY }];
    expect(goingQuietPursuits(sites, NOW).map((s) => s.groupId)).toEqual(["g1"]);
  });

  it("excludes a recently-touched pursuit", () => {
    const sites = [{ id: "a1", groupId: "g1", role: "pursuit", status: "active", updatedAt: NOW - 5 * DAY }];
    expect(goingQuietPursuits(sites, NOW)).toEqual([]);
  });

  it("excludes complete and dead — a settled project going quiet is expected, not a signal", () => {
    const sites = [
      { id: "a1", groupId: "g1", role: "pursuit", status: "complete", updatedAt: NOW - 60 * DAY },
      { id: "b1", groupId: "g2", role: "pursuit", status: "dead", updatedAt: NOW - 60 * DAY },
    ];
    expect(goingQuietPursuits(sites, NOW)).toEqual([]);
  });

  it("excludes tracked market records — not a pursuit", () => {
    const sites = [{ id: "a1", groupId: "g1", role: "tracked", status: "active", updatedAt: NOW - 60 * DAY }];
    expect(goingQuietPursuits(sites, NOW)).toEqual([]);
  });

  it("one row per project, taken from its most-recently-updated plan", () => {
    const sites = [
      { id: "a1", groupId: "g1", role: "pursuit", status: "active", updatedAt: NOW - 60 * DAY },
      { id: "a2", groupId: "g1", role: "pursuit", status: "active", updatedAt: NOW - 2 * DAY }, // a newer plan in the same project
    ];
    expect(goingQuietPursuits(sites, NOW)).toEqual([]); // the project WAS touched recently
  });

  it("sorts oldest-touched first", () => {
    const sites = [
      { id: "a1", groupId: "g1", role: "pursuit", status: "active", updatedAt: NOW - 35 * DAY },
      { id: "b1", groupId: "g2", role: "pursuit", status: "active", updatedAt: NOW - 90 * DAY },
    ];
    expect(goingQuietPursuits(sites, NOW).map((s) => s.groupId)).toEqual(["g2", "g1"]);
  });

  it("QUIET_DAYS is 30", () => {
    expect(QUIET_DAYS).toBe(30);
  });
});
