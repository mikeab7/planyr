/* NEW-1 / NEW-2 (B2424384–B2424386, 2026-10-22) — a parcel source that is SLOW is not a source that has no such lot.
 *
 * Michael, on V1853888's note that a Perry id search "came back empty on the first live run and passed on re-run": "how would a user know to do that?"
 * Measured against the live Comptroller layer the same day: warm ~50 ms, cold 0.5–1 s, and the first ask at a quiet moment has taken 27 s (Williamson), 44 s and a 504 at 59 s (Hamilton). The app
 * gave up at 8 s and asked once more at 8 s, so a source needing 12–25 s lost twice and the person got a sentence with nothing to press.
 *
 * These tests drive the REAL fetch layer (arcgis.js fetchJson → parcelQuery.lookupParcelsWhere → resolveParcelId) against a stand-in server that answers after a chosen delay under fake timers, so
 * the slow answer is deterministic. RED-PROOF: run against origin/main (8e0e3ed…8584b49) the "slow server answers at 12 s" case ends `unavailable`; on this branch it is `found`.
 * Not covered here, covered elsewhere: the live server (ui-audit verify-slow-parcel-source-live, V1857328) and the Try again controls (e2e slow-parcel-source). */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolveParcelId, parcelIdMessage } from "../src/workspaces/site-planner/lib/parcelIdSearch.js";
import { identifyWithLineFallback } from "../src/workspaces/site-planner/lib/identifyWithFallback.js";
import { askUntilAnswered, watchSlow, stillLookingMessage, ASK_BUDGETS_MS, CLICK_RETRY_BUDGET_MS, SLOW_HINT_MS } from "../src/workspaces/site-planner/lib/slowSource.js";
import { PARCEL_FETCH_TIMEOUT_MS } from "../src/workspaces/site-planner/lib/arcgis.js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/tnSweepPoints.json", import.meta.url), "utf8"));
const PERRY = FX.counties.find((c) => c.name === "Perry");
const SQ = { rings: [[[-87.85, 35.63], [-87.8499, 35.63], [-87.8499, 35.6301], [-87.85, 35.6301], [-87.85, 35.63]]] };
const PERRY_ROW = { attributes: PERRY.matchAttrs, geometry: SQ };

/* A stand-in for fetch: every request is answered by `plan(callNumber)` = { afterMs, body | status | hang }. Honours AbortSignal like the browser. */
const installServer = (plan) => {
  const calls = [];
  globalThis.fetch = vi.fn((url, { signal } = {}) => new Promise((resolve, reject) => {
    const n = calls.length; calls.push({ url: String(url), at: Date.now() });
    const spec = plan(n);
    const timer = spec.hang ? null : setTimeout(() => {
      if (spec.status && spec.status !== 200) return resolve({ ok: false, status: spec.status, json: async () => ({}) });
      resolve({ ok: true, status: 200, json: async () => spec.body });
    }, spec.afterMs || 0);
    if (signal) signal.addEventListener("abort", () => { if (timer) clearTimeout(timer); const e = new Error("aborted"); e.name = "AbortError"; reject(e); });
  }));
  return calls;
};
const FOUND = { features: [PERRY_ROW] };
const EMPTY = { features: [] };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const search = (text = PERRY.id, opts = {}) => {
  const p = resolveParcelId(text, { near: { lat: 35.63, lng: -87.85 }, ...opts });
  return p;
};

