import { describe, it, expect, vi, afterEach } from "vitest";
import {
  outerRingsLngLat, queryAtPoint, queryFeatures, isPaginationUnsupportedError,
  identifyParcelDetailed, identifyParcelEager,
  BACKUP_GRACE_MS,
  ParcelFetchError, PARCEL_FETCH_TIMEOUT_MS, humanizeError, geoJsonToEsriFeature,
  identifyAtPoint, isQueryCapabilityError,
} from "../src/workspaces/site-planner/lib/arcgis.js";
import { STATEWIDE_PARCEL_LAYER } from "../src/workspaces/site-planner/lib/counties.js";

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

// geoJsonToEsriFeature converts an esri-leaflet display-layer GeoJSON polygon into the
// esri-shaped { geometry:{rings}, attributes } the identify/highlight path consumes —
// so an already-drawn outline can feed the optimistic-highlight pick (B441). Output
// must round-trip cleanly through outerRingsLngLat (the next stage in that path).
describe("geoJsonToEsriFeature — GeoJSON display feature → esri feature (B441)", () => {
  const gjPolygon = (rings) => ({ type: "Feature", properties: { OBJECTID: 7 }, geometry: { type: "Polygon", coordinates: rings } });
  const ring = (lon, lat, h) => [[lon - h, lat - h], [lon + h, lat - h], [lon + h, lat + h], [lon - h, lat + h], [lon - h, lat - h]];

  it("flattens a Polygon's rings and carries properties → attributes", () => {
    const out = geoJsonToEsriFeature(gjPolygon([ring(-95.4, 29.58, 0.001)]));
    expect(out.geometry.rings).toHaveLength(1);
    expect(out.attributes.OBJECTID).toBe(7);
    expect(outerRingsLngLat(out)).toHaveLength(1); // round-trips into the highlight path
  });

  it("flattens a MultiPolygon into one flat ring list (each tract preserved)", () => {
    const mp = {
      type: "Feature", properties: {},
      geometry: { type: "MultiPolygon", coordinates: [[ring(-95.41, 29.58, 0.0008)], [ring(-95.40, 29.58, 0.0009)]] },
    };
    const out = geoJsonToEsriFeature(mp);
    expect(out.geometry.rings).toHaveLength(2);
    expect(outerRingsLngLat(out)).toHaveLength(2); // both tracts survive (multipart-safe)
  });

  it("returns null for a non-polygon / empty / missing geometry", () => {
    expect(geoJsonToEsriFeature(null)).toBeNull();
    expect(geoJsonToEsriFeature({ geometry: { type: "Point", coordinates: [0, 0] } })).toBeNull();
    expect(geoJsonToEsriFeature({ geometry: { type: "Polygon", coordinates: [] } })).toBeNull();
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

  // B1461729 — the exact fixture from the Nevada incident: HTTP 200, fast, with ArcGIS's
  // "Failed to execute query" error body. This runtime path (queryAtPoint → fetchJson) was already
  // checking `j.error` before this item landed — this fixture is the regression guard so it can
  // never again be recorded as a working source, matching the other two fixed call sites
  // (ui-audit/probe-statewide-parcels.mjs's probeSource, ui-audit/lib/statewideCoverage.mjs's
  // probeEnvelopeTiming).
  it("the exact Nevada incident body — HTTP 200, {error:{code:400,message:'Failed to execute query.'}}", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ error: { code: 400, message: "Failed to execute query." } })));
    await expect(queryAtPoint(LAYER, -95, 29)).rejects.toMatchObject({ kind: "arcgis", status: 400, unavailable: true, message: "Failed to execute query." });
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

// The TxGIO statewide parcels MapServer (Chambers County's source + every county's
// outage fallback) had its layer /query + /find ops DISABLED upstream (they 400 with
// "operation is not supported"), while /identify + /export still serve the data — which
// broke every click on a Chambers lot ("can't click / GIS is down"). queryAtPoint now
// transparently retries the MapServer /identify op for exactly that capability error.
describe("queryAtPoint → /identify fallback when the layer /query op is disabled (Chambers/TxGIO)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const CAP_ERR = { error: { message: "Requested operation is not supported by this service.", code: 400 } };
  // A rectangle around (-95, 29.002); the click at (-95, 29.002) is inside it.
  const box = { rings: [[[-95.001, 29.001], [-94.999, 29.001], [-94.999, 29.003], [-95.001, 29.003], [-95.001, 29.001]]] };

  it("classifies the ArcGIS 'operation is not supported' body as a query-capability error", () => {
    expect(isQueryCapabilityError(new ParcelFetchError("arcgis", "Requested operation is not supported by this service.", 400))).toBe(true);
    expect(isQueryCapabilityError(new ParcelFetchError("arcgis", "Token Required", 499))).toBe(false);
    expect(isQueryCapabilityError(new ParcelFetchError("timeout", "no response"))).toBe(false);
  });

  it("retries /identify and returns the parcel under the point when /query is unsupported", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      calls.push(String(url));
      if (String(url).includes("/query")) return ok(CAP_ERR);
      if (String(url).includes("/identify")) return ok({ results: [{ geometry: box, attributes: { PROP_ID: "55173", county: "CHAMBERS" } }] });
      return ok({});
    }));
    const feat = await queryAtPoint(LAYER, -95, 29.002);
    expect(feat).toBeTruthy();
    expect(feat.attributes.PROP_ID).toBe("55173");
    expect(feat.geometry.rings).toHaveLength(1);
    expect(calls.some((u) => u.includes("/query"))).toBe(true);   // tried the fast path first
    expect(calls.some((u) => u.includes("/identify"))).toBe(true); // then fell back
  });

  it("from several identify hits, picks the polygon that actually CONTAINS the click", async () => {
    // A far-away box first, then the true container — the fallback must not just take [0].
    const far = { rings: [[[-96.0, 30.0], [-95.99, 30.0], [-95.99, 30.01], [-96.0, 30.01], [-96.0, 30.0]]] };
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes("/query")) return ok(CAP_ERR);
      return ok({ results: [
        { geometry: far, attributes: { PROP_ID: "999" } },
        { geometry: box, attributes: { PROP_ID: "55173" } },
      ] });
    }));
    const feat = await queryAtPoint(LAYER, -95, 29.002);
    expect(feat.attributes.PROP_ID).toBe("55173");
  });

  it("does NOT fall back for a non-capability ArcGIS error (a real outage still surfaces)", async () => {
    const fetchMock = vi.fn(async () => ok({ error: { message: "Token Required", code: 499 } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(queryAtPoint(LAYER, -95, 29)).rejects.toMatchObject({ kind: "arcgis", status: 499 });
    expect(fetchMock.mock.calls.every(([u]) => !String(u).includes("/identify"))).toBe(true); // never tried identify
  });

  it("does NOT fall back on a FeatureServer layer (identify is a MapServer-only op)", async () => {
    const FS = "https://example.test/FeatureServer/0";
    const fetchMock = vi.fn(async () => ok(CAP_ERR));
    vi.stubGlobal("fetch", fetchMock);
    await expect(queryAtPoint(FS, -95, 29)).rejects.toMatchObject({ kind: "arcgis" });
    expect(fetchMock.mock.calls.every(([u]) => !String(u).includes("/identify"))).toBe(true);
  });

  it("identifyAtPoint resolves null when identify finds nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ results: [] })));
    await expect(identifyAtPoint(LAYER, -95, 29)).resolves.toBeNull();
  });
});

