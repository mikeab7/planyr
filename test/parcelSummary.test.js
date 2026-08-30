import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";

/* B849344 — the Sites panel and map pin used to answer "does this site have a boundary, and how
 * big is it" from `sites.data->'parcels'`, a mirror the cloud row keeps EMPTY on every push since
 * the B672 element-sync cutover (see cloudSync.js's slimForCloud). The real geometry lives in
 * `site_elements` (kind='parcel') rows; `summarizeParcelRows` turns a flat fetch of those rows
 * into the per-site canonical answer, and `cloudParcelRows` is the network half that feeds it.
 * MapFinder.jsx's `siteBoundaryInfo`/`siteDrawParcels` (which consume the summary) are covered in
 * test/siteBoundary.test.js.
 *
 * Mock the supabase client (same pattern as test/cloudListIdIntegrity.test.js) so this runs
 * without a network/config. Hoisted holder — a vi.mock factory can't close over a normal var.
 */
const h = vi.hoisted(() => ({ rows: [], error: null }));
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: {
    from: (t) => {
      if (t !== "site_elements") throw new Error(`unexpected table ${t}`);
      return {
        // B868961 — fetchParcelSummaries now pages via .range(); this fixture's whole portfolio
        // fits in one page, so a single call always comes back short and the walk stops there.
        select: () => ({
          eq: () => ({
            is: () => ({
              range: async () => ({ data: h.rows, error: h.error }),
            }),
          }),
        }),
      };
    },
  },
  supabaseRest: () => ({ url: "", anon: "" }),
  currentAccessToken: () => null,
}));

import { summarizeParcelRows } from "../src/workspaces/site-planner/lib/parcelSummary.js";
import { cloudParcelRows } from "../src/workspaces/site-planner/lib/cloudSync.js";

const ring = (w = 100, h = 100) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const ringAt = (x0, y0, w, h) => [{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h }];

describe("summarizeParcelRows (pure)", () => {
  it("groups rows by site_id and dissolves each site's acreage from its parcel geometry", () => {
    const p2 = ring(330, 330);            // 2.5 ac
    const p3 = ringAt(400, 0, 66, 660);   // 1 ac, offset so it doesn't overlap p2
    const rows = [
      { site_id: "bain", data: { id: "p1", points: ring(660, 660) } },   // 10 ac
      { site_id: "hoffmeister", data: { id: "p2", points: p2 } },
      { site_id: "hoffmeister", data: { id: "p3", points: p3 } },
    ];
    const out = summarizeParcelRows(rows);
    expect(Object.keys(out).sort()).toEqual(["bain", "hoffmeister"]);
    expect(out.bain.count).toBe(1);
    expect(out.bain.acres).toBeCloseTo(10, 3);
    expect(out.hoffmeister.count).toBe(2);
    expect(out.hoffmeister.acres).toBeCloseTo(3.5, 3);
    expect(out.hoffmeister.parcels).toEqual([{ id: "p2", points: p2 }, { id: "p3", points: p3 }]);
  });

  it("a site with zero live rows is simply absent from the result (never a zero-acre entry)", () => {
    const out = summarizeParcelRows([{ site_id: "bain", data: { id: "p1", points: ring() } }]);
    expect(out["green-river"]).toBeUndefined();
  });

  it("ignores malformed rows instead of throwing", () => {
    const out = summarizeParcelRows([null, {}, { site_id: "x" }, { data: { id: "p1" } }, { site_id: "x", data: { id: "p1", points: ring() } }]);
    expect(Object.keys(out)).toEqual(["x"]);
    expect(out.x.count).toBe(1);
  });

  it("empty/undefined input returns an empty summary", () => {
    expect(summarizeParcelRows([])).toEqual({});
    expect(summarizeParcelRows(undefined)).toEqual({});
  });
});

describe("cloudParcelRows", () => {
  it("fetches every live parcel row (no uid filter needed — RLS scopes it) as raw rows, undissolved", async () => {
    h.rows = [
      { site_id: "s1", data: { id: "p1", points: ring(660, 660) } },
      { site_id: "s2", data: { id: "p2", points: ring(330, 330) } },
    ];
    h.error = null;
    const r = await cloudParcelRows("uid-1");
    expect(r.ok).toBe(true);
    expect(r.rows).toEqual(h.rows);
    // composes with summarizeParcelRows exactly like the pure-module tests above
    const summary = summarizeParcelRows(r.rows);
    expect(summary.s1.acres).toBeCloseTo(10, 3);
    expect(summary.s2.acres).toBeCloseTo(2.5, 3);
  });

  it("no uid → ok:false without querying (nothing to fetch)", async () => {
    const r = await cloudParcelRows(null);
    expect(r).toEqual({ ok: false, rows: [] });
  });

  it("a real fetch error surfaces as ok:false (LOUD-FAILURE — never a silently empty portfolio)", async () => {
    h.rows = []; h.error = { message: "down" };
    const r = await cloudParcelRows("uid-1");
    expect(r.ok).toBe(false);
    h.error = null; // reset for later tests in this file
  });
});

// ⛔ B849344 REGRESSION GUARD — see cloudParcelRows's own header comment for the full story: a
// first version of this fix imported summarizeParcelRows (→ polyClip.js → clipper-lib, one of
// vite.config.js's MAP_VENDOR packages) directly into cloudSync.js. cloudSync.js is reachable
// from the app SHELL's EAGER import graph (Shell.jsx and shared/projects/projects.js both
// static-import storage.js, which static-imports cloudSync.js, for every route) — not just from
// the Site Planner's lazy chunk — so that edge dragged the whole map-vendor chunk into every
// route's shared bundle (measured: the Notes route's JS jumped 679.9 KB → 1003.1 KB, tripping
// its perf budget by 45%). Source-sweep so this can't silently come back through a different
// import.
describe("cloudSync.js stays free of geometry-math imports (map-vendor merge guard)", () => {
  it("does not import polyClip.js or parcelSummary.js", () => {
    const src = readFileSync(new URL("../src/workspaces/site-planner/lib/cloudSync.js", import.meta.url), "utf8");
    const bannedImports = src.match(/^import .*/gm)?.filter((line) => /polyClip\.js|parcelSummary\.js/.test(line)) || [];
    expect(bannedImports, `cloudSync.js must not import: ${bannedImports.join(" | ")}`).toEqual([]);
  });
});
