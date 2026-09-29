// B1953797 (H2) — Model's Site.Acres / Plan.BuildingN.SF must read a SIGNED-IN plan's ROWS, not the
// local mirror. RED on the untouched tree: `buildProjectNames` had no way to see element rows, so a
// device holding only the SLIM HEADER (`parcels: []`, exactly what a cloud pull leaves for a plan that
// device never opened) read `#REF!` "no parcels drawn yet" for a 40-acre plan — and a device that had
// opened it last week quoted last week's numbers. Uses the REAL storage + projectRefs (same pattern as
// test/modelProjectRefs.test.js) with a faked localStorage.
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { saveSite } from "../src/workspaces/site-planner/lib/storage.js";
import { buildProjectNames, openPlanId } from "../src/workspaces/model/lib/projectRefs.js";
import { planRowsLoading, planRowsReady, planRowsError, fetchPlanRowsForModel, rowsSignature } from "../src/workspaces/model/lib/planRowsSource.js";
import { isErrVal, FORMULA_ERRORS } from "../src/shared/formula/formula.js";

function fakeLocalStorage() {
  const store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }, clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null, get length() { return Object.keys(store).length; },
  };
}
const SQ = (n) => [{ x: 0, y: 0 }, { x: n, y: 0 }, { x: n, y: n }, { x: 0, y: n }];
const FORTY_AC_SF = 40 * 43560;
const SIDE_40AC = Math.sqrt(FORTY_AC_SF);
const parcelRow = (id, pts, extra = {}) => ({ id, kind: "parcel", rev: 1, z_index: 1024, data: { id, points: pts, active: true, ...extra } });
const bldgRow = (id, w, h, z = 2048) => ({ id, kind: "el", rev: 1, z_index: z, data: { id, type: "building", cx: 0, cy: 0, w, h } });

