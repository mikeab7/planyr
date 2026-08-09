import { describe, it, expect } from "vitest";
import {
  normalizeOrigin, sameOrigin, parseLatLon, originAtOffset, nudgeOrigin, rotPt,
} from "../src/workspaces/site-planner/lib/sitePlacement.js";
/* The whole-plan rotation tier lives in its own module and is loaded on demand — it is reachable
 * only from surfaces that are themselves lazy, so keeping it out of the planner's boot chunk is
 * what pays for this tranche's bundle cost. Same behaviour, same tests. */
import {
  rotateEntry, rotateSiteCollections, siteRotationPivot, normalizeRot, ROTATED_FIELDS,
} from "../src/workspaces/site-planner/lib/sitePlacementRotate.js";
import { feetToLatLngPair, lngLatToFeet } from "../src/workspaces/site-planner/lib/mapLock.js";

const KATY = { lat: 29.7858, lon: -95.8244 };

describe("normalizeOrigin / sameOrigin", () => {
  it("accepts lat+lon and lat+lng, rejects junk and off-earth values", () => {
    expect(normalizeOrigin({ lat: 29.78, lon: -95.82 })).toEqual({ lat: 29.78, lon: -95.82 });
    expect(normalizeOrigin({ lat: 29.78, lng: -95.82 })).toEqual({ lat: 29.78, lon: -95.82 });
    expect(normalizeOrigin({ lat: "29.78", lon: "-95.82" })).toEqual({ lat: 29.78, lon: -95.82 });
    expect(normalizeOrigin(null)).toBe(null);
    expect(normalizeOrigin({ lat: 29.78 })).toBe(null);
    expect(normalizeOrigin({ lat: NaN, lon: 3 })).toBe(null);
    expect(normalizeOrigin({ lat: 91, lon: 0 })).toBe(null);       // past the Mercator world edge
    expect(normalizeOrigin({ lat: 0, lon: 181 })).toBe(null);
  });
  it("never returns a half-valid object", () => {
    expect(normalizeOrigin({ lat: 29.78, lon: "abc" })).toBe(null);
  });
  it("compares two anchors", () => {
    expect(sameOrigin(KATY, { ...KATY })).toBe(true);
    expect(sameOrigin(KATY, { lat: KATY.lat + 1e-6, lon: KATY.lon })).toBe(false);
    expect(sameOrigin(null, null)).toBe(true);
    expect(sameOrigin(KATY, null)).toBe(false);
  });
});

describe("parseLatLon — a typed coordinate pair", () => {
  it("reads a plain decimal pair, comma- or space-separated", () => {
    expect(parseLatLon("29.7604, -95.3698")).toEqual({ lat: 29.7604, lon: -95.3698 });
    expect(parseLatLon("29.7604 -95.3698")).toEqual({ lat: 29.7604, lon: -95.3698 });
  });
  it("honours hemisphere letters, including longitude-first", () => {
    expect(parseLatLon("29.7604N 95.3698W")).toEqual({ lat: 29.7604, lon: -95.3698 });
    const flipped = parseLatLon("95.3698W 29.7604N");
    expect(flipped.lat).toBeCloseTo(29.7604, 6);
    expect(flipped.lon).toBeCloseTo(-95.3698, 6);
  });
  it("reads degrees-minutes-seconds", () => {
    const p = parseLatLon("29 45 37.4 N, 95 22 11.3 W");
    expect(p.lat).toBeCloseTo(29 + 45 / 60 + 37.4 / 3600, 6);
    expect(p.lon).toBeCloseTo(-(95 + 22 / 60 + 11.3 / 3600), 6);
    const q = parseLatLon("29°45'37.4\"N 95°22'11.3\"W");
    expect(q.lat).toBeCloseTo(p.lat, 9);
    expect(q.lon).toBeCloseTo(p.lon, 9);
  });
  it("refuses text that isn't a pair", () => {
    expect(parseLatLon("")).toBe(null);
    expect(parseLatLon("123 Main St, Katy TX")).toBe(null); // one number → not a coordinate pair
    expect(parseLatLon("29.7604")).toBe(null);
  });
});

