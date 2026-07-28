import { describe, it, expect } from "vitest";
import { DOGEAR_W, DOGEAR_D, dogEarGeom, dogEarSize, bumpSidewalkSide, sidewalkSpanForBumps,
  wallStripBox, wallKidBox, wallKidPerp, hostAxisExtents, ownExtents, bumpsOfHost, localToWorld } from "../src/workspaces/site-planner/lib/dogEar.js";

// A square host building centred at the origin, axis-aligned, 100×100.
const host = (over = {}) => ({ cx: 0, cy: 0, w: 100, h: 100, rot: 0, ...over });

describe("dogEar — corner bump-out geometry (B362)", () => {
  it("default bump-out is 55′ along the wall × 60′ projection, flush at the corner", () => {
    // bottom wall, right corner (sign +1): along runs on X (w), projection on Y (h)
    const g = dogEarGeom(host(), { side: "bottom", sign: 1 });
    expect(g.w).toBe(DOGEAR_W); // 55 along the wall
    expect(g.h).toBe(DOGEAR_D); // 60 projecting out
    // outer (right) edge flush with the building's right edge (x = +50)
    expect(g.cx + g.w / 2).toBeCloseTo(50, 6);
    // inner edge flush against the bottom dock face (y = +50), projecting outward
    expect(g.cy - g.h / 2).toBeCloseTo(50, 6);

    // a left/right wall swaps the axes: along is on Y (h), projection on X (w)
    const r = dogEarGeom(host(), { side: "right", sign: 1 });
    expect(r.w).toBe(DOGEAR_D);
    expect(r.h).toBe(DOGEAR_W);
  });

  it("dogEarSize is the inverse of the w/h packing (remembers a resize by wall)", () => {
    // top/bottom wall: box w = along, box h = projection
    expect(dogEarSize({ side: "bottom" }, 70, 80)).toEqual({ along: 70, proj: 80 });
    // left/right wall: box h = along, box w = projection
    expect(dogEarSize({ side: "left" }, 80, 70)).toEqual({ along: 70, proj: 80 });
  });

  it("THE BUG: a resized bump-out keeps its size across a host resize (never reverts to 55×60)", () => {
    const de = { side: "bottom", sign: 1 };
    // user resizes the bump to 70 along × 80 out → captured onto the dogEar tag
    const sized = { ...de, ...dogEarSize(de, 70, 80) };
    expect(sized).toMatchObject({ along: 70, proj: 80 });

    // now the host is resized bigger AND smaller; the bump must keep 70×80, not snap back
    for (const w of [140, 100, 90]) {
      const g = dogEarGeom(host({ w, h: 120 }), sized);
      expect(g.w).toBe(70); // along preserved (wall is wide enough)
      expect(g.h).toBe(80); // projection preserved
      // and it stays flush at the (new) right corner
      expect(g.cx + g.w / 2).toBeCloseTo(w / 2, 6);
    }
  });

  it("clamps (does NOT reset) the along-span when the host shrinks past the corner, then springs back", () => {
    const sized = { side: "bottom", sign: 1, along: 80, proj: 60 };
    // host wall shrinks to 50 (< 80): the rendered span clamps to the wall …
    const shrunk = dogEarGeom(host({ w: 50 }), sized);
    expect(shrunk.w).toBe(50);
    // … but the stored size is untouched, so growing the host back restores the full 80
    const grown = dogEarGeom(host({ w: 120 }), sized);
    expect(grown.w).toBe(80);
  });

  it("carries the host's rotation (the box turns with the building)", () => {
    const g = dogEarGeom(host({ rot: 30 }), { side: "bottom", sign: 1 });
    expect(g.rot).toBe(30);
  });
});

