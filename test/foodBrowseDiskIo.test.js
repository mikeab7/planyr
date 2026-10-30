// B2559168 — Supabase disk I/O budget. Two halves:
//  1. lib/browseReuse.js: a map move into an area an UNCAPPED answer already covers is not re-queried.
//  2. The two Food SQL functions that were the measured I/O drivers keep their fixed SHAPE
//     (source guards — the real proof is EXPLAIN on production, recorded on the B#).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { boundsContain, canReuseBrowse } from "../src/workspaces/food/lib/browseReuse.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const box = (south, north, west, east) => ({ south, north, west, east });
const BIG = box(29.0, 30.0, -96.0, -95.0);

describe("boundsContain", () => {
  it("is true for a box inside, and for an identical box", () => {
    expect(boundsContain(BIG, box(29.2, 29.8, -95.8, -95.2))).toBe(true);
    expect(boundsContain(BIG, BIG)).toBe(true);
  });
  it("is false when any one edge pokes out", () => {
    expect(boundsContain(BIG, box(28.9, 29.8, -95.8, -95.2))).toBe(false); // south
    expect(boundsContain(BIG, box(29.2, 30.1, -95.8, -95.2))).toBe(false); // north
    expect(boundsContain(BIG, box(29.2, 29.8, -96.1, -95.2))).toBe(false); // west
    expect(boundsContain(BIG, box(29.2, 29.8, -95.8, -94.9))).toBe(false); // east
  });
  it("never treats missing or non-numeric bounds as covered", () => {
    expect(boundsContain(null, BIG)).toBe(false);
    expect(boundsContain(BIG, null)).toBe(false);
    expect(boundsContain(BIG, box(NaN, 29.8, -95.8, -95.2))).toBe(false);
    expect(boundsContain(BIG, box("29.2", 29.8, -95.8, -95.2))).toBe(false);
  });
});

describe("canReuseBrowse", () => {
  const inside = box(29.2, 29.8, -95.8, -95.2);
  it("reuses an uncapped answer for a view inside it", () => {
    expect(canReuseBrowse({ bounds: BIG, capped: false, retry: 0 }, inside, 0)).toBe(true);
  });
  it("does NOT reuse a capped (sampled) answer — a smaller view needs its own denser sample", () => {
    expect(canReuseBrowse({ bounds: BIG, capped: true, retry: 0 }, inside, 0)).toBe(false);
  });
  it("does NOT reuse when there is no successful previous answer (first load, or the last one failed)", () => {
    expect(canReuseBrowse(null, inside, 0)).toBe(false);
    expect(canReuseBrowse(undefined, inside, 0)).toBe(false);
  });
  it("always goes to the database on Retry (a new retry value)", () => {
    expect(canReuseBrowse({ bounds: BIG, capped: false, retry: 0 }, inside, 1)).toBe(false);
  });
  it("does NOT reuse for a view that leaves the covered area", () => {
    expect(canReuseBrowse({ bounds: BIG, capped: false, retry: 0 }, box(29.2, 30.5, -95.8, -95.2), 0)).toBe(false);
  });
});

describe("FoodApp wiring", () => {
  const app = read("src/workspaces/food/FoodApp.jsx");
  it("asks canReuseBrowse before fetching, records only successes, clears the record on error", () => {
    expect(app).toMatch(/canReuseBrowse\(lastBrowseRef\.current, bounds, placesRetry\)/);
    expect(app).toMatch(/lastBrowseRef\.current = \{ bounds, capped, retry: placesRetry \}/);
    expect(app).toMatch(/if \(error\) \{\s*lastBrowseRef\.current = null;/);
  });
});

describe("food SQL keeps the shape that stopped the temp-file spill", () => {
  const sql = read("src/workspaces/food/db/food_browse_and_address_disk_io.sql");
  const foodSql = read("src/workspaces/food/db/food.sql");

  for (const [label, text] of [["migration file", sql], ["food.sql", foodSql]]) {
    it(`${label}: browse ranks NARROW rows and gives the function its own sort budget`, () => {
      const start = text.indexOf("create or replace function public.food_places_in_bounds_sampled(");
      const body = text.slice(start, text.indexOf("$$;", start));
      expect(body).toMatch(/set work_mem = '\d+MB'/);
      // the ranking CTE must not carry the display columns (that is what sorted wide rows to disk)
      const matched = body.slice(body.indexOf("with matched as ("), body.indexOf("ranked as ("));
      expect(matched).not.toMatch(/\bname\b|\baddress\b|\bcuisine\b|\bbrand\b/);
      // wide columns come from a join-back on the primary key for the survivors only
      expect(body).toMatch(/join public\.food_places f on f\.id = p\.id/);
      expect(body).toMatch(/OPERATOR\(extensions\.&&\)/); // the 2026-10-04 operator fix stays
    });

    it(`${label}: address search inlines each word as a literal LIKE so the trigram index can serve it`, () => {
      const start = text.indexOf("create or replace function public.food_places_search_by_address(");
      const body = text.slice(start, text.indexOf("$fn$;", start));
      expect(body).toMatch(/language plpgsql/);
      expect(body).toMatch(/format\('lower\(fp\.address\) like %L'/);
      expect(body).toMatch(/return query execute/);
      // the un-indexable per-row form must not come back
      expect(body).not.toMatch(/not exists \(select 1 from unnest\(q\.words\)/);
    });
  }

  it("the superseded operator-fix file warns that re-running it would regress the browse function", () => {
    expect(read("src/workspaces/food/db/food_browse_qualify_gis_operator.sql")).toMatch(/SUPERSEDED \(B2559168/);
  });
});