describe("originAtOffset — nudging the anchor moves the DRAWING, not the coordinates", () => {
  it("re-anchors so a drawn point lands the requested distance away on the ground", () => {
    const moved = originAtOffset(KATY, 100, -250); // 100 ft east, 250 ft north
    // The drawn point (0,0) now sits where the offset said it should.
    const back = lngLatToFeet(moved.lon, moved.lat, KATY.lon, KATY.lat);
    expect(back.x).toBeCloseTo(100, 4);
    expect(back.y).toBeCloseTo(-250, 4);
  });
  it("is reversible to well under a foot, even on a big out-and-back", () => {
    const there = originAtOffset(KATY, 731.5, 219.25);
    const back = originAtOffset(there, -731.5, -219.25);
    // The feet frame's scale constant is anchored at the ORIGIN's latitude (ftPerDeg(lat0)), so a
    // nudge with a north/south component re-anchors that constant too and the return trip lands a
    // hair off. Bounded and tiny: this 731'E / 219'N out-and-back closes to well under a foot.
    const backFt = lngLatToFeet(back.lon, back.lat, KATY.lon, KATY.lat);
    expect(Math.hypot(backFt.x, backFt.y)).toBeLessThan(0.5);
  });
  it("a zero nudge is the identity, and a null origin stays null", () => {
    expect(originAtOffset(KATY, 0, 0)).toEqual(KATY);
    expect(originAtOffset(null, 10, 10)).toBe(null);
    expect(nudgeOrigin).toBe(originAtOffset);
  });
  it("keeps every DRAWN coordinate untouched — that is the whole guarantee", () => {
    const pts = [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 300 }];
    const before = JSON.stringify(pts);
    originAtOffset(KATY, 400, -400);
    expect(JSON.stringify(pts)).toBe(before);
  });
});

describe("rotateSiteCollections", () => {
  const parcel = { id: "p1", points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }, { x: 0, y: 200 }] };
  const bldg = { id: "b1", type: "building", cx: 200, cy: 100, w: 100, h: 50, rot: 10 };

  it("turns clockwise on screen (the compass/deedAlign sense)", () => {
    const p = rotPt({ x: 100, y: 0 }, 90, { x: 0, y: 0 }); // +x east → +y south
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(100, 9);
  });
  it("rotates parcels, element centres and element angles about the parcel centroid", () => {
    const { next, pivot } = rotateSiteCollections({ parcels: [parcel], els: [bldg] }, 90);
    expect(pivot.x).toBeCloseTo(200, 9);
    expect(pivot.y).toBeCloseTo(100, 9);
    // A 4-corner rectangle turned 90° about its own centre is the same rectangle, transposed.
    const xs = next.parcels[0].points.map((p) => p.x), ys = next.parcels[0].points.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(100, 6);
    expect(Math.max(...xs)).toBeCloseTo(300, 6);
    expect(Math.min(...ys)).toBeCloseTo(-100, 6);
    expect(Math.max(...ys)).toBeCloseTo(300, 6);
    // The building sat on the pivot, so only its angle turns.
    expect(next.els[0].cx).toBeCloseTo(200, 6);
    expect(next.els[0].cy).toBeCloseTo(100, 6);
    expect(next.els[0].rot).toBeCloseTo(100, 9);
  });
  it("is rigid — every distance and every relative bearing is preserved", () => {
    const { next } = rotateSiteCollections({ parcels: [parcel] }, 37.5);
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const before = parcel.points, after = next.parcels[0].points;
    for (let i = 0; i < before.length; i++) {
      const j = (i + 1) % before.length;
      expect(d(after[i], after[j])).toBeCloseTo(d(before[i], before[j]), 6);
    }
  });
  it("round-trips exactly, so an undo-by-inverse lands back on the original", () => {
    const there = rotateSiteCollections({ parcels: [parcel], els: [bldg] }, 12.34);
    const back = rotateSiteCollections(there.next, -12.34, there.pivot);
    back.next.parcels[0].points.forEach((p, i) => {
      expect(p.x).toBeCloseTo(parcel.points[i].x, 6);
      expect(p.y).toBeCloseTo(parcel.points[i].y, 6);
    });
    expect(back.next.els[0].rot).toBeCloseTo(bldg.rot, 9);
  });
  it("carries roads (pts), measures, callouts, markups and sheet overlays", () => {
    const c = {
      parcels: [parcel],
      els: [{ id: "r1", type: "road", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }],
      measures: [{ id: "m1", pts: [{ x: 0, y: 0 }, { x: 50, y: 50 }], labelOffset: { x: 10, y: 0 } }],
      callouts: [{ id: "c1", tip: { x: 10, y: 10 }, box: { x: 60, y: 60 }, tips: [{ x: 12, y: 12 }] }],
      markups: [{ id: "k1", kind: "encumbrance", pts: [{ x: 1, y: 2 }], centerline: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }],
      sheetOverlays: [{ id: "s1", x: 5, y: 6, rotation: 3 }],
    };
    const { next } = rotateSiteCollections(c, 90);
    expect(next.els[0].pts[1]).toBeDefined();
    expect(next.measures[0].pts.length).toBe(2);
    // labelOffset is a free VECTOR: it turns, but is never translated by the pivot.
    expect(next.measures[0].labelOffset.x).toBeCloseTo(0, 9);
    expect(next.measures[0].labelOffset.y).toBeCloseTo(10, 9);
    expect(next.callouts[0].tips.length).toBe(1);
    expect(next.markups[0].centerline.length).toBe(2);
    expect(next.sheetOverlays[0].rotation).toBeCloseTo(93, 9);
  });
  it("never touches ids, styles or county attrs", () => {
    const pc = { id: "p1", points: parcel.points, attrs: { OWNER: "ACME", GIS_ACRES: 1.84 }, stroke: "#34E802", acct: "123" };
    const { next } = rotateSiteCollections({ parcels: [pc] }, 45);
    expect(next.parcels[0].id).toBe("p1");
    expect(next.parcels[0].attrs).toEqual(pc.attrs);
    expect(next.parcels[0].stroke).toBe("#34E802");
    expect(next.parcels[0].acct).toBe("123");
  });
  it("reports the aerial underlay as UNROTATABLE instead of silently skewing it", () => {
    const { unrotatable } = rotateSiteCollections({ parcels: [parcel], underlay: { src: "x", x: 0, y: 0 } }, 5);
    expect(unrotatable).toEqual(["underlay"]);
    expect(rotateSiteCollections({ parcels: [parcel] }, 5).unrotatable).toEqual([]);
  });
  it("a 0° rotation and an empty plan are no-ops that keep the same references", () => {
    const c = { parcels: [parcel] };
    expect(rotateSiteCollections(c, 0).next).toBe(c);
    expect(rotateSiteCollections({ parcels: [] }, 30).next).toEqual({ parcels: [] });
    expect(siteRotationPivot({ parcels: [] })).toBe(null);
  });
  it("falls back to every drawn point when there is no active parcel to centre on", () => {
    expect(siteRotationPivot({ els: [{ id: "b", cx: 10, cy: 20 }] })).toEqual({ x: 10, y: 20 });
    // An INACTIVE parcel is still drawn geometry, so it counts toward the fallback pivot.
    const piv = siteRotationPivot({ parcels: [{ ...parcel, active: false }], els: [{ id: "b", cx: 10, cy: 20 }] });
    expect(piv.x).toBeCloseTo((0 + 400 + 400 + 0 + 10) / 5, 9);
    expect(piv.y).toBeCloseTo((0 + 0 + 200 + 200 + 20) / 5, 9);
  });
  it("mutates nothing it was given", () => {
    const c = { parcels: [parcel], els: [bldg] };
    const snap = JSON.stringify(c);
    rotateSiteCollections(c, 33);
    expect(JSON.stringify(c)).toBe(snap);
  });
  it("only rotates the known collections", () => {
    expect(ROTATED_FIELDS).toEqual(["parcels", "els", "measures", "callouts", "markups", "sheetOverlays"]);
  });
});

