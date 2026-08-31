/* B941152 — a comp anchored to a MULTI-parcel selection ("2 parcels · 66.17 AC", Enter did
 * nothing). Root cause: `placeCompOnSelectedParcel` (MapFinder.jsx) read ONLY
 * `selected[selected.length - 1]`, so every parcel but the last was silently dropped, and the one
 * button that called it was gated to `selected.length === 1` and simply did not render for a
 * bigger selection — no click path existed, and nothing was ever sent to Supabase.
 *
 * This suite proves the fix at the pure-function level (MapFinder.jsx imports Leaflet and cannot
 * be unit-tested directly): `compAnchorFromSelection` and its three helpers, exercised against the
 * real `selected` item shape (`{key, rings, addr, acct, attrs, county}`, MapFinder.jsx:787) and the
 * real `computeAssembly` result shape (`{origin:{lat,lon}, totalAc}`, MapFinder.jsx:392).
 */
import { describe, it, expect } from "vitest";
import {
  parcelGeomFromSelection, parcelApnFromSelection, parcelCountyFromSelection, compAnchorFromSelection,
} from "../src/workspaces/site-planner/lib/compParcelAnchor.js";
import { validAnchor } from "../src/shared/comps/lib/comps.js";

const ringA = [[[-95.5, 29.7], [-95.49, 29.7], [-95.49, 29.71], [-95.5, 29.71], [-95.5, 29.7]]];
const ringB = [[[-95.48, 29.72], [-95.47, 29.72], [-95.47, 29.73], [-95.48, 29.73], [-95.48, 29.72]]];

const parcelA = { key: "a", rings: ringA, addr: "100 Main St", acct: "APN-100", attrs: {}, county: "harris" };
const parcelB = { key: "b", rings: ringB, addr: "200 Main St", acct: "APN-200", attrs: {}, county: "harris" };

describe("compParcelAnchor: geometry", () => {
  it("a single parcel produces a Polygon — byte-identical to the pre-fix single-parcel shape", () => {
    expect(parcelGeomFromSelection([parcelA])).toEqual({ type: "Polygon", coordinates: ringA });
  });
  it("two-plus parcels produce a MultiPolygon of every selected parcel's rings, not just the last", () => {
    expect(parcelGeomFromSelection([parcelA, parcelB])).toEqual({
      type: "MultiPolygon", coordinates: [ringA, ringB],
    });
  });
  it("a parcel with no rings is skipped, never crashes the geometry build", () => {
    expect(parcelGeomFromSelection([parcelA, { key: "c", acct: "APN-300" }])).toEqual({
      type: "Polygon", coordinates: ringA,
    });
  });
  it("null when nothing selected carries rings", () => {
    expect(parcelGeomFromSelection([])).toBeNull();
    expect(parcelGeomFromSelection([{ key: "c" }])).toBeNull();
  });
});

describe("compParcelAnchor: APN", () => {
  it("a single parcel's APN is unchanged from the pre-fix shape", () => {
    expect(parcelApnFromSelection([parcelA])).toBe("APN-100");
  });
  it("multiple parcels join EVERY account id — the old code kept only the last", () => {
    expect(parcelApnFromSelection([parcelA, parcelB])).toBe("APN-100, APN-200");
  });
  it("a parcel missing its account id is dropped from the join, not rendered as a blank", () => {
    expect(parcelApnFromSelection([parcelA, { key: "c", acct: null }, parcelB])).toBe("APN-100, APN-200");
  });
  it("null when nothing selected has an account id", () => {
    expect(parcelApnFromSelection([{ key: "c" }])).toBeNull();
  });
});

describe("compParcelAnchor: county", () => {
  it("prefers the last-selected parcel's county — same fallback planSelected already uses", () => {
    const b = { ...parcelB, county: "fortbend" };
    expect(parcelCountyFromSelection([parcelA, b])).toBe("fortbend");
  });
  it("falls back to the first selected parcel that HAS a county when the last one doesn't", () => {
    const bNoCounty = { ...parcelB, county: null };
    expect(parcelCountyFromSelection([parcelA, bNoCounty])).toBe("harris");
  });
  it("null when no selected parcel resolved a county", () => {
    expect(parcelCountyFromSelection([{ key: "a" }, { key: "b" }])).toBeNull();
  });
});

describe("compAnchorFromSelection: the full comp anchor payload", () => {
  it("anchors a two-parcel selection at the assembly's bbox-center and carries the toolbar's own acreage", () => {
    const asm = { origin: { lat: 29.715, lon: -95.485 }, totalAc: 66.17 };
    const anchor = compAnchorFromSelection([parcelA, parcelB], asm);
    expect(anchor).toEqual({
      kind: "parcel",
      lat: 29.715, lon: -95.485,
      county: "harris",
      parcelApn: "APN-100, APN-200",
      parcelGeom: { type: "MultiPolygon", coordinates: [ringA, ringB] },
      acreageAc: 66.17,
    });
  });
  it("a two-parcel anchor passes the comps model's own validAnchor check — the same gate a real save goes through", () => {
    const asm = { origin: { lat: 29.715, lon: -95.485 }, totalAc: 66.17 };
    const anchor = compAnchorFromSelection([parcelA, parcelB], asm);
    expect(validAnchor(anchor)).toBe(true);
  });
  it("a single-parcel anchor is unaffected: one Polygon, one APN, its own county", () => {
    const asm = { origin: { lat: 29.705, lon: -95.495 }, totalAc: 12.5 };
    const anchor = compAnchorFromSelection([parcelA], asm);
    expect(anchor).toEqual({
      kind: "parcel",
      lat: 29.705, lon: -95.495,
      county: "harris",
      parcelApn: "APN-100",
      parcelGeom: { type: "Polygon", coordinates: ringA },
      acreageAc: 12.5,
    });
  });
  it("null when there is no assembly or nothing selected — the caller's existing early-return guard", () => {
    expect(compAnchorFromSelection([], null)).toBeNull();
    expect(compAnchorFromSelection([], { origin: { lat: 0, lon: 0 }, totalAc: 0 })).toBeNull();
    expect(compAnchorFromSelection([parcelA], null)).toBeNull();
  });
});
