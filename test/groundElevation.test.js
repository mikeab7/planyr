/* NEW-1 / NEW-2 / NEW-3 — the cached, non-blocking, bounded ground-elevation leg.
 *
 * The three properties these pin are the three that were measured wrong on the owner's own Bain
 * plan, and each of them is mutation-checked by construction (a fake sampler counts its calls, a
 * fake cache counts its reads and writes, and an injected clock makes the budget deterministic):
 *
 *   1. THE KEY IS THE EXACT REQUEST. A byte-identical query hits; ANY change to the geometry,
 *      sampleCount or interpolation misses. Serving elevation for the wrong ground is the whole
 *      failure mode, so a looser key would be the bug rather than an optimisation.
 *   2. IT NEVER GATES THE PANEL. A cache hit publishes with ZERO network waiting; a cold miss
 *      publishes an honest `pending` once the budget is spent and patches the number in later.
 *   3. NOTHING IS EVER ASSUMED. A failure is `unavailable` with the SERVICE NAMED, a no-data
 *      point is `void`, and neither ever produces a number.
 */
import { describe, it, expect, vi } from "vitest";
import {
  beginGroundElevation, groundCacheKey, groundTransectPath, groundElevNote, medianElevation,
  GROUND_SAMPLE_COUNT, GROUND_INTERPOLATION, GROUND_SERVICE, GROUND_TTL_MS, GROUND_TIMEOUT_MS,
} from "../src/workspaces/site-planner/lib/groundElevation.js";
import { profileQuery, M_TO_FT } from "../src/workspaces/site-planner/lib/elevation.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* A cache with the two methods the leg uses, and counters so "did it hit the network" is a
 * measured fact rather than an inference. */
function fakeCache(seed = null) {
  const store = new Map();
  if (seed) store.set(seed.key, { data: seed.data, ts: seed.ts });
  const c = {
    reads: 0, writes: 0,
    async readAsync(k) { c.reads++; const e = store.get(k); return e ? { data: e.data, ts: e.ts, ageMs: 0 } : null; },
    write(k, data) { c.writes++; store.set(k, { data, ts: c.writeTs ?? 0 }); },
    store,
  };
  return c;
}
const sampler = (values, { delayMs = 0, throws = null } = {}) => {
  const fn = (...args) => {
    fn.calls.push(args);
    return new Promise((res, rej) => setTimeout(() => (throws ? rej(throws) : res(values)), delayMs));
  };
  fn.calls = [];
  return fn;
};

// ---------------------------------------------------------------------------------------------
describe("NEW-1 — the key is the EXACT request, and it comes from the request builder", () => {
  it("is byte-stable for the same point (the property the owner verified live)", () => {
    expect(groundCacheKey(-95.795, 29.782)).toBe(groundCacheKey(-95.795, 29.782));
  });

  it("carries the request's own geometry string, sampleCount and interpolation", () => {
    const q = profileQuery(groundTransectPath(-95.795, 29.782), GROUND_SAMPLE_COUNT, GROUND_INTERPOLATION);
    const key = groundCacheKey(-95.795, 29.782);
    expect(key).toContain(q.geometry);
    expect(key).toContain(`n=${GROUND_SAMPLE_COUNT}`);
    expect(key).toContain(`i=${GROUND_INTERPOLATION}`);
    // …and the URL that FILLS the cache is built from the same call, so the two cannot drift.
    expect(q.url).toContain(encodeURIComponent(q.geometry));
    expect(q.url).toContain(`sampleCount=${GROUND_SAMPLE_COUNT}`);
  });

  it("MISSES on any change to the georeference, the transect, the count or the interpolation", () => {
    const base = groundCacheKey(-95.795, 29.782);
    expect(groundCacheKey(-95.7951, 29.782)).not.toBe(base);        // moved east
    expect(groundCacheKey(-95.795, 29.7821)).not.toBe(base);        // moved north
    expect(groundCacheKey(-95.795, 29.782, { halfSpanDeg: 0.0008 })).not.toBe(base);
    expect(groundCacheKey(-95.795, 29.782, { sampleCount: 10 })).not.toBe(base);
    expect(groundCacheKey(-95.795, 29.782, { interpolation: "RSP_NearestNeighbor" })).not.toBe(base);
  });

  it("the transect is a short east–west line centred on the point", () => {
    const [a, b] = groundTransectPath(-95.795, 29.782);
    expect(a[1]).toBe(29.782);
    expect(b[1]).toBe(29.782);
    expect(b[0] - a[0]).toBeCloseTo(0.0008, 12);
  });
});

