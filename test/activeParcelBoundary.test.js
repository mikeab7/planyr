import { describe, it, expect } from "vitest";
import {
  PARCEL_ZOOM,
  showActiveParcelAt,
  activeDrawParcels,
  reprojectParcelRing,
} from "../src/workspaces/site-planner/lib/activeParcelBoundary.js";

/* B1923744 — Map view: draw a site record's selected parcel boundary at close zoom, alongside
 * the existing pin. This suite is the "red-proof" for the whole feature: none of this module
 * existed before this item, so every assertion here fails on unmodified `main` (there is
 * nothing to import), and each case pins the exact contract MapFinder.jsx's render site relies
 * on — the zoom gate, which parcel counts as "selected", and the reprojection outcome. */

describe("showActiveParcelAt", () => {
  it("is false below PARCEL_ZOOM", () => {
    expect(showActiveParcelAt(PARCEL_ZOOM - 0.01, false)).toBe(false);
    expect(showActiveParcelAt(0, false)).toBe(false);
  });

  it("is true at and above PARCEL_ZOOM once showPlans has not yet taken over", () => {
    expect(showActiveParcelAt(PARCEL_ZOOM, false)).toBe(true);
    expect(showActiveParcelAt(PARCEL_ZOOM + 5, false)).toBe(true);
  });

  it("is false once showPlans (the full-plan swap) has taken over, even above PARCEL_ZOOM — never both at once", () => {
    expect(showActiveParcelAt(PARCEL_ZOOM, true)).toBe(false);
    expect(showActiveParcelAt(PARCEL_ZOOM + 10, true)).toBe(false);
  });

  it("degrades to false rather than throwing on an unreadable zoom", () => {
    for (const junk of [null, undefined, NaN]) {
      expect(showActiveParcelAt(junk, false)).toBe(false);
    }
  });
});

describe("activeDrawParcels", () => {
  const validRing = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

  it("returns [] for an empty or missing record — no active parcel is not a failure", () => {
    expect(activeDrawParcels([])).toEqual([]);
    expect(activeDrawParcels(null)).toEqual([]);
    expect(activeDrawParcels(undefined)).toEqual([]);
  });

  it("keeps a parcel with an explicit active:true and a real ring", () => {
    const p = { id: "p1", active: true, points: validRing };
    expect(activeDrawParcels([p])).toEqual([p]);
  });

  it("treats a missing active flag as active by default (the repo-wide `p.active !== false` idiom)", () => {
    const p = { id: "p1", points: validRing };
    expect(activeDrawParcels([p])).toEqual([p]);
  });

  it("drops an explicitly inactive parcel", () => {
    const p = { id: "p1", active: false, points: validRing };
    expect(activeDrawParcels([p])).toEqual([]);
  });

  it("drops a soft-deleted parcel even if active is still true (a superseded split parent)", () => {
    const p1 = { id: "p1", active: true, deletedAt: "2026-01-01T00:00:00Z", points: validRing };
    const p2 = { id: "p2", active: true, deleted_at: "2026-01-01T00:00:00Z", points: validRing };
    expect(activeDrawParcels([p1, p2])).toEqual([]);
  });

  it("drops a parcel with no ring, or a degenerate ring under 3 points", () => {
    expect(activeDrawParcels([{ id: "p1", active: true }])).toEqual([]);
    expect(activeDrawParcels([{ id: "p1", active: true, points: [] }])).toEqual([]);
    expect(activeDrawParcels([{ id: "p1", active: true, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }])).toEqual([]);
  });

  it("keeps every active parcel in a multi-parcel assemblage, dropping only the inactive one", () => {
    const active1 = { id: "p1", active: true, points: validRing };
    const active2 = { id: "p2", points: validRing }; // no flag = active
    const inactive = { id: "p3", active: false, points: validRing };
    expect(activeDrawParcels([active1, active2, inactive])).toEqual([active1, active2]);
  });
});

describe("reprojectParcelRing", () => {
  // A trivial project function stands in for the real feetToLatLng: this suite is about the
  // CONTRACT (all-finite → ok:true with the mapped ring; any non-finite → ok:false, drop
  // nothing silently), not about re-testing the shared projection itself (see mapLock.test.js /
  // arcgis.test.js for that).
  const identityProject = (pt, lat0, lon0) => [lat0 + pt.y, lon0 + pt.x];

  it("succeeds for a known parcel — yields a real lat/lng ring, one pair per point, in order", () => {
    const points = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }];
    const { ok, latlngs } = reprojectParcelRing(points, 30, -96, identityProject);
    expect(ok).toBe(true);
    expect(latlngs).toEqual([[30, -96], [30, -94], [31, -94]]);
  });

  it("fails loudly (ok:false, latlngs:null) when the projection returns a non-finite point — never a silent partial ring", () => {
    const brokenProject = (pt) => (pt.x === 100 ? [NaN, NaN] : [1, 1]);
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const { ok, latlngs } = reprojectParcelRing(points, 0, 0, brokenProject);
    expect(ok).toBe(false);
    expect(latlngs).toBeNull();
  });

  it("fails for an empty record's ring with no points at all producing nothing to draw", () => {
    const { ok, latlngs } = reprojectParcelRing([], 29.7, -95.4, identityProject);
    // an empty ring has no non-finite point, so `every()` is vacuously true — but there is
    // nothing to render either way, which is what activeDrawParcels' >= 3 points floor already
    // guarantees never reaches this function in production; pinned here so the two functions'
    // contracts can't quietly drift apart.
    expect(ok).toBe(true);
    expect(latlngs).toEqual([]);
  });
});
