/* parcelSummaryAsync — NEW-1 / B2224000. The account-wide parcel summary ran as ONE task inside the continuation of the parcels fetch
 * (`Response.text.then` — the owner's 134 ms perfcap task); its cost is a sum over EVERY plan on the account, so it grows with the library, not with the
 * plan opened. The async form must answer identically and must hand the main thread back between sites once its slice budget is spent. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { summarizeParcelRows, summarizeParcelRowsAsync } from "../src/workspaces/site-planner/lib/parcelSummary.js";

const fx = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/plan-load/concept-a.json", import.meta.url), "utf8"));
const parcelRows = (siteId) => fx.rows.filter((r) => r.kind === "parcel").map((r) => ({ site_id: siteId, data: r.data }));
const library = (n) => Array.from({ length: n }, (_, i) => parcelRows(`site${i}`)).flat();

describe("summarizeParcelRowsAsync", () => {
  it("answers exactly what the synchronous summary answers (the owner's real Concept A parcels, 12 sites)", async () => {
    const rows = library(12);
    expect(await summarizeParcelRowsAsync(rows)).toEqual(summarizeParcelRows(rows));
  });
  it("handles the same junk the sync one does (null rows, rows missing site_id / data) and an empty fetch", async () => {
    expect(await summarizeParcelRowsAsync([null, {}, { site_id: "x" }, { data: {} }])).toEqual({});
    expect(await summarizeParcelRowsAsync([])).toEqual({});
    expect(await summarizeParcelRowsAsync(undefined)).toEqual({});
  });
  it("yields between sites once the slice budget is spent — and not before", async () => {
    let t = 0, yields = 0;
    const opts = { budgetMs: 10, now: () => (t += 4), yieldFn: async () => { yields++; } };   // each site "costs" 4 ms of a 10 ms budget
    await summarizeParcelRowsAsync(library(9), opts);
    expect(yields).toBeGreaterThanOrEqual(2);   // B2236000 (round 6): the unit is now one parcel PAIR, so there is no per-site upper bound
    let t2 = 0, y2 = 0;
    await summarizeParcelRowsAsync(library(9), { budgetMs: 1e9, now: () => (t2 += 1), yieldFn: async () => { y2++; } });
    expect(y2).toBe(0);
  });
  it("B2236000 — ONE project with many lots yields INSIDE its pair scan, and the answer is identical to the sync summary", async () => {
    const sq = (x, y, s = 100) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
    const rows = Array.from({ length: 14 }, (_, i) => ({ site_id: "big", data: { id: "p" + i, points: sq((i % 5) * 80, Math.floor(i / 5) * 80) } }));
    let t = 0, yields = 0;
    const got = await summarizeParcelRowsAsync(rows, { budgetMs: 10, now: () => (t += 4), yieldFn: async () => { yields++; } });
    expect(yields).toBeGreaterThan(5);           // 91 pairs in one site — it used to be one unit
    expect(got).toEqual(summarizeParcelRows(rows));
    expect(got.big.acres).toBeGreaterThan(0);
  });
  it("the plan-open caller uses it, and drops a finished summary that a sign-out superseded", () => {
    const src = readFileSync(new URL("../src/workspaces/site-planner/SitePlannerApp.jsx", import.meta.url), "utf8");
    expect(src).toMatch(/await summarizeParcelRowsAsync\(r\.rows\)/);
    expect(src).not.toMatch(/setParcelSummary\(summarizeParcelRows\(/);
    expect(src).toMatch(/epoch === parcelSummaryEpoch\.current/);
  });
});
