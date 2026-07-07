import { describe, it, expect } from "vitest";
import { createSiteModel, countJunkEntries } from "../src/workspaces/site-planner/lib/siteModel.js";
import { ensureZ, normalizeZ, needsZ } from "../src/workspaces/site-planner/lib/zOrder.js";

// The husk-parcel crash (Michael's incognito outage, 2026-07-06): one null entry in a persisted
// parcels array — JSON.stringify turns an undefined entry or an array hole into null — survived
// createSiteModel, got spread by normalizeZ into a `{z}` "husk" with no points, and MapFinder's
// siteAcres then threw "Cannot read properties of undefined (reading 'length')" on EVERY load,
// error-boundarying the whole Site Planner. These tests pin the funnel: junk entries are dropped
// at normalization, husks are never manufactured, and clean inputs stay reference-stable.

const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

describe("zOrder — normalizeZ/ensureZ never manufacture husks", () => {
  it("normalizeZ drops null/undefined entries instead of spreading them into {z} husks", () => {
    const out = normalizeZ([null, { id: "a" }, undefined, { id: "b", z: 5 }]);
    expect(out).toEqual([{ id: "a", z: 0 }, { id: "b", z: 1024 }]);
  });

  it("needsZ flags a list containing a non-object entry so ensureZ runs the cleanup pass", () => {
    expect(needsZ([{ id: "a", z: 0 }, null, { id: "b", z: 1024 }])).toBe(true);
    expect(ensureZ([{ id: "a", z: 0 }, null, { id: "b", z: 1024 }])).toEqual([{ id: "a", z: 0 }, { id: "b", z: 1024 }]);
  });

  it("a clean, distinctly-z'd list passes through ensureZ by reference (no churn)", () => {
    const list = [{ id: "a", z: 0 }, { id: "b", z: 1024 }];
    expect(ensureZ(list)).toBe(list);
  });
});

describe("createSiteModel — the funnel drops junk entries from every collection", () => {
  it("drops null entries from parcels/els/markups/measures/callouts", () => {
    const m = createSiteModel({
      id: "s1",
      parcels: [null, { id: "p1", points: pts }],
      els: [null, { id: "e1", type: "building", x: 0, y: 0, w: 10, h: 10 }],
      markups: [null, { id: "m1", type: "line" }],
      measures: [null, { id: "me1" }],
      callouts: [null, { id: "c1" }],
    });
    expect(m.parcels.map((p) => p.id)).toEqual(["p1"]);
    expect(m.els.map((e) => e.id)).toEqual(["e1"]);
    expect(m.markups.map((e) => e.id)).toEqual(["m1"]);
    expect(m.measures.map((e) => e.id)).toEqual(["me1"]);
    expect(m.callouts.map((e) => e.id)).toEqual(["c1"]);
  });

  it("drops husk parcels (missing / empty / non-array points) but keeps healthy ones", () => {
    const m = createSiteModel({
      id: "s1",
      parcels: [{ z: 0 }, { id: "p0", points: [] }, { id: "px", points: "junk" }, { id: "p1", points: pts, addr: "BATTLEBELL" }],
    });
    expect(m.parcels).toHaveLength(1);
    expect(m.parcels[0].id).toBe("p1");
    expect(m.parcels[0].addr).toBe("BATTLEBELL");
  });

  it("the exact crash shape — a persisted null that a prior load turned into a {z} husk — reads clean", () => {
    // siteAcres(site) does site.parcels.reduce((s,p) => s + shoelace(p.points)); this shape threw.
    const m = createSiteModel({ id: "s1", parcels: [{ z: 0 }, null] });
    expect(m.parcels).toEqual([]);
    // and the acreage math the site list runs is now safe by construction
    expect(() => m.parcels.reduce((s, p) => s + p.points.length, 0)).not.toThrow();
  });

  it("drops null entries from sheetOverlays / parcelDrawings / crossSections", () => {
    const m = createSiteModel({
      id: "s1",
      sheetOverlays: [null, { id: "o1" }],
      parcelDrawings: [null, { id: "d1" }],
      elevation: { crossSections: [null, { id: "x1" }] },
    });
    expect(m.sheetOverlays.map((o) => o.id)).toEqual(["o1"]);
    expect(m.parcelDrawings.map((d) => d.id)).toEqual(["d1"]);
    expect(m.elevation.crossSections.map((x) => x.id)).toEqual(["x1"]);
  });

  it("clean collections stay reference-stable through the funnel (no save/state churn)", () => {
    const parcels = [{ id: "p1", points: pts, z: 0 }];
    const els = [{ id: "e1", type: "building", z: 0 }];
    const m = createSiteModel({ id: "s1", parcels, els });
    expect(m.parcels).toBe(parcels);
    expect(m.els).toBe(els);
  });

  it("normalization is idempotent on a sanitized model", () => {
    const m1 = createSiteModel({ id: "s1", parcels: [null, { id: "p1", points: pts }], els: [null] });
    const m2 = createSiteModel(m1);
    expect(m2.parcels).toEqual(m1.parcels);
    expect(m2.els).toEqual(m1.els);
  });
});

describe("countJunkEntries — the LOUD-FAILURE signal for sanitized records", () => {
  it("counts nulls across collections plus husk parcels", () => {
    expect(countJunkEntries({
      parcels: [null, { z: 0 }, { id: "p1", points: pts }],
      els: [null, { id: "e1" }],
      markups: [undefined],
      sheetOverlays: [null],
      elevation: { crossSections: [null] },
    })).toBe(6);
  });

  it("is zero for a clean record and safe on garbage input", () => {
    expect(countJunkEntries({ parcels: [{ id: "p1", points: pts }], els: [{ id: "e1" }] })).toBe(0);
    expect(countJunkEntries(null)).toBe(0);
    expect(countJunkEntries("junk")).toBe(0);
  });
});
