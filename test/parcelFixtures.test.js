/* NEW-1 (2026-11-12) — the nightly known-parcel fixtures: shape, pure verdicts, and the network driver over a fake host. */
import { describe, it, expect } from "vitest";
import { PARCEL_FIXTURES } from "../src/shared/gis/sourceFixturesParcels.js";
import { parcelFixtures } from "../src/shared/gis/sourceFixtures.js";
import { COUNTIES } from "../src/workspaces/site-planner/lib/counties.js";
import { buildFixtureQuery, judgeParcelFixture, sameOwner, acresMatch, checkParcelFixtures, summariseFixtureChecks } from "../ui-audit/lib/parcelFixtureCheck.mjs";

describe("the fixture block", () => {
  it("is exported beside the registry fixtures and covers the six swept areas", () => {
    expect(parcelFixtures).toBe(PARCEL_FIXTURES);
    expect(Object.keys(PARCEL_FIXTURES).sort()).toEqual(["chambers", "fortbend", "ga_bartow", "harris", "tn_davidson", "tn_rutherford"]);
  });
  it("every county key is in the registry, with a layerUrl, an id field, an acres field and a measured date", () => {
    for (const [k, f] of Object.entries(PARCEL_FIXTURES)) {
      expect(COUNTIES[k]?.layerUrl, k).toBeTruthy();
      expect(f.idField && f.acresField && /^\d{4}-\d{2}-\d{2}$/.test(f.probed), k).toBeTruthy();
      expect(f.parcels.length, k).toBeGreaterThanOrEqual(3);
      for (const p of f.parcels) expect(p.id && p.owner && p.acres > 0, `${k} ${p.id}`).toBeTruthy();
    }
  });
  it("no county is fixtured from a layer URL copied here (the registry stays the one home)", () => {
    for (const f of Object.values(PARCEL_FIXTURES)) expect(JSON.stringify(f)).not.toMatch(/https?:\/\//);
  });
  it("the registry's own idField agrees with the fixture's, except where the registry deliberately names a different lookup column", () => {
    for (const k of ["harris", "fortbend", "tn_rutherford", "ga_bartow", "tn_davidson"]) expect(COUNTIES[k].idField, k).toBe(PARCEL_FIXTURES[k].idField);
  });
});

describe("pure verdicts", () => {
  it("owner compare ignores case, padding and runs of spaces, but never an empty owner", () => {
    expect(sameOwner("GERDAU AMERISTEEL US INC                ", "Gerdau  Ameristeel US Inc")).toBe(true);
    expect(sameOwner("", "")).toBe(false);
    expect(sameOwner("A LLC", "B LLC")).toBe(false);
  });
  it("acres are ±1%, with a rounding floor for tiny lots", () => {
    expect(acresMatch(36.5, 36.31)).toBe(true);   // +0.5%
    expect(acresMatch(36.8, 36.31)).toBe(false);  // +1.3%
    expect(acresMatch(0.1268, 0.1263)).toBe(true);
    expect(acresMatch(null, 5)).toBe(false);
    expect(acresMatch(NaN, 5)).toBe(false);
  });
  const spec = { idField: "PID", ownerField: "OWN", acresField: "AC" };
  const parcel = { id: "1", owner: "ACME LLC", acres: 10 };
  const row = (o, a) => ({ attributes: { PID: "1", OWN: o, AC: a } });
  it("passes a match, fails no-row / wrong owner / wrong acres", () => {
    expect(judgeParcelFixture([row("ACME LLC ", 10.05)], spec, parcel).verdict).toBe("pass");
    expect(judgeParcelFixture([], spec, parcel).verdict).toBe("fail");
    expect(judgeParcelFixture([row("OTHER", 10)], spec, parcel).problem).toMatch(/owner/);
    expect(judgeParcelFixture([row("ACME LLC", 12)], spec, parcel).problem).toMatch(/acres/);
  });
  it("stacked rows: ≥1 passes while every row agrees; oneLot demands exactly one; one disagreeing row fails", () => {
    expect(judgeParcelFixture([row("ACME LLC", 10), row("ACME LLC", 10)], spec, parcel)).toMatchObject({ verdict: "pass", rowCount: 2 });
    expect(judgeParcelFixture([row("ACME LLC", 10), row("ACME LLC", 10)], { ...spec, oneLot: true }, parcel).verdict).toBe("fail");
    expect(judgeParcelFixture([row("ACME LLC", 10), row("OTHER", 10)], spec, parcel).verdict).toBe("fail");
  });
  it("with no ownerField the app's own ownerKey resolves a table-prefixed column", () => {
    const s = { idField: "T.Account", acresField: "T.Acres" };
    expect(judgeParcelFixture([{ attributes: { "T.Account": "1", "T.Owner": "ACME LLC", "T.Acres": 10 } }], s, parcel).verdict).toBe("pass");
    expect(judgeParcelFixture([{ attributes: { "T.Account": "1", "T.Acres": 10 } }], s, parcel).problem).toMatch(/owner column/);
  });
  it("quotes an apostrophe in the id", () => {
    expect(decodeURIComponent(buildFixtureQuery("https://x.test/MapServer/0/", "ID", "O'Brien")).replace(/\+/g, " ")).toContain("ID='O''Brien'");
  });
});

describe("checkParcelFixtures over a fake host", () => {
  const fixtures = { a: { idField: "PID", ownerField: "OWN", acresField: "AC", parcels: [{ id: "1", owner: "ACME LLC", acres: 10 }, { id: "2", owner: "ACME LLC", acres: 10 }, { id: "3", owner: "ACME LLC", acres: 10 }] } };
  const registry = { a: { layerUrl: "https://x.test/MapServer/0" } };
  it("separates a drifted lot, a healthy lot and an unreachable host", async () => {
    const fetchJson = async (url) => {
      if (url.includes("%271%27")) return { ok: true, json: { features: [{ attributes: { OWN: "ACME LLC", AC: 10 } }] } };
      if (url.includes("%272%27")) return { ok: true, json: { features: [{ attributes: { OWN: "ACME LLC", AC: 99 } }] } };
      return { ok: false, blocked: true, error: "CONNECT" };
    };
    const rows = await checkParcelFixtures({ fixtures, registry, fetchJson });
    expect(rows.map((r) => r.verdict)).toEqual(["pass", "fail", "unmeasured"]);
    const s = summariseFixtureChecks(rows);
    expect(s.passed).toBe(1);
    expect(s.failed).toHaveLength(1);
    expect(s.unmeasured[0].problem).toMatch(/blocked/);
  });
  it("an ArcGIS error body is a failure, a thrown fetch is unmeasured, a county with no registry layer fails loudly", async () => {
    const r1 = await checkParcelFixtures({ fixtures, registry, fetchJson: async () => ({ ok: true, json: { error: { message: "bad where" } } }) });
    expect(r1.every((r) => r.verdict === "fail" && /bad where/.test(r.problem))).toBe(true);
    const r2 = await checkParcelFixtures({ fixtures, registry, fetchJson: async () => { throw new Error("boom"); } });
    expect(r2.every((r) => r.verdict === "unmeasured")).toBe(true);
    const r3 = await checkParcelFixtures({ fixtures, registry: {}, fetchJson: async () => ({}) });
    expect(r3).toHaveLength(1);
    expect(r3[0].verdict).toBe("fail");
  });
});