describe("bumpSidewalkSide — which perpendicular wall a corner bump lengthens (B492)", () => {
  it("maps a top/bottom dock corner to the left/right wall by sign", () => {
    expect(bumpSidewalkSide("top", -1)).toBe("left");
    expect(bumpSidewalkSide("top", 1)).toBe("right");
    expect(bumpSidewalkSide("bottom", -1)).toBe("left");
    expect(bumpSidewalkSide("bottom", 1)).toBe("right");
  });
  it("maps a left/right dock corner to the top/bottom wall by sign", () => {
    expect(bumpSidewalkSide("left", -1)).toBe("top");
    expect(bumpSidewalkSide("right", 1)).toBe("bottom");
  });
});

describe("sidewalkSpanForBumps — sidewalk spans the FULL building side incl. bump-outs (B492)", () => {
  const b = { cx: 0, cy: 0, w: 600, h: 300, rot: 0 }; // docks on top/bottom

  it("with no bumps the run is just the wall length, no shift", () => {
    expect(sidewalkSpanForBumps(b, "left", [])).toEqual({ run: 300, alongShift: 0 });
    expect(sidewalkSpanForBumps(b, "top", [])).toEqual({ run: 600, alongShift: 0 });
  });

  it("a single bump on the perpendicular wall extends the run by its projection and shifts the centre", () => {
    // top-left bump (side=top, sign=-1) lengthens the LEFT wall at its top (−Y) end
    const bumps = [{ side: "top", sign: -1, proj: 60 }];
    const { run, alongShift } = sidewalkSpanForBumps(b, "left", bumps);
    expect(run).toBe(360);          // 300 + 60
    expect(alongShift).toBe(-30);   // centre shifts toward −Y (the extended top end) by 60/2
  });

  it("bumps at BOTH ends of a wall add up and re-centre by the difference", () => {
    const bumps = [
      { side: "top", sign: -1, proj: 60 },     // extends left wall at −Y end
      { side: "bottom", sign: -1, proj: 40 },  // extends left wall at +Y end
    ];
    const { run, alongShift } = sidewalkSpanForBumps(b, "left", bumps);
    expect(run).toBe(400);            // 300 + 60 + 40
    expect(alongShift).toBe(-10);     // (40 − 60)/2 = −10 → net toward the bigger (top) bump end
  });

  it("ignores bumps that don't land on this wall", () => {
    // a right-end (top, sign=+1) bump affects the RIGHT wall, not the left
    expect(sidewalkSpanForBumps(b, "left", [{ side: "top", sign: 1, proj: 60 }]))
      .toEqual({ run: 300, alongShift: 0 });
  });
});

/* ---- NEW-2 / NEW-3 — wall-hugging children are DERIVED, never ratio-scaled -----------------
 * The drift the owner reported on Tsakiris / Concept A Building 3: the end sidewalks read 224 and
 * 221 where the span rule says 220 (h 160 + a 60 bump projection) and one had slid off centre,
 * while the west side-parking field sat 5.32 ft out in bare ground with the east one flush. Both
 * came from SitePlanner's fitKid replaying a remembered box (`alongDim = 2·alongHalf·ratio`, and a
 * `perpGap` captured before the sidewalk changed) instead of recomputing from the rule. These
 * cover the pure half of the fix; siteModel/SitePlanner wire it in. */
