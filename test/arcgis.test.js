import { describe, it, expect, vi, afterEach } from "vitest";
import {
  outerRingsLngLat, queryAtPoint, identifyParcelDetailed, identifyParcelEager,
  ParcelFetchError, PARCEL_FETCH_TIMEOUT_MS, humanizeError,
} from "../src/workspaces/site-planner/lib/arcgis.js";

const LAYER = "https://example.test/MapServer/0";
const ok = (body) => ({ ok: true, status: 200, json: async () => body });

// outerRingsLngLat returns EVERY outer-boundary ring of a (possibly multipart)
// ArcGIS polygon feature, dropping holes. This is the fix for the Pearland bug
// (parcel 0440520000010 "TRS 3 & 5" = two separate tracts under one account):
// the old largest-ring-only pick highlighted/imported just the biggest tract, so a
// click on the smaller tract registered the account but lit up the neighbour.
//
// ArcGIS winding: outer rings are clockwise (negative shoelace area), holes are
// counter-clockwise (positive). A CLOSED square has 5 points (last === first);
// the helper returns it OPEN (4 points).
const sq = (lon, lat, h, cw = true) => {
  const ccw = [
    [lon - h, lat - h], [lon + h, lat - h], [lon + h, lat + h], [lon - h, lat + h], [lon - h, lat - h],
  ];
  return cw ? [...ccw].reverse() : ccw; // reverse(ccw) = clockwise = an outer ring
};
const feat = (rings) => ({ geometry: { rings } });

describe("outerRingsLngLat — multipart parcel support (Pearland B36c fix)", () => {
  it("returns the single outer ring of a one-part parcel, opened", () => {
    const out = outerRingsLngLat(feat([sq(-95.4, 29.58, 0.001)]));
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(4); // closing vertex stripped
    expect(out[0][0]).not.toEqual(out[0][out[0].length - 1]); // open ring
  });

  it("returns BOTH tracts of a two-part parcel (the bug: only one came back before)", () => {
    // two separate squares, same (outer) winding — like TRS 3 & 5
    const out = outerRingsLngLat(feat([sq(-95.41, 29.583, 0.0008), sq(-95.405, 29.583, 0.0009)]));
    expect(out).toHaveLength(2);
    // the two parts are distinct (different centroids), so neither is dropped
    const cx = (r) => r.reduce((s, p) => s + p[0], 0) / r.length;
    expect(Math.abs(cx(out[0]) - cx(out[1]))).toBeGreaterThan(0.003);
  });

  it("drops a hole (opposite winding) but keeps its outer ring → a donut yields 1 ring", () => {
    const out = outerRingsLngLat(feat([sq(-95.4, 29.58, 0.002, true), sq(-95.4, 29.58, 0.0005, false)]));
    expect(out).toHaveLength(1); // the small CCW hole is excluded
  });

  it("keeps every outer part even when a hole's |area| exceeds a small separate part", () => {
    // big outer + big hole + a small separate outer tract: must still return 2 outers
    const out = outerRingsLngLat(feat([
      sq(-95.4, 29.58, 0.003, true),   // big outer
      sq(-95.4, 29.58, 0.0025, false), // big hole (bigger than the small tract)
      sq(-95.39, 29.58, 0.0006, true), // small separate outer tract
    ]));
    expect(out).toHaveLength(2);
  });

  it("returns [] for a feature with no geometry", () => {
    expect(outerRingsLngLat(null)).toEqual([]);
    expect(outerRingsLngLat({})).toEqual([]);
    expect(outerRingsLngLat({ geometry: { rings: [] } })).toEqual([]);
  });
});

// A parcel fetch must validate the RESPONSE BODY, not just the HTTP status, and must
// distinguish a SERVER failure (typed ParcelFetchError → "unavailable") from a healthy
// "no parcel at this point" (an empty feature list → null, NOT an error). This is the
// classification the fallback + circuit breaker key off (B244/B245).
describe("queryAtPoint — body validation + typed failures (B245)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a healthy empty result returns null (no parcel here ≠ an error)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ features: [] })));
    await expect(queryAtPoint(LAYER, -95, 29)).resolves.toBeNull();
  });

  it("HTTP 200 with a JSON error body (e.g. 499 Token Required) is a failure, not success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ error: { message: "Token Required", code: 499 } })));
    await expect(queryAtPoint(LAYER, -95, 29)).rejects.toMatchObject({ kind: "arcgis", status: 499, unavailable: true });
  });

  it("a non-OK HTTP status (503) becomes a typed http failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    await expect(queryAtPoint(LAYER, -95, 29)).rejects.toMatchObject({ kind: "http", status: 503, unavailable: true });
  });

  it("a network/CORS throw becomes a typed network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(queryAtPoint(LAYER, -95, 29)).rejects.toMatchObject({ kind: "network", unavailable: true });
  });

  it("a hung request is aborted at the timeout (the ~45s tab-freeze fix, B244)", async () => {
    vi.useFakeTimers();
    // fetch that never resolves on its own — only the AbortController can end it.
    vi.stubGlobal("fetch", vi.fn((_url, { signal }) => new Promise((_res, rej) => {
      signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); });
    })));
    const p = queryAtPoint(LAYER, -95, 29).catch((e) => e);
    await vi.advanceTimersByTimeAsync(PARCEL_FETCH_TIMEOUT_MS + 10);
    const err = await p;
    expect(err).toBeInstanceOf(ParcelFetchError);
    expect(err.kind).toBe("timeout");
    vi.useRealTimers();
  });
});