describe("normalizeRot", () => {
  it("folds to (-180, 180]", () => {
    expect(normalizeRot(357)).toBeCloseTo(-3, 9);
    expect(normalizeRot(-190)).toBeCloseTo(170, 9);
    expect(normalizeRot(0)).toBe(0);
    expect(normalizeRot(180)).toBe(180);
  });
});

describe("the whole placement contract, end to end", () => {
  it("a drawn boundary keeps its shape and lands where the origin says it does", () => {
    // Draw a lot with no location at all, then locate it.
    const ring = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 400 }, { x: 0, y: 400 }];
    const origin = normalizeOrigin({ lat: 29.7858, lon: -95.8244 });
    const ground = ring.map((p) => feetToLatLngPair(p, origin.lat, origin.lon));
    // Nudge 50 ft east: every ground position shifts by 50 ft east, the drawing is unchanged.
    const nudged = originAtOffset(origin, 50, 0);
    const ground2 = ring.map((p) => feetToLatLngPair(p, nudged.lat, nudged.lon));
    ground2.forEach(([la, ln], i) => {
      const d = lngLatToFeet(ln, la, ground[i][1], ground[i][0]);
      expect(d.x).toBeCloseTo(50, 2);   // Mercator scale varies with latitude — ~0.001 ft over 50
      expect(Math.abs(d.y)).toBeLessThan(0.01);
    });
  });
});
