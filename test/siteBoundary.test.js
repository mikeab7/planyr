import { describe, it, expect } from "vitest";
import { siteAcres, siteBoundaryInfo, siteDrawParcels } from "../src/workspaces/site-planner/lib/siteBoundary.js";

/* B849344 — the exact defect: the Sites panel and map pin (MapFinder.jsx) used to read
 * `site.parcels` alone, which is a dead mirror of `sites.data->'parcels'` for any signed-in,
 * element-synced plan (empty since the B672 cutover — see cloudSync.js's slimForCloud). The real
 * geometry lives in `site_elements` rows, summarized into `parcelSummary` by
 * cloudSync.cloudParcelSummary. These tests drive the exact reported repro shape: a site record
 * whose `parcels` field is empty (as every real production row now is post-pull) but which has
 * real canonical rows.
 */
const ring = (w = 100, h = 100) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const hoffmeister = { id: "hoffmeister", site: "Hoffmeister", parcels: [] }; // the reported "0.0 AC" shape
const greenRiver = { id: "green-river", site: "GREEN RIVER", parcels: [] }; // genuinely no boundary

describe("siteBoundaryInfo", () => {
  it("RED (documents the pre-fix bug): a site with real canonical parcels but an empty legacy mirror reads 0 AC / no boundary from site.parcels ALONE", () => {
    // This is exactly what MapFinder.jsx did before B849344 — siteAcres(site) reading only the
    // dead `site.parcels` mirror. Kept here so the regression this fix closes stays provable.
    expect(siteAcres(hoffmeister)).toBe(0);
  });

  it("GREEN: with the canonical summary loaded, the same site reports its real boundary + acreage", () => {
    const parcelSummary = { hoffmeister: { count: 3, acres: 4.2, parcels: [{ id: "p1", points: ring() }] } };
    const info = siteBoundaryInfo(hoffmeister, parcelSummary);
    expect(info).toEqual({ known: true, hasBoundary: true, acres: 4.2 });
  });

  it("a site genuinely absent from a loaded summary falls back to its own (correctly empty) record — 'no boundary' stays honest", () => {
    const parcelSummary = { hoffmeister: { count: 3, acres: 4.2, parcels: [] } }; // green-river never appears
    const info = siteBoundaryInfo(greenRiver, parcelSummary);
    expect(info).toEqual({ known: true, hasBoundary: false, acres: 0 });
  });

  it("a signed-out / local-only site (never synced to rows) is read from its own live parcels field", () => {
    const local = { id: "local-1", parcels: [{ id: "p1", points: ring(660, 660), active: true }] }; // 10 ac
    // Absent from the summary because it was never pushed to site_elements at all — still correct.
    const info = siteBoundaryInfo(local, { hoffmeister: { count: 1, acres: 1, parcels: [] } });
    expect(info.known).toBe(true);
    expect(info.hasBoundary).toBe(true);
    expect(info.acres).toBeCloseTo(10, 3);
  });

  it("LOUD-FAILURE: before the summary has ever loaded, the answer is UNKNOWN — never a confident 'no boundary' / 0.0 AC", () => {
    const info = siteBoundaryInfo(hoffmeister, null);
    expect(info.known).toBe(false);
    // hasBoundary/acres are placeholders on the unknown state — callers must gate on `known`,
    // never render them directly (MapFinder.jsx's "checking boundary…" text does exactly that).
  });
});

describe("siteDrawParcels", () => {
  it("draws the CANONICAL parcels when the summary has them — never the dead site.parcels mirror", () => {
    const canonParcels = [{ id: "p1", points: ring(660, 660) }];
    const out = siteDrawParcels(hoffmeister, { hoffmeister: { count: 1, acres: 10, parcels: canonParcels } });
    expect(out).toBe(canonParcels); // same array — the map picture and the acreage number share one source
  });

  it("falls back to site.parcels (never null) when the site has no canonical rows", () => {
    expect(siteDrawParcels(greenRiver, {})).toEqual([]);
    const local = { id: "local-1", parcels: [{ id: "p1", points: ring() }] };
    expect(siteDrawParcels(local, {})).toBe(local.parcels);
  });

  it("summary not loaded yet → still returns [] (never throws), so a caller can iterate unconditionally", () => {
    expect(siteDrawParcels(hoffmeister, null)).toEqual([]);
  });
});