describe("wallStripBox — an end-wall sidewalk spans EXACTLY the extended side (NEW-2)", () => {
  // The owner's Building 3, normalised to the origin: 509 × 160, two bottom-wall bump-outs
  // (sign ±1) each projecting 60 → both end walls run 220.
  const b3 = { cx: 0, cy: 0, w: 509, h: 160, rot: 0 };
  const bumps = [{ side: "bottom", sign: -1, along: 55, proj: 60 }, { side: "bottom", sign: 1, along: 55, proj: 60 }];
  const SW = 5;

  it("run = building depth + the projection of the bump that lengthens that wall", () => {
    for (const side of ["left", "right"]) {
      const g = wallStripBox(b3, side, bumps, SW);
      expect(g.run).toBe(220);            // 160 + 60 — the number both end strips must read
      expect(g.alongShift).toBe(30);      // both bumps sit on the +Y end, so the centre shifts +30
    }
  });

  it("the strip is FLUSH against the wall on the perpendicular axis, at any host size", () => {
    for (const h of [160, 240, 90]) {
      for (const side of ["left", "right"]) {
        const g = wallStripBox({ ...b3, h }, side, bumps, SW);
        const inner = Math.abs(g.lx) - SW / 2;   // the strip's face toward the building
        expect(inner).toBeCloseTo(b3.w / 2, 9);  // exactly on the wall — no gap, no overlap
      }
    }
  });

  it("THE BUG: a HOST RESIZE re-derives the run — it is not scaled proportionally", () => {
    // Pre-fix, fitKid scaled the stored run by newAlongHalf/oldAlongHalf. Growing 160 → 200 would
    // have taken 220 → 275; the rule says 200 + 60 = 260.
    expect(wallStripBox({ ...b3, h: 200 }, "left", bumps, SW).run).toBe(260);
    expect(wallStripBox({ ...b3, h: 120 }, "left", bumps, SW).run).toBe(180);
  });

  it("deleting the bump-out collapses the strip back to the bare side (B492 behaviour kept)", () => {
    const g = wallStripBox(b3, "left", [], SW);
    expect(g.run).toBe(160);
    expect(g.alongShift).toBe(0);
  });

  it("a bump resized to a NON-DEFAULT projection is honoured, not the 60′ default", () => {
    const deep = [{ side: "bottom", sign: -1, along: 55, proj: 95 }];
    expect(wallStripBox(b3, "left", deep, SW).run).toBe(255);   // 160 + 95
    expect(wallStripBox(b3, "left", deep, SW).alongShift).toBe(47.5);
    expect(wallStripBox(b3, "right", deep, SW).run).toBe(160);  // the other end wall is untouched
  });

  it("bump added THEN host resized lands on the rule, in either order", () => {
    const grown = { ...b3, h: 300 };
    expect(wallStripBox(grown, "left", bumps, SW).run).toBe(360);          // 300 + 60
    expect(wallStripBox(grown, "left", bumps, SW).run)
      .toBe(wallStripBox(grown, "left", bumps, SW).run);                    // idempotent
  });

  it("holds at both quarter-turn rotations (the run/thickness axes swap with the host)", () => {
    for (const rot of [90, 270, 180]) {
      const g = wallStripBox({ ...b3, rot }, "left", bumps, SW);
      expect(g.run).toBe(220);
      expect(g.dimBX).toBe(SW);    // local-frame extents don't care about the host angle …
      expect(g.dimBY).toBe(220);
      const c = localToWorld({ ...b3, rot }, g.lx, g.ly);   // … the rotation lands on the way out
      expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true);
    }
    // a top/bottom strip packs the run on the OTHER local axis
    const t = wallStripBox(b3, "top", bumps, SW);
    expect(t.dimBX).toBe(509);
    expect(t.dimBY).toBe(SW);
  });
});

