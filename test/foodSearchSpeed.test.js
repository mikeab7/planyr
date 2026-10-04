// NEW-1 (Food search speed, 2026-10-04) — the box answers faster WITHOUT changing what it returns.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createSearchSession, carryOverRows, searchKey } from "../src/workspaces/food/lib/searchSession.js";

const src = (p) => readFileSync(new URL(`../src/workspaces/food/${p}`, import.meta.url), "utf8");
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const C = { lat: 29.76, lon: -95.37 };

describe("searchSession — cancel, drop out-of-order, cache", () => {
  it("a stale response arriving AFTER a newer query never replaces the newer results", async () => {
    const gates = {};
    const run = (q) => { gates[q] = deferred(); return gates[q].promise; };
    const s = createSearchSession({ run });
    const first = s.search("ta", C);
    const second = s.search("tacos", C);
    gates.tacos.resolve({ data: [{ id: "new" }], error: null });
    const r2 = await second;
    gates.ta.resolve({ data: [{ id: "old" }], error: null }); // the slow, superseded answer lands last
    const r1 = await first;
    expect(r2.stale).toBe(false);
    expect(r2.data).toEqual([{ id: "new" }]);
    expect(r1.stale).toBe(true); // the box drops it
  });

  it("a newer query aborts the in-flight request", async () => {
    const signals = [];
    const run = (q, c, signal) => { signals.push(signal); return new Promise(() => {}); };
    const s = createSearchSession({ run });
    s.search("pi", C); s.search("pizza", C);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    s.cancel();
    expect(signals[1].aborted).toBe(true);
  });

  it("an aborted or failed answer is never cached; a good one is, per query AND map centre", async () => {
    let calls = 0;
    const run = async (q) => { calls += 1; return q === "bad" ? { data: [], error: new Error("x") } : { data: [{ id: q }], error: null }; };
    const s = createSearchSession({ run });
    await s.search("bad", C); await s.search("bad", C);
    expect(calls).toBe(2);
    await s.search("pho", C);
    const hit = await s.search("PHO ", C); // case/space-blind
    expect(hit.cached).toBe(true);
    expect(calls).toBe(3);
    await s.search("pho", { lat: 29.9, lon: -95.4 }); // panned elsewhere: tie-break distance differs → refetch
    expect(calls).toBe(4);
    expect(searchKey("pho", C)).not.toBe(searchKey("pho", null));
  });

  it("returns exactly what the RPC returned — same rows, same order — fresh or from cache", async () => {
    const rows = [{ id: "b", sim: 1 }, { id: "a", sim: 1 }, { id: "c", sim: 0.5 }];
    const s = createSearchSession({ run: async () => ({ data: rows, error: null }) });
    const fresh = await s.search("tacos", C);
    const cached = await s.search("tacos", C);
    expect(fresh.data.map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(cached.data.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("the cache is bounded", async () => {
    const s = createSearchSession({ run: async (q) => ({ data: [{ id: q }], error: null }), max: 3 });
    for (const q of ["aa", "bb", "cc", "dd"]) await s.search(q, C);
    expect(s.peek("aa", C)).toBeUndefined();
    expect(s.peek("dd", C)).toBeTruthy();
  });
});

describe("carryOverRows — typing never empties the list while the answer is on its way", () => {
  const has = (n, q) => (n || "").toLowerCase().includes(q);
  const rows = [{ name: "Taco Bell" }, { name: "Tacos A Go Go" }, { name: "Torchy's" }];
  it("once answered for the current query, the rows are returned untouched", () => {
    expect(carryOverRows(rows, "tac", "tac", has)).toBe(rows);
  });
  it("while pending, rows that still match the typed text stay; the rest drop", () => {
    expect(carryOverRows(rows, "ta", "taco b", has).map((r) => r.name)).toEqual(["Taco Bell"]);
  });
  it("nothing loaded yet → nothing to carry", () => {
    expect(carryOverRows([], "", "ta", has)).toEqual([]);
  });
});

describe("SearchBox wiring (source guards)", () => {
  const box = src("components/SearchBox.jsx");
  it("⛔ saved-place rows render WITHOUT waiting for the RPC — the result list is not gated on `loading`", () => {
    expect(box).not.toMatch(/!loading && results\.map/);
    expect(box).toMatch(/\{results\.map\(\(p\) =>/);
    // and the "Searching…" line sits AFTER the rows, so the arriving answer never shoves them
    expect(box.indexOf("{results.map((p) =>")).toBeLessThan(box.indexOf("Searching…</div>}"));
  });
  it("uses the session (cancel / out-of-order / cache) and a short debounce", () => {
    expect(box).toMatch(/createSearchSession\(/);
    expect(box).toMatch(/session\.search\(/);
    expect(box).toMatch(/session\.peek\(/);
    expect(Number(box.match(/const DEBOUNCE_MS = (\d+);/)[1])).toBeLessThanOrEqual(150);
  });
  it("the store passes the AbortSignal through to the RPC", () => {
    const store = src("lib/foodStore.js");
    expect(store).toMatch(/searchPlacesByName\(query, center, signal\)/);
    expect(store).toMatch(/\.abortSignal\(signal\)/);
  });
});

// The SQL's two-step (similarity cutoff, then distance on the survivors) must equal the old
// "distance on everything, then sort + limit" for ANY data, ties included.
describe("food_places_search_by_name_fast — same rows, same order as the old body", () => {
  const cmp = (a, b) => b.sim - a.sim || ((a.d ?? Infinity) - (b.d ?? Infinity)) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const old = (rows, cap) => [...rows].sort(cmp).slice(0, cap);
  const fast = (rows, cap) => {
    const cut = [...rows].sort((a, b) => b.sim - a.sim).slice(0, cap).at(-1).sim;
    return rows.filter((r) => r.sim >= cut).sort(cmp).slice(0, cap);
  };
  it("agrees on randomised data with heavy ties (chains), at several caps", () => {
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let t = 0; t < 200; t++) {
      const rows = Array.from({ length: 5 + Math.floor(rnd() * 300) }, (_, i) => ({
        id: `r${i}`, name: `n${Math.floor(rnd() * 20)}`, sim: Math.round(rnd() * 4) / 4, d: Math.floor(rnd() * 40) + i * 1e-6,
      }));
      for (const cap of [1, 15, 60]) expect(fast(rows, cap).map((r) => r.id)).toEqual(old(rows, cap).map((r) => r.id));
    }
  });
  it("db/food.sql ships the fast function, the wrapper reads it, and the reference _raw stays", () => {
    const sql = src("db/food.sql");
    expect(sql).toContain("create or replace function public.food_places_search_by_name_fast(");
    expect(sql).toMatch(/where c\.sim >= cut\.s/);
    expect(sql).toMatch(/from public\.food_places_search_by_name_fast\(p_query, p_cap, p_center_lat, p_center_lon\) s/);
    expect(sql).toContain("create or replace function public.food_places_search_by_name_raw(");
    expect(sql).toMatch(/grant execute on function public\.food_places_search_by_name_fast\(text, integer, double precision, double precision\) to anon, authenticated/);
  });
});