describe("identifyParcelDetailed — per-source outcomes feed the breaker (B244)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("separates a down source from an empty one from a hit", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (url.includes("/down/")) return { ok: false, status: 503, json: async () => ({}) };
      if (url.includes("/empty/")) return ok({ features: [] });
      return ok({ features: [{ geometry: { rings: [] }, attributes: { OBJECTID: 1 } }] });
    }));
    const res = await identifyParcelDetailed([
      { county: "a", url: "https://x.test/down/MapServer/0" },
      { county: "b", url: "https://x.test/empty/MapServer/0" },
      { county: "c", url: "https://x.test/hit/MapServer/0" },
    ], -95, 29);
    expect(res.responded).toBe(2);          // b + c answered (one empty, one hit)
    expect(res.errors).toBe(1);             // a was down
    expect(res.hits).toHaveLength(1);
    const byCounty = Object.fromEntries(res.sources.map((s) => [s.county, s]));
    expect(byCounty.a.ok).toBe(false);      // breaker should count this a failure
    expect(byCounty.b.ok).toBe(true);       // healthy, just no parcel → NOT a failure
    expect(byCounty.c.hit).toBe(true);
  });
});

// identifyParcelEager returns the FIRST parcel hit without waiting for a hung sibling
// to time out — the fix for "every click stalls ~8s while FBCAD is dark" (B244
// recurred 2026-06-22). It still feeds the breaker the full per-source health (via
// onSettled, once everyone finishes) and, when nothing hits, still distinguishes
// "reached a server, no parcel" from "nothing responded" (B245).
describe("identifyParcelEager — first hit wins, never waits on a hung source (B244)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the hit WITHOUT waiting for a hung sibling's timeout, then feeds the breaker for both", async () => {
    vi.useFakeTimers();
    let hungAborted = false;
    vi.stubGlobal("fetch", vi.fn((url, { signal }) => {
      if (url.includes("/hung/"))
        return new Promise((_res, rej) => {
          signal.addEventListener("abort", () => { hungAborted = true; const e = new Error("aborted"); e.name = "AbortError"; rej(e); });
        });
      return Promise.resolve(ok({ features: [{ geometry: { rings: [] }, attributes: { OBJECTID: 7 } }] }));
    }));
    const settled = [];
    const res = await identifyParcelEager(
      [
        { county: "fortbend", url: "https://x.test/hung/MapServer/0" }, // down — never answers on its own
        { county: "chambers", url: "https://x.test/hit/MapServer/0" },  // statewide backup — answers fast
      ],
      -95, 29,
      { onSettled: (s) => settled.push(...s) }
    );
    // Resolved on the live source alone — no timer advance was needed, and we did NOT
    // trip the hung source's abort to get our answer.
    expect(res.hits.map((h) => h.county)).toEqual(["chambers"]);
    expect(hungAborted).toBe(false);
    expect(settled).toHaveLength(0); // onSettled hasn't fired yet — the hung source is still pending

    // Let the hung source hit its (bounded) timeout so the breaker can learn it's down.
    await vi.advanceTimersByTimeAsync(PARCEL_FETCH_TIMEOUT_MS + 10);
    expect(hungAborted).toBe(true);
    const byCounty = Object.fromEntries(settled.map((s) => [s.county, s]));
    expect(byCounty.fortbend.ok).toBe(false); // breaker will count the hung host a failure
    expect(byCounty.chambers.hit).toBe(true);
    vi.useRealTimers();
  });

  it("with no hit anywhere, waits for all and reports responded/errors honestly", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (url.includes("/down/")) return { ok: false, status: 503, json: async () => ({}) };
      return ok({ features: [] }); // reached, but no parcel at this point
    }));
    const res = await identifyParcelEager(
      [
        { county: "a", url: "https://x.test/down/MapServer/0" },
        { county: "b", url: "https://x.test/empty/MapServer/0" },
      ],
      -95, 29
    );
    expect(res.hits).toHaveLength(0);
    expect(res.responded).toBe(1); // b answered (empty); a was down
    expect(res.errors).toBe(1);
    expect(res.complete).toBe(true);
  });

  it("prefers an earlier-listed (real-CAD) hit over the statewide backup when both answer", async () => {
    // Both come back with a parcel, but the statewide layer is a touch slower (as it is
    // in reality) — so the real CAD wins and no 'statewide backup' relabel is needed.
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (url.includes("/txgio/")) await new Promise((r) => setTimeout(r, 15));
      return ok({ features: [{ geometry: { rings: [] }, attributes: { OBJECTID: 1 } }] });
    }));
    const res = await identifyParcelEager(
      [
        { county: "harris", url: "https://x.test/hcad/MapServer/0" },
        { county: "chambers", url: "https://x.test/txgio/MapServer/0" },
      ],
      -95, 29
    );
    expect(res.hits[0].county).toBe("harris");
  });
});

describe("humanizeError — plain wording per failure kind", () => {
  it("a timeout reads as the server not responding (not a generic error)", () => {
    expect(humanizeError(new ParcelFetchError("timeout", "x"))).toMatch(/isn.t responding/i);
  });
  it("an arcgis body error surfaces the server's own message", () => {
    expect(humanizeError(new ParcelFetchError("arcgis", "Token Required", 499))).toBe("Token Required");
  });
});
