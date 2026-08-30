import { describe, it, expect, vi } from "vitest";

/* B845089 (NEW-2) — "when was this project actually last worked on," replacing `sites.updated_at`
 * (which only advances on a header-level change — a rename, opening the plan — not a drawing
 * edit; see lib/siteRecency.js's own header for the measured production drift, 20.7–64.6 hours).
 * Mock the supabase client (same pattern as test/parcelSummary.test.js) so cloudElementRecency
 * runs without a network/config.
 */
const h = vi.hoisted(() => ({ rows: [], error: null }));
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: {
    from: (t) => {
      if (t !== "site_elements") throw new Error(`unexpected table ${t}`);
      return {
        select: () => ({
          is: async () => ({ data: h.rows, error: h.error }),
        }),
      };
    },
  },
  supabaseRest: () => ({ url: "", anon: "" }),
  currentAccessToken: () => null,
}));

import { summarizeElementRecency, groupRecencyMs, lastEditedLabel } from "../src/workspaces/site-planner/lib/siteRecency.js";
import { cloudElementRecency } from "../src/workspaces/site-planner/lib/cloudSync.js";

const HOUR = 3600_000, DAY = 24 * HOUR;

describe("summarizeElementRecency (pure)", () => {
  it("takes the MAX updated_at per site_id, across every live element row", () => {
    const rows = [
      { site_id: "bain", updated_at: "2026-08-01T00:00:00Z" },
      { site_id: "bain", updated_at: "2026-08-03T00:00:00Z" }, // later — wins
      { site_id: "bain", updated_at: "2026-08-02T00:00:00Z" },
      { site_id: "silvestri", updated_at: "2026-08-05T00:00:00Z" },
    ];
    const out = summarizeElementRecency(rows);
    expect(out.bain).toBe(new Date("2026-08-03T00:00:00Z").getTime());
    expect(out.silvestri).toBe(new Date("2026-08-05T00:00:00Z").getTime());
  });

  it("a site with zero live element rows is simply absent (never a fabricated 0)", () => {
    const out = summarizeElementRecency([{ site_id: "bain", updated_at: "2026-08-01T00:00:00Z" }]);
    expect(out["green-river"]).toBeUndefined();
  });

  it("ignores malformed/unparseable rows instead of throwing", () => {
    const out = summarizeElementRecency([null, {}, { site_id: "x" }, { updated_at: "2026-01-01" }, { site_id: "x", updated_at: "not-a-date" }, { site_id: "x", updated_at: "2026-08-01T00:00:00Z" }]);
    expect(Object.keys(out)).toEqual(["x"]);
  });

  it("empty/undefined input returns an empty map", () => {
    expect(summarizeElementRecency([])).toEqual({});
    expect(summarizeElementRecency(undefined)).toEqual({});
  });
});

describe("groupRecencyMs (pure) — the GROUP's max, never one plan's", () => {
  const plan = (id, groupId, updatedAt) => ({ id, groupId, updatedAt });

  it("takes the max across every plan sharing a groupId, not just the panel's representative plan", () => {
    const sites = [plan("p1", "g1", 1000), plan("p2", "g1", 5000), plan("p3", "g2", 2000)];
    const out = groupRecencyMs(sites, {}); // no element rows — falls back to each plan's header updatedAt
    expect(out.g1).toBe(5000); // the SIBLING plan (p2) is more recent than p1, and wins
    expect(out.g2).toBe(2000);
  });

  it("prefers a plan's live element recency over its own header updatedAt when both exist", () => {
    const sites = [plan("p1", "g1", 1000)];
    const out = groupRecencyMs(sites, { p1: 9000 });
    expect(out.g1).toBe(9000);
  });

  it("a plan with no live element rows falls back to its OWN header updatedAt (never blank/Invalid Date for a never-drawn plan)", () => {
    const sites = [plan("p1", "g1", 4242)];
    const out = groupRecencyMs(sites, {}); // p1 never drawn — no site_elements rows at all
    expect(out.g1).toBe(4242);
  });

  it("a record predating grouping (no groupId) keys on its own id, matching storage.js's groupOf convention", () => {
    const sites = [{ id: "solo", groupId: null, updatedAt: 777 }];
    expect(groupRecencyMs(sites, {})).toEqual({ solo: 777 });
  });

  it("a plan with neither an element recency nor a parseable updatedAt is simply absent", () => {
    const sites = [{ id: "p1", groupId: "g1", updatedAt: null }];
    expect(groupRecencyMs(sites, {})).toEqual({});
  });

  it("ignores malformed entries instead of throwing", () => {
    expect(groupRecencyMs([null, {}, { id: "p1", groupId: "g1", updatedAt: 5 }], {})).toEqual({ g1: 5 });
  });
});