describe("NEW-1 — a hit costs no network, a miss stores what it fetched", () => {
  it("a stored answer publishes WITHOUT calling the sampler at all", async () => {
    const key = groundCacheKey(-95.795, 29.782);
    const cache = fakeCache({ key, data: { ft: 98.4, v: 1 }, ts: 1000 });
    const s = sampler([1, 2, 3]);
    const leg = beginGroundElevation({ lng: -95.795, lat: 29.782, cache, sampler: s, now: () => 5000 });
    const st = await leg.state;
    expect(st.status).toBe("value");
    expect(st.ft).toBe(98.4);
    expect(st.fromCache).toBe(true);
    expect(st.ageMs).toBe(4000);
    expect(st.refreshing).toBe(false);
    expect(s.calls.length).toBe(0);            // <- the whole point of the item
    expect(await leg.fresh).toBe(null);        // nothing to patch in
  });

  it("a cold miss fetches, takes the median, and WRITES it under the exact key", async () => {
    const cache = fakeCache();
    const s = sampler([10, 30, 20]);
    const leg = beginGroundElevation({ lng: -95.795, lat: 29.782, cache, sampler: s, now: () => 7 });
    const st = await leg.state;
    expect(st.status).toBe("value");
    expect(st.ft).toBe(20);
    expect(st.fromCache).toBe(false);
    expect(s.calls.length).toBe(1);
    expect(s.calls[0][1]).toBe(GROUND_SAMPLE_COUNT);
    expect(s.calls[0][2]).toBe(GROUND_TIMEOUT_MS);
    expect(cache.store.get(groundCacheKey(-95.795, 29.782)).data.ft).toBe(20);
  });

  it("a stored answer past the months-long TTL still publishes INSTANTLY, and refreshes underneath", async () => {
    const key = groundCacheKey(-95.795, 29.782);
    const cache = fakeCache({ key, data: { ft: 50, v: 1 }, ts: 0 });
    const s = sampler([61]);
    const now = () => GROUND_TTL_MS + 1;
    const leg = beginGroundElevation({ lng: -95.795, lat: 29.782, cache, sampler: s, now });
    const st = await leg.state;
    expect(st.ft).toBe(50);              // the old answer, immediately
    expect(st.refreshing).toBe(true);    // …and it says so
    const fresh = await (await leg.fresh);
    expect(fresh.ft).toBe(61);
  });

  it("stores the VOID answer too — 'no bare-earth value here' is a stable fact about the ground", async () => {
    const cache = fakeCache();
    const s = sampler([null, null]);
    const st = await beginGroundElevation({ lng: -95.795, lat: 29.782, cache, sampler: s, now: () => 1 }).state;
    expect(st.status).toBe("void");
    expect(st.ft).toBe(null);
    expect(cache.store.size).toBe(1);
  });
});

describe("⛔ the explicit ↻ BYPASSES the cache — as a force refresh, not a blocking re-read", () => {
  it("forces a fetch even on a fresh hit, publishes the cached value instantly, and patches", async () => {
    const key = groundCacheKey(-95.795, 29.782);
    const cache = fakeCache({ key, data: { ft: 98.4, v: 1 }, ts: 900 });
    const s = sampler([102]);
    const leg = beginGroundElevation({ lng: -95.795, lat: 29.782, force: true, cache, sampler: s, now: () => 1000 });
    const st = await leg.state;
    expect(st.ft).toBe(98.4);            // the press does NOT wait on USGS…
    expect(st.refreshing).toBe(true);
    expect(s.calls.length).toBe(1);      // …but it DID force the re-read
    const fresh = await (await leg.fresh);
    expect(fresh.ft).toBe(102);          // …so a wrong cached value is one press from correction
    expect(cache.store.get(key).data.ft).toBe(102);
  });

  it("the forced network call starts BEFORE the cache is consulted", async () => {
    const cache = fakeCache();
    const order = [];
    const c2 = { ...cache, async readAsync(k) { order.push("cache"); return cache.readAsync(k); } };
    const s = (...a) => { order.push("net"); return sampler([1])(...a); };
    await beginGroundElevation({ lng: -95.795, lat: 29.782, force: true, cache: c2, sampler: s, now: () => 1 }).state;
    expect(order[0]).toBe("net");
  });
});