// B1657600 — the exact repro: a Fort Worth (or any non-Houston-metro Texas) click fires a /query
// against the TxGIO statewide layer that can NEVER succeed (its /query has been disabled since
// B627), wasting a round trip on every one of the ~245 counties this layer backs, before the
// isQueryCapabilityError catch above falls back to /identify. A layer that has DECLARED itself
// identify-only skips straight to /identify — one request, not two.
describe("queryAtPoint — a declared identify-only layer skips /query entirely (B1657600)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const box = { rings: [[[-97.001, 32.001], [-96.999, 32.001], [-96.999, 32.003], [-97.001, 32.003], [-97.001, 32.001]]] };

  it("fires exactly one request — /identify — never /query", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      calls.push(String(url));
      return ok({ results: [{ geometry: box, attributes: { PROP_ID: "12345", COUNTY: "TARRANT" } }] });
    }));
    const feat = await queryAtPoint(STATEWIDE_PARCEL_LAYER, -97, 32.002);
    expect(feat.attributes.PROP_ID).toBe("12345");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/identify");
    expect(calls.some((u) => u.includes("/query"))).toBe(false);
  });

  it("a plain county CAD (not identify-only) still tries /query first, as before", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      calls.push(String(url));
      return ok({ features: [] });
    }));
    await queryAtPoint(LAYER, -95, 29);
    expect(calls[0]).toContain("/query");
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