describe("lastEditedLabel (pure) — compact display, never 'Invalid Date'", () => {
  const now = new Date("2026-08-30T12:00:00Z").getTime();

  it("under a minute → 'now'", () => {
    expect(lastEditedLabel(now - 10_000, now)).toBe("now");
  });
  it("minutes → '5m'", () => {
    expect(lastEditedLabel(now - 5 * 60_000, now)).toBe("5m");
  });
  it("hours → '2h'", () => {
    expect(lastEditedLabel(now - 2 * HOUR, now)).toBe("2h");
  });
  it("just under a day → hours, not '1d'", () => {
    expect(lastEditedLabel(now - 23 * HOUR, now)).toBe("23h");
  });
  it("days → '3d'", () => {
    expect(lastEditedLabel(now - 3 * DAY, now)).toBe("3d");
  });
  it("a week or more → a short calendar date, no 'ago', no year in the current year", () => {
    const ms = now - 10 * DAY; // Aug 20, 2026
    const label = lastEditedLabel(ms, now);
    expect(label).not.toMatch(/ago|,\s*2026/);
    expect(label).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
  });
  it("a date in a PRIOR calendar year carries the year, so an old row can't be misread as recent", () => {
    const label = lastEditedLabel(new Date("2025-03-01T00:00:00Z").getTime(), now);
    expect(label).toMatch(/2025/);
  });
  it("null/unresolvable timestamp → null, so the caller renders its own placeholder rather than 'Invalid Date'", () => {
    expect(lastEditedLabel(null, now)).toBeNull();
    expect(lastEditedLabel(undefined, now)).toBeNull();
    expect(lastEditedLabel(NaN, now)).toBeNull();
  });
});

describe("cloudElementRecency", () => {
  it("fetches every live element row's { site_id, updated_at } (no uid filter needed — RLS scopes it)", async () => {
    h.rows = [{ site_id: "s1", updated_at: "2026-08-01T00:00:00Z" }, { site_id: "s2", updated_at: "2026-08-05T00:00:00Z" }];
    h.error = null;
    const r = await cloudElementRecency("uid-1");
    expect(r.ok).toBe(true);
    expect(r.rows).toEqual(h.rows);
    const summary = summarizeElementRecency(r.rows);
    expect(summary.s2).toBeGreaterThan(summary.s1);
  });

  it("no uid → ok:false without querying (nothing to fetch)", async () => {
    const r = await cloudElementRecency(null);
    expect(r).toEqual({ ok: false, rows: [] });
  });

  it("a real fetch error surfaces as ok:false (LOUD-FAILURE — never a silently empty/stale portfolio)", async () => {
    h.rows = []; h.error = { message: "down" };
    const r = await cloudElementRecency("uid-1");
    expect(r.ok).toBe(false);
    h.error = null; // reset for later tests in this file
  });
});

// ⛔ REGRESSION GUARD — MapFinder.jsx must sort "recent" by the group's real edit recency, never
// by `s.updatedAt` (`sites.updated_at`) directly, which is exactly the defect this item fixes.
describe("MapFinder.jsx no longer sorts 'recent' by the raw sites.updated_at mirror", () => {
  it("does not read b.updatedAt / a.updatedAt in the sort comparator", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/workspaces/site-planner/MapFinder.jsx", import.meta.url), "utf8");
    expect(src).toMatch(/lastEditedOf\(b\)/);
    expect(src).not.toMatch(/toMsAt\(b\.updatedAt\)/);
  });
});