describe("NEW-2(b) — the panel is not gated on it", () => {
  it("publishes an honest PENDING once the budget is spent, then patches the real value in", async () => {
    vi.useFakeTimers();
    try {
      const s = sampler([77], { delayMs: 6000 });
      const leg = beginGroundElevation({ lng: -95.795, lat: 29.782, cache: null, sampler: s, budgetMs: 1500, now: () => 0 });
      const statePromise = leg.state;
      await vi.advanceTimersByTimeAsync(1600);
      const st = await statePromise;
      expect(st.status).toBe("pending");
      expect(st.ft).toBe(null);           // NEVER 0, never a dash that looks like an answer
      expect(st.refreshing).toBe(true);
      expect(st.service).toBe(GROUND_SERVICE);
      await vi.advanceTimersByTimeAsync(5000);
      const fresh = await (await leg.fresh);
      expect(fresh.status).toBe("value");
      expect(fresh.ft).toBe(77);
    } finally { vi.useRealTimers(); }
  });

  it("a call that beats the budget publishes the real value, with nothing to patch", async () => {
    vi.useFakeTimers();
    try {
      const s = sampler([12], { delayMs: 10 });
      const leg = beginGroundElevation({ lng: -95.795, lat: 29.782, cache: null, sampler: s, budgetMs: 1500, now: () => 0 });
      const p = leg.state;
      await vi.advanceTimersByTimeAsync(20);
      expect((await p).status).toBe("value");
    } finally { vi.useRealTimers(); }
  });
});

describe("NEW-3 — bounded, named, and NEVER a default elevation", () => {
  it("a failure is `unavailable`, carries the service name, and produces no number", async () => {
    const err = Object.assign(new Error("USGS 3DEP elevation timed out after 8000 ms"), { service: GROUND_SERVICE, timedOut: true });
    const s = sampler(null, { throws: err });
    const leg = beginGroundElevation({ lng: -95.795, lat: 29.782, cache: null, sampler: s, now: () => 0 });
    const st = await leg.state;
    expect(st.status).toBe("unavailable");
    expect(st.ft).toBe(null);
    expect(st.service).toBe(GROUND_SERVICE);
    expect(st.timedOut).toBe(true);
    expect(st.reason).toContain("timed out");
  });

  it("a failed fetch never overwrites a good cached value, and never invents one", async () => {
    const key = groundCacheKey(-95.795, 29.782);
    const cache = fakeCache({ key, data: { ft: 98.4, v: 1 }, ts: 0 });
    const s = sampler(null, { throws: new Error("boom") });
    const leg = beginGroundElevation({ lng: -95.795, lat: 29.782, force: true, cache, sampler: s, now: () => 10 });
    expect((await leg.state).ft).toBe(98.4);
    expect((await (await leg.fresh)).status).toBe("unavailable");
    expect(cache.store.get(key).data.ft).toBe(98.4); // untouched
  });

  it("passes the bounded timeout to the sampler rather than the 12 s default", async () => {
    const s = sampler([1]);
    await beginGroundElevation({ lng: -1, lat: 2, cache: null, sampler: s, now: () => 0 }).state;
    expect(s.calls[0][2]).toBe(GROUND_TIMEOUT_MS);
    expect(GROUND_TIMEOUT_MS).toBeLessThan(12000);
  });

  it("a cache that throws is not a failure of the check", async () => {
    const bad = { async readAsync() { throw new Error("idb gone"); }, write() { throw new Error("idb gone"); } };
    const st = await beginGroundElevation({ lng: -1, lat: 2, cache: bad, sampler: sampler([5]), now: () => 0 }).state;
    expect(st.status).toBe("value");
    expect(st.ft).toBe(5);
  });
});