describe("wallKidPerp / wallKidBox — side parking sits FLUSH against its sidewalk (NEW-3)", () => {
  const b3 = { cx: 0, cy: 0, w: 509, h: 160, rot: 0 };
  const PARK = 42, SW = 5;

  it("the offset is derived from the wall + the sidewalk's THICKNESS — zero bare ground", () => {
    const perp = wallKidPerp(b3, "right", PARK, SW);
    expect(perp - PARK / 2).toBeCloseTo(b3.w / 2 + SW, 9);   // inner face exactly on the strip's outer face
  });

  it("with no sidewalk on that side it sits flush against the WALL", () => {
    expect(wallKidPerp(b3, "left", PARK, 0) + PARK / 2).toBeCloseTo(-b3.w / 2, 9);
  });

  it("THE BUG: the offset never depends on a remembered gap — a width change just re-derives", () => {
    // The owner's west field replayed a perpGap captured before the sidewalk was re-laid, leaving a
    // 5.32 ft strip of dirt. Re-deriving from the live thickness can't do that, at any width.
    for (const t of [5, 8, 12]) {
      expect(wallKidPerp(b3, "right", PARK, t) - PARK / 2).toBeCloseTo(b3.w / 2 + t, 9);
    }
  });

  it("a hand-positioned field keeps its own run + along-wall centre (owner intent, NEW-3)", () => {
    // Building 3's east field: the owner slid it along the wall for the curb return where the fire
    // lane ties in (run 208, centre 32) — the 220 span default must NOT be forced onto it.
    const g = wallKidBox(b3, "left", { depth: PARK, gap: SW, run: 208, alongShift: 32 });
    expect(g.dimBY).toBe(208);   // its own run, not the 220 span
    expect(g.ly).toBe(32);       // exactly where the owner left it
    expect(g.lx + PARK / 2).toBeCloseTo(-(b3.w / 2 + SW), 9); // …and still flush perpendicular
  });

  it("flushness holds at both quarter-turn rotations and on every side", () => {
    for (const rot of [0, 90, 180, 270]) {
      for (const side of ["left", "right", "top", "bottom"]) {
        const b = { ...b3, rot };
        const isVert = side === "left" || side === "right";
        const g = wallKidBox(b, side, { depth: PARK, gap: SW, run: 100, alongShift: 0 });
        const perp = isVert ? g.lx : g.ly;
        expect(Math.abs(perp) - PARK / 2).toBeCloseTo((isVert ? b.w : b.h) / 2 + SW, 9);
      }
    }
  });
});

describe("hostAxisExtents / ownExtents — a child's own w/h ↔ the host's axes", () => {
  const b = { cx: 0, cy: 0, w: 500, h: 160, rot: 180 };
  it("resolves a quarter-turned side-parking row onto the host's axes and back", () => {
    const park = { cx: 0, cy: 0, w: 210, h: 42, rot: 90 };   // rel 270 → crossed
    const { cross, dimBX, dimBY } = hostAxisExtents(b, park);
    expect(cross).toBe(true);
    expect(dimBX).toBe(42);    // depth lands on the host's X (it hugs a left/right wall)
    expect(dimBY).toBe(210);   // its run lands on the host's Y
    expect(ownExtents(cross, dimBX, dimBY)).toEqual({ w: 210, h: 42 });
  });
  it("an in-line strip keeps its axes", () => {
    const sw = { cx: 0, cy: 0, w: 5, h: 210, rot: 180 };
    const { cross, dimBX, dimBY } = hostAxisExtents(b, sw);
    expect(cross).toBe(false);
    expect([dimBX, dimBY]).toEqual([5, 210]);
    expect(ownExtents(cross, dimBX, dimBY)).toEqual({ w: 5, h: 210 });
  });
});

describe("bumpsOfHost / dogEarDesc — one reading of a bump's projection", () => {
  const b = { id: "b", cx: 0, cy: 0, w: 509, h: 160, rot: 0 };
  it("prefers the stored tag and recovers along/proj from the box when it's bare", () => {
    const bare = { id: "d1", attachedTo: "b", w: 55, h: 60, dogEar: { side: "bottom", sign: 1 } };
    const tagged = { id: "d2", attachedTo: "b", w: 55, h: 60, dogEar: { side: "bottom", sign: -1, along: 70, proj: 95 } };
    const got = bumpsOfHost([b, bare, tagged, { id: "x", attachedTo: "other", dogEar: { side: "top", sign: 1 } }], b);
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({ side: "bottom", sign: 1, along: 55, proj: 60 });
    expect(got[1]).toMatchObject({ side: "bottom", sign: -1, along: 70, proj: 95 });
  });
  it("skips a tampered record with an unusable side instead of throwing", () => {
    expect(bumpsOfHost([b, { id: "d", attachedTo: "b", w: 1, h: 1, dogEar: { side: "diagonal", sign: 1 } }], b)).toEqual([]);
  });
});
