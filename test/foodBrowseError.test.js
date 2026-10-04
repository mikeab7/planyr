// B<PENDING> (2026-10-04) — Food map: a failed browse call must be VISIBLE and LOGGED, and the
// RPC's PostGIS operator must stay schema-qualified under its pinned search_path.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const inserts = [];
const rpcResult = { data: null, error: { code: "42883", message: "operator does not exist: extensions.geography && extensions.geography" } };
vi.mock("../src/workspaces/food/lib/supabaseClient.js", () => ({
  supabaseConfigured: () => true,
  supabase: {
    rpc: vi.fn(async () => rpcResult),
    from: vi.fn((t) => ({ insert: vi.fn(async (row) => { inserts.push({ t, row }); return { error: null }; }) })),
  },
}));

// Leaflet touches `window` at import; renderToStaticMarkup never runs effects, so a stub is enough.
vi.mock("leaflet", () => { const f = () => new Proxy(function () {}, { get: () => f(), apply: () => f(), construct: () => f() }); return { default: f() }; });
vi.mock("leaflet/dist/leaflet.css", () => ({}));

const { fetchPlacesInBounds, reportBrowseError, BROWSE_ERROR_MESSAGE } = await import("../src/workspaces/food/lib/foodStore.js");
const FoodMap = (await import("../src/workspaces/food/components/FoodMap.jsx")).default;

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
beforeEach(() => { inserts.length = 0; });

describe("browse RPC error handling", () => {
  it("fetchPlacesInBounds hands the RPC error back instead of swallowing it", async () => {
    const r = await fetchPlacesInBounds({ south: 1, north: 2, west: 3, east: 4 });
    expect(r.error).toEqual(rpcResult.error);
    expect(r.data).toEqual([]);
  });

  it("reportBrowseError writes one client_errors row tagged food, and de-dupes within a minute", async () => {
    const t0 = Date.now() + 10_000_000;
    await reportBrowseError(rpcResult.error, t0);
    await reportBrowseError(rpcResult.error, t0 + 1000);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].t).toBe("client_errors");
    expect(inserts[0].row).toMatchObject({ module: "food", source: "food:browse-rpc" });
    expect(inserts[0].row.message).toContain("42883");
    await reportBrowseError(rpcResult.error, t0 + 61_000);
    expect(inserts).toHaveLength(2);
  });

  it("FoodMap shows the visible message + Retry when placesError is set, and nothing when it is not", () => {
    const base = { places: [], loggedPlaces: [], loggedIds: new Set(), manualPins: [], wishlistPlaces: [], wishlistManualPins: [], overpassPlaces: [] };
    const bad = renderToStaticMarkup(createElement(FoodMap, { ...base, placesError: BROWSE_ERROR_MESSAGE, onRetryPlaces: () => {} }));
    expect(bad).toContain('data-testid="food-browse-error"');
    expect(bad).toContain("Couldn&#x27;t load restaurants here");
    expect(bad).toContain('data-testid="food-browse-retry"');
    const ok = renderToStaticMarkup(createElement(FoodMap, base));
    expect(ok).not.toContain("food-browse-error");
  });

  it("FoodApp wires the error to the map and the logger", () => {
    const app = read("src/workspaces/food/FoodApp.jsx");
    expect(app).toMatch(/if \(error\) \{\s*reportBrowseError\(error\)/);
    expect(app).toContain("placesError={placesError}");
    expect(app).toContain("onRetryPlaces=");
  });
});

describe("browse RPC SQL keeps the PostGIS operator schema-qualified", () => {
  for (const f of ["src/workspaces/food/db/food.sql", "src/workspaces/food/db/food_browse_qualify_gis_operator.sql"]) {
    it(`${f} uses OPERATOR(extensions.&&), never a bare geom &&`, () => {
      const sql = read(f).split("\n").map((l) => l.replace(/--.*$/, "")).join("\n"); // code only, not comments
      expect(sql).toContain("geom OPERATOR(extensions.&&) extensions.st_makeenvelope(");
      expect(sql).not.toMatch(/geom\s+&&\s/);
    });
  }
  it("the DB guard test exists and is registered with the verdict runner", () => {
    expect(read("src/workspaces/food/db/test/food_browse_rpc.test.sql")).toContain("food_places_in_bounds_sampled");
    expect(read("scripts/db-test-verdict.mjs")).toContain('"food_browse_rpc.test.sql"');
  });
});