describe("the hover sentence — a cache hit is LOUD, a failure names the service", () => {
  it("says the value was held, and how old it is", () => {
    const n = groundElevNote({ status: "value", ft: 98.4, ageMs: 70 * 86400000, fromCache: true, refreshing: false });
    expect(n).toContain("held from an earlier");
    expect(n).toContain(GROUND_SERVICE);
    expect(n).toContain("2mo old");
    expect(n).toContain("98.4");
  });
  it("says when a refresh is running underneath the held value", () => {
    expect(groundElevNote({ status: "value", ft: 1, ageMs: 0, fromCache: true, refreshing: true })).toContain("Re-checking it now");
  });
  it("names the service on a failure and states that nothing was assumed", () => {
    const n = groundElevNote({ status: "unavailable", service: GROUND_SERVICE, timedOut: true, reason: "timed out after 8000 ms" });
    expect(n).toContain(GROUND_SERVICE);
    expect(n).toContain("did not answer in time");
    expect(n).toContain("Nothing was assumed");
  });
  it("a pending state says the flood answers are already complete", () => {
    expect(groundElevNote({ status: "pending", budgetMs: 1500 })).toContain("unresolved");
  });
  it("a void state is an answer about the ground, not a failure", () => {
    expect(groundElevNote({ status: "void" })).toContain("no bare-earth value");
  });
  it("returns null rather than a sentence when there is no state", () => {
    expect(groundElevNote(null)).toBe(null);
    expect(groundElevNote({})).toBe(null);
  });
});

describe("medianElevation — the reduction the check has always used, unchanged", () => {
  it("takes the middle of the finite samples and ignores no-data", () => {
    expect(medianElevation([1, null, 5, 3, null])).toBe(3);
    expect(medianElevation([])).toBe(null);
    expect(medianElevation([null, null])).toBe(null);
    expect(medianElevation(null)).toBe(null);
  });
  it("is in the same feet the sampler already converted to", () => {
    expect(M_TO_FT).toBeCloseTo(3937 / 1200, 12);
  });
});


// ---------------------------------------------------------------------------------------------
/* ⛔ SOURCE GUARDS. Two properties that are invisible to every behavioural test above, and that a
 * later "tidy-up" would silently undo — the first breaches a CI budget, the second breaks the
 * panel with no test noticing because the state object would still be correct. */
describe("the note travels WITH the state, so the render never needs this module", () => {
  it("every published state carries its own hover sentence", async () => {
    const cache = fakeCache({ key: groundCacheKey(-95.795, 29.782), data: { ft: 98.4, v: 1 }, ts: 0 });
    const st = await beginGroundElevation({ lng: -95.795, lat: 29.782, cache, sampler: sampler([1]), now: () => 1000 }).state;
    expect(st.note).toBe(groundElevNote(st));
    expect(st.note).toContain(GROUND_SERVICE);
  });
  it("…and so does the LATE one that patches the panel", async () => {
    const leg = beginGroundElevation({ lng: -95.795, lat: 29.782, cache: null, sampler: sampler([12]), now: () => 0 });
    await leg.state;
    const fresh = await (await leg.fresh);
    expect(typeof fresh.note).toBe("string");
    expect(fresh.note.length).toBeGreaterThan(10);
  });
});

describe("neither module may rejoin the Site route's STATIC graph", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");
  it("groundElevation.js is reached only by a dynamic import", () => {
    expect(src).not.toMatch(/^import\s[^\n]*lib\/groundElevation\.js/m);
    expect(src).toMatch(/import\("\.\/lib\/groundElevation\.js"\)/);
  });
  it("drainageTiming.js is reached only by a dynamic import", () => {
    expect(src).not.toMatch(/^import\s[^\n]*lib\/drainageTiming\.js/m);
    expect(src).toMatch(/import\("\.\/lib\/drainageTiming\.js"\)/);
  });
});