// B634 — the statewide TxGIO fallback frequently RACES AHEAD of a county's own CAD.
// Pre-fix, a Fort Bend click resolved on whichever answered first, so TxGIO often won and
// the lot got mislabeled "Fort Bend county's server is unavailable" though FBCAD was up.
// Candidates now carry `statewide`, and the eager resolver prefers a healthy real CAD
// within a bounded grace (never the full 8s), so the authoritative source wins.
describe("identifyParcelEager — a healthy real CAD wins over a faster statewide fallback (B634)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const FBCAD = { county: "fortbend", url: "https://x.test/fbcad/FeatureServer/0", statewide: false };
  const TXGIO = { county: "chambers", url: "https://x.test/txgio/MapServer/0", statewide: true };
  const hit = (id) => ok({ features: [{ geometry: { rings: [] }, attributes: { OBJECTID: id } }] });

  it("takes the real CAD's parcel even when the statewide layer answered first (within the grace)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((url) => {
      if (url.includes("/txgio/")) return Promise.resolve(hit(99));           // statewide — instant
      return new Promise((r) => setTimeout(() => r(hit(1)), 400));            // FBCAD — 400ms, well under the grace
    }));
    const p = identifyParcelEager([FBCAD, TXGIO], -95, 29);
    await vi.advanceTimersByTimeAsync(450);                                   // past FBCAD's 400ms, still under BACKUP_GRACE_MS
    const res = await p;
    expect(res.hits[0].county).toBe("fortbend");                             // the authoritative CAD won the race
    vi.useRealTimers();
  });

  it("falls back to the statewide hit after ONLY the bounded grace when the CAD is hung (not the full 8s)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((url, { signal }) => {
      if (url.includes("/txgio/")) return Promise.resolve(hit(99));
      return new Promise((_r, rej) => { signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); }); });
    }));
    const p = identifyParcelEager([FBCAD, TXGIO], -95, 29);
    await vi.advanceTimersByTimeAsync(BACKUP_GRACE_MS + 10);                  // ONLY the grace — not PARCEL_FETCH_TIMEOUT_MS
    const res = await p;
    expect(res.hits.map((h) => h.county)).toEqual(["chambers"]);             // statewide stands in for the hung CAD
    vi.useRealTimers();
  });

  it("resolves on the statewide hit as soon as the CAD honestly reports no parcel (ROW)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => (url.includes("/txgio/") ? hit(99) : ok({ features: [] }))));
    const res = await identifyParcelEager([FBCAD, TXGIO], -95, 29);          // real timers: FBCAD returns 0 features fast
    expect(res.hits.map((h) => h.county)).toEqual(["chambers"]);
    // FBCAD answered (just no polygon at a ROW point) — its source outcome stays ok:true, so the
    // label helper (isStatewideBackup, tested in sourceHealth.test.js) reads this as "not an outage".
    expect(res.sources.find((s) => s.county === "fortbend").ok).toBe(true);
  });
});

/* ⛔ B1457153 (2026-09-10) — A SOLE, HUNG SOURCE MUST NEVER LEAVE A LOOKUP "Looking up lot…" FOREVER.
 *
 * Measured live on planyr.io: two Las Vegas lookups never returned at all under the B1457152
 * fan-out (67+ concurrent candidates queried at once). Every one of the tests above already proves
 * a HUNG SIBLING can't block a lookup that has a healthy candidate to answer instead — this closes
 * the remaining, narrower case the fan-out fix (which now typically leaves ONE candidate for a
 * point) makes the common one: when the SOLE candidate hangs, with nothing else to race it. The
 * budget reused here is the SAME one PR #1611 measured every statewide source's own envelope query
 * against (`PARCEL_FETCH_TIMEOUT_MS`, `docs/STATEWIDE-PARCELS.md`'s "the app's own click-lookup hang-
 * guard") — nothing new invented. */
describe("identifyParcelEager — the SOLE candidate hanging still resolves within the budget (B1457153)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a single hung candidate fails visibly at PARCEL_FETCH_TIMEOUT_MS — never hangs forever", async () => {
    vi.useFakeTimers();
    let aborted = false;
    vi.stubGlobal("fetch", vi.fn((_url, { signal }) => new Promise((_res, rej) => {
      signal.addEventListener("abort", () => { aborted = true; const e = new Error("aborted"); e.name = "AbortError"; rej(e); });
    })));
    const p = identifyParcelEager([{ county: "nv_statewide", url: "https://x.test/nv/MapServer/0", statewide: true }], -115.157, 36.1167);
    // Nothing has aborted yet — a lookup that resolved WITHOUT the timer ever firing would be
    // trivially "not hung", so this proves the promise genuinely waits on the real budget.
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(PARCEL_FETCH_TIMEOUT_MS - 10);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(20); // cross PARCEL_FETCH_TIMEOUT_MS
    const res = await p;
    expect(aborted).toBe(true);
    expect(res.complete).toBe(true);
    expect(res.hits).toHaveLength(0);
    expect(res.responded).toBe(0); // "couldn't reach any parcel server" — not "no parcel here"
    vi.useRealTimers();
  });

  it("an unrelated state's outage is never even in the race — it isn't queried at all", async () => {
    // The B1457152 fix means an Arkansas 503 (measured live on the SAME Las Vegas click) can no
    // longer "stall" a Nevada lookup, because candidateCountiesForPoint never hands Arkansas to
    // identifyParcelEager for a Nevada point in the first place — see
    // test/countyStatewideDerivation.test.js's B1457152 suite for the candidate-list proof. This
    // test only pins the OTHER half: even if it somehow were queried, one 503 among several
    // candidates never blocks a hit from a healthy sibling.
    vi.stubGlobal("fetch", vi.fn(async (url) => (url.includes("/ar/") ? { ok: false, status: 503, json: async () => ({}) } : ok({ features: [{ geometry: { rings: [] }, attributes: { OBJECTID: 1 } }] }))));
    const res = await identifyParcelEager([
      { county: "ar_statewide", url: "https://x.test/ar/FeatureServer/0", statewide: true },
      { county: "nv_statewide", url: "https://x.test/nv/MapServer/0", statewide: true },
    ], -115.157, 36.1167);
    expect(res.hits.map((h) => h.county)).toEqual(["nv_statewide"]);
  });
});