describe("H2 — Model reads a signed-in plan's ROWS (Site.Acres / Plan.BuildingN.SF)", () => {
  beforeEach(() => { globalThis.localStorage = fakeLocalStorage(); });

  it("THE REPORTED CASE: device 2 holds a SLIM header (no parcels, no elements) → the rows give 40 ac, not #REF!", () => {
    saveSite({ id: "p1", site: "Goose Creek", county: "harris", parcels: [], els: [] }); // what a cloud pull leaves locally
    const rows = [parcelRow("a", SQ(SIDE_40AC)), bldgRow("b1", 200, 400)];
    const names = buildProjectNames("p1", { planRows: planRowsReady("p1", rows) });
    expect(isErrVal(names["site.acres"].value)).toBe(false);
    expect(names["site.acres"].value).toBeCloseTo(40, 3);
    expect(names["plan.building1.sf"].value).toBe(200 * 400);
    expect(names["plan.building1.footprint"].value).toBe(200 * 400);
  });

  it("…and WITHOUT the rows (the old behaviour) that same slim header reads #REF! — the control", () => {
    saveSite({ id: "p1", site: "Goose Creek", county: "harris", parcels: [], els: [] });
    const names = buildProjectNames("p1"); // signed-out / never fetched: the mirror is the authority
    expect(names["site.acres"].value).toMatchObject({ k: "error", code: FORMULA_ERRORS.REF });
  });

  it("ROWS ARE CANONICAL over a stale mirror: a device that opened the plan last week (10 ac) reads today's 40 ac", () => {
    saveSite({ id: "p2", site: "Stale Co", county: "harris", parcels: [{ id: "a", points: SQ(Math.sqrt(10 * 43560)), active: true }], els: [{ id: "old", type: "building", cx: 0, cy: 0, w: 10, h: 10 }] });
    const names = buildProjectNames("p2", { planRows: planRowsReady("p2", [parcelRow("a", SQ(SIDE_40AC)), bldgRow("b1", 300, 300)]) });
    expect(names["site.acres"].value).toBeCloseTo(40, 3);
    expect(names["plan.building1.sf"].value).toBe(90000);
  });

  it("LOADING is an explicit #N/A that says so — never #REF! ('no parcels'), never 0", () => {
    saveSite({ id: "p3", site: "Loading Co", county: "harris", parcels: [], els: [] });
    const names = buildProjectNames("p3", { planRows: planRowsLoading("p3") });
    const e = names["site.acres"];
    expect(e.value).toMatchObject({ k: "error", code: FORMULA_ERRORS.NA });
    expect(e.sourceLabel).toMatch(/loading/i);
  });

  it("a FAILED fetch is an explicit #N/A naming the failure — never the stale local number", () => {
    saveSite({ id: "p4", site: "Err Co", county: "harris", parcels: [{ id: "a", points: SQ(Math.sqrt(10 * 43560)), active: true }] });
    const names = buildProjectNames("p4", { planRows: planRowsError("p4", "boom") });
    expect(names["site.acres"].value).toMatchObject({ k: "error", code: FORMULA_ERRORS.NA });
    expect(names["site.acres"].sourceLabel).toMatch(/couldn't load/i);
  });

  it("while loading, a building this device already knows keeps its NAME as #N/A (not a misleading #NAME?)", () => {
    saveSite({ id: "p5", site: "Known Co", county: "harris", parcels: [{ id: "a", points: SQ(1000), active: true }], els: [{ id: "b1", type: "building", cx: 0, cy: 0, w: 10, h: 10 }] });
    const names = buildProjectNames("p5", { planRows: planRowsLoading("p5") });
    expect(names["plan.building1.sf"].value).toMatchObject({ k: "error", code: FORMULA_ERRORS.NA });
  });

  it("rows fetched OK and genuinely EMPTY is a true 'no parcels drawn yet' (#REF!) — the ONE case it is", () => {
    saveSite({ id: "p6", site: "Blank Co", county: "harris", parcels: [], els: [] });
    const names = buildProjectNames("p6", { planRows: planRowsReady("p6", []) });
    expect(names["site.acres"].value).toMatchObject({ k: "error", code: FORMULA_ERRORS.REF });
  });

  it("a fetch result for a DIFFERENT plan (stale after a plan switch) is ignored, never leaked in", () => {
    saveSite({ id: "p7", site: "Other Co", county: "harris", parcels: [{ id: "a", points: SQ(Math.sqrt(5 * 43560)), active: true }] });
    const names = buildProjectNames("p7", { planRows: planRowsReady("some-other-plan", [parcelRow("z", SQ(SIDE_40AC))]) });
    expect(names["site.acres"].value).toBeCloseTo(5, 3); // the mirror, since no rows were fetched for THIS plan
  });

  it("openPlanId names exactly the plan the formula names quote (one 'which plan is open' answer)", () => {
    saveSite({ id: "p8", site: "Open Co", county: "harris", parcels: [] });
    expect(openPlanId("p8")).toBe("p8");
    expect(openPlanId(null)).toBe(null);
  });
});

describe("H2 — fetchPlanRowsForModel", () => {
  const client = (pages, calls) => ({
    from: (t) => {
      calls.push(["from", t]);
      const q = {
        select: (c) => { calls.push(["select", c]); return q; }, eq: (c, v) => { calls.push(["eq", c, v]); return q; },
        in: (c, v) => { calls.push(["in", c, v]); return q; }, is: (c, v) => { calls.push(["is", c, v]); return q; },
        order: () => q,
        range: async (a, b) => { calls.push(["range", a, b]); const p = pages.shift(); return p instanceof Error ? { data: null, error: { message: p.message } } : { data: p, error: null }; },
      };
      return q;
    },
  });

  it("asks for ONLY this plan's live el+parcel rows, and walks pages past PostgREST's 1,000 cap", async () => {
    const calls = [];
    const p1 = Array.from({ length: 1000 }, (_, i) => ({ id: "a" + i, kind: "el", rev: 1 }));
    const p2 = Array.from({ length: 5 }, (_, i) => ({ id: "b" + i, kind: "parcel", rev: 1 }));
    const r = await fetchPlanRowsForModel("p1", client([p1, p2], calls));
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(1005);
    expect(calls).toContainEqual(["eq", "site_id", "p1"]);
    expect(calls).toContainEqual(["in", "kind", ["el", "parcel"]]);
    expect(calls).toContainEqual(["is", "deleted_at", null]);
    expect(calls.filter((c) => c[0] === "range")).toEqual([["range", 0, 999], ["range", 1000, 1999]]);
  });

  it("an error mid-walk is ok:false with NO partial rows (a truncated plan must not read as the plan)", async () => {
    const calls = [];
    const p1 = Array.from({ length: 1000 }, (_, i) => ({ id: "a" + i, kind: "el", rev: 1 }));
    const r = await fetchPlanRowsForModel("p1", client([p1, new Error("net")], calls));
    expect(r.ok).toBe(false);
    expect(r.rows).toEqual([]);
  });

  it("no client / no plan id → ok:false (never a fabricated empty success)", async () => {
    expect((await fetchPlanRowsForModel("p1", null)).ok).toBe(false);
    expect((await fetchPlanRowsForModel(null, client([], []))).ok).toBe(false);
  });

  it("rowsSignature changes when a row's rev moves, and not otherwise", () => {
    const a = [{ id: "x", kind: "el", rev: 1 }], b = [{ id: "x", kind: "el", rev: 2 }];
    expect(rowsSignature(a)).toBe(rowsSignature([{ id: "x", kind: "el", rev: 1 }]));
    expect(rowsSignature(a)).not.toBe(rowsSignature(b));
  });
});

describe("H2 — wiring guard: the workspace actually feeds the rows in", () => {
  const app = readFileSync(new URL("../src/workspaces/model/ModelApp.jsx", import.meta.url), "utf8");
  it("ModelApp fetches the open plan's rows and passes them to buildProjectNames", () => {
    expect(app).toMatch(/fetchPlanRowsForModel\(/);
    expect(app).toMatch(/buildProjectNames\(projectId, \{ comps, planRows \}\)/);
  });
  it("…and refreshes on site-content change, focus, and realtime on the plan's element rows", () => {
    expect(app).toMatch(/siteTick, rowsTick/);
    expect(app).toMatch(/addEventListener\("focus", bump\)/);
    expect(app).toMatch(/table: "site_elements", filter: "site_id=eq\." \+ openPlan/);
  });
});