describe("NEW-1 — the parcel-ID search waits for a slow server instead of calling it unreachable", () => {
  it("a state server that answers at 12 s (past the old 8 s limit) FINDS the lot", async () => {
    installServer(() => ({ afterMs: 12000, body: FOUND }));
    const p = search();
    await vi.advanceTimersByTimeAsync(13000);
    const r = await p;
    expect(r.status).toBe("found");
    expect(r.county).toBe("tn_statewide");
  });

  it("a first ask that times out is asked AGAIN by the app, and the second answer finds the lot (the 'passed on re-run' case, without the person)", async () => {
    const calls = installServer((n) => (n === 0 ? { hang: true } : { afterMs: 300, body: FOUND }));
    const p = search();
    await vi.advanceTimersByTimeAsync(ASK_BUDGETS_MS[0] + 2000);
    const r = await p;
    expect(r.status).toBe("found");
    expect(calls.length).toBe(2);
  });

  it("a 504 on the first ask (a cold state server) is retried and finds the lot", async () => {
    installServer((n) => (n === 0 ? { afterMs: 50, status: 504 } : { afterMs: 50, body: FOUND }));
    const p = search();
    await vi.advanceTimersByTimeAsync(2000);
    expect((await p).status).toBe("found");
  });

  it("a server that NEVER answers ends `unavailable` (not `notfound`) after both asks, naming the source, with the plain 'didn't answer' sentence", async () => {
    const calls = installServer(() => ({ hang: true }));
    const p = search();
    await vi.advanceTimersByTimeAsync(ASK_BUDGETS_MS[0] + ASK_BUDGETS_MS[1] + 5000);
    const r = await p;
    expect(r.status).toBe("unavailable");
    expect(r.failed).toEqual(["Tennessee"]);
    expect(calls.length).toBe(2);
    const msg = parcelIdMessage(r, PERRY.id);
    expect(msg).toMatch(/Tennessee statewide parcel server didn't answer/);
    expect(msg).toMatch(/Try again\.$/);
    expect(msg).not.toMatch(/No Tennessee parcel with ID/);
  });

  it("the budgets are longer than the old 8 s and the total wait stays sane", () => {
    expect(ASK_BUDGETS_MS[0]).toBeGreaterThan(PARCEL_FETCH_TIMEOUT_MS);
    expect(ASK_BUDGETS_MS[1]).toBeGreaterThan(PARCEL_FETCH_TIMEOUT_MS);
    expect(ASK_BUDGETS_MS.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(60000);
  });

  it("a source that answered EMPTY is the only thing that reads `notfound` — and the miss is confirmed once before it is said", async () => {
    const calls = installServer(() => ({ afterMs: 40, body: EMPTY }));
    const p = search("068 066    00402 000 2026");
    await vi.advanceTimersByTimeAsync(5000);
    const r = await p;
    expect(r.status).toBe("notfound");
    expect(calls.length).toBe(2); // asked, then asked again to confirm
    expect(parcelIdMessage(r, "x")).toMatch(/^No Tennessee parcel with ID/);
  });

  it("an empty first answer that the confirming ask turns into a find lands on the lot and is FLAGGED so the app reports it", async () => {
    installServer((n) => ({ afterMs: 40, body: n === 0 ? EMPTY : FOUND }));
    const p = search();
    await vi.advanceTimersByTimeAsync(5000);
    const r = await p;
    expect(r.status).toBe("found");
    expect(r.recheckedEmpty).toBe(true);
  });

  it("another source finding a lot never hides that a different source did not answer (the lot is named with what could not be checked)", async () => {
    const lookup = async ({ county }) => { if (county === "tn_rutherford") return { feats: [] }; throw new Error("timeout"); };
    const ok = { attributes: { ParcelID: "156-027.00-000", Name: "x" }, geometry: SQ };
    const r = await resolveParcelId("156-027.00-000", {
      retryMs: 0, sleep: async () => {}, budgets: [1, 1], lookup: async (a) => (a.county === "tn_rutherford" ? { feats: [ok] } : lookup(a)),
      lookupWhere: async () => { throw new Error("timeout"); },
    });
    expect(r.status).toBe("found");
    expect((r.unchecked || []).length).toBeGreaterThan(0);
    expect(r.label).toMatch(/couldn't check/);
  });
});

describe("the shared helpers", () => {
  it("askUntilAnswered passes each attempt its own timeout and rethrows the LAST typed error", async () => {
    const seen = [];
    const err2 = Object.assign(new Error("second"), { unavailable: true });
    await expect(askUntilAnswered(async ({ timeoutMs }) => { seen.push(timeoutMs); throw seen.length === 1 ? new Error("first") : err2; }, { budgets: [10, 20], retryMs: 0, sleep: async () => {} })).rejects.toBe(err2);
    expect(seen).toEqual([10, 20]);
  });
  it("watchSlow fires once after its delay, and not at all once stopped", () => {
    const fn = vi.fn();
    const stop = watchSlow(fn);
    vi.advanceTimersByTime(SLOW_HINT_MS - 1); expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2); expect(fn).toHaveBeenCalledTimes(1);
    const fn2 = vi.fn(); const stop2 = watchSlow(fn2); stop2(); vi.advanceTimersByTime(SLOW_HINT_MS * 2); expect(fn2).not.toHaveBeenCalled();
    stop();
  });
  it("the still-looking sentence names the server", () => {
    expect(stillLookingMessage("Tennessee")).toBe("Still looking — the Tennessee parcel server is slow to answer.");
  });
});

describe("NEW-2 — the lot click: a slow or silent source is never 'no parcel here'", () => {
  const cand = (county, statewide = false) => ({ county, url: `https://example.test/${county}/FeatureServer/0`, statewide });
  const okSrc = (c, hit) => ({ county: c.county, ok: true, hit: !!hit, error: null });
  const failSrc = (c) => ({ county: c.county, ok: false, hit: false, error: new Error("timeout") });

  it("the retry round waits longer than the first round (a source that missed 8 s gets the long budget)", async () => {
    const budgets = [];
    const a = cand("tn_statewide", true);
    const identify = async (list, _lng, _lat, o) => {
      budgets.push(o.timeoutMs);
      const first = budgets.length === 1;
      return { hits: first ? [] : [{ county: a.county, feature: { attributes: {} } }], sources: list.map((c) => (first ? failSrc(c) : okSrc(c, true))), responded: first ? 0 : 1, errors: first ? 1 : 0, complete: true };
    };
    const res = await identifyWithLineFallback({ primary: [a], lng: -87.8, lat: 35.6, identify });
    expect(res.hits.length).toBe(1);
    expect(res.via).toBe("retry");
    expect(budgets[0]).toBeUndefined(); // the quick first round keeps the app's own default
    expect(budgets[1]).toBe(CLICK_RETRY_BUDGET_MS);
    expect(CLICK_RETRY_BUDGET_MS).toBeGreaterThan(PARCEL_FETCH_TIMEOUT_MS);
  });

  it("one source silent after every round + a neighbour that answered EMPTY → `errors` > 0 so the card says 'didn't answer', not 'No parcel at this point'", async () => {
    const a = cand("tn_statewide", true); const b = cand("ms_desoto");
    const identify = async (list) => ({ hits: [], sources: list.map((c) => (c.county === a.county ? failSrc(c) : okSrc(c, false))), responded: list.filter((c) => c.county !== a.county).length, errors: list.filter((c) => c.county === a.county).length, complete: true });
    const res = await identifyWithLineFallback({ primary: [a], neighbours: () => [b], lng: -90, lat: 35, identify });
    expect(res.hits).toEqual([]);
    expect(res.responded).toBeGreaterThan(0); // a neighbour DID answer — the old test (`responded === 0`) would have said "No parcel"
    expect(res.errors).toBeGreaterThan(0);    // …but a source never answered, and that is what the card now keys on
    expect(res.silent).toContain("tn_statewide");
  });
});

describe("the wiring (source guards — the UI lives in 6,000-line files nothing else unit-tests)", () => {
  const mf = readFileSync(new URL("../src/workspaces/site-planner/MapFinder.jsx", import.meta.url), "utf8");
  const card = readFileSync(new URL("../src/workspaces/site-planner/components/ParcelInfoCard.jsx", import.meta.url), "utf8");
  it("both lot paths decide 'unavailable' from `errors`, not only from `responded === 0`", () => {
    expect(mf).toMatch(/res\.responded === 0 \|\| res\.errors > 0 \? "unavailable" : "none"/);
    expect(mf).toMatch(/const silentCount = res\.responded === 0 \|\| res\.errors > 0/);
  });
  it("an unavailable id search and an unavailable click each hand the toast a Try again that re-runs the same lookup", () => {
    expect(mf).toMatch(/setErrRetry\(r\.status === "unavailable" \? \{ message: msg, run: \(\) => goAddress\(q\) \}/);
    expect(mf).toMatch(/failUnavailable\([^\n]*\(\) => handleClick\(latlng\)\)/);
    expect(mf).toMatch(/data-testid="map-try-again"/);
    expect(card).toMatch(/data-testid="parcel-card-try-again"/);
  });
  it("a long lookup shows the still-looking line, and the empty-then-found event is reported", () => {
    expect(mf).toMatch(/data-testid="map-lookup-slow"/);
    expect(mf).toMatch(/reportClientEvent\("parcel-id-empty-then-found"/);
  });
});