/* Bryan County GA (measured 2026-09-23) answers HTTP 200 with `{error:{code:400,message:
 * "Pagination is not supported."}}` to ANY query carrying `resultRecordCount` — which every
 * ordinary search sends (queryOneLayer → queryFeatures) — so its search box could never have
 * worked without this fallback. The click path (queryAtPoint) sends no pagination params and was
 * already fine; this closes the search path. */
describe("queryFeatures — pagination-unsupported fallback (Bryan County GA, B1873776)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const PAG_ERR = { error: { code: 400, message: "Pagination is not supported." } };
  const feat = (id) => ({ geometry: { rings: [] }, attributes: { OBJECTID: id } });

  it("classifies the exact Bryan County error body", () => {
    expect(isPaginationUnsupportedError(new ParcelFetchError("arcgis", "Pagination is not supported.", 400))).toBe(true);
    expect(isPaginationUnsupportedError(new ParcelFetchError("arcgis", "Token Required", 499))).toBe(false);
    expect(isPaginationUnsupportedError(new ParcelFetchError("timeout", "no response"))).toBe(false);
  });

  it("an unaffected server still gets ONE plain request, unchanged", async () => {
    const fetchMock = vi.fn(async () => ok({ features: [feat(1), feat(2)] }));
    vi.stubGlobal("fetch", fetchMock);
    const feats = await queryFeatures(LAYER, { where: "1=1", count: 8 });
    expect(feats).toHaveLength(2);
    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("resultRecordCount");
  });

  it("on the pagination error, falls back to ids-only then objectIds, sliced to count", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("resultRecordCount")) return ok(PAG_ERR);
      if (u.includes("returnIdsOnly")) return ok({ objectIds: [10, 11, 12, 13, 14] });
      if (u.includes("objectIds=")) return ok({ features: [feat(10), feat(11), feat(12)] });
      return ok({});
    }));
    const feats = await queryFeatures(LAYER, { where: "1=1", count: 3 });
    expect(feats.map((f) => f.attributes.OBJECTID)).toEqual([10, 11, 12]);
    expect(calls).toHaveLength(3); // the original attempt + the two fallback calls
    const idsCall = calls.find((u) => u.includes("objectIds="));
    expect(idsCall).toMatch(/objectIds=10%2C11%2C12/); // sliced to `count`, comma-joined
  });

  it("an empty id list on the fallback returns [] rather than a third request", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("resultRecordCount")) return ok(PAG_ERR);
      if (u.includes("returnIdsOnly")) return ok({ objectIds: [] });
      return ok({});
    }));
    const feats = await queryFeatures(LAYER, { where: "1=1 AND 1=0", count: 8 });
    expect(feats).toEqual([]);
    expect(calls.some((u) => u.includes("objectIds="))).toBe(false); // no wasted third call
  });

  it("a DIFFERENT ArcGIS error is never retried as though it were the pagination gap", async () => {
    const fetchMock = vi.fn(async () => ok({ error: { code: 499, message: "Token Required" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(queryFeatures(LAYER)).rejects.toMatchObject({ kind: "arcgis", status: 499 });
    expect(fetchMock.mock.calls).toHaveLength(1); // never tried the ids-only fallback
  });

  it("a timeout/network error is never retried either — only the exact pagination wording triggers it", async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    vi.stubGlobal("fetch", fetchMock);
    await expect(queryFeatures(LAYER)).rejects.toMatchObject({ kind: "network" });
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

  it("a failure INSIDE the fallback still surfaces as its own typed error, never swallowed", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("resultRecordCount")) return ok(PAG_ERR);
      if (u.includes("returnIdsOnly")) return { ok: false, status: 503, json: async () => ({}) };
      return ok({});
    }));
    await expect(queryFeatures(LAYER)).rejects.toMatchObject({ kind: "http", status: 503 });
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
